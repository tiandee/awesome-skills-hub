'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

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
  fs.readdirSync(target).forEach(function removeChild(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function writeSkill(skillPath, name, description, body) {
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(
    path.join(skillPath, 'SKILL.md'),
    '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n# ' + name + '\n' + (body || ''),
    'utf8',
  );
  return skillPath;
}

function createDirectoryLink(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function writeConfig(root, options) {
  const opts = options || {};
  const configPath = path.join(root, 'ash-control.json');
  const payload = {
    schema_version: 2,
    library: { path: path.join(root, '.agents', 'skills'), exclude: [] },
    policies: { codex_global_guidance: opts.guidancePolicy || 'observe' },
    sources: { agents_lock: path.join(root, '.agents', '.skill-lock.json') },
    output: {
      state_dir: path.join(root, '.ash', 'state', 'control-plane'),
      packages: path.join(root, '.ash', 'packages'),
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf8');
  return configPath;
}

function fixture(options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-v2-'));
  const library = path.join(root, '.agents', 'skills');
  fs.mkdirSync(library, { recursive: true });
  const alpha = writeSkill(path.join(library, 'alpha'), 'alpha', 'Alpha user workflow.');
  const beta = writeSkill(path.join(library, 'beta'), 'beta', 'Beta user workflow.');
  writeSkill(path.join(library, 'third-party'), 'third-party', 'Installed user workflow.');
  fs.writeFileSync(path.join(root, '.agents', '.skill-lock.json'), JSON.stringify({
    version: 3,
    skills: {
      'third-party': { source: 'example/user-skills', skillPath: 'skills/third-party/SKILL.md' },
    },
  }, null, 2), 'utf8');
  const configPath = writeConfig(root, options);
  const settings = controlPlane.loadSettings({
    projectRoot: root,
    configPath,
    homeDir: root,
    env: { HOME: root },
  });
  return {
    root,
    library,
    alpha,
    beta,
    configPath,
    settings,
    cleanup: function cleanup() { removeTree(root); },
  };
}

function withFixture(callback, options) {
  const current = fixture(options);
  try {
    callback(current);
  } finally {
    current.cleanup();
  }
}

function runMain(current, args) {
  let stdout = '';
  let stderr = '';
  const exitCode = controlPlane.main([
    '--config', current.configPath,
    '--home', current.root,
  ].concat(args), {
    projectRoot: current.root,
    env: { HOME: current.root },
    stdout: { write: function write(value) { stdout += value; } },
    stderr: { write: function write(value) { stderr += value; } },
  });
  return { exitCode, stdout, stderr };
}

test('schema v2 exposes only the universal user library settings', function run() {
  withFixture(function inspect(current) {
    assert.strictEqual(current.settings.schemaVersion, 2);
    assert.strictEqual(current.settings.libraryRoot, current.library);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(current.settings, 'targets'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(current.settings, 'codexRoot'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(current.settings, 'pluginCache'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(current.settings, 'codexStoreLock'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(current.settings, 'bundledSkillsRoot'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(current.settings, 'catalogPath'), false);
    const legacyPayload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    legacyPayload.output.catalog = path.join(current.root, '.ash', 'CATALOG.md');
    fs.writeFileSync(current.configPath, JSON.stringify(legacyPayload, null, 2), 'utf8');
    const compatible = controlPlane.loadSettings({ projectRoot: current.root, configPath: current.configPath, homeDir: current.root, env: { HOME: current.root } });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(compatible, 'catalogPath'), false);
  });
});

test('schema v2 rejects obsolete target and Codex migration configuration', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.targets = { cursor: { path: path.join(current.root, '.cursor', 'skills') } };
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    assert.throws(function targets() {
      controlPlane.loadSettings({ projectRoot: current.root, configPath: current.configPath, homeDir: current.root });
    }, /targets is no longer supported/);

    delete payload.targets;
    payload.policies.codex_user_skills = 'migrate-to-agents';
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    assert.throws(function policy() {
      controlPlane.loadSettings({ projectRoot: current.root, configPath: current.configPath, homeDir: current.root });
    }, /codex_user_skills is obsolete/);
  });
});

test('parses indented plain-scalar descriptions used by Vercel Skills', function run() {
  withFixture(function inspect(current) {
    const skillPath = path.join(current.library, 'vercel-style');
    fs.mkdirSync(skillPath);
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), [
      '---',
      'name: vercel-style',
      'description:',
      '  React patterns that scale. Use when refactoring components with',
      '  boolean prop proliferation or designing reusable APIs.',
      'license: MIT',
      'metadata:',
      '  author: vercel',
      "  version: '1.0.0'",
      '---',
      '',
      '# Vercel Style',
      '',
    ].join('\n'), 'utf8');

    const parsed = controlPlane.parseSkill(skillPath, 'vercel-style');
    assert.strictEqual(
      parsed.description,
      'React patterns that scale. Use when refactoring components with boolean prop proliferation or designing reusable APIs.',
    );
    assert(parsed.frontmatterKeys.has('metadata'));
    assert.strictEqual(controlPlane.runDoctor(current.settings).some(function falsePositive(item) {
      return item.code === 'SKILL_DESCRIPTION_MISSING' && item.paths.includes(path.join(skillPath, 'SKILL.md'));
    }), false);
  });
});

test('inventory contains only user library and installer-lock records', function run() {
  withFixture(function inspect(current) {
    writeSkill(path.join(current.root, '.codex', 'skills', '.system', 'system-only'), 'system-only', 'System workflow.');
    writeSkill(path.join(current.root, '.codex', 'plugins', 'cache', 'skills', 'plugin-only'), 'plugin-only', 'Plugin workflow.');
    writeSkill(path.join(current.root, '.cursor', 'skills', 'cursor-only'), 'cursor-only', 'Cursor workflow.');
    const payload = JSON.parse(fs.readFileSync(current.settings.agentsLock, 'utf8'));
    payload.skills['missing-user'] = { source: 'example/missing' };
    fs.writeFileSync(current.settings.agentsLock, JSON.stringify(payload, null, 2), 'utf8');

    const inventory = controlPlane.buildInventory(current.settings);
    assert.deepStrictEqual(new Set(inventory.records.map(function source(record) { return record.source; })), new Set([
      'user-library',
      'installer-lock',
    ]));
    assert.strictEqual(inventory.records.some(function external(record) {
      return ['system-only', 'plugin-only', 'cursor-only'].indexOf(record.name) !== -1;
    }), false);
    assert.strictEqual(inventory.records.find(function alpha(record) { return record.name === 'alpha'; }).status, 'available');
    assert.strictEqual(inventory.records.find(function thirdParty(record) { return record.name === 'third-party'; }).detail, 'example/user-skills');
    assert.strictEqual(inventory.records.find(function missing(record) { return record.name === 'missing-user'; }).status, 'missing');
  });
});

test('doctor ignores every Agent-specific synchronization directory', function run() {
  withFixture(function inspect(current) {
    writeSkill(path.join(current.root, '.cursor', 'skills', 'conflict'), 'conflict', 'Cursor-only content.');
    writeSkill(path.join(current.root, '.claude', 'skills', 'missing'), 'missing', 'Claude-only content.');
    const issues = controlPlane.runDoctor(current.settings);
    const codes = issues.map(function code(item) { return item.code; });
    assert.strictEqual(codes.includes('CATALOG_STALE'), false);
    assert.strictEqual(codes.some(function obsolete(code) {
      return /ASH_LINK|TARGET|CODEX_STORE|CODEX_USER_SKILLS|PLUGIN/.test(code);
    }), false);
    assert.strictEqual(issues.some(function externalPath(item) {
      return item.paths.some(function target(itemPath) { return /\.cursor|\.claude/.test(itemPath); });
    }), false);

    assert.deepStrictEqual(controlPlane.runDoctor(current.settings), []);
  });
});

test('doctor reports broken user links and invalid Agents lock metadata', function run() {
  withFixture(function inspect(current) {
    createDirectoryLink(path.join(current.root, 'missing-source'), path.join(current.library, 'broken-user'));
    fs.writeFileSync(current.settings.agentsLock, '{bad json', 'utf8');
    const issues = controlPlane.runDoctor(current.settings);
    const codes = new Set(issues.map(function code(item) { return item.code; }));
    assert(codes.has('USER_SKILL_LINK_BROKEN'));
    assert(codes.has('AGENTS_LOCK_INVALID'));
  });
});

test('doctor reports retired ASH v1 commands inside user Skills', function run() {
  withFixture(function inspect(current) {
    fs.appendFileSync(path.join(current.beta, 'SKILL.md'), '\nRun `ash install owner/repository`.\n', 'utf8');
    const issues = controlPlane.runDoctor(current.settings);
    const retired = issues.find(function matching(item) { return item.code === 'RETIRED_ASH_COMMAND'; });
    assert(retired);
    assert.deepStrictEqual(retired.paths, [path.join(current.beta, 'SKILL.md')]);
  });
});

test('doctor remains read-only and reports a missing user library', function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-v2-missing-'));
  try {
    const configPath = writeConfig(root);
    const settings = controlPlane.loadSettings({ projectRoot: root, configPath, homeDir: root, env: { HOME: root } });
    const issues = controlPlane.runDoctor(settings);
    assert.strictEqual(issues[0].code, 'USER_LIBRARY_NOT_FOUND');
    assert.strictEqual(fs.existsSync(path.join(root, '.agents')), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.ash')), false);
  } finally {
    removeTree(root);
  }
});

test('repair writes only Codex guidance and rolls it back', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.policies.codex_global_guidance = 'manage';
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    const settings = controlPlane.loadSettings({ projectRoot: current.root, configPath: current.configPath, homeDir: current.root, env: { HOME: current.root } });
    const plan = controlPlane.buildRepairPlan(settings);
    assert.deepStrictEqual(new Set(plan.actions.map(function scope(action) { return action.scope; })), new Set(['codex-guidance']));
    assert(plan.actions.every(function onlyFiles(action) { return action.kind === 'file_write'; }));
    assert.strictEqual(plan.actions.some(function external(action) { return /\.cursor|\.claude|skills_store|plugins/.test(action.path); }), false);

    const transaction = controlPlane.applyRepair(settings, plan);
    assert(fs.existsSync(transaction));
    assert(fs.readFileSync(settings.codexAgentsFile, 'utf8').includes(controlPlane.MANAGED_BLOCK));
    assert.strictEqual(controlPlane.buildRepairPlan(settings).actions.length, 0);

    controlPlane.applyRollback(settings, 'latest');
    assert.strictEqual(fs.existsSync(settings.codexAgentsFile), false);
  });
});

