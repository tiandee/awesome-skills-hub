'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ash = require('../lib/control-plane');

function removeTree(target) {
  if (!ash.lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function writeSkill(skillPath, name, description) {
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(
    path.join(skillPath, 'SKILL.md'),
    '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n# ' + name + '\n',
    'utf8',
  );
}

function writeSourceTransaction(settings, id, payload) {
  const directory = path.join(settings.stateDir, 'updates', id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'transaction.json'), JSON.stringify(Object.assign({
    version: 1,
    id,
    status: 'completed',
    operation: 'link-source',
    completed_at: '2026-08-20T00:00:00.000Z',
    ref: null,
  }, payload), null, 2) + '\n', 'utf8');
  return directory;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-ui-'));
  const library = path.join(root, 'custom-skill-library');
  fs.mkdirSync(library, { recursive: true });
  writeSkill(path.join(library, 'alpha'), 'alpha', 'Alpha UI workflow.');
  writeSkill(path.join(library, 'beta'), 'beta', 'Beta UI workflow.');
  fs.appendFileSync(path.join(library, 'beta', 'SKILL.md'), new Array(510).fill('Detailed workflow reference line.').join('\n') + '\n', 'utf8');
  const lockPath = path.join(root, '.agents', '.skill-lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    version: 3,
    skills: {
      alpha: {
        source: 'example/ui-skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/example/ui-skills.git',
        skillPath: 'skills/alpha/SKILL.md',
        skillFolderHash: '1'.repeat(40),
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
  }, null, 2), 'utf8');
  const updateCandidate = path.join(root, 'update-candidate-alpha');
  writeSkill(updateCandidate, 'alpha', 'Alpha UI workflow, updated upstream.');
  const sourceCandidate = path.join(root, 'source-candidate-beta');
  writeSkill(sourceCandidate, 'beta', 'Beta UI workflow, adopted from upstream.');
  const retargetCandidate = path.join(root, 'source-candidate-beta-second');
  writeSkill(retargetCandidate, 'beta', 'Beta UI workflow, retargeted upstream.');
  const updateSourceClient = {
    resolve: async function resolve(entry) {
      if (entry.slug !== 'beta') throw new Error('unexpected UI catalog slug: ' + entry.slug);
      return { sourceUrl: entry.sourceUrl, skillPath: 'skills/beta/SKILL.md', revision: 'beta-source-commit' };
    },
    inspect: async function inspect() {
      return { revision: 'alpha-new-commit', folderHashes: { alpha: '2'.repeat(40) } };
    },
    materialize: async function materialize(entry) {
      if (entry.name === 'beta') {
        if (/second\/ui-skills/.test(String(entry.sourceUrl || ''))) {
          return { path: retargetCandidate, revision: 'beta-retarget-commit', folderHash: '6'.repeat(40), cleanup: function cleanup() {} };
        }
        return { path: sourceCandidate, revision: 'beta-source-commit', folderHash: '3'.repeat(40), cleanup: function cleanup() {} };
      }
      return { path: updateCandidate, revision: 'alpha-new-commit', folderHash: '2'.repeat(40), cleanup: function cleanup() {} };
    }
  };
  let skillsShSearchCalls = 0;
  const skillsShSearchClient = {
    search: async function search(query) {
      skillsShSearchCalls += 1;
      if (query !== 'beta') return { contract: 'undocumented-api-search', candidates: [] };
      return {
        contract: 'undocumented-api-search',
        candidates: [
          { id: 'second/ui-skills/beta', name: 'beta', slug: 'beta', source: 'second/ui-skills', installs: 8, skills_url: 'https://skills.sh/second/ui-skills/beta', source_url: 'https://github.com/second/ui-skills.git' },
          { id: 'example/ui-skills/beta', name: 'beta', slug: 'beta', source: 'example/ui-skills', installs: 240, skills_url: 'https://skills.sh/example/ui-skills/beta', source_url: 'https://github.com/example/ui-skills.git' },
          { id: 'example/ui-skills/beta-helper', name: 'beta-helper', slug: 'beta-helper', source: 'example/ui-skills', installs: 999, skills_url: 'https://skills.sh/example/ui-skills/beta-helper', source_url: 'https://github.com/example/ui-skills.git' },
        ],
      };
    },
  };
  const configPath = path.join(root, 'ash-control.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: 2,
    library: { path: library, exclude: [] },
    policies: { codex_global_guidance: 'manage' },
    sources: { agents_lock: lockPath },
    output: {
      state_dir: path.join(root, '.ash', 'state', 'control-plane'),
      packages: path.join(root, '.ash', 'packages'),
    },
  }, null, 2), 'utf8');
  const settings = ash.loadSettings({
    projectRoot: root,
    configPath,
    homeDir: root,
    env: { HOME: root },
  });
  const obsoleteTransaction = path.join(settings.stateDir, 'transactions', 'catalog-obsolete');
  fs.mkdirSync(obsoleteTransaction, { recursive: true });
  fs.writeFileSync(path.join(obsoleteTransaction, 'transaction.json'), JSON.stringify({
    version: 2,
    id: 'catalog-obsolete',
    scope: 'catalog',
    status: 'completed',
    created_at: '2026-08-19T00:00:00.000Z',
    operations: [{ kind: 'file_write', scope: 'catalog', path: path.join(root, '.ash', 'CATALOG.md') }],
  }, null, 2), 'utf8');
  return {
    root, library, lockPath, obsoleteTransaction, settings, updateSourceClient, skillsShSearchClient,
    skillsShSearchCalls: function count() { return skillsShSearchCalls; },
    cleanup: function cleanup() { removeTree(root); },
  };
}

function popularBatchFixture(names) {
  const current = fixture();
  const candidates = { beta: path.join(current.root, 'source-candidate-beta') };
  const hashes = { beta: '3'.repeat(40) };
  names.filter(function additional(name) { return name !== 'beta'; }).forEach(function add(name, index) {
    writeSkill(path.join(current.library, name), name, name + ' local workflow.');
    candidates[name] = path.join(current.root, 'source-candidate-' + name);
    writeSkill(candidates[name], name, name + ' workflow, adopted from upstream.');
    hashes[name] = String(4 + index).repeat(40);
  });
  const updateSourceClient = {
    resolve: async function resolve(entry) {
      return { sourceUrl: entry.sourceUrl, skillPath: 'skills/' + entry.slug + '/SKILL.md', revision: entry.slug + '-source-commit' };
    },
    materialize: async function materialize(entry) {
      return { path: candidates[entry.name], revision: entry.name + '-source-commit', folderHash: hashes[entry.name], cleanup: function cleanup() {} };
    },
  };
  const skillsShSearchClient = {
    search: async function search(name) {
      return {
        contract: 'undocumented-api-search',
        candidates: [{
          id: 'example/batch-skills/' + name,
          name,
          slug: name,
          source: 'example/batch-skills',
          installs: 500,
          skills_url: 'https://skills.sh/example/batch-skills/' + name,
          source_url: 'https://github.com/example/batch-skills.git',
        }],
      };
    },
  };
  return Object.assign(current, {
    hashes,
    updateSourceClient,
    skillsShSearchClient,
  });
}

async function previewPopularBatch(service, names) {
  const discovery = await service.discoverPopularSkillSources({ limit: 100 });
  const preview = await service.previewPopularSkillSources({ discovery_id: discovery.discovery_id, names });
  assert.strictEqual(preview.ready_count, names.length);
  return preview;
}

function readPopularLogs(settings) {
  return fs.readFileSync(ash.popularTakeoverLogPath(settings), 'utf8').trim().split('\n').map(JSON.parse);
}

