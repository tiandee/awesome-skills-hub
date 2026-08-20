'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverLibrary, parseSkill, readAgentsLock } = require('./discovery');
const { contentDigest, listPortableSkillContent } = require('./snapshot');
const { atomicWrite, isDirectory, lexists, sha256, timestampId, writeJsonAtomic } = require('./util');

const UPDATE_TRANSACTION_VERSION = 1;
const DEFAULT_CHECK_CONCURRENCY = 3;
const DEFAULT_GIT_TIMEOUT_MS = 120000;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_STALE_DAYS = 180;
const STANDARD_LOCK_ENTRY_FIELDS = [
  'source', 'sourceType', 'sourceUrl', 'skillPath', 'ref',
  'skillFolderHash', 'installedAt', 'updatedAt',
];

function removeTree(target) {
  if (!lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  fs.readdirSync(target).forEach(function removeChild(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function copyRawTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination, process.platform === 'win32' ? 'junction' : undefined);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: false, mode: stat.mode & 0o777 });
    fs.readdirSync(source).forEach(function copyChild(name) {
      copyRawTree(path.join(source, name), path.join(destination, name));
    });
    return;
  }
  if (!stat.isFile()) throw new Error('unsupported update backup entry: ' + source);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, stat.mode & 0o777);
}

function moveTree(source, destination) {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
    copyRawTree(source, destination);
    removeTree(source);
  }
}

function safeRelativePath(value, label) {
  const selected = String(value || '').replace(/\\/g, '/');
  if (!selected || selected.indexOf('\0') !== -1 || path.posix.isAbsolute(selected)) {
    throw new Error(label + ' must be a safe relative path');
  }
  if (selected.split('/').some(function traversal(part) { return part === '..'; })) {
    throw new Error(label + ' escapes the source repository');
  }
  const normalized = path.posix.normalize(selected);
  if (normalized === '..' || normalized.indexOf('../') === 0) throw new Error(label + ' escapes the source repository');
  return normalized;
}

function skillFolderPath(skillPath) {
  const selected = safeRelativePath(skillPath, 'skillPath');
  return path.posix.basename(selected).toLowerCase() === 'skill.md' ? path.posix.dirname(selected) : selected;
}

function canonicalSkillPath(skillPath) {
  const selected = safeRelativePath(skillPath, 'skillPath');
  if (path.posix.basename(selected).toLowerCase() === 'skill.md') return selected;
  return selected === '.' ? 'SKILL.md' : selected + '/SKILL.md';
}

function skillPathCandidates(slug, includeRepositoryRoot) {
  const name = safeRelativePath(slug, 'Skill slug');
  const candidates = [
    'skills/' + name + '/SKILL.md',
    'skills/.curated/' + name + '/SKILL.md',
    'skills/.experimental/' + name + '/SKILL.md',
    'skills/.system/' + name + '/SKILL.md',
    '.agents/skills/' + name + '/SKILL.md',
    '.claude/skills/' + name + '/SKILL.md',
    '.cursor/skills/' + name + '/SKILL.md',
    '.codex/skills/' + name + '/SKILL.md',
    'agent/skills/' + name + '/SKILL.md',
    'data/skills/' + name + '/SKILL.md',
    name + '/SKILL.md',
  ];
  if (includeRepositoryRoot) candidates.push('SKILL.md');
  return candidates;
}

function sourceName(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    const selected = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    return selected || parsed.hostname;
  } catch (error) {
    return String(sourceUrl || '');
  }
}

function standardLockEntry(entry) {
  const selected = entry && typeof entry === 'object' ? entry : {};
  const result = {};
  STANDARD_LOCK_ENTRY_FIELDS.forEach(function copy(field) {
    if (Object.prototype.hasOwnProperty.call(selected, field)) result[field] = selected[field];
  });
  return result;
}

function parseSkillsShUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (error) { throw new Error('skills.sh Skill URL is not valid'); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (hostname !== 'skills.sh' && hostname !== 'www.skills.sh') || parsed.username || parsed.password || parsed.port) {
    throw new Error('skills.sh Skill URL must use HTTPS on skills.sh');
  }
  if (parsed.search || parsed.hash) throw new Error('skills.sh Skill URL must not include query parameters or fragments');
  let segments;
  try { segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch (error) {
    throw new Error('skills.sh Skill URL contains invalid path encoding');
  }
  if (segments.length !== 3) throw new Error('skills.sh Skill URL must identify owner/repository/skill');
  const owner = segments[0];
  const repository = segments[1];
  const slug = segments[2];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repository) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('skills.sh Skill URL contains an unsupported GitHub source or Skill slug');
  }
  const source = owner + '/' + repository;
  return {
    owner,
    repository,
    slug,
    source,
    source_id: source + '/' + slug,
    source_url: 'https://github.com/' + source + '.git',
    skills_url: 'https://skills.sh/' + source + '/' + slug,
  };
}

function sourceKey(entry) {
  return String(entry.sourceUrl || '') + '\n' + String(entry.ref || '');
}

function validateSourceUrl(value, options) {
  const selected = String(value || '');
  const opts = options || {};
  if (opts.allowLocal && (selected.indexOf('file://') === 0 || path.isAbsolute(selected))) return selected;
  let parsed;
  try { parsed = new URL(selected); } catch (error) { throw new Error('update source is not a valid URL'); }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.username || parsed.password || parsed.port) {
    throw new Error('v1 updates support only HTTPS GitHub sources');
  }
  return parsed.toString();
}

function validateRef(value) {
  if (!value) return null;
  const selected = String(value);
  if (selected.length > 200 || selected.charAt(0) === '-' || /[\s\0]/.test(selected)) {
    throw new Error('update source ref is invalid');
  }
  return selected;
}

