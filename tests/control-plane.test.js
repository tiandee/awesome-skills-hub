'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const controlPlane = require('../lib/control-plane');

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function removeTree(target) {
  if (!controlPlane.lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  fs.readdirSync(target).forEach(function removeChild(name) {
    removeTree(path.join(target, name));
  });
  fs.rmdirSync(target);
}

function writeSkill(skillPath, name, description) {
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(
    path.join(skillPath, 'SKILL.md'),
    '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n# ' + name + '\n',
    'utf8',
  );
  return skillPath;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-control-'));
  const library = path.join(root, '.agents', 'skills');
  const clientRoot = path.join(root, 'client', 'skills');
  const codexRoot = path.join(root, 'codex', 'skills');
  const pluginCache = path.join(root, 'codex', 'plugins');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(library, { recursive: true });
  fs.mkdirSync(clientRoot, { recursive: true });
  fs.mkdirSync(codexRoot, { recursive: true });
  fs.mkdirSync(pluginCache, { recursive: true });

  const alpha = writeSkill(path.join(library, 'alpha'), 'alpha', 'Alpha test workflow.');
  const beta = writeSkill(path.join(library, 'beta'), 'beta', 'Beta test workflow.');
  controlPlane.createDirectoryLink(alpha, path.join(clientRoot, 'alpha'));

  writeSkill(path.join(library, 'third-party'), 'third-party', 'Installed from a lock file.');
  fs.writeFileSync(path.join(root, '.agents', '.skill-lock.json'), JSON.stringify({
    version: 3,
    skills: {
      'third-party': {
        source: 'example/skills',
        skillPath: 'skills/third-party/SKILL.md',
      },
    },
  }), 'utf8');
  writeSkill(path.join(codexRoot, 'manual-codex'), 'manual-codex', 'Manually installed Codex skill.');
  fs.writeFileSync(path.join(codexRoot, '.skills_store_lock.json'), JSON.stringify({
    version: 1,
    skills: {},
  }), 'utf8');

  const configPath = path.join(root, 'ash-control.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: 1,
    library: { path: library, exclude: [] },
    targets: {
      client: { path: clientRoot, skills: ['*'], enabled: true },
    },
    sources: {
      agents_lock: path.join(root, '.agents', '.skill-lock.json'),
      codex_root: codexRoot,
      codex_store_lock: path.join(codexRoot, '.skills_store_lock.json'),
      plugin_cache: pluginCache,
    },
    output: {
      state_dir: stateDir,
      catalog: path.join(root, 'CATALOG.md'),
      packages: path.join(root, 'packages'),
    },
  }, null, 2), 'utf8');
  const settings = controlPlane.loadSettings({
    projectRoot: root,
    configPath,
    homeDir: root,
    env: { HOME: root },
  });
  return {
    root,
    library,
    clientRoot,
    codexRoot,
    stateDir,
    configPath,
    settings,
    alpha,
    beta,
    cleanup: function cleanup() { removeTree(root); },
  };
}

function withFixture(callback) {
  const current = fixture();
  try {
    callback(current);
  } finally {
    current.cleanup();
  }
}

test('discovers the universal Agents library without lock-file duplicates', function run() {
  withFixture(function inspect(current) {
    const library = controlPlane.discoverLibrary(current.settings);
    assert.deepStrictEqual(library.map(function name(skill) { return skill.directoryName; }), ['alpha', 'beta', 'third-party']);
    const inventory = controlPlane.buildInventory(current.settings);
    const byKey = new Map(inventory.records.map(function entry(record) {
      return [record.name + ':' + record.source, record];
    }));
    assert.strictEqual(byKey.get('alpha:agents-library').status, 'linked');
    assert.strictEqual(byKey.get('beta:agents-library').status, 'missing');
    assert.strictEqual(byKey.get('third-party:agents-library').status, 'missing');
    assert.strictEqual(byKey.has('third-party:third-party'), false);
    assert.strictEqual(byKey.get('manual-codex:untracked-codex').status, 'untracked');
  });
});

test('doctor is read-only and reports missing links', function run() {
  withFixture(function inspect(current) {
    const before = fs.readdirSync(current.clientRoot).sort();
    const issues = controlPlane.runDoctor(current.settings);
    const after = fs.readdirSync(current.clientRoot).sort();
    assert.deepStrictEqual(after, before);
    assert.strictEqual(controlPlane.lexists(path.join(current.clientRoot, 'beta')), false);
    const codes = new Set(issues.map(function code(item) { return item.code; }));
    assert(codes.has('ASH_LINK_MISSING'));
    assert(codes.has('CATALOG_STALE'));
    assert(codes.has('CODEX_SKILLS_UNTRACKED'));
  });
});

