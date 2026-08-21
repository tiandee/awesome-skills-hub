'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ash = require('../lib/control-plane');

function removeTree(target) {
  if (!ash.lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return fs.unlinkSync(target);
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function writeSkill(target, name) {
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), '---\nname: ' + name + '\ndescription: Test ' + name + '.\n---\n\n# ' + name + '\n', 'utf8');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-removal-'));
  const libraryRoot = path.join(root, '.agents', 'skills');
  const agentsLock = path.join(root, '.agents', '.skill-lock.json');
  const stateDir = path.join(root, '.agents', '.ash', 'state', 'control-plane');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.writeFileSync(agentsLock, JSON.stringify({ version: 3, skills: {} }, null, 2) + '\n', 'utf8');
  return {
    root,
    settings: { libraryRoot, agentsLock, stateDir },
    cleanup: function cleanup() { removeTree(root); },
  };
}

function readLock(settings) {
  return JSON.parse(fs.readFileSync(settings.agentsLock, 'utf8'));
}

function testManualRemovalIsRecoverableAndStaleSafe() {
  const current = fixture();
  try {
    const target = path.join(current.settings.libraryRoot, 'manual-skill');
    writeSkill(target, 'manual-skill');
    const stale = ash.buildSkillRemovalPlan(current.settings, { name: 'manual-skill' });
    fs.appendFileSync(path.join(target, 'SKILL.md'), 'changed after preview\n', 'utf8');
    assert.throws(function changed() { ash.applySkillRemoval(current.settings, stale); }, /preview is stale/);
    assert(fs.existsSync(path.join(target, 'SKILL.md')));

    const plan = ash.buildSkillRemovalPlan(current.settings, { name: 'manual-skill' });
    assert.strictEqual(plan.mode, 'quarantine');
    assert.strictEqual(plan.ownership, 'manual');
    const transactionFile = ash.applySkillRemoval(current.settings, plan);
    assert.strictEqual(ash.lexists(target), false);
    assert(fs.existsSync(path.join(path.dirname(transactionFile), 'removed-skill', 'SKILL.md')));
    const latest = ash.latestSkillRemovalRollback(current.settings);
    assert.strictEqual(latest.available, true);
    assert.strictEqual(latest.name, 'manual-skill');

    writeSkill(target, 'manual-skill');
    assert.throws(function occupiedRestore() {
      ash.buildSkillRemovalRollback(current.settings, latest.transaction_id);
    }, /path is occupied/);
    removeTree(target);
    const restore = ash.buildSkillRemovalRollback(current.settings, latest.transaction_id);
    ash.applySkillRemovalRollback(current.settings, restore);
    assert(fs.existsSync(path.join(target, 'SKILL.md')));
    assert.strictEqual(ash.latestSkillRemovalRollback(current.settings).available, false);
    process.stdout.write('ok - manual Skill removal is previewed, stale-safe, quarantined, and restorable\n');
  } finally { current.cleanup(); }
}

