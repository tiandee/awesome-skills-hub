'use strict';

const fs = require('fs');
const path = require('path');

const { archiveContentStatus } = require('./archive');
const { codexGuidanceIssues } = require('./codex-guidance');
const { NAME_PATTERN, buildInventory, issue } = require('./discovery');
const { isDirectory, listSkillFiles } = require('./util');

const HARDCODED_CODEX_SKILLS = /(?:~\/\.codex\/skills|\/Users\/[^/\s`]+\/\.codex\/skills)/;
const RETIRED_ASH_COMMAND = /\bash\s+(?:add|catalog|install|status|clean|uninstall)\b/;

function metadataIssues(library) {
  const issues = [];
  const byDeclaredName = new Map();
  library.forEach(function inspect(skill) {
    const skillFile = path.join(skill.path, 'SKILL.md');
    skill.parseErrors.forEach(function parseError(message) {
      issues.push(issue('ERROR', 'SKILL_FRONTMATTER', message, [skillFile]));
    });
    if (!skill.declaredName) {
      issues.push(issue('ERROR', 'SKILL_NAME_MISSING', skill.relativePath + ' has no frontmatter name', [skillFile]));
    } else if (!NAME_PATTERN.test(skill.declaredName)) {
      issues.push(issue('ERROR', 'SKILL_NAME_INVALID', skill.declaredName + ' is not a valid Agent Skill name', [skillFile]));
    } else {
      if (!byDeclaredName.has(skill.declaredName)) byDeclaredName.set(skill.declaredName, []);
      byDeclaredName.get(skill.declaredName).push(skill.path);
      if (skill.declaredName !== skill.directoryName) {
        issues.push(issue(
          'ERROR',
          'SKILL_NAME_MISMATCH',
          skill.relativePath + ' declares name ' + skill.declaredName,
          [skillFile],
        ));
      }
    }
    if (!skill.description) {
      issues.push(issue('ERROR', 'SKILL_DESCRIPTION_MISSING', skill.relativePath + ' has no frontmatter description', [skillFile]));
    } else if (skill.description.length > 1024) {
      issues.push(issue(
        'ERROR',
        'SKILL_DESCRIPTION_TOO_LONG',
        skill.relativePath + ' description has ' + skill.description.length + ' characters; maximum is 1024',
        [skillFile],
      ));
    }
    if (skill.lineCount > 500) {
      issues.push(issue(
        'WARN',
        'SKILL_BODY_LARGE',
        skill.relativePath + ' has ' + skill.lineCount + ' lines; split detailed material into references',
        [skillFile],
      ));
    }
  });
  byDeclaredName.forEach(function duplicate(paths, name) {
    if (paths.length > 1) issues.push(issue('ERROR', 'SKILL_NAME_DUPLICATE', name + ' is declared by multiple user Skills', paths));
  });
  return issues;
}

function libraryStateIssues(inventory) {
  const issues = inventory.diagnostics.slice();
  const broken = inventory.records.filter(function matching(record) {
    return record.source === 'user-library' && record.status === 'broken';
  });
  if (broken.length) {
    issues.push(issue(
      'ERROR',
      'USER_SKILL_LINK_BROKEN',
      broken.length + ' top-level user Skill link(s) are broken',
      broken.map(function recordPath(record) { return record.path; }),
    ));
  }
  const missing = inventory.records.filter(function matching(record) {
    return record.source === 'installer-lock' && record.status === 'missing';
  });
  if (missing.length) {
    issues.push(issue(
      'WARN',
      'USER_SKILL_LOCK_MISSING',
      missing.length + ' Agents installer lock entr' + (missing.length === 1 ? 'y is' : 'ies are') + ' missing from the user library',
      missing.map(function recordPath(record) { return record.path; }),
    ));
  }
  return issues;
}

function artifactIssues(settings, library) {
  const issues = [];
  library.forEach(function inspect(skill) {
    const archive = path.join(settings.packageOutputDir, skill.directoryName + '.skill');
    if (!fs.existsSync(archive)) return;
    const status = archiveContentStatus(archive, skill);
    if (!status.current) {
      issues.push(issue(
        'WARN',
        'PACKAGE_STALE',
        path.basename(archive) + ' does not match its user Skill: ' + status.detail,
        [archive, skill.path],
      ));
    }
  });
  return issues;
}

function hardcodedPathIssues(library) {
  const matches = [];
  library.forEach(function inspect(skill) {
    listSkillFiles(skill.path).filter(function markdown(file) {
      return /\.md$/i.test(file.relative);
    }).forEach(function scan(file) {
      let content;
      try { content = fs.readFileSync(file.path, 'utf8'); } catch (error) { return; }
      if (HARDCODED_CODEX_SKILLS.test(content)) matches.push(file.path);
    });
  });
  if (!matches.length) return [];
  return [issue(
    'WARN',
    'HARDCODED_SKILL_ROOT',
    matches.length + ' Markdown file(s) hard-code ~/.codex/skills; use ~/.agents/skills or a runtime-neutral resolver',
    Array.from(new Set(matches)).sort(),
  )];
}

function retiredCommandIssues(library) {
  const matches = [];
  library.forEach(function inspect(skill) {
    listSkillFiles(skill.path).filter(function markdown(file) {
      return /\.md$/i.test(file.relative);
    }).forEach(function scan(file) {
      let content;
      try { content = fs.readFileSync(file.path, 'utf8'); } catch (error) { return; }
      if (RETIRED_ASH_COMMAND.test(content)) matches.push(file.path);
    });
  });
  if (!matches.length) return [];
  return [issue(
    'WARN',
    'RETIRED_ASH_COMMAND',
    matches.length + ' Markdown file(s) reference removed ASH v1 commands; use standard Agents installers or v2 library commands',
    Array.from(new Set(matches)).sort(),
  )];
}

function runDoctor(settings) {
  if (!isDirectory(settings.libraryRoot)) {
    return [issue(
      'ERROR',
      'USER_LIBRARY_NOT_FOUND',
      'User Skill library is not present: ' + settings.libraryRoot,
      [settings.libraryRoot],
    )];
  }
  const inventory = buildInventory(settings);
  const issues = [];
  if (!inventory.library.length) {
    issues.push(issue('WARN', 'USER_LIBRARY_EMPTY', 'User Skill library contains no top-level Skills', [settings.libraryRoot]));
  }
  issues.push.apply(issues, metadataIssues(inventory.library));
  issues.push.apply(issues, libraryStateIssues(inventory));
  issues.push.apply(issues, codexGuidanceIssues(settings));
  issues.push.apply(issues, artifactIssues(settings, inventory.library));
  issues.push.apply(issues, hardcodedPathIssues(inventory.library));
  issues.push.apply(issues, retiredCommandIssues(inventory.library));
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  issues.sort(function sortIssues(a, b) {
    return (order[a.severity] - order[b.severity]) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message);
  });
  return issues;
}

function doctorExitCode(issues) {
  if (issues.some(function error(item) { return item.severity === 'ERROR'; })) return 2;
  if (issues.some(function warning(item) { return item.severity === 'WARN'; })) return 1;
  return 0;
}

module.exports = {
  doctorExitCode,
  metadataIssues,
  runDoctor,
};