function request(target, options) {
  const opts = options || {};
  const body = opts.body === undefined ? null : JSON.stringify(opts.body);
  const selected = new URL(target);
  const headers = Object.assign({}, opts.headers || {});
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise(function send(resolve, reject) {
    const operation = http.request({
      hostname: selected.hostname,
      port: selected.port,
      path: selected.pathname + selected.search,
      method: opts.method || 'GET',
      headers,
    }, function receive(response) {
      const chunks = [];
      response.on('data', function chunk(value) { chunks.push(value); });
      response.on('end', function complete() {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    operation.on('error', reject);
    if (body !== null) operation.write(body);
    operation.end();
  });
}

function json(response) {
  return JSON.parse(response.text);
}

async function testServiceSafety() {
  const current = fixture();
  try {
    let token = 0;
    let openedSnapshotDirectory = null;
    const service = ash.createUiService(current.settings, {
      tokenFactory: function nextToken() { token += 1; return 'token-' + token; },
      dateFactory: function fixedDate() { return new Date('2026-08-20T00:00:00.000Z'); },
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
      openDirectory: function open(directory) { openedSnapshotDirectory = directory; },
    });
    const opened = service.openSnapshotDirectory();
    assert.strictEqual(opened.status, 'opened');
    assert.strictEqual(opened.path, path.join(current.settings.stateDir, 'snapshots'));
    assert.strictEqual(openedSnapshotDirectory, opened.path);
    const overview = service.overview();
    assert.strictEqual(overview.library.path, current.library);
    assert.strictEqual(overview.summary.skills, 2);
    assert.strictEqual(overview.summary.repair_actions, 1);
    assert.strictEqual(overview.source_insights.coverage_percent, 50);
    assert.strictEqual(overview.source_insights.update_ready_percent, 50);
    assert.strictEqual(overview.source_insights.counts.stale, 1);
    assert.strictEqual(overview.retention.action_count, 1);
    const alphaUpdate = overview.skills.find(function alpha(skill) { return skill.name === 'alpha'; }).update;
    assert.strictEqual(alphaUpdate.display.label, '待检查');
    assert.strictEqual(alphaUpdate.source_origin.label, 'GitHub 来源');
    assert.deepStrictEqual(alphaUpdate.source_links.map(function kind(item) { return item.kind; }), ['github-repository', 'github-skill']);
    assert.strictEqual(alphaUpdate.source_links[0].url, 'https://github.com/example/ui-skills');
    assert.strictEqual(alphaUpdate.source_links[1].url, 'https://github.com/example/ui-skills/blob/HEAD/skills/alpha/SKILL.md');
    const matchingDirectHistory = writeSourceTransaction(current.settings, '20260820T000000001Z-direct', {
      name: 'alpha',
      source_url: 'https://github.com/example/ui-skills.git',
      skill_path: 'skills/alpha/SKILL.md',
      skills_url: null,
    });
    const newerMismatchedHistory = writeSourceTransaction(current.settings, '20260820T000000002Z-mismatch', {
      name: 'alpha',
      source_url: 'https://github.com/other/ui-skills.git',
      skill_path: 'skills/alpha/SKILL.md',
      skills_url: 'https://skills.sh/other/ui-skills/alpha',
    });
    const directUpdate = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient }).skillDetail('alpha').update;
    assert.strictEqual(directUpdate.source_origin.label, 'GitHub 直连');
    assert.deepStrictEqual(directUpdate.source_links.map(function kind(item) { return item.kind; }), ['github-repository', 'github-skill']);
    removeTree(matchingDirectHistory);
    removeTree(newerMismatchedHistory);
    const maliciousCatalogHistory = writeSourceTransaction(current.settings, '20260820T000000003Z-malicious', {
      name: 'alpha',
      source_url: 'https://github.com/example/ui-skills.git',
      skill_path: 'skills/alpha/SKILL.md',
      skills_url: 'javascript:alert(1)',
    });
    const maliciousCatalogUpdate = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient }).skillDetail('alpha').update;
    assert.strictEqual(maliciousCatalogUpdate.source_origin.label, 'GitHub 来源');
    assert.strictEqual(maliciousCatalogUpdate.source_links.some(function unsafe(item) { return item.kind === 'skills-sh'; }), false);
    removeTree(maliciousCatalogHistory);
    assert.strictEqual(overview.skills.find(function beta(skill) { return skill.name === 'beta'; }).update.display.label, '待接管');
    assert.strictEqual(overview.skills.find(function beta(skill) { return skill.name === 'beta'; }).health.label, '1 警告');
    assert.strictEqual(overview.skills.find(function alpha(skill) { return skill.name === 'alpha'; }).health.level, 'clear');
    assert.strictEqual(overview.skills.find(function alpha(skill) { return skill.name === 'alpha'; }).access.label, '用户库 · 可写');
    assert.strictEqual(service.skillDetail('alpha').files[0], 'SKILL.md');
    assert.strictEqual(service.skillDetail('beta').health.label, '1 警告');
    assert.strictEqual(service.skillDetail('beta').update.display.label, '待接管');
    const safeLockContent = fs.readFileSync(current.lockPath, 'utf8');
    [
      { sourceUrl: 'http://github.com/example/ui-skills.git' },
      { sourceUrl: 'https://user@github.com/example/ui-skills.git' },
      { sourceUrl: 'https://github.com:444/example/ui-skills.git' },
      { sourceUrl: 'https://github.com/example/ui-skills/extra.git' },
      { sourceUrl: 'https://github.com/example/ui-skills.git', skillPath: '../SKILL.md' },
      { sourceUrl: 'https://github.com/example/ui-skills.git', ref: '../main' },
    ].forEach(function rejectUnsafeSource(changes) {
      const unsafeLock = JSON.parse(safeLockContent);
      Object.assign(unsafeLock.skills.alpha, changes);
      fs.writeFileSync(current.lockPath, JSON.stringify(unsafeLock, null, 2), 'utf8');
      const unsafeService = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient });
      const unsafeUpdate = unsafeService.skillDetail('alpha').update;
      assert.strictEqual(unsafeUpdate.source_origin.label, changes.ref ? 'GitHub 来源' : '未关联');
      assert.deepStrictEqual(unsafeUpdate.source_links, changes.ref
        ? [{ kind: 'github-repository', label: 'GitHub 仓库', url: 'https://github.com/example/ui-skills' }]
        : []);
    });
    fs.writeFileSync(current.lockPath, safeLockContent, 'utf8');

    const retentionPreview = service.previewTransactionPrune();
    assert.strictEqual(retentionPreview.actions[0].id, 'catalog-obsolete');
    assert.throws(function missingRetentionConfirmation() {
      service.applyTransactionPrune({ plan_id: retentionPreview.plan_id, confirm: false });
    }, function matching(error) { return error.code === 'CONFIRMATION_REQUIRED'; });
    const pruned = service.applyTransactionPrune({ plan_id: retentionPreview.plan_id, confirm: true });
    assert.strictEqual(pruned.status, 'pruned');
    assert.strictEqual(fs.existsSync(current.obsoleteTransaction), false);
    assert.throws(function reuseRetentionPlan() {
      service.applyTransactionPrune({ plan_id: retentionPreview.plan_id, confirm: true });
    }, function matching(error) { return error.code === 'PREVIEW_REQUIRED'; });

    const checkedUpdates = await service.checkUpdates();
    assert.strictEqual(checkedUpdates.summary.update_available, 1);
    assert.strictEqual(service.overview().skills.find(function alpha(skill) { return skill.name === 'alpha'; }).update.status, 'update-available');
    assert.strictEqual(service.overview().skills.find(function alpha(skill) { return skill.name === 'alpha'; }).update.display.label, '可更新');
    const persistedCheck = path.join(current.settings.stateDir, 'update-check.json');
    assert.strictEqual(fs.existsSync(persistedCheck), true);
    const restartedService = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient });
    const restartedAlpha = restartedService.skillDetail('alpha').update;
    assert.strictEqual(restartedAlpha.status, 'update-available');
    assert.strictEqual(restartedAlpha.display.label, '可更新');
    const restartedPreview = await restartedService.previewSkillUpdate({ name: 'alpha' });
    assert(restartedPreview.plan_id);
    const lockBeforeCacheValidation = fs.readFileSync(current.lockPath, 'utf8');
    const changedLock = JSON.parse(lockBeforeCacheValidation);
    changedLock.skills.alpha.skillFolderHash = 'f'.repeat(40);
    fs.writeFileSync(current.lockPath, JSON.stringify(changedLock, null, 2), 'utf8');
    const invalidatedService = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient });
    assert.strictEqual(invalidatedService.skillDetail('alpha').update.status, 'checkable');
    fs.writeFileSync(current.lockPath, lockBeforeCacheValidation, 'utf8');
    const updatePreview = await service.previewSkillUpdate({ name: 'alpha' });
    assert(updatePreview.plan_id);
    assert(updatePreview.diff.changed.some(function skillMd(item) { return item.path === 'SKILL.md'; }));
    await assert.rejects(
      service.applySkillUpdate({ plan_id: updatePreview.plan_id, confirm: false }),
      function matching(error) { return error.code === 'CONFIRMATION_REQUIRED'; },
    );
    const freshUpdate = await service.previewSkillUpdate({ name: 'alpha' });
    const updated = await service.applySkillUpdate({ plan_id: freshUpdate.plan_id, confirm: true });
    assert.strictEqual(updated.status, 'updated');
    assert.strictEqual(service.skillDetail('alpha').description, 'Alpha UI workflow, updated upstream.');
    assert.strictEqual(service.skillDetail('alpha').update.status, 'up-to-date');
    assert.strictEqual(service.skillDetail('alpha').update.display.label, '最新');
    const updateRollback = service.previewSkillUpdateRollback();
    const updateRolledBack = service.applySkillUpdateRollback({ rollback_id: updateRollback.rollback_id, confirm: true });
    assert.strictEqual(updateRolledBack.status, 'rolled_back');
    const uiRollbackTransaction = JSON.parse(fs.readFileSync(path.join(
      current.settings.stateDir, 'updates', updateRollback.transaction_id, 'transaction.json',
    ), 'utf8'));
    assert.strictEqual(uiRollbackTransaction.version, 1);
    assert.strictEqual(uiRollbackTransaction.rollback.initiator, 'ui');
    assert.strictEqual(uiRollbackTransaction.rollback.reason, 'manual_user_request');
    assert.strictEqual(uiRollbackTransaction.rollback.outcome, 'completed');
    assert(uiRollbackTransaction.rollback.started_at);
    assert(uiRollbackTransaction.rollback.completed_at);
    assert.strictEqual(service.skillDetail('alpha').description, 'Alpha UI workflow.');

    const betaBeforeDiscovery = fs.readFileSync(path.join(current.library, 'beta', 'SKILL.md'), 'utf8');
    const lockBeforeDiscovery = fs.readFileSync(current.lockPath, 'utf8');
    const discovery = await service.discoverSkillSource({ name: 'beta' });
    assert.strictEqual(discovery.state, 'ok');
    assert.strictEqual(discovery.experimental, true);
    assert.strictEqual(discovery.selection_required, true);
    assert.strictEqual(discovery.manual_entry, true);
    assert.deepStrictEqual(discovery.candidates.map(function id(candidate) { return candidate.id; }), [
      'example/ui-skills/beta', 'second/ui-skills/beta',
    ]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(discovery, 'plan_id'), false);
    assert.strictEqual(fs.readFileSync(path.join(current.library, 'beta', 'SKILL.md'), 'utf8'), betaBeforeDiscovery);
    assert.strictEqual(fs.readFileSync(current.lockPath, 'utf8'), lockBeforeDiscovery);
    const cachedDiscovery = await service.discoverSkillSource({ name: 'beta' });
    assert.strictEqual(cachedDiscovery.cached, true);
    assert.strictEqual(current.skillsShSearchCalls(), 1);
    const alphaDiscovery = await service.discoverSkillSource({ name: 'alpha' });
    assert.strictEqual(alphaDiscovery.state, 'no-match');
    assert.strictEqual(alphaDiscovery.current_source.source, 'example/ui-skills');
    assert.strictEqual(alphaDiscovery.current_source.source_url, 'https://github.com/example/ui-skills.git');
    const unavailableService = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: { search: async function unavailable() { throw new Error('provider unavailable'); } },
    });
    const unavailableDiscovery = await unavailableService.discoverSkillSource({ name: 'beta' });
    assert.strictEqual(unavailableDiscovery.state, 'unavailable');
    assert.strictEqual(unavailableDiscovery.manual_entry, true);
    assert.strictEqual(unavailableDiscovery.candidates.length, 0);

    const popularService = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const popularDiscovery = await popularService.discoverPopularSkillSources({ limit: 10 });
    assert.strictEqual(popularDiscovery.experimental, true);
    assert.strictEqual(popularDiscovery.selected_count, 1);
    assert.deepStrictEqual(popularDiscovery.selected_names, ['beta']);
    assert.strictEqual(popularDiscovery.ambiguous_count, 0);
    const popularPreview = await popularService.previewPopularSkillSources({
      discovery_id: popularDiscovery.discovery_id,
      names: ['beta'],
    });
    assert(popularPreview.plan_id);
    assert.strictEqual(popularPreview.ready_count, 1);
    assert.strictEqual(popularPreview.skipped_count, 0);
    assert(popularPreview.actions[0].description.includes('TAKE OVER beta FROM SKILLS.SH'));
    const popularApplied = await popularService.applyPopularSkillSources({ plan_id: popularPreview.plan_id, confirm: true });
    assert.strictEqual(popularApplied.status, 'completed');
    assert.strictEqual(popularApplied.count, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta.skillFolderHash, '3'.repeat(40));
    const popularRollback = popularService.previewSkillUpdateRollback();
    const popularRolledBack = popularService.applySkillUpdateRollback({ rollback_id: popularRollback.rollback_id, confirm: true });
    assert.strictEqual(popularRolledBack.status, 'rolled_back');
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta, undefined);

    const sourcePreview = await service.previewSkillSource({
      name: 'beta', skills_url: 'https://skills.sh/example/ui-skills/beta',
    });
    assert.strictEqual(sourcePreview.operation, 'link-source');
    assert.strictEqual(sourcePreview.source_id, 'example/ui-skills/beta');
    assert(sourcePreview.actions.some(function linked(item) { return item.kind === 'skill_source_link'; }));
    await assert.rejects(
      service.applySkillSource({ plan_id: sourcePreview.plan_id, confirm: false }),
      function matching(error) { return error.code === 'CONFIRMATION_REQUIRED'; },
    );
    const sourceLinked = await service.applySkillSource({ plan_id: sourcePreview.plan_id, confirm: true });
    assert.strictEqual(sourceLinked.status, 'source_linked');
    await assert.rejects(
      service.applySkillSource({ plan_id: sourcePreview.plan_id, confirm: true }),
      function matching(error) { return error.code === 'PREVIEW_REQUIRED'; },
    );
    assert.strictEqual(service.skillDetail('beta').description, 'Beta UI workflow, adopted from upstream.');
    assert.strictEqual(service.skillDetail('beta').update.status, 'up-to-date');
    const restartedAfterSourceLink = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient });
    assert.strictEqual(restartedAfterSourceLink.skillDetail('beta').update.status, 'up-to-date');
    const linkedSource = service.skillDetail('beta').update;
    assert.strictEqual(linkedSource.source_origin.label, 'skills.sh 接管');
    assert.deepStrictEqual(linkedSource.source_links.map(function kind(item) { return item.kind; }), ['skills-sh', 'github-repository', 'github-skill']);
    assert.strictEqual(linkedSource.source_links[0].url, 'https://skills.sh/example/ui-skills/beta');
    assert.strictEqual(linkedSource.source_links[2].url, 'https://github.com/example/ui-skills/blob/HEAD/skills/beta/SKILL.md');
    const linkedLockContent = fs.readFileSync(current.lockPath, 'utf8');
    const linkedLockEntry = JSON.parse(linkedLockContent).skills.beta;
    assert.strictEqual(linkedLockEntry.skillsUrl, undefined);
    assert.deepStrictEqual(Object.keys(linkedLockEntry).sort(), [
      'installedAt', 'ref', 'skillFolderHash', 'skillPath',
      'source', 'sourceType', 'sourceUrl', 'updatedAt',
    ]);
    const historyBackedService = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient });
    const historyBackedUpdate = historyBackedService.skillDetail('beta').update;
    assert.strictEqual(historyBackedUpdate.status, 'up-to-date');
    assert.strictEqual(historyBackedUpdate.display.label, '最新');
    assert.strictEqual(historyBackedUpdate.source_origin.label, 'skills.sh 接管');
    assert.strictEqual(historyBackedUpdate.source_links[0].url, 'https://skills.sh/example/ui-skills/beta');
    const updateHistoryRoot = path.join(current.settings.stateDir, 'updates');
    const hiddenUpdateHistory = path.join(current.settings.stateDir, 'updates.withheld-for-test');
    const updateCheckFile = path.join(current.settings.stateDir, 'update-check.json');
    const updateCheckContent = fs.readFileSync(updateCheckFile, 'utf8');
    fs.unlinkSync(updateCheckFile);
    fs.renameSync(updateHistoryRoot, hiddenUpdateHistory);
    try {
      const noHistoryUpdate = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient }).skillDetail('beta').update;
      assert.strictEqual(noHistoryUpdate.status, 'checkable');
      assert.strictEqual(noHistoryUpdate.source_origin.label, 'GitHub 来源');
      assert.deepStrictEqual(noHistoryUpdate.source_links.map(function kind(item) { return item.kind; }), ['github-repository', 'github-skill']);
    } finally {
      fs.renameSync(hiddenUpdateHistory, updateHistoryRoot);
      fs.writeFileSync(updateCheckFile, updateCheckContent, 'utf8');
    }
    const linkedDiscovery = await service.discoverSkillSource({ name: 'beta' });
    assert.strictEqual(linkedDiscovery.state, 'ok');
    assert.strictEqual(linkedDiscovery.current_source.source_url, 'https://github.com/example/ui-skills.git');
    assert.strictEqual(linkedDiscovery.current_source.skills_url, 'https://skills.sh/example/ui-skills/beta');
    assert(linkedDiscovery.candidates.some(function current(item) {
      return item.current && item.source === 'example/ui-skills';
    }));
    await assert.rejects(
      service.previewSkillSource({ name: 'beta', skills_url: 'https://skills.sh/example/ui-skills/beta' }),
      function matching(error) { return error.code === 'INVALID_UPDATE_SOURCE' && /same as the current/.test(error.message); },
    );
    const retargetPreview = await service.previewSkillSource({
      name: 'beta', skills_url: 'https://skills.sh/second/ui-skills/beta',
    });
    assert.strictEqual(retargetPreview.operation, 'retarget-source');
    assert.strictEqual(retargetPreview.previous_source, 'example/ui-skills');
    assert.strictEqual(retargetPreview.source, 'second/ui-skills');
    assert(retargetPreview.actions.some(function retarget(item) { return item.kind === 'skill_source_retarget'; }));
    const retargeted = await service.applySkillSource({ plan_id: retargetPreview.plan_id, confirm: true });
    assert.strictEqual(retargeted.status, 'source_retargeted');
    assert.strictEqual(service.skillDetail('beta').description, 'Beta UI workflow, retargeted upstream.');
    assert.strictEqual(service.skillDetail('beta').update.source_origin.label, 'skills.sh 接管');
    assert.strictEqual(service.skillDetail('beta').update.source_links[0].url, 'https://skills.sh/second/ui-skills/beta');
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta.source, 'second/ui-skills');
    const retargetRollback = service.previewSkillUpdateRollback();
    service.applySkillUpdateRollback({ rollback_id: retargetRollback.rollback_id, confirm: true });
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta.source, 'example/ui-skills');
    assert.strictEqual(service.skillDetail('beta').update.source_links[0].url, 'https://skills.sh/example/ui-skills/beta');
    let sourceRollback = service.previewSkillUpdateRollback();
    service.applySkillUpdateRollback({ rollback_id: sourceRollback.rollback_id, confirm: true });
    assert.strictEqual(service.skillDetail('beta').description, 'Beta UI workflow.');
    assert.strictEqual(service.skillDetail('beta').update.source_origin.label, '未关联');
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta, undefined);

    const hashlessLock = JSON.parse(fs.readFileSync(current.lockPath, 'utf8'));
    hashlessLock.skills.beta = {
      source: 'example/ui-skills', sourceType: 'github', sourceUrl: 'https://github.com/example/ui-skills.git',
      skillPath: 'skills/beta/SKILL.md', skillFolderHash: '', installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    fs.writeFileSync(current.lockPath, JSON.stringify(hashlessLock, null, 2), 'utf8');
    const baselinePreview = await service.previewSkillSource({ name: 'beta' });
    assert.strictEqual(baselinePreview.operation, 'rebuild-baseline');
    const baselineRebuilt = await service.applySkillSource({ plan_id: baselinePreview.plan_id, confirm: true });
    assert.strictEqual(baselineRebuilt.status, 'baseline_rebuilt');
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta.skillFolderHash, '3'.repeat(40));
    sourceRollback = service.previewSkillUpdateRollback();
    service.applySkillUpdateRollback({ rollback_id: sourceRollback.rollback_id, confirm: true });
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta.skillFolderHash, '');
    let sourceClock = 100;
    const expiringService = ash.createUiService(current.settings, {
      now: function now() { return sourceClock; }, ttlMs: 5,
      tokenFactory: function expiredToken() { return 'expired-source-plan'; },
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const expiredSource = await expiringService.previewSkillSource({ name: 'beta' });
    sourceClock = 106;
    await assert.rejects(
      expiringService.applySkillSource({ plan_id: expiredSource.plan_id, confirm: true }),
      function matching(error) { return error.code === 'PREVIEW_EXPIRED'; },
    );

    const stale = service.previewRepair('all');
    fs.mkdirSync(path.dirname(current.settings.codexAgentsFile), { recursive: true });
    fs.writeFileSync(current.settings.codexAgentsFile, '# Personal change after preview\n', 'utf8');
    assert.throws(function applyStale() {
      service.applyRepair({ plan_id: stale.plan_id, confirm: true });
    }, function matching(error) { return error.code === 'PREVIEW_STALE'; });
    assert.strictEqual(fs.readFileSync(current.settings.codexAgentsFile, 'utf8'), '# Personal change after preview\n');
    fs.unlinkSync(current.settings.codexAgentsFile);

    const fresh = service.previewRepair('all');
    assert.throws(function missingConfirmation() {
      service.applyRepair({ plan_id: fresh.plan_id, confirm: false });
    }, function matching(error) { return error.code === 'CONFIRMATION_REQUIRED'; });
    const applied = service.applyRepair({ plan_id: fresh.plan_id, confirm: true });
    assert.strictEqual(applied.status, 'completed');
    assert(fs.readFileSync(current.settings.codexAgentsFile, 'utf8').includes('ASH-managed user Skill creation'));

    const rollback = service.previewRollback('latest');
    assert.throws(function missingConfirmation() {
      service.applyRollback({ rollback_id: rollback.rollback_id, confirm: false });
    }, function matching(error) { return error.code === 'CONFIRMATION_REQUIRED'; });
    assert.strictEqual(service.applyRollback({ rollback_id: rollback.rollback_id, confirm: true }).status, 'rolled_back');
    assert.strictEqual(fs.existsSync(current.settings.codexAgentsFile), false);

    writeSkill(path.join(current.library, 'gamma'), 'gamma', 'State added after repair verification.');

    const customRoot = path.join(current.root, 'team-skills');
    writeSkill(path.join(customRoot, 'alpha'), 'alpha', 'Duplicate alpha from a read-only source.');
    writeSkill(path.join(customRoot, 'gamma'), 'gamma', 'Gamma team workflow.');
    fs.symlinkSync(path.join(current.library, 'beta'), path.join(customRoot, 'beta'), process.platform === 'win32' ? 'junction' : 'dir');
    const libraryPreview = service.previewLibraryChange({ action: 'add', path: customRoot, name: 'Team skills' });
    assert.strictEqual(fs.existsSync(ash.preferencesPath(current.settings)), false);
    assert.throws(function missingLibraryConfirmation() {
      service.applyLibraryChange({ plan_id: libraryPreview.plan_id, confirm: false });
    }, function matching(error) { return error.code === 'CONFIRMATION_REQUIRED'; });
    service.applyLibraryChange({ plan_id: libraryPreview.plan_id, confirm: true });
    let expanded = service.overview();
    assert.strictEqual(expanded.libraries.length, 2);
    assert.strictEqual(expanded.summary.skills, 5);
    assert(expanded.issues.some(function duplicate(item) { return item.code === 'SCAN_ROOT_DUPLICATE_NAME'; }));
    assert.strictEqual(expanded.issues.some(function falseDuplicate(item) {
      return item.code === 'SCAN_ROOT_DUPLICATE_NAME' && item.message.indexOf('beta ') === 0;
    }), false);
    const linkedBeta = expanded.skills.filter(function beta(skill) { return skill.name === 'beta'; });
    assert.strictEqual(linkedBeta.length, 1);
    assert.strictEqual(linkedBeta[0].locations.length, 2);
    assert(linkedBeta[0].library_ids.includes(libraryPreview.root.id));
    assert.strictEqual(service.skillDetail('beta', libraryPreview.root.id).can_write, true);
    assert.strictEqual(service.skillDetail('gamma', libraryPreview.root.id).library_mode, 'observe');
    assert.strictEqual(service.skillDetail('gamma', libraryPreview.root.id).can_remove, false);
    assert.throws(function readOnlyRemoval() {
      service.previewSkillRemoval({ name: 'gamma', library_id: libraryPreview.root.id });
    }, function matching(error) { return error.code === 'READ_ONLY_LIBRARY'; });

    const createPreview = service.previewCreateSkill({ name: 'delta', description: 'Delta managed workflow.' });
    const created = service.applyCreateSkill({ plan_id: createPreview.plan_id, confirm: true });
    assert.strictEqual(created.status, 'created');
    assert(fs.existsSync(path.join(current.library, 'delta', 'SKILL.md')));

    const descriptionPreview = service.previewSkillDescription({
      name: 'delta', library_id: ash.MANAGED_LIBRARY_ID, description: 'Updated delta trigger description.',
    });
    const descriptionApplied = service.applySkillDescription({ plan_id: descriptionPreview.plan_id, confirm: true });
    assert.strictEqual(descriptionApplied.status, 'updated');
    assert.strictEqual(service.skillDetail('delta').description, 'Updated delta trigger description.');
    const metadataRollback = service.previewRollback('latest');
    service.applyRollback({ rollback_id: metadataRollback.rollback_id, confirm: true });
    assert.strictEqual(service.skillDetail('delta').description, 'Delta managed workflow.');

    const folded = '---\nname: sample\ndescription: >-\n  Previous folded\n  description\nlicense: MIT\n---\n\n# Sample\n';
    const rendered = ash.renderSkillDescription(folded, 'One clear trigger sentence.');
    assert(rendered.includes('description: "One clear trigger sentence."\nlicense: MIT'));
    assert.strictEqual(rendered.includes('Previous folded'), false);

    const packagePreview = service.previewPackage({ name: 'delta', library_id: ash.MANAGED_LIBRARY_ID });
    const packaged = service.applyPackage({ plan_id: packagePreview.plan_id, confirm: true });
    assert.strictEqual(packaged.status, 'packaged');
    assert(fs.existsSync(packaged.output));

    const removalPreview = service.previewSkillRemoval({ name: 'delta', library_id: ash.MANAGED_LIBRARY_ID });
    assert.strictEqual(removalPreview.mode, 'quarantine');
    assert.strictEqual(removalPreview.confirmation_name, 'delta');
    assert(removalPreview.actions.some(function recovery(item) { return item.kind === 'skill_quarantine'; }));
    assert.throws(function missingTypedConfirmation() {
      service.applySkillRemoval({ plan_id: removalPreview.plan_id, confirm: true, confirmation_name: 'wrong' });
    }, function matching(error) { return error.code === 'CONFIRMATION_NAME_MISMATCH'; });
    const freshRemoval = service.previewSkillRemoval({ name: 'delta', library_id: ash.MANAGED_LIBRARY_ID });
    const removed = service.applySkillRemoval({ plan_id: freshRemoval.plan_id, confirm: true, confirmation_name: 'delta' });
    assert.strictEqual(removed.status, 'removed');
    assert.strictEqual(fs.existsSync(path.join(current.library, 'delta')), false);
    assert.strictEqual(service.overview().removal_rollback.name, 'delta');
    const removalRollback = service.previewSkillRemovalRollback();
    const removalRestored = service.applySkillRemovalRollback({ rollback_id: removalRollback.rollback_id, confirm: true });
    assert.strictEqual(removalRestored.status, 'restored');
    assert(fs.existsSync(path.join(current.library, 'delta', 'SKILL.md')));

    writeSkill(path.join(current.library, 'purge-probe'), 'purge-probe', 'Disposable permanent deletion probe.');
    const purgeRemoval = service.previewSkillRemoval({ name: 'purge-probe', library_id: ash.MANAGED_LIBRARY_ID });
    service.applySkillRemoval({ plan_id: purgeRemoval.plan_id, confirm: true, confirmation_name: 'purge-probe' });
    const recoveryItems = service.overview().removals;
    assert.strictEqual(recoveryItems.length, 1);
    assert.strictEqual(recoveryItems[0].name, 'purge-probe');
    assert.strictEqual(recoveryItems[0].can_restore, true);
    const purgePreview = service.previewSkillRemovalPurge({ transaction_id: recoveryItems[0].transaction_id });
    assert.strictEqual(purgePreview.confirmation_name, 'purge-probe');
    assert(purgePreview.actions.some(function irreversible(item) { return item.kind === 'skill_removal_purge'; }));
    assert.throws(function wrongPurgeName() {
      service.applySkillRemovalPurge({ plan_id: purgePreview.plan_id, confirm: true, confirmation_name: 'wrong' });
    }, function matching(error) { return error.code === 'CONFIRMATION_NAME_MISMATCH'; });
    const freshPurge = service.previewSkillRemovalPurge({ transaction_id: recoveryItems[0].transaction_id });
    const purged = service.applySkillRemovalPurge({ plan_id: freshPurge.plan_id, confirm: true, confirmation_name: 'purge-probe' });
    assert.strictEqual(purged.status, 'purged');
    assert.deepStrictEqual(service.overview().removals, []);
    assert.strictEqual(fs.existsSync(path.join(current.library, 'purge-probe')), false);

    ['bulk-probe-one', 'bulk-probe-two'].forEach(function addBulkProbe(name) {
      writeSkill(path.join(current.library, name), name, 'Disposable bulk permanent deletion probe.');
      const preview = service.previewSkillRemoval({ name, library_id: ash.MANAGED_LIBRARY_ID });
      service.applySkillRemoval({ plan_id: preview.plan_id, confirm: true, confirmation_name: name });
    });
    const bulkPurgePreview = service.previewSkillRemovalBulkPurge();
    assert.strictEqual(bulkPurgePreview.count, 2);
    assert.strictEqual(bulkPurgePreview.confirmation_text, '永久删除全部 2 个 Skill');
    assert.throws(function wrongBulkConfirmation() {
      service.applySkillRemovalBulkPurge({ plan_id: bulkPurgePreview.plan_id, confirm: true, confirmation_text: '永久删除全部' });
    }, function matching(error) { return error.code === 'CONFIRMATION_TEXT_MISMATCH'; });
    const freshBulkPurge = service.previewSkillRemovalBulkPurge();
    const bulkPurged = service.applySkillRemovalBulkPurge({
      plan_id: freshBulkPurge.plan_id,
      confirm: true,
      confirmation_text: freshBulkPurge.confirmation_text,
    });
    assert.strictEqual(bulkPurged.status, 'purged');
    assert.strictEqual(bulkPurged.deleted_count, 2);
    assert.deepStrictEqual(service.overview().removals, []);

    const snapshotPreview = service.previewSnapshotCreate();
    const snapshotCreated = service.applySnapshotCreate({ plan_id: snapshotPreview.plan_id, confirm: true });
    assert.strictEqual(snapshotCreated.status, 'created');
    assert.strictEqual(snapshotCreated.snapshot.skill_count, 4);
    assert.strictEqual(service.listSnapshots().length, 1);
    assert.strictEqual(service.verifyManagedSnapshot(snapshotCreated.snapshot.snapshot_id).verification.ok, true);

    removeTree(path.join(current.library, 'beta'));
    const restorePreview = service.previewSnapshotRestore({ snapshot: snapshotCreated.snapshot.snapshot_id });
    assert.deepStrictEqual(restorePreview.actions.map(function name(item) { return path.basename(item.path); }), ['beta']);
    const restored = service.applySnapshotRestore({ plan_id: restorePreview.plan_id, confirm: true });
    assert.strictEqual(restored.status, 'restored');
    assert(fs.existsSync(path.join(current.library, 'beta', 'SKILL.md')));

    const removePreview = service.previewLibraryChange({ action: 'remove', library_id: libraryPreview.root.id });
    service.applyLibraryChange({ plan_id: removePreview.plan_id, confirm: true });
    assert.strictEqual(service.overview().libraries.length, 1);
    assert(fs.existsSync(path.join(customRoot, 'gamma', 'SKILL.md')));
    process.stdout.write('ok - UI service enforces preview, confirmation, rescan, transaction, and rollback\n');
  } finally {
    current.cleanup();
  }
}

