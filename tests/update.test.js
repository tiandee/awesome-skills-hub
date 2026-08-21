'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ash = require('../lib/control-plane');

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function removeTree(target) {
  if (!ash.lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { fs.unlinkSync(target); return; }
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function writeSkill(skillPath, name, description, files) {
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(
    path.join(skillPath, 'SKILL.md'),
    '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n# ' + name + '\n',
    'utf8',
  );
  Object.keys(files || {}).forEach(function write(relative) {
    const output = path.join(skillPath, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const selected = files[relative];
    fs.writeFileSync(output, selected.content === undefined ? selected : selected.content, 'utf8');
    if (selected && typeof selected === 'object' && selected.mode) fs.chmodSync(output, selected.mode);
  });
  return skillPath;
}

function linkDirectory(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-'));
  const library = path.join(root, '.agents', 'skills');
  const stateRoot = path.join(root, '.agents', '.ash');
  fs.mkdirSync(library, { recursive: true });
  const alpha = writeSkill(path.join(library, 'alpha'), 'alpha', 'Alpha installed version.', {
    'old.txt': 'old\n',
    '.env': 'TOKEN=local-secret\n',
    'node_modules/local-cache.txt': 'cache\n',
  });
  writeSkill(path.join(library, 'hashless'), 'hashless', 'Hashless installed Skill.', {
    'node_modules/local-cache.txt': 'keep-this-cache-for-lock-only-rebaseline\n',
  });
  writeSkill(path.join(library, 'manual'), 'manual', 'Manual local Skill.', {
    '.env': 'MANUAL_TOKEN=local-only\n',
    '.local/preferences.json': '{}\n',
    'node_modules/local-cache.txt': 'discard this cache on adoption\n',
  });
  writeSkill(path.join(library, 'bundled-copy'), 'bundled-copy', 'Former bundled copy now owned by the user.');
  const linkedSource = writeSkill(path.join(root, 'linked-source'), 'linked', 'Repository linked Skill.');
  linkDirectory(linkedSource, path.join(library, 'linked'));
  const agentsLock = path.join(root, '.agents', '.skill-lock.json');
  fs.writeFileSync(agentsLock, JSON.stringify({
    version: 3,
    skills: {
      alpha: {
        source: 'example/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/example/skills.git',
        skillPath: 'skills/alpha/SKILL.md',
        skillFolderHash: '1'.repeat(40),
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      hashless: {
        source: 'example/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/example/skills.git',
        skillPath: 'skills/hashless/SKILL.md',
        skillFolderHash: '',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      missing: {
        source: 'example/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/example/skills.git',
        skillPath: 'skills/missing/SKILL.md',
        skillFolderHash: 'missing-tree',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  }, null, 2), 'utf8');
  const configPath = path.join(root, 'ash-control.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: 2,
    library: { path: library, exclude: [] },
    policies: { codex_global_guidance: 'observe' },
    sources: { agents_lock: agentsLock },
      output: {
        state_dir: path.join(stateRoot, 'state', 'control-plane'),
        packages: path.join(stateRoot, 'packages'),
    },
  }, null, 2), 'utf8');
  const settings = ash.loadSettings({ projectRoot: root, configPath, homeDir: root, env: { HOME: root } });
  const candidate = writeSkill(path.join(root, 'candidate-alpha'), 'alpha', 'Alpha latest version.', {
    'new.txt': 'new\n',
    'scripts/run.sh': { content: '#!/bin/sh\necho updated\n', mode: 0o755 },
  });
  const manualCandidate = writeSkill(path.join(root, 'candidate-manual'), 'manual', 'Manual Skill adopted from upstream.', {
    'upstream.txt': 'managed upstream content\n',
  });
  const hashlessCandidate = writeSkill(path.join(root, 'candidate-hashless'), 'hashless', 'Hashless installed Skill.');
  const alphaOther = writeSkill(path.join(root, 'candidate-alpha-other'), 'alpha', 'Alpha from another upstream.', {
    'other.txt': 'from-other-upstream\n',
  });
  let inspectCalls = 0;
  let materializeCalls = 0;
  let resolveCalls = 0;
  const sourceClient = {
    resolve: async function resolve(entry) {
      resolveCalls += 1;
      if (entry.slug !== 'manual') throw new Error('unexpected test catalog slug: ' + entry.slug);
      return { sourceUrl: entry.sourceUrl, skillPath: 'skills/manual/SKILL.md', revision: 'manual-candidate-commit' };
    },
    inspect: async function inspect(entries) {
      inspectCalls += 1;
      const hashes = {};
      entries.forEach(function hash(entry) { hashes[entry.name] = entry.name === 'alpha' ? '2'.repeat(40) : '3'.repeat(40); });
      return { revision: 'candidate-commit', folderHashes: hashes };
    },
    materialize: async function materialize(entry) {
      materializeCalls += 1;
      if (entry.name === 'manual') {
        return { path: manualCandidate, revision: 'manual-candidate-commit', folderHash: '4'.repeat(40), cleanup: function cleanup() {} };
      }
      if (entry.name === 'hashless') {
        return { path: hashlessCandidate, revision: 'hashless-candidate-commit', folderHash: '5'.repeat(40), cleanup: function cleanup() {} };
      }
      if (entry.name === 'alpha' && /other-skills/.test(String(entry.sourceUrl || ''))) {
        return { path: alphaOther, revision: 'alpha-other-commit', folderHash: '9'.repeat(40), cleanup: function cleanup() {} };
      }
      return { path: candidate, revision: 'candidate-commit', folderHash: '2'.repeat(40), cleanup: function cleanup() {} };
    },
  };
  return {
    root,
    library,
    alpha,
    candidate,
    manualCandidate,
    hashlessCandidate,
    agentsLock,
    settings,
    sourceClient,
    inspectCalls: function count() { return inspectCalls; },
    materializeCalls: function count() { return materializeCalls; },
    resolveCalls: function count() { return resolveCalls; },
    cleanup: function cleanup() { removeTree(root); },
  };
}

function withFixture(callback) {
  const current = fixture();
  return Promise.resolve().then(function execute() { return callback(current); }).finally(current.cleanup);
}

test('classifies user Skills by update ownership without touching Agent roots', async function run() {
  await withFixture(async function inspect(current) {
    const result = ash.classifyUserSkillUpdates(current.settings);
    const byName = new Map(result.skills.map(function pair(skill) { return [skill.name, skill]; }));
    assert.strictEqual(byName.get('alpha').status, 'checkable');
    assert.strictEqual(byName.get('hashless').status, 'baseline-missing');
    assert.strictEqual(byName.get('linked').status, 'repository-linked');
    assert.strictEqual(byName.get('bundled-copy').status, 'unmanaged');
    assert.strictEqual(byName.get('manual').status, 'unmanaged');
    assert.strictEqual(byName.get('missing').status, 'missing');
    assert.strictEqual(fs.existsSync(path.join(current.root, '.cursor')), false);
    assert.strictEqual(fs.existsSync(path.join(current.root, '.claude')), false);
  });
});

test('summarizes source coverage, anomalies, and stale installer records', function run() {
  const result = ash.sourceInsights({ skills: [
    { name: 'manual', ownership: 'manual', status: 'unmanaged' },
    { name: 'linked', ownership: 'git-link', status: 'repository-linked' },
    { name: 'baseline', ownership: 'installer-lock', status: 'baseline-missing', source: 'example/skills', updated_at: '2025-01-01T00:00:00.000Z' },
    { name: 'ready', ownership: 'installer-lock', status: 'checkable', source: 'example/skills', updated_at: '2026-08-10T00:00:00.000Z' },
    { name: 'offline', ownership: 'installer-lock', status: 'source-unavailable', source: 'other/skills' },
    { name: 'missing', ownership: 'installer-lock', status: 'missing', source: 'other/skills', installed_at: '2024-01-01T00:00:00.000Z' },
  ] }, { now: new Date('2026-08-20T00:00:00.000Z'), staleDays: 180 });
  assert.strictEqual(result.coverage_percent, 83.3);
  assert.strictEqual(result.update_ready_percent, 16.7);
  assert.strictEqual(result.counts.unlinked, 1);
  assert.strictEqual(result.counts.baseline_missing, 1);
  assert.strictEqual(result.anomalies, 2);
  assert.strictEqual(result.counts.stale, 2);
  assert.strictEqual(result.counts.undated, 1);
  assert.deepStrictEqual(result.stale_skills.map(function name(skill) { return skill.name; }), ['missing', 'baseline']);
  assert.deepStrictEqual(result.repositories, [{ source: 'example/skills', count: 2 }, { source: 'other/skills', count: 2 }]);
});

test('parses only exact GitHub-backed skills.sh Skill identities', function run() {
  assert.deepStrictEqual(ash.parseSkillsShUrl('https://www.skills.sh/vercel-labs/skills/find-skills'), {
    owner: 'vercel-labs',
    repository: 'skills',
    slug: 'find-skills',
    source: 'vercel-labs/skills',
    source_id: 'vercel-labs/skills/find-skills',
    source_url: 'https://github.com/vercel-labs/skills.git',
    skills_url: 'https://skills.sh/vercel-labs/skills/find-skills',
  });
  assert.throws(function ambiguous() { ash.parseSkillsShUrl('https://skills.sh/find-skills'); }, /owner\/repository\/skill/);
  assert.throws(function wellKnown() { ash.parseSkillsShUrl('https://skills.sh/mintlify.com/mintlify'); }, /owner\/repository\/skill/);
  assert.throws(function query() { ash.parseSkillsShUrl('https://skills.sh/vercel-labs/skills/find-skills?pick=1'); }, /must not include/);
});

test('checks eligible updates through an injected source client', async function run() {
  await withFixture(async function inspect(current) {
    const result = await ash.checkUserSkillUpdates(current.settings, { sourceClient: current.sourceClient });
    const alpha = result.skills.find(function matching(skill) { return skill.name === 'alpha'; });
    assert.strictEqual(alpha.status, 'update-available');
    assert.strictEqual(alpha.latest_hash, '2'.repeat(40));
    assert.strictEqual(result.summary.update_available, 1);
    assert.strictEqual(current.inspectCalls(), 1);
  });
});

test('checks only the requested Skill when a name is supplied', async function run() {
  await withFixture(async function inspect(current) {
    const result = await ash.checkUserSkillUpdates(current.settings, {
      sourceClient: current.sourceClient,
      name: 'alpha',
    });
    const alpha = result.skills.find(function matching(skill) { return skill.name === 'alpha'; });
    const hashless = result.skills.find(function matching(skill) { return skill.name === 'hashless'; });
    assert.strictEqual(alpha.status, 'update-available');
    assert.strictEqual(hashless.status, 'baseline-missing');
    assert.strictEqual(result.summary.update_available, 1);
    assert.strictEqual(current.inspectCalls(), 1);
  });
});

test('classifies 64-character installer content hashes as non-comparable baselines', async function run() {
  await withFixture(async function inspect(current) {
    const lock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
    lock.skills.alpha.skillFolderHash = 'a'.repeat(64);
    fs.writeFileSync(current.agentsLock, JSON.stringify(lock, null, 2), 'utf8');
    let inspected = false;
    const sourceClient = { inspect: async function check() { inspected = true; return { folderHashes: {} }; } };
    const result = await ash.checkUserSkillUpdates(current.settings, { sourceClient });
    const alpha = result.skills.find(function matching(skill) { return skill.name === 'alpha'; });
    assert.strictEqual(alpha.status, 'baseline-missing');
    assert.strictEqual(alpha.baseline_reason, 'content-hash-not-remotely-comparable');
    assert.strictEqual(result.summary.update_available, 0);
    assert.strictEqual(inspected, false);
  });
});

test('previews file changes and executable risk without writing', async function run() {
  await withFixture(async function inspect(current) {
    const before = fs.readFileSync(path.join(current.alpha, 'SKILL.md'), 'utf8');
    const preview = await ash.buildSkillUpdatePreview(current.settings, {
      name: 'alpha', latest_hash: '2'.repeat(40), latest_revision: 'candidate-commit',
    }, { sourceClient: current.sourceClient });
    assert(preview.diff.added.some(function added(item) { return item.path === 'new.txt'; }));
    assert(preview.diff.changed.some(function changed(item) { return item.path === 'SKILL.md'; }));
    assert(preview.diff.deleted.some(function removed(item) { return item.path === 'old.txt'; }));
    assert(preview.diff.executable_changes.includes('scripts/run.sh'));
    assert(preview.preserved_local_entries.some(function env(item) { return item.path === '.env'; }));
    assert(preview.discarded_local_entries.some(function cache(item) { return item.path === 'node_modules'; }));
    assert.strictEqual(fs.readFileSync(path.join(current.alpha, 'SKILL.md'), 'utf8'), before);
  });
});

test('applies one Skill update transaction and rolls it back safely', async function run() {
  await withFixture(async function inspect(current) {
    const lockWithProvenance = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
    lockWithProvenance.skills.alpha.skillsUrl = 'https://skills.sh/example/skills/alpha';
    fs.writeFileSync(current.agentsLock, JSON.stringify(lockWithProvenance, null, 2), 'utf8');
    const originalLock = fs.readFileSync(current.agentsLock, 'utf8');
    const preview = await ash.buildSkillUpdatePreview(current.settings, {
      name: 'alpha', latest_hash: '2'.repeat(40), latest_revision: 'candidate-commit',
    }, { sourceClient: current.sourceClient });
    const transaction = await ash.applySkillUpdate(current.settings, preview, { sourceClient: current.sourceClient });
    assert(fs.existsSync(transaction));
    const completedTransaction = JSON.parse(fs.readFileSync(transaction, 'utf8'));
    assert.strictEqual(completedTransaction.version, 1);
    assert.deepStrictEqual(completedTransaction.rollback, {
      initiator: null,
      reason: null,
      outcome: 'not_required',
      started_at: null,
      completed_at: null,
      failed_at: null,
    });
    assert(fs.readFileSync(path.join(current.alpha, 'SKILL.md'), 'utf8').includes('Alpha latest version.'));
    assert(fs.existsSync(path.join(current.alpha, 'new.txt')));
    assert.strictEqual(fs.existsSync(path.join(current.alpha, 'old.txt')), false);
    assert.strictEqual(fs.readFileSync(path.join(current.alpha, '.env'), 'utf8'), 'TOKEN=local-secret\n');
    assert.strictEqual(fs.existsSync(path.join(current.alpha, 'node_modules')), false);
    const updatedEntry = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8')).skills.alpha;
    assert.strictEqual(updatedEntry.skillFolderHash, '2'.repeat(40));
    assert.strictEqual(updatedEntry.skillsUrl, undefined);

    const rollback = ash.previewSkillUpdateRollback(current.settings, 'latest');
    assert.strictEqual(rollback.name, 'alpha');
    ash.applySkillUpdateRollback(current.settings, rollback.transaction_id);
    const rolledBackTransaction = JSON.parse(fs.readFileSync(transaction, 'utf8'));
    assert.strictEqual(rolledBackTransaction.version, 1);
    assert.strictEqual(rolledBackTransaction.rollback.initiator, 'manual');
    assert.strictEqual(rolledBackTransaction.rollback.reason, 'manual_request');
    assert.strictEqual(rolledBackTransaction.rollback.outcome, 'completed');
    assert(rolledBackTransaction.rollback.started_at);
    assert(rolledBackTransaction.rollback.completed_at);
    assert.strictEqual(rolledBackTransaction.rollback.failed_at, null);
    assert(fs.readFileSync(path.join(current.alpha, 'SKILL.md'), 'utf8').includes('Alpha installed version.'));
    assert(fs.existsSync(path.join(current.alpha, 'old.txt')));
    assert(fs.existsSync(path.join(current.alpha, 'node_modules', 'local-cache.txt')));
    assert.strictEqual(fs.existsSync(path.join(current.alpha, 'new.txt')), false);
    assert.strictEqual(fs.readFileSync(current.agentsLock, 'utf8'), originalLock);
  });
});

test('rebases the final lock write so an unrelated concurrent entry survives apply and rollback', async function run() {
  await withFixture(async function inspect(current) {
    const preview = await ash.buildSkillUpdatePreview(current.settings, {
      name: 'alpha', latest_hash: '2'.repeat(40), latest_revision: 'candidate-commit',
    }, { sourceClient: current.sourceClient });
    const renameSync = fs.renameSync;
    let injected = false;
    let concurrentLockContent = null;
    try {
      fs.renameSync = function injectAfterPreparation(source, destination) {
        const result = renameSync(source, destination);
        if (!injected && path.basename(destination) === 'transaction.json') {
          const transaction = JSON.parse(fs.readFileSync(destination, 'utf8'));
          if (transaction.status === 'prepared') {
            const concurrentLock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
            concurrentLock.skills.concurrent = {
              source: 'example/concurrent',
              sourceType: 'github',
              sourceUrl: 'https://github.com/example/concurrent.git',
              skillPath: 'skills/concurrent/SKILL.md',
              skillFolderHash: '9'.repeat(40),
              installedAt: '2026-08-21T00:00:00.000Z',
              updatedAt: '2026-08-21T00:00:00.000Z',
            };
            concurrentLockContent = JSON.stringify(concurrentLock, null, 2) + '\n';
            fs.writeFileSync(current.agentsLock, concurrentLockContent, 'utf8');
            injected = true;
          }
        }
        return result;
      };
      const transactionFile = await ash.applySkillUpdate(current.settings, preview, { sourceClient: current.sourceClient });
      const transaction = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
      const appliedLock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
      assert.strictEqual(injected, true);
      assert.strictEqual(appliedLock.skills.concurrent.skillFolderHash, '9'.repeat(40));
      assert.strictEqual(appliedLock.skills.alpha.skillFolderHash, '2'.repeat(40));
      assert.strictEqual(fs.readFileSync(transaction.lock_backup, 'utf8'), concurrentLockContent);
      assert.strictEqual(transaction.before_lock_sha256, ash.sha256(Buffer.from(concurrentLockContent, 'utf8')));
      assert.strictEqual(transaction.lock_written, true);
      assert.strictEqual(transaction.written_lock_sha256, transaction.after_lock_sha256);

      ash.applySkillUpdateRollback(current.settings, transaction.id);
      const rolledBackLock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
      assert.strictEqual(rolledBackLock.skills.concurrent.skillFolderHash, '9'.repeat(40));
      assert.strictEqual(rolledBackLock.skills.alpha.skillFolderHash, '1'.repeat(40));
    } finally {
      fs.renameSync = renameSync;
    }
  });
});

test('links an unmanaged Skill to GitHub, adopts the upstream version, and rolls back both content and provenance', async function run() {
  await withFixture(async function inspect(current) {
    const originalLock = fs.readFileSync(current.agentsLock, 'utf8');
    const originalSkill = fs.readFileSync(path.join(current.library, 'manual', 'SKILL.md'), 'utf8');
    const preview = await ash.buildSkillSourcePreview(current.settings, {
      name: 'manual',
      source_url: 'https://github.com/example/manual-skills.git',
      skill_path: 'skills/manual',
    }, { sourceClient: current.sourceClient });
    assert.strictEqual(preview.operation, 'link-source');
    assert.strictEqual(preview.skill_path, 'skills/manual/SKILL.md');
    assert.strictEqual(preview.replace_content, true);
    assert(preview.diff.changed.some(function skillMd(item) { return item.path === 'SKILL.md'; }));
    assert(preview.diff.added.some(function upstream(item) { return item.path === 'upstream.txt'; }));

    const transaction = await ash.applySkillSource(current.settings, preview, { sourceClient: current.sourceClient });
    const lock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
    assert.strictEqual(lock.skills.manual.sourceType, 'github');
    assert.strictEqual(lock.skills.manual.source, 'example/manual-skills');
    assert.strictEqual(lock.skills.manual.skillPath, 'skills/manual/SKILL.md');
    assert.strictEqual(lock.skills.manual.skillsUrl, undefined);
    assert.strictEqual(lock.skills.manual.skillFolderHash, '4'.repeat(40));
    assert(fs.readFileSync(path.join(current.library, 'manual', 'SKILL.md'), 'utf8').includes('adopted from upstream'));
    assert(fs.existsSync(path.join(current.library, 'manual', 'upstream.txt')));
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'manual', '.env'), 'utf8'), 'MANUAL_TOKEN=local-only\n');
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'manual', '.local', 'preferences.json'), 'utf8'), '{}\n');
    assert.strictEqual(fs.existsSync(path.join(current.library, 'manual', 'node_modules')), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(transaction, 'utf8')).operation, 'link-source');
    assert.strictEqual(ash.classifyUserSkillUpdates(current.settings).skills.find(function manual(item) { return item.name === 'manual'; }).status, 'checkable');

    const rollback = ash.previewSkillUpdateRollback(current.settings, 'latest');
    ash.applySkillUpdateRollback(current.settings, rollback.transaction_id);
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'manual', 'SKILL.md'), 'utf8'), originalSkill);
    assert.strictEqual(fs.existsSync(path.join(current.library, 'manual', 'upstream.txt')), false);
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'manual', 'node_modules', 'local-cache.txt'), 'utf8'), 'discard this cache on adoption\n');
    assert.strictEqual(fs.readFileSync(current.agentsLock, 'utf8'), originalLock);
    assert.strictEqual(ash.classifyUserSkillUpdates(current.settings).skills.find(function manual(item) { return item.name === 'manual'; }).status, 'unmanaged');
  });
});

