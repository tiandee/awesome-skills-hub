'use strict';

const path = require('path');

const { archiveContentStatus, writePackages } = require('./archive');
const { catalogIsCurrent, generateCatalog, writeCatalog } = require('./catalog');
const { loadSettings } = require('./config');
const { createSkill } = require('./create');
const { buildInventory, discoverLibrary } = require('./discovery');
const { doctorExitCode, runDoctor } = require('./doctor');
const {
  actionDescription,
  applyRepair,
  applyRollback,
  buildRepairPlan,
  rollbackPreview,
} = require('./repair');

function writeLine(stream, value) {
  stream.write(String(value) + '\n');
}

function takeOption(args, name) {
  const prefix = name + '=';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].indexOf(prefix) === 0) {
      const value = args[index].slice(prefix.length);
      args.splice(index, 1);
      return value;
    }
    if (args[index] === name) {
      if (index + 1 >= args.length) throw new Error(name + ' requires a value');
      const value = args[index + 1];
      args.splice(index, 2);
      return value;
    }
  }
  return null;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function repeatableOption(args, name) {
  const values = [];
  let value;
  do {
    value = takeOption(args, name);
    if (value !== null) values.push(value);
  } while (value !== null);
  return values;
}

function helpText() {
  return [
    'ASH Skill Control Plane',
    '',
    'Usage: ash <command> [options]',
    '',
    'Commands:',
    '  create <NAME> [--description TEXT]  Scaffold a user Skill in ~/.agents/skills',
    '  inventory [--source NAME] [--json]  List Skills across all known sources',
    '  doctor [--verbose] [--json]         Audit metadata, links, locks, and artifacts',
    '  repair [--apply] [--scope NAME]     Preview or apply deterministic safe repairs',
    '  rollback [latest|ID] [--apply]      Preview or apply a repair rollback',
    '  catalog [--check|--write]           Print, verify, or write the generated catalog',
    '  package <SKILL...> [--all]          Create deterministic .skill archives',
    '',
    'Global options:',
    '  --config PATH  Use another control-plane configuration',
    '  --home PATH    Resolve ~ against another home directory',
    '',
    'Repair is dry-run by default. Codex user Skills migrate only when the',
    'configured policy opts in; system Skills and plugin caches stay read-only.',
  ].join('\n');
}

function recordTable(records, stdout) {
  if (records.length === 0) {
    writeLine(stdout, 'No skills found.');
    return;
  }
  const nameWidth = Math.min(36, Math.max(4, ...records.map(function length(record) { return record.name.length; })));
  const sourceWidth = Math.min(18, Math.max(6, ...records.map(function length(record) { return record.source.length; })));
  const statusWidth = Math.min(12, Math.max(6, ...records.map(function length(record) { return record.status.length; })));
  const pad = function pad(value, width) { return String(value).slice(0, width).padEnd(width); };
  const header = pad('NAME', nameWidth) + '  ' + pad('SOURCE', sourceWidth) + '  ' + pad('STATUS', statusWidth) + '  LOCATION / DETAIL';
  writeLine(stdout, header);
  writeLine(stdout, '-'.repeat(header.length));
  records.forEach(function row(record) {
    const location = record.path + (record.detail ? ' [' + record.detail + ']' : '');
    writeLine(stdout, pad(record.name, nameWidth) + '  ' + pad(record.source, sourceWidth) + '  ' + pad(record.status, statusWidth) + '  ' + location);
  });
  const counts = new Map();
  records.forEach(function count(record) { counts.set(record.source, (counts.get(record.source) || 0) + 1); });
  const summary = Array.from(counts.keys()).sort().map(function item(name) {
    return name + '=' + counts.get(name);
  }).join(', ');
  writeLine(stdout, '\nTotal: ' + records.length + ' (' + summary + ')');
}

function printableAction(action) {
  return {
    kind: action.kind,
    scope: action.scope || null,
    path: action.path,
    source: action.source || null,
    target: action.target || null,
    old_target: action.oldTarget || null,
    description: actionDescription(action),
  };
}

function selectPackageSkills(settings, names, allSkills) {
  const library = discoverLibrary(settings);
  if (allSkills) return library;
  if (names.length === 0) throw new Error('specify one or more skill names, or pass --all');
  const byName = new Map();
  library.forEach(function group(skill) {
    if (!byName.has(skill.directoryName)) byName.set(skill.directoryName, []);
    byName.get(skill.directoryName).push(skill);
  });
  const missing = names.filter(function absent(name) { return !byName.has(name); });
  if (missing.length > 0) throw new Error('unknown library skills: ' + missing.join(', '));
  const ambiguous = names.filter(function duplicate(name) { return byName.get(name).length !== 1; });
  if (ambiguous.length > 0) throw new Error('ambiguous library skills: ' + ambiguous.join(', '));
  return names.map(function selected(name) { return byName.get(name)[0]; });
}

