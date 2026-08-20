'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { discoverLibrary } = require('./discovery');
const { isDirectory, lexists } = require('./util');

function initializeLibrary(settings) {
  if (lexists(settings.libraryRoot) && !isDirectory(settings.libraryRoot)) {
    throw new Error('universal Skill library is not a directory: ' + settings.libraryRoot);
  }
  const createdLibrary = !lexists(settings.libraryRoot);
  fs.mkdirSync(settings.libraryRoot, { recursive: true, mode: 0o755 });
  return { createdLibrary, libraryRoot: settings.libraryRoot };
}

function findLibrarySkills(settings, query) {
  const selected = String(query || '').trim().toLowerCase();
  return discoverLibrary(settings).filter(function matches(skill) {
    if (!selected) return true;
    return skill.directoryName.toLowerCase().indexOf(selected) !== -1 ||
      skill.declaredName.toLowerCase().indexOf(selected) !== -1 ||
      skill.description.toLowerCase().indexOf(selected) !== -1;
  });
}

function findLibrarySkill(settings, name) {
  const selected = String(name || '').trim();
  const matches = discoverLibrary(settings).filter(function matching(skill) {
    return skill.directoryName === selected || skill.declaredName === selected;
  });
  if (matches.length === 0) throw new Error('unknown user Skill: ' + selected);
  if (matches.length > 1) throw new Error('ambiguous user Skill: ' + selected);
  return matches[0];
}

function syncRepository(settings, options) {
  const opts = options || {};
  const spawnSync = opts.spawnSync || childProcess.spawnSync;
  let updated = false;
  let output = '';
  if (isDirectory(path.join(settings.projectRoot, '.git'))) {
    const result = spawnSync('git', ['pull', '--ff-only'], {
      cwd: settings.projectRoot,
      encoding: 'utf8',
    });
    output = String(result.stdout || '') + String(result.stderr || '');
    if (result.status !== 0) throw new Error('git pull failed: ' + output.trim());
    updated = true;
  }
  return { updated, output };
}

module.exports = {
  findLibrarySkill,
  findLibrarySkills,
  initializeLibrary,
  syncRepository,
};