test('takes over identical unmanaged content from an exact skills.sh URL with a lock-only transaction', async function run() {
  await withFixture(async function inspect(current) {
    removeTree(path.join(current.library, 'manual'));
    writeSkill(path.join(current.library, 'manual'), 'manual', 'Manual Skill adopted from upstream.', {
      'upstream.txt': 'managed upstream content\n',
      'node_modules/local-cache.txt': 'catalog cache stays local\n',
    });
    const beforeDigest = ash.portableSkillState(path.join(current.library, 'manual'), 'manual').content_sha256;
    const preview = await ash.buildSkillSourcePreview(current.settings, {
      name: 'manual', skills_url: 'https://skills.sh/example/manual-skills/manual',
    }, { sourceClient: current.sourceClient });
    assert.strictEqual(preview.source_id, 'example/manual-skills/manual');
    assert.strictEqual(preview.skills_url, 'https://skills.sh/example/manual-skills/manual');
    assert.strictEqual(preview.skill_path, 'skills/manual/SKILL.md');
    assert.strictEqual(preview.diff.action_count, 0);
    assert.strictEqual(preview.replace_content, false);
    const transaction = await ash.applySkillSource(current.settings, preview, { sourceClient: current.sourceClient });
    assert.strictEqual(JSON.parse(fs.readFileSync(transaction, 'utf8')).content_replaced, false);
    assert.strictEqual(ash.portableSkillState(path.join(current.library, 'manual'), 'manual').content_sha256, beforeDigest);
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'manual', 'node_modules', 'local-cache.txt'), 'utf8'), 'catalog cache stays local\n');
    const installed = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8')).skills.manual;
    assert.strictEqual(installed.skillFolderHash, '4'.repeat(40));
    assert.strictEqual(installed.skillsUrl, undefined);
    assert.strictEqual(JSON.parse(fs.readFileSync(transaction, 'utf8')).skills_url, 'https://skills.sh/example/manual-skills/manual');
    const classified = ash.classifyUserSkillUpdates(current.settings).skills.find(function manual(item) { return item.name === 'manual'; });
    assert.strictEqual(classified.skills_url, undefined);
    assert(current.resolveCalls() >= 2);
    const legacyV1Transaction = JSON.parse(fs.readFileSync(transaction, 'utf8'));
    delete legacyV1Transaction.rollback;
    fs.writeFileSync(transaction, JSON.stringify(legacyV1Transaction, null, 2) + '\n', 'utf8');
    const rollback = ash.previewSkillUpdateRollback(current.settings, 'latest');
    ash.applySkillUpdateRollback(current.settings, rollback.transaction_id);
    const migratedRollback = JSON.parse(fs.readFileSync(transaction, 'utf8')).rollback;
    assert.strictEqual(migratedRollback.outcome, 'completed');
    assert.strictEqual(migratedRollback.initiator, 'manual');
    assert.strictEqual(JSON.parse(fs.readFileSync(current.agentsLock, 'utf8')).skills.manual, undefined);
  });
});

