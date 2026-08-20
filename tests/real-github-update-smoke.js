'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ash = require('../lib/control-plane');

function removeTree(target) {
  if (!ash.lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { fs.unlinkSync(target); return; }
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function copyTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination, process.platform === 'win32' ? 'junction' : undefined);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { mode: stat.mode & 0o777 });
    fs.readdirSync(source).sort().forEach(function child(name) { copyTree(path.join(source, name), path.join(destination, name)); });
    return;
  }
  if (!stat.isFile()) throw new Error('unsupported fixture entry: ' + source);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o777);
}

function rawTreeDigest(root) {
  const records = [];
  function visit(selected, relative) {
    const stat = fs.lstatSync(selected);
    if (stat.isSymbolicLink()) {
      records.push({ path: relative, type: 'symlink', target: fs.readlinkSync(selected) });
      return;
    }
    if (stat.isDirectory()) {
      records.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
      fs.readdirSync(selected).sort().forEach(function child(name) { visit(path.join(selected, name), relative ? relative + '/' + name : name); });
      return;
    }
    records.push({ path: relative, type: 'file', mode: stat.mode & 0o777, sha256: ash.sha256(fs.readFileSync(selected)) });
  }
  visit(root, '');
  return ash.sha256(Buffer.from(JSON.stringify(records), 'utf8'));
}

async function main() {
  const name = String(process.env.ASH_REAL_SKILL_NAME || '');
  const skillsUrl = String(process.env.ASH_REAL_SKILLS_URL || '');
  const sourceUrl = String(process.env.ASH_REAL_SOURCE_URL || '');
  const skillPath = String(process.env.ASH_REAL_SKILL_PATH || '');
  const installedPath = String(process.env.ASH_REAL_INSTALLED_SKILL || '');
  if (!name || !installedPath || (!skillsUrl && (!sourceUrl || !skillPath))) {
    throw new Error('set ASH_REAL_SKILL_NAME, ASH_REAL_INSTALLED_SKILL, and either ASH_REAL_SKILLS_URL or both GitHub source variables');
  }
  const realLibrary = String(process.env.ASH_REAL_LIBRARY || path.dirname(installedPath));
  const realLockPath = String(process.env.ASH_REAL_LOCK || path.join(os.homedir(), '.agents', '.skill-lock.json'));
  const realLibraryBefore = rawTreeDigest(realLibrary);
  const realLockBefore = ash.sha256(fs.readFileSync(realLockPath));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-real-github-update-'));
  let report;
  try {
    const library = path.join(root, '.agents', 'skills');
    fs.mkdirSync(library, { recursive: true });
    const installedCopy = path.join(library, name);
    const installedSource = fs.lstatSync(installedPath).isSymbolicLink() ? fs.realpathSync(installedPath) : installedPath;
    copyTree(installedSource, installedCopy);
    fs.writeFileSync(path.join(installedCopy, 'ash-real-e2e-local.txt'), 'disposable local marker\n', 'utf8');
    const lockPath = path.join(root, '.agents', '.skill-lock.json');
    const originalLock = JSON.stringify({ version: 3, skills: {} }, null, 2) + '\n';
    fs.writeFileSync(lockPath, originalLock, { mode: 0o600 });
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
    const beforeDigest = rawTreeDigest(installedCopy);
    const sourceClient = ash.createGitSourceClient({
      env: {
        HOME: root,
        XDG_CONFIG_HOME: path.join(root, '.config'),
        XDG_CACHE_HOME: path.join(root, '.cache'),
      },
    });
    const preview = await ash.buildSkillSourcePreview(settings, Object.assign({ name }, skillsUrl
      ? { skills_url: skillsUrl }
      : { source_url: sourceUrl, skill_path: skillPath }), { sourceClient });
    assert.strictEqual(preview.operation, 'link-source');
    assert.strictEqual(preview.replace_content, true);
    assert(preview.diff.deleted.some(function marker(item) { return item.path === 'ash-real-e2e-local.txt'; }));
    const transaction = await ash.applySkillSource(settings, preview, { sourceClient });
    assert.strictEqual(ash.classifyUserSkillUpdates(settings).skills.find(function selected(item) { return item.name === name; }).status, 'checkable');
    const checked = await ash.checkUserSkillUpdates(settings, { sourceClient });
    const checkedSkill = checked.skills.find(function selected(item) { return item.name === name; });
    assert.strictEqual(checkedSkill.status, 'up-to-date');
    const rollback = ash.previewSkillUpdateRollback(settings, 'latest');
    ash.applySkillUpdateRollback(settings, rollback.transaction_id);
    assert.strictEqual(rawTreeDigest(installedCopy), beforeDigest);
    assert.strictEqual(fs.readFileSync(lockPath, 'utf8'), originalLock);
    assert.strictEqual(JSON.parse(fs.readFileSync(transaction, 'utf8')).status, 'rolled_back');
    report = {
      name,
      operation: preview.operation,
      preview_actions: preview.diff.action_count,
      latest_hash: preview.latest_hash,
      post_apply_status: checkedSkill.status,
      rollback: 'verified',
    };
  } finally {
    removeTree(root);
    assert.strictEqual(rawTreeDigest(realLibrary), realLibraryBefore);
    assert.strictEqual(ash.sha256(fs.readFileSync(realLockPath)), realLockBefore);
  }
  report.test_root_cleanup = 'verified';
  report.real_user_library_unchanged = 'verified';
  report.real_installer_lock_unchanged = 'verified';
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch(function failed(error) {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
