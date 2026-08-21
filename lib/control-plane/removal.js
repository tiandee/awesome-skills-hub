'use strict';

const fs = require('fs');
const path = require('path');

const { NAME_PATTERN } = require('./discovery');
const { atomicWrite, lexists, sha256, timestampId, writeJsonAtomic } = require('./util');

const REMOVAL_TRANSACTION_VERSION = 1;

function removeTree(target) {
  if (!lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  fs.readdirSync(target).forEach(function removeChild(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function copyRawTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination, process.platform === 'win32' ? 'junction' : undefined);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: false, mode: stat.mode & 0o777 });
    fs.readdirSync(source).forEach(function copyChild(name) {
      copyRawTree(path.join(source, name), path.join(destination, name));
    });
    return;
  }
  if (!stat.isFile()) throw new Error('unsupported Skill entry while moving to the recovery area: ' + source);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, stat.mode & 0o777);
}

function moveTree(source, destination) {
  try {
    fs.renameSync(source, destination);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }
  try {
    copyRawTree(source, destination);
    if (entryState(source).digest !== entryState(destination).digest) throw new Error('cross-device Skill recovery copy failed verification');
  } catch (error) {
    if (lexists(destination)) removeTree(destination);
    throw error;
  }
  try {
    removeTree(source);
  } catch (error) {
    error.ashMoveDestinationComplete = true;
    throw error;
  }
}

function recordEntry(selected, relativePath, records, summary) {
  const stat = fs.lstatSync(selected);
  const normalized = relativePath || '.';
  if (stat.isSymbolicLink()) {
    records.push({ path: normalized, type: 'symlink', target: fs.readlinkSync(selected) });
    summary.symlinks += 1;
    return;
  }
  if (stat.isDirectory()) {
    records.push({ path: normalized, type: 'directory', mode: stat.mode & 0o777 });
    fs.readdirSync(selected).sort().forEach(function child(name) {
      recordEntry(path.join(selected, name), relativePath ? path.join(relativePath, name) : name, records, summary);
    });
    return;
  }
  if (stat.isFile()) {
    const content = fs.readFileSync(selected);
    records.push({ path: normalized, type: 'file', mode: stat.mode & 0o777, bytes: content.length, sha256: sha256(content) });
    summary.files += 1;
    summary.bytes += content.length;
    return;
  }
  throw new Error('unsupported Skill entry: ' + selected);
}

function entryState(target) {
  if (!lexists(target)) return { exists: false, digest: null, type: 'missing', files: 0, symlinks: 0, bytes: 0 };
  const records = [];
  const summary = { files: 0, symlinks: 0, bytes: 0 };
  recordEntry(target, '', records, summary);
  return Object.assign({
    exists: true,
    type: fs.lstatSync(target).isSymbolicLink() ? 'symlink' : 'directory',
    digest: sha256(Buffer.from(JSON.stringify(records), 'utf8')),
  }, summary);
}

function entryDigest(entry) {
  return sha256(Buffer.from(JSON.stringify(entry === undefined ? null : entry), 'utf8'));
}

function readSupportedLock(settings) {
  if (!lexists(settings.agentsLock)) {
    return { exists: false, content: null, payload: null, hash: null };
  }
  const content = fs.readFileSync(settings.agentsLock);
  let payload;
  try { payload = JSON.parse(content.toString('utf8')); } catch (error) {
    throw new Error('Agents installer lock is invalid JSON');
  }
  if (!payload || payload.version !== 3 || !payload.skills || typeof payload.skills !== 'object' || Array.isArray(payload.skills)) {
    throw new Error('Agents installer lock is not a supported v3 lock file');
  }
  return { exists: true, content, payload, hash: sha256(content) };
}

function removalTransactionRoot(settings) {
  return path.join(settings.stateDir, 'removals');
}