test('retargets a managed Skill to a different GitHub upstream and rolls back the previous source', async function run() {
  await withFixture(async function inspect(current) {
    const originalLock = fs.readFileSync(current.agentsLock, 'utf8');
    const originalSkill = fs.readFileSync(path.join(current.library, 'alpha', 'SKILL.md'), 'utf8');
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, { name: 'alpha' }, { sourceClient: current.sourceClient }),
      /requires a new skills\.sh URL or GitHub source/,
    );
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, {
        name: 'alpha',
        source_url: 'https://github.com/example/skills.git',
        skill_path: 'skills/alpha/SKILL.md',
      }, { sourceClient: current.sourceClient }),
      /same as the current upstream/,
    );
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, {
        name: 'linked',
        source_url: 'https://github.com/example/other-skills.git',
        skill_path: 'skills/linked',
      }, { sourceClient: current.sourceClient }),
      /does not need an update source or baseline/,
    );
    const preview = await ash.buildSkillSourcePreview(current.settings, {
      name: 'alpha',
      source_url: 'https://github.com/example/other-skills.git',
      skill_path: 'skills/alpha',
    }, { sourceClient: current.sourceClient });
    assert.strictEqual(preview.operation, 'retarget-source');
    assert.strictEqual(preview.previous_source, 'example/skills');
    assert.strictEqual(preview.previous_source_url, 'https://github.com/example/skills.git');
    assert.strictEqual(preview.source, 'example/other-skills');
    assert.strictEqual(preview.source_url, 'https://github.com/example/other-skills.git');
    assert.strictEqual(preview.replace_content, true);
    assert(preview.diff.added.some(function other(item) { return item.path === 'other.txt'; }));

    const transaction = await ash.applySkillSource(current.settings, preview, { sourceClient: current.sourceClient });
    const lock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
    assert.strictEqual(lock.skills.alpha.source, 'example/other-skills');
    assert.strictEqual(lock.skills.alpha.sourceUrl, 'https://github.com/example/other-skills.git');
    assert.strictEqual(lock.skills.alpha.skillFolderHash, '9'.repeat(40));
    assert(fs.readFileSync(path.join(current.library, 'alpha', 'SKILL.md'), 'utf8').includes('Alpha from another upstream.'));
    assert(fs.existsSync(path.join(current.library, 'alpha', 'other.txt')));
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'alpha', '.env'), 'utf8'), 'TOKEN=local-secret\n');
    assert.strictEqual(JSON.parse(fs.readFileSync(transaction, 'utf8')).operation, 'retarget-source');
    const rollbackPreview = ash.previewSkillUpdateRollback(current.settings, 'latest');
    assert(rollbackPreview.description.includes('PREVIOUS UPDATE SOURCE'));
    ash.applySkillUpdateRollback(current.settings, rollbackPreview.transaction_id);
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'alpha', 'SKILL.md'), 'utf8'), originalSkill);
    assert.strictEqual(fs.existsSync(path.join(current.library, 'alpha', 'other.txt')), false);
    assert.strictEqual(fs.readFileSync(current.agentsLock, 'utf8'), originalLock);
  });
});

