'use strict';

const assert = require('assert');

const ash = require('../lib/control-plane');

const tests = [];
function test(name, callback) { tests.push({ name, callback }); }

test('skills.sh search normalizes safe GitHub candidates and removes duplicates', async function run() {
  let requested = null;
  const client = ash.createSkillsShSearchClient({
    requestJson: async function request(url) {
      requested = url;
      return {
        searchType: 'fuzzy',
        skills: [
          { id: 'openclaw/openclaw/1password', skillId: '1password', name: '1password', source: 'openclaw/openclaw', installs: 4014 },
          { id: 'openclaw/openclaw/1password', skillId: '1password', name: 'duplicate', source: 'openclaw/openclaw', installs: 1 },
          { id: 'bad', name: 'bad', source: 'bad' },
          { id: 'steipete/agent-scripts/1password', skillId: '1password', name: '1password', source: 'steipete/agent-scripts', installs: 313 },
        ],
      };
    },
  });
  const result = await client.search('1password', { limit: 10 });
  assert.strictEqual(requested, 'https://skills.sh/api/search?q=1password&limit=10');
  assert.strictEqual(result.experimental, true);
  assert.strictEqual(result.contract, 'undocumented-api-search');
  assert.deepStrictEqual(result.candidates.map(function id(item) { return item.id; }), [
    'openclaw/openclaw/1password', 'steipete/agent-scripts/1password',
  ]);
  assert.strictEqual(result.candidates[0].skills_url, 'https://skills.sh/openclaw/openclaw/1password');
  assert.strictEqual(result.candidates[0].source_url, 'https://github.com/openclaw/openclaw.git');
});

test('skills.sh search validates query, limit, and fixed endpoint', async function run() {
  const client = ash.createSkillsShSearchClient({ requestJson: async function request() { return { skills: [] }; } });
  await assert.rejects(client.search('x'), /2-100/);
  await assert.rejects(client.search('valid', { limit: 0 }), /between 1 and 50/);
  await assert.rejects(ash.requestSkillsShJson('https://example.com/api/search?q=test'), /not allowed/);
  await assert.rejects(ash.requestSkillsShJson('https://skills.sh:444/api/search?q=test'), /not allowed/);
  await assert.rejects(ash.requestSkillsShJson('https://user@skills.sh/api/search?q=test'), /not allowed/);
});

test('candidate normalization rejects mismatched source identities', function run() {
  assert.strictEqual(ash.normalizeCandidate({
    id: 'openclaw/openclaw/1password', skillId: '1password', source: 'other/repository', name: '1password',
  }), null);
  assert.strictEqual(ash.normalizeCandidate({ id: 'mintlify.com/mintlify', name: 'mintlify' }), null);
});

test('skills.sh search rejects malformed payloads and enforces its result limit', async function run() {
  const malformed = ash.createSkillsShSearchClient({ requestJson: async function request() { return { skills: {} }; } });
  await assert.rejects(malformed.search('alpha'), /invalid shape/);
  const limited = ash.createSkillsShSearchClient({
    requestJson: async function request() {
      return { skills: [
        { id: 'first/repository/alpha', skillId: 'alpha', source: 'first/repository', name: '<unsafe>', installs: 20 },
        { id: 'second/repository/alpha', skillId: 'alpha', source: 'second/repository', installs: 10 },
      ] };
    },
  });
  const result = await limited.search('alpha', { limit: 1 });
  assert.strictEqual(result.candidates.length, 1);
  assert.strictEqual(result.candidates[0].name, 'alpha');
  assert.strictEqual(ash.normalizeCandidate({ id: 'first/repository/alpha', installs: Number.MAX_SAFE_INTEGER + 1 }).installs, 0);
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
  process.stdout.write('\n' + (tests.length - failures) + '/' + tests.length + ' skills.sh tests passed\n');
  process.exitCode = failures ? 1 : 0;
}

main();