function removalPlanDigest(plan) {
  return sha256(Buffer.from(JSON.stringify({
    name: plan.name,
    path: plan.path,
    mode: plan.mode,
    ownership: plan.ownership,
    target_state: plan.target_state,
    lock_entry_hash: plan.lock_entry_hash,
  }), 'utf8'));
}

function buildSkillRemovalPlan(settings, input) {
  const request = input || {};
  const name = String(request.name || '').trim();
  if (!NAME_PATTERN.test(name)) throw new Error('invalid user Skill name: ' + name);
  const target = path.join(settings.libraryRoot, name);
  if (path.dirname(target) !== path.resolve(settings.libraryRoot)) throw new Error('Skill removal target escapes the managed user library');
  const targetState = entryState(target);
  if (!targetState.exists) throw new Error('unknown installed user Skill: ' + name);
  if (!fs.existsSync(path.join(target, 'SKILL.md'))) throw new Error('managed entry is not a readable Skill: ' + name);
  const lock = readSupportedLock(settings);
  const lockEntry = lock.exists ? lock.payload.skills[name] : undefined;
  const mode = targetState.type === 'symlink' ? 'unlink' : 'quarantine';
  const ownership = lockEntry ? 'installer-lock' : mode === 'unlink' ? 'git-link' : 'manual';
  const actions = [{
    kind: mode === 'unlink' ? 'skill_link_remove' : 'skill_quarantine',
    path: target,
    description: mode === 'unlink'
      ? '解除用户库软链接 ' + target + '；链接源目录保持不变'
      : '将用户 Skill 移入 ASH 可恢复区 ' + target,
  }];
  if (lockEntry) {
    actions.push({
      kind: 'installer_lock_entry_remove',
      path: settings.agentsLock,
      description: '移除安装器锁条目 ' + name + '；其他锁条目保持不变',
    });
  }
  return {
    name,
    path: target,
    mode,
    ownership,
    target_state: targetState,
    lock_entry: lockEntry || null,
    lock_entry_hash: entryDigest(lockEntry),
    actions,
    recoverable: true,
  };
}