test('rollback refuses to overwrite a later user edit', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.policies.codex_global_guidance = 'manage';
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    const settings = controlPlane.loadSettings({ projectRoot: current.root, configPath: current.configPath, homeDir: current.root, env: { HOME: current.root } });
    const plan = controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' });
    controlPlane.applyRepair(settings, plan);
    fs.writeFileSync(settings.codexAgentsFile, 'user edit\n', 'utf8');
    assert.throws(function rollback() { controlPlane.applyRollback(settings, 'latest'); }, /user-modified/);
    assert.strictEqual(fs.readFileSync(settings.codexAgentsFile, 'utf8'), 'user edit\n');
  });
});

test('Codex guidance preserves personal text and refuses a shadowing override', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.policies.codex_global_guidance = 'manage';
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    const settings = controlPlane.loadSettings({ projectRoot: current.root, configPath: current.configPath, homeDir: current.root, env: { HOME: current.root } });
    fs.mkdirSync(path.dirname(settings.codexAgentsFile), { recursive: true });
    fs.writeFileSync(settings.codexAgentsFile, '# Personal\n\nKeep this.\n', 'utf8');
    controlPlane.applyRepair(settings, controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' }));
    assert(fs.readFileSync(settings.codexAgentsFile, 'utf8').startsWith('# Personal\n\nKeep this.\n'));

    fs.writeFileSync(settings.codexAgentsOverrideFile, '# Override\n', 'utf8');
    const blocked = controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' });
    assert(blocked.conflicts.some(function override(item) { return item.code === 'CODEX_AGENTS_OVERRIDE_SHADOWS_ASH'; }));
  });
});

