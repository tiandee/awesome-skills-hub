'use strict';

const fs = require('fs');
const path = require('path');

const { buildCodexGuidancePlan } = require('./codex-guidance');
const { atomicWrite, isDirectory, lexists, sha256, timestampId, writeJsonAtomic } = require('./util');

const SUPPORTED_SCOPES = new Set(['all', 'codex-guidance']);
const SUPPORTED_TRANSACTION_SCOPES = new Set(['codex-guidance', 'skill-metadata']);

function actionDescription(action) {
  if (action.scope === 'codex-guidance') return 'WRITE_CODEX_GUIDANCE ' + action.path;
  return 'WRITE_FILE ' + action.path;
}

function buildRepairPlan(settings, options) {
  const scope = (options && options.scope) || 'all';
  if (!SUPPORTED_SCOPES.has(scope)) throw new Error('repair scope must be all or codex-guidance');
  const plan = { scope, actions: [], conflicts: [] };
  if (scope === 'all' || scope === 'codex-guidance') {
    const guidance = buildCodexGuidancePlan(settings);
    plan.actions.push.apply(plan.actions, guidance.actions);
    plan.conflicts.push.apply(plan.conflicts, guidance.conflicts);
  }
  plan.actions.sort(function byPath(a, b) { return a.path.localeCompare(b.path); });
  return plan;
}

function supportedRepairTransaction(payload) {
  return Boolean(payload && payload.version === 2 && Array.isArray(payload.operations) && payload.operations.length &&
    payload.operations.every(function supported(operation) { return SUPPORTED_TRANSACTION_SCOPES.has(operation.scope); }));
}