async function testPopularBatchKeepsSequentialSuccessesAndWritesLogs() {
  const current = popularBatchFixture(['beta', 'gamma']);
  try {
    const service = ash.createUiService(current.settings, {
      dateFactory: function fixedDate() { return new Date('2026-08-21T08:00:00.000Z'); },
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const preview = await previewPopularBatch(service, ['beta', 'gamma']);
    const result = await service.applyPopularSkillSources({ plan_id: preview.plan_id, confirm: true });
    assert.strictEqual(result.status, 'completed');
    assert.deepStrictEqual(result.applied.map(function name(item) { return item.name; }), ['beta', 'gamma']);
    assert.deepStrictEqual(result.failed, []);
    assert.strictEqual(result.applied_count, 2);
    assert.strictEqual(result.failed_count, 0);
    const progress = service.popularApplyProgress(preview.plan_id);
    assert.strictEqual(progress.status, 'completed');
    assert.strictEqual(progress.applied_count, 2);
    assert.deepStrictEqual(progress.items.map(function state(item) { return item.state; }), ['succeeded', 'succeeded']);
    const lock = JSON.parse(fs.readFileSync(current.lockPath, 'utf8'));
    assert.strictEqual(lock.skills.beta.skillFolderHash, current.hashes.beta);
    assert.strictEqual(lock.skills.gamma.skillFolderHash, current.hashes.gamma);

    const logPath = ash.popularTakeoverLogPath(current.settings);
    const logText = fs.readFileSync(logPath, 'utf8');
    const logs = readPopularLogs(current.settings);
    assert.deepStrictEqual(logs.map(function event(item) { return item.event; }), [
      'batch_started', 'item_started', 'item_succeeded', 'item_started', 'item_succeeded', 'batch_finished',
    ]);
    assert(logs.every(function correlated(item) { return item.batch_transaction_id === result.batch_transaction_id; }));
    assert(logs.filter(function succeeded(item) { return item.event === 'item_succeeded'; }).every(function transaction(item) { return Boolean(item.transaction_id); }));
    const itemLogs = logs.filter(function item(item) { return item.skill_name; });
    assert(itemLogs.every(function diagnostic(item) {
      return ['beta', 'gamma'].indexOf(item.skill_name) !== -1 &&
        item.source_identity === 'example/batch-skills/' + item.skill_name &&
        Boolean(item.execution_phase) &&
        Boolean(item.transaction_id) &&
        Object.prototype.hasOwnProperty.call(item, 'error_code') &&
        Object.prototype.hasOwnProperty.call(item, 'error_message');
    }));
    assert.strictEqual(logs[5].outcome, 'completed');
    assert.strictEqual(fs.statSync(logPath).mode & 0o777, 0o600);
    assert.strictEqual(logText.includes(current.root), false);
    assert.strictEqual(logText.includes('beta'), true);
    assert.strictEqual(logText.includes('gamma'), true);
    process.stdout.write('ok - popular takeover applies two sequential Skills and writes privacy-safe structured logs\n');
  } finally {
    current.cleanup();
  }
}

async function testSingleSourceFailureRedactsThrownUiError() {
  const current = fixture();
  const renameSync = fs.renameSync;
  const secret = 'single-ui-session-secret';
  try {
    const service = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
      auditSecrets: [secret],
    });
    const preview = await service.previewSkillSource({
      name: 'beta',
      source_url: 'https://github.com/example/ui-skills.git',
      skill_path: 'skills/beta',
    });
    fs.renameSync = function failLockWrite(source, destination) {
      if (destination === current.lockPath) {
        throw new Error('write denied at ' + current.settings.homeDir + '; X-ASH-Session=' + secret +
          '; https://example.invalid/?access_token=query-secret');
      }
      return renameSync(source, destination);
    };
    let caught;
    try {
      await service.applySkillSource({ plan_id: preview.plan_id, confirm: true });
    } catch (error) {
      caught = error;
    }
    assert(caught);
    assert.strictEqual(caught.code, 'LOCAL_APPLY_FAILED');
    assert.strictEqual(caught.message.includes(current.settings.homeDir), false);
    assert.strictEqual(caught.message.includes(secret), false);
    assert.strictEqual(caught.message.includes('query-secret'), false);
    assert(caught.message.length <= 400);
    process.stdout.write('ok - single-source UI failures redact HOME, session headers, and token query values\n');
  } finally {
    fs.renameSync = renameSync;
    current.cleanup();
  }
}