test('repair applies safe actions and rolls them back', function run() {
  withFixture(function inspect(current) {
    const plan = controlPlane.buildRepairPlan(current.settings);
    assert.deepStrictEqual(new Set(plan.actions.map(function kind(action) { return action.kind; })), new Set(['symlink_create', 'file_write']));
    const transaction = controlPlane.applyRepair(current.settings, plan);
    assert(fs.existsSync(transaction));
    assert.strictEqual(controlPlane.canonicalPath(path.join(current.clientRoot, 'beta')), controlPlane.canonicalPath(current.beta));
    assert(controlPlane.catalogIsCurrent(current.settings));

    const preview = controlPlane.rollbackPreview(current.settings, 'latest');
    assert.strictEqual(preview.transactionFile, transaction);
    assert(preview.descriptions.some(function removeLink(item) { return item.indexOf('REMOVE_LINK') === 0; }));
    controlPlane.applyRollback(current.settings, 'latest');
    assert.strictEqual(controlPlane.lexists(path.join(current.clientRoot, 'beta')), false);
    assert.strictEqual(fs.existsSync(current.settings.catalogPath), false);
    assert(fs.lstatSync(path.join(current.clientRoot, 'alpha')).isSymbolicLink());
  });
});

test('repair tracks missing parent directories', function run() {
  withFixture(function inspect(current) {
    const targetRoot = path.join(current.root, 'profile', 'agents', 'skills');
    const settings = Object.assign({}, current.settings, {
      targets: [{ name: 'new-target', path: targetRoot, skills: ['*'], enabled: 'always' }],
    });
    const plan = controlPlane.buildRepairPlan(settings);
    const directories = plan.actions.filter(function mkdir(action) { return action.kind === 'mkdir'; }).map(function actionPath(action) { return action.path; });
    assert.deepStrictEqual(directories, [
      path.join(current.root, 'profile'),
      path.join(current.root, 'profile', 'agents'),
      targetRoot,
    ]);
    const transaction = controlPlane.applyRepair(settings, plan);
    assert(fs.lstatSync(path.join(targetRoot, 'alpha')).isSymbolicLink());
    controlPlane.applyRollback(settings, path.basename(path.dirname(transaction)));
    assert.strictEqual(fs.existsSync(path.join(current.root, 'profile')), false);
  });
});

test('repair never overwrites a conflicting directory', function run() {
  withFixture(function inspect(current) {
    const conflict = path.join(current.clientRoot, 'beta');
    fs.mkdirSync(conflict);
    const marker = path.join(conflict, 'keep.txt');
    fs.writeFileSync(marker, 'keep', 'utf8');
    const plan = controlPlane.buildRepairPlan(current.settings);
    assert.strictEqual(plan.conflicts.length, 1);
    assert.strictEqual(plan.actions.some(function unsafe(action) {
      return action.path === conflict && action.kind.indexOf('symlink') === 0;
    }), false);
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'keep');
  });
});

test('detected targets with an invalid path remain visible as conflicts', function run() {
  withFixture(function inspect(current) {
    const invalidTarget = path.join(current.root, 'invalid-target');
    fs.writeFileSync(invalidTarget, 'not a directory', 'utf8');
    const settings = Object.assign({}, current.settings, {
      targets: [{ name: 'invalid', path: invalidTarget, skills: ['*'], enabled: 'detected' }],
    });
    const plan = controlPlane.buildRepairPlan(settings);
    assert(plan.conflicts.some(function targetConflict(item) {
      return item.code === 'TARGET_NOT_DIRECTORY';
    }));
    const issues = controlPlane.runDoctor(settings);
    assert(issues.some(function targetConflict(item) {
      return item.code === 'TARGET_NOT_DIRECTORY';
    }));
  });
});

test('broken links are repaired and restored by rollback', function run() {
  withFixture(function inspect(current) {
    const broken = path.join(current.clientRoot, 'beta');
    const oldTarget = path.join(current.root, 'missing-beta');
    controlPlane.createDirectoryLink(oldTarget, broken);
    assert.strictEqual(controlPlane.linkStatus(broken, current.beta).status, 'broken');
    const plan = controlPlane.buildRepairPlan(current.settings);
    const replacement = plan.actions.find(function matching(action) { return action.path === broken; });
    assert(replacement);
    assert.strictEqual(replacement.kind, 'symlink_replace');
    const transaction = controlPlane.applyRepair(current.settings, plan);
    assert.strictEqual(controlPlane.canonicalPath(broken), controlPlane.canonicalPath(current.beta));
    controlPlane.applyRollback(current.settings, path.basename(path.dirname(transaction)));
    assert(fs.lstatSync(broken).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(broken), oldTarget);
  });
});