test('rebuilds a missing baseline without replacing identical Skill content or local caches', async function run() {
  await withFixture(async function inspect(current) {
    const lockWithProvenance = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
    lockWithProvenance.skills.hashless.skillsUrl = 'https://skills.sh/example/skills/hashless';
    fs.writeFileSync(current.agentsLock, JSON.stringify(lockWithProvenance, null, 2), 'utf8');
    const originalLock = fs.readFileSync(current.agentsLock, 'utf8');
    const cache = path.join(current.library, 'hashless', 'node_modules', 'local-cache.txt');
    const preview = await ash.buildSkillSourcePreview(current.settings, { name: 'hashless' }, { sourceClient: current.sourceClient });
    assert.strictEqual(preview.operation, 'rebuild-baseline');
    assert.strictEqual(preview.diff.action_count, 0);
    assert.strictEqual(preview.replace_content, false);

    const transaction = await ash.applySkillSource(current.settings, preview, { sourceClient: current.sourceClient });
    const payload = JSON.parse(fs.readFileSync(transaction, 'utf8'));
    assert.strictEqual(payload.content_replaced, false);
    assert.strictEqual(fs.readFileSync(cache, 'utf8'), 'keep-this-cache-for-lock-only-rebaseline\n');
    const rebuiltEntry = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8')).skills.hashless;
    assert.strictEqual(rebuiltEntry.skillFolderHash, '5'.repeat(40));
    assert.strictEqual(rebuiltEntry.skillsUrl, undefined);
    assert.strictEqual(ash.classifyUserSkillUpdates(current.settings).skills.find(function hashless(item) { return item.name === 'hashless'; }).status, 'checkable');

    const rollback = ash.previewSkillUpdateRollback(current.settings, 'latest');
    ash.applySkillUpdateRollback(current.settings, rollback.transaction_id);
    assert.strictEqual(fs.readFileSync(current.agentsLock, 'utf8'), originalLock);
    assert.strictEqual(fs.readFileSync(cache, 'utf8'), 'keep-this-cache-for-lock-only-rebaseline\n');
  });
});