function testInstallerRemovalPreservesUnrelatedLockEntries() {
  const current = fixture();
  try {
    const target = path.join(current.settings.libraryRoot, 'installed-skill');
    writeSkill(target, 'installed-skill');
    const lock = readLock(current.settings);
    lock.skills['installed-skill'] = { source: 'owner/repo', sourceType: 'github', sourceUrl: 'https://github.com/owner/repo.git', skillPath: 'skills/installed-skill/SKILL.md' };
    fs.writeFileSync(current.settings.agentsLock, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    const plan = ash.buildSkillRemovalPlan(current.settings, { name: 'installed-skill' });
    assert.strictEqual(plan.ownership, 'installer-lock');
    const concurrent = readLock(current.settings);
    concurrent.skills.unrelated = { source: 'another/repo', sourceType: 'github' };
    fs.writeFileSync(current.settings.agentsLock, JSON.stringify(concurrent, null, 2) + '\n', 'utf8');

    const transactionFile = ash.applySkillRemoval(current.settings, plan);
    assert.strictEqual(readLock(current.settings).skills['installed-skill'], undefined);
    assert(readLock(current.settings).skills.unrelated);
    const restore = ash.buildSkillRemovalRollback(current.settings, path.basename(path.dirname(transactionFile)));
    ash.applySkillRemovalRollback(current.settings, restore);
    const restored = readLock(current.settings);
    assert(restored.skills['installed-skill']);
    assert(restored.skills.unrelated);
    process.stdout.write('ok - installer-managed removal updates one lock entry and preserves concurrent unrelated entries\n');
  } finally { current.cleanup(); }
}

function testSymlinkRemovalNeverTouchesSource() {
  const current = fixture();
  try {
    const source = path.join(current.root, 'source-skill');
    const target = path.join(current.settings.libraryRoot, 'linked-skill');
    writeSkill(source, 'linked-skill');
    fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    const plan = ash.buildSkillRemovalPlan(current.settings, { name: 'linked-skill' });
    assert.strictEqual(plan.mode, 'unlink');
    const transactionFile = ash.applySkillRemoval(current.settings, plan);
    assert.strictEqual(ash.lexists(target), false);
    assert(fs.existsSync(path.join(source, 'SKILL.md')));
    assert(fs.lstatSync(path.join(path.dirname(transactionFile), 'removed-skill')).isSymbolicLink());
    ash.applySkillRemovalRollback(current.settings, ash.buildSkillRemovalRollback(current.settings, path.basename(path.dirname(transactionFile))));
    assert(fs.lstatSync(target).isSymbolicLink());
    assert(fs.existsSync(path.join(source, 'SKILL.md')));
    process.stdout.write('ok - symlink removal moves only the link and restores it without touching its source\n');
  } finally { current.cleanup(); }
}

function testPermanentPurgeIsExactAndStaleSafe() {
  const current = fixture();
  try {
    const target = path.join(current.settings.libraryRoot, 'purge-skill');
    writeSkill(target, 'purge-skill');
    const transactionFile = ash.applySkillRemoval(
      current.settings,
      ash.buildSkillRemovalPlan(current.settings, { name: 'purge-skill' }),
    );
    const transactionId = path.basename(path.dirname(transactionFile));
    assert.throws(function traversal() {
      ash.buildSkillRemovalPurgePlan(current.settings, '../outside');
    }, /invalid Skill removal transaction id/);
    const listed = ash.listSkillRemovals(current.settings);
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].transaction_id, transactionId);
    assert.strictEqual(listed[0].can_restore, true);
    assert(listed[0].total_bytes > 0);

    const stale = ash.buildSkillRemovalPurgePlan(current.settings, transactionId);
    fs.writeFileSync(path.join(path.dirname(transactionFile), 'changed-after-preview.txt'), 'changed', 'utf8');
    assert.throws(function changed() { ash.applySkillRemovalPurge(current.settings, stale); }, /preview is stale/);
    assert(fs.existsSync(path.dirname(transactionFile)));

    const fresh = ash.buildSkillRemovalPurgePlan(current.settings, transactionId);
    assert.strictEqual(fresh.name, 'purge-skill');
    ash.applySkillRemovalPurge(current.settings, fresh);
    assert.strictEqual(fs.existsSync(path.dirname(transactionFile)), false);
    assert.strictEqual(ash.lexists(target), false);
    assert.deepStrictEqual(ash.listSkillRemovals(current.settings), []);
    process.stdout.write('ok - permanent purge targets one recovery transaction and refuses stale previews\n');
  } finally { current.cleanup(); }
}

function testBulkPurgeRequiresFreshCompleteRecoverySet() {
  const current = fixture();
  try {
    ['bulk-one', 'bulk-two'].forEach(function remove(name) {
      writeSkill(path.join(current.settings.libraryRoot, name), name);
      ash.applySkillRemoval(current.settings, ash.buildSkillRemovalPlan(current.settings, { name }));
    });
    const stale = ash.buildSkillRemovalBulkPurgePlan(current.settings);
    assert.strictEqual(stale.count, 2);
    assert.strictEqual(stale.confirmation_text, '永久删除全部 2 个 Skill');
    writeSkill(path.join(current.settings.libraryRoot, 'bulk-three'), 'bulk-three');
    ash.applySkillRemoval(current.settings, ash.buildSkillRemovalPlan(current.settings, { name: 'bulk-three' }));
    assert.throws(function changedSet() {
      ash.applySkillRemovalBulkPurge(current.settings, stale);
    }, /changed after bulk purge preview/);
    assert.strictEqual(ash.listSkillRemovals(current.settings).length, 3);

    const fresh = ash.buildSkillRemovalBulkPurgePlan(current.settings);
    const result = ash.applySkillRemovalBulkPurge(current.settings, fresh);
    assert.strictEqual(result.deleted.length, 3);
    assert.deepStrictEqual(result.failed, []);
    assert.deepStrictEqual(ash.listSkillRemovals(current.settings), []);
    process.stdout.write('ok - bulk purge requires the typed count phrase and a fresh complete recovery set\n');
  } finally { current.cleanup(); }
}

function main() {
  testManualRemovalIsRecoverableAndStaleSafe();
  testInstallerRemovalPreservesUnrelatedLockEntries();
  testSymlinkRemovalNeverTouchesSource();
  testPermanentPurgeIsExactAndStaleSafe();
  testBulkPurgeRequiresFreshCompleteRecoverySet();
  process.stdout.write('\n5/5 removal tests passed\n');
}

main();