async function testPopularBatchReturnsPartialAndContinues() {
  const current = popularBatchFixture(['beta', 'gamma', 'zeta']);
  const renameSync = fs.renameSync;
  let failGammaLockWrite = true;
  try {
    fs.renameSync = function failOneLockWrite(source, destination) {
      if (failGammaLockWrite && destination === current.lockPath) {
        const candidate = JSON.parse(fs.readFileSync(source, 'utf8'));
        if (candidate.skills && candidate.skills.gamma) {
          failGammaLockWrite = false;
          throw new Error('installer lock denied at ' + current.root +
            '; X-ASH-Session=session-super-secret; https://example.invalid/?session=session-query-secret&token=token-query-secret; ' +
            new Array(600).fill('x').join(''));
        }
      }
      return renameSync(source, destination);
    };
    const service = ash.createUiService(current.settings, {
      dateFactory: function fixedDate() { return new Date('2026-08-21T09:00:00.000Z'); },
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
      auditSecrets: ['session-super-secret'],
    });
    const preview = await previewPopularBatch(service, ['beta', 'gamma', 'zeta']);
    const result = await service.applyPopularSkillSources({ plan_id: preview.plan_id, confirm: true });
    assert.strictEqual(result.status, 'partial');
    assert.deepStrictEqual(result.applied.map(function name(item) { return item.name; }), ['beta', 'zeta']);
    assert.deepStrictEqual(result.failed.map(function name(item) { return item.name; }), ['gamma']);
    assert.strictEqual(result.failed[0].code, 'LOCAL_APPLY_FAILED');
    assert.strictEqual(result.failed[0].phase, 'local_apply');
    assert.strictEqual(result.failed[0].rollback_failed, false);
    assert(result.failed[0].transaction_id);
    assert.strictEqual(result.applied_count, 2);
    assert.strictEqual(result.failed_count, 1);
    const lock = JSON.parse(fs.readFileSync(current.lockPath, 'utf8'));
    assert.strictEqual(lock.skills.beta.skillFolderHash, current.hashes.beta);
    assert.strictEqual(lock.skills.gamma, undefined);
    assert.strictEqual(lock.skills.zeta.skillFolderHash, current.hashes.zeta);
    const logs = readPopularLogs(current.settings);
    assert.strictEqual(logs.filter(function failed(item) { return item.event === 'item_failed'; }).length, 1);
    const failureLog = logs.find(function failed(item) { return item.event === 'item_failed'; });
    assert.strictEqual(failureLog.error_code, 'LOCAL_APPLY_FAILED');
    assert.strictEqual(failureLog.execution_phase, 'local_apply');
    assert.strictEqual(failureLog.skill_name, 'gamma');
    assert.strictEqual(failureLog.source_identity, 'example/batch-skills/gamma');
    assert.strictEqual(failureLog.transaction_id, result.failed[0].transaction_id);
    assert(failureLog.error_message.length <= 400);
    assert.strictEqual(failureLog.error_message.includes(current.root), false);
    assert.strictEqual(failureLog.error_message.includes('session-super-secret'), false);
    assert.strictEqual(failureLog.error_message.includes('session-query-secret'), false);
    assert.strictEqual(failureLog.error_message.includes('token-query-secret'), false);
    const rollback = logs.find(function rolledBack(item) { return item.event === 'rollback_started'; });
    assert(rollback.transaction_id);
    assert.strictEqual(rollback.rollback_initiator, 'popular_takeover_item_transaction');
    assert.strictEqual(rollback.rollback_reason, 'LOCAL_APPLY_FAILED');
    const failedTransaction = JSON.parse(fs.readFileSync(path.join(
      current.settings.stateDir, 'updates', result.failed[0].transaction_id, 'transaction.json',
    ), 'utf8'));
    assert.strictEqual(failedTransaction.version, 1);
    assert.strictEqual(failedTransaction.status, 'failed');
    assert.strictEqual(failedTransaction.rollback.initiator, 'popular_takeover_item_transaction');
    assert.strictEqual(failedTransaction.rollback.outcome, 'completed');
    const persistedErrors = JSON.stringify({
      error: failedTransaction.error,
      rollback_error: failedTransaction.rollback_error,
      rollback: failedTransaction.rollback,
    });
    assert(failedTransaction.rollback.reason.includes('installer lock denied'));
    assert(failedTransaction.error.length <= 400);
    assert(failedTransaction.rollback.reason.length <= 400);
    assert.strictEqual(persistedErrors.includes(current.root), false);
    assert.strictEqual(persistedErrors.includes('session-super-secret'), false);
    assert.strictEqual(persistedErrors.includes('session-query-secret'), false);
    assert.strictEqual(persistedErrors.includes('token-query-secret'), false);
    assert.strictEqual(JSON.stringify(result).includes(current.root), false);
    assert.strictEqual(JSON.stringify(result).includes('session-super-secret'), false);
    assert.strictEqual(JSON.stringify(result).includes('session-query-secret'), false);
    assert.strictEqual(JSON.stringify(result).includes('token-query-secret'), false);
    assert(failedTransaction.rollback.started_at);
    assert(failedTransaction.rollback.completed_at);
    assert.strictEqual(logs[logs.length - 1].outcome, 'partial');
    assert.strictEqual(logs[logs.length - 1].applied_count, 2);
    assert.strictEqual(logs[logs.length - 1].failed_count, 1);
    process.stdout.write('ok - popular takeover preserves successes and continues after a partial failure\n');
  } finally {
    fs.renameSync = renameSync;
    current.cleanup();
  }
}