test('rejects non-GitHub source enrollment before fetching candidate content', async function run() {
  await withFixture(async function inspect(current) {
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, {
        name: 'manual', source_url: 'https://example.com/skills.git', skill_path: 'skills/manual',
      }, { sourceClient: current.sourceClient }),
      /only HTTPS GitHub sources/,
    );
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, {
        name: 'manual', source_url: 'https://github.com:444/example/manual-skills.git', skill_path: 'skills/manual',
      }, { sourceClient: current.sourceClient }),
      /only HTTPS GitHub sources/,
    );
    assert.strictEqual(current.materializeCalls(), 0);
  });
});

test('rejects source candidates with a mismatched declared name or missing Git tree hash', async function run() {
  await withFixture(async function inspect(current) {
    const wrongName = writeSkill(path.join(current.root, 'candidate-wrong-name'), 'different-skill', 'Wrong source identity.');
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, {
        name: 'manual', source_url: 'https://github.com/example/manual-skills.git', skill_path: 'skills/manual',
      }, { sourceClient: {
        materialize: async function materialize() { return { path: wrongName, revision: 'wrong', folderHash: '6'.repeat(40), cleanup: function cleanup() {} }; },
      } }),
      /declares name different-skill instead of manual/,
    );
    await assert.rejects(
      ash.buildSkillSourcePreview(current.settings, {
        name: 'manual', source_url: 'https://github.com/example/manual-skills.git', skill_path: 'skills/manual',
      }, { sourceClient: {
        materialize: async function materialize() { return { path: current.manualCandidate, revision: 'missing-hash', folderHash: '', cleanup: function cleanup() {} }; },
      } }),
      /standard 40-character Git tree SHA/,
    );
  });
});

