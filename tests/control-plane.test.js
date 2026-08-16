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

test('parses YAML block scalar chomping indicators in Skill descriptions', function run() {
  withFixture(function inspect(current) {
    const skillPath = path.join(current.library, 'folded-description');
    fs.mkdirSync(skillPath);
    fs.writeFileSync(
      path.join(skillPath, 'SKILL.md'),
      '---\nname: folded-description\ndescription: >-\n  First line\n  second line\n---\n',
      'utf8',
    );
    const parsed = controlPlane.parseSkill(skillPath, 'folded-description');
    assert.strictEqual(parsed.description, 'First line second line');
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

test('ash create scaffolds a standard Skill in the universal Agents library', function run() {
  withFixture(function inspect(current) {
    let output = '';
    let errors = '';
    const exitCode = controlPlane.main([
      '--config', current.configPath,
      '--home', current.root,
      'create', 'review-release',
      '--description', 'Review release readiness and verify required evidence.',
    ], {
      projectRoot: current.root,
      env: { HOME: current.root },
      stdout: { write: function write(value) { output += value; } },
      stderr: { write: function write(value) { errors += value; } },
    });
    assert.strictEqual(exitCode, 0, errors);
    const created = path.join(current.library, 'review-release');
    const parsed = controlPlane.parseSkill(created, 'review-release');
    assert.strictEqual(parsed.declaredName, 'review-release');
    assert.strictEqual(parsed.description, 'Review release readiness and verify required evidence.');
    const metadata = fs.readFileSync(path.join(created, 'agents', 'openai.yaml'), 'utf8');
    assert(metadata.includes('display_name: "Review Release"'));
    assert(metadata.includes('default_prompt: "Use $review-release to complete this workflow."'));
    assert(output.includes('Created Skill scaffold: ' + created));

    let duplicateErrors = '';
    const duplicateCode = controlPlane.main([
      '--config', current.configPath,
      '--home', current.root,
      'create', 'review-release',
    ], {
      projectRoot: current.root,
      env: { HOME: current.root },
      stdout: { write: function write() {} },
      stderr: { write: function write(value) { duplicateErrors += value; } },
    });
    assert.strictEqual(duplicateCode, 2);
    assert(duplicateErrors.includes('Skill already exists'));
  });
});

test('ash create rejects invalid Skill names without creating partial files', function run() {
  withFixture(function inspect(current) {
    let errors = '';
    const exitCode = controlPlane.main([
      '--config', current.configPath,
      '--home', current.root,
      'create', 'Bad_Name',
    ], {
      projectRoot: current.root,
      env: { HOME: current.root },
      stdout: { write: function write() {} },
      stderr: { write: function write(value) { errors += value; } },
    });
    assert.strictEqual(exitCode, 2);
    assert(errors.includes('lowercase letters'));
    assert.strictEqual(controlPlane.lexists(path.join(current.library, 'Bad_Name')), false);

    errors = '';
    const descriptionCode = controlPlane.main([
      '--config', current.configPath,
      '--home', current.root,
      'create', 'valid-name',
      '--description', 'Use for <placeholder> tasks.',
    ], {
      projectRoot: current.root,
      env: { HOME: current.root },
      stdout: { write: function write() {} },
      stderr: { write: function write(value) { errors += value; } },
    });
    assert.strictEqual(descriptionCode, 2);
    assert(errors.includes('angle brackets'));
    assert.strictEqual(controlPlane.lexists(path.join(current.library, 'valid-name')), false);
  });
});

test('Codex guidance repair writes only its managed block and restores an empty file', function run() {
  withFixture(function inspect(current) {
    const settings = Object.assign({}, current.settings, {
      codexGlobalGuidancePolicy: 'manage',
    });
    fs.mkdirSync(path.dirname(settings.codexAgentsFile), { recursive: true });
    fs.writeFileSync(settings.codexAgentsFile, '', 'utf8');
    assert(controlPlane.runDoctor(settings).some(function missing(item) {
      return item.code === 'CODEX_ASH_GUIDANCE_MISSING';
    }));

    const plan = controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' });
    assert.strictEqual(plan.actions.length, 1);
    assert.strictEqual(plan.actions[0].scope, 'codex-guidance');
    assert.strictEqual(plan.conflicts.length, 0);
    const transaction = controlPlane.applyRepair(settings, plan);
    assert.strictEqual(
      fs.readFileSync(settings.codexAgentsFile, 'utf8'),
      controlPlane.MANAGED_BLOCK + '\n',
    );
    assert.strictEqual(controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' }).actions.length, 0);

    controlPlane.applyRollback(settings, path.basename(path.dirname(transaction)));
    assert.strictEqual(fs.readFileSync(settings.codexAgentsFile, 'utf8'), '');
  });
});

test('Codex guidance preserves personal instructions and refreshes only the managed block', function run() {
  withFixture(function inspect(current) {
    const settings = Object.assign({}, current.settings, {
      codexGlobalGuidancePolicy: 'manage',
    });
    fs.mkdirSync(path.dirname(settings.codexAgentsFile), { recursive: true });
    const personal = '# Personal instructions\n\nKeep this exact text.\n';
    fs.writeFileSync(settings.codexAgentsFile, personal, 'utf8');
    controlPlane.applyRepair(
      settings,
      controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' }),
    );
    let content = fs.readFileSync(settings.codexAgentsFile, 'utf8');
    assert(content.indexOf(personal) === 0);
    assert(content.includes(controlPlane.MANAGED_BLOCK));

    content = content.replace('Never modify Codex', 'Do not change Codex');
    fs.writeFileSync(settings.codexAgentsFile, content, 'utf8');
    assert(controlPlane.codexGuidanceIssues(settings).some(function stale(item) {
      return item.code === 'CODEX_ASH_GUIDANCE_STALE';
    }));
    controlPlane.applyRepair(
      settings,
      controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' }),
    );
    const refreshed = fs.readFileSync(settings.codexAgentsFile, 'utf8');
    assert(refreshed.indexOf(personal) === 0);
    assert(refreshed.includes(controlPlane.MANAGED_BLOCK));
    assert.strictEqual(refreshed.includes('Do not change Codex'), false);
  });
});

test('Codex guidance refuses malformed markers and a shadowing override', function run() {
  withFixture(function inspect(current) {
    const settings = Object.assign({}, current.settings, {
      codexGlobalGuidancePolicy: 'manage',
    });
    fs.mkdirSync(path.dirname(settings.codexAgentsFile), { recursive: true });
    fs.writeFileSync(settings.codexAgentsFile, controlPlane.START_MARKER + '\npartial\n', 'utf8');
    let plan = controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' });
    assert.strictEqual(plan.actions.length, 0);
    assert(plan.conflicts.some(function malformed(item) {
      return item.code === 'CODEX_ASH_GUIDANCE_MALFORMED';
    }));

    fs.writeFileSync(settings.codexAgentsFile, '', 'utf8');
    fs.writeFileSync(settings.codexAgentsOverrideFile, '# Override\n', 'utf8');
    plan = controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' });
    assert.strictEqual(plan.actions.length, 0);
    assert(plan.conflicts.some(function shadowed(item) {
      return item.code === 'CODEX_AGENTS_OVERRIDE_SHADOWS_ASH';
    }));
    assert.strictEqual(fs.readFileSync(settings.codexAgentsFile, 'utf8'), '');
  });
});

test('scoped Codex guidance repair does not require or reconcile the Skill library', function run() {
  withFixture(function inspect(current) {
    const settings = Object.assign({}, current.settings, {
      libraryRoot: path.join(current.root, 'missing-library'),
      codexGlobalGuidancePolicy: 'manage',
    });
    const plan = controlPlane.buildRepairPlan(settings, { scope: 'codex-guidance' });
    assert.strictEqual(plan.actions.length, 1);
    assert.strictEqual(plan.actions[0].path, settings.codexAgentsFile);
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

test('Codex user Skill policy migrates Store and untracked sources and rolls back safely', function run() {
  withFixture(function inspect(current) {
    const storeSource = writeSkill(
      path.join(current.codexRoot, '@publisher', 'store-skill'),
      'store-skill',
      'Store-installed workflow.',
    );
    const systemSource = writeSkill(
      path.join(current.codexRoot, '.system', 'system-skill'),
      'system-skill',
      'Codex-owned system workflow.',
    );
    const pluginSource = writeSkill(
      path.join(current.root, 'codex', 'plugins', 'example', 'skills', 'plugin-skill'),
      'plugin-skill',
      'Plugin-owned workflow.',
    );
    fs.writeFileSync(current.settings.codexStoreLock, JSON.stringify({
      version: 1,
      skills: {
        '@publisher/store-skill': {
          version: '1.2.3',
          installDir: storeSource,
        },
      },
    }, null, 2), 'utf8');
    const settings = Object.assign({}, current.settings, {
      codexUserSkillsPolicy: 'migrate-to-agents',
    });

    assert(controlPlane.runDoctor(settings).some(function outside(item) {
      return item.code === 'CODEX_USER_SKILLS_OUTSIDE_AGENTS';
    }));
    const plan = controlPlane.buildRepairPlan(settings);
    const migrationSources = plan.actions.filter(function migration(action) {
      return action.kind === 'skill_migrate';
    }).map(function source(action) { return action.source; }).sort();
    assert.deepStrictEqual(migrationSources, [
      path.join(current.codexRoot, 'manual-codex'),
      storeSource,
    ].sort());
    assert.strictEqual(plan.actions.some(function systemMigration(action) {
      return action.kind === 'skill_migrate' &&
        (action.source === systemSource || action.source === pluginSource);
    }), false);

    const transaction = controlPlane.applyRepair(settings, plan);
    const manualDestination = path.join(current.library, 'manual-codex');
    const storeDestination = path.join(current.library, 'store-skill');
    assert(fs.lstatSync(manualDestination).isDirectory());
    assert(fs.lstatSync(storeDestination).isDirectory());
    assert.strictEqual(controlPlane.lexists(path.join(current.codexRoot, 'manual-codex')), false);
    assert.strictEqual(controlPlane.lexists(storeSource), false);
    assert(fs.existsSync(path.join(systemSource, 'SKILL.md')));
    assert(fs.existsSync(path.join(pluginSource, 'SKILL.md')));
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        JSON.parse(fs.readFileSync(settings.codexStoreLock, 'utf8')).skills,
        '@publisher/store-skill',
      ),
      false,
    );
    assert.strictEqual(
      controlPlane.canonicalPath(path.join(current.clientRoot, 'store-skill')),
      controlPlane.canonicalPath(storeDestination),
    );
    assert(controlPlane.catalogIsCurrent(settings));

    controlPlane.applyRollback(settings, path.basename(path.dirname(transaction)));
    assert(fs.existsSync(path.join(current.codexRoot, 'manual-codex', 'SKILL.md')));
    assert(fs.existsSync(path.join(storeSource, 'SKILL.md')));
    assert.strictEqual(controlPlane.lexists(manualDestination), false);
    assert.strictEqual(controlPlane.lexists(storeDestination), false);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(settings.codexStoreLock, 'utf8')).skills['@publisher/store-skill'].version,
      '1.2.3',
    );
  });
});

test('Codex user Skill migration adopts a matching Agents alias and restores it on rollback', function run() {
  withFixture(function inspect(current) {
    const source = path.join(current.codexRoot, 'manual-codex');
    const destination = path.join(current.library, 'manual-codex');
    controlPlane.createDirectoryLink(source, destination);
    const settings = Object.assign({}, current.settings, {
      codexUserSkillsPolicy: 'migrate-to-agents',
    });
    const plan = controlPlane.buildRepairPlan(settings);
    assert(plan.actions.some(function migration(action) {
      return action.kind === 'skill_migrate' && action.source === source && action.path === destination;
    }));
    const transaction = controlPlane.applyRepair(settings, plan);
    assert(fs.lstatSync(destination).isDirectory());
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), false);
    assert.strictEqual(controlPlane.lexists(source), false);

    controlPlane.applyRollback(settings, path.basename(path.dirname(transaction)));
    assert(fs.lstatSync(destination).isSymbolicLink());
    assert.strictEqual(controlPlane.canonicalPath(destination), controlPlane.canonicalPath(source));
    assert(fs.existsSync(path.join(source, 'SKILL.md')));
  });
});

test('Codex user Skill migration refuses an existing Agents owner', function run() {
  withFixture(function inspect(current) {
    const destination = writeSkill(
      path.join(current.library, 'manual-codex'),
      'manual-codex',
      'Agents-owned workflow.',
    );
    const settings = Object.assign({}, current.settings, {
      codexUserSkillsPolicy: 'migrate-to-agents',
    });
    const plan = controlPlane.buildRepairPlan(settings);
    assert(plan.conflicts.some(function migrationConflict(item) {
      return item.code === 'CODEX_SKILL_MIGRATION_CONFLICT';
    }));
    assert.strictEqual(plan.actions.some(function unsafe(action) {
      return action.kind === 'skill_migrate' && action.path === destination;
    }), false);
    assert(fs.existsSync(path.join(current.codexRoot, 'manual-codex', 'SKILL.md')));
    assert(fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8').includes('Agents-owned workflow.'));
  });
});

test('rejects an unknown Codex user Skill policy', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.policies = { codex_user_skills: 'move-everything' };
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    assert.throws(function reload() {
      controlPlane.loadSettings({
        projectRoot: current.root,
        configPath: current.configPath,
        homeDir: current.root,
        env: { HOME: current.root },
      });
    }, /codex_user_skills must be observe or migrate-to-agents/);
  });
});

test('rejects an unknown Codex global guidance policy', function run() {
  withFixture(function inspect(current) {
    const payload = JSON.parse(fs.readFileSync(current.configPath, 'utf8'));
    payload.policies = { codex_global_guidance: 'overwrite' };
    fs.writeFileSync(current.configPath, JSON.stringify(payload, null, 2), 'utf8');
    assert.throws(function reload() {
      controlPlane.loadSettings({
        projectRoot: current.root,
        configPath: current.configPath,
        homeDir: current.root,
        env: { HOME: current.root },
      });
    }, /codex_global_guidance must be observe or manage/);
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

test('version and help do not initialize a missing ASH home', function run() {
  ['--version', '--help'].forEach(function check(argument) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-read-only-meta-'));
    try {
      const env = Object.assign({}, process.env, { HOME: root });
      delete env.ASH_SKILLS_DIR;
      const result = childProcess.spawnSync(
        '/bin/bash',
        [path.join(__dirname, '..', 'bin', 'ash'), argument],
        { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' },
      );
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.strictEqual(fs.existsSync(path.join(root, '.agents')), false);
      assert.strictEqual(fs.existsSync(path.join(root, '.ash')), false);
    } finally {
      removeTree(root);
    }
  });
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
