'use strict';

const assert = require('assert');
const path = require('path');

const ash = require('../lib/control-plane');

const tests = [];
function test(name, callback) { tests.push({ name, callback }); }

test('nine raw update codes use four-character labels across seven behavior groups', function run() {
  const statuses = [
    'checkable', 'up-to-date', 'update-available', 'unmanaged', 'baseline-missing',
    'repository-linked', 'read-only-source', 'source-unavailable', 'missing',
  ];
  const displays = statuses.map(ash.presentUpdateStatus);
  assert.strictEqual(new Set(displays.map(function key(item) { return item.key; })).size, 7);
  assert.deepStrictEqual(displays.map(function label(item) { return item.label; }), [
    '等待检查', '已是最新', '发现更新', '等待接管', '等待重建', '用户链接', '只读来源', '状态异常', '状态异常',
  ]);
  assert(displays.every(function fourCharacters(item) { return Array.from(item.label).length === 4; }));
  assert.strictEqual(ash.presentUpdateStatus('future-state').key, 'error');
  assert.strictEqual(ash.presentUpdateStatus('future-state').label, '状态异常');
});

test('health summary reports only the highest severity while retaining all counts', function run() {
  const health = ash.summarizeHealth([
    { severity: 'WARN' }, { severity: 'ERROR' }, { severity: 'ERROR' }, { severity: 'INFO' },
  ]);
  assert.deepStrictEqual(health, {
    total: 4, severity: 'ERROR', count: 2, label: '2 错误', level: 'error', tone: 'danger',
    errors: 2, warnings: 1, info: 1,
  });
  assert.deepStrictEqual(ash.summarizeHealth([]), {
    total: 0, severity: null, count: 0, label: '', errors: 0, warnings: 0, info: 0, level: 'clear', tone: 'neutral',
  });
  assert.strictEqual(ash.summarizeHealth([{ severity: 'UNKNOWN' }]).label, '1 提示');
});

test('Skill issues match primary, physical, and secondary locations with path boundaries', function run() {
  const skill = {
    path: path.join('/tmp', 'library', 'alpha'),
    physical_path: path.join('/tmp', 'source', 'alpha'),
    locations: [{ path: path.join('/tmp', 'other', 'alpha') }],
  };
  const issues = [
    { code: 'ROOT', paths: [skill.path] },
    { code: 'CHILD', paths: [path.join(skill.physical_path, 'SKILL.md')] },
    { code: 'ALIAS', paths: [path.join('/tmp', 'other', 'alpha', 'script.js')] },
    { code: 'BOUNDARY', paths: [path.join('/tmp', 'library', 'alphabet', 'SKILL.md')] },
    { code: 'GLOBAL', paths: [path.join('/tmp', 'config.json')] },
  ];
  assert.deepStrictEqual(ash.issuesForSkill(skill, issues).map(function code(issue) { return issue.code; }), ['ROOT', 'CHILD', 'ALIAS']);
});

test('ownership, access, and severity labels are explicit', function run() {
  assert.strictEqual(ash.ownershipLabel('installer-lock'), '安装锁');
  assert.strictEqual(ash.ownershipLabel('git-link'), '仓库链接');
  assert.strictEqual(ash.ownershipLabel('manual'), '手动维护');
  assert.deepStrictEqual(ash.accessPresentation('managed'), { key: 'writable', label: '用户库 · 可写', tone: 'managed', can_write: true });
  assert.strictEqual(ash.accessPresentation('observe').label, '扫描来源 · 只读');
  assert.strictEqual(ash.severityPresentation('INFO').label, '提示');
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
process.stdout.write('\n' + (tests.length - failures) + '/' + tests.length + ' status tests passed\n');
process.exitCode = failures ? 1 : 0;