test('rollback refuses to overwrite a later user edit', function run() {
  withFixture(function inspect(current) {
    const transaction = controlPlane.applyRepair(current.settings, controlPlane.buildRepairPlan(current.settings));
    fs.writeFileSync(current.settings.catalogPath, 'user edit\n', 'utf8');
    assert.throws(function rollback() {
      controlPlane.applyRollback(current.settings, path.basename(path.dirname(transaction)));
    }, /user-modified/);
    assert(fs.lstatSync(path.join(current.clientRoot, 'beta')).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(current.settings.catalogPath, 'utf8'), 'user edit\n');
  });
});

test('rollback preflight prevents partial restore', function run() {
  withFixture(function inspect(current) {
    const transaction = controlPlane.applyRepair(current.settings, controlPlane.buildRepairPlan(current.settings));
    const betaLink = path.join(current.clientRoot, 'beta');
    fs.unlinkSync(betaLink);
    controlPlane.createDirectoryLink(current.alpha, betaLink);
    const generatedCatalog = fs.readFileSync(current.settings.catalogPath, 'utf8');
    assert.throws(function rollback() {
      controlPlane.applyRollback(current.settings, path.basename(path.dirname(transaction)));
    }, /changed link/);
    assert.strictEqual(fs.readFileSync(current.settings.catalogPath, 'utf8'), generatedCatalog);
    assert.strictEqual(controlPlane.canonicalPath(betaLink), controlPlane.canonicalPath(current.alpha));
  });
});

test('package output is deterministic and excludes local secrets', function run() {
  withFixture(function inspect(current) {
    const assets = path.join(current.beta, 'assets');
    fs.mkdirSync(assets);
    fs.writeFileSync(path.join(assets, '.env'), 'TOKEN=secret\n', 'utf8');
    fs.writeFileSync(path.join(assets, '.env.example'), 'TOKEN=replace-me\n', 'utf8');
    const skill = controlPlane.discoverLibrary(current.settings).find(function beta(item) { return item.directoryName === 'beta'; });
    const first = controlPlane.buildArchive(skill);
    const second = controlPlane.buildArchive(skill);
    assert(first.equals(second));
    const entryNames = controlPlane.buildArchiveEntries(skill).map(function name(entry) { return entry.name; });
    assert(entryNames.includes('beta/assets/.env.example'));
    assert.strictEqual(entryNames.includes('beta/assets/.env'), false);
    const output = controlPlane.writePackages([skill], current.settings.packageOutputDir)[0];
    assert(fs.existsSync(output));
    assert(fs.readFileSync(output).equals(first));
  });
});

test('CLI JSON inventory uses the selected configuration', function run() {
  withFixture(function inspect(current) {
    let output = '';
    let errors = '';
    const exitCode = controlPlane.main([
      '--config', current.configPath,
      '--home', current.root,
      'inventory', '--source', 'agents-library', '--json',
    ], {
      projectRoot: current.root,
      env: { HOME: current.root },
      stdout: { write: function write(value) { output += value; } },
      stderr: { write: function write(value) { errors += value; } },
    });
    assert.strictEqual(exitCode, 0, errors);
    const payload = JSON.parse(output);
    assert.deepStrictEqual(payload.skills.map(function name(record) { return record.name; }).sort(), ['alpha', 'beta', 'third-party']);
  });
});

test('discovers and packages a top-level symlinked library Skill', function run() {
  withFixture(function inspect(current) {
    const external = writeSkill(path.join(current.root, 'external', 'linked-skill'), 'linked-skill', 'Linked source workflow.');
    fs.writeFileSync(path.join(external, 'example.txt'), 'linked\n', 'utf8');
    controlPlane.createDirectoryLink(external, path.join(current.library, 'linked-skill'));
    const linked = controlPlane.discoverLibrary(current.settings).find(function match(skill) {
      return skill.directoryName === 'linked-skill';
    });
    assert(linked);
    assert.strictEqual(fs.lstatSync(linked.path).isSymbolicLink(), true);
    const entries = controlPlane.buildArchiveEntries(linked).map(function name(entry) { return entry.name; });
    assert(entries.includes('linked-skill/SKILL.md'));
    assert(entries.includes('linked-skill/example.txt'));
    const plan = controlPlane.buildRepairPlan(current.settings);
    const clientLink = plan.actions.find(function linkedAction(action) {
      return action.kind === 'symlink_create' && action.path === path.join(current.clientRoot, 'linked-skill');
    });
    assert(clientLink);
    assert.strictEqual(clientLink.target, path.join(current.library, 'linked-skill'));
  });
});