test('refuses source adoption after either local content or the installer lock changes', async function run() {
  await withFixture(async function inspect(current) {
    let preview = await ash.buildSkillSourcePreview(current.settings, {
      name: 'manual', source_url: 'https://github.com/example/manual-skills.git', skill_path: 'skills/manual',
    }, { sourceClient: current.sourceClient });
    fs.appendFileSync(path.join(current.library, 'manual', 'SKILL.md'), '\nlocal change after preview\n', 'utf8');
    await assert.rejects(ash.applySkillSource(current.settings, preview, { sourceClient: current.sourceClient }), /source preview is stale/);
  });

  await withFixture(async function inspect(current) {
    const preview = await ash.buildSkillSourcePreview(current.settings, {
      name: 'manual', source_url: 'https://github.com/example/manual-skills.git', skill_path: 'skills/manual',
    }, { sourceClient: current.sourceClient });
    const lock = JSON.parse(fs.readFileSync(current.agentsLock, 'utf8'));
    lock.skills.alpha.updatedAt = '2026-02-02T00:00:00.000Z';
    fs.writeFileSync(current.agentsLock, JSON.stringify(lock, null, 2), 'utf8');
    await assert.rejects(ash.applySkillSource(current.settings, preview, { sourceClient: current.sourceClient }), /source preview is stale/);
  });
});

test('rejects stale previews and refuses rollback over changed local secrets', async function run() {
  await withFixture(async function inspect(current) {
    let preview = await ash.buildSkillUpdatePreview(current.settings, {
      name: 'alpha', latest_hash: '2'.repeat(40), latest_revision: 'candidate-commit',
    }, { sourceClient: current.sourceClient });
    fs.appendFileSync(path.join(current.alpha, 'SKILL.md'), '\nlocal edit\n', 'utf8');
    await assert.rejects(
      ash.applySkillUpdate(current.settings, preview, { sourceClient: current.sourceClient }),
      /preview is stale/,
    );
    fs.writeFileSync(
      path.join(current.alpha, 'SKILL.md'),
      '---\nname: alpha\ndescription: Alpha installed version.\n---\n\n# alpha\n',
      'utf8',
    );
    preview = await ash.buildSkillUpdatePreview(current.settings, {
      name: 'alpha', latest_hash: '2'.repeat(40), latest_revision: 'candidate-commit',
    }, { sourceClient: current.sourceClient });
    await ash.applySkillUpdate(current.settings, preview, { sourceClient: current.sourceClient });
    fs.writeFileSync(path.join(current.alpha, '.env'), 'TOKEN=changed-after-update\n', 'utf8');
    assert.throws(function rollback() { ash.previewSkillUpdateRollback(current.settings, 'latest'); }, /preserved local Skill content changed/);
  });
});

