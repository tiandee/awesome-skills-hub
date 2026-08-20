'use strict';

const fs = require('fs');
const path = require('path');

const { rollbackPreview, supportedRepairTransaction } = require('./repair');
const { previewSkillUpdateRollback } = require('./update');
const { isDirectory, lexists, sha256 } = require('./util');

const DEFAULT_KEEP_COUNT = 10;
const DEFAULT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function removeTree(target) {
  if (!lexists(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

function treeRecords(root, options) {
  const opts = options || {};
  const hashContent = opts.hashContent !== false;
  const records = [];
  let bytes = 0;
  function visit(selected, relative) {
    const stat = fs.lstatSync(selected);
    if (stat.isSymbolicLink()) {
      records.push({ path: relative, type: 'symlink', target: fs.readlinkSync(selected) });
      return;
    }
    if (stat.isDirectory()) {
      records.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
      fs.readdirSync(selected).sort().forEach(function child(name) {
        visit(path.join(selected, name), relative ? relative + '/' + name : name);
      });
      return;
    }
    if (!stat.isFile()) throw new Error('unsupported transaction entry: ' + selected);
    bytes += stat.size;
    const record = { path: relative, type: 'file', mode: stat.mode & 0o777, size: stat.size, mtime_ms: Math.floor(stat.mtimeMs) };
    if (hashContent) record.sha256 = sha256(fs.readFileSync(selected));
    records.push(record);
  }
  visit(root, '');
  return { bytes, digest: sha256(Buffer.from(JSON.stringify(records), 'utf8')) };
}

function validDate(value, fallback) {
  const selected = new Date(value || '');
  return Number.isNaN(selected.getTime()) ? fallback : selected;
}

function transactionRoot(settings, type) {
  return path.join(settings.stateDir, type === 'repair' ? 'transactions' : 'updates');
}

function inspectTransaction(settings, type, directory) {
  const id = path.basename(directory);
  const transactionFile = path.join(directory, 'transaction.json');
  const stat = fs.statSync(directory);
  const state = treeRecords(directory, { hashContent: false });
  let payload = null;
  let error = null;
  try { payload = JSON.parse(fs.readFileSync(transactionFile, 'utf8')); } catch (caught) { error = caught.message; }
  const created = validDate(payload && payload.created_at, stat.mtime);
  let obsolete = false;
  if (!payload) obsolete = true;
  else if (type === 'repair') {
    obsolete = !supportedRepairTransaction(payload);
  } else {
    obsolete = payload.version !== 1;
  }
  return {
    type,
    id,
    path: directory,
    transaction_file: transactionFile,
    status: payload && payload.status ? String(payload.status) : 'invalid',
    created_at: created.toISOString(),
    age_days: null,
    bytes: state.bytes,
    digest: state.digest,
    obsolete,
    error,
    protected: false,
    keep_reasons: [],
  };
}

function listTransactions(settings) {
  const records = [];
  ['repair', 'update'].forEach(function eachType(type) {
    const root = transactionRoot(settings, type);
    if (!isDirectory(root)) return;
    fs.readdirSync(root).sort().forEach(function inspect(id) {
      const directory = path.join(root, id);
      if (!isDirectory(directory) || fs.lstatSync(directory).isSymbolicLink()) return;
      records.push(inspectTransaction(settings, type, directory));
    });
  });
  return records;
}

function protectedTransactionIds(settings) {
  const protectedIds = { repair: null, update: null };
  try { protectedIds.repair = path.basename(path.dirname(rollbackPreview(settings, 'latest').transactionFile)); } catch (error) { /* no safe repair rollback */ }
  try { protectedIds.update = previewSkillUpdateRollback(settings, 'latest').transaction_id; } catch (error) { /* no safe update rollback */ }
  return protectedIds;
}

function positiveInteger(value, fallback, label) {
  const selected = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > 1000) throw new Error(label + ' must be an integer between 1 and 1000');
  return selected;
}

function retentionPlanDigest(plan) {
  return sha256(Buffer.from(JSON.stringify({
    evaluated_at: plan.evaluated_at,
    policy: plan.policy,
    protected: plan.protected,
    actions: plan.actions.map(function action(item) {
      return { type: item.type, id: item.id, path: item.path, digest: item.digest, reason: item.reason };
    }),
  }), 'utf8'));
}

function buildRetentionPlan(settings, options) {
  const opts = options || {};
  const keepCount = positiveInteger(opts.keepCount, DEFAULT_KEEP_COUNT, 'keepCount');
  const maxAgeDays = positiveInteger(opts.maxAgeDays, DEFAULT_MAX_AGE_DAYS, 'maxAgeDays');
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('retention evaluation time is invalid');
  const protectedIds = opts.protectedIds || protectedTransactionIds(settings);
  const records = listTransactions(settings);
  ['repair', 'update'].forEach(function classify(type) {
    const all = records.filter(function matching(record) { return record.type === type; });
    all.forEach(function age(record) {
      record.age_days = Math.max(0, Math.floor((now.getTime() - new Date(record.created_at).getTime()) / DAY_MS));
      record.protected = protectedIds[type] === record.id;
      if (record.protected) record.keep_reasons.push('rollback-protected');
    });
    const selected = all.filter(function currentWorkflow(record) { return !record.obsolete; }).sort(function newest(a, b) {
      return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
    });
    selected.forEach(function retain(record, index) {
      if (index < keepCount) record.keep_reasons.push('newest-' + keepCount);
      if (record.age_days <= maxAgeDays) record.keep_reasons.push('within-' + maxAgeDays + '-days');
    });
  });
  const actions = records.filter(function removable(record) {
    if (record.protected) return false;
    if (record.obsolete) return true;
    return record.keep_reasons.length === 0;
  }).sort(function byPath(a, b) { return a.path.localeCompare(b.path); }).map(function action(record) {
    const state = treeRecords(record.path);
    return {
      kind: 'transaction_prune',
      type: record.type,
      id: record.id,
      path: record.path,
      bytes: state.bytes,
      digest: state.digest,
      reason: record.obsolete ? 'obsolete-workflow' : 'outside-retention-window',
      description: 'DELETE ' + record.type.toUpperCase() + ' TRANSACTION ' + record.id + ' (' + (record.obsolete ? 'obsolete workflow' : 'older than policy') + ')',
    };
  });
  const plan = {
    evaluated_at: now.toISOString(),
    policy: { keep_count: keepCount, max_age_days: maxAgeDays },
    protected: protectedIds,
    records,
    actions,
    summary: {
      total: records.length,
      retained: records.length - actions.length,
      delete_count: actions.length,
      delete_bytes: actions.reduce(function sum(total, action) { return total + action.bytes; }, 0),
      obsolete: records.filter(function obsolete(record) { return record.obsolete; }).length,
    },
  };
  plan.digest = retentionPlanDigest(plan);
  return plan;
}

function assertDeletionTarget(settings, action) {
  const root = transactionRoot(settings, action.type);
  if (path.dirname(action.path) !== root || path.basename(action.path) !== action.id) {
    throw new Error('transaction cleanup target escapes its state root: ' + action.path);
  }
  if (!isDirectory(action.path) || fs.lstatSync(action.path).isSymbolicLink()) {
    throw new Error('transaction cleanup target is no longer a regular directory: ' + action.path);
  }
  if (treeRecords(action.path).digest !== action.digest) throw new Error('transaction changed after cleanup preview: ' + action.id);
}

function applyRetentionPlan(settings, plan, options) {
  const opts = options || {};
  const fresh = buildRetentionPlan(settings, {
    keepCount: plan.policy.keep_count,
    maxAgeDays: plan.policy.max_age_days,
    now: new Date(plan.evaluated_at),
    protectedIds: opts.protectedIds,
  });
  if (retentionPlanDigest(fresh) !== plan.digest) throw new Error('transaction retention preview is stale');
  fresh.actions.forEach(function preflight(action) { assertDeletionTarget(settings, action); });
  fresh.actions.forEach(function remove(action) { removeTree(action.path); });
  return {
    deleted: fresh.actions.map(function result(action) { return { type: action.type, id: action.id, path: action.path, bytes: action.bytes }; }),
    deleted_bytes: fresh.summary.delete_bytes,
  };
}

module.exports = {
  DAY_MS,
  DEFAULT_KEEP_COUNT,
  DEFAULT_MAX_AGE_DAYS,
  applyRetentionPlan,
  buildRetentionPlan,
  listTransactions,
  protectedTransactionIds,
  retentionPlanDigest,
  treeRecords,
};