async function testPopularBatchClassifiesPreparationFailuresAndContinues() {
  const current = popularBatchFixture(['beta', 'gamma', 'zeta']);
  const materialize = current.updateSourceClient.materialize;
  const calls = new Map();
  const brokenCandidate = path.join(current.root, 'broken-candidate-gamma');
  fs.mkdirSync(brokenCandidate, { recursive: true });
  current.updateSourceClient.materialize = async function failPreparedCandidate(entry) {
    const count = (calls.get(entry.name) || 0) + 1;
    calls.set(entry.name, count);
    if (entry.name === 'gamma' && count === 4) {
      return { path: brokenCandidate, revision: 'gamma-broken', folderHash: current.hashes.gamma, cleanup: function cleanup() {} };
    }
    return materialize(entry);
  };
  try {
    const service = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const preview = await previewPopularBatch(service, ['beta', 'gamma', 'zeta']);
    const result = await service.applyPopularSkillSources({ plan_id: preview.plan_id, confirm: true });
    assert.strictEqual(result.status, 'partial');
    assert.deepStrictEqual(result.applied.map(function name(item) { return item.name; }), ['beta', 'zeta']);
    assert.strictEqual(result.failed[0].code, 'LOCAL_APPLY_FAILED');
    assert.strictEqual(result.failed[0].phase, 'preparation');
    assert.strictEqual(result.failed[0].transaction_id, null);
    assert.strictEqual(result.failed[0].rollback_failed, false);
    const failureLog = readPopularLogs(current.settings).find(function failed(item) { return item.event === 'item_failed'; });
    assert.strictEqual(failureLog.execution_phase, 'preparation');
    process.stdout.write('ok - popular takeover classifies preparation failures and continues remaining items\n');
  } finally {
    current.cleanup();
  }
}

async function testPopularBatchAbortsWhenAutomaticRollbackFails() {
  const current = popularBatchFixture(['beta', 'gamma', 'zeta']);
  const renameSync = fs.renameSync;
  let injected = false;
  try {
    fs.renameSync = function changeLockAfterGammaWrite(source, destination) {
      const result = renameSync(source, destination);
      if (!injected && destination === current.lockPath) {
        const written = JSON.parse(fs.readFileSync(destination, 'utf8'));
        if (written.skills && written.skills.gamma) {
          written.skills.concurrent = { sourceType: 'external', marker: 'keep-me' };
          fs.writeFileSync(destination, JSON.stringify(written, null, 2) + '\n', 'utf8');
          injected = true;
        }
      }
      return result;
    };
    const service = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const preview = await previewPopularBatch(service, ['beta', 'gamma', 'zeta']);
    const result = await service.applyPopularSkillSources({ plan_id: preview.plan_id, confirm: true });
    assert.strictEqual(result.status, 'aborted');
    assert.strictEqual(result.remaining_count, 1);
    assert.deepStrictEqual(result.applied.map(function name(item) { return item.name; }), ['beta']);
    assert.deepStrictEqual(result.failed.map(function name(item) { return item.name; }), ['gamma']);
    assert.strictEqual(result.failed[0].rollback_failed, true);
    assert.strictEqual(result.failed[0].phase, 'local_apply');
    assert(result.failed[0].transaction_id);
    const lock = JSON.parse(fs.readFileSync(current.lockPath, 'utf8'));
    assert.strictEqual(lock.skills.beta.skillFolderHash, current.hashes.beta);
    assert.strictEqual(lock.skills.gamma.skillFolderHash, current.hashes.gamma);
    assert.strictEqual(lock.skills.concurrent.marker, 'keep-me');
    assert.strictEqual(lock.skills.zeta, undefined);
    const transaction = JSON.parse(fs.readFileSync(path.join(
      current.settings.stateDir, 'updates', result.failed[0].transaction_id, 'transaction.json',
    ), 'utf8'));
    assert.strictEqual(transaction.rollback_failed, true);
    assert.strictEqual(transaction.rollback.outcome, 'failed');
    assert.strictEqual(transaction.lock_written, true);
    const logs = readPopularLogs(current.settings);
    assert.strictEqual(logs.some(function zeta(item) { return item.skill_name === 'zeta'; }), false);
    assert.strictEqual(logs[logs.length - 1].outcome, 'aborted');
    assert.strictEqual(logs[logs.length - 1].remaining_count, 1);
    process.stdout.write('ok - popular takeover aborts remaining items when automatic rollback fails\n');
  } finally {
    fs.renameSync = renameSync;
    current.cleanup();
  }
}