function runCommand(command, args, options) {
  const opts = options || {};
  const spawn = opts.spawn || childProcess.spawn;
  const timeoutMs = opts.timeoutMs || DEFAULT_GIT_TIMEOUT_MS;
  return new Promise(function execute(resolve, reject) {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }, opts.env || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(function timeout() {
      if (settled) return;
      child.kill('SIGTERM');
      settled = true;
      reject(new Error(command + ' timed out'));
    }, timeoutMs);
    function collect(target, chunk) {
      outputBytes += chunk.length;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(command + ' produced too much output'));
        }
        return;
      }
      target.push(chunk);
    }
    child.stdout.on('data', function output(chunk) { collect(stdout, chunk); });
    child.stderr.on('data', function output(chunk) { collect(stderr, chunk); });
    child.on('error', function failed(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', function completed(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code !== 0) reject(new Error(command + ' failed: ' + (result.stderr || result.stdout).trim()));
      else resolve(result);
    });
  });
}

function createGitSourceClient(options) {
  const opts = options || {};
  const runner = opts.runCommand || runCommand;

  async function git(args, cwd) {
    return runner('git', args, { cwd, spawn: opts.spawn, timeoutMs: opts.timeoutMs, env: opts.env });
  }

  async function clone(entry, checkout) {
    const sourceUrl = validateSourceUrl(entry.sourceUrl, opts);
    const ref = validateRef(entry.ref);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-skill-update-'));
    const repository = path.join(temporary, 'repository');
    const baseArgs = ['clone', '--quiet', '--depth', '1', '--no-checkout'];
    if (ref) baseArgs.push('--branch', ref);
    const filteredArgs = baseArgs.concat(['--filter=blob:none', '--', sourceUrl, repository]);
    try {
      await git(filteredArgs);
      const revision = (await git(['rev-parse', 'HEAD'], repository)).stdout.trim();
      if (checkout) {
        await git(['checkout', '--quiet', 'HEAD', '--', skillFolderPath(entry.skillPath)], repository);
      }
      return { temporary, repository, revision };
    } catch (error) {
      removeTree(temporary);
      throw error;
    }
  }

  async function folderHash(repository, folder) {
    const revisionPath = folder === '.' ? 'HEAD^{tree}' : 'HEAD:' + folder;
    return (await git(['rev-parse', '--verify', revisionPath], repository)).stdout.trim();
  }

  return {
    resolve: async function resolve(entry) {
      const slug = String(entry.slug || '');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('skills.sh Skill slug is invalid');
      const cloned = await clone(entry, false);
      try {
        const standard = skillPathCandidates(slug);
        const bounded = await git([
          'ls-files', '-z', '--cached', '--with-tree=HEAD', '--',
          ':(glob)**/' + slug + '/SKILL.md',
          'SKILL.md',
        ], cloned.repository);
        const listedPaths = bounded.stdout.split('\0').filter(Boolean);
        const matches = new Set(listedPaths.filter(function exactSkillFile(file) {
          if (!file) return false;
          if (file === 'SKILL.md') return false;
          return path.posix.basename(file) === 'SKILL.md' && path.posix.basename(path.posix.dirname(file)) === slug;
        }).map(canonicalSkillPath));
        if (listedPaths.indexOf('SKILL.md') !== -1) {
          await git(['checkout', '--quiet', 'HEAD', '--', 'SKILL.md'], cloned.repository);
          const rootSkill = parseSkill(cloned.repository, '.');
          if (!rootSkill.parseErrors.length && rootSkill.declaredName === slug) {
            matches.add('SKILL.md');
            standard.push('SKILL.md');
          }
        }
        const exact = Array.from(matches).sort();
        if (!exact.length) throw new Error('skills.sh identity does not resolve to a repository path; provide an exact GitHub Skill path');
        if (exact.length > 1) throw new Error('skills.sh identity resolves to multiple repository paths; provide an exact GitHub Skill path');
        return {
          sourceUrl: validateSourceUrl(entry.sourceUrl, opts),
          skillPath: exact[0],
          revision: cloned.revision,
          resolution: standard.indexOf(exact[0]) !== -1 ? 'standard-path' : 'bounded-scan',
        };
      } finally {
        removeTree(cloned.temporary);
      }
    },
    inspect: async function inspect(entries) {
      if (!entries.length) return { revision: null, folderHashes: {} };
      const cloned = await clone(entries[0], false);
      try {
        const folderHashes = {};
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          const folder = skillFolderPath(entry.skillPath);
          folderHashes[entry.name] = await folderHash(cloned.repository, folder);
        }
        return { revision: cloned.revision, folderHashes };
      } finally {
        removeTree(cloned.temporary);
      }
    },
    materialize: async function materialize(entry) {
      const cloned = await clone(entry, true);
      try {
        const folder = skillFolderPath(entry.skillPath);
        const candidate = path.resolve(cloned.repository, folder.split('/').join(path.sep));
        const repositoryReal = fs.realpathSync(cloned.repository);
        const candidateReal = fs.realpathSync(candidate);
        const relative = path.relative(repositoryReal, candidateReal);
        if (relative === '..' || relative.indexOf('..' + path.sep) === 0 || path.isAbsolute(relative)) {
          throw new Error('candidate Skill resolves outside the source repository');
        }
        if (!fs.existsSync(path.join(candidateReal, 'SKILL.md'))) throw new Error('candidate source has no SKILL.md');
        return {
          path: candidateReal,
          revision: cloned.revision,
          folderHash: await folderHash(cloned.repository, folder),
          cleanup: function cleanup() { removeTree(cloned.temporary); },
        };
      } catch (error) {
        removeTree(cloned.temporary);
        throw error;
      }
    },
  };
}

function eligibleLockEntry(entry) {
  return Boolean(entry && entry.sourceType === 'github' && entry.sourceUrl && entry.skillPath && /^[a-f0-9]{40}$/i.test(String(entry.skillFolderHash || '')));
}