test('real Git source client reads folder tree hash and materializes a local test upstream', async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-git-'));
  try {
    const repository = path.join(root, 'source');
    writeSkill(path.join(repository, 'skills', 'alpha'), 'alpha', 'Git source candidate.', { 'asset.txt': 'git\n' });
    childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
    childProcess.execFileSync('git', ['config', 'user.email', 'ash-tests@example.invalid'], { cwd: repository });
    childProcess.execFileSync('git', ['config', 'user.name', 'ASH Tests'], { cwd: repository });
    childProcess.execFileSync('git', ['add', '.'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'test skill'], { cwd: repository, stdio: 'ignore' });
    const expectedHash = childProcess.execFileSync('git', ['rev-parse', 'HEAD:skills/alpha'], { cwd: repository, encoding: 'utf8' }).trim();
    const client = ash.createGitSourceClient({ allowLocal: true });
    const entry = { name: 'alpha', sourceUrl: repository, skillPath: 'skills/alpha/SKILL.md', ref: null };
    const resolved = await client.resolve({ sourceUrl: repository, slug: 'alpha', ref: null });
    assert.strictEqual(resolved.skillPath, 'skills/alpha/SKILL.md');
    const checked = await client.inspect([entry]);
    assert.strictEqual(checked.folderHashes.alpha, expectedHash);
    const materialized = await client.materialize(entry);
    try {
      assert.strictEqual(materialized.folderHash, expectedHash);
      assert(fs.existsSync(path.join(materialized.path, 'asset.txt')));
    } finally {
      materialized.cleanup();
    }
  } finally {
    removeTree(root);
  }
});

test('Git resolver uses a slug-bounded scan for nonstandard repository layouts', async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-resolve-bounded-'));
  try {
    const repository = path.join(root, 'source');
    writeSkill(path.join(repository, 'custom', 'catalog', 'alpha'), 'alpha', 'Nonstandard Git source candidate.');
    childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
    childProcess.execFileSync('git', ['config', 'user.email', 'ash-tests@example.invalid'], { cwd: repository });
    childProcess.execFileSync('git', ['config', 'user.name', 'ASH Tests'], { cwd: repository });
    childProcess.execFileSync('git', ['add', '.'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'bounded candidate'], { cwd: repository, stdio: 'ignore' });
    const client = ash.createGitSourceClient({ allowLocal: true });
    const resolved = await client.resolve({ sourceUrl: repository, slug: 'alpha', ref: null });
    assert.strictEqual(resolved.skillPath, 'custom/catalog/alpha/SKILL.md');
    assert.strictEqual(resolved.resolution, 'bounded-scan');
  } finally { removeTree(root); }
});

test('Git source client never retries a failed partial clone as an unfiltered full clone', async function run() {
  let cloneCalls = 0;
  const client = ash.createGitSourceClient({
    allowLocal: true,
    runCommand: async function failClone(command, args) {
      assert.strictEqual(command, 'git');
      if (args[0] === 'clone') {
        cloneCalls += 1;
        assert(args.includes('--filter=blob:none'));
        throw new Error('git timed out');
      }
      throw new Error('unexpected git command');
    },
  });
  await assert.rejects(client.resolve({ sourceUrl: '/tmp/nonexistent-ash-source', slug: 'alpha', ref: null }), /timed out/);
  assert.strictEqual(cloneCalls, 1);
});

test('Git resolver refuses ambiguous standard paths without enumerating the whole repository', async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-resolve-ambiguous-'));
  try {
    const repository = path.join(root, 'source');
    writeSkill(path.join(repository, 'skills', 'alpha'), 'alpha', 'First candidate.');
    writeSkill(path.join(repository, '.agents', 'skills', 'alpha'), 'alpha', 'Second candidate.');
    childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
    childProcess.execFileSync('git', ['config', 'user.email', 'ash-tests@example.invalid'], { cwd: repository });
    childProcess.execFileSync('git', ['config', 'user.name', 'ASH Tests'], { cwd: repository });
    childProcess.execFileSync('git', ['add', '.'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'ambiguous candidates'], { cwd: repository, stdio: 'ignore' });
    const client = ash.createGitSourceClient({ allowLocal: true });
    await assert.rejects(client.resolve({ sourceUrl: repository, slug: 'alpha', ref: null }), /multiple repository paths/);
  } finally { removeTree(root); }
});

test('Git resolver rejects root, standard, and nonstandard candidates declaring the same slug', async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-resolve-mixed-'));
  try {
    const repository = path.join(root, 'source');
    writeSkill(repository, 'alpha', 'Root candidate.');
    writeSkill(path.join(repository, 'skills', 'alpha'), 'alpha', 'Standard candidate.');
    writeSkill(path.join(repository, 'custom', 'catalog', 'alpha'), 'alpha', 'Nonstandard duplicate.');
    childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
    childProcess.execFileSync('git', ['config', 'user.email', 'ash-tests@example.invalid'], { cwd: repository });
    childProcess.execFileSync('git', ['config', 'user.name', 'ASH Tests'], { cwd: repository });
    childProcess.execFileSync('git', ['add', '.'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'mixed duplicate candidates'], { cwd: repository, stdio: 'ignore' });
    const client = ash.createGitSourceClient({ allowLocal: true });
    await assert.rejects(client.resolve({ sourceUrl: repository, slug: 'alpha', ref: null }), /multiple repository paths/);
  } finally { removeTree(root); }
});

