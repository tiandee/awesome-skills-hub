'use strict';

const path = require('path');

const packageMetadata = require('../../package.json');
const { archiveContentStatus, writePackages } = require('./archive');
const { loadSettings } = require('./config');
const { createSkill } = require('./create');
const { buildInventory, discoverLibrary } = require('./discovery');
const { doctorExitCode, runDoctor } = require('./doctor');
const { findLibrarySkill, findLibrarySkills, initializeLibrary, syncRepository } = require('./library');
const { actionDescription, applyRepair, applyRollback, buildRepairPlan, rollbackPreview } = require('./repair');
const {
  applySnapshotRestore,
  planSnapshotRestore,
  readSnapshot,
  snapshotSummary,
  verifySnapshot,
  writeSnapshot,
} = require('./snapshot');
const { startUiServer } = require('../ui/server');

const REMOVED_COMMANDS = new Map([
  ['add', 'use `npx skills add <source>`; installed user Skills are discovered in ~/.agents/skills'],
  ['install', 'use `npx skills add <source>`; installed user Skills are discovered in ~/.agents/skills'],
  ['status', 'per-Agent synchronization status was removed; use `ash inventory` for the user library'],
  ['clean', 'per-Agent link cleanup was removed; ASH no longer writes client Skill directories'],
  ['uninstall', 'per-Agent link removal was removed; use the installer that owns the user Skill'],
  ['catalog', 'generated CATALOG.md was removed; use `ash list`, `ash search`, or the live management page'],
]);

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

function helpText() {
  return [
    'ASH v' + packageMetadata.version + ' — user Skill library manager',
    '',
    'Usage: ash <command> [options]',
    '',
    'Commands:',
    '  init                                  Initialize ~/.agents/skills',
    '  list [--json]                         List user Skills',
    '  info <NAME> [--json]                  Show one user Skill',
    '  search <QUERY> [--json]               Search user Skills',
    '  create <NAME> [--description TEXT]    Scaffold a user Skill',
    '  inventory [--json]                    Inspect the user library and Agents installer lock',
    '  doctor [--verbose] [--json]           Audit user Skill quality and local metadata',
    '  repair [--apply] [--scope NAME]       Repair Codex creation guidance',
    '  rollback [latest|ID] [--apply]        Roll back a repair transaction',
    '  package <SKILL...> [--all]            Build deterministic .skill archives',
    '  snapshot create|restore|verify        Migrate only user Skills',
    '  sync                                  Update the ASH Git checkout',
    '  ui [--port N] [--no-open]             Open the local Skill management page',
    '',
    'Global options:',
    '  --config PATH  Use another schema_version 2 configuration',
    '  --home PATH    Resolve ~ against another home directory',
    '  -v, --version  Show the ASH version',
    '  -h, --help     Show this help',
    '',
    'ASH never writes Cursor, Claude, Windsurf, TRAE, Copilot, or other Agent Skill roots.',
    'The only managed Skill content root is ~/.agents/skills.',
  ].join('\n');
}

function serializableSkill(skill) {
  return {
    name: skill.directoryName,
    declared_name: skill.declaredName,
    description: skill.description,
    path: skill.path,
    relative_path: skill.relativePath,
    line_count: skill.lineCount,
  };
}

function skillTable(skills, stdout) {
  if (!skills.length) {
    writeLine(stdout, 'No user Skills found.');
    return;
  }
  const width = Math.min(40, Math.max(4, ...skills.map(function length(skill) { return skill.directoryName.length; })));
  writeLine(stdout, 'NAME'.padEnd(width) + '  DESCRIPTION');
  writeLine(stdout, '-'.repeat(width) + '  ' + '-'.repeat(60));
  skills.forEach(function row(skill) {
    const description = String(skill.description || '(missing description)').replace(/\s+/g, ' ').slice(0, 100);
    writeLine(stdout, skill.directoryName.slice(0, width).padEnd(width) + '  ' + description);
  });
  writeLine(stdout, '\nTotal: ' + skills.length + ' user Skill(s) in ~/.agents/skills');
}