function main(argv, options) {
  const opts = options || {};
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const env = opts.env || process.env;
  const args = (argv || []).slice();
  try {
    const configPath = takeOption(args, '--config');
    const homeDir = takeOption(args, '--home');
    const command = args.shift();
    if (!command || command === 'help' || command === '-h' || command === '--help') {
      writeLine(stdout, helpText());
      return 0;
    }
    const settings = loadSettings({
      projectRoot: opts.projectRoot,
      configPath: configPath || undefined,
      homeDir: homeDir || undefined,
      env,
    });

    if (command === 'create') {
      const json = takeFlag(args, '--json');
      let description = takeOption(args, '--description');
      if (description === null) description = takeOption(args, '-d');
      const name = args.shift();
      if (!name) throw new Error('create requires a Skill name');
      if (args.length) throw new Error('unknown create option: ' + args[0]);
      const created = createSkill(settings, name, { description: description === null ? undefined : description });
      if (json) {
        writeLine(stdout, JSON.stringify(created, null, 2));
      } else {
        writeLine(stdout, 'Created Skill scaffold: ' + created.path);
        created.files.forEach(function print(filePath) { writeLine(stdout, '  - ' + filePath); });
        if (created.usedDefaultDescription) {
          writeLine(stdout, 'Note: replace the conservative default description before relying on implicit invocation.');
        }
        writeLine(stdout, 'Next: finish SKILL.md, verify agents/openai.yaml, then run ash doctor.');
      }
      return 0;
    }

    if (command === 'inventory' || command === 'sources') {
      const json = takeFlag(args, '--json');
      const sources = repeatableOption(args, '--source');
      if (args.length) throw new Error('unknown inventory option: ' + args[0]);
      const inventory = buildInventory(settings);
      const selected = sources.length
        ? inventory.records.filter(function filter(record) { return sources.indexOf(record.source) !== -1; })
        : inventory.records;
      if (json) {
        writeLine(stdout, JSON.stringify({ skills: selected, diagnostics: inventory.diagnostics }, null, 2));
      } else {
        recordTable(selected, stdout);
        inventory.diagnostics.forEach(function diagnostic(item) {
          writeLine(stderr, item.severity + ' ' + item.code + ': ' + item.message);
        });
      }
      return inventory.diagnostics.some(function error(item) { return item.severity === 'ERROR'; }) ? 2 : 0;
    }

    if (command === 'doctor') {
      const json = takeFlag(args, '--json');
      const verbose = takeFlag(args, '--verbose');
      if (args.length) throw new Error('unknown doctor option: ' + args[0]);
      const issues = runDoctor(settings);
      const exitCode = doctorExitCode(issues);
      if (json) {
        writeLine(stdout, JSON.stringify({ issues, exit_code: exitCode }, null, 2));
      } else if (issues.length === 0) {
        writeLine(stdout, 'PASSED: no issues found');
      } else {
        issues.forEach(function print(item) {
          writeLine(stdout, '[' + item.severity + '] ' + item.code + ': ' + item.message);
          if (verbose) item.paths.forEach(function printPath(itemPath) { writeLine(stdout, '  - ' + itemPath); });
        });
        const count = function count(severity) {
          return issues.filter(function matching(item) { return item.severity === severity; }).length;
        };
        writeLine(stdout, '\nSummary: errors=' + count('ERROR') + ', warnings=' + count('WARN') + ', info=' + count('INFO'));
      }
      return exitCode;
    }

    if (command === 'repair') {
      const apply = takeFlag(args, '--apply');
      const json = takeFlag(args, '--json');
      const scope = takeOption(args, '--scope') || 'all';
      if (args.length) throw new Error('unknown repair option: ' + args[0]);
      const plan = buildRepairPlan(settings, { scope });
      if (json && !apply) {
        writeLine(stdout, JSON.stringify({ mode: 'dry-run', actions: plan.actions.map(printableAction), conflicts: plan.conflicts }, null, 2));
        return plan.conflicts.length ? 1 : 0;
      }
      writeLine(stdout, 'Mode: ' + (apply ? 'APPLY' : 'DRY-RUN'));
      if (plan.actions.length) plan.actions.forEach(function print(action) { writeLine(stdout, actionDescription(action)); });
      else writeLine(stdout, 'No safe repairs are needed.');
      if (plan.conflicts.length) {
        writeLine(stdout, '\nSkipped conflicts:');
        plan.conflicts.forEach(function conflict(item) {
          writeLine(stdout, '[' + item.severity + '] ' + item.code + ': ' + item.message);
          item.paths.forEach(function printPath(itemPath) { writeLine(stdout, '  - ' + itemPath); });
        });
      }
      writeLine(stdout, '\nPlan: ' + plan.actions.length + ' safe action(s), ' + plan.conflicts.length + ' conflict(s)');
      if (!apply) {
        if (plan.actions.length) writeLine(stdout, 'Run again with --apply to execute this plan.');
        return plan.conflicts.length ? 1 : 0;
      }
      if (!plan.actions.length) return plan.conflicts.length ? 1 : 0;
      const transaction = applyRepair(settings, plan);
      writeLine(stdout, 'Applied successfully. Transaction: ' + transaction);
      if (scope !== 'all') {
        const remainingPlan = buildRepairPlan(settings, { scope });
        const remainingErrors = remainingPlan.conflicts.filter(function error(item) { return item.severity === 'ERROR'; });
        writeLine(
          stdout,
          'Post-repair scope check: ' + remainingPlan.actions.length + ' action(s), ' +
            remainingPlan.conflicts.length + ' conflict(s) remain.',
        );
        if (json) writeLine(stdout, JSON.stringify({ transaction, scope, remaining: remainingPlan }, null, 2));
        if (remainingErrors.length) return 2;
        return remainingPlan.actions.length || remainingPlan.conflicts.length ? 1 : 0;
      }
      const remaining = runDoctor(settings);
      const errors = remaining.filter(function error(item) { return item.severity === 'ERROR'; });
      writeLine(stdout, 'Post-repair check: ' + remaining.length + ' issue(s), ' + errors.length + ' error(s) remain.');
      if (json) writeLine(stdout, JSON.stringify({ transaction, issues: remaining }, null, 2));
      if (errors.length) return 2;
      return plan.conflicts.length ? 1 : 0;
    }

    if (command === 'rollback') {
      const apply = takeFlag(args, '--apply');
      const selector = args.shift() || 'latest';
      if (args.length) throw new Error('unknown rollback option: ' + args[0]);
      const preview = rollbackPreview(settings, selector);
      writeLine(stdout, 'Transaction: ' + preview.transactionFile);
      writeLine(stdout, 'Mode: ' + (apply ? 'APPLY' : 'DRY-RUN'));
      preview.descriptions.forEach(function print(description) { writeLine(stdout, description); });
      if (!apply) {
        writeLine(stdout, 'Run again with --apply to execute this rollback.');
        return 0;
      }
      writeLine(stdout, 'Rollback completed: ' + applyRollback(settings, selector));
      return 0;
    }

    if (command === 'catalog') {
      const check = takeFlag(args, '--check');
      const write = takeFlag(args, '--write');
      if (check && write) throw new Error('--check and --write are mutually exclusive');
      if (args.length) throw new Error('unknown catalog option: ' + args[0]);
      if (check) {
        if (catalogIsCurrent(settings)) {
          writeLine(stdout, 'Catalog is current: ' + settings.catalogPath);
          return 0;
        }
        writeLine(stdout, 'Catalog is missing or stale: ' + settings.catalogPath);
        return 1;
      }
      if (write) {
        writeLine(stdout, 'Wrote ' + writeCatalog(settings));
        return 0;
      }
      stdout.write(generateCatalog(settings));
      return 0;
    }

    if (command === 'package') {
      const allSkills = takeFlag(args, '--all');
      const check = takeFlag(args, '--check');
      const outputOption = takeOption(args, '--output');
      const names = args.filter(function skillName(item) { return item.indexOf('-') !== 0; });
      if (names.length !== args.length) throw new Error('unknown package option: ' + args.find(function option(item) { return item.indexOf('-') === 0; }));
      const skills = selectPackageSkills(settings, names, allSkills);
      const outputDir = outputOption ? path.resolve(outputOption) : settings.packageOutputDir;
      if (check) {
        let stale = 0;
        skills.forEach(function inspect(skill) {
          const archive = path.join(outputDir, skill.directoryName + '.skill');
          const status = archiveContentStatus(archive, skill);
          writeLine(stdout, archive + ': ' + status.detail);
          if (!status.current) stale += 1;
        });
        return stale ? 1 : 0;
      }
      writePackages(skills, outputDir).forEach(function print(output) { writeLine(stdout, 'Wrote ' + output); });
      return 0;
    }

    throw new Error('unknown control-plane command: ' + command);
  } catch (error) {
    writeLine(stderr, 'ERROR: ' + error.message);
    return 2;
  }
}

module.exports = {
  helpText,
  main,
  selectPackageSkills,
};