test('Git resolver accepts a root Skill only when its declared name matches the slug', async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-resolve-root-'));
  try {
    const repository = path.join(root, 'different-repository-name');
    writeSkill(repository, 'alpha', 'Root repository Skill.');
    childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
    childProcess.execFileSync('git', ['config', 'user.email', 'ash-tests@example.invalid'], { cwd: repository });
    childProcess.execFileSync('git', ['config', 'user.name', 'ASH Tests'], { cwd: repository });
    childProcess.execFileSync('git', ['add', '.'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'root candidate'], { cwd: repository, stdio: 'ignore' });
    const client = ash.createGitSourceClient({ allowLocal: true });
    const resolved = await client.resolve({ sourceUrl: repository, slug: 'alpha', ref: null });
    assert.strictEqual(resolved.skillPath, 'SKILL.md');
    await assert.rejects(client.resolve({ sourceUrl: repository, slug: 'beta', ref: null }), /does not resolve/);
  } finally { removeTree(root); }
});

test('real local Git upstream completes check, preview, apply, and rollback end to end', async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-update-e2e-'));
  try {
    const repository = path.join(root, 'source');
    const sourceSkill = path.join(repository, 'skills', 'alpha');
    writeSkill(sourceSkill, 'alpha', 'Initial upstream version.', { 'old.txt': 'old\n' });
    childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' });
    childProcess.execFileSync('git', ['config', 'user.email', 'ash-tests@example.invalid'], { cwd: repository });
    childProcess.execFileSync('git', ['config', 'user.name', 'ASH Tests'], { cwd: repository });
    childProcess.execFileSync('git', ['add', '.'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'initial'], { cwd: repository, stdio: 'ignore' });
    const oldHash = childProcess.execFileSync('git', ['rev-parse', 'HEAD:skills/alpha'], { cwd: repository, encoding: 'utf8' }).trim();

    const library = path.join(root, '.agents', 'skills');
    writeSkill(path.join(library, 'alpha'), 'alpha', 'Initial upstream version.', { 'old.txt': 'old\n' });
    const lockPath = path.join(root, '.agents', '.skill-lock.json');
    fs.writeFileSync(lockPath, JSON.stringify({
      version: 3,
      skills: {
        alpha: {
          source: 'local/test-upstream', sourceType: 'github', sourceUrl: repository,
          skillPath: 'skills/alpha/SKILL.md', skillFolderHash: oldHash,
          installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }, null, 2), 'utf8');
    const configPath = path.join(root, 'ash-control.json');
    fs.writeFileSync(configPath, JSON.stringify({
      schema_version: 2,
      library: { path: library, exclude: [] },
      policies: { codex_global_guidance: 'observe' },
      sources: { agents_lock: lockPath },
      output: {
        state_dir: path.join(root, '.agents', '.ash', 'state', 'control-plane'),
        packages: path.join(root, '.agents', '.ash', 'packages'),
      },
    }, null, 2), 'utf8');
    const settings = ash.loadSettings({ projectRoot: root, configPath, homeDir: root, env: { HOME: root } });

    writeSkill(sourceSkill, 'alpha', 'Latest upstream version.', { 'new.txt': 'new\n' });
    fs.unlinkSync(path.join(sourceSkill, 'old.txt'));
    childProcess.execFileSync('git', ['add', '-A'], { cwd: repository });
    childProcess.execFileSync('git', ['commit', '-m', 'update'], { cwd: repository, stdio: 'ignore' });

    const sourceClient = ash.createGitSourceClient({ allowLocal: true });
    const checked = await ash.checkUserSkillUpdates(settings, { sourceClient });
    const selected = checked.skills.find(function alpha(skill) { return skill.name === 'alpha'; });
    assert.strictEqual(selected.status, 'update-available');
    const preview = await ash.buildSkillUpdatePreview(settings, {
      name: 'alpha', latest_hash: selected.latest_hash, latest_revision: selected.latest_revision,
    }, { sourceClient });
    assert.strictEqual(preview.diff.action_count > 0, true);
    await ash.applySkillUpdate(settings, preview, { sourceClient });
    assert(fs.readFileSync(path.join(library, 'alpha', 'SKILL.md'), 'utf8').includes('Latest upstream version.'));
    assert(fs.existsSync(path.join(library, 'alpha', 'new.txt')));
    const rollback = ash.previewSkillUpdateRollback(settings, 'latest');
    ash.applySkillUpdateRollback(settings, rollback.transaction_id);
    assert(fs.readFileSync(path.join(library, 'alpha', 'SKILL.md'), 'utf8').includes('Initial upstream version.'));
    assert(fs.existsSync(path.join(library, 'alpha', 'old.txt')));
  } finally {
    removeTree(root);
  }
});

async function main() {
  let failures = 0;
  for (let index = 0; index < tests.length; index += 1) {
    const item = tests[index];
    try {
      await item.callback();
      process.stdout.write('ok - ' + item.name + '\n');
    } catch (error) {
      failures += 1;
      process.stderr.write('not ok - ' + item.name + '\n');
      process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
    }
  }
  process.stdout.write('\n' + (tests.length - failures) + '/' + tests.length + ' update tests passed\n');
  process.exitCode = failures ? 1 : 0;
}

main();