function inventoryTable(records, stdout) {
  if (!records.length) {
    writeLine(stdout, 'No user Skill records found.');
    return;
  }
  const nameWidth = Math.min(40, Math.max(4, ...records.map(function length(record) { return record.name.length; })));
  const sourceWidth = Math.max(6, ...records.map(function length(record) { return record.source.length; }));
  const statusWidth = Math.max(6, ...records.map(function length(record) { return record.status.length; }));
  const header = 'NAME'.padEnd(nameWidth) + '  SOURCE'.padEnd(sourceWidth + 2) + 'STATUS'.padEnd(statusWidth + 2) + 'LOCATION';
  writeLine(stdout, header);
  writeLine(stdout, '-'.repeat(header.length));
  records.forEach(function row(record) {
    writeLine(
      stdout,
      record.name.slice(0, nameWidth).padEnd(nameWidth) + '  ' +
        record.source.padEnd(sourceWidth) + '  ' + record.status.padEnd(statusWidth) + '  ' + record.path,
    );
  });
  writeLine(stdout, '\nTotal: ' + records.length + ' user-library record(s)');
}

function printableAction(action) {
  return {
    kind: action.kind,
    scope: action.scope,
    path: action.path,
    description: actionDescription(action),
  };
}

function selectPackageSkills(settings, names, allSkills) {
  const library = discoverLibrary(settings);
  if (allSkills) return library;
  if (!names.length) throw new Error('specify one or more user Skill names, or pass --all');
  const byName = new Map(library.map(function pair(skill) { return [skill.directoryName, skill]; }));
  const missing = names.filter(function absent(name) { return !byName.has(name); });
  if (missing.length) throw new Error('unknown user Skills: ' + missing.join(', '));
  return names.map(function selected(name) { return byName.get(name); });
}

function snapshotHelp(stdout) {
  writeLine(stdout, [
    'ASH user Skill snapshots',
    '',
    '  ash snapshot create <FILE> [--json]',
    '  ash snapshot restore <FILE> [--apply] [--json]',
    '  ash snapshot verify <FILE> [--json]',
    '',
    'Only ~/.agents/skills is included. System, plugin, Store, and Agent-built-in',
    'Skills are excluded. Restore is dry-run by default and never overwrites.',
  ].join('\n'));
}

