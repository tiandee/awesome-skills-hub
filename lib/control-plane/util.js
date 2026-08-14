'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.local',
  '__pycache__',
  'node_modules',
]);
const IGNORED_FILE_NAMES = new Set(['.DS_Store', '.env']);

function lexists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function canonicalPath(filePath) {
  const absolute = path.resolve(filePath);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(absolute) : fs.realpathSync(absolute);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return absolute;
    throw error;
  }
}

function expandPath(value, options) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('configured path must be a non-empty string');
  }
  const opts = options || {};
  const env = opts.env || process.env;
  const homeDir = opts.homeDir || env.HOME || env.USERPROFILE || os.homedir();
  const projectRoot = opts.projectRoot || process.cwd();
  let expanded = value;
  if (expanded === '~') expanded = homeDir;
  else if (expanded.indexOf('~/') === 0 || expanded.indexOf('~\\') === 0) {
    expanded = path.join(homeDir, expanded.slice(2));
  }
  expanded = expanded.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, function replaceEnv(match, braced, plain) {
    const key = braced || plain;
    return Object.prototype.hasOwnProperty.call(env, key) ? String(env[key]) : match;
  });
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(projectRoot, expanded));
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function atomicWrite(filePath, content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    '.' + path.basename(filePath) + '.ash-' + process.pid + '-' + crypto.randomBytes(6).toString('hex'),
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (lexists(temporary)) fs.unlinkSync(temporary);
  }
}

function writeJsonAtomic(filePath, payload) {
  atomicWrite(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function readJson(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error('cannot read JSON file ' + filePath + ': ' + error.message);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('invalid JSON in ' + filePath + ': ' + error.message);
  }
}

function listSkillFiles(skillRoot) {
  const results = [];

  function visit(current, relativeParts) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort(function byName(a, b) {
      return a.name.localeCompare(b.name);
    });
    entries.forEach(function inspect(entry) {
      if (entry.isSymbolicLink()) return;
      const relative = relativeParts.concat(entry.name);
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) visit(fullPath, relative);
        return;
      }
      if (!entry.isFile()) return;
      if (IGNORED_FILE_NAMES.has(entry.name) || /\.(?:pyc|pyo)$/.test(entry.name)) return;
      results.push({ path: fullPath, relative: relative.join('/') });
    });
  }

  visit(skillRoot, []);
  return results;
}

function timestampId(now) {
  const selected = now || new Date();
  const base = selected.toISOString().replace(/[-:]/g, '').replace(/\.([0-9]{3})Z$/, '$1');
  return base + 'Z-' + crypto.randomBytes(3).toString('hex');
}

function createDirectoryLink(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

module.exports = {
  IGNORED_DIRECTORY_NAMES,
  IGNORED_FILE_NAMES,
  atomicWrite,
  canonicalPath,
  createDirectoryLink,
  expandPath,
  isDirectory,
  lexists,
  listSkillFiles,
  readJson,
  sha256,
  timestampId,
  writeJsonAtomic,
};
