'use strict';

const fs = require('fs');
const path = require('path');

const { targetIncludes, targetIsActive } = require('./config');
const {
  IGNORED_DIRECTORY_NAMES,
  canonicalPath,
  expandPath,
  isDirectory,
  lexists,
} = require('./util');

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER_KEY = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/;

function unquote(value) {
  const selected = String(value || '').trim();
  if (selected.length >= 2) {
    const first = selected.charAt(0);
    const last = selected.charAt(selected.length - 1);
    if (first === last && (first === '"' || first === "'")) return selected.slice(1, -1);
  }
  return selected;
}

function parseSkill(skillPath, relativePath) {
  const skillFile = path.join(skillPath, 'SKILL.md');
  const directoryName = path.basename(skillPath);
  let text;
  try {
    text = fs.readFileSync(skillFile, 'utf8');
  } catch (error) {
    return {
      directoryName,
      relativePath: relativePath || directoryName,
      path: skillPath,
      declaredName: '',
      description: '',
      frontmatterKeys: new Set(),
      lineCount: 0,
      parseErrors: ['cannot read SKILL.md: ' + error.message],
    };
  }

  const lines = text.split(/\r?\n/);
  const errors = [];
  const rawValues = {};
  const keys = new Set();
  if (lines.length === 0 || lines[0].trim() !== '---') {
    errors.push('SKILL.md must start with YAML frontmatter');
  } else {
    let endIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '---') {
        endIndex = index;
        break;
      }
    }
    if (endIndex === -1) {
      errors.push('YAML frontmatter is not closed with ---');
      endIndex = lines.length;
    }
    let index = 1;
    while (index < endIndex) {
      const match = FRONTMATTER_KEY.exec(lines[index]);
      if (!match) {
        index += 1;
        continue;
      }
      const key = match[1];
      const value = String(match[2] || '').trim();
      keys.add(key);
      if (/^[|>][+-]?$/.test(value)) {
        const block = [];
        index += 1;
        while (index < endIndex) {
          const line = lines[index];
          if (line && !/^\s/.test(line)) break;
          if (line.trim()) block.push(line.trim());
          index += 1;
        }
        rawValues[key] = block.join(' ').trim();
        continue;
      }
      rawValues[key] = unquote(value);
      index += 1;
    }
  }

  return {
    directoryName,
    relativePath: relativePath || directoryName,
    path: skillPath,
    declaredName: rawValues.name || '',
    description: rawValues.description || '',
    frontmatterKeys: keys,
    lineCount: lines.length,
    parseErrors: errors,
  };
}