test('reports a broken symlink in the universal Agents library', function run() {
  withFixture(function inspect(current) {
    const broken = path.join(current.library, 'broken-skill');
    controlPlane.createDirectoryLink(path.join(current.root, 'missing-skill'), broken);
    const inventory = controlPlane.buildInventory(current.settings);
    const record = inventory.records.find(function match(item) {
      return item.name === 'broken-skill' && item.source === 'agents-library';
    });
    assert(record);
    assert.strictEqual(record.status, 'broken');
    assert(controlPlane.runDoctor(current.settings).some(function issue(item) {
      return item.code === 'AGENTS_LIBRARY_BROKEN';
    }));
  });
});

test('rejects a client target that reuses the universal library path', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.targets.client.path = current.library;
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    assert.throws(function reload() {
      controlPlane.loadSettings({
        projectRoot: current.root,
        configPath: current.configPath,
        homeDir: current.root,
        env: { HOME: current.root },
      });
    }, /must not reuse the universal Skill library path/);
  });
});

test('mutating startup migrates only missing legacy entries without breaking or overwriting Agents data', function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-legacy-migration-'));
  try {
    const legacyRoot = path.join(root, '.ash', 'skills');
    const agentsRoot = path.join(root, '.agents', 'skills');
    writeSkill(path.join(legacyRoot, 'legacy-only'), 'legacy-only', 'Legacy-only workflow.');
    writeSkill(path.join(legacyRoot, 'legacy-category', 'legacy-nested'), 'legacy-nested', 'Nested legacy workflow.');
    writeSkill(path.join(legacyRoot, 'shared'), 'shared', 'Legacy shared workflow.');
    const linkedLegacy = writeSkill(path.join(legacyRoot, 'linked-legacy'), 'linked-legacy', 'Linked legacy workflow.');
    const externalLegacy = writeSkill(path.join(root, 'external-legacy'), 'legacy-linked-only', 'External legacy workflow.');
    controlPlane.createDirectoryLink(externalLegacy, path.join(legacyRoot, 'legacy-linked-only'));
    const agentsShared = writeSkill(path.join(agentsRoot, 'shared'), 'shared', 'Agents-owned workflow.');
    controlPlane.createDirectoryLink(linkedLegacy, path.join(agentsRoot, 'linked-legacy'));

    const result = childProcess.spawnSync(
      '/bin/bash',
      [path.join(__dirname, '..', 'bin', 'ash'), 'list'],
      {
        cwd: path.join(__dirname, '..'),
        env: Object.assign({}, process.env, { HOME: root }),
        encoding: 'utf8',
      },
    );
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert(fs.existsSync(path.join(agentsRoot, 'legacy-only', 'SKILL.md')));
    assert(fs.existsSync(path.join(agentsRoot, 'legacy-nested', 'SKILL.md')));
    assert.strictEqual(controlPlane.lexists(path.join(agentsRoot, 'legacy-category')), false);
    assert(fs.existsSync(path.join(agentsRoot, 'legacy-linked-only', 'SKILL.md')));
    assert.strictEqual(fs.lstatSync(path.join(agentsRoot, 'legacy-linked-only')).isSymbolicLink(), false);
    assert(fs.existsSync(path.join(agentsRoot, 'skill-finder', 'SKILL.md')));
    assert.strictEqual(controlPlane.lexists(path.join(agentsRoot, 'system')), false);
    assert.strictEqual(
      fs.readFileSync(path.join(agentsShared, 'SKILL.md'), 'utf8').includes('Agents-owned workflow.'),
      true,
    );
    assert.strictEqual(fs.lstatSync(path.join(agentsRoot, 'linked-legacy')).isSymbolicLink(), true);
    assert(fs.existsSync(path.join(agentsRoot, 'linked-legacy', 'SKILL.md')));
    assert(fs.existsSync(legacyRoot));
    assert(result.stdout.includes('ASH 已不再从该目录加载技能'));
  } finally {
    removeTree(root);
  }
});

test('read-only doctor does not initialize a missing ASH home', function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-read-only-'));
  try {
    const env = Object.assign({}, process.env, { HOME: root });
    delete env.ASH_SKILLS_DIR;
    const result = childProcess.spawnSync(
      '/bin/bash',
      [path.join(__dirname, '..', 'bin', 'ash'), 'doctor', '--json'],
      { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' },
    );
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.strictEqual(fs.existsSync(path.join(root, '.agents')), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.ash')), false);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.issues[0].code, 'ASH_LIBRARY_NOT_FOUND');
  } finally {
    removeTree(root);
  }
});

let failures = 0;
tests.forEach(function execute(item) {
  try {
    item.callback();
    process.stdout.write('ok - ' + item.name + '\n');
  } catch (error) {
    failures += 1;
    process.stderr.write('not ok - ' + item.name + '\n');
    process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  }
});
process.stdout.write('\n' + (tests.length - failures) + '/' + tests.length + ' tests passed\n');
process.exitCode = failures ? 1 : 0;
