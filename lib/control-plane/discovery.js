'use strict';

const fs = require('fs');
const path = require('path');

const { isDirectory, lexists } = require('./util');

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

function readIndentedPlainScalar(lines, startIndex, endIndex) {
  const parts = [];
  let baseIndent = null;
  let index = startIndex;
  while (index < endIndex) {
    const line = lines[index];
    if (!line.trim()) {
      if (baseIndent !== null) parts.push('');
      index += 1;
      continue;
    }
    const indentation = /^\s*/.exec(line)[0].length;
    if (indentation === 0) break;
    const selected = line.trim();
    if (baseIndent === null) {
      if (/^(?:[A-Za-z0-9_-]+\s*:|-\s|\[|\{)/.test(selected)) return null;
      baseIndent = indentation;
    } else if (indentation < baseIndent) {
      break;
    }
    parts.push(selected);
    index += 1;
  }
  if (baseIndent === null || !parts.some(function content(part) { return part; })) return null;
  return {
    value: unquote(parts.join(' ').replace(/\s+/g, ' ').trim()),
    nextIndex: index,
  };
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
      if (!value) {
        const plain = readIndentedPlainScalar(lines, index + 1, endIndex);
        if (plain) {
          rawValues[key] = plain.value;
          index = plain.nextIndex;
          continue;
        }
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

function discoverTopLevelSkills(root, excluded) {
  if (!isDirectory(root)) return [];
  const exclude = excluded || new Set();
  return fs.readdirSync(root, { withFileTypes: true }).filter(function valid(entry) {
    if (entry.name.charAt(0) === '.' || exclude.has(entry.name)) return false;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
    return fs.existsSync(path.join(root, entry.name, 'SKILL.md'));
  }).map(function parse(entry) {
    return parseSkill(path.join(root, entry.name), entry.name);
  }).sort(function byName(a, b) {
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function discoverLibrary(settings) {
  return discoverTopLevelSkills(settings.libraryRoot, settings.libraryExclude);
}

function issue(severity, code, message, paths) {
  return { severity, code, message, paths: paths || [] };
}

function readAgentsLock(lockPath) {
  if (!lexists(lockPath)) return { entries: {}, issues: [] };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return {
      entries: {},
      issues: [issue('ERROR', 'AGENTS_LOCK_INVALID', 'cannot read Agents installer lock: ' + error.message, [lockPath])],
    };
  }
  if (!payload || typeof payload !== 'object' || !payload.skills ||
      typeof payload.skills !== 'object' || Array.isArray(payload.skills)) {
    return {
      entries: {},
      issues: [issue('ERROR', 'AGENTS_LOCK_INVALID', 'Agents installer lock has no skills object', [lockPath])],
    };
  }
  const entries = {};
  const issues = [];
  Object.keys(payload.skills).forEach(function clean(name) {
    const value = payload.skills[name];
    if (!NAME_PATTERN.test(name)) {
      issues.push(issue('ERROR', 'AGENTS_LOCK_INVALID_ENTRY', 'Agents installer lock contains an invalid Skill name: ' + name, [lockPath]));
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) entries[name] = value;
  });
  return { entries, issues };
}

function brokenLibraryLinks(settings, knownNames) {
  if (!isDirectory(settings.libraryRoot)) return [];
  return fs.readdirSync(settings.libraryRoot, { withFileTypes: true }).filter(function broken(entry) {
    return entry.name.charAt(0) !== '.' && entry.isSymbolicLink() && !knownNames.has(entry.name) &&
      !fs.existsSync(path.join(settings.libraryRoot, entry.name, 'SKILL.md'));
  }).map(function record(entry) {
    const linkPath = path.join(settings.libraryRoot, entry.name);
    let detail = '';
    try { detail = fs.readlinkSync(linkPath); } catch (error) { detail = error.message; }
    return {
      name: entry.name,
      declared_name: '',
      relative_path: entry.name,
      source: 'user-library',
      status: 'broken',
      path: linkPath,
      detail,
    };
  });
}

function buildInventory(settings) {
  const library = discoverLibrary(settings);
  const lock = readAgentsLock(settings.agentsLock);
  const libraryNames = new Set(library.map(function name(skill) { return skill.directoryName; }));
  const records = library.map(function record(skill) {
    const provenance = lock.entries[skill.directoryName];
    return {
      name: skill.directoryName,
      declared_name: skill.declaredName,
      relative_path: skill.relativePath,
      source: 'user-library',
      status: 'available',
      path: skill.path,
      detail: provenance ? String(provenance.source || provenance.sourceUrl || 'installer-managed') : '',
    };
  });
  records.push.apply(records, brokenLibraryLinks(settings, libraryNames));
  Object.keys(lock.entries).sort().forEach(function missing(name) {
    if (libraryNames.has(name)) return;
    records.push({
      name,
      declared_name: '',
      relative_path: name,
      source: 'installer-lock',
      status: 'missing',
      path: path.join(settings.libraryRoot, name),
      detail: String(lock.entries[name].source || lock.entries[name].sourceUrl || ''),
    });
  });
  records.sort(function byName(a, b) {
    return a.name.localeCompare(b.name) || a.source.localeCompare(b.source);
  });
  return { records, diagnostics: lock.issues, library, lock: lock.entries };
}

module.exports = {
  NAME_PATTERN,
  buildInventory,
  discoverLibrary,
  discoverTopLevelSkills,
  issue,
  parseSkill,
  readIndentedPlainScalar,
  readAgentsLock,
};
