'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ash = require('../lib/control-plane');

const tests = [];

function test(name, callback) { tests.push({ name, callback }); }

function removeTree(target) {
  if (!ash.lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { fs.unlinkSync(target); return; }
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function writeTransaction(settings, type, id, createdAt, options) {
  const opts = options || {};
  const directory = path.join(settings.stateDir, type === 'repair' ? 'transactions' : 'updates', id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const payload = type === 'repair'
    ? {
      version: opts.version || 2,
      id,
      scope: opts.scope || 'all',
      status: opts.status || 'completed',
      created_at: createdAt,
      operations: [{ kind: 'file_write', scope: opts.operationScope || 'codex-guidance', path: path.join(settings.homeDir, '.codex', 'AGENTS.md') }],
    }
    : {
      version: opts.version || 1,
      id,
      status: opts.status || 'completed',
      created_at: createdAt,
      name: opts.name || 'sample',
      operation: 'update',
    };
  fs.writeFileSync(path.join(directory, 'transaction.json'), JSON.stringify(payload, null, 2), 'utf8');
  if (opts.backup) fs.writeFileSync(path.join(directory, 'backup.bin'), opts.backup, 'utf8');
  return directory;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-retention-'));
  return {
    root,
    settings: { homeDir: root, stateDir: path.join(root, '.agents', '.ash', 'state', 'control-plane') },
    cleanup: function cleanup() { removeTree(root); },
  };
}

test('retention keeps the newest ten or thirty days, protects rollback, and prunes obsolete Catalog transactions', function run() {
  const current = fixture();
  try {
    for (let index = 0; index < 12; index += 1) {
      writeTransaction(
        current.settings,
        'repair',
        'repair-' + String(index).padStart(2, '0'),
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        { backup: 'repair-' + index },
      );
    }
    writeTransaction(current.settings, 'repair', 'catalog-obsolete', '2026-08-19T00:00:00.000Z', { operationScope: 'catalog' });
    writeTransaction(current.settings, 'update', 'update-old', '2026-01-01T00:00:00.000Z');
    writeTransaction(current.settings, 'update', 'update-new', '2026-08-19T00:00:00.000Z');
    const protectedIds = { repair: 'repair-00', update: 'update-old' };
    const plan = ash.buildRetentionPlan(current.settings, {
      now: new Date('2026-08-20T00:00:00.000Z'), keepCount: 10, maxAgeDays: 30, protectedIds,
    });
    assert.deepStrictEqual(plan.actions.map(function id(action) { return action.id; }), ['catalog-obsolete', 'repair-01']);
    assert.strictEqual(plan.summary.total, 15);
    assert.strictEqual(plan.summary.delete_count, 2);
    assert(plan.records.find(function protectedRepair(record) { return record.id === 'repair-00'; }).keep_reasons.includes('rollback-protected'));
    const applied = ash.applyRetentionPlan(current.settings, plan, { protectedIds });
    assert.deepStrictEqual(applied.deleted.map(function id(record) { return record.id; }), ['catalog-obsolete', 'repair-01']);
    assert.strictEqual(fs.existsSync(path.join(current.settings.stateDir, 'transactions', 'catalog-obsolete')), false);
    assert.strictEqual(fs.existsSync(path.join(current.settings.stateDir, 'transactions', 'repair-00')), true);
    assert.strictEqual(fs.existsSync(path.join(current.settings.stateDir, 'updates', 'update-old')), true);
  } finally { current.cleanup(); }
});

test('retention refuses the whole cleanup when a candidate changes after preview', function run() {
  const current = fixture();
  try {
    const candidate = writeTransaction(current.settings, 'repair', 'catalog-obsolete', '2026-08-19T00:00:00.000Z', { operationScope: 'catalog' });
    const protectedIds = { repair: null, update: null };
    const plan = ash.buildRetentionPlan(current.settings, {
      now: new Date('2026-08-20T00:00:00.000Z'), protectedIds,
    });
    fs.appendFileSync(path.join(candidate, 'transaction.json'), '\n', 'utf8');
    assert.throws(function stale() { ash.applyRetentionPlan(current.settings, plan, { protectedIds }); }, /preview is stale/);
    assert.strictEqual(fs.existsSync(candidate), true);
  } finally { current.cleanup(); }
});

test('retention validates policy bounds', function run() {
  const current = fixture();
  try {
    assert.throws(function invalidCount() { ash.buildRetentionPlan(current.settings, { keepCount: 0 }); }, /keepCount/);
    assert.throws(function invalidDays() { ash.buildRetentionPlan(current.settings, { maxAgeDays: 1001 }); }, /maxAgeDays/);
  } finally { current.cleanup(); }
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
  process.stdout.write('\n' + (tests.length - failures) + '/' + tests.length + ' retention tests passed\n');
  process.exitCode = failures ? 1 : 0;
}

main();