function runSnapshot(args, settings, stdout) {
  const subcommand = args.shift();
  const json = takeFlag(args, '--json');
  if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
    if (args.length) throw new Error('unknown snapshot option: ' + args[0]);
    snapshotHelp(stdout);
    return 0;
  }
  if (subcommand === 'create') {
    const output = args.shift();
    if (!output) throw new Error('snapshot create requires an output file');
    if (args.length) throw new Error('unknown snapshot create option: ' + args[0]);
    const result = writeSnapshot(settings, path.resolve(output));
    const summary = Object.assign({ path: result.path, bytes: result.bytes }, snapshotSummary(result.snapshot));
    if (json) writeLine(stdout, JSON.stringify(summary, null, 2));
    else {
      writeLine(stdout, 'Created user Skill snapshot: ' + result.path);
      writeLine(stdout, 'Skills: ' + result.skill_count + ', files: ' + result.file_count + ', bytes: ' + result.bytes);
      writeLine(stdout, 'Materialized top-level Skill links: ' + result.materialized_symlink_count);
      writeLine(stdout, 'Omitted local-only or nested linked entries: ' + result.omitted_count);
      writeLine(stdout, 'Snapshot ID: ' + result.snapshot.snapshot_id);
    }
    return 0;
  }
  if (subcommand === 'restore') {
    const apply = takeFlag(args, '--apply');
    const input = args.shift();
    if (!input) throw new Error('snapshot restore requires a snapshot file');
    if (args.length) throw new Error('unknown snapshot restore option: ' + args[0]);
    const selected = path.resolve(input);
    const snapshot = readSnapshot(selected);
    const plan = planSnapshotRestore(settings, snapshot);
    if (!apply) {
      const payload = {
        mode: 'dry-run',
        snapshot: Object.assign({ path: selected }, snapshotSummary(snapshot)),
        actions: plan.actions,
        unchanged: plan.unchanged,
        conflicts: plan.conflicts,
      };
      if (json) writeLine(stdout, JSON.stringify(payload, null, 2));
      else {
        writeLine(stdout, 'Mode: DRY-RUN');
        plan.actions.forEach(function print(action) { writeLine(stdout, 'CREATE ' + action.path); });
        plan.unchanged.forEach(function print(item) { writeLine(stdout, 'UNCHANGED ' + item.path); });
        plan.conflicts.forEach(function print(item) { writeLine(stdout, 'CONFLICT ' + item.message); });
        writeLine(stdout, 'Plan: create=' + plan.actions.length + ', unchanged=' + plan.unchanged.length + ', conflicts=' + plan.conflicts.length);
        if (plan.actions.length && !plan.conflicts.length) writeLine(stdout, 'Run again with --apply to restore these user Skills.');
      }
      return plan.conflicts.length ? 1 : 0;
    }
    if (plan.conflicts.length) {
      const payload = {
        mode: 'apply-refused',
        snapshot: Object.assign({ path: selected }, snapshotSummary(snapshot)),
        actions: plan.actions,
        unchanged: plan.unchanged,
        conflicts: plan.conflicts,
      };
      if (json) writeLine(stdout, JSON.stringify(payload, null, 2));
      else writeLine(stdout, 'Restore refused: ' + plan.conflicts.length + ' conflict(s); no Skills were written.');
      return 1;
    }
    const restored = applySnapshotRestore(settings, snapshot);
    const payload = {
      mode: 'apply',
      snapshot: Object.assign({ path: selected }, snapshotSummary(snapshot)),
      created: restored.created,
      unchanged: restored.unchanged,
    };
    if (json) writeLine(stdout, JSON.stringify(payload, null, 2));
    else {
      writeLine(stdout, 'Restored ' + restored.created.length + ' user Skill(s) into ' + settings.libraryRoot + '.');
      writeLine(stdout, 'Unchanged: ' + restored.unchanged.length + '. No Agent-specific directory was touched.');
      writeLine(stdout, 'Next: run ash snapshot verify ' + selected + ', then ash doctor.');
    }
    return 0;
  }
  if (subcommand === 'verify') {
    const input = args.shift();
    if (!input) throw new Error('snapshot verify requires a snapshot file');
    if (args.length) throw new Error('unknown snapshot verify option: ' + args[0]);
    const selected = path.resolve(input);
    const snapshot = readSnapshot(selected);
    const result = verifySnapshot(settings, snapshot);
    const payload = Object.assign({ snapshot: Object.assign({ path: selected }, snapshotSummary(snapshot)) }, result);
    if (json) writeLine(stdout, JSON.stringify(payload, null, 2));
    else {
      writeLine(stdout, 'Verify: matched=' + result.matched.length + ', missing=' + result.missing.length +
        ', changed=' + result.changed.length + ', extra=' + result.extra.length);
      writeLine(stdout, result.ok ? 'PASSED: user Skill library matches the snapshot' : 'FAILED: user Skill library differs from the snapshot');
    }
    return result.ok ? 0 : 1;
  }
  throw new Error('snapshot requires create, restore, or verify');
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
    let command = args.shift();
    if (command === 'ls') command = 'list';
    if (!command || command === 'help' || command === '-h' || command === '--help') {
      writeLine(stdout, helpText());
      return 0;
    }
    if (command === '-v' || command === '--version' || command === 'version') {
      writeLine(stdout, packageMetadata.version);
      return 0;
    }
    if (REMOVED_COMMANDS.has(command)) throw new Error(command + ' was removed in ASH v2; ' + REMOVED_COMMANDS.get(command));
    const settings = loadSettings({
      projectRoot: opts.projectRoot,
      configPath: configPath || undefined,
      homeDir: homeDir || undefined,
      env,
    });

    if (command === 'init') {
      const json = takeFlag(args, '--json');
      if (args.length) throw new Error('unknown init option: ' + args[0]);
      const result = initializeLibrary(settings);
      if (json) writeLine(stdout, JSON.stringify(result, null, 2));
      else writeLine(stdout, (result.createdLibrary ? 'Created user Skill library: ' : 'User Skill library: ') + settings.libraryRoot);
      return 0;
    }

    if (command === 'sync') {
      const json = takeFlag(args, '--json');
      if (args.length) throw new Error('unknown sync option: ' + args[0]);
      const result = syncRepository(settings, { spawnSync: opts.spawnSync });
      if (json) writeLine(stdout, JSON.stringify(result, null, 2));
      else {
        if (result.output.trim()) stdout.write(result.output.endsWith('\n') ? result.output : result.output + '\n');
        writeLine(stdout, result.updated ? 'Updated ASH Git checkout.' : 'ASH is not a Git checkout; update it with your package manager.');
      }
      return 0;
    }

    if (command === 'ui') {
      const portOption = takeOption(args, '--port');
      const noOpen = takeFlag(args, '--no-open');
      if (args.length) throw new Error('unknown ui option: ' + args[0]);
      const selectedPort = portOption === null ? undefined : Number(portOption);
      const starter = opts.startUiServer || startUiServer;
      const startup = starter(settings, { port: selectedPort, open: !noOpen });
      startup.then(function ready(result) {
        writeLine(stdout, 'ASH UI: ' + result.url);
        writeLine(stdout, 'Library: ' + settings.libraryRoot);
        writeLine(stdout, 'Press Ctrl+C to stop the local server.');
      }).catch(function failed(error) {
        writeLine(stderr, 'ERROR: cannot start ASH UI: ' + error.message);
        process.exitCode = 2;
      });
      return 0;
    }

    if (command === 'list') {
      const json = takeFlag(args, '--json');
      if (args.length) throw new Error('unknown list option: ' + args[0]);
      const skills = discoverLibrary(settings);
      if (json) writeLine(stdout, JSON.stringify({ skills: skills.map(serializableSkill) }, null, 2));
      else skillTable(skills, stdout);
      return 0;
    }

    if (command === 'info') {
      const json = takeFlag(args, '--json');
      const name = args.shift();
      if (!name) throw new Error('info requires a user Skill name');
      if (args.length) throw new Error('unknown info option: ' + args[0]);
      const skill = findLibrarySkill(settings, name);
      const payload = serializableSkill(skill);
      if (json) writeLine(stdout, JSON.stringify(payload, null, 2));
      else {
        writeLine(stdout, 'Name: ' + skill.directoryName);
        writeLine(stdout, 'Declared name: ' + (skill.declaredName || '(missing)'));
        writeLine(stdout, 'Description: ' + (skill.description || '(missing)'));
        writeLine(stdout, 'Path: ' + skill.path);
        writeLine(stdout, 'SKILL.md lines: ' + skill.lineCount);
      }
      return 0;
    }

    if (command === 'search') {
      const json = takeFlag(args, '--json');
      const query = args.join(' ').trim();
      if (!query) throw new Error('search requires a query');
      const skills = findLibrarySkills(settings, query);
      if (json) writeLine(stdout, JSON.stringify({ query, skills: skills.map(serializableSkill) }, null, 2));
      else skillTable(skills, stdout);
      return 0;
    }

    if (command === 'create') {
      const json = takeFlag(args, '--json');
      let description = takeOption(args, '--description');
      if (description === null) description = takeOption(args, '-d');
      const name = args.shift();
      if (!name) throw new Error('create requires a user Skill name');
      if (args.length) throw new Error('unknown create option: ' + args[0]);
      const created = createSkill(settings, name, { description: description === null ? undefined : description });
      if (json) writeLine(stdout, JSON.stringify(created, null, 2));
      else {
        writeLine(stdout, 'Created user Skill scaffold: ' + created.path);
        created.files.forEach(function print(filePath) { writeLine(stdout, '  - ' + filePath); });
        writeLine(stdout, 'Next: finish SKILL.md and run ash doctor.');
      }
      return 0;
    }

    if (command === 'inventory') {
      const json = takeFlag(args, '--json');
      if (args.length) throw new Error('unknown inventory option: ' + args[0]);
      const inventory = buildInventory(settings);
      if (json) writeLine(stdout, JSON.stringify({ skills: inventory.records, diagnostics: inventory.diagnostics }, null, 2));
      else {
        inventoryTable(inventory.records, stdout);
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
      if (json) writeLine(stdout, JSON.stringify({ issues, exit_code: exitCode }, null, 2));
      else if (!issues.length) writeLine(stdout, 'PASSED: user Skill library has no issues');
      else {
        issues.forEach(function print(item) {
          writeLine(stdout, '[' + item.severity + '] ' + item.code + ': ' + item.message);
          if (verbose) item.paths.forEach(function printPath(itemPath) { writeLine(stdout, '  - ' + itemPath); });
        });
        const count = function count(severity) { return issues.filter(function matching(item) { return item.severity === severity; }).length; };
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
      if (!apply) {
        const payload = { mode: 'dry-run', scope, actions: plan.actions.map(printableAction), conflicts: plan.conflicts };
        if (json) writeLine(stdout, JSON.stringify(payload, null, 2));
        else {
          writeLine(stdout, 'Mode: DRY-RUN');
          plan.actions.forEach(function print(action) { writeLine(stdout, actionDescription(action)); });
          plan.conflicts.forEach(function print(item) { writeLine(stdout, 'CONFLICT ' + item.message); });
          writeLine(stdout, 'Plan: ' + plan.actions.length + ' action(s), ' + plan.conflicts.length + ' conflict(s)');
          if (plan.actions.length && !plan.conflicts.length) writeLine(stdout, 'Run again with --apply to execute this plan.');
        }
        return plan.conflicts.length ? 1 : 0;
      }
      if (plan.conflicts.length) {
        if (json) writeLine(stdout, JSON.stringify({ mode: 'apply-refused', scope, conflicts: plan.conflicts }, null, 2));
        else writeLine(stdout, 'Repair refused: conflicts must be resolved first.');
        return 1;
      }
      if (!plan.actions.length) {
        if (json) writeLine(stdout, JSON.stringify({ mode: 'apply', scope, transaction: null, remaining: plan }, null, 2));
        else writeLine(stdout, 'No repairs are needed.');
        return 0;
      }
      const transaction = applyRepair(settings, plan);
      const remaining = buildRepairPlan(settings, { scope });
      if (json) writeLine(stdout, JSON.stringify({ mode: 'apply', scope, transaction, remaining }, null, 2));
      else {
        writeLine(stdout, 'Applied successfully. Transaction: ' + transaction);
        writeLine(stdout, 'Post-repair scope check: ' + remaining.actions.length + ' action(s), ' + remaining.conflicts.length + ' conflict(s).');
      }
      return remaining.actions.length || remaining.conflicts.length ? 1 : 0;
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

    if (command === 'snapshot') return runSnapshot(args, settings, stdout);
    throw new Error('unknown command: ' + command);
  } catch (error) {
    writeLine(stderr, 'ERROR: ' + error.message);
    return 2;
  }
}

module.exports = {
  REMOVED_COMMANDS,
  helpText,
  main,
  runSnapshot,
  selectPackageSkills,
};