function updateSummary(skills) {
  const summary = {
    total: skills.length,
    eligible: 0,
    checkable: 0,
    up_to_date: 0,
    update_available: 0,
    source_unavailable: 0,
    baseline_missing: 0,
    repository_linked: 0,
    unmanaged: 0,
    missing: 0,
  };
  skills.forEach(function count(skill) {
    const key = skill.status.replace(/-/g, '_');
    if (Object.prototype.hasOwnProperty.call(summary, key)) summary[key] += 1;
  });
  summary.eligible = summary.checkable + summary.up_to_date + summary.update_available + summary.source_unavailable;
  return summary;
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function sourceInsights(result, options) {
  const opts = options || {};
  const skills = Array.isArray(result) ? result : (result && result.skills) || [];
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('source insight evaluation time is invalid');
  const staleDays = Number(opts.staleDays === undefined ? DEFAULT_STALE_DAYS : opts.staleDays);
  if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 3650) throw new Error('staleDays must be an integer between 1 and 3650');
  const total = skills.length;
  const tracked = skills.filter(function trackedSource(skill) { return skill.ownership === 'installer-lock' || skill.ownership === 'git-link'; }).length;
  const updateReady = skills.filter(function ready(skill) {
    return ['checkable', 'up-to-date', 'update-available'].indexOf(skill.status) !== -1;
  }).length;
  const stale = [];
  let undated = 0;
  const repositoryCounts = new Map();
  skills.filter(function installed(skill) { return skill.ownership === 'installer-lock'; }).forEach(function inspect(skill) {
    const source = String(skill.source || skill.source_url || 'unknown');
    repositoryCounts.set(source, (repositoryCounts.get(source) || 0) + 1);
    const value = skill.updated_at || skill.installed_at;
    if (!value) {
      undated += 1;
      return;
    }
    const selected = new Date(value);
    if (Number.isNaN(selected.getTime())) {
      undated += 1;
      return;
    }
    const ageDays = Math.max(0, Math.floor((now.getTime() - selected.getTime()) / (24 * 60 * 60 * 1000)));
    if (ageDays >= staleDays) stale.push({
      name: skill.name,
      source,
      age_days: ageDays,
      last_updated_at: selected.toISOString(),
      status: skill.status,
    });
  });
  stale.sort(function oldest(a, b) { return b.age_days - a.age_days || a.name.localeCompare(b.name); });
  const repositories = Array.from(repositoryCounts.entries()).map(function record(entry) {
    return { source: entry[0], count: entry[1] };
  }).sort(function largest(a, b) { return b.count - a.count || a.source.localeCompare(b.source); });
  const counts = {
    total,
    tracked,
    update_ready: updateReady,
    unlinked: skills.filter(function unlinked(skill) { return skill.status === 'unmanaged'; }).length,
    baseline_missing: skills.filter(function baseline(skill) { return skill.status === 'baseline-missing'; }).length,
    source_unavailable: skills.filter(function unavailable(skill) { return skill.status === 'source-unavailable'; }).length,
    local_missing: skills.filter(function missing(skill) { return skill.status === 'missing'; }).length,
    repository_linked: skills.filter(function linked(skill) { return skill.status === 'repository-linked'; }).length,
    stale: stale.length,
    undated,
  };
  return {
    evaluated_at: now.toISOString(),
    stale_after_days: staleDays,
    counts,
    coverage_percent: percentage(tracked, total),
    update_ready_percent: percentage(updateReady, total),
    anomalies: counts.source_unavailable + counts.local_missing,
    stale_skills: stale.slice(0, 50),
    repositories: repositories.slice(0, 50),
  };
}