test('init creates an empty user library without seeding project or legacy Skills', function run() {
  withFixture(function inspect(current) {
    writeSkill(path.join(current.root, 'skills', 'project-copy'), 'project-copy', 'Project content must not be seeded.');
    writeSkill(path.join(current.root, '.ash', 'skills', 'legacy-only'), 'legacy-only', 'Obsolete legacy workflow.');
    const freshLibrary = path.join(current.root, 'fresh-user-library');
    const settings = Object.assign({}, current.settings, { libraryRoot: freshLibrary });

    const result = controlPlane.initializeLibrary(settings);
    assert.deepStrictEqual(result, { createdLibrary: true, libraryRoot: freshLibrary });
    assert.deepStrictEqual(fs.readdirSync(freshLibrary), []);
    assert.strictEqual(fs.existsSync(path.join(freshLibrary, 'project-copy')), false);
    assert.strictEqual(fs.existsSync(path.join(freshLibrary, 'legacy-only')), false);
    assert.strictEqual(fs.existsSync(path.join(current.root, '.cursor')), false);
    assert.strictEqual(fs.existsSync(path.join(current.root, '.claude')), false);

    const second = controlPlane.initializeLibrary(settings);
    assert.deepStrictEqual(second, { createdLibrary: false, libraryRoot: freshLibrary });
  });
});