async function testPopularBatchKeepsTransactionSuccessWhenPostWorkFails() {
  const current = popularBatchFixture(['beta']);
  const openSync = fs.openSync;
  const readdirSync = fs.readdirSync;
  let auditWriteFailed = false;
  let cacheRefreshFailed = false;
  try {
    const logPath = ash.popularTakeoverLogPath(current.settings);
    fs.openSync = function failAuditWrite(filePath) {
      if (filePath === logPath) {
        auditWriteFailed = true;
        throw new Error('simulated audit write failure');
      }
      return openSync.apply(fs, arguments);
    };
    fs.readdirSync = function failPostTransactionCache(directory) {
      if (directory === current.library) {
        const lock = JSON.parse(fs.readFileSync(current.lockPath, 'utf8'));
        if (lock.skills.beta) {
          cacheRefreshFailed = true;
          throw new Error('simulated post-transaction cache refresh failure');
        }
      }
      return readdirSync.apply(fs, arguments);
    };
    const service = ash.createUiService(current.settings, {
      dateFactory: function fixedDate() { return new Date('2026-08-21T10:00:00.000Z'); },
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const preview = await previewPopularBatch(service, ['beta']);
    const result = await service.applyPopularSkillSources({ plan_id: preview.plan_id, confirm: true });
    assert.strictEqual(result.status, 'completed');
    assert.deepStrictEqual(result.applied.map(function name(item) { return item.name; }), ['beta']);
    assert.deepStrictEqual(result.failed, []);
    assert.strictEqual(result.applied_count, 1);
    assert.strictEqual(result.failed_count, 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.beta.skillFolderHash, current.hashes.beta);
    const transaction = JSON.parse(fs.readFileSync(path.join(
      current.settings.stateDir, 'updates', result.applied[0].transaction_id, 'transaction.json',
    ), 'utf8'));
    assert.strictEqual(transaction.status, 'completed');
    assert.strictEqual(transaction.rollback.outcome, 'not_required');
    assert.strictEqual(auditWriteFailed, true);
    assert.strictEqual(cacheRefreshFailed, true);
    assert.strictEqual(fs.existsSync(logPath), false);
    process.stdout.write('ok - popular takeover keeps transaction success when cache refresh and audit writes fail\n');
  } finally {
    fs.openSync = openSync;
    fs.readdirSync = readdirSync;
    current.cleanup();
  }
}

async function testPopularApplyProgressIsVisibleWhileItemRuns() {
  const current = popularBatchFixture(['beta', 'gamma']);
  let releaseBeta;
  try {
    const service = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
    const preview = await previewPopularBatch(service, ['beta', 'gamma']);
    assert.strictEqual(service.popularApplyProgress(preview.plan_id).status, 'idle');
    const holdBeta = new Promise(function wait(resolve) { releaseBeta = resolve; });
    const materialize = current.updateSourceClient.materialize;
    current.updateSourceClient.materialize = async function delayed(entry) {
      if (entry.name === 'beta') await holdBeta;
      return materialize(entry);
    };
    const applyPromise = service.applyPopularSkillSources({ plan_id: preview.plan_id, confirm: true });
    let seen = service.popularApplyProgress(preview.plan_id);
    for (let attempt = 0; attempt < 50 && !(seen.status === 'running' && seen.items[0] && seen.items[0].state === 'running'); attempt += 1) {
      await new Promise(function pause(resolve) { setTimeout(resolve, 10); });
      seen = service.popularApplyProgress(preview.plan_id);
    }
    assert.strictEqual(seen.status, 'running', JSON.stringify(seen));
    assert.strictEqual(seen.plan_id, preview.plan_id);
    assert.strictEqual(seen.current_name, 'beta');
    assert.strictEqual(seen.total_count, 2);
    assert.strictEqual(seen.done_count, 0);
    assert.deepStrictEqual(seen.items.map(function state(item) { return item.state; }), ['running', 'queued']);
    assert.strictEqual(service.popularApplyProgress('other-plan').status, 'idle');
    releaseBeta();
    releaseBeta = null;
    const result = await applyPromise;
    assert.strictEqual(result.status, 'completed');
    const finished = service.popularApplyProgress(preview.plan_id);
    assert.strictEqual(finished.status, 'completed');
    assert.deepStrictEqual(finished.items.map(function state(item) { return item.state; }), ['succeeded', 'succeeded']);
    process.stdout.write('ok - popular takeover exposes per-skill progress while a batch item is running\n');
  } finally {
    if (typeof releaseBeta === 'function') releaseBeta();
    current.cleanup();
  }
}

async function testPopularPreviewReportsSkippedItemsWithoutSecrets() {
  const current = popularBatchFixture(['beta', 'gamma', 'zeta']);
  const secret = 'preview-session-secret';
  try {
    const script = path.join(current.root, 'source-candidate-gamma', 'run.sh');
    fs.writeFileSync(script, '#!/bin/sh\necho hi\n', 'utf8');
    fs.chmodSync(script, 0o755);
    const materialize = current.updateSourceClient.materialize;
    current.updateSourceClient.materialize = async function failZeta(entry) {
      if (entry.name === 'zeta') {
        throw new Error('clone failed at ' + current.settings.homeDir + '; X-ASH-Session=' + secret);
      }
      return materialize(entry);
    };
    const service = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
      auditSecrets: [secret],
    });
    const discovery = await service.discoverPopularSkillSources({ limit: 100 });
    const preview = await service.previewPopularSkillSources({
      discovery_id: discovery.discovery_id,
      names: ['beta', 'gamma', 'zeta'],
    });
    assert.strictEqual(preview.selected_count, 3);
    assert.strictEqual(preview.ready_count, 1);
    assert.strictEqual(preview.skipped_count, 2);
    assert.deepStrictEqual(preview.ready.map(function name(item) { return item.name; }), ['beta']);
    const skipped = preview.skipped.slice().sort(function byName(left, right) { return left.name.localeCompare(right.name); });
    assert.strictEqual(skipped[0].name, 'gamma');
    assert(skipped[0].reason.includes('可执行文件'), skipped[0].reason);
    assert.strictEqual(skipped[1].name, 'zeta');
    assert.strictEqual(skipped[1].reason.includes(current.settings.homeDir), false);
    assert.strictEqual(skipped[1].reason.includes(secret), false);
    assert(skipped[1].reason.includes('<HOME>'), skipped[1].reason);
    assert(skipped[1].reason.includes('<REDACTED>'), skipped[1].reason);
    process.stdout.write('ok - popular takeover preview reports skipped Skills and redacts secrets\n');
  } finally {
    current.cleanup();
  }
}