function classifyUserSkillUpdates(settings) {
  const library = discoverLibrary(settings);
  const lock = readAgentsLock(settings.agentsLock);
  const libraryNames = new Set(library.map(function name(skill) { return skill.directoryName; }));
  const skills = library.map(function classify(skill) {
    const entry = lock.entries[skill.directoryName] || null;
    const linked = fs.lstatSync(skill.path).isSymbolicLink();
    let ownership;
    let status;
    if (linked) {
      ownership = 'git-link';
      status = 'repository-linked';
    } else if (entry) {
      ownership = 'installer-lock';
      status = eligibleLockEntry(entry) ? 'checkable' : 'baseline-missing';
    } else {
      ownership = 'manual';
      status = 'unmanaged';
    }
    return {
      name: skill.directoryName,
      path: skill.path,
      ownership,
      status,
      source: entry ? String(entry.source || '') : '',
      source_type: entry ? String(entry.sourceType || '') : '',
      source_url: entry ? String(entry.sourceUrl || '') : '',
      skill_path: entry ? String(entry.skillPath || '') : '',
      ref: entry && entry.ref ? String(entry.ref) : null,
      installed_hash: entry ? String(entry.skillFolderHash || '') : '',
      baseline_reason: entry && !eligibleLockEntry(entry)
        ? (!entry.skillFolderHash ? 'missing-folder-hash' : String(entry.skillFolderHash).length === 64
          ? 'content-hash-not-remotely-comparable' : 'unsupported-folder-hash') : null,
      installed_at: entry ? entry.installedAt || null : null,
      updated_at: entry ? entry.updatedAt || null : null,
    };
  });
  Object.keys(lock.entries).sort().forEach(function missing(name) {
    if (libraryNames.has(name)) return;
    const entry = lock.entries[name];
    skills.push({
      name,
      path: path.join(settings.libraryRoot, name),
      ownership: 'installer-lock',
      status: 'missing',
      source: String(entry.source || ''),
      source_type: String(entry.sourceType || ''),
      source_url: String(entry.sourceUrl || ''),
      skill_path: String(entry.skillPath || ''),
      ref: entry.ref ? String(entry.ref) : null,
      installed_hash: String(entry.skillFolderHash || ''),
      baseline_reason: !entry.skillFolderHash ? 'missing-folder-hash' : String(entry.skillFolderHash).length === 64
        ? 'content-hash-not-remotely-comparable' : 'unsupported-folder-hash',
      installed_at: entry.installedAt || null,
      updated_at: entry.updatedAt || null,
    });
  });
  skills.sort(function byName(a, b) { return a.name.localeCompare(b.name); });
  return { skills, diagnostics: lock.issues, summary: updateSummary(skills) };
}

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await callback(items[index], index);
    }
  }
  const workers = [];
  const count = Math.min(Math.max(1, limit), items.length);
  for (let index = 0; index < count; index += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function checkUserSkillUpdates(settings, options) {
  const opts = options || {};
  const sourceClient = opts.sourceClient || createGitSourceClient(opts);
  const onlyName = opts.name ? String(opts.name).trim() : null;
  const classified = classifyUserSkillUpdates(settings);
  const groups = new Map();
  classified.skills.filter(function checkable(skill) {
    return skill.status === 'checkable' && (!onlyName || skill.name === onlyName);
  }).forEach(function group(skill) {
    const key = sourceKey({ sourceUrl: skill.source_url, ref: skill.ref });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      name: skill.name,
      sourceUrl: skill.source_url,
      skillPath: skill.skill_path,
      ref: skill.ref,
    });
  });
  const byName = new Map(classified.skills.map(function pair(skill) { return [skill.name, skill]; }));
  await mapLimit(Array.from(groups.values()), opts.concurrency || DEFAULT_CHECK_CONCURRENCY, async function inspect(entries) {
    try {
      const remote = await sourceClient.inspect(entries);
      entries.forEach(function update(entry) {
        const skill = byName.get(entry.name);
        const latest = String(remote.folderHashes[entry.name] || '');
        if (!latest) {
          skill.status = 'source-unavailable';
          skill.error = 'Skill folder was not found in the latest source revision.';
          return;
        }
        skill.latest_hash = latest;
        skill.latest_revision = remote.revision || null;
        skill.status = latest === skill.installed_hash ? 'up-to-date' : 'update-available';
      });
    } catch (error) {
      entries.forEach(function unavailable(entry) {
        const skill = byName.get(entry.name);
        skill.status = 'source-unavailable';
        skill.error = error.message;
      });
    }
  });
  const skills = Array.from(byName.values()).sort(function byNameValue(a, b) { return a.name.localeCompare(b.name); });
  return {
    checked_at: new Date().toISOString(),
    skills,
    summary: updateSummary(skills),
    diagnostics: classified.diagnostics,
  };
}

function portableSkillState(skillPath, name) {
  const parsed = parseSkill(skillPath, name);
  if (parsed.parseErrors.length) throw new Error(parsed.parseErrors.join('; '));
  if (parsed.declaredName !== name) throw new Error('candidate declares name ' + parsed.declaredName + ' instead of ' + name);
  if (!parsed.description) throw new Error('candidate Skill has no description');
  const content = listPortableSkillContent({ path: skillPath, relativePath: name });
  return {
    path: skillPath,
    name,
    parsed,
    files: content.files,
    omitted: content.omitted,
    content_sha256: contentDigest(content.files),
  };
}

function diffSkillStates(current, candidate) {
  const before = new Map(current.files.map(function pair(file) { return [file.path, file]; }));
  const after = new Map(candidate.files.map(function pair(file) { return [file.path, file]; }));
  const added = [];
  const changed = [];
  const deleted = [];
  after.forEach(function compare(file, filePath) {
    const previous = before.get(filePath);
    if (!previous) {
      added.push({ path: filePath, size: file.size, executable: Boolean(file.mode & 0o111) });
    } else if (previous.sha256 !== file.sha256 || previous.mode !== file.mode) {
      changed.push({
        path: filePath,
        before_size: previous.size,
        after_size: file.size,
        before_sha256: previous.sha256,
        after_sha256: file.sha256,
        executable: Boolean(file.mode & 0o111),
        mode_changed: previous.mode !== file.mode,
      });
    }
  });
  before.forEach(function removed(file, filePath) {
    if (!after.has(filePath)) deleted.push({ path: filePath, size: file.size, executable: Boolean(file.mode & 0o111) });
  });
  function byPath(a, b) { return a.path.localeCompare(b.path); }
  added.sort(byPath);
  changed.sort(byPath);
  deleted.sort(byPath);
  return {
    added,
    changed,
    deleted,
    action_count: added.length + changed.length + deleted.length,
    executable_changes: added.concat(changed, deleted).filter(function executable(item) { return item.executable; }).map(function itemPath(item) { return item.path; }),
  };
}

function candidatePlan(current, candidate) {
  const diff = diffSkillStates(current, candidate);
  const preservedLocalEntries = current.omitted.filter(function preserved(item) {
    const components = item.path.split('/');
    return item.reason === 'symlink' || path.posix.basename(item.path) === '.env' || components.indexOf('.local') !== -1;
  });
  const preservedPaths = new Set(preservedLocalEntries.map(function itemPath(item) { return item.path; }));
  const discardedLocalEntries = current.omitted.filter(function discarded(item) { return !preservedPaths.has(item.path); });
  return {
    current_content_sha256: current.content_sha256,
    candidate_content_sha256: candidate.content_sha256,
    diff,
    replace_content: diff.action_count > 0,
    preserved_local_entries: preservedLocalEntries,
    preserved_local_sha256: preservedLocalDigest(current.path, preservedLocalEntries),
    discarded_local_entries: discardedLocalEntries,
    discarded_local_sha256: preservedLocalDigest(current.path, discardedLocalEntries),
  };
}