test('sync without a Git checkout never changes the user library', function run() {
  withFixture(function inspect(current) {
    const before = fs.readdirSync(current.library).sort();
    writeSkill(path.join(current.root, 'skills', 'sync-added'), 'sync-added', 'Project content must remain separate.');
    const result = controlPlane.syncRepository(current.settings);
    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.initialization, undefined);
    assert.deepStrictEqual(fs.readdirSync(current.library).sort(), before);
    assert.strictEqual(fs.existsSync(path.join(current.library, 'sync-added')), false);
    assert.strictEqual(fs.existsSync(path.join(current.root, '.cursor')), false);
  });
});

test('sync uses the checkout upstream without hard-coded Agent or branch logic', function run() {
  withFixture(function inspect(current) {
    fs.mkdirSync(path.join(current.root, '.git'));
    let observed = null;
    const result = controlPlane.syncRepository(current.settings, {
      spawnSync: function spawn(command, args, options) {
        observed = { command, args, cwd: options.cwd };
        return { status: 0, stdout: 'Already up to date.\n', stderr: '' };
      },
    });
    assert.strictEqual(result.updated, true);
    assert.deepStrictEqual(observed, {
      command: 'git',
      args: ['pull', '--ff-only'],
      cwd: current.root,
    });
  });
});

test('list, info, and search operate only on the user library', function run() {
  withFixture(function inspect(current) {
    writeSkill(path.join(current.root, '.codex', 'skills', '.system', 'system-only'), 'system-only', 'System workflow.');
    let result = runMain(current, ['list', '--json']);
    assert.strictEqual(result.exitCode, 0, result.stderr);
    let payload = JSON.parse(result.stdout);
    assert.deepStrictEqual(payload.skills.map(function name(skill) { return skill.name; }), ['alpha', 'beta', 'third-party']);

    result = runMain(current, ['info', 'alpha', '--json']);
    payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.name, 'alpha');
    assert.strictEqual(payload.description, 'Alpha user workflow.');

    result = runMain(current, ['search', 'beta', '--json']);
    payload = JSON.parse(result.stdout);
    assert.deepStrictEqual(payload.skills.map(function name(skill) { return skill.name; }), ['beta']);
    assert.strictEqual(payload.skills.some(function system(skill) { return skill.name === 'system-only'; }), false);
  });
});

