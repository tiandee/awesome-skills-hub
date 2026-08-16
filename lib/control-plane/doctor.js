'use strict';

const fs = require('fs');
const path = require('path');

const { archiveContentStatus } = require('./archive');
const { catalogIsCurrent } = require('./catalog');
const { codexGuidanceIssues } = require('./codex-guidance');
const { targetIncludes, targetIsActive } = require('./config');
const {
  NAME_PATTERN,
  buildInventory,
  discoverLibrary,
  issue,
  linkStatus,
} = require('./discovery');
const { canonicalPath, isDirectory, lexists, listSkillFiles } = require('./util');

const HARDCODED_CODEX_SKILLS = /(?:~\/\.codex\/skills|\/Users\/[^/\s`]+\/\.codex\/skills)/;

function metadataIssues(settings, library) {
  const issues = [];
  const missingOpenai = [];
  const byName = new Map();
  library.forEach(function inspect(skill) {
    if (!byName.has(skill.directoryName)) byName.set(skill.directoryName, []);
    byName.get(skill.directoryName).push(skill.path);
    skill.parseErrors.forEach(function parseError(message) {
      issues.push(issue('ERROR', 'SKILL_FRONTMATTER', message, [path.join(skill.path, 'SKILL.md')]));
    });
    if (!skill.declaredName) {
      issues.push(issue(
        'ERROR',
        'SKILL_NAME_MISSING',
        skill.relativePath + ' has no frontmatter name',
        [path.join(skill.path, 'SKILL.md')],
      ));
    } else if (!NAME_PATTERN.test(skill.declaredName)) {
      issues.push(issue(
        'ERROR',
        'SKILL_NAME_INVALID',
        skill.declaredName + ' is not a valid Agent Skill name',
        [path.join(skill.path, 'SKILL.md')],
      ));
    } else if (skill.declaredName !== skill.directoryName) {
      issues.push(issue(
        'ERROR',
        'SKILL_NAME_MISMATCH',
        skill.relativePath + ' declares name ' + skill.declaredName,
        [path.join(skill.path, 'SKILL.md')],
      ));
    }
    if (!skill.description) {
      issues.push(issue(
        'ERROR',
        'SKILL_DESCRIPTION_MISSING',
        skill.relativePath + ' has no frontmatter description',
        [path.join(skill.path, 'SKILL.md')],
      ));
    } else if (skill.description.length > 1024) {
      issues.push(issue(
        'ERROR',
        'SKILL_DESCRIPTION_TOO_LONG',
        skill.relativePath + ' description has ' + skill.description.length + ' characters; maximum is 1024',
        [path.join(skill.path, 'SKILL.md')],
      ));
    }
    if (skill.lineCount > 500) {
      issues.push(issue(
        'WARN',
        'SKILL_BODY_LARGE',
        skill.relativePath + ' has ' + skill.lineCount + ' lines; split detailed material into references',
        [path.join(skill.path, 'SKILL.md')],
      ));
    }
    if (!fs.existsSync(path.join(skill.path, 'agents', 'openai.yaml'))) missingOpenai.push(skill.path);
  });
  byName.forEach(function reportDuplicate(paths, name) {
    if (paths.length > 1) {
      issues.push(issue(
        'ERROR',
        'SKILL_NAME_DUPLICATE',
        name + ' appears in multiple universal library paths',
        paths,
      ));
    }
  });
  if (missingOpenai.length > 0) {
    issues.push(issue(
      'INFO',
      'OPENAI_METADATA_OPTIONAL',
      missingOpenai.length + ' library skills do not have optional agents/openai.yaml metadata',
      missingOpenai,
    ));
  }
  return issues;
}

function linkIssues(settings, library) {
  const issues = [];
  const inactive = settings.targets.filter(function inactiveTarget(target) {
    return !targetIsActive(target);
  });
  if (inactive.length > 0) {
    issues.push(issue(
      'INFO',
      'TARGETS_INACTIVE',
      inactive.length + ' target(s) are not installed/detected: ' + inactive.map(function name(target) { return target.name; }).join(', '),
      inactive.map(function targetPath(target) { return target.path; }),
    ));
  }
  settings.targets.filter(targetIsActive).forEach(function inspectTarget(target) {
    if (lexists(target.path) && !isDirectory(target.path)) {
      issues.push(issue(
        'ERROR',
        'TARGET_NOT_DIRECTORY',
        'configured target is not a directory: ' + target.path,
        [target.path],
      ));
      return;
    }
    library.filter(function selected(skill) {
      return targetIncludes(target, skill.directoryName);
    }).forEach(function inspectSkill(skill) {
      const installPath = path.join(target.path, skill.directoryName);
      const status = linkStatus(installPath, skill.path);
      if (status.status === 'missing') {
        issues.push(issue(
          'WARN',
          'ASH_LINK_MISSING',
          skill.directoryName + ' is missing from target ' + target.name,
          [skill.path, installPath],
        ));
      } else if (status.status === 'broken') {
        issues.push(issue(
          'WARN',
          'ASH_LINK_BROKEN',
          skill.directoryName + ' has a broken link in target ' + target.name + ' (' + status.current + ')',
          [skill.path, installPath],
        ));
      } else if (status.status === 'conflict') {
        issues.push(issue(
          'ERROR',
          'ASH_LINK_CONFLICT',
          skill.directoryName + ' target path is owned by something else in ' + target.name + ' (' + status.current + ')',
          [skill.path, installPath],
        ));
      }
    });
  });
  return issues;
}

function runtimeIssues(settings, inventory) {
  const issues = inventory.diagnostics.slice();
  const records = inventory.records;
  const missingThirdParty = records.filter(function missing(record) {
    return record.source === 'third-party' && record.status === 'missing';
  });
  if (missingThirdParty.length > 0) {
    issues.push(issue(
      'WARN',
      'THIRD_PARTY_MISSING',
      missingThirdParty.length + ' lock-file skills are missing from the agents skill root',
      missingThirdParty.map(function recordPath(record) { return record.path; }),
    ));
  }
  const missingStore = records.filter(function missing(record) {
    return record.source === 'codex-store' && record.status === 'missing';
  });
  if (missingStore.length > 0) {
    issues.push(issue(
      'WARN',
      'CODEX_STORE_MISSING',
      missingStore.length + ' Codex Store lock entries are missing on disk',
      missingStore.map(function recordPath(record) { return record.path; }),
    ));
  }
  const untrackedAgents = records.filter(function untracked(record) {
    return record.source === 'untracked-agents';
  });
  if (untrackedAgents.length > 0) {
    let examples = untrackedAgents.slice(0, 12).map(function name(record) { return record.name; }).join(', ');
    if (untrackedAgents.length > 12) examples += ', …';
    issues.push(issue(
      'WARN',
      'AGENTS_SKILLS_UNTRACKED',
      untrackedAgents.length + ' agent-root skills are outside ASH and the configured third-party lock; examples: ' + examples,
      untrackedAgents.map(function recordPath(record) { return record.path; }),
    ));
  }
  const brokenLibrary = records.filter(function broken(record) {
    return record.source === 'agents-library' && record.status === 'broken';
  });
  if (brokenLibrary.length > 0) {
    issues.push(issue(
      'WARN',
      'AGENTS_LIBRARY_BROKEN',
      brokenLibrary.length + ' universal library link(s) are broken',
      brokenLibrary.map(function recordPath(record) { return record.path; }),
    ));
  }
  const untrackedCodex = records.filter(function untracked(record) {
    return record.source === 'untracked-codex';
  });
  const installedStore = records.filter(function installed(record) {
    if (record.source !== 'codex-store' || record.status !== 'installed') return false;
    const relative = path.relative(canonicalPath(settings.codexRoot), canonicalPath(record.path));
    return relative !== '' && relative !== '..' &&
      relative.indexOf('..' + path.sep) !== 0 && !path.isAbsolute(relative);
  });
  if (settings.codexUserSkillsPolicy === 'migrate-to-agents' &&
      (untrackedCodex.length > 0 || installedStore.length > 0)) {
    const outside = installedStore.concat(untrackedCodex).sort(function byPath(a, b) {
      return a.path.localeCompare(b.path);
    });
    issues.push(issue(
      'WARN',
      'CODEX_USER_SKILLS_OUTSIDE_AGENTS',
      outside.length + ' user-installed Codex Skill(s) must migrate to the universal Agents library: ' +
        outside.map(function name(record) { return record.name; }).join(', '),
      outside.map(function recordPath(record) { return record.path; }),
    ));
  } else if (untrackedCodex.length > 0) {
    issues.push(issue(
      'WARN',
      'CODEX_SKILLS_UNTRACKED',
      untrackedCodex.length + ' Codex-root skills are not owned by the Store or system catalog: ' +
        untrackedCodex.map(function name(record) { return record.name; }).join(', '),
      untrackedCodex.map(function recordPath(record) { return record.path; }),
    ));
  }

  const sourcesByName = new Map();
  const pathsByName = new Map();
  records.forEach(function group(record) {
    if (!sourcesByName.has(record.name)) sourcesByName.set(record.name, new Set());
    if (!pathsByName.has(record.name)) pathsByName.set(record.name, []);
    sourcesByName.get(record.name).add(record.source);
    pathsByName.get(record.name).push(record.path);
  });
  sourcesByName.forEach(function report(sources, name) {
    if (sources.has('agents-library') && sources.has('third-party')) {
      issues.push(issue(
        'WARN',
        'MULTIPLE_MANAGERS',
        name + ' is present in both the configured library and the third-party lock',
        pathsByName.get(name),
      ));
    }
  });
  return issues;
}

function artifactIssues(settings, library) {
  const issues = [];
  if (!catalogIsCurrent(settings, library)) {
    issues.push(issue(
      'WARN',
      'CATALOG_STALE',
      'generated ASH Skill catalog is missing or stale',
      [settings.catalogPath],
    ));
  }
  library.forEach(function inspect(skill) {
    const archive = path.join(settings.packageOutputDir, skill.directoryName + '.skill');
    if (!fs.existsSync(archive)) return;
    const status = archiveContentStatus(archive, skill);
    if (!status.current) {
      issues.push(issue(
        'WARN',
        'PACKAGE_STALE',
        path.basename(archive) + ' does not match its source: ' + status.detail,
        [archive, skill.path],
      ));
    }
  });
  return issues;
}

function hardcodedPathIssues(settings, library) {
  const matches = [];
  library.forEach(function inspect(skill) {
    listSkillFiles(skill.path).filter(function markdown(file) {
      return /\.md$/i.test(file.relative);
    }).forEach(function scan(file) {
      let content;
      try {
        content = fs.readFileSync(file.path, 'utf8');
      } catch (error) {
        return;
      }
      if (HARDCODED_CODEX_SKILLS.test(content)) matches.push(file.path);
    });
  });
  if (matches.length === 0) return [];
  return [issue(
    'WARN',
    'HARDCODED_SKILL_ROOT',
    matches.length + ' Markdown file(s) hard-code ~/.codex/skills; use a runtime-neutral path or resolver',
    Array.from(new Set(matches)).sort(),
  )];
}

function runDoctor(settings) {
  if (!isDirectory(settings.libraryRoot)) {
    return [issue(
      'ERROR',
      'ASH_LIBRARY_NOT_FOUND',
      'Universal Skill library is not present: ' + settings.libraryRoot,
      [settings.libraryRoot],
    )];
  }
  const inventory = buildInventory(settings);
  const issues = [];
  if (inventory.library.length === 0) {
    issues.push(issue('WARN', 'ASH_LIBRARY_EMPTY', 'Universal Skill library contains no directory Skills', [settings.libraryRoot]));
  }
  issues.push.apply(issues, metadataIssues(settings, inventory.library));
  issues.push.apply(issues, linkIssues(settings, inventory.library));
  issues.push.apply(issues, runtimeIssues(settings, inventory));
  issues.push.apply(issues, codexGuidanceIssues(settings));
  issues.push.apply(issues, artifactIssues(settings, inventory.library));
  issues.push.apply(issues, hardcodedPathIssues(settings, inventory.library));
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  issues.sort(function sortIssues(a, b) {
    return (order[a.severity] - order[b.severity]) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message);
  });
  return issues;
}

function doctorExitCode(issues) {
  if (issues.some(function error(issueItem) { return issueItem.severity === 'ERROR'; })) return 2;
  if (issues.some(function warning(issueItem) { return issueItem.severity === 'WARN'; })) return 1;
  return 0;
}

module.exports = {
  doctorExitCode,
  runDoctor,
};
