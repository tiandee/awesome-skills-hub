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
        return { path: sourceCandidate, revision: 'beta-source-commit', folderHash: '3'.repeat(40), cleanup: function cleanup() {} };
      }
      return { path: updateCandidate, revision: 'alpha-new-commit', folderHash: '2'.repeat(40), cleanup: function cleanup() {} };
    }
  };
  let skillsShSearchCalls = 0;
  const skillsShSearchClient = {
    search: async function search(query) {
      skillsShSearchCalls += 1;
      assert.strictEqual(query, 'beta');
      return {
        contract: 'undocumented-api-search',
        candidates: [
          { id: 'second/ui-skills/beta', name: 'beta', slug: 'beta', source: 'second/ui-skills', installs: 8, skills_url: 'https://skills.sh/second/ui-skills/beta', source_url: 'https://github.com/second/ui-skills.git' },
          { id: 'example/ui-skills/beta', name: 'beta', slug: 'beta', source: 'example/ui-skills', installs: 24, skills_url: 'https://skills.sh/example/ui-skills/beta', source_url: 'https://github.com/example/ui-skills.git' },
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
    const service = ash.createUiService(current.settings, {
      tokenFactory: function nextToken() { token += 1; return 'token-' + token; },
      dateFactory: function fixedDate() { return new Date('2026-08-20T00:00:00.000Z'); },
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: current.skillsShSearchClient,
    });
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
    await assert.rejects(
      service.discoverSkillSource({ name: 'alpha' }),
      function matching(error) { return error.code === 'SOURCE_DISCOVERY_NOT_AVAILABLE'; },
    );
    const unavailableService = ash.createUiService(current.settings, {
      updateSourceClient: current.updateSourceClient,
      skillsShSearchClient: { search: async function unavailable() { throw new Error('provider unavailable'); } },
    });
    const unavailableDiscovery = await unavailableService.discoverSkillSource({ name: 'beta' });
    assert.strictEqual(unavailableDiscovery.state, 'unavailable');
    assert.strictEqual(unavailableDiscovery.manual_entry, true);
    assert.strictEqual(unavailableDiscovery.candidates.length, 0);

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
    assert.strictEqual(historyBackedUpdate.status, 'checkable');
    assert.strictEqual(historyBackedUpdate.display.label, '待检查');
    assert.strictEqual(historyBackedUpdate.source_origin.label, 'skills.sh 接管');
    assert.strictEqual(historyBackedUpdate.source_links[0].url, 'https://skills.sh/example/ui-skills/beta');
    const updateHistoryRoot = path.join(current.settings.stateDir, 'updates');
    const hiddenUpdateHistory = path.join(current.settings.stateDir, 'updates.withheld-for-test');
    fs.renameSync(updateHistoryRoot, hiddenUpdateHistory);
    try {
      const noHistoryUpdate = ash.createUiService(current.settings, { updateSourceClient: current.updateSourceClient }).skillDetail('beta').update;
      assert.strictEqual(noHistoryUpdate.status, 'checkable');
      assert.strictEqual(noHistoryUpdate.source_origin.label, 'GitHub 来源');
      assert.deepStrictEqual(noHistoryUpdate.source_links.map(function kind(item) { return item.kind; }), ['github-repository', 'github-skill']);
    } finally {
      fs.renameSync(hiddenUpdateHistory, updateHistoryRoot);
    }
    await assert.rejects(
      service.discoverSkillSource({ name: 'beta' }),
      function matching(error) { return error.code === 'SOURCE_DISCOVERY_NOT_AVAILABLE'; },
    );
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

async function testHttpServer() {
  const current = fixture();
  let running;
  try {
    running = await ash.startUiServer(current.settings, {
      port: 0,
      open: false,
      serviceOptions: {
        dateFactory: function fixedDate() { return new Date('2026-08-20T00:00:00.000Z'); },
        updateSourceClient: current.updateSourceClient,
        skillsShSearchClient: current.skillsShSearchClient,
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
    const forbiddenSource = await request(running.url + 'api/updates/source/preview', {
      method: 'POST', body: { name: 'beta', source_url: 'https://github.com/example/ui-skills.git', skill_path: 'skills/beta' },
    });
    assert.strictEqual(forbiddenSource.status, 403);
    assert.strictEqual(json(forbiddenSource).error.code, 'SESSION_REQUIRED');
    const forbiddenDiscovery = await request(running.url + 'api/updates/source/discover', {
      method: 'POST', body: { name: 'beta' },
    });
    assert.strictEqual(forbiddenDiscovery.status, 403);
    assert.strictEqual(json(forbiddenDiscovery).error.code, 'SESSION_REQUIRED');

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
    const verified = await request(running.url + 'api/snapshots/verify', {
      method: 'POST', headers, body: { snapshot: snapshot.snapshot_id },
    });
    assert.strictEqual(verified.status, 200, verified.text);
    assert.strictEqual(json(verified).verification.ok, true);
    process.stdout.write('ok - localhost UI serves assets and guards write APIs with a page session\n');
  } finally {
    if (running) await running.close();
    current.cleanup();
  }
}

async function main() {
  await testServiceSafety();
  await testHttpServer();
  process.stdout.write('\n2/2 UI tests passed\n');
}

main().catch(function failed(error) {
  process.stderr.write('not ok - ' + (error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