test('removed legacy commands fail without writing client directories', function run() {
  withFixture(function inspect(current) {
    ['add', 'install', 'status', 'clean', 'uninstall', 'catalog'].forEach(function removed(command) {
      const result = runMain(current, [command, 'alpha']);
      assert.strictEqual(result.exitCode, 2);
      assert(result.stderr.includes('removed in ASH v2'));
    });
    assert.strictEqual(fs.existsSync(path.join(current.root, '.cursor')), false);
    assert.strictEqual(fs.existsSync(path.join(current.root, '.claude')), false);
  });
});

test('ash create scaffolds a standard user Skill', function run() {
  withFixture(function inspect(current) {
    const result = runMain(current, [
      'create', 'review-release', '--description', 'Review release readiness and evidence.', '--json',
    ]);
    assert.strictEqual(result.exitCode, 0, result.stderr);
    const created = JSON.parse(result.stdout);
    assert.strictEqual(created.path, path.join(current.library, 'review-release'));
    assert(fs.existsSync(path.join(created.path, 'SKILL.md')));
    assert(fs.existsSync(path.join(created.path, 'agents', 'openai.yaml')));
    assert.throws(function duplicate() { controlPlane.createSkill(current.settings, 'review-release'); }, /already exists/);
  });
});

test('create does not implicitly seed project or legacy Skills', function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-v2-create-only-'));
  try {
    const result = childProcess.spawnSync(
      '/bin/bash',
      [
        path.join(__dirname, '..', 'bin', 'ash'),
        '--home', root,
        'create', 'only-user-skill', '--description', 'Created explicitly by the user.', '--json',
      ],
      { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { HOME: root }), encoding: 'utf8' },
    );
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents', 'skills')), ['only-user-skill']);
    assert.strictEqual(fs.existsSync(path.join(root, '.ash')), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.codex')), false);
  } finally {
    removeTree(root);
  }
});

test('package output is deterministic and excludes local secrets', function run() {
  withFixture(function inspect(current) {
    const assets = path.join(current.beta, 'assets');
    fs.mkdirSync(assets);
    fs.writeFileSync(path.join(assets, '.env'), 'TOKEN=secret\n', 'utf8');
    fs.writeFileSync(path.join(assets, '.env.example'), 'TOKEN=replace-me\n', 'utf8');
    const skill = controlPlane.findLibrarySkill(current.settings, 'beta');
    const first = controlPlane.buildArchive(skill);
    const second = controlPlane.buildArchive(skill);
    assert(first.equals(second));
    const names = controlPlane.buildArchiveEntries(skill).map(function name(entry) { return entry.name; });
    assert(names.includes('beta/assets/.env.example'));
    assert.strictEqual(names.includes('beta/assets/.env'), false);
  });
});

test('snapshot captures only user Skills and materializes top-level links', function run() {
  withFixture(function inspect(current) {
    writeSkill(path.join(current.root, '.codex', 'skills', '.system', 'system-only'), 'system-only', 'System workflow.');
    writeSkill(path.join(current.root, '.codex', 'plugins', 'cache', 'skills', 'plugin-only'), 'plugin-only', 'Plugin workflow.');
    const linkedSource = writeSkill(path.join(current.root, 'external', 'linked-user'), 'linked-user', 'Linked user workflow.');
    fs.mkdirSync(path.join(linkedSource, 'assets'));
    fs.writeFileSync(path.join(linkedSource, 'assets', 'large.bin'), Buffer.alloc(1024 * 1024, 0x61));
    fs.writeFileSync(path.join(linkedSource, '.env'), 'TOKEN=secret\n', 'utf8');
    createDirectoryLink(current.alpha, path.join(linkedSource, 'nested-link'));
    createDirectoryLink(linkedSource, path.join(current.library, 'linked-user'));

    const output = path.join(current.root, 'users.ash-snapshot');
    const written = controlPlane.writeSnapshot(current.settings, output, { now: new Date('2026-08-17T00:00:00.000Z') });
    assert.strictEqual(written.skill_count, 4);
    assert.strictEqual(written.materialized_symlink_count, 1);
    assert.strictEqual(fs.statSync(output).mode & 0o777, 0o600);
    const snapshot = controlPlane.readSnapshot(output);
    assert.deepStrictEqual(snapshot.skills.map(function name(skill) { return skill.path; }), ['alpha', 'beta', 'linked-user', 'third-party']);
    assert.strictEqual(snapshot.skills.some(function external(skill) { return /system|plugin/.test(skill.path); }), false);
    const linked = snapshot.skills.find(function matching(skill) { return skill.path === 'linked-user'; });
    assert(linked.omitted.some(function secret(item) { return item.path === '.env' && item.reason === 'local-file'; }));
    assert(linked.omitted.some(function nested(item) { return item.path === 'nested-link' && item.reason === 'symlink'; }));
  });
});