function writeTransaction(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

function safeTransactionSelector(value) {
  const selected = String(value || '');
  if (!selected || selected === '.' || selected === '..' || path.basename(selected) !== selected || !/^[A-Za-z0-9._-]+$/.test(selected)) {
    throw new Error('invalid Skill removal transaction id');
  }
  return selected;
}

function validateRemovalTransaction(settings, transactionFile, payload) {
  const transactionPath = path.dirname(transactionFile);
  const root = removalTransactionRoot(settings);
  if (!payload || payload.version !== REMOVAL_TRANSACTION_VERSION || payload.operation !== 'remove-skill') {
    throw new Error('unsupported Skill removal transaction: ' + path.basename(transactionPath));
  }
  if (!NAME_PATTERN.test(String(payload.name || '')) || path.dirname(transactionPath) !== root ||
      path.basename(transactionPath) !== payload.id || !fs.existsSync(transactionPath) ||
      !fs.lstatSync(transactionPath).isDirectory() || fs.lstatSync(transactionPath).isSymbolicLink()) {
    throw new Error('invalid Skill removal transaction metadata: ' + path.basename(transactionPath));
  }
  if (payload.path !== path.join(settings.libraryRoot, payload.name) ||
      payload.backup_path !== path.join(transactionPath, 'removed-skill') ||
      !payload.target_state || typeof payload.target_state.digest !== 'string') {
    throw new Error('Skill removal transaction paths or target state are invalid: ' + payload.id);
  }
  return transactionPath;
}

function applySkillRemoval(settings, plan) {
  const fresh = buildSkillRemovalPlan(settings, { name: plan.name });
  if (removalPlanDigest(fresh) !== removalPlanDigest(plan)) throw new Error('Skill removal preview is stale');
  const id = timestampId();
  const transactionDir = path.join(removalTransactionRoot(settings), id);
  const transactionFile = path.join(transactionDir, 'transaction.json');
  const backupPath = path.join(transactionDir, 'removed-skill');
  const lockBackup = path.join(transactionDir, 'skill-lock.before.json');
  const payload = {
    version: REMOVAL_TRANSACTION_VERSION,
    id,
    status: 'planned',
    operation: 'remove-skill',
    name: fresh.name,
    mode: fresh.mode,
    ownership: fresh.ownership,
    path: fresh.path,
    target_state: fresh.target_state,
    backup_path: backupPath,
    lock_path: settings.agentsLock,
    lock_backup: null,
    previous_lock_entry: fresh.lock_entry,
    previous_lock_entry_exists: Boolean(fresh.lock_entry),
    before_lock_sha256: null,
    after_lock_sha256: null,
    lock_written: false,
    created_at: new Date().toISOString(),
    completed_at: null,
    restored_at: null,
  };
  fs.mkdirSync(transactionDir, { recursive: true, mode: 0o700 });
  writeTransaction(transactionFile, payload);

  let moved = false;
  let lockWritten = false;
  let writtenLockHash = null;
  try {
    try {
      moveTree(fresh.path, backupPath);
      moved = true;
    } catch (error) {
      if (error && error.ashMoveDestinationComplete) moved = true;
      throw error;
    }
    payload.status = 'skill_moved';
    writeTransaction(transactionFile, payload);

    if (fresh.lock_entry) {
      const latestLock = readSupportedLock(settings);
      const latestEntry = latestLock.exists ? latestLock.payload.skills[fresh.name] : undefined;
      if (!latestLock.exists || entryDigest(latestEntry) !== fresh.lock_entry_hash) {
        throw new Error('target installer lock entry changed after preview');
      }
      fs.writeFileSync(lockBackup, latestLock.content, { mode: 0o600 });
      payload.lock_backup = lockBackup;
      payload.before_lock_sha256 = latestLock.hash;
      writeTransaction(transactionFile, payload);
      delete latestLock.payload.skills[fresh.name];
      const nextContent = Buffer.from(JSON.stringify(latestLock.payload, null, 2) + '\n', 'utf8');
      atomicWrite(settings.agentsLock, nextContent);
      lockWritten = true;
      writtenLockHash = sha256(nextContent);
      const written = readSupportedLock(settings);
      if (written.hash !== writtenLockHash || Object.prototype.hasOwnProperty.call(written.payload.skills, fresh.name)) {
        throw new Error('written installer lock failed readback verification');
      }
      payload.lock_written = true;
      payload.after_lock_sha256 = writtenLockHash;
    }
    payload.status = 'completed';
    payload.completed_at = new Date().toISOString();
    writeTransaction(transactionFile, payload);
    return transactionFile;
  } catch (error) {
    let rollbackError = null;
    try {
      if (lockWritten) {
        const currentLock = readSupportedLock(settings);
        if (currentLock.hash !== writtenLockHash) throw new Error('installer lock changed after removal; refusing automatic lock rollback');
        atomicWrite(settings.agentsLock, fs.readFileSync(lockBackup));
      }
      if (moved && lexists(backupPath)) {
        if (lexists(fresh.path)) removeTree(fresh.path);
        moveTree(backupPath, fresh.path);
      }
    } catch (caught) {
      rollbackError = caught;
    }
    payload.status = 'failed';
    payload.error = String(error && error.message || error);
    payload.rollback_failed = Boolean(rollbackError);
    if (rollbackError) payload.rollback_error = String(rollbackError.message || rollbackError);
    try { writeTransaction(transactionFile, payload); } catch (metadataError) { /* preserve original failure */ }
    if (rollbackError) throw new Error(payload.error + '; automatic rollback failed: ' + payload.rollback_error);
    throw error;
  }
}

function loadRemovalTransaction(settings, selector) {
  const root = removalTransactionRoot(settings);
  if (selector === undefined || selector === null || selector === 'latest') {
    if (!fs.existsSync(root)) throw new Error('no completed Skill removal transaction is available');
    const candidates = fs.readdirSync(root).sort().reverse();
    for (let index = 0; index < candidates.length; index += 1) {
      const transactionFile = path.join(root, candidates[index], 'transaction.json');
      if (!fs.existsSync(transactionFile)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
        validateRemovalTransaction(settings, transactionFile, payload);
        if (payload.status === 'completed') return { transactionFile, payload };
      } catch (error) { /* skip corrupted history while looking for a safe restore */ }
    }
    throw new Error('no completed Skill removal transaction is available');
  }
  const selected = safeTransactionSelector(selector);
  const transactionFile = path.join(root, selected, 'transaction.json');
  if (!fs.existsSync(transactionFile)) throw new Error('Skill removal transaction not found: ' + selector);
  const payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
  validateRemovalTransaction(settings, transactionFile, payload);
  return { transactionFile, payload };
}

function listSkillRemovals(settings) {
  const root = removalTransactionRoot(settings);
  if (!fs.existsSync(root)) return [];
  let lock = null;
  try { lock = readSupportedLock(settings); } catch (error) { /* expose installer restores as unavailable below */ }
  return fs.readdirSync(root).sort().reverse().map(function inspect(id) {
    let transaction;
    try { transaction = loadRemovalTransaction(settings, id); } catch (error) { return null; }
    const payload = transaction.payload;
    if (payload.status !== 'completed') return null;
    const backupState = entryState(payload.backup_path);
    const contentMatches = backupState.exists && backupState.digest === payload.target_state.digest;
    const destinationAvailable = !lexists(payload.path);
    const lockAvailable = !payload.previous_lock_entry_exists || Boolean(
      lock && lock.exists && lock.payload.skills[payload.name] === undefined,
    );
    return {
      transaction_id: payload.id,
      name: payload.name,
      mode: payload.mode,
      ownership: payload.ownership,
      path: payload.path,
      recovery_path: payload.backup_path,
      removed_at: payload.completed_at || payload.created_at,
      file_count: backupState.files,
      total_bytes: backupState.bytes,
      content_matches: contentMatches,
      destination_available: destinationAvailable,
      lock_available: lockAvailable,
      can_restore: contentMatches && destinationAvailable && lockAvailable,
      can_purge: true,
    };
  }).filter(Boolean);
}

function buildSkillRemovalPurgePlan(settings, selector) {
  const transaction = loadRemovalTransaction(settings, selector);
  const payload = transaction.payload;
  if (payload.status !== 'completed') throw new Error('Skill removal transaction is not in the recovery area: ' + payload.status);
  const transactionPath = validateRemovalTransaction(settings, transaction.transactionFile, payload);
  const transactionState = entryState(transactionPath);
  if (!transactionState.exists || transactionState.type !== 'directory') throw new Error('Skill removal transaction is unavailable');
  return {
    transaction_id: payload.id,
    transaction_path: transactionPath,
    name: payload.name,
    mode: payload.mode,
    recovery_path: payload.backup_path,
    target_state: payload.target_state,
    transaction_state: transactionState,
    actions: [{
      kind: 'skill_removal_purge',
      path: transactionPath,
      description: '永久删除可恢复 Skill ' + payload.name + ' 及其恢复事务 ' + transactionPath,
    }],
  };
}

function removalPurgePlanDigest(plan) {
  return sha256(Buffer.from(JSON.stringify({
    transaction_id: plan.transaction_id,
    transaction_path: plan.transaction_path,
    name: plan.name,
    transaction_state: plan.transaction_state,
  }), 'utf8'));
}

function applySkillRemovalPurge(settings, plan) {
  const fresh = buildSkillRemovalPurgePlan(settings, plan.transaction_id);
  if (removalPurgePlanDigest(fresh) !== removalPurgePlanDigest(plan)) throw new Error('Skill removal purge preview is stale');
  const root = removalTransactionRoot(settings);
  if (path.dirname(fresh.transaction_path) !== root || path.basename(fresh.transaction_path) !== fresh.transaction_id) {
    throw new Error('Skill removal purge target escapes the recovery root');
  }
  removeTree(fresh.transaction_path);
  if (lexists(fresh.transaction_path)) throw new Error('Skill removal transaction still exists after permanent deletion');
  return fresh.transaction_id;
}

function buildSkillRemovalBulkPurgePlan(settings) {
  const removals = listSkillRemovals(settings);
  if (!removals.length) throw new Error('the Skill recovery area is empty');
  const plans = removals.map(function plan(item) {
    return buildSkillRemovalPurgePlan(settings, item.transaction_id);
  });
  const count = plans.length;
  return {
    count,
    confirmation_text: '永久删除全部 ' + count + ' 个 Skill',
    transaction_ids: plans.map(function id(plan) { return plan.transaction_id; }),
    names: plans.map(function name(plan) { return plan.name; }),
    file_count: plans.reduce(function files(total, plan) { return total + plan.transaction_state.files; }, 0),
    total_bytes: plans.reduce(function bytes(total, plan) { return total + plan.transaction_state.bytes; }, 0),
    plans,
    actions: plans.map(function action(plan) {
      return {
        kind: 'skill_removal_bulk_purge',
        path: plan.transaction_path,
        description: '永久删除 ' + plan.name + ' 的可恢复内容与事务 ' + plan.transaction_id,
      };
    }),
  };
}

function removalBulkPurgePlanDigest(plan) {
  return sha256(Buffer.from(JSON.stringify({
    count: plan.count,
    confirmation_text: plan.confirmation_text,
    plans: plan.plans.map(function digest(item) { return removalPurgePlanDigest(item); }),
  }), 'utf8'));
}

function applySkillRemovalBulkPurge(settings, plan) {
  const fresh = buildSkillRemovalBulkPurgePlan(settings);
  if (removalBulkPurgePlanDigest(fresh) !== removalBulkPurgePlanDigest(plan)) {
    throw new Error('Skill recovery area changed after bulk purge preview');
  }
  const deleted = [];
  const failed = [];
  fresh.plans.forEach(function purge(item) {
    try {
      deleted.push(applySkillRemovalPurge(settings, item));
    } catch (error) {
      failed.push({ transaction_id: item.transaction_id, name: item.name, error: 'transaction could not be permanently deleted' });
    }
  });
  const failedIds = new Set(failed.map(function id(item) { return item.transaction_id; }));
  listSkillRemovals(settings).forEach(function remaining(item) {
    if (failedIds.has(item.transaction_id)) return;
    failed.push({ transaction_id: item.transaction_id, name: item.name, error: 'transaction remained or appeared during bulk deletion' });
  });
  return { deleted, failed };
}

function buildSkillRemovalRollback(settings, selector) {
  const transaction = loadRemovalTransaction(settings, selector || 'latest');
  const payload = transaction.payload;
  if (payload.status !== 'completed') throw new Error('Skill removal transaction is not restorable: ' + payload.status);
  if (lexists(payload.path)) throw new Error('Skill path is occupied; refusing to overwrite it during restore');
  if (!lexists(payload.backup_path) || entryState(payload.backup_path).digest !== payload.target_state.digest) {
    throw new Error('removed Skill recovery content is missing or changed');
  }
  let currentEntry;
  if (payload.previous_lock_entry_exists) {
    const lock = readSupportedLock(settings);
    if (!lock.exists) throw new Error('Agents installer lock is missing; refusing restore');
    currentEntry = lock.payload.skills[payload.name];
    if (currentEntry !== undefined) throw new Error('installer lock already contains this Skill; refusing restore');
  }
  return {
    transactionFile: transaction.transactionFile,
    transaction_id: payload.id,
    name: payload.name,
    path: payload.path,
    mode: payload.mode,
    target_state: payload.target_state,
    current_lock_entry_hash: entryDigest(currentEntry),
    actions: [{
      kind: payload.mode === 'unlink' ? 'skill_link_restore' : 'skill_restore',
      path: payload.path,
      description: (payload.mode === 'unlink' ? '恢复用户库软链接 ' : '从 ASH 可恢复区还原用户 Skill ') + payload.path,
    }].concat(payload.previous_lock_entry_exists ? [{
      kind: 'installer_lock_entry_restore',
      path: settings.agentsLock,
      description: '恢复安装器锁条目 ' + payload.name,
    }] : []),
  };
}

function removalRollbackDigest(preview) {
  return sha256(Buffer.from(JSON.stringify({
    transaction_hash: sha256(fs.readFileSync(preview.transactionFile)),
    target_state: preview.target_state,
    current_lock_entry_hash: preview.current_lock_entry_hash,
  }), 'utf8'));
}

function applySkillRemovalRollback(settings, preview) {
  const fresh = buildSkillRemovalRollback(settings, preview.transaction_id);
  if (removalRollbackDigest(fresh) !== removalRollbackDigest(preview)) throw new Error('Skill removal restore preview is stale');
  const transaction = loadRemovalTransaction(settings, fresh.transaction_id);
  const payload = transaction.payload;
  let restored = false;
  let lockWritten = false;
  let previousLockContent = null;
  try {
    try {
      moveTree(payload.backup_path, payload.path);
      restored = true;
    } catch (error) {
      if (error && error.ashMoveDestinationComplete) restored = true;
      throw error;
    }
    if (payload.previous_lock_entry_exists) {
      const lock = readSupportedLock(settings);
      if (lock.payload.skills[payload.name] !== undefined) throw new Error('installer lock entry appeared after preview');
      previousLockContent = lock.content;
      lock.payload.skills[payload.name] = payload.previous_lock_entry;
      const restoredLockContent = Buffer.from(JSON.stringify(lock.payload, null, 2) + '\n', 'utf8');
      atomicWrite(settings.agentsLock, restoredLockContent);
      lockWritten = true;
      const written = readSupportedLock(settings);
      if (written.hash !== sha256(restoredLockContent) ||
          entryDigest(written.payload.skills[payload.name]) !== entryDigest(payload.previous_lock_entry)) {
        throw new Error('restored installer lock failed readback verification');
      }
    }
    payload.status = 'restored';
    payload.restored_at = new Date().toISOString();
    writeTransaction(transaction.transactionFile, payload);
    return transaction.transactionFile;
  } catch (error) {
    let recoveryError = null;
    try {
      if (lockWritten && previousLockContent) atomicWrite(settings.agentsLock, previousLockContent);
      if (restored && lexists(payload.path)) {
        if (lexists(payload.backup_path)) removeTree(payload.backup_path);
        moveTree(payload.path, payload.backup_path);
      }
    } catch (caught) { recoveryError = caught; }
    if (recoveryError) throw new Error(String(error.message || error) + '; restore recovery failed: ' + String(recoveryError.message || recoveryError));
    throw error;
  }
}

function latestSkillRemovalRollback(settings) {
  try {
    const preview = buildSkillRemovalRollback(settings, 'latest');
    return {
      available: true,
      transaction_id: preview.transaction_id,
      name: preview.name,
      description: preview.actions[0].description,
    };
  } catch (error) {
    return { available: false, transaction_id: null, name: null, description: null };
  }
}

module.exports = {
  REMOVAL_TRANSACTION_VERSION,
  applySkillRemoval,
  applySkillRemovalBulkPurge,
  applySkillRemovalPurge,
  applySkillRemovalRollback,
  buildSkillRemovalPlan,
  buildSkillRemovalBulkPurgePlan,
  buildSkillRemovalPurgePlan,
  buildSkillRemovalRollback,
  entryState,
  latestSkillRemovalRollback,
  listSkillRemovals,
  loadRemovalTransaction,
  removalPlanDigest,
  removalBulkPurgePlanDigest,
  removalPurgePlanDigest,
  removalRollbackDigest,
  removalTransactionRoot,
};
