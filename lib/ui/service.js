'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const packageMetadata = require('../../package.json');
const { buildArchive } = require('../control-plane/archive');
const { createSkill, validateCreateInput } = require('../control-plane/create');
const { buildInventory, discoverTopLevelSkills, issue } = require('../control-plane/discovery');
const { metadataIssues, runDoctor } = require('../control-plane/doctor');
const { findLibrarySkill } = require('../control-plane/library');
const {
  actionDescription,
  applyRepair,
  applyRollback,
  buildRepairPlan,
  rollbackPreview,
} = require('../control-plane/repair');
const { applyRetentionPlan, buildRetentionPlan } = require('../control-plane/retention');
const { createSkillsShSearchClient } = require('../control-plane/skills-sh');
const {
  applySnapshotRestore,
  buildSnapshot,
  planSnapshotRestore,
  readSnapshot,
  snapshotSummary,
  verifySnapshot,
  writeSnapshot,
} = require('../control-plane/snapshot');
const {
  applySkillSource: applyManagedSkillSource,
  applySkillUpdate: applyManagedSkillUpdate,
  applySkillUpdateRollback: applyManagedSkillUpdateRollback,
  buildSkillSourcePreview,
  buildSkillUpdatePreview,
  checkUserSkillUpdates,
  classifyUserSkillUpdates,
  latestSkillUpdateRollback,
  parseSkillsShUrl,
  previewSkillUpdateRollback: previewManagedSkillUpdateRollback,
  sourceInsights,
  updatePlanDigest,
  updateSummary,
} = require('../control-plane/update');
const { atomicWrite, isDirectory, lexists, listSkillFiles, sha256, timestampId } = require('../control-plane/util');
const {
  addScanRoot,
  readPreferences,
  removeScanRoot,
  resolveScanRoot,
} = require('./preferences');
const {
  accessPresentation,
  issuesForSkill,
  ownershipLabel,
  presentUpdateStatus,
  summarizeHealth,
} = require('./status');

const DEFAULT_PLAN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SKILLS_SH_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SKILLS_SH_EMPTY_TTL_MS = 60 * 1000;
const DEFAULT_SKILLS_SH_STALE_TTL_MS = 60 * 60 * 1000;
const MAX_SKILLS_SH_CACHE_ENTRIES = 64;
const MANAGED_LIBRARY_ID = 'managed';

function serviceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function publicAction(action) {
  return {
    kind: action.kind,
    scope: action.scope,
    path: action.path,
    description: actionDescription(action),
  };
}

function publicPlan(plan) {
  return {
    scope: plan.scope,
    actions: plan.actions.map(publicAction),
    conflicts: plan.conflicts,
    action_count: plan.actions.length,
    conflict_count: plan.conflicts.length,
  };
}

function targetState(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { exists: true, type: stat.isDirectory() ? 'directory' : 'non-regular' };
    }
    return { exists: true, type: 'file', hash: sha256(fs.readFileSync(filePath)) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, type: 'missing' };
    throw error;
  }
}

function repairPlanDigest(plan) {
  const payload = {
    scope: plan.scope,
    actions: plan.actions.map(function serialize(action) {
      return {
        kind: action.kind,
        scope: action.scope,
        path: action.path,
        content_hash: sha256(action.content),
        target_state: targetState(action.path),
      };
    }),
    conflicts: plan.conflicts,
  };
  return sha256(Buffer.from(JSON.stringify(payload), 'utf8'));
}

function rollbackDigest(preview) {
  return sha256(Buffer.from(JSON.stringify({
    transaction_hash: sha256(fs.readFileSync(preview.transactionFile)),
    descriptions: preview.descriptions,
  }), 'utf8'));
}

function createTokenStore(options) {
  const opts = options || {};
  const records = new Map();
  const now = opts.now || function currentTime() { return Date.now(); };
  const ttlMs = opts.ttlMs || DEFAULT_PLAN_TTL_MS;
  const tokenFactory = opts.tokenFactory || function token() { return crypto.randomBytes(18).toString('hex'); };
  return {
    issue: function issueToken(type, value) {
      records.forEach(function prune(record, key) { if (record.expiresAt < now()) records.delete(key); });
      const id = tokenFactory();
      records.set(id, Object.assign({ type, expiresAt: now() + ttlMs }, value));
      return id;
    },
    take: function take(id, type) {
      const selected = String(id || '');
      const record = records.get(selected);
      records.delete(selected);
      if (!record || record.type !== type) throw serviceError(409, 'PREVIEW_REQUIRED', 'Generate a fresh preview before applying.');
      if (record.expiresAt < now()) throw serviceError(409, 'PREVIEW_EXPIRED', 'The preview expired. Generate a new preview.');
      return record;
    },
  };
}

function issueSummary(issues) {
  const summary = { total: issues.length, errors: 0, warnings: 0, info: 0 };
  issues.forEach(function count(item) {
    if (item.severity === 'ERROR') summary.errors += 1;
    else if (item.severity === 'WARN') summary.warnings += 1;
    else summary.info += 1;
  });
  return summary;
}

function inventorySummary(records) {
  const summary = { total: records.length, available: 0, missing: 0, broken: 0 };
  records.forEach(function count(record) {
    if (Object.prototype.hasOwnProperty.call(summary, record.status)) summary[record.status] += 1;
  });
  return summary;
}

