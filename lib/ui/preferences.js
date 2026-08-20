'use strict';

const fs = require('fs');
const path = require('path');

const { discoverTopLevelSkills } = require('../control-plane/discovery');
const { expandPath, isDirectory, lexists, readJson, sha256, writeJsonAtomic } = require('../control-plane/util');

const UI_PREFERENCES_VERSION = 1;

function preferencesPath(settings) {
  return path.join(settings.stateDir, 'ui-preferences.json');
}

function emptyPreferences() {
  return { version: UI_PREFERENCES_VERSION, scan_roots: [] };
}

function validatePreferences(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.version !== UI_PREFERENCES_VERSION) {
    throw new Error('unsupported ASH UI preferences format');
  }
  if (!Array.isArray(payload.scan_roots)) throw new Error('ASH UI preferences scan_roots must be an array');
  const ids = new Set();
  const paths = new Set();
  payload.scan_roots.forEach(function validate(root) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('invalid ASH UI scan root');
    if (!/^scan-[a-f0-9]{12}$/.test(root.id)) throw new Error('invalid ASH UI scan root id');
    if (typeof root.name !== 'string' || !root.name.trim() || root.name.length > 64) throw new Error('invalid ASH UI scan root name');
    if (typeof root.path !== 'string' || !path.isAbsolute(root.path)) throw new Error('invalid ASH UI scan root path');
    if (ids.has(root.id) || paths.has(root.path)) throw new Error('duplicate ASH UI scan root');
    ids.add(root.id);
    paths.add(root.path);
  });
  return {
    version: UI_PREFERENCES_VERSION,
    scan_roots: payload.scan_roots.map(function copy(root) {
      return { id: root.id, name: root.name, path: root.path, added_at: root.added_at || null };
    }),
  };
}

function readPreferences(settings) {
  const selected = preferencesPath(settings);
  if (!lexists(selected)) return emptyPreferences();
  return validatePreferences(readJson(selected));
}

function writePreferences(settings, preferences) {
  const validated = validatePreferences(preferences);
  writeJsonAtomic(preferencesPath(settings), validated);
  return validated;
}

function canonicalDirectory(directoryPath) {
  if (!isDirectory(directoryPath)) throw new Error('scan path is not an existing directory: ' + directoryPath);
  return fs.realpathSync(directoryPath);
}

function resolveScanRoot(settings, rawPath, rawName) {
  const expanded = expandPath(String(rawPath || '').trim(), {
    env: settings.env,
    homeDir: settings.homeDir,
    projectRoot: settings.projectRoot,
  });
  const selected = canonicalDirectory(expanded);
  const primary = isDirectory(settings.libraryRoot) ? fs.realpathSync(settings.libraryRoot) : path.resolve(settings.libraryRoot);
  if (selected === primary) throw new Error('scan path is already the managed user library');
  const name = String(rawName || path.basename(selected) || 'Custom library').trim();
  if (!name || name.length > 64 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('scan root name must be 1-64 visible characters');
  }
  const skills = discoverTopLevelSkills(selected, new Set());
  const signature = sha256(Buffer.from(JSON.stringify(skills.map(function describe(skill) {
    const skillFile = path.join(skill.path, 'SKILL.md');
    return {
      name: skill.directoryName,
      path: skill.path,
      hash: sha256(fs.readFileSync(skillFile)),
    };
  })), 'utf8'));
  return {
    id: 'scan-' + sha256(Buffer.from(selected, 'utf8')).slice(0, 12),
    name,
    path: selected,
    skill_count: skills.length,
    signature,
  };
}

function addScanRoot(settings, root, now) {
  const preferences = readPreferences(settings);
  if (preferences.scan_roots.some(function existing(item) { return item.id === root.id || item.path === root.path; })) {
    throw new Error('scan path is already configured: ' + root.path);
  }
  preferences.scan_roots.push({
    id: root.id,
    name: root.name,
    path: root.path,
    added_at: (now || new Date()).toISOString(),
  });
  preferences.scan_roots.sort(function byName(a, b) { return a.name.localeCompare(b.name) || a.path.localeCompare(b.path); });
  return writePreferences(settings, preferences);
}

function removeScanRoot(settings, id) {
  const preferences = readPreferences(settings);
  const index = preferences.scan_roots.findIndex(function matching(root) { return root.id === id; });
  if (index === -1) throw new Error('unknown custom scan root: ' + id);
  const removed = preferences.scan_roots.splice(index, 1)[0];
  writePreferences(settings, preferences);
  return removed;
}

module.exports = {
  UI_PREFERENCES_VERSION,
  addScanRoot,
  emptyPreferences,
  preferencesPath,
  readPreferences,
  removeScanRoot,
  resolveScanRoot,
  validatePreferences,
  writePreferences,
};
