'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const packageMetadata = require('../../package.json');
const { NAME_PATTERN, discoverLibrary } = require('./discovery');
const {
  IGNORED_DIRECTORY_NAMES,
  IGNORED_FILE_NAMES,
  isDirectory,
  lexists,
  sha256,
} = require('./util');

const SNAPSHOT_KIND = 'ash-user-skills-snapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_SCOPE = 'agents-library-user-skills';
const SNAPSHOT_EXCLUDED_SOURCES = [
  'agent-built-in',
  'codex-plugin',
  'codex-store',
  'codex-system',
];
const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_SKILLS = 10000;
const MAX_FILES = 100000;

function comparePortableText(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function safeRelativePath(value, label, topLevelOnly) {
  if (typeof value !== 'string' || !value || value.indexOf('\0') !== -1 || value.indexOf('\\') !== -1) {
    throw new Error(label + ' must be a portable relative path');
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    throw new Error(label + ' must be a normalized relative path');
  }
  const parts = value.split('/');
  if (parts.some(function unsafe(part) { return !part || part === '.' || part === '..'; })) {
    throw new Error(label + ' contains an unsafe path component');
  }
  if (topLevelOnly && parts.length !== 1) {
    throw new Error(label + ' must be a top-level Skill name');
  }
  return value;
}

function fileDigestView(files) {
  return files.map(function describe(file) {
    return {
      path: file.path,
      mode: file.mode,
      size: file.size,
      sha256: file.sha256,
    };
  });
}

function contentDigest(files) {
  return sha256(Buffer.from(JSON.stringify(fileDigestView(files)), 'utf8'));
}

function snapshotDigest(snapshot) {
  const view = {
    kind: snapshot.kind,
    schema_version: snapshot.schema_version,
    scope: snapshot.scope,
    created_at: snapshot.created_at,
    ash_version: snapshot.ash_version,
    excluded_sources: snapshot.excluded_sources,
    skills: snapshot.skills.map(function describe(skill) {
      return {
        path: skill.path,
        name: skill.name,
        source_kind: skill.source_kind,
        content_sha256: skill.content_sha256,
        files: fileDigestView(skill.files),
        omitted: skill.omitted,
      };
    }),
  };
  return sha256(Buffer.from(JSON.stringify(view), 'utf8'));
}

function listPortableSkillContent(skill) {
  const files = [];
  const omitted = [];

  function visit(current, relativeParts) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort(function byName(a, b) {
      return a.name.localeCompare(b.name);
    });
    entries.forEach(function inspect(entry) {
      const relative = relativeParts.concat(entry.name);
      const portablePath = relative.join('/');
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        omitted.push({ path: portablePath, reason: 'symlink' });
        return;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          omitted.push({ path: portablePath, reason: 'local-directory' });
        } else {
          visit(fullPath, relative);
        }
        return;
      }
      if (!entry.isFile()) {
        omitted.push({ path: portablePath, reason: 'unsupported-entry' });
        return;
      }
      if (IGNORED_FILE_NAMES.has(entry.name)) {
        omitted.push({ path: portablePath, reason: 'local-file' });
        return;
      }
      if (/\.(?:pyc|pyo)$/.test(entry.name)) {
        omitted.push({ path: portablePath, reason: 'compiled-python' });
        return;
      }
      const content = fs.readFileSync(fullPath);
      if (content.length > MAX_FILE_BYTES) {
        throw new Error(skill.relativePath + '/' + portablePath + ' exceeds the 128 MiB snapshot file limit');
      }
      files.push({
        path: portablePath,
        mode: fs.statSync(fullPath).mode & 0o777,
        size: content.length,
        sha256: sha256(content),
        content_base64: content.toString('base64'),
      });
    });
  }

  visit(skill.path, []);
  files.sort(function byPath(a, b) { return comparePortableText(a.path, b.path); });
  omitted.sort(function byPath(a, b) {
    return comparePortableText(a.path, b.path) || comparePortableText(a.reason, b.reason);
  });
  if (!files.some(function required(file) { return file.path === 'SKILL.md'; })) {
    throw new Error('snapshot source has no portable SKILL.md: ' + skill.path);
  }
  return { files, omitted };
}