async function testHttpServer() {
  const current = fixture();
  let running;
  let openedSnapshotDirectory = null;
  try {
    running = await ash.startUiServer(current.settings, {
      port: 0,
      open: false,
      serviceOptions: {
        dateFactory: function fixedDate() { return new Date('2026-08-20T00:00:00.000Z'); },
        updateSourceClient: current.updateSourceClient,
        skillsShSearchClient: current.skillsShSearchClient,
        openDirectory: function open(directory) { openedSnapshotDirectory = directory; },
      },
    });
    assert(running.url.indexOf('http://127.0.0.1:') === 0);

    const page = await request(running.url);
    assert.strictEqual(page.status, 200);
    assert(page.headers['content-security-policy'].includes("default-src 'self'"));
    assert(page.text.includes('THE LOCAL AGENT SKILL CONTROL PLANE'));
    const tokenMatch = /name="ash-session" content="([a-f0-9]+)"/.exec(page.text);
    assert(tokenMatch);
    const session = tokenMatch[1];

    const overviewResponse = await request(running.url + 'api/overview');
    assert.strictEqual(overviewResponse.status, 200);
    assert.strictEqual(json(overviewResponse).summary.skills, 2);
    assert.strictEqual(json(overviewResponse).library.path, current.library);
    assert.strictEqual(json(overviewResponse).source_insights.coverage_percent, 50);
    assert.strictEqual(json(overviewResponse).retention.action_count, 1);

    const idleProgress = await request(running.url + 'api/updates/source/popular/progress');
    assert.strictEqual(idleProgress.status, 200, idleProgress.text);
    assert.strictEqual(json(idleProgress).status, 'idle');
    assert.deepStrictEqual(json(idleProgress).items, []);

    const detailResponse = await request(running.url + 'api/skills/alpha');
    assert.strictEqual(detailResponse.status, 200);
    const detail = json(detailResponse);
    assert(detail.skill_md.includes('# alpha'));
    assert.strictEqual(detail.update.display.label, '待检查');
    assert.strictEqual(detail.update.source_origin.label, 'GitHub 来源');
    assert.deepStrictEqual(detail.update.source_links.map(function kind(item) { return item.kind; }), ['github-repository', 'github-skill']);
    assert.strictEqual(detail.update.source_links[0].url, 'https://github.com/example/ui-skills');
    assert.strictEqual(detail.update.source_links[1].url, 'https://github.com/example/ui-skills/blob/HEAD/skills/alpha/SKILL.md');
    assert.strictEqual(detail.health.level, 'clear');

    const forbidden = await request(running.url + 'api/repair/preview', { method: 'POST', body: { scope: 'all' } });
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(json(forbidden).error.code, 'SESSION_REQUIRED');
    const forbiddenPrune = await request(running.url + 'api/transactions/prune/preview', { method: 'POST', body: {} });
    assert.strictEqual(forbiddenPrune.status, 403);
    assert.strictEqual(json(forbiddenPrune).error.code, 'SESSION_REQUIRED');
    const forbiddenUpdate = await request(running.url + 'api/updates/check', { method: 'POST', body: {} });
    assert.strictEqual(forbiddenUpdate.status, 403);
    assert.strictEqual(json(forbiddenUpdate).error.code, 'SESSION_REQUIRED');
    const forbiddenRemoval = await request(running.url + 'api/skills/removal/preview', {
      method: 'POST', body: { name: 'alpha', library_id: ash.MANAGED_LIBRARY_ID },
    });
    assert.strictEqual(forbiddenRemoval.status, 403);
    assert.strictEqual(json(forbiddenRemoval).error.code, 'SESSION_REQUIRED');
    const forbiddenRemovalPurge = await request(running.url + 'api/skills/removal/purge/preview', {
      method: 'POST', body: { transaction_id: 'unknown' },
    });
    assert.strictEqual(forbiddenRemovalPurge.status, 403);
    assert.strictEqual(json(forbiddenRemovalPurge).error.code, 'SESSION_REQUIRED');
    const forbiddenBulkRemovalPurge = await request(running.url + 'api/skills/removal/bulk-purge/preview', {
      method: 'POST', body: {},
    });
    assert.strictEqual(forbiddenBulkRemovalPurge.status, 403);
    assert.strictEqual(json(forbiddenBulkRemovalPurge).error.code, 'SESSION_REQUIRED');
    const forbiddenSource = await request(running.url + 'api/updates/source/preview', {
      method: 'POST', body: { name: 'beta', source_url: 'https://github.com/example/ui-skills.git', skill_path: 'skills/beta' },
    });
    assert.strictEqual(forbiddenSource.status, 403);
    assert.strictEqual(json(forbiddenSource).error.code, 'SESSION_REQUIRED');
    const forbiddenSnapshotDirectory = await request(running.url + 'api/snapshots/open-directory', {
      method: 'POST', body: {},
    });
    assert.strictEqual(forbiddenSnapshotDirectory.status, 403);
    assert.strictEqual(json(forbiddenSnapshotDirectory).error.code, 'SESSION_REQUIRED');
    const forbiddenDiscovery = await request(running.url + 'api/updates/source/discover', {
      method: 'POST', body: { name: 'beta' },
    });
    assert.strictEqual(forbiddenDiscovery.status, 403);
    assert.strictEqual(json(forbiddenDiscovery).error.code, 'SESSION_REQUIRED');
    const forbiddenPopularDiscovery = await request(running.url + 'api/updates/source/popular/discover', {
      method: 'POST', body: { limit: 10 },
    });
    assert.strictEqual(forbiddenPopularDiscovery.status, 403);
    assert.strictEqual(json(forbiddenPopularDiscovery).error.code, 'SESSION_REQUIRED');

    const headers = { 'X-ASH-Session': session };
    const individualUpdateCheck = await request(running.url + 'api/updates/check', {
      method: 'POST', headers, body: { name: 'alpha' },
    });
    assert.strictEqual(individualUpdateCheck.status, 200, individualUpdateCheck.text);
    const individualUpdate = json(individualUpdateCheck);
    assert.strictEqual(individualUpdate.skill.name, 'alpha');
    assert.strictEqual(individualUpdate.skill.status, 'update-available');
    assert.strictEqual(individualUpdate.summary.update_available, 1);

    const prunePreviewResponse = await request(running.url + 'api/transactions/prune/preview', {
      method: 'POST', headers, body: {},
    });
    assert.strictEqual(prunePreviewResponse.status, 200, prunePreviewResponse.text);
    const prunePreview = json(prunePreviewResponse);
    assert.strictEqual(prunePreview.action_count, 1);
    const refusedPrune = await request(running.url + 'api/transactions/prune/apply', {
      method: 'POST', headers, body: { plan_id: prunePreview.plan_id, confirm: false },
    });
    assert.strictEqual(refusedPrune.status, 400, refusedPrune.text);
    const appliedPrune = await request(running.url + 'api/transactions/prune/apply', {
      method: 'POST', headers, body: { plan_id: prunePreview.plan_id, confirm: true },
    });
    assert.strictEqual(appliedPrune.status, 200, appliedPrune.text);
    assert.strictEqual(json(appliedPrune).status, 'pruned');
    assert.strictEqual(fs.existsSync(current.obsoleteTransaction), false);
    const updateCheckResponse = await request(running.url + 'api/updates/check', {
      method: 'POST', headers, body: {},
    });
    assert.strictEqual(updateCheckResponse.status, 200, updateCheckResponse.text);
    assert.strictEqual(json(updateCheckResponse).summary.update_available, 1);
    const updatePreviewResponse = await request(running.url + 'api/updates/preview', {
      method: 'POST', headers, body: { name: 'alpha' },
    });
    assert.strictEqual(updatePreviewResponse.status, 200, updatePreviewResponse.text);
    const updatePreview = json(updatePreviewResponse);
    assert(updatePreview.plan_id);
    const updateAppliedResponse = await request(running.url + 'api/updates/apply', {
      method: 'POST', headers, body: { plan_id: updatePreview.plan_id, confirm: true },
    });
    assert.strictEqual(updateAppliedResponse.status, 200, updateAppliedResponse.text);
    assert.strictEqual(json(updateAppliedResponse).status, 'updated');
    const updateRollbackPreviewResponse = await request(running.url + 'api/updates/rollback/preview', {
      method: 'POST', headers, body: {},
    });
    assert.strictEqual(updateRollbackPreviewResponse.status, 200, updateRollbackPreviewResponse.text);
    const updateRollbackPreview = json(updateRollbackPreviewResponse);
    const updateRollbackAppliedResponse = await request(running.url + 'api/updates/rollback/apply', {
      method: 'POST', headers, body: { rollback_id: updateRollbackPreview.rollback_id, confirm: true },
    });
    assert.strictEqual(updateRollbackAppliedResponse.status, 200, updateRollbackAppliedResponse.text);
    assert.strictEqual(json(updateRollbackAppliedResponse).status, 'rolled_back');

    const discoveryResponse = await request(running.url + 'api/updates/source/discover', {
      method: 'POST', headers, body: { name: 'beta' },
    });
    assert.strictEqual(discoveryResponse.status, 200, discoveryResponse.text);
    const discovery = json(discoveryResponse);
    assert.strictEqual(discovery.state, 'ok');
    assert.strictEqual(discovery.candidates.length, 2);
    assert.strictEqual(discovery.candidates[0].skills_url, 'https://skills.sh/example/ui-skills/beta');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(discovery, 'plan_id'), false);

    const popularDiscoveryResponse = await request(running.url + 'api/updates/source/popular/discover', {
      method: 'POST', headers, body: { limit: 10 },
    });
    assert.strictEqual(popularDiscoveryResponse.status, 200, popularDiscoveryResponse.text);
    const popularDiscovery = json(popularDiscoveryResponse);
    assert.strictEqual(popularDiscovery.selected_count, 1);
    const popularPreviewResponse = await request(running.url + 'api/updates/source/popular/preview', {
      method: 'POST', headers, body: { discovery_id: popularDiscovery.discovery_id, names: ['beta'] },
    });
    assert.strictEqual(popularPreviewResponse.status, 200, popularPreviewResponse.text);
    const popularPreview = json(popularPreviewResponse);
    assert(popularPreview.plan_id);
    assert.strictEqual(popularPreview.ready_count, 1);

    const sourcePreviewResponse = await request(running.url + 'api/updates/source/preview', {
      method: 'POST', headers, body: { name: 'beta', skills_url: 'https://skills.sh/example/ui-skills/beta' },
    });
    assert.strictEqual(sourcePreviewResponse.status, 200, sourcePreviewResponse.text);
    const sourcePreview = json(sourcePreviewResponse);
    assert.strictEqual(sourcePreview.operation, 'link-source');
    assert.strictEqual(sourcePreview.source_id, 'example/ui-skills/beta');
    assert(sourcePreview.actions.some(function linked(item) { return item.kind === 'skill_source_link'; }));
    const sourceAppliedResponse = await request(running.url + 'api/updates/source/apply', {
      method: 'POST', headers, body: { plan_id: sourcePreview.plan_id, confirm: true },
    });
    assert.strictEqual(sourceAppliedResponse.status, 200, sourceAppliedResponse.text);
    assert.strictEqual(json(sourceAppliedResponse).status, 'source_linked');
    assert.strictEqual(json(sourceAppliedResponse).skill.update.status, 'up-to-date');
    assert.strictEqual(json(sourceAppliedResponse).skill.update.source_origin.label, 'skills.sh 接管');
    assert.strictEqual(json(sourceAppliedResponse).skill.update.source_links[0].url, 'https://skills.sh/example/ui-skills/beta');
    const sameSourceResponse = await request(running.url + 'api/updates/source/preview', {
      method: 'POST', headers, body: { name: 'beta', skills_url: 'https://skills.sh/example/ui-skills/beta' },
    });
    assert.strictEqual(sameSourceResponse.status, 400, sameSourceResponse.text);
    assert.strictEqual(json(sameSourceResponse).error.code, 'INVALID_UPDATE_SOURCE');
    const retargetPreviewResponse = await request(running.url + 'api/updates/source/preview', {
      method: 'POST', headers, body: { name: 'beta', skills_url: 'https://skills.sh/second/ui-skills/beta' },
    });
    assert.strictEqual(retargetPreviewResponse.status, 200, retargetPreviewResponse.text);
    const retargetPreview = json(retargetPreviewResponse);
    assert.strictEqual(retargetPreview.operation, 'retarget-source');
    const retargetAppliedResponse = await request(running.url + 'api/updates/source/apply', {
      method: 'POST', headers, body: { plan_id: retargetPreview.plan_id, confirm: true },
    });
    assert.strictEqual(retargetAppliedResponse.status, 200, retargetAppliedResponse.text);
    assert.strictEqual(json(retargetAppliedResponse).status, 'source_retargeted');
    assert.strictEqual(json(retargetAppliedResponse).skill.update.source_links[0].url, 'https://skills.sh/second/ui-skills/beta');
    const retargetRollbackPreviewResponse = await request(running.url + 'api/updates/rollback/preview', {
      method: 'POST', headers, body: {},
    });
    const retargetRollbackAppliedResponse = await request(running.url + 'api/updates/rollback/apply', {
      method: 'POST', headers, body: { rollback_id: json(retargetRollbackPreviewResponse).rollback_id, confirm: true },
    });
    assert.strictEqual(retargetRollbackAppliedResponse.status, 200, retargetRollbackAppliedResponse.text);
    assert.strictEqual(json(retargetRollbackAppliedResponse).skill.update.source_links[0].url, 'https://skills.sh/example/ui-skills/beta');
    const reusedSourcePlan = await request(running.url + 'api/updates/source/apply', {
      method: 'POST', headers, body: { plan_id: sourcePreview.plan_id, confirm: true },
    });
    assert.strictEqual(reusedSourcePlan.status, 409, reusedSourcePlan.text);
    assert.strictEqual(json(reusedSourcePlan).error.code, 'PREVIEW_REQUIRED');
    const sourceRollbackPreviewResponse = await request(running.url + 'api/updates/rollback/preview', {
      method: 'POST', headers, body: {},
    });
    const sourceRollbackPreview = json(sourceRollbackPreviewResponse);
    const sourceRollbackAppliedResponse = await request(running.url + 'api/updates/rollback/apply', {
      method: 'POST', headers, body: { rollback_id: sourceRollbackPreview.rollback_id, confirm: true },
    });
    assert.strictEqual(sourceRollbackAppliedResponse.status, 200, sourceRollbackAppliedResponse.text);
    assert.strictEqual(json(sourceRollbackAppliedResponse).skill.update.status, 'unmanaged');

    const previewResponse = await request(running.url + 'api/repair/preview', {
      method: 'POST', headers, body: { scope: 'all' },
    });
    assert.strictEqual(previewResponse.status, 200);
    const preview = json(previewResponse);
    assert.strictEqual(preview.action_count, 1);
    assert(preview.plan_id);
    assert.strictEqual(fs.existsSync(current.settings.codexAgentsFile), false);

    const refused = await request(running.url + 'api/repair/apply', {
      method: 'POST', headers, body: { plan_id: preview.plan_id, confirm: false },
    });
    assert.strictEqual(refused.status, 400);
    assert.strictEqual(json(refused).error.code, 'CONFIRMATION_REQUIRED');

    const applied = await request(running.url + 'api/repair/apply', {
      method: 'POST', headers, body: { plan_id: preview.plan_id, confirm: true },
    });
    assert.strictEqual(applied.status, 200, applied.text);
    assert.strictEqual(json(applied).status, 'completed');
    assert(fs.readFileSync(current.settings.codexAgentsFile, 'utf8').includes('ASH-managed user Skill creation'));

    const rollbackPreview = await request(running.url + 'api/rollback/preview', {
      method: 'POST', headers, body: { selector: 'latest' },
    });
    assert.strictEqual(rollbackPreview.status, 200, rollbackPreview.text);
    const rollback = json(rollbackPreview);
    const rolledBack = await request(running.url + 'api/rollback/apply', {
      method: 'POST', headers, body: { rollback_id: rollback.rollback_id, confirm: true },
    });
    assert.strictEqual(rolledBack.status, 200, rolledBack.text);
    assert.strictEqual(json(rolledBack).status, 'rolled_back');
    assert.strictEqual(fs.existsSync(current.settings.codexAgentsFile), false);

    const customRoot = path.join(current.root, 'http-team-skills');
    writeSkill(path.join(customRoot, 'gamma'), 'gamma', 'Gamma from the HTTP scan root.');
    const rootPreviewResponse = await request(running.url + 'api/libraries/preview', {
      method: 'POST', headers, body: { action: 'add', path: customRoot, name: 'HTTP team skills' },
    });
    assert.strictEqual(rootPreviewResponse.status, 200, rootPreviewResponse.text);
    const rootPreview = json(rootPreviewResponse);
    const rootApplied = await request(running.url + 'api/libraries/apply', {
      method: 'POST', headers, body: { plan_id: rootPreview.plan_id, confirm: true },
    });
    assert.strictEqual(rootApplied.status, 200, rootApplied.text);
    assert.strictEqual(json(rootApplied).overview.libraries.length, 2);
    const customDetail = await request(running.url + 'api/skills/' + encodeURIComponent(rootPreview.root.id) + '/gamma');
    assert.strictEqual(customDetail.status, 200, customDetail.text);
    assert.strictEqual(json(customDetail).library_mode, 'observe');

    const createPreviewResponse = await request(running.url + 'api/skills/create/preview', {
      method: 'POST', headers, body: { name: 'delta', description: 'Delta from the page API.' },
    });
    const createPreview = json(createPreviewResponse);
    const createApplied = await request(running.url + 'api/skills/create/apply', {
      method: 'POST', headers, body: { plan_id: createPreview.plan_id, confirm: true },
    });
    assert.strictEqual(createApplied.status, 200, createApplied.text);
    assert.strictEqual(json(createApplied).status, 'created');

    const descriptionPreviewResponse = await request(running.url + 'api/skills/description/preview', {
      method: 'POST', headers, body: { name: 'delta', library_id: ash.MANAGED_LIBRARY_ID, description: 'Updated through the page API.' },
    });
    const descriptionPreview = json(descriptionPreviewResponse);
    const descriptionApplied = await request(running.url + 'api/skills/description/apply', {
      method: 'POST', headers, body: { plan_id: descriptionPreview.plan_id, confirm: true },
    });
    assert.strictEqual(descriptionApplied.status, 200, descriptionApplied.text);
    assert.strictEqual(json(descriptionApplied).skill.description, 'Updated through the page API.');

    const packagePreviewResponse = await request(running.url + 'api/packages/preview', {
      method: 'POST', headers, body: { name: 'delta', library_id: ash.MANAGED_LIBRARY_ID },
    });
    const packagePreview = json(packagePreviewResponse);
    const packageApplied = await request(running.url + 'api/packages/apply', {
      method: 'POST', headers, body: { plan_id: packagePreview.plan_id, confirm: true },
    });
    assert.strictEqual(packageApplied.status, 200, packageApplied.text);
    assert(fs.existsSync(json(packageApplied).output));

    const snapshotPreviewResponse = await request(running.url + 'api/snapshots/create/preview', {
      method: 'POST', headers, body: {},
    });
    const snapshotPreview = json(snapshotPreviewResponse);
    const snapshotApplied = await request(running.url + 'api/snapshots/create/apply', {
      method: 'POST', headers, body: { plan_id: snapshotPreview.plan_id, confirm: true },
    });
    assert.strictEqual(snapshotApplied.status, 200, snapshotApplied.text);
    const snapshot = json(snapshotApplied).snapshot;
    const openedSnapshotDirectoryResponse = await request(running.url + 'api/snapshots/open-directory', {
      method: 'POST', headers, body: {},
    });
    assert.strictEqual(openedSnapshotDirectoryResponse.status, 200, openedSnapshotDirectoryResponse.text);
    assert.strictEqual(json(openedSnapshotDirectoryResponse).status, 'opened');
    assert.strictEqual(openedSnapshotDirectory, current.settings.stateDir + '/snapshots');
    const verified = await request(running.url + 'api/snapshots/verify', {
      method: 'POST', headers, body: { snapshot: snapshot.snapshot_id },
    });
    assert.strictEqual(verified.status, 200, verified.text);
    assert.strictEqual(json(verified).verification.ok, true);

    const removalPreviewResponse = await request(running.url + 'api/skills/removal/preview', {
      method: 'POST', headers, body: { name: 'alpha', library_id: ash.MANAGED_LIBRARY_ID },
    });
    assert.strictEqual(removalPreviewResponse.status, 200, removalPreviewResponse.text);
    const removalPlan = json(removalPreviewResponse);
    assert.strictEqual(removalPlan.ownership, 'installer-lock');
    assert(removalPlan.actions.some(function lockAction(item) { return item.kind === 'installer_lock_entry_remove'; }));
    const removalAppliedResponse = await request(running.url + 'api/skills/removal/apply', {
      method: 'POST', headers, body: { plan_id: removalPlan.plan_id, confirm: true, confirmation_name: 'alpha' },
    });
    assert.strictEqual(removalAppliedResponse.status, 200, removalAppliedResponse.text);
    assert.strictEqual(json(removalAppliedResponse).status, 'removed');
    assert.strictEqual(fs.existsSync(path.join(current.library, 'alpha')), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.alpha, undefined);
    const removalRollbackPreviewResponse = await request(running.url + 'api/skills/removal/rollback/preview', {
      method: 'POST', headers, body: {},
    });
    assert.strictEqual(removalRollbackPreviewResponse.status, 200, removalRollbackPreviewResponse.text);
    const removalRollbackAppliedResponse = await request(running.url + 'api/skills/removal/rollback/apply', {
      method: 'POST', headers, body: { rollback_id: json(removalRollbackPreviewResponse).rollback_id, confirm: true },
    });
    assert.strictEqual(removalRollbackAppliedResponse.status, 200, removalRollbackAppliedResponse.text);
    assert.strictEqual(json(removalRollbackAppliedResponse).status, 'restored');
    assert(fs.existsSync(path.join(current.library, 'alpha', 'SKILL.md')));
    assert(JSON.parse(fs.readFileSync(current.lockPath, 'utf8')).skills.alpha);

    const purgeRemovalPreviewResponse = await request(running.url + 'api/skills/removal/preview', {
      method: 'POST', headers, body: { name: 'delta', library_id: ash.MANAGED_LIBRARY_ID },
    });
    const purgeRemovalAppliedResponse = await request(running.url + 'api/skills/removal/apply', {
      method: 'POST', headers, body: { plan_id: json(purgeRemovalPreviewResponse).plan_id, confirm: true, confirmation_name: 'delta' },
    });
    assert.strictEqual(purgeRemovalAppliedResponse.status, 200, purgeRemovalAppliedResponse.text);
    const removalOverviewResponse = await request(running.url + 'api/overview');
    const deltaRemoval = json(removalOverviewResponse).removals.find(function delta(item) { return item.name === 'delta'; });
    assert(deltaRemoval);
    const purgePreviewResponse = await request(running.url + 'api/skills/removal/purge/preview', {
      method: 'POST', headers, body: { transaction_id: deltaRemoval.transaction_id },
    });
    assert.strictEqual(purgePreviewResponse.status, 200, purgePreviewResponse.text);
    assert.strictEqual(json(purgePreviewResponse).confirmation_name, 'delta');
    const purgeAppliedResponse = await request(running.url + 'api/skills/removal/purge/apply', {
      method: 'POST', headers, body: { plan_id: json(purgePreviewResponse).plan_id, confirm: true, confirmation_name: 'delta' },
    });
    assert.strictEqual(purgeAppliedResponse.status, 200, purgeAppliedResponse.text);
    assert.strictEqual(json(purgeAppliedResponse).status, 'purged');
    assert.strictEqual(fs.existsSync(path.join(current.settings.stateDir, 'removals', deltaRemoval.transaction_id)), false);
    assert.strictEqual(fs.existsSync(path.join(current.library, 'delta')), false);

    ['http-bulk-one', 'http-bulk-two'].forEach(function addBulkSkill(name) {
      writeSkill(path.join(current.library, name), name, 'Disposable HTTP bulk purge probe.');
    });
    for (const name of ['http-bulk-one', 'http-bulk-two']) {
      const previewResponse = await request(running.url + 'api/skills/removal/preview', {
        method: 'POST', headers, body: { name, library_id: ash.MANAGED_LIBRARY_ID },
      });
      const appliedResponse = await request(running.url + 'api/skills/removal/apply', {
        method: 'POST', headers, body: { plan_id: json(previewResponse).plan_id, confirm: true, confirmation_name: name },
      });
      assert.strictEqual(appliedResponse.status, 200, appliedResponse.text);
    }
    const bulkPurgePreviewResponse = await request(running.url + 'api/skills/removal/bulk-purge/preview', {
      method: 'POST', headers, body: {},
    });
    assert.strictEqual(bulkPurgePreviewResponse.status, 200, bulkPurgePreviewResponse.text);
    assert.strictEqual(json(bulkPurgePreviewResponse).confirmation_text, '永久删除全部 2 个 Skill');
    const bulkPurgeAppliedResponse = await request(running.url + 'api/skills/removal/bulk-purge/apply', {
      method: 'POST', headers, body: {
        plan_id: json(bulkPurgePreviewResponse).plan_id,
        confirm: true,
        confirmation_text: json(bulkPurgePreviewResponse).confirmation_text,
      },
    });
    assert.strictEqual(bulkPurgeAppliedResponse.status, 200, bulkPurgeAppliedResponse.text);
    assert.strictEqual(json(bulkPurgeAppliedResponse).status, 'purged');
    assert.strictEqual(json(bulkPurgeAppliedResponse).deleted_count, 2);
    process.stdout.write('ok - localhost UI serves assets and guards write APIs with a page session\n');
  } finally {
    if (running) await running.close();
    current.cleanup();
  }
}

async function main() {
  await testServiceSafety();
  await testSingleSourceFailureRedactsThrownUiError();
  await testPopularBatchKeepsSequentialSuccessesAndWritesLogs();
  await testPopularBatchReturnsPartialAndContinues();
  await testPopularBatchClassifiesPreparationFailuresAndContinues();
  await testPopularBatchAbortsWhenAutomaticRollbackFails();
  await testPopularBatchKeepsTransactionSuccessWhenPostWorkFails();
  await testPopularApplyProgressIsVisibleWhileItemRuns();
  await testPopularPreviewReportsSkippedItemsWithoutSecrets();
  await testHttpServer();
  process.stdout.write('\n10/10 UI tests passed\n');
}

main().catch(function failed(error) {
  process.stderr.write('not ok - ' + (error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