test('snapshot restore is dry-run first, idempotent, and verifiable', function run() {
  withFixture(function source(sourceFixture) {
    writeSkill(path.join(sourceFixture.library, 'source-only'), 'source-only', 'Source-only workflow.');
    const output = path.join(sourceFixture.root, 'user-skills.ash-snapshot');
    controlPlane.writeSnapshot(sourceFixture.settings, output);
    withFixture(function target(targetFixture) {
      let result = runMain(targetFixture, ['snapshot', 'restore', output, '--json']);
      assert.strictEqual(result.exitCode, 0, result.stderr);
      let payload = JSON.parse(result.stdout);
      assert.deepStrictEqual(payload.actions.map(function name(item) { return item.skill_path; }), ['source-only']);
      assert.strictEqual(controlPlane.lexists(path.join(targetFixture.library, 'source-only')), false);

      result = runMain(targetFixture, ['snapshot', 'restore', output, '--apply', '--json']);
      assert.strictEqual(result.exitCode, 0, result.stderr);
      payload = JSON.parse(result.stdout);
      assert.deepStrictEqual(payload.created, [path.join(targetFixture.library, 'source-only')]);
      const snapshot = controlPlane.readSnapshot(output);
      assert.strictEqual(controlPlane.verifySnapshot(targetFixture.settings, snapshot).ok, true);
      assert.deepStrictEqual(controlPlane.applySnapshotRestore(targetFixture.settings, snapshot).created, []);

      writeSkill(path.join(targetFixture.library, 'target-extra'), 'target-extra', 'Target-only workflow.');
      assert.strictEqual(controlPlane.verifySnapshot(targetFixture.settings, snapshot).ok, false);
    });
  });
});

test('snapshot restore refuses conflicts without partial writes', function run() {
  withFixture(function source(sourceFixture) {
    writeSkill(path.join(sourceFixture.library, 'source-only'), 'source-only', 'Source-only workflow.');
    const output = path.join(sourceFixture.root, 'conflict.ash-snapshot');
    controlPlane.writeSnapshot(sourceFixture.settings, output);
    withFixture(function target(targetFixture) {
      fs.appendFileSync(path.join(targetFixture.alpha, 'SKILL.md'), '\nTarget edit.\n', 'utf8');
      const result = runMain(targetFixture, ['snapshot', 'restore', output, '--apply', '--json']);
      assert.strictEqual(result.exitCode, 1, result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).mode, 'apply-refused');
      assert.strictEqual(controlPlane.lexists(path.join(targetFixture.library, 'source-only')), false);
    });
  });
});

test('snapshot validation rejects tampered content and unsafe paths', function run() {
  withFixture(function inspect(current) {
    const original = path.join(current.root, 'original.ash-snapshot');
    controlPlane.writeSnapshot(current.settings, original);
    const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(original)).toString('utf8'));
    payload.skills[0].files[0].content_base64 = Buffer.from('tampered\n').toString('base64');
    const tampered = path.join(current.root, 'tampered.ash-snapshot');
    fs.writeFileSync(tampered, zlib.gzipSync(Buffer.from(JSON.stringify(payload))));
    assert.throws(function read() { controlPlane.readSnapshot(tampered); }, /checksum mismatch/);

    const unsafePayload = JSON.parse(zlib.gunzipSync(fs.readFileSync(original)).toString('utf8'));
    unsafePayload.skills[0].files[0].path = '../escape';
    unsafePayload.snapshot_id = controlPlane.snapshotDigest(unsafePayload);
    const unsafe = path.join(current.root, 'unsafe.ash-snapshot');
    fs.writeFileSync(unsafe, zlib.gzipSync(Buffer.from(JSON.stringify(unsafePayload))));
    assert.throws(function read() { controlPlane.readSnapshot(unsafe); }, /relative path|unsafe path/);
  });
});