function writeTransaction(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

function prepareTransaction(settings, plan) {
  const id = timestampId();
  const transactionDir = path.join(settings.stateDir, 'transactions', id);
  const transactionFile = path.join(transactionDir, 'transaction.json');
  const prepared = plan.actions.map(function prepare(action, index) {
    const beforeExists = lexists(action.path);
    let beforeContent = null;
    if (beforeExists) {
      const stat = fs.lstatSync(action.path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('repair target is no longer a regular file: ' + action.path);
      beforeContent = fs.readFileSync(action.path);
    }
    return {
      content: action.content,
      beforeContent,
      record: {
        kind: 'file_write',
        scope: action.scope,
        path: action.path,
        before_exists: beforeExists,
        before_hash: beforeContent ? sha256(beforeContent) : null,
        after_hash: sha256(action.content),
        backup_file: beforeContent ? 'backup-' + String(index).padStart(3, '0') + '.bin' : null,
      },
    };
  });
  fs.mkdirSync(path.dirname(transactionDir), { recursive: true, mode: 0o700 });
  fs.mkdirSync(transactionDir, { mode: 0o700 });
  prepared.forEach(function backup(item) {
    if (item.beforeContent) fs.writeFileSync(path.join(transactionDir, item.record.backup_file), item.beforeContent, { mode: 0o600 });
  });
  const payload = {
    version: 2,
    id,
    scope: plan.scope,
    status: 'prepared',
    created_at: new Date().toISOString(),
    applied_count: 0,
    operations: prepared.map(function operation(item) { return item.record; }),
  };
  writeTransaction(transactionFile, payload);
  return { transactionDir, transactionFile, payload, prepared };
}

function validateRollbackOperation(operation) {
  if (!lexists(operation.path)) throw new Error('cannot safely rollback missing file: ' + operation.path);
  const stat = fs.lstatSync(operation.path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('cannot safely rollback changed file type: ' + operation.path);
  if (sha256(fs.readFileSync(operation.path)) !== operation.after_hash) {
    throw new Error('cannot safely rollback user-modified file: ' + operation.path);
  }
}

function rollbackOperation(operation, transactionDir) {
  validateRollbackOperation(operation);
  if (operation.before_exists) {
    atomicWrite(operation.path, fs.readFileSync(path.join(transactionDir, operation.backup_file)));
  } else {
    fs.unlinkSync(operation.path);
  }
}

function applyRepair(settings, plan) {
  if (!plan.actions.length) throw new Error('repair plan has no actions');
  if (plan.conflicts.length) throw new Error('repair plan has conflicts');
  const transaction = prepareTransaction(settings, plan);
  transaction.payload.status = 'applying';
  writeTransaction(transaction.transactionFile, transaction.payload);
  try {
    transaction.prepared.forEach(function apply(item) {
      atomicWrite(item.record.path, item.content);
      transaction.payload.applied_count += 1;
      writeTransaction(transaction.transactionFile, transaction.payload);
    });
  } catch (error) {
    let rollbackError = null;
    try {
      transaction.payload.operations.slice(0, transaction.payload.applied_count).reverse().forEach(function rollback(operation) {
        rollbackOperation(operation, transaction.transactionDir);
      });
    } catch (caught) {
      rollbackError = caught;
    }
    transaction.payload.status = 'failed';
    transaction.payload.error = error.message;
    if (rollbackError) transaction.payload.rollback_error = rollbackError.message;
    writeTransaction(transaction.transactionFile, transaction.payload);
    if (rollbackError) {
      throw new Error('repair failed: ' + error.message + '; automatic rollback also failed: ' + rollbackError.message);
    }
    throw error;
  }
  transaction.payload.status = 'completed';
  transaction.payload.completed_at = new Date().toISOString();
  writeTransaction(transaction.transactionFile, transaction.payload);
  return transaction.transactionFile;
}

function loadTransaction(settings, selector) {
  const root = path.join(settings.stateDir, 'transactions');
  if (selector === 'latest') {
    if (!isDirectory(root)) throw new Error('no completed repair transaction is available');
    const candidates = fs.readdirSync(root).sort().reverse();
    for (let index = 0; index < candidates.length; index += 1) {
      const transactionFile = path.join(root, candidates[index], 'transaction.json');
      if (!fs.existsSync(transactionFile)) continue;
      const payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
      if (payload.status === 'completed' && supportedRepairTransaction(payload)) return { transactionFile, payload };
    }
    throw new Error('no completed repair transaction is available');
  }
  const transactionFile = path.join(root, selector, 'transaction.json');
  if (!fs.existsSync(transactionFile)) throw new Error('repair transaction not found: ' + selector);
  const payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8'));
  if (payload.version !== 2) throw new Error('repair transaction belongs to an unsupported pre-v2 format: ' + selector);
  if (!supportedRepairTransaction(payload)) throw new Error('repair transaction belongs to a removed Catalog workflow: ' + selector);
  return { transactionFile, payload };
}

function rollbackPreview(settings, selector) {
  const transaction = loadTransaction(settings, selector);
  if (transaction.payload.status !== 'completed') {
    throw new Error('transaction is not in completed state: ' + transaction.payload.status);
  }
  transaction.payload.operations.forEach(validateRollbackOperation);
  return {
    transactionFile: transaction.transactionFile,
    descriptions: transaction.payload.operations.slice().reverse().map(function describe(operation) {
      return (operation.before_exists ? 'RESTORE_FILE ' : 'REMOVE_GENERATED_FILE ') + operation.path;
    }),
  };
}

function applyRollback(settings, selector) {
  const transaction = loadTransaction(settings, selector);
  if (transaction.payload.status !== 'completed') {
    throw new Error('transaction is not in completed state: ' + transaction.payload.status);
  }
  const operations = transaction.payload.operations.slice().reverse();
  operations.forEach(validateRollbackOperation);
  const transactionDir = path.dirname(transaction.transactionFile);
  operations.forEach(function rollback(operation) { rollbackOperation(operation, transactionDir); });
  transaction.payload.status = 'rolled_back';
  transaction.payload.rolled_back_at = new Date().toISOString();
  writeTransaction(transaction.transactionFile, transaction.payload);
  return transaction.transactionFile;
}

module.exports = {
  SUPPORTED_SCOPES,
  actionDescription,
  applyRepair,
  applyRollback,
  buildRepairPlan,
  rollbackPreview,
  supportedRepairTransaction,
};
