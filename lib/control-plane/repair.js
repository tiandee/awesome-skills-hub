'use strict';

const fs = require('fs');
const path = require('path');

const { catalogIsCurrent, generateCatalog } = require('./catalog');
const { targetIncludes, targetIsActive } = require('./config');
const { discoverLibrary, issue, linkStatus } = require('./discovery');
const {
  atomicWrite,
  canonicalPath,
  createDirectoryLink,
  isDirectory,
  lexists,
  sha256,
  timestampId,
  writeJsonAtomic,
} = require('./util');

function actionDescription(action) {
  if (action.kind === 'mkdir') return 'CREATE_DIR ' + action.path;
  if (action.kind === 'symlink_create') return 'CREATE_LINK ' + action.path + ' -> ' + action.target;
  if (action.kind === 'symlink_replace') return 'REPLACE_BROKEN_LINK ' + action.path + ' -> ' + action.target;
  if (action.kind === 'file_write') return 'WRITE_FILE ' + action.path;
  return action.kind.toUpperCase() + ' ' + action.path;
}

function buildRepairPlan(settings) {
  if (!isDirectory(settings.libraryRoot)) {
    throw new Error('universal Skill library is not present: ' + settings.libraryRoot);
  }
  const library = discoverLibrary(settings);
  const actions = [];
  const conflicts = [];
  const missingTargetDirs = new Set();
  const pathsByName = new Map();
  library.forEach(function group(skill) {
    if (!pathsByName.has(skill.directoryName)) pathsByName.set(skill.directoryName, []);
    pathsByName.get(skill.directoryName).push(skill.path);
  });
  const duplicates = new Set();
  pathsByName.forEach(function report(paths, name) {
    if (paths.length > 1) {
      duplicates.add(name);
      conflicts.push(issue(
        'ERROR',
        'DUPLICATE_SKILL_TARGET',
        'refusing to choose between multiple universal library entries named ' + name,
        paths,
      ));
    }
  });

  settings.targets.filter(targetIsActive).forEach(function planTarget(target) {
    const desired = library.filter(function selected(skill) {
      return !duplicates.has(skill.directoryName) && targetIncludes(target, skill.directoryName);
    });
    if (desired.length === 0) return;
    if (lexists(target.path) && !isDirectory(target.path)) {
      conflicts.push(issue(
        'ERROR',
        'TARGET_NOT_DIRECTORY',
        'configured target is not a directory: ' + target.path,
        [target.path],
      ));
      return;
    }
    if (!lexists(target.path)) {
      const chain = [];
      let candidate = target.path;
      while (!lexists(candidate)) {
        chain.push(candidate);
        const parent = path.dirname(candidate);
        if (parent === candidate) break;
        candidate = parent;
      }
      if (!isDirectory(candidate)) {
        conflicts.push(issue(
          'ERROR',
          'TARGET_PARENT_NOT_DIRECTORY',
          'target parent is not a directory: ' + candidate,
          [candidate],
        ));
        return;
      }
      chain.reverse().forEach(function addDirectory(directory) {
        if (missingTargetDirs.has(directory)) return;
        actions.push({ kind: 'mkdir', path: directory });
        missingTargetDirs.add(directory);
      });
    }

    desired.forEach(function planSkill(skill) {
      const installPath = path.join(target.path, skill.directoryName);
      const current = linkStatus(installPath, skill.path);
      if (current.status === 'linked') return;
      if (current.status === 'missing') {
        actions.push({
          kind: 'symlink_create',
          path: installPath,
          target: path.resolve(skill.path),
        });
      } else if (current.status === 'broken') {
        actions.push({
          kind: 'symlink_replace',
          path: installPath,
          target: path.resolve(skill.path),
          oldTarget: current.current,
        });
      } else {
        conflicts.push(issue(
          'ERROR',
          'LINK_CONFLICT',
          'refusing to replace existing target for ' + skill.directoryName + ' (' + current.current + ')',
          [installPath],
        ));
      }
    });
  });

  if (!catalogIsCurrent(settings, library)) {
    actions.push({
      kind: 'file_write',
      path: settings.catalogPath,
      content: Buffer.from(generateCatalog(settings, library), 'utf8'),
    });
  }
  return { actions, conflicts };
}

function writeTransaction(transactionFile, payload) {
  writeJsonAtomic(transactionFile, payload);
}