function portableSkill(skill) {
  const relativePath = safeRelativePath(skill.relativePath, 'Skill path', true);
  if (!NAME_PATTERN.test(relativePath)) {
    throw new Error('snapshot only supports standard top-level Skill names: ' + relativePath);
  }
  const content = listPortableSkillContent(skill);
  return {
    path: relativePath,
    name: skill.declaredName || skill.directoryName,
    source_kind: fs.lstatSync(skill.path).isSymbolicLink() ? 'materialized-symlink' : 'directory',
    content_sha256: contentDigest(content.files),
    files: content.files,
    omitted: content.omitted,
  };
}

function buildSnapshot(settings, options) {
  const opts = options || {};
  const library = discoverLibrary(settings);
  if (library.length > MAX_SKILLS) throw new Error('snapshot contains too many Skills');
  const skills = library.map(portableSkill).sort(function byPath(a, b) { return comparePortableText(a.path, b.path); });
  const totalFiles = skills.reduce(function count(sum, skill) { return sum + skill.files.length; }, 0);
  if (totalFiles > MAX_FILES) throw new Error('snapshot contains too many files');
  const snapshot = {
    kind: SNAPSHOT_KIND,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    scope: SNAPSHOT_SCOPE,
    created_at: (opts.now || new Date()).toISOString(),
    ash_version: packageMetadata.version,
    excluded_sources: SNAPSHOT_EXCLUDED_SOURCES.slice(),
    skills,
  };
  snapshot.snapshot_id = snapshotDigest(snapshot);
  return snapshot;
}

function ensureOutputOutsideLibrary(settings, outputPath) {
  const relative = path.relative(path.resolve(settings.libraryRoot), path.resolve(outputPath));
  if (relative === '' || (relative !== '..' && relative.indexOf('..' + path.sep) !== 0 && !path.isAbsolute(relative))) {
    throw new Error('snapshot output must be outside the universal Skill library');
  }
}

function writeNewFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let descriptor;
  let created = false;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (created && descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (closeError) { /* best effort */ }
      descriptor = undefined;
    }
    if (created && lexists(filePath)) fs.unlinkSync(filePath);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeSnapshot(settings, outputPath, options) {
  const selected = path.resolve(outputPath);
  ensureOutputOutsideLibrary(settings, selected);
  if (lexists(selected)) throw new Error('snapshot output already exists: ' + selected);
  const snapshot = buildSnapshot(settings, options);
  validateSnapshot(snapshot);
  const encoded = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'), { level: 9 });
  if (encoded.length > MAX_SNAPSHOT_BYTES) throw new Error('snapshot exceeds the 512 MiB size limit');
  writeNewFile(selected, encoded);
  return {
    path: selected,
    snapshot,
    bytes: encoded.length,
    skill_count: snapshot.skills.length,
    file_count: snapshot.skills.reduce(function count(sum, skill) { return sum + skill.files.length; }, 0),
    omitted_count: snapshot.skills.reduce(function count(sum, skill) { return sum + skill.omitted.length; }, 0),
    materialized_symlink_count: snapshot.skills.filter(function linked(skill) {
      return skill.source_kind === 'materialized-symlink';
    }).length,
  };
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) {
    throw new Error(label + ' is not canonical base64');
  }
  const paddingIndex = value.indexOf('=');
  if (paddingIndex !== -1) {
    const padding = value.slice(paddingIndex);
    if (paddingIndex < value.length - 2 || (padding !== '=' && padding !== '==')) {
      throw new Error(label + ' is not canonical base64');
    }
  }
  const content = Buffer.from(value, 'base64');
  if (content.length > MAX_FILE_BYTES) throw new Error(label + ' exceeds the 128 MiB snapshot file limit');
  if (content.toString('base64') !== value) throw new Error(label + ' is not canonical base64');
  return content;
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot payload must be an object');
  if (snapshot.kind !== SNAPSHOT_KIND) throw new Error('unsupported snapshot kind');
  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) throw new Error('unsupported snapshot schema_version');
  if (snapshot.scope !== SNAPSHOT_SCOPE) throw new Error('snapshot is not limited to user Skills');
  if (typeof snapshot.created_at !== 'string' || Number.isNaN(Date.parse(snapshot.created_at))) {
    throw new Error('snapshot has an invalid created_at timestamp');
  }
  if (typeof snapshot.ash_version !== 'string' || !snapshot.ash_version) throw new Error('snapshot has no ASH version');
  if (!Array.isArray(snapshot.excluded_sources) ||
      JSON.stringify(snapshot.excluded_sources) !== JSON.stringify(SNAPSHOT_EXCLUDED_SOURCES)) {
    throw new Error('snapshot does not declare the required system and plugin exclusions');
  }
  if (!Array.isArray(snapshot.skills) || snapshot.skills.length > MAX_SKILLS) throw new Error('invalid snapshot skills list');
  const skillPaths = new Set();
  let totalFiles = 0;
  snapshot.skills.forEach(function validateSkill(skill, skillIndex) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error('invalid Skill record at index ' + skillIndex);
    const skillPath = safeRelativePath(skill.path, 'Skill path', true);
    if (!NAME_PATTERN.test(skillPath)) throw new Error('invalid standard Skill path: ' + skillPath);
    const foldedSkillPath = skillPath.toLowerCase();
    if (skillPaths.has(foldedSkillPath)) throw new Error('duplicate snapshot Skill path: ' + skillPath);
    skillPaths.add(foldedSkillPath);
    if (typeof skill.name !== 'string') throw new Error('invalid Skill name for ' + skillPath);
    if (skill.source_kind !== 'directory' && skill.source_kind !== 'materialized-symlink') {
      throw new Error('invalid source_kind for ' + skillPath);
    }
    if (!Array.isArray(skill.files) || !Array.isArray(skill.omitted)) throw new Error('invalid content list for ' + skillPath);
    totalFiles += skill.files.length;
    if (totalFiles > MAX_FILES) throw new Error('snapshot contains too many files');
    const filePaths = new Set();
    skill.files.forEach(function validateFile(file, fileIndex) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('invalid file record in ' + skillPath);
      const filePath = safeRelativePath(file.path, 'File path', false);
      const foldedFilePath = filePath.toLowerCase();
      if (filePaths.has(foldedFilePath)) throw new Error('duplicate file path in ' + skillPath + ': ' + filePath);
      filePaths.add(foldedFilePath);
      if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('invalid file mode in ' + skillPath);
      if (!Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) throw new Error('invalid file size in ' + skillPath);
      const content = decodeBase64(file.content_base64, skillPath + ' file ' + fileIndex);
      if (content.length !== file.size || sha256(content) !== file.sha256) {
        throw new Error('content checksum mismatch for ' + skillPath + '/' + filePath);
      }
    });
    filePaths.forEach(function validateParents(filePath) {
      const parts = filePath.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        const ancestor = parts.slice(0, index).join('/');
        if (filePaths.has(ancestor)) throw new Error('file path overlaps a parent file in ' + skillPath + ': ' + filePath);
      }
    });
    if (!filePaths.has('skill.md')) throw new Error('snapshot Skill is missing SKILL.md: ' + skillPath);
    const sortedFiles = skill.files.slice().sort(function byPath(a, b) { return comparePortableText(a.path, b.path); });
    if (JSON.stringify(sortedFiles.map(function name(file) { return file.path; })) !==
        JSON.stringify(skill.files.map(function name(file) { return file.path; }))) {
      throw new Error('snapshot files are not sorted for ' + skillPath);
    }
    if (contentDigest(skill.files) !== skill.content_sha256) throw new Error('Skill checksum mismatch for ' + skillPath);
    skill.omitted.forEach(function validateOmitted(item) {
      if (!item || typeof item !== 'object' || typeof item.reason !== 'string') throw new Error('invalid omitted entry in ' + skillPath);
      safeRelativePath(item.path, 'Omitted path', false);
    });
  });
  const sortedSkills = snapshot.skills.slice().sort(function byPath(a, b) { return comparePortableText(a.path, b.path); });
  if (JSON.stringify(sortedSkills.map(function name(skill) { return skill.path; })) !==
      JSON.stringify(snapshot.skills.map(function name(skill) { return skill.path; }))) {
    throw new Error('snapshot Skills are not sorted');
  }
  if (snapshot.snapshot_id !== snapshotDigest(snapshot)) throw new Error('snapshot manifest checksum mismatch');
  return snapshot;
}