function lockPayload(settings) {
  const content = fs.readFileSync(settings.agentsLock);
  const payload = JSON.parse(content.toString('utf8'));
  if (!payload || payload.version !== 3 || !payload.skills || typeof payload.skills !== 'object') {
    throw new Error('Agents installer lock is not a supported v3 lock file');
  }
  return { content, payload, hash: sha256(content) };
}

function entryDigest(entry) {
  return sha256(Buffer.from(JSON.stringify(entry === undefined ? null : entry), 'utf8'));
}

function verifyWrittenLockEntry(settings, plan) {
  const written = lockPayload(settings);
  const entry = written.payload.skills[plan.name];
  const matches = entry && entry.sourceType === 'github' &&
    String(entry.sourceUrl || '') === String(plan.source_url || '') &&
    String(entry.skillPath || '') === String(plan.skill_path || '') &&
    (entry.ref || null) === (plan.ref || null) &&
    String(entry.skillFolderHash || '') === String(plan.latest_hash || '') &&
    Boolean(entry.installedAt) && Boolean(entry.updatedAt);
  if (!matches || !eligibleLockEntry(entry)) throw new Error('written installer lock failed readback verification');
  return written;
}

async function buildSkillUpdatePreview(settings, input, options) {
  const request = input || {};
  const opts = options || {};
  const sourceClient = opts.sourceClient || createGitSourceClient(opts);
  const classified = classifyUserSkillUpdates(settings);
  const skill = classified.skills.find(function matching(item) { return item.name === request.name; });
  if (!skill || skill.status === 'missing') throw new Error('unknown installed user Skill: ' + request.name);
  if (skill.status !== 'checkable') {
    throw new Error('Skill is not eligible for managed updates: ' + skill.name);
  }
  const latestFolderHash = String(request.latest_hash || '');
  if (!latestFolderHash) throw new Error('run a fresh update check before previewing an update');
  const lock = lockPayload(settings);
  const lockEntry = lock.payload.skills[skill.name];
  if (!lockEntry) throw new Error('Skill update lock entry disappeared: ' + skill.name);
  const current = portableSkillState(skill.path, skill.name);
  const materialized = await sourceClient.materialize({
    name: skill.name,
    sourceUrl: skill.source_url,
    skillPath: skill.skill_path,
    ref: skill.ref,
  });
  try {
    if (String(materialized.folderHash) !== latestFolderHash) throw new Error('upstream changed after the update check; check again');
    const candidate = portableSkillState(materialized.path, skill.name);
    return Object.assign({
      operation: 'update',
      name: skill.name,
      path: skill.path,
      source: skill.source,
      source_url: skill.source_url,
      skill_path: skill.skill_path,
      ref: skill.ref,
      installed_hash: skill.installed_hash,
      latest_hash: latestFolderHash,
      latest_revision: materialized.revision || request.latest_revision || null,
      lock_hash: lock.hash,
      lock_entry_hash: entryDigest(lockEntry),
      next_lock_entry: null,
    }, candidatePlan(current, candidate));
  } finally {
    materialized.cleanup();
  }
}

async function buildSkillSourcePreview(settings, input, options) {
  const request = input || {};
  const opts = options || {};
  const sourceClient = opts.sourceClient || createGitSourceClient(opts);
  const name = String(request.name || '').trim();
  const classified = classifyUserSkillUpdates(settings);
  const skill = classified.skills.find(function matching(item) { return item.name === name; });
  if (!skill || skill.status === 'missing') throw new Error('unknown installed user Skill: ' + name);
  if (skill.status !== 'unmanaged' && skill.status !== 'baseline-missing') {
    throw new Error('Skill does not need an update source or baseline: ' + skill.name);
  }
  const lock = lockPayload(settings);
  const previousEntry = lock.payload.skills[skill.name] || null;
  const rebuilding = skill.status === 'baseline-missing';
  if (rebuilding && (!previousEntry || previousEntry.sourceType !== 'github')) {
    throw new Error('existing Skill source is not a supported GitHub installer entry');
  }
  let catalog = null;
  let sourceUrl;
  let skillPath;
  const ref = validateRef(rebuilding ? previousEntry.ref : request.ref);
  if (!rebuilding && (request.skills_url || request.skillsUrl)) {
    if (request.source_url || request.sourceUrl || request.skill_path || request.skillPath) {
      throw new Error('choose either a skills.sh Skill URL or an exact GitHub source and path');
    }
    catalog = parseSkillsShUrl(request.skills_url || request.skillsUrl);
    if (!sourceClient.resolve) throw new Error('update source client cannot resolve skills.sh identities');
    const resolved = await sourceClient.resolve({ sourceUrl: catalog.source_url, slug: catalog.slug, ref });
    sourceUrl = validateSourceUrl(resolved.sourceUrl, opts);
    if (sourceUrl !== validateSourceUrl(catalog.source_url, opts)) throw new Error('skills.sh identity resolved to a different GitHub repository');
    skillPath = canonicalSkillPath(resolved.skillPath);
  } else {
    sourceUrl = validateSourceUrl(rebuilding ? previousEntry.sourceUrl : (request.source_url || request.sourceUrl), opts);
    skillPath = canonicalSkillPath(rebuilding ? previousEntry.skillPath : (request.skill_path || request.skillPath));
  }
  const source = rebuilding ? String(previousEntry.source || sourceName(sourceUrl)) : String(request.source || (catalog ? catalog.source : sourceName(sourceUrl)));
  const current = portableSkillState(skill.path, skill.name);
  const materialized = await sourceClient.materialize({
    name: skill.name,
    sourceUrl,
    skillPath,
    ref,
  });
  try {
    const latestHash = String(materialized.folderHash || '');
    if (!/^[a-f0-9]{40}$/i.test(latestHash)) throw new Error('update source did not produce a standard 40-character Git tree SHA');
    const candidate = portableSkillState(materialized.path, skill.name);
    const nextLockEntry = Object.assign(standardLockEntry(previousEntry), {
      source,
      sourceType: 'github',
      sourceUrl,
      skillPath,
      ref,
    });
    delete nextLockEntry.skillFolderHash;
    delete nextLockEntry.updatedAt;
    if (!nextLockEntry.installedAt) delete nextLockEntry.installedAt;
    return Object.assign({
      operation: rebuilding ? 'rebuild-baseline' : 'link-source',
      name: skill.name,
      path: skill.path,
      source,
      source_id: catalog ? catalog.source_id : null,
      skills_url: catalog ? catalog.skills_url : null,
      source_url: sourceUrl,
      skill_path: skillPath,
      ref,
      installed_hash: previousEntry ? String(previousEntry.skillFolderHash || '') : '',
      latest_hash: latestHash,
      latest_revision: materialized.revision || null,
      lock_hash: lock.hash,
      lock_entry_hash: entryDigest(previousEntry),
      next_lock_entry: nextLockEntry,
    }, candidatePlan(current, candidate));
  } finally {
    materialized.cleanup();
  }
}