function discoverLibrary(settings) {
  const root = settings.libraryRoot;
  if (!isDirectory(root)) return [];
  const discovered = [];

  function visit(current, relativeParts) {
    const relative = relativeParts.join('/');
    if (relativeParts.length > 0 && fs.existsSync(path.join(current, 'SKILL.md'))) {
      if (!settings.libraryExclude.has(relative) && !settings.libraryExclude.has(path.basename(current))) {
        discovered.push(parseSkill(current, relative));
      }
      return;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort(function byName(a, b) {
      return a.name.localeCompare(b.name);
    });
    entries.forEach(function inspect(entry) {
      if (entry.name.charAt(0) === '.' || IGNORED_DIRECTORY_NAMES.has(entry.name)) return;
      const candidate = path.join(current, entry.name);
      const candidateParts = relativeParts.concat(entry.name);
      if (entry.isSymbolicLink()) {
        const relativeCandidate = candidateParts.join('/');
        if (fs.existsSync(path.join(candidate, 'SKILL.md')) &&
            !settings.libraryExclude.has(relativeCandidate) &&
            !settings.libraryExclude.has(entry.name)) {
          discovered.push(parseSkill(candidate, relativeCandidate));
        }
        return;
      }
      if (!entry.isDirectory()) return;
      visit(candidate, candidateParts);
    });
  }

  visit(root, []);
  return discovered.sort(function sortSkills(a, b) {
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function linkStatus(linkPath, expectedTarget) {
  const expected = canonicalPath(expectedTarget);
  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { status: 'missing', current: '' };
    }
    throw error;
  }
  if (!stat.isSymbolicLink()) return { status: 'conflict', current: 'existing non-symlink' };
  const rawTarget = fs.readlinkSync(linkPath);
  const absoluteTarget = path.resolve(path.dirname(linkPath), rawTarget);
  if (canonicalPath(absoluteTarget) === expected) return { status: 'linked', current: rawTarget };
  if (!fs.existsSync(linkPath)) return { status: 'broken', current: rawTarget };
  return { status: 'conflict', current: rawTarget };
}

function libraryRecord(skill, settings) {
  const statuses = [];
  const details = [];
  settings.targets.forEach(function inspect(target) {
    if (!targetIsActive(target) || !targetIncludes(target, skill.directoryName)) return;
    const result = linkStatus(path.join(target.path, skill.directoryName), skill.path);
    statuses.push(result.status);
    let detail = target.name + '=' + result.status;
    if (result.current && result.status !== 'linked') detail += '(' + result.current + ')';
    details.push(detail);
  });
  let status = 'available';
  if (statuses.indexOf('conflict') !== -1) status = 'conflict';
  else if (statuses.indexOf('broken') !== -1) status = 'broken';
  else if (statuses.indexOf('missing') !== -1) status = 'missing';
  else if (statuses.length > 0) status = 'linked';
  return {
    name: skill.directoryName,
    declared_name: skill.declaredName,
    relative_path: skill.relativePath,
    source: 'agents-library',
    status,
    path: skill.path,
    detail: details.join(', '),
    managed: true,
  };
}

function issue(severity, code, message, paths) {
  return { severity, code, message, paths: paths || [] };
}

function readLock(lockPath, sourceName) {
  if (!lexists(lockPath)) {
    return {
      entries: {},
      issues: [issue('INFO', 'LOCK_NOT_FOUND', sourceName + ' lock file is not present', [lockPath])],
    };
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return {
      entries: {},
      issues: [issue('ERROR', 'LOCK_INVALID', 'cannot read ' + sourceName + ' lock file: ' + error.message, [lockPath])],
    };
  }
  if (!payload || typeof payload !== 'object' || !payload.skills || typeof payload.skills !== 'object' || Array.isArray(payload.skills)) {
    return {
      entries: {},
      issues: [issue('ERROR', 'LOCK_INVALID', sourceName + ' lock file has no skills object', [lockPath])],
    };
  }
  const entries = {};
  Object.keys(payload.skills).forEach(function clean(name) {
    const value = payload.skills[name];
    if (value && typeof value === 'object' && !Array.isArray(value)) entries[name] = value;
  });
  return { entries, issues: [] };
}

function agentsRoot(settings) {
  return path.join(path.dirname(settings.agentsLock), 'skills');
}

function recordNameFromDirectory(directory) {
  const parsed = parseSkill(directory, path.basename(directory));
  return parsed.declaredName || parsed.directoryName;
}

function discoverSystemRecords(settings) {
  const root = path.join(settings.codexRoot, '.system');
  if (!isDirectory(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(function valid(entry) {
    return entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md'));
  }).sort(function byName(a, b) {
    return a.name.localeCompare(b.name);
  }).map(function record(entry) {
    const directory = path.join(root, entry.name);
    return {
      name: recordNameFromDirectory(directory),
      source: 'codex-system',
      status: 'managed',
      path: directory,
      detail: '',
      managed: false,
    };
  });
}

function discoverUntrackedCodexRecords(settings, knownInstallPaths) {
  if (!isDirectory(settings.codexRoot)) return [];
  const candidates = [];
  fs.readdirSync(settings.codexRoot, { withFileTypes: true }).sort(function byName(a, b) {
    return a.name.localeCompare(b.name);
  }).forEach(function inspect(entry) {
    if (entry.name.charAt(0) === '.' || !entry.isDirectory()) return;
    const directory = path.join(settings.codexRoot, entry.name);
    if (fs.existsSync(path.join(directory, 'SKILL.md'))) {
      candidates.push(directory);
      return;
    }
    fs.readdirSync(directory, { withFileTypes: true }).sort(function byNestedName(a, b) {
      return a.name.localeCompare(b.name);
    }).forEach(function inspectNested(nested) {
      if (!nested.isDirectory()) return;
      const nestedDirectory = path.join(directory, nested.name);
      if (fs.existsSync(path.join(nestedDirectory, 'SKILL.md'))) candidates.push(nestedDirectory);
    });
  });
  return candidates.filter(function unknown(directory) {
    return !knownInstallPaths.has(canonicalPath(directory));
  }).map(function record(directory) {
    const parsed = parseSkill(directory, path.basename(directory));
    return {
      name: parsed.declaredName || parsed.directoryName,
      declared_name: parsed.declaredName,
      source: 'untracked-codex',
      status: 'untracked',
      path: directory,
      detail: '',
      managed: false,
    };
  });
}

function discoverPluginRecords(settings) {
  if (!isDirectory(settings.pluginCache)) return [];
  const records = [];
  function visit(current, insideSkills) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort(function byName(a, b) {
      return a.name.localeCompare(b.name);
    });
    const hasSkill = entries.some(function skillFile(entry) {
      return entry.isFile() && entry.name === 'SKILL.md';
    });
    if (hasSkill && insideSkills) {
      records.push({
        name: recordNameFromDirectory(current),
        source: 'codex-plugin',
        status: 'managed',
        path: current,
        detail: '',
        managed: false,
      });
      return;
    }
    entries.forEach(function inspect(entry) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return;
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) return;
      visit(path.join(current, entry.name), insideSkills || entry.name === 'skills');
    });
  }
  visit(settings.pluginCache, false);
  return records;
}

function buildInventory(settings) {
  const library = discoverLibrary(settings);
  const records = library.map(function makeRecord(skill) { return libraryRecord(skill, settings); });
  const diagnostics = [];
  const libraryNames = new Set(library.map(function name(skill) { return skill.directoryName; }));

  const agents = readLock(settings.agentsLock, 'agents');
  diagnostics.push.apply(diagnostics, agents.issues);
  const root = agentsRoot(settings);
  const agentsAreLibrary = canonicalPath(root) === canonicalPath(settings.libraryRoot);
  Object.keys(agents.entries).sort().forEach(function addThirdParty(name) {
    const metadata = agents.entries[name];
    const installPath = path.join(root, name);
    if (agentsAreLibrary && libraryNames.has(name)) return;
    records.push({
      name,
      source: 'third-party',
      status: fs.existsSync(path.join(installPath, 'SKILL.md')) ? 'installed' : 'missing',
      path: installPath,
      detail: String(metadata.source || 'third-party'),
      managed: false,
    });
  });

  const knownAgentNames = new Set(Array.from(libraryNames).concat(Object.keys(agents.entries)));
  if (isDirectory(root)) {
    fs.readdirSync(root, { withFileTypes: true }).sort(function byName(a, b) {
      return a.name.localeCompare(b.name);
    }).forEach(function addUntracked(entry) {
      if (entry.name.charAt(0) === '.' || knownAgentNames.has(entry.name)) return;
      const installPath = path.join(root, entry.name);
      if (entry.isSymbolicLink() && !fs.existsSync(installPath)) {
        records.push({
          name: entry.name,
          source: agentsAreLibrary ? 'agents-library' : 'untracked-agents',
          status: 'broken',
          path: installPath,
          detail: fs.readlinkSync(installPath),
          managed: agentsAreLibrary,
        });
      } else if (!agentsAreLibrary && fs.existsSync(path.join(installPath, 'SKILL.md'))) {
        records.push({
          name: entry.name,
          source: 'untracked-agents',
          status: 'untracked',
          path: installPath,
          detail: '',
          managed: false,
        });
      }
    });
  }

  const store = readLock(settings.codexStoreLock, 'codex-store');
  diagnostics.push.apply(diagnostics, store.issues);
  const storeInstallPaths = new Set();
  Object.keys(store.entries).sort().forEach(function addStore(name) {
    const metadata = store.entries[name];
    const rawInstall = typeof metadata.installDir === 'string' && metadata.installDir
      ? metadata.installDir
      : path.join(settings.codexRoot, name);
    const installPath = expandPath(rawInstall, {
      env: settings.env || process.env,
      homeDir: settings.homeDir,
      projectRoot: settings.projectRoot,
    });
    storeInstallPaths.add(canonicalPath(installPath));
    const installed = fs.existsSync(path.join(installPath, 'SKILL.md'));
    const parsed = installed ? parseSkill(installPath, path.basename(installPath)) : null;
    records.push({
      name: parsed && parsed.declaredName ? parsed.declaredName : name,
      declared_name: parsed ? parsed.declaredName : '',
      store_key: name,
      source: 'codex-store',
      status: installed ? 'installed' : 'missing',
      path: installPath,
      detail: String(metadata.version || ''),
      managed: false,
    });
  });

  records.push.apply(records, discoverSystemRecords(settings));
  records.push.apply(records, discoverUntrackedCodexRecords(settings, storeInstallPaths));
  records.push.apply(records, discoverPluginRecords(settings));
  records.sort(function sortRecords(a, b) {
    return a.name.localeCompare(b.name) || a.source.localeCompare(b.source) || a.path.localeCompare(b.path);
  });
  return { records, diagnostics, library };
}

module.exports = {
  NAME_PATTERN,
  agentsRoot,
  buildInventory,
  discoverLibrary,
  issue,
  libraryRecord,
  linkStatus,
  parseSkill,
  readLock,
};