function safeGithubRepositoryUrl(value) {
  let selected;
  try { selected = new URL(String(value || '')); } catch (error) { return null; }
  if (selected.protocol !== 'https:' || selected.hostname.toLowerCase() !== 'github.com' ||
      selected.username || selected.password || selected.port || selected.search || selected.hash) return null;
  let segments;
  try { segments = selected.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch (error) { return null; }
  if (segments.length !== 2) return null;
  segments[1] = segments[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(segments[0]) ||
      !/^[A-Za-z0-9._-]+$/.test(segments[1]) || segments[1] === '.' || segments[1] === '..') return null;
  return 'https://github.com/' + segments.map(encodeURIComponent).join('/');
}

function safeSkillPath(value) {
  const selected = String(value || '').replace(/\\/g, '/');
  if (!selected || selected.indexOf('\0') !== -1 || path.posix.isAbsolute(selected)) return null;
  const normalized = path.posix.normalize(selected);
  if (normalized === '..' || normalized.indexOf('../') === 0 || normalized.split('/').some(function unsafe(part) { return !part || part === '.' || part === '..'; })) return null;
  return normalized;
}

function githubSkillFileUrl(repositoryUrl, skillPath, ref) {
  const repository = safeGithubRepositoryUrl(repositoryUrl);
  const selectedPath = safeSkillPath(skillPath);
  if (!repository || !selectedPath) return null;
  const selectedRef = ref ? String(ref) : 'HEAD';
  const refParts = selectedRef.split('/');
  if (selectedRef.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(selectedRef) ||
      selectedRef.indexOf('..') !== -1 || selectedRef.indexOf('@{') !== -1 ||
      selectedRef.indexOf('//') !== -1 || selectedRef.endsWith('/') || selectedRef.endsWith('.') ||
      refParts.some(function unsafe(part) { return !part || part === '.' || part === '..' || part.endsWith('.lock'); })) return null;
  return repository + '/blob/' + encodeURIComponent(selectedRef) + '/' + selectedPath.split('/').map(encodeURIComponent).join('/');
}

function readSkillSourceHistory(settings) {
  const root = path.join(settings.stateDir, 'updates');
  const history = new Map();
  if (!isDirectory(root)) return history;
  fs.readdirSync(root).sort().reverse().forEach(function inspect(id) {
    const transactionFile = path.join(root, id, 'transaction.json');
    if (!fs.existsSync(transactionFile)) return;
    let payload;
    try {
      const stat = fs.lstatSync(transactionFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return;
      payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
    } catch (error) { return; }
    const name = String(payload && payload.name || '');
    if (!name || payload.version !== 1 || payload.status !== 'completed' || payload.operation !== 'link-source') return;
    const repositoryUrl = safeGithubRepositoryUrl(payload.source_url);
    const skillPath = safeSkillPath(payload.skill_path);
    if (!repositoryUrl || !skillPath) return;
    const ref = payload.ref ? String(payload.ref) : null;
    if (ref && !githubSkillFileUrl(repositoryUrl, skillPath, ref)) return;
    let skillsUrl = null;
    let sourceId = null;
    if (payload.skills_url) {
      try {
        const parsed = parseSkillsShUrl(payload.skills_url);
        if (safeGithubRepositoryUrl(parsed.source_url) !== repositoryUrl || parsed.slug !== name) return;
        skillsUrl = parsed.skills_url;
        sourceId = parsed.source_id;
      } catch (error) { return; }
    }
    if (!history.has(name)) history.set(name, []);
    history.get(name).push({
      channel: skillsUrl ? 'skills-sh' : 'github-direct',
      label: skillsUrl ? 'skills.sh 接管' : 'GitHub 直连',
      source_id: sourceId,
      skills_url: skillsUrl,
      source_url: repositoryUrl,
      skill_path: skillPath,
      ref,
    });
  });
  return history;
}

function sourcePresentation(skill, history) {
  const repositoryUrl = safeGithubRepositoryUrl(skill.source_url);
  const skillPath = safeSkillPath(skill.skill_path);
  if (!repositoryUrl || !skillPath || skill.source_type !== 'github') {
    return { origin: { kind: 'none', label: '未关联' }, links: [] };
  }
  const records = history && history.get(skill.name) || [];
  const matchingHistory = records.find(function matching(record) {
    return record.source_url === repositoryUrl && record.skill_path === skillPath &&
      (record.ref || null) === (skill.ref || null);
  }) || null;
  const origin = matchingHistory
    ? { kind: matchingHistory.channel, label: matchingHistory.label }
    : { kind: 'github', label: 'GitHub 来源' };
  const links = [];
  const skillsUrl = matchingHistory && matchingHistory.skills_url;
  if (skillsUrl) links.push({ kind: 'skills-sh', label: 'skills.sh 页面', url: skillsUrl });
  links.push({ kind: 'github-repository', label: 'GitHub 仓库', url: repositoryUrl });
  const skillUrl = githubSkillFileUrl(repositoryUrl, skillPath, skill.ref);
  if (skillUrl) links.push({ kind: 'github-skill', label: 'SKILL.md 源码', url: skillUrl });
  return { origin, links, skills_url: skillsUrl || null };
}

function publicUpdateSkill(skill, sourceHistory) {
  const source = sourcePresentation(skill, sourceHistory);
  const skillsLink = source.links.find(function catalog(item) { return item.kind === 'skills-sh'; });
  return {
    name: skill.name,
    path: skill.path,
    ownership: skill.ownership,
    ownership_label: ownershipLabel(skill.ownership),
    status: skill.status,
    display: presentUpdateStatus(skill),
    source: skill.source,
    source_type: skill.source_type,
    source_url: skill.source_url,
    skill_path: skill.skill_path,
    skills_url: skillsLink ? skillsLink.url : null,
    source_origin: source.origin,
    source_links: source.links,
    ref: skill.ref,
    installed_hash: skill.installed_hash,
    baseline_reason: skill.baseline_reason || null,
    latest_hash: skill.latest_hash || null,
    latest_revision: skill.latest_revision || null,
    installed_at: skill.installed_at,
    updated_at: skill.updated_at,
    error: skill.error || null,
  };
}

function publicUpdates(result, sourceHistory) {
  return {
    checked_at: result.checked_at || null,
    summary: result.summary,
    skills: result.skills.map(function present(skill) { return publicUpdateSkill(skill, sourceHistory); }),
    diagnostics: result.diagnostics || [],
  };
}

function updateRollbackDigest(preview) {
  return sha256(Buffer.from(JSON.stringify({
    transaction_hash: sha256(fs.readFileSync(preview.transactionFile)),
    transaction_id: preview.transaction_id,
    name: preview.name,
    path: preview.path,
  }), 'utf8'));
}

function publicRetention(plan) {
  return {
    evaluated_at: plan.evaluated_at,
    policy: plan.policy,
    protected: plan.protected,
    summary: plan.summary,
    action_count: plan.actions.length,
    actions: plan.actions.map(function action(item) {
      return {
        kind: item.kind,
        type: item.type,
        id: item.id,
        path: item.path,
        bytes: item.bytes,
        reason: item.reason,
        description: item.description,
      };
    }),
  };
}

function skillUpdateActions(plan) {
  const actions = [];
  if (plan.operation === 'link-source') {
    actions.push({
      kind: 'skill_source_link',
      path: plan.path,
      description: (plan.skills_url ? 'TAKE OVER FROM SKILLS.SH ' + plan.skills_url + ' -> ' : 'LINK UPDATE SOURCE ') + plan.source_url + ' :: ' + plan.skill_path,
    });
  } else if (plan.operation === 'rebuild-baseline') {
    actions.push({
      kind: 'skill_source_rebaseline',
      path: plan.path,
      description: 'REBUILD UPDATE BASELINE ' + plan.latest_hash,
    });
  } else if (!plan.replace_content) {
    actions.push({
      kind: 'skill_source_advance',
      path: plan.path,
      description: 'ADVANCE UPDATE BASELINE ' + plan.latest_hash,
    });
  }
  plan.diff.added.forEach(function added(item) {
    actions.push({ kind: 'skill_file_add', path: item.path, description: 'ADD ' + item.path });
  });
  plan.diff.changed.forEach(function changed(item) {
    actions.push({ kind: 'skill_file_update', path: item.path, description: 'UPDATE ' + item.path });
  });
  plan.diff.deleted.forEach(function deleted(item) {
    actions.push({ kind: 'skill_file_delete', path: item.path, description: 'DELETE ' + item.path });
  });
  if (plan.replace_content) {
    plan.preserved_local_entries.forEach(function preserved(item) {
      actions.push({ kind: 'skill_local_preserve', path: item.path, description: 'PRESERVE LOCAL ' + item.path });
    });
    plan.discarded_local_entries.forEach(function discarded(item) {
      actions.push({ kind: 'skill_local_discard', path: item.path, description: 'DROP LOCAL-ONLY ' + item.path + ' (' + item.reason + ')' });
    });
  }
  return actions;
}

function librarySettings(settings, library) {
  return Object.assign({}, settings, {
    libraryRoot: library.path,
    libraryExclude: library.mode === 'managed' ? settings.libraryExclude : new Set(),
  });
}

function physicalSkillPath(skillPath) {
  try { return fs.realpathSync(skillPath); } catch (error) { return path.resolve(skillPath); }
}

function serializeSkill(skill, library) {
  const files = listSkillFiles(skill.path);
  let totalBytes = 0;
  files.forEach(function size(file) {
    try { totalBytes += fs.statSync(file.path).size; } catch (error) { /* keep readable files */ }
  });
  const location = {
    library_id: library.id,
    library_name: library.name,
    library_mode: library.mode,
    access: accessPresentation(library.mode),
    path: skill.path,
  };
  return {
    key: library.id + ':' + skill.directoryName,
    name: skill.directoryName,
    declared_name: skill.declaredName,
    description: skill.description,
    path: skill.path,
    relative_path: skill.relativePath,
    line_count: skill.lineCount,
    file_count: files.length,
    total_bytes: totalBytes,
    library_id: library.id,
    library_name: library.name,
    library_mode: library.mode,
    access: accessPresentation(library.mode),
    library_ids: [library.id],
    locations: [location],
    linked_source_count: 0,
    physical_path: physicalSkillPath(skill.path),
  };
}

function collapsePhysicalSkills(skills) {
  const byPhysical = new Map();
  skills.forEach(function collapse(skill) {
    const existing = byPhysical.get(skill.physical_path);
    if (!existing) {
      byPhysical.set(skill.physical_path, skill);
      return;
    }
    existing.locations.push.apply(existing.locations, skill.locations);
    skill.library_ids.forEach(function add(id) {
      if (existing.library_ids.indexOf(id) === -1) existing.library_ids.push(id);
    });
    existing.linked_source_count = existing.locations.length - 1;
  });
  return Array.from(byPhysical.values()).sort(function byName(a, b) {
    return a.name.localeCompare(b.name) || a.physical_path.localeCompare(b.physical_path);
  });
}

function renderSkillDescription(content, description) {
  const lines = String(content).split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('SKILL.md must start with YAML frontmatter');
  const end = lines.slice(1).findIndex(function marker(line) { return line.trim() === '---'; });
  if (end === -1) throw new Error('SKILL.md frontmatter is not closed');
  const endIndex = end + 1;
  let start = -1;
  let finish = -1;
  for (let index = 1; index < endIndex; index += 1) {
    if (/^description\s*:/.test(lines[index])) {
      start = index;
      finish = index + 1;
      while (finish < endIndex && !/^[A-Za-z0-9_-]+\s*:/.test(lines[finish])) finish += 1;
      break;
    }
  }
  const rendered = 'description: ' + JSON.stringify(String(description));
  if (start === -1) lines.splice(endIndex, 0, rendered);
  else lines.splice.apply(lines, [start, finish - start, rendered]);
  return lines.join('\n');
}

function snapshotDirectory(settings) {
  return path.join(settings.stateDir, 'snapshots');
}

function createUiService(settings, options) {
  const opts = options || {};
  const store = createTokenStore(opts);
  const now = opts.dateFactory || function currentDate() { return new Date(); };
  const updateSourceClient = opts.updateSourceClient;
  const skillsShSearchClient = opts.skillsShSearchClient || createSkillsShSearchClient(opts.skillsShSearchOptions);
  const skillsShClock = opts.skillsShClock || function currentMilliseconds() { return Date.now(); };
  const skillsShCacheTtlMs = opts.skillsShCacheTtlMs === undefined ? DEFAULT_SKILLS_SH_CACHE_TTL_MS : opts.skillsShCacheTtlMs;
  const skillsShEmptyTtlMs = opts.skillsShEmptyTtlMs === undefined ? DEFAULT_SKILLS_SH_EMPTY_TTL_MS : opts.skillsShEmptyTtlMs;
  const skillsShStaleTtlMs = opts.skillsShStaleTtlMs === undefined ? DEFAULT_SKILLS_SH_STALE_TTL_MS : opts.skillsShStaleTtlMs;
  const skillsShCache = new Map();
  const skillsShInflight = new Map();
  let cachedIssues = null;
  let cachedUpdates = null;

  function cacheSkillsShResult(key, value, ttlMs) {
    if (skillsShCache.has(key)) skillsShCache.delete(key);
    skillsShCache.set(key, {
      value,
      expires_at: skillsShClock() + ttlMs,
      stale_until: skillsShClock() + skillsShStaleTtlMs,
    });
    while (skillsShCache.size > MAX_SKILLS_SH_CACHE_ENTRIES) {
      skillsShCache.delete(skillsShCache.keys().next().value);
    }
  }

  function publicSkillsShDiscovery(value, overrides) {
    return Object.assign({}, value, overrides || {}, {
      candidates: value.candidates.map(function copy(candidate) { return Object.assign({}, candidate); }),
    });
  }

  function descriptors() {
    const primary = {
      id: MANAGED_LIBRARY_ID,
      name: 'Managed user library',
      path: settings.libraryRoot,
      mode: 'managed',
      configured_by: settings.env.ASH_SKILLS_DIR ? 'ASH_SKILLS_DIR' : 'ash-control.json',
    };
    const custom = readPreferences(settings).scan_roots.map(function customRoot(root) {
      return Object.assign({}, root, { mode: 'observe', configured_by: 'ui-preferences' });
    });
    return [primary].concat(custom);
  }

  function descriptor(id) {
    const selected = descriptors().find(function matching(item) { return item.id === (id || MANAGED_LIBRARY_ID); });
    if (!selected) throw serviceError(404, 'LIBRARY_NOT_FOUND', 'Unknown scan root: ' + id);
    return selected;
  }

  function discoverDescriptor(library) {
    return discoverTopLevelSkills(library.path, library.mode === 'managed' ? settings.libraryExclude : new Set());
  }

  function scanState() {
    const libraries = descriptors();
    const primaryInventory = buildInventory(settings);
    const byLibrary = new Map();
    byLibrary.set(MANAGED_LIBRARY_ID, primaryInventory.library);
    libraries.slice(1).forEach(function discover(library) {
      byLibrary.set(library.id, discoverDescriptor(library));
    });

    const rawSkills = [];
    libraries.forEach(function add(library) {
      const discovered = byLibrary.get(library.id);
      discovered.forEach(function serialize(skill) { rawSkills.push(serializeSkill(skill, library)); });
      library.skill_count = discovered.length;
      library.exists = isDirectory(library.path);
    });
    const skills = collapsePhysicalSkills(rawSkills);
    const updateState = cachedUpdates || Object.assign({ checked_at: null }, classifyUserSkillUpdates(settings));
    const sourceHistory = readSkillSourceHistory(settings);
    const updatesByName = new Map(updateState.skills.map(function pair(skill) { return [skill.name, publicUpdateSkill(skill, sourceHistory)]; }));
    skills.forEach(function attachUpdate(skill) {
      skill.update = skill.library_ids.indexOf(MANAGED_LIBRARY_ID) !== -1
        ? (updatesByName.get(skill.name) || publicUpdateSkill({ name: skill.name, path: skill.path, ownership: 'manual', status: 'unmanaged' }, sourceHistory))
        : publicUpdateSkill({ name: skill.name, path: skill.path, ownership: 'observed', status: 'read-only-source' }, sourceHistory);
    });

    const issues = runDoctor(settings);
    const seenMetadataPaths = new Set(primaryInventory.library.map(function real(skill) { return physicalSkillPath(skill.path); }));
    libraries.slice(1).forEach(function customIssues(library) {
      if (!isDirectory(library.path)) {
        issues.push(issue('WARN', 'SCAN_ROOT_NOT_FOUND', 'Custom scan root is unavailable: ' + library.name, [library.path]));
      } else {
        const uniqueSkills = byLibrary.get(library.id).filter(function unique(skill) {
          const realPath = physicalSkillPath(skill.path);
          if (seenMetadataPaths.has(realPath)) return false;
          seenMetadataPaths.add(realPath);
          return true;
        });
        issues.push.apply(issues, metadataIssues(uniqueSkills));
      }
    });
    const names = new Map();
    skills.forEach(function group(skill) {
      if (!names.has(skill.name)) names.set(skill.name, []);
      names.get(skill.name).push(skill);
    });
    names.forEach(function duplicate(matches, name) {
      if (matches.length < 2) return;
      issues.push(issue(
        'WARN',
        'SCAN_ROOT_DUPLICATE_NAME',
        name + ' appears in ' + matches.length + ' scanned libraries; select its source explicitly',
        matches.map(function skillPath(skill) { return skill.path; }),
      ));
    });
    const severityOrder = { ERROR: 0, WARN: 1, INFO: 2 };
    issues.sort(function sort(a, b) {
      return (severityOrder[a.severity] - severityOrder[b.severity]) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message);
    });
    skills.forEach(function attachHealth(skill) {
      skill.health = summarizeHealth(issuesForSkill(skill, issues));
    });

    const inventory = primaryInventory.records.slice();
    const seenInventoryPaths = new Set(primaryInventory.library.map(function real(skill) { return physicalSkillPath(skill.path); }));
    libraries.slice(1).forEach(function customRecords(library) {
      byLibrary.get(library.id).forEach(function record(skill) {
        const realPath = physicalSkillPath(skill.path);
        if (seenInventoryPaths.has(realPath)) return;
        seenInventoryPaths.add(realPath);
        inventory.push({
          name: skill.directoryName,
          declared_name: skill.declaredName,
          relative_path: skill.relativePath,
          source: library.id,
          status: 'available',
          path: skill.path,
          detail: library.name,
        });
      });
    });
    return { libraries, skills, issues, inventory, updates: updateState, source_history: sourceHistory };
  }

  function listSnapshots() {
    const root = snapshotDirectory(settings);
    if (!isDirectory(root)) return [];
    return fs.readdirSync(root).filter(function snapshotFile(name) { return name.endsWith('.ash-snapshot'); }).map(function inspect(name) {
      const filePath = path.join(root, name);
      try {
        const snapshot = readSnapshot(filePath);
        return Object.assign({ file: name, path: filePath, valid: true, bytes: fs.statSync(filePath).size }, snapshotSummary(snapshot));
      } catch (error) {
        return { file: name, path: filePath, valid: false, error: error.message, bytes: fs.statSync(filePath).size };
      }
    }).sort(function newest(a, b) { return String(b.created_at || b.file).localeCompare(String(a.created_at || a.file)); });
  }

  function managedSnapshot(reference) {
    const selected = listSnapshots().find(function matching(item) {
      return item.valid && (item.snapshot_id === reference || item.file === reference);
    });
    if (!selected) throw serviceError(404, 'SNAPSHOT_NOT_FOUND', 'Unknown managed snapshot: ' + reference);
    return selected;
  }

  function latestRollback() {
    try {
      const preview = rollbackPreview(settings, 'latest');
      return {
        available: true,
        transaction_id: path.basename(path.dirname(preview.transactionFile)),
        action_count: preview.descriptions.length,
        descriptions: preview.descriptions,
      };
    } catch (error) {
      return { available: false, transaction_id: null, action_count: 0, descriptions: [] };
    }
  }

  function overview() {
    const state = scanState();
    cachedIssues = state.issues;
    const repair = buildRepairPlan(settings);
    const primary = state.libraries[0];
    const updateRollback = latestSkillUpdateRollback(settings);
    const generatedAt = now();
    const insights = sourceInsights(state.updates, { now: generatedAt });
    const retention = buildRetentionPlan(settings, { now: generatedAt });
    return {
      version: packageMetadata.version,
      generated_at: generatedAt.toISOString(),
      library: primary,
      libraries: state.libraries,
      summary: {
        skills: state.skills.length,
        managed_skills: primary.skill_count,
        scan_roots: state.libraries.length,
        files: state.skills.reduce(function sum(total, skill) { return total + skill.file_count; }, 0),
        lines: state.skills.reduce(function sum(total, skill) { return total + skill.line_count; }, 0),
        bytes: state.skills.reduce(function sum(total, skill) { return total + skill.total_bytes; }, 0),
        issues: issueSummary(state.issues),
        inventory: inventorySummary(state.inventory),
        repair_actions: repair.actions.length,
        repair_conflicts: repair.conflicts.length,
        updates: state.updates.summary,
        source_insights: insights.counts,
        transactions: retention.summary,
      },
      skills: state.skills,
      inventory: state.inventory,
      issues: state.issues,
      repair: publicPlan(repair),
      rollback: latestRollback(),
      snapshots: listSnapshots(),
      updates: publicUpdates(state.updates, state.source_history),
      source_insights: insights,
      retention: publicRetention(retention),
      update_rollback: updateRollback,
      capabilities: {
        custom_scan_roots: true,
        create_skill: true,
        edit_skill_description: true,
        package_skill: true,
        managed_snapshots: true,
        edit_skill_body: false,
        delete_skill: false,
        install_skill: false,
        sync_repository: false,
        check_updates: true,
        apply_skill_update: true,
        link_skill_source: true,
        discover_skill_source: true,
        rebuild_skill_baseline: true,
        rollback_skill_update: true,
        prune_transactions: true,
      },
    };
  }

  function selectedSkill(name, libraryId) {
    const library = descriptor(libraryId);
    const skill = findLibrarySkill(librarySettings(settings, library), name);
    return { library, skill };
  }

  function skillDetail(name, libraryId) {
    const selected = selectedSkill(name, libraryId);
    const scanned = scanState();
    const selectedPhysicalPath = physicalSkillPath(selected.skill.path);
    const serialized = scanned.skills.find(function samePhysical(skill) { return skill.physical_path === selectedPhysicalPath; }) ||
      serializeSkill(selected.skill, selected.library);
    const files = listSkillFiles(selected.skill.path);
    const issues = issuesForSkill(serialized, cachedIssues || scanned.issues);
    return Object.assign({}, serialized, {
      files: files.map(function file(item) { return item.relative; }),
      skill_md: fs.readFileSync(path.join(selected.skill.path, 'SKILL.md'), 'utf8'),
      issues,
      health: summarizeHealth(issues),
      can_write: serialized.access.can_write,
    });
  }

  function previewRepair(scope) {
    const plan = buildRepairPlan(settings, { scope: scope || 'all' });
    const payload = publicPlan(plan);
    payload.plan_id = null;
    payload.expires_in_ms = DEFAULT_PLAN_TTL_MS;
    if (plan.actions.length && !plan.conflicts.length) {
      payload.plan_id = store.issue('repair', { scope: plan.scope, digest: repairPlanDigest(plan) });
    }
    return payload;
  }

  function applyRepairPreview(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Set confirm=true after reviewing the repair preview.');
    const record = store.take(request.plan_id, 'repair');
    const fresh = buildRepairPlan(settings, { scope: record.scope });
    if (repairPlanDigest(fresh) !== record.digest) throw serviceError(409, 'PREVIEW_STALE', 'Skill state changed after the preview. Review a fresh repair plan.');
    if (fresh.conflicts.length || !fresh.actions.length) throw serviceError(409, 'PLAN_NO_LONGER_APPLICABLE', 'The repair plan is no longer applicable.');
    const transactionFile = applyRepair(settings, fresh);
    cachedIssues = runDoctor(settings);
    return {
      status: 'completed',
      transaction_id: path.basename(path.dirname(transactionFile)),
      applied: fresh.actions.map(publicAction),
      remaining: publicPlan(buildRepairPlan(settings, { scope: record.scope })),
      doctor: issueSummary(cachedIssues),
    };
  }

  function previewRollback(selector) {
    const selected = selector || 'latest';
    const preview = rollbackPreview(settings, selected);
    return {
      rollback_id: store.issue('rollback', { selector: selected, digest: rollbackDigest(preview) }),
      transaction_id: path.basename(path.dirname(preview.transactionFile)),
      descriptions: preview.descriptions,
      action_count: preview.descriptions.length,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applyRollbackPreview(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Set confirm=true after reviewing the rollback preview.');
    const record = store.take(request.rollback_id, 'rollback');
    const fresh = rollbackPreview(settings, record.selector);
    if (rollbackDigest(fresh) !== record.digest) throw serviceError(409, 'PREVIEW_STALE', 'Transaction state changed after the preview. Review a fresh rollback plan.');
    const transactionFile = applyRollback(settings, record.selector);
    cachedIssues = runDoctor(settings);
    return {
      status: 'rolled_back',
      transaction_id: path.basename(path.dirname(transactionFile)),
      doctor: issueSummary(cachedIssues),
    };
  }

  function previewTransactionPrune() {
    const plan = buildRetentionPlan(settings, { now: now() });
    const payload = publicRetention(plan);
    payload.plan_id = plan.actions.length ? store.issue('transaction-retention', { plan, digest: plan.digest }) : null;
    payload.expires_in_ms = DEFAULT_PLAN_TTL_MS;
    return payload;
  }

  function applyTransactionPrune(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm irreversible transaction cleanup after reviewing every target.');
    const record = store.take(request.plan_id, 'transaction-retention');
    let result;
    try {
      if (record.digest !== record.plan.digest) throw new Error('transaction retention preview is stale');
      result = applyRetentionPlan(settings, record.plan);
    } catch (error) {
      if (/stale|changed after/.test(error.message)) throw serviceError(409, 'PREVIEW_STALE', error.message);
      throw error;
    }
    return {
      status: 'pruned',
      deleted: result.deleted,
      deleted_bytes: result.deleted_bytes,
      retention: publicRetention(buildRetentionPlan(settings, { now: now() })),
    };
  }

  function previewLibraryChange(input) {
    const request = input || {};
    const preferencesDigest = sha256(Buffer.from(JSON.stringify(readPreferences(settings)), 'utf8'));
    if (request.action === 'add') {
      const root = resolveScanRoot(settings, request.path, request.name);
      if (readPreferences(settings).scan_roots.some(function duplicate(item) { return item.id === root.id; })) {
        throw serviceError(409, 'SCAN_ROOT_EXISTS', 'This scan path is already configured.');
      }
      return {
        action: 'add',
        plan_id: store.issue('library-change', { action: 'add', root, preferencesDigest }),
        actions: [{ kind: 'scan_root_add', path: root.path, description: 'ADD READ-ONLY SCAN ROOT ' + root.path }],
        root,
        expires_in_ms: DEFAULT_PLAN_TTL_MS,
      };
    }
    if (request.action === 'remove') {
      const root = descriptor(request.library_id);
      if (root.mode === 'managed') throw serviceError(400, 'MANAGED_LIBRARY_REQUIRED', 'The managed user library cannot be removed.');
      return {
        action: 'remove',
        plan_id: store.issue('library-change', { action: 'remove', root, preferencesDigest }),
        actions: [{ kind: 'scan_root_remove', path: root.path, description: 'STOP SCANNING ' + root.path }],
        root,
        expires_in_ms: DEFAULT_PLAN_TTL_MS,
      };
    }
    throw serviceError(400, 'INVALID_LIBRARY_ACTION', 'Library action must be add or remove.');
  }

  function applyLibraryChange(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm the scan-root change after reviewing it.');
    const record = store.take(request.plan_id, 'library-change');
    const currentDigest = sha256(Buffer.from(JSON.stringify(readPreferences(settings)), 'utf8'));
    if (currentDigest !== record.preferencesDigest) throw serviceError(409, 'PREVIEW_STALE', 'Scan-root configuration changed. Review a fresh preview.');
    if (record.action === 'add') {
      const fresh = resolveScanRoot(settings, record.root.path, record.root.name);
      if (fresh.id !== record.root.id || fresh.signature !== record.root.signature) {
        throw serviceError(409, 'PREVIEW_STALE', 'Scan-root contents changed. Review a fresh preview.');
      }
      addScanRoot(settings, fresh, now());
    } else {
      const fresh = descriptor(record.root.id);
      if (fresh.path !== record.root.path) throw serviceError(409, 'PREVIEW_STALE', 'Scan-root configuration changed.');
      removeScanRoot(settings, record.root.id);
    }
    cachedIssues = null;
    return { status: 'completed', action: record.action, overview: overview() };
  }

  function previewCreateSkill(input) {
    const request = input || {};
    const name = String(request.name || '').trim();
    const description = String(request.description || '').trim();
    validateCreateInput(name, description);
    const destination = path.join(settings.libraryRoot, name);
    if (lexists(destination)) throw serviceError(409, 'SKILL_EXISTS', 'Skill already exists: ' + destination);
    return {
      plan_id: store.issue('skill-create', { name, description, destination, state: targetState(destination) }),
      actions: [{ kind: 'skill_create', path: destination, description: 'CREATE USER SKILL ' + destination }],
      name,
      description,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applyCreateSkill(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm Skill creation after reviewing the destination.');
    const record = store.take(request.plan_id, 'skill-create');
    validateCreateInput(record.name, record.description);
    if (JSON.stringify(targetState(record.destination)) !== JSON.stringify(record.state)) {
      throw serviceError(409, 'PREVIEW_STALE', 'Skill destination changed. Review a fresh preview.');
    }
    const created = createSkill(settings, record.name, { description: record.description });
    cachedIssues = null;
    return { status: 'created', created, skill: skillDetail(record.name, MANAGED_LIBRARY_ID) };
  }

  function previewSkillDescription(input) {
    const request = input || {};
    const selected = selectedSkill(request.name, request.library_id);
    if (selected.library.mode !== 'managed') throw serviceError(400, 'READ_ONLY_LIBRARY', 'Descriptions can only be changed in the managed user library.');
    const description = String(request.description || '').trim();
    validateCreateInput(selected.skill.directoryName, description);
    const skillFile = path.join(selected.skill.path, 'SKILL.md');
    const content = Buffer.from(renderSkillDescription(fs.readFileSync(skillFile, 'utf8'), description), 'utf8');
    return {
      plan_id: store.issue('skill-description', {
        name: selected.skill.directoryName,
        description,
        path: skillFile,
        content_hash: sha256(content),
        target_state: targetState(skillFile),
      }),
      actions: [{ kind: 'file_write', path: skillFile, description: 'UPDATE SKILL DESCRIPTION ' + skillFile }],
      description,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applySkillDescription(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm the description update after reviewing the target file.');
    const record = store.take(request.plan_id, 'skill-description');
    const selected = selectedSkill(record.name, MANAGED_LIBRARY_ID);
    validateCreateInput(selected.skill.directoryName, record.description);
    const content = Buffer.from(renderSkillDescription(fs.readFileSync(record.path, 'utf8'), record.description), 'utf8');
    if (sha256(content) !== record.content_hash || JSON.stringify(targetState(record.path)) !== JSON.stringify(record.target_state)) {
      throw serviceError(409, 'PREVIEW_STALE', 'SKILL.md changed after the preview. Review a fresh description update.');
    }
    const plan = {
      scope: 'skill-metadata',
      actions: [{ kind: 'file_write', scope: 'skill-metadata', path: record.path, content }],
      conflicts: [],
    };
    const transactionFile = applyRepair(settings, plan);
    cachedIssues = null;
    return {
      status: 'updated',
      transaction_id: path.basename(path.dirname(transactionFile)),
      skill: skillDetail(record.name, MANAGED_LIBRARY_ID),
    };
  }

  async function checkUpdates() {
    cachedUpdates = await checkUserSkillUpdates(settings, { sourceClient: updateSourceClient });
    return publicUpdates(cachedUpdates, readSkillSourceHistory(settings));
  }

  async function checkSkillUpdate(name) {
    const selectedName = String(name || '').trim();
    if (!selectedName) throw serviceError(400, 'SKILL_NAME_REQUIRED', 'A Skill name is required for an individual update check.');
    const currentState = cachedUpdates || classifyUserSkillUpdates(settings);
    const current = currentState.skills.find(function matching(skill) { return skill.name === selectedName; });
    if (!current) throw serviceError(404, 'SKILL_NOT_FOUND', 'Unknown user Skill: ' + selectedName);
    if (current.status !== 'checkable') {
      throw serviceError(409, 'SKILL_CHECK_NOT_AVAILABLE', 'This Skill is not ready for an individual update check.');
    }
    const checked = await checkUserSkillUpdates(settings, {
      sourceClient: updateSourceClient,
      name: selectedName,
    });
    const checkedSkill = checked.skills.find(function matching(skill) { return skill.name === selectedName; });
    if (!checkedSkill || checkedSkill.status === 'checkable') {
      throw serviceError(502, 'SKILL_CHECK_INCOMPLETE', 'The individual update check did not produce a result.');
    }
    if (!cachedUpdates) {
      cachedUpdates = checked;
    } else {
      const target = cachedUpdates.skills.find(function matching(skill) { return skill.name === selectedName; });
      if (!target) throw serviceError(409, 'SKILL_STATE_CHANGED', 'The Skill list changed. Refresh and try again.');
      Object.assign(target, checkedSkill);
      cachedUpdates.checked_at = checked.checked_at;
      cachedUpdates.diagnostics = checked.diagnostics;
      cachedUpdates.summary = updateSummary(cachedUpdates.skills);
    }
    const updated = cachedUpdates.skills.find(function matching(skill) { return skill.name === selectedName; });
    return {
      checked_at: cachedUpdates.checked_at,
      summary: cachedUpdates.summary,
      skill: publicUpdateSkill(updated, readSkillSourceHistory(settings)),
    };
  }

  async function discoverSkillSource(input) {
    const request = input || {};
    const selected = selectedSkill(String(request.name || '').trim(), MANAGED_LIBRARY_ID);
    const name = selected.skill.directoryName;
    const current = (cachedUpdates || classifyUserSkillUpdates(settings)).skills.find(function matching(skill) {
      return skill.name === name;
    });
    if (!current || current.status !== 'unmanaged') {
      throw serviceError(409, 'SOURCE_DISCOVERY_NOT_AVAILABLE', 'Only an unmanaged user Skill can discover a new skills.sh source.');
    }
    const key = name.toLowerCase();
    const cached = skillsShCache.get(key);
    const checkedAt = skillsShClock();
    if (cached && cached.expires_at >= checkedAt) {
      skillsShCache.delete(key);
      skillsShCache.set(key, cached);
      return publicSkillsShDiscovery(cached.value, { cached: true });
    }
    if (skillsShInflight.has(key)) return skillsShInflight.get(key);
    const operation = Promise.resolve().then(async function search() {
      try {
        const discovered = await skillsShSearchClient.search(name, { limit: 20 });
        const candidates = discovered.candidates.filter(function exact(candidate) {
          return candidate.slug === name;
        }).sort(function rank(left, right) {
          return right.installs - left.installs || left.id.localeCompare(right.id);
        });
        const value = {
          provider: 'skills.sh',
          provider_contract: discovered.contract || 'undocumented-api-search',
          experimental: true,
          state: candidates.length ? 'ok' : 'no-match',
          name,
          query: name,
          cached: false,
          stale: false,
          manual_entry: true,
          selection_required: candidates.length > 0,
          discovered_at: new Date(skillsShClock()).toISOString(),
          candidates,
          error: null,
        };
        cacheSkillsShResult(key, value, candidates.length ? skillsShCacheTtlMs : skillsShEmptyTtlMs);
        return publicSkillsShDiscovery(value);
      } catch (error) {
        if (cached && cached.stale_until >= skillsShClock()) {
          return publicSkillsShDiscovery(cached.value, {
            state: 'stale-cache', cached: true, stale: true,
            error: 'skills.sh 当前不可用，显示最近一次候选；预览时仍会重新校验来源。',
          });
        }
        return {
          provider: 'skills.sh',
          provider_contract: 'undocumented-api-search',
          experimental: true,
          state: 'unavailable',
          name,
          query: name,
          cached: false,
          stale: false,
          manual_entry: true,
          selection_required: false,
          discovered_at: new Date(skillsShClock()).toISOString(),
          candidates: [],
          error: 'skills.sh 自动发现暂不可用，请手动粘贴准确 URL。',
        };
      }
    }).finally(function release() { skillsShInflight.delete(key); });
    skillsShInflight.set(key, operation);
    return operation;
  }

  function cacheUpToDate(plan) {
    if (!cachedUpdates) cachedUpdates = Object.assign({ checked_at: new Date().toISOString() }, classifyUserSkillUpdates(settings));
    const updatedRecord = cachedUpdates.skills.find(function matching(skill) { return skill.name === plan.name; });
    if (updatedRecord) {
      updatedRecord.ownership = 'installer-lock';
      updatedRecord.status = 'up-to-date';
      updatedRecord.source = plan.source;
      updatedRecord.source_type = 'github';
      updatedRecord.source_url = plan.source_url;
      updatedRecord.skill_path = plan.skill_path;
      updatedRecord.ref = plan.ref;
      updatedRecord.installed_hash = plan.latest_hash;
      updatedRecord.latest_hash = plan.latest_hash;
      updatedRecord.latest_revision = plan.latest_revision;
      updatedRecord.baseline_reason = null;
      updatedRecord.updated_at = new Date().toISOString();
      updatedRecord.error = null;
    }
    cachedUpdates.summary = updateSummary(cachedUpdates.skills);
  }

  async function previewSkillUpdate(input) {
    const request = input || {};
    const name = String(request.name || '').trim();
    const checked = cachedUpdates && cachedUpdates.skills.find(function matching(skill) { return skill.name === name; });
    if (!checked) throw serviceError(409, 'UPDATE_CHECK_REQUIRED', 'Check for updates before previewing a Skill update.');
    if (checked.status !== 'update-available') {
      throw serviceError(409, 'UPDATE_NOT_AVAILABLE', 'This Skill does not currently have a managed update available.');
    }
    let plan;
    try {
      plan = await buildSkillUpdatePreview(settings, {
        name,
        latest_hash: checked.latest_hash,
        latest_revision: checked.latest_revision,
      }, { sourceClient: updateSourceClient });
    } catch (error) {
      throw serviceError(/changed after|check again/.test(error.message) ? 409 : 502,
        /changed after|check again/.test(error.message) ? 'PREVIEW_STALE' : 'UPDATE_SOURCE_UNAVAILABLE', error.message);
    }
    const actions = skillUpdateActions(plan);
    return {
      plan_id: store.issue('skill-update', { plan, digest: updatePlanDigest(plan) }),
      name: plan.name,
      source: plan.source,
      installed_hash: plan.installed_hash,
      latest_hash: plan.latest_hash,
      latest_revision: plan.latest_revision,
      diff: plan.diff,
      preserved_local_entries: plan.preserved_local_entries,
      discarded_local_entries: plan.discarded_local_entries,
      actions,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  async function applySkillUpdatePreview(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm the Skill update after reviewing every file change.');
    const record = store.take(request.plan_id, 'skill-update');
    let fresh;
    try {
      fresh = await buildSkillUpdatePreview(settings, {
        name: record.plan.name,
        latest_hash: record.plan.latest_hash,
        latest_revision: record.plan.latest_revision,
      }, { sourceClient: updateSourceClient });
      if (updatePlanDigest(fresh) !== record.digest) throw new Error('update preview is stale');
    } catch (error) {
      throw serviceError(409, 'PREVIEW_STALE', error.message);
    }
    let transactionFile;
    try {
      transactionFile = await applyManagedSkillUpdate(settings, fresh, { sourceClient: updateSourceClient });
    } catch (error) {
      if (/stale|changed after|changed after preview|upstream changed/.test(error.message)) {
        throw serviceError(409, 'PREVIEW_STALE', error.message);
      }
      throw error;
    }
    cacheUpToDate(fresh);
    cachedIssues = null;
    return {
      status: 'updated',
      transaction_id: path.basename(path.dirname(transactionFile)),
      skill: skillDetail(fresh.name, MANAGED_LIBRARY_ID),
      update_rollback: latestSkillUpdateRollback(settings),
    };
  }

  async function previewSkillSource(input) {
    const request = input || {};
    const selected = selectedSkill(String(request.name || '').trim(), MANAGED_LIBRARY_ID);
    let plan;
    try {
      plan = await buildSkillSourcePreview(settings, {
        name: selected.skill.directoryName,
        source: request.source,
        skills_url: request.skills_url,
        source_url: request.source_url,
        skill_path: request.skill_path,
        ref: request.ref,
      }, { sourceClient: updateSourceClient });
    } catch (error) {
      const invalid = /valid URL|only HTTPS GitHub|safe relative path|escapes the source|does not need|not a supported GitHub|skills\.sh|choose either|unique repository path/.test(error.message);
      throw serviceError(invalid ? 400 : 502, invalid ? 'INVALID_UPDATE_SOURCE' : 'UPDATE_SOURCE_UNAVAILABLE', error.message);
    }
    const actions = skillUpdateActions(plan);
    return {
      plan_id: store.issue('skill-source', { plan, digest: updatePlanDigest(plan) }),
      operation: plan.operation,
      name: plan.name,
      source: plan.source,
      source_id: plan.source_id,
      skills_url: plan.skills_url,
      source_url: plan.source_url,
      skill_path: plan.skill_path,
      ref: plan.ref,
      installed_hash: plan.installed_hash,
      latest_hash: plan.latest_hash,
      latest_revision: plan.latest_revision,
      diff: plan.diff,
      replace_content: plan.replace_content,
      preserved_local_entries: plan.preserved_local_entries,
      discarded_local_entries: plan.discarded_local_entries,
      actions,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  async function applySkillSourcePreview(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm the source link after reviewing every file and lock change.');
    const record = store.take(request.plan_id, 'skill-source');
    let transactionFile;
    try {
      transactionFile = await applyManagedSkillSource(settings, record.plan, { sourceClient: updateSourceClient });
    } catch (error) {
      if (/stale|changed after|upstream changed/.test(error.message)) throw serviceError(409, 'PREVIEW_STALE', error.message);
      throw serviceError(502, 'UPDATE_SOURCE_UNAVAILABLE', error.message);
    }
    cacheUpToDate(record.plan);
    cachedIssues = null;
    return {
      status: record.plan.operation === 'link-source' ? 'source_linked' : 'baseline_rebuilt',
      transaction_id: path.basename(path.dirname(transactionFile)),
      skill: skillDetail(record.plan.name, MANAGED_LIBRARY_ID),
      update_rollback: latestSkillUpdateRollback(settings),
    };
  }

  function previewSkillUpdateRollback() {
    const preview = previewManagedSkillUpdateRollback(settings, 'latest');
    return {
      rollback_id: store.issue('skill-update-rollback', {
        selector: preview.transaction_id,
        digest: updateRollbackDigest(preview),
      }),
      transaction_id: preview.transaction_id,
      name: preview.name,
      actions: [{ kind: 'skill_update_rollback', path: preview.path, description: preview.description }],
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applySkillUpdateRollbackPreview(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm rollback after reviewing the Skill update transaction.');
    const record = store.take(request.rollback_id, 'skill-update-rollback');
    let fresh;
    try {
      fresh = previewManagedSkillUpdateRollback(settings, record.selector);
      if (updateRollbackDigest(fresh) !== record.digest) throw new Error('Skill update transaction changed after preview.');
    } catch (error) {
      throw serviceError(409, 'PREVIEW_STALE', error.message);
    }
    const transactionFile = applyManagedSkillUpdateRollback(settings, record.selector);
    cachedUpdates = null;
    cachedIssues = null;
    return {
      status: 'rolled_back',
      transaction_id: path.basename(path.dirname(transactionFile)),
      skill: skillDetail(fresh.name, MANAGED_LIBRARY_ID),
      update_rollback: latestSkillUpdateRollback(settings),
    };
  }

  function previewPackage(input) {
    const request = input || {};
    const selected = selectedSkill(request.name, request.library_id);
    const archive = buildArchive(selected.skill);
    const outputName = selected.library.mode === 'managed'
      ? selected.skill.directoryName + '.skill'
      : selected.library.id + '--' + selected.skill.directoryName + '.skill';
    const output = path.join(settings.packageOutputDir, outputName);
    const record = {
      library_id: selected.library.id,
      name: selected.skill.directoryName,
      archive_hash: sha256(archive),
      output,
      output_state: targetState(output),
    };
    return {
      plan_id: store.issue('package', record),
      actions: [{ kind: 'package_write', path: output, description: 'WRITE SKILL PACKAGE ' + output }],
      bytes: archive.length,
      output,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applyPackage(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm package creation after reviewing the output.');
    const record = store.take(request.plan_id, 'package');
    const selected = selectedSkill(record.name, record.library_id);
    const archive = buildArchive(selected.skill);
    if (sha256(archive) !== record.archive_hash || JSON.stringify(targetState(record.output)) !== JSON.stringify(record.output_state)) {
      throw serviceError(409, 'PREVIEW_STALE', 'Skill or package output changed. Review a fresh preview.');
    }
    atomicWrite(record.output, archive);
    return { status: 'packaged', output: record.output, bytes: archive.length, sha256: sha256(archive) };
  }

  function previewSnapshotCreate() {
    const createdAt = now();
    const snapshot = buildSnapshot(settings, { now: createdAt });
    const filename = 'user-skills-' + timestampId(createdAt) + '.ash-snapshot';
    const output = path.join(snapshotDirectory(settings), filename);
    return {
      plan_id: store.issue('snapshot-create', {
        created_at: createdAt.toISOString(),
        snapshot_id: snapshot.snapshot_id,
        output,
        output_state: targetState(output),
      }),
      actions: [{ kind: 'snapshot_create', path: output, description: 'CREATE USER SKILL SNAPSHOT ' + output }],
      snapshot: Object.assign({ file: filename }, snapshotSummary(snapshot)),
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applySnapshotCreate(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm snapshot creation after reviewing its scope.');
    const record = store.take(request.plan_id, 'snapshot-create');
    const snapshot = buildSnapshot(settings, { now: new Date(record.created_at) });
    if (snapshot.snapshot_id !== record.snapshot_id || JSON.stringify(targetState(record.output)) !== JSON.stringify(record.output_state)) {
      throw serviceError(409, 'PREVIEW_STALE', 'User library or snapshot output changed. Review a fresh preview.');
    }
    const written = writeSnapshot(settings, record.output, { now: new Date(record.created_at) });
    return { status: 'created', snapshot: Object.assign({ file: path.basename(record.output) }, snapshotSummary(written.snapshot), { bytes: written.bytes }) };
  }

  function restorePlanDigest(plan) {
    return sha256(Buffer.from(JSON.stringify({
      actions: plan.actions.map(function action(item) { return Object.assign({}, item, { target_state: targetState(item.path) }); }),
      unchanged: plan.unchanged,
      conflicts: plan.conflicts,
    }), 'utf8'));
  }

  function previewSnapshotRestore(input) {
    const selected = managedSnapshot((input || {}).snapshot);
    const snapshot = readSnapshot(selected.path);
    const plan = planSnapshotRestore(settings, snapshot);
    return {
      plan_id: plan.actions.length && !plan.conflicts.length ? store.issue('snapshot-restore', {
        path: selected.path,
        file_hash: sha256(fs.readFileSync(selected.path)),
        snapshot_id: snapshot.snapshot_id,
        plan_digest: restorePlanDigest(plan),
      }) : null,
      snapshot: selected,
      actions: plan.actions.map(function action(item) { return { kind: item.kind, path: item.path, description: 'RESTORE MISSING SKILL ' + item.path }; }),
      unchanged: plan.unchanged,
      conflicts: plan.conflicts,
      expires_in_ms: DEFAULT_PLAN_TTL_MS,
    };
  }

  function applySnapshotRestorePreview(input) {
    const request = input || {};
    if (request.confirm !== true) throw serviceError(400, 'CONFIRMATION_REQUIRED', 'Confirm additive restore after reviewing missing Skills and conflicts.');
    const record = store.take(request.plan_id, 'snapshot-restore');
    if (sha256(fs.readFileSync(record.path)) !== record.file_hash) throw serviceError(409, 'PREVIEW_STALE', 'Snapshot file changed. Review a fresh preview.');
    const snapshot = readSnapshot(record.path);
    const plan = planSnapshotRestore(settings, snapshot);
    if (snapshot.snapshot_id !== record.snapshot_id || restorePlanDigest(plan) !== record.plan_digest) {
      throw serviceError(409, 'PREVIEW_STALE', 'Library state changed. Review a fresh restore preview.');
    }
    const restored = applySnapshotRestore(settings, snapshot);
    cachedIssues = null;
    return { status: 'restored', created: restored.created, unchanged: restored.unchanged, verification: verifySnapshot(settings, snapshot) };
  }

  function verifyManagedSnapshot(reference) {
    const selected = managedSnapshot(reference);
    const snapshot = readSnapshot(selected.path);
    return { snapshot: selected, verification: verifySnapshot(settings, snapshot) };
  }

  return {
    applyCreateSkill,
    applyLibraryChange,
    applyPackage,
    applyRepair: applyRepairPreview,
    applyRollback: applyRollbackPreview,
    applyTransactionPrune,
    applySkillSource: applySkillSourcePreview,
    applySkillUpdate: applySkillUpdatePreview,
    applySkillUpdateRollback: applySkillUpdateRollbackPreview,
    applySnapshotCreate,
    applySnapshotRestore: applySnapshotRestorePreview,
    applySkillDescription,
    checkUpdates,
    checkSkillUpdate,
    discoverSkillSource,
    listSnapshots,
    overview,
    previewCreateSkill,
    previewLibraryChange,
    previewPackage,
    previewRepair,
    previewRollback,
    previewSnapshotCreate,
    previewSnapshotRestore,
    previewSkillDescription,
    previewSkillSource,
    previewSkillUpdate,
    previewSkillUpdateRollback,
    previewTransactionPrune,
    skillDetail,
    verifyManagedSnapshot,
  };
}

module.exports = {
  DEFAULT_PLAN_TTL_MS,
  DEFAULT_SKILLS_SH_CACHE_TTL_MS,
  MANAGED_LIBRARY_ID,
  createUiService,
  publicAction,
  publicPlan,
  renderSkillDescription,
  repairPlanDigest,
  publicRetention,
  serviceError,
  snapshotDirectory,
};