function updatePlanDigest(plan) {
  return sha256(Buffer.from(JSON.stringify({
    operation: plan.operation,
    name: plan.name,
    source_id: plan.source_id,
    skills_url: plan.skills_url,
    source_url: plan.source_url,
    skill_path: plan.skill_path,
    ref: plan.ref,
    latest_hash: plan.latest_hash,
    current_content_sha256: plan.current_content_sha256,
    candidate_content_sha256: plan.candidate_content_sha256,
    lock_hash: plan.lock_hash,
    lock_entry_hash: plan.lock_entry_hash,
    next_lock_entry: plan.next_lock_entry,
    replace_content: plan.replace_content,
    preserved_local_sha256: plan.preserved_local_sha256,
    discarded_local_entries: plan.discarded_local_entries,
    discarded_local_sha256: plan.discarded_local_sha256,
    diff: plan.diff,
  }), 'utf8'));
}

function writePortableSkill(destination, state) {
  fs.mkdirSync(destination, { mode: 0o755 });
  try {
    state.files.forEach(function write(file) {
      const output = path.join.apply(path, [destination].concat(file.path.split('/')));
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o755 });
      fs.writeFileSync(output, Buffer.from(file.content_base64, 'base64'), { flag: 'wx', mode: file.mode });
      fs.chmodSync(output, file.mode);
    });
  } catch (error) {
    removeTree(destination);
    throw error;
  }
}

function preserveLocalEntries(source, destination, omitted) {
  omitted.forEach(function preserve(item) {
    const selected = item.path;
    const components = selected.split('/');
    const shouldPreserve = item.reason === 'symlink' || path.posix.basename(selected) === '.env' || components.indexOf('.local') !== -1;
    if (!shouldPreserve) return;
    const sourcePath = path.join.apply(path, [source].concat(selected.split('/')));
    const destinationPath = path.join.apply(path, [destination].concat(selected.split('/')));
    if (!lexists(sourcePath) || lexists(destinationPath)) return;
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o755 });
    copyRawTree(sourcePath, destinationPath);
  });
}

function rawEntryRecords(root, relativePath, records) {
  const selected = path.join.apply(path, [root].concat(relativePath.split('/')));
  if (!lexists(selected)) {
    records.push({ path: relativePath, type: 'missing' });
    return;
  }
  const stat = fs.lstatSync(selected);
  if (stat.isSymbolicLink()) {
    records.push({ path: relativePath, type: 'symlink', target: fs.readlinkSync(selected) });
    return;
  }
  if (stat.isDirectory()) {
    records.push({ path: relativePath, type: 'directory', mode: stat.mode & 0o777 });
    fs.readdirSync(selected).sort().forEach(function child(name) {
      rawEntryRecords(root, relativePath + '/' + name, records);
    });
    return;
  }
  if (stat.isFile()) {
    records.push({ path: relativePath, type: 'file', mode: stat.mode & 0o777, sha256: sha256(fs.readFileSync(selected)) });
    return;
  }
  records.push({ path: relativePath, type: 'unsupported' });
}

function preservedLocalDigest(root, omitted) {
  const records = [];
  omitted.slice().sort(function byPath(a, b) { return a.path.localeCompare(b.path); }).forEach(function record(item) {
    rawEntryRecords(root, item.path, records);
  });
  return sha256(Buffer.from(JSON.stringify(records), 'utf8'));
}

function updateTransactionRoot(settings) {
  return path.join(settings.stateDir, 'updates');
}