function readSnapshot(snapshotPath) {
  const selected = path.resolve(snapshotPath);
  let stat;
  try {
    stat = fs.statSync(selected);
  } catch (error) {
    throw new Error('cannot read snapshot ' + selected + ': ' + error.message);
  }
  if (!stat.isFile()) throw new Error('snapshot is not a regular file: ' + selected);
  if (stat.size > MAX_SNAPSHOT_BYTES) throw new Error('snapshot exceeds the 512 MiB size limit');
  let expanded;
  try {
    expanded = zlib.gunzipSync(fs.readFileSync(selected));
  } catch (error) {
    throw new Error('cannot decompress snapshot: ' + error.message);
  }
  if (expanded.length > MAX_EXPANDED_BYTES) throw new Error('expanded snapshot exceeds the 1 GiB size limit');
  let snapshot;
  try {
    snapshot = JSON.parse(expanded.toString('utf8'));
  } catch (error) {
    throw new Error('cannot parse snapshot JSON: ' + error.message);
  }
  return validateSnapshot(snapshot);
}

function currentSkillAt(destination, relativePath) {
  return portableSkill({
    path: destination,
    relativePath,
    directoryName: path.basename(destination),
    declaredName: '',
  });
}

function planSnapshotRestore(settings, snapshot) {
  validateSnapshot(snapshot);
  const actions = [];
  const unchanged = [];
  const conflicts = [];
  if (lexists(settings.libraryRoot) && !isDirectory(settings.libraryRoot)) {
    conflicts.push({
      severity: 'ERROR',
      code: 'SNAPSHOT_LIBRARY_CONFLICT',
      message: 'universal Skill library is not a directory',
      paths: [settings.libraryRoot],
    });
    return { actions, unchanged, conflicts };
  }
  snapshot.skills.forEach(function inspect(skill) {
    const destination = path.join(settings.libraryRoot, skill.path);
    if (!lexists(destination)) {
      actions.push({ kind: 'skill_create', skill_path: skill.path, path: destination });
      return;
    }
    if (!isDirectory(destination)) {
      conflicts.push({
        severity: 'ERROR',
        code: 'SNAPSHOT_SKILL_CONFLICT',
        message: 'refusing to replace an existing non-directory for ' + skill.path,
        paths: [destination],
      });
      return;
    }
    let current;
    try {
      current = currentSkillAt(destination, skill.path);
    } catch (error) {
      conflicts.push({
        severity: 'ERROR',
        code: 'SNAPSHOT_SKILL_CONFLICT',
        message: 'cannot compare existing Skill ' + skill.path + ': ' + error.message,
        paths: [destination],
      });
      return;
    }
    if (current.content_sha256 === skill.content_sha256) {
      unchanged.push({ skill_path: skill.path, path: destination });
    } else {
      conflicts.push({
        severity: 'ERROR',
        code: 'SNAPSHOT_SKILL_CONFLICT',
        message: 'refusing to overwrite a different user Skill: ' + skill.path,
        paths: [destination],
      });
    }
  });
  return { actions, unchanged, conflicts };
}

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