test('Bash launcher routes directly to the shared Node CLI', function run() {
  withFixture(function inspect(current) {
    const result = childProcess.spawnSync(
      '/bin/bash',
      [path.join(__dirname, '..', 'bin', 'ash'), '--config', current.configPath, '--home', current.root, 'list', '--json'],
      { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { HOME: current.root }), encoding: 'utf8' },
    );
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout).skills.map(function name(skill) { return skill.name; }), ['alpha', 'beta', 'third-party']);
  });
});

test('read-only doctor does not initialize a missing home', function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-v2-read-only-'));
  try {
    const result = childProcess.spawnSync(
      '/bin/bash',
      [path.join(__dirname, '..', 'bin', 'ash'), '--home', root, 'doctor', '--json'],
      { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { HOME: root }), encoding: 'utf8' },
    );
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).issues[0].code, 'USER_LIBRARY_NOT_FOUND');
    assert.strictEqual(fs.existsSync(path.join(root, '.agents')), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.ash')), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.codex')), false);
  } finally {
    removeTree(root);
  }
});

test('snapshot restore preview does not initialize the destination home', function run() {
  withFixture(function source(current) {
    const snapshot = path.join(current.root, 'preview.ash-snapshot');
    controlPlane.writeSnapshot(current.settings, snapshot);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-v2-preview-'));
    try {
      const result = childProcess.spawnSync(
        '/bin/bash',
        [path.join(__dirname, '..', 'bin', 'ash'), '--home', target, 'snapshot', 'restore', snapshot, '--json'],
        { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { HOME: target }), encoding: 'utf8' },
      );
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).actions.length, 3);
      assert.strictEqual(fs.existsSync(path.join(target, '.agents')), false);
      assert.strictEqual(fs.existsSync(path.join(target, '.ash')), false);
      assert.strictEqual(fs.existsSync(path.join(target, '.codex')), false);
    } finally {
      removeTree(target);
    }
  });
});

test('help and version do not initialize a home and omit removed commands', function run() {
  ['--help', '--version'].forEach(function check(argument) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-v2-meta-'));
    try {
      const result = childProcess.spawnSync(
        '/bin/bash',
        [path.join(__dirname, '..', 'bin', 'ash'), argument],
        { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { HOME: root }), encoding: 'utf8' },
      );
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      if (argument === '--help') {
        assert(result.stdout.includes('user Skill library manager'));
        assert.strictEqual(result.stdout.includes('  status '), false);
        assert.strictEqual(result.stdout.includes('  clean '), false);
        assert.strictEqual(result.stdout.includes('  install '), false);
      } else {
        assert.strictEqual(result.stdout.trim(), '2.0.0');
      }
      assert.strictEqual(fs.existsSync(path.join(root, '.agents')), false);
      assert.strictEqual(fs.existsSync(path.join(root, '.ash')), false);
    } finally {
      removeTree(root);
    }
  });
});

test('v2 CLI command surface removes Catalog without adding interactive commands', function run() {
  const commandBlock = controlPlane.helpText().split('Commands:\n')[1].split('\n\nGlobal options:')[0];
  const commands = commandBlock.split('\n').map(function command(line) {
    const match = /^  ([a-z]+)/.exec(line);
    return match && match[1];
  }).filter(Boolean);
    assert.deepStrictEqual(commands, [
      'init', 'list', 'info', 'search', 'create', 'inventory', 'doctor', 'repair',
      'rollback', 'package', 'snapshot', 'sync', 'ui',
  ]);
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