function writeUpdateTransaction(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

function applyUpdateTransaction(settings, plan, candidate) {
  const id = timestampId();
  const transactionDir = path.join(updateTransactionRoot(settings), id);
  const transactionFile = path.join(transactionDir, 'transaction.json');
  const backupPath = path.join(transactionDir, 'original-skill');
  const lockBackup = path.join(transactionDir, 'skill-lock.before.json');
  const stage = path.join(settings.libraryRoot, '.' + plan.name + '.ash-update-' + process.pid + '-' + id.slice(-6));
  const lock = lockPayload(settings);
  const previousLockEntry = lock.payload.skills[plan.name] || null;
  if (lock.hash !== plan.lock_hash || entryDigest(previousLockEntry) !== plan.lock_entry_hash) {
    throw new Error('Agents installer lock changed after preview');
  }
  const current = portableSkillState(plan.path, plan.name);
  if (current.content_sha256 !== plan.current_content_sha256) throw new Error('user Skill changed after preview');
  if (preservedLocalDigest(plan.path, plan.preserved_local_entries) !== plan.preserved_local_sha256) {
    throw new Error('preserved local Skill content changed after preview');
  }
  if (preservedLocalDigest(plan.path, plan.discarded_local_entries) !== plan.discarded_local_sha256) {
    throw new Error('discarded local-only Skill content changed after preview');
  }
  if (candidate.content_sha256 !== plan.candidate_content_sha256) throw new Error('candidate Skill changed after preview');
  fs.mkdirSync(updateTransactionRoot(settings), { recursive: true, mode: 0o700 });
  fs.mkdirSync(transactionDir, { mode: 0o700 });
  fs.writeFileSync(lockBackup, lock.content, { mode: 0o600 });
  const payload = {
    version: UPDATE_TRANSACTION_VERSION,
    id,
    status: 'prepared',
    created_at: new Date().toISOString(),
    name: plan.name,
    path: plan.path,
    source: plan.source,
    source_id: plan.source_id || null,
    skills_url: plan.skills_url || null,
    source_url: plan.source_url,
    skill_path: plan.skill_path,
    ref: plan.ref,
    operation: plan.operation || 'update',
    installed_hash: plan.installed_hash,
    latest_hash: plan.latest_hash,
    latest_revision: plan.latest_revision,
    before_content_sha256: plan.current_content_sha256,
    after_content_sha256: plan.candidate_content_sha256,
    preserved_local_sha256: plan.preserved_local_sha256,
    preserved_local_entries: plan.preserved_local_entries,
    discarded_local_sha256: plan.discarded_local_sha256,
    discarded_local_entries: plan.discarded_local_entries,
    before_lock_sha256: lock.hash,
    after_lock_sha256: null,
    previous_lock_entry_exists: Boolean(previousLockEntry),
    content_replaced: Boolean(plan.replace_content),
    backup_path: backupPath,
    lock_backup: lockBackup,
    diff: plan.diff,
  };
  writeUpdateTransaction(transactionFile, payload);
  let originalMoved = false;
  let replacementInstalled = false;
  try {
    if (plan.replace_content) {
      if (lexists(stage)) throw new Error('update staging directory already exists: ' + stage);
      writePortableSkill(stage, candidate);
      preserveLocalEntries(plan.path, stage, current.omitted);
      if (portableSkillState(stage, plan.name).content_sha256 !== plan.candidate_content_sha256) {
        throw new Error('staged candidate failed content verification');
      }
      moveTree(plan.path, backupPath);
      originalMoved = true;
      fs.renameSync(stage, plan.path);
      replacementInstalled = true;
    } else if (plan.current_content_sha256 !== plan.candidate_content_sha256) {
      throw new Error('source baseline requires a content replacement that was not previewed');
    }
    const nextLock = lock.payload;
    const nextEntry = standardLockEntry(plan.next_lock_entry || previousLockEntry);
    if (!Object.keys(nextEntry).length) throw new Error('Skill update has no source entry to write');
    const updatedAt = new Date().toISOString();
    nextLock.skills[plan.name] = Object.assign(nextEntry, {
      skillFolderHash: plan.latest_hash,
      installedAt: nextEntry.installedAt || updatedAt,
      updatedAt,
    });
    atomicWrite(settings.agentsLock, JSON.stringify(nextLock, null, 2) + '\n');
    payload.after_lock_sha256 = verifyWrittenLockEntry(settings, plan).hash;
    payload.status = 'completed';
    payload.completed_at = new Date().toISOString();
    writeUpdateTransaction(transactionFile, payload);
    return transactionFile;
  } catch (error) {
    let rollbackError = null;
    try {
      if (replacementInstalled && lexists(plan.path)) removeTree(plan.path);
      if (originalMoved && lexists(backupPath)) moveTree(backupPath, plan.path);
      atomicWrite(settings.agentsLock, fs.readFileSync(lockBackup));
      if (lexists(stage)) removeTree(stage);
    } catch (caught) {
      rollbackError = caught;
    }
    payload.status = 'failed';
    payload.error = error.message;
    if (rollbackError) payload.rollback_error = rollbackError.message;
    writeUpdateTransaction(transactionFile, payload);
    if (rollbackError) throw new Error('update failed: ' + error.message + '; rollback failed: ' + rollbackError.message);
    throw error;
  }
}

async function applySkillUpdate(settings, plan, options) {
  const opts = options || {};
  const sourceClient = opts.sourceClient || createGitSourceClient(opts);
  const freshPlan = await buildSkillUpdatePreview(settings, {
    name: plan.name,
    latest_hash: plan.latest_hash,
    latest_revision: plan.latest_revision,
  }, { sourceClient });
  if (updatePlanDigest(freshPlan) !== updatePlanDigest(plan)) throw new Error('update preview is stale');
  const materialized = await sourceClient.materialize({
    name: plan.name,
    sourceUrl: plan.source_url,
    skillPath: plan.skill_path,
    ref: plan.ref,
  });
  try {
    if (String(materialized.folderHash) !== plan.latest_hash) throw new Error('upstream changed after preview');
    const candidate = portableSkillState(materialized.path, plan.name);
    if (candidate.content_sha256 !== plan.candidate_content_sha256) throw new Error('candidate changed after preview');
    return applyUpdateTransaction(settings, plan, candidate);
  } finally {
    materialized.cleanup();
  }
}

async function applySkillSource(settings, plan, options) {
  const opts = options || {};
  const sourceClient = opts.sourceClient || createGitSourceClient(opts);
  const freshPlan = await buildSkillSourcePreview(settings, {
    name: plan.name,
    source: plan.source,
    skills_url: plan.skills_url,
    source_url: plan.skills_url ? null : plan.source_url,
    skill_path: plan.skills_url ? null : plan.skill_path,
    ref: plan.ref,
  }, Object.assign({}, opts, { sourceClient }));
  if (updatePlanDigest(freshPlan) !== updatePlanDigest(plan)) throw new Error('source preview is stale');
  const materialized = await sourceClient.materialize({
    name: plan.name,
    sourceUrl: plan.source_url,
    skillPath: plan.skill_path,
    ref: plan.ref,
  });
  try {
    if (String(materialized.folderHash) !== plan.latest_hash) throw new Error('upstream changed after preview');
    const candidate = portableSkillState(materialized.path, plan.name);
    if (candidate.content_sha256 !== plan.candidate_content_sha256) throw new Error('candidate changed after preview');
    return applyUpdateTransaction(settings, plan, candidate);
  } finally {
    materialized.cleanup();
  }
}

function loadUpdateTransaction(settings, selector) {
  const root = updateTransactionRoot(settings);
  if (selector === 'latest') {
    if (!isDirectory(root)) throw new Error('no completed Skill update transaction is available');
    const candidates = fs.readdirSync(root).sort().reverse();
    for (let index = 0; index < candidates.length; index += 1) {
      const transactionFile = path.join(root, candidates[index], 'transaction.json');
      if (!fs.existsSync(transactionFile)) continue;
      const payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
      if (payload.version === UPDATE_TRANSACTION_VERSION && payload.status === 'completed') return { transactionFile, payload };
    }
    throw new Error('no completed Skill update transaction is available');
  }
  const transactionFile = path.join(root, selector, 'transaction.json');
  if (!fs.existsSync(transactionFile)) throw new Error('Skill update transaction not found: ' + selector);
  const payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
  if (payload.version !== UPDATE_TRANSACTION_VERSION) throw new Error('unsupported Skill update transaction: ' + selector);
  return { transactionFile, payload };
}

function transactionReplacedContent(payload) {
  if (typeof payload.content_replaced === 'boolean') return payload.content_replaced;
  return Boolean(payload.diff && payload.diff.action_count > 0);
}

function previewSkillUpdateRollback(settings, selector) {
  const transaction = loadUpdateTransaction(settings, selector || 'latest');
  const payload = transaction.payload;
  if (payload.status !== 'completed') throw new Error('Skill update transaction is not completed: ' + payload.status);
  if (!lexists(payload.path) || portableSkillState(payload.path, payload.name).content_sha256 !== payload.after_content_sha256) {
    throw new Error('updated Skill changed after the update; refusing rollback');
  }
  if (preservedLocalDigest(payload.path, payload.preserved_local_entries || []) !== payload.preserved_local_sha256) {
    throw new Error('preserved local Skill content changed after the update; refusing rollback');
  }
  if (sha256(fs.readFileSync(settings.agentsLock)) !== payload.after_lock_sha256) {
    throw new Error('Agents installer lock changed after the update; refusing rollback');
  }
  if (transactionReplacedContent(payload) && !isDirectory(payload.backup_path)) throw new Error('Skill update backup is missing');
  let description = 'RESTORE SKILL ' + payload.name + ' TO ' + payload.installed_hash;
  if (payload.operation === 'link-source' && !payload.previous_lock_entry_exists) {
    description = 'RESTORE SKILL ' + payload.name + ' AND REMOVE ITS UPDATE SOURCE';
  } else if (payload.operation === 'rebuild-baseline') {
    description = 'RESTORE SKILL ' + payload.name + ' AND ITS PREVIOUS UPDATE BASELINE';
  }
  return {
    transactionFile: transaction.transactionFile,
    transaction_id: payload.id,
    name: payload.name,
    path: payload.path,
    description,
  };
}

function applySkillUpdateRollback(settings, selector) {
  const preview = previewSkillUpdateRollback(settings, selector || 'latest');
  const transaction = loadUpdateTransaction(settings, preview.transaction_id);
  const payload = transaction.payload;
  const updatedBackup = path.join(path.dirname(transaction.transactionFile), 'updated-skill');
  const contentReplaced = transactionReplacedContent(payload);
  if (contentReplaced && lexists(updatedBackup)) throw new Error('updated Skill rollback backup already exists');
  let currentMoved = false;
  let originalRestored = false;
  try {
    if (contentReplaced) {
      moveTree(payload.path, updatedBackup);
      currentMoved = true;
      moveTree(payload.backup_path, payload.path);
      originalRestored = true;
    }
    atomicWrite(settings.agentsLock, fs.readFileSync(payload.lock_backup));
    payload.status = 'rolled_back';
    payload.rolled_back_at = new Date().toISOString();
    payload.updated_backup_path = updatedBackup;
    writeUpdateTransaction(transaction.transactionFile, payload);
    return transaction.transactionFile;
  } catch (error) {
    if (currentMoved) {
      if (originalRestored && lexists(payload.path) && !lexists(payload.backup_path)) moveTree(payload.path, payload.backup_path);
      if (!lexists(payload.path) && lexists(updatedBackup)) moveTree(updatedBackup, payload.path);
    }
    throw error;
  }
}

function latestSkillUpdateRollback(settings) {
  try {
    return Object.assign({ available: true }, previewSkillUpdateRollback(settings, 'latest'));
  } catch (error) {
    return { available: false, transaction_id: null, name: null, description: null };
  }
}

module.exports = {
  DEFAULT_STALE_DAYS,
  DEFAULT_CHECK_CONCURRENCY,
  UPDATE_TRANSACTION_VERSION,
  applySkillSource,
  applySkillUpdate,
  applySkillUpdateRollback,
  buildSkillSourcePreview,
  buildSkillUpdatePreview,
  canonicalSkillPath,
  checkUserSkillUpdates,
  classifyUserSkillUpdates,
  createGitSourceClient,
  diffSkillStates,
  eligibleLockEntry,
  latestSkillUpdateRollback,
  loadUpdateTransaction,
  parseSkillsShUrl,
  portableSkillState,
  preservedLocalDigest,
  previewSkillUpdateRollback,
  runCommand,
  skillPathCandidates,
  skillFolderPath,
  sourceInsights,
  updatePlanDigest,
  updateSummary,
};