function materializeSkill(destination, skill) {
  fs.mkdirSync(destination, { mode: 0o755 });
  try {
    skill.files.forEach(function write(file) {
      const output = path.join.apply(path, [destination].concat(file.path.split('/')));
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o755 });
      const content = decodeBase64(file.content_base64, skill.path + '/' + file.path);
      fs.writeFileSync(output, content, { flag: 'wx', mode: file.mode });
      fs.chmodSync(output, file.mode);
    });
  } catch (error) {
    removeTree(destination);
    throw error;
  }
}

function applySnapshotRestore(settings, snapshot) {
  const plan = planSnapshotRestore(settings, snapshot);
  if (plan.conflicts.length > 0) throw new Error('snapshot restore has conflicts; no Skills were written');
  const created = [];
  const createdLibrary = !lexists(settings.libraryRoot);
  try {
    if (createdLibrary) fs.mkdirSync(settings.libraryRoot, { recursive: true, mode: 0o755 });
    plan.actions.forEach(function apply(action) {
      const skill = snapshot.skills.find(function matching(item) { return item.path === action.skill_path; });
      if (lexists(action.path)) throw new Error('Skill appeared during restore: ' + action.path);
      materializeSkill(action.path, skill);
      created.push(action.path);
      const restored = currentSkillAt(action.path, skill.path);
      if (restored.content_sha256 !== skill.content_sha256) throw new Error('post-restore checksum mismatch: ' + skill.path);
    });
  } catch (error) {
    created.slice().reverse().forEach(removeTree);
    if (createdLibrary && lexists(settings.libraryRoot) && fs.readdirSync(settings.libraryRoot).length === 0) {
      fs.rmdirSync(settings.libraryRoot);
    }
    throw error;
  }
  return { created, unchanged: plan.unchanged };
}

function verifySnapshot(settings, snapshot) {
  const plan = planSnapshotRestore(settings, snapshot);
  const snapshotPaths = new Set(snapshot.skills.map(function skillPath(skill) { return skill.path; }));
  const extra = discoverLibrary(settings).filter(function absent(skill) {
    return !snapshotPaths.has(skill.relativePath);
  }).map(function describe(skill) {
    return { skill_path: skill.relativePath, path: skill.path };
  });
  return {
    matched: plan.unchanged,
    missing: plan.actions,
    changed: plan.conflicts,
    extra,
    ok: plan.actions.length === 0 && plan.conflicts.length === 0 && extra.length === 0,
  };
}

function snapshotSummary(snapshot) {
  return {
    snapshot_id: snapshot.snapshot_id,
    scope: snapshot.scope,
    created_at: snapshot.created_at,
    ash_version: snapshot.ash_version,
    skill_count: snapshot.skills.length,
    file_count: snapshot.skills.reduce(function count(sum, skill) { return sum + skill.files.length; }, 0),
    omitted_count: snapshot.skills.reduce(function count(sum, skill) { return sum + skill.omitted.length; }, 0),
    materialized_symlink_count: snapshot.skills.filter(function linked(skill) {
      return skill.source_kind === 'materialized-symlink';
    }).length,
    excluded_sources: snapshot.excluded_sources,
  };
}

module.exports = {
  MAX_EXPANDED_BYTES,
  MAX_FILE_BYTES,
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_EXCLUDED_SOURCES,
  SNAPSHOT_KIND,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SCOPE,
  applySnapshotRestore,
  buildSnapshot,
  contentDigest,
  listPortableSkillContent,
  planSnapshotRestore,
  readSnapshot,
  snapshotDigest,
  snapshotSummary,
  validateSnapshot,
  verifySnapshot,
  writeSnapshot,
};