function prepareTransaction(settings, plan) {
  plan.actions.forEach(function preflight(action) {
    if (action.kind !== 'file_write') return;
    if (!Buffer.isBuffer(action.content)) throw new Error('file_write action has no content');
    if (!lexists(action.path)) return;
    const stat = fs.lstatSync(action.path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('refusing to replace non-regular file: ' + action.path);
    }
  });
  const transactionsRoot = path.join(settings.stateDir, 'transactions');
  fs.mkdirSync(transactionsRoot, { recursive: true });
  let id;
  let transactionDir;
  do {
    id = timestampId();
    transactionDir = path.join(transactionsRoot, id);
  } while (lexists(transactionDir));
  fs.mkdirSync(transactionDir);
  const operations = plan.actions.map(function prepare(action, index) {
    const operation = {
      kind: action.kind,
      path: action.path,
      target: action.target || null,
      old_target: action.oldTarget || null,
      before_exists: lexists(action.path),
    };
    if (action.kind === 'file_write') {
      if (!Buffer.isBuffer(action.content)) throw new Error('file_write action has no content');
      const newName = 'new-' + String(index).padStart(3, '0') + '.bin';
      fs.writeFileSync(path.join(transactionDir, newName), action.content);
      operation.new_file = newName;
      operation.after_hash = sha256(action.content);
      if (operation.before_exists) {
        const stat = fs.lstatSync(action.path);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('refusing to replace non-regular file: ' + action.path);
        }
        const oldContent = fs.readFileSync(action.path);
        const backupName = 'backup-' + String(index).padStart(3, '0') + '.bin';
        fs.writeFileSync(path.join(transactionDir, backupName), oldContent);
        operation.backup_file = backupName;
        operation.before_hash = sha256(oldContent);
      }
    }
    return operation;
  });
  const payload = {
    schema_version: 1,
    id,
    created_at: new Date().toISOString(),
    library_root: settings.libraryRoot,
    status: 'prepared',
    applied_count: 0,
    operations,
  };
  const transactionFile = path.join(transactionDir, 'transaction.json');
  writeTransaction(transactionFile, payload);
  return { transactionDir, transactionFile, payload };
}

function linkPointsTo(linkPath, target) {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return false;
    const raw = fs.readlinkSync(linkPath);
    return canonicalPath(path.resolve(path.dirname(linkPath), raw)) === canonicalPath(target);
  } catch (error) {
    return false;
  }
}

function applyOperation(operation, transactionDir) {
  const operationPath = operation.path;
  if (operation.kind === 'mkdir') {
    if (lexists(operationPath)) throw new Error('target appeared before directory creation: ' + operationPath);
    fs.mkdirSync(operationPath);
    return;
  }
  if (operation.kind === 'symlink_create') {
    if (lexists(operationPath)) throw new Error('target appeared before link creation: ' + operationPath);
    createDirectoryLink(operation.target, operationPath);
    return;
  }
  if (operation.kind === 'symlink_replace') {
    let stat;
    try {
      stat = fs.lstatSync(operationPath);
    } catch (error) {
      throw new Error('broken link changed before repair: ' + operationPath);
    }
    if (!stat.isSymbolicLink() || fs.readlinkSync(operationPath) !== operation.old_target) {
      throw new Error('broken link target changed before repair: ' + operationPath);
    }
    const temporary = path.join(
      path.dirname(operationPath),
      '.' + path.basename(operationPath) + '.ash-replacement-' + process.pid,
    );
    if (lexists(temporary)) throw new Error('temporary repair path already exists: ' + temporary);
    createDirectoryLink(operation.target, temporary);
    try {
      if (process.platform === 'win32') {
        fs.unlinkSync(operationPath);
        try {
          fs.renameSync(temporary, operationPath);
        } catch (error) {
          createDirectoryLink(operation.old_target, operationPath);
          throw error;
        }
      } else {
        fs.renameSync(temporary, operationPath);
      }
    } finally {
      if (lexists(temporary)) fs.unlinkSync(temporary);
    }
    return;
  }
  if (operation.kind === 'file_write') {
    if (operation.before_exists) {
      if (!lexists(operationPath)) throw new Error('file disappeared after planning: ' + operationPath);
      const stat = fs.lstatSync(operationPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('file changed type before repair: ' + operationPath);
      }
      if (sha256(fs.readFileSync(operationPath)) !== operation.before_hash) {
        throw new Error('file changed after planning: ' + operationPath);
      }
    } else if (lexists(operationPath)) {
      throw new Error('file appeared after planning: ' + operationPath);
    }
    atomicWrite(operationPath, fs.readFileSync(path.join(transactionDir, operation.new_file)));
    return;
  }
  throw new Error('unknown repair operation: ' + operation.kind);
}

function validateRollbackOperation(operation) {
  const operationPath = operation.path;
  if (operation.kind === 'file_write') {
    if (!lexists(operationPath)) throw new Error('cannot safely rollback missing file: ' + operationPath);
    const stat = fs.lstatSync(operationPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('cannot safely rollback changed file type: ' + operationPath);
    }
    if (sha256(fs.readFileSync(operationPath)) !== operation.after_hash) {
      throw new Error('cannot safely rollback user-modified file: ' + operationPath);
    }
    return;
  }
  if (operation.kind === 'symlink_create' || operation.kind === 'symlink_replace') {
    if (!linkPointsTo(operationPath, operation.target)) {
      throw new Error('cannot safely rollback changed link: ' + operationPath);
    }
    return;
  }
  if (operation.kind === 'mkdir') {
    if (lexists(operationPath) && !isDirectory(operationPath)) {
      throw new Error('cannot safely rollback changed directory type: ' + operationPath);
    }
    return;
  }
  throw new Error('unknown rollback operation: ' + operation.kind);
}

function rollbackOperation(operation, transactionDir) {
  const operationPath = operation.path;
  if (operation.kind === 'file_write') {
    validateRollbackOperation(operation);
    if (operation.before_exists) {
      atomicWrite(operationPath, fs.readFileSync(path.join(transactionDir, operation.backup_file)));
    } else {
      fs.unlinkSync(operationPath);
    }
    return;
  }
  if (operation.kind === 'symlink_create' || operation.kind === 'symlink_replace') {
    validateRollbackOperation(operation);
    fs.unlinkSync(operationPath);
    if (operation.kind === 'symlink_replace') createDirectoryLink(operation.old_target, operationPath);
    return;
  }
  if (operation.kind === 'mkdir') {
    if (isDirectory(operationPath)) {
      try {
        fs.rmdirSync(operationPath);
      } catch (error) {
        if (!error || (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST')) throw error;
      }
    }
    return;
  }
  throw new Error('unknown rollback operation: ' + operation.kind);
}

function applyRepair(settings, plan) {
  if (!plan.actions.length) throw new Error('repair plan has no actions');
  const transaction = prepareTransaction(settings, plan);
  transaction.payload.status = 'applying';
  writeTransaction(transaction.transactionFile, transaction.payload);
  try {
    transaction.payload.operations.forEach(function apply(operation) {
      applyOperation(operation, transaction.transactionDir);
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
      if (payload.status === 'completed') return { transactionFile, payload };
    }
    throw new Error('no completed repair transaction is available');
  }
  const transactionFile = path.join(root, selector, 'transaction.json');
  if (!fs.existsSync(transactionFile)) throw new Error('repair transaction not found: ' + selector);
  return { transactionFile, payload: JSON.parse(fs.readFileSync(transactionFile, 'utf8')) };
}

function rollbackPreview(settings, selector) {
  const transaction = loadTransaction(settings, selector);
  if (transaction.payload.status !== 'completed') {
    throw new Error('transaction is not in completed state: ' + transaction.payload.status);
  }
  const descriptions = transaction.payload.operations.slice().reverse().map(function describe(operation) {
    if (operation.kind === 'file_write') {
      return (operation.before_exists ? 'RESTORE_FILE ' : 'REMOVE_GENERATED_FILE ') + operation.path;
    }
    if (operation.kind === 'symlink_create') return 'REMOVE_LINK ' + operation.path;
    if (operation.kind === 'symlink_replace') {
      return 'RESTORE_LINK ' + operation.path + ' -> ' + operation.old_target;
    }
    if (operation.kind === 'mkdir') return 'REMOVE_DIR_IF_EMPTY ' + operation.path;
    return operation.kind.toUpperCase() + ' ' + operation.path;
  });
  return { transactionFile: transaction.transactionFile, descriptions };
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
  actionDescription,
  applyRepair,
  applyRollback,
  buildRepairPlan,
  rollbackPreview,
};
