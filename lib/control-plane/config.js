'use strict';

const os = require('os');
const path = require('path');

const { canonicalPath, expandPath, isDirectory, lexists, readJson } = require('./util');

const DEFAULT_CONFIG_NAME = 'ash-control.json';

function requireObject(payload, key) {
  const value = payload[key] === undefined ? {} : payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(key + ' must be a JSON object');
  }
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some(function invalid(item) { return typeof item !== 'string'; })) {
    throw new Error(label + ' must be an array of strings');
  }
  return value.slice();
}

function normalizeEnabled(value, label) {
  if (value === undefined || value === true || value === 'always') return 'always';
  if (value === false || value === 'disabled') return 'disabled';
  if (value === 'detected') return 'detected';
  throw new Error(label + '.enabled must be always, detected, disabled, true, or false');
}

function normalizeCodexUserSkillsPolicy(value) {
  if (value === undefined || value === 'observe') return 'observe';
  if (value === 'migrate-to-agents') return value;
  throw new Error('policies.codex_user_skills must be observe or migrate-to-agents');
}

function normalizeCodexGlobalGuidancePolicy(value) {
  if (value === undefined || value === 'observe') return 'observe';
  if (value === 'manage') return value;
  throw new Error('policies.codex_global_guidance must be observe or manage');
}

function loadSettings(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const projectRoot = path.resolve(opts.projectRoot || path.join(__dirname, '..', '..'));
  const homeDir = path.resolve(opts.homeDir || env.HOME || env.USERPROFILE || os.homedir());
  const configPath = path.resolve(opts.configPath || path.join(projectRoot, DEFAULT_CONFIG_NAME));
  const payload = readJson(configPath);
  if (payload.schema_version !== 1) {
    throw new Error('unsupported schema_version in ' + configPath);
  }

  const pathOptions = { env, homeDir, projectRoot };
  const library = requireObject(payload, 'library');
  const rawLibraryPath = env.ASH_SKILLS_DIR || library.path || '~/.agents/skills';
  const exclude = requireStringArray(library.exclude || [], 'library.exclude');
  const libraryRoot = expandPath(rawLibraryPath, pathOptions);

  const rawTargets = requireObject(payload, 'targets');
  const targetNames = Object.keys(rawTargets);
  if (targetNames.length === 0) throw new Error('at least one target must be configured');
  const targets = targetNames.map(function buildTarget(name) {
    const raw = rawTargets[name];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('target ' + name + ' must be a JSON object');
    }
    const target = {
      name,
      path: expandPath(raw.path, pathOptions),
      skills: requireStringArray(raw.skills || ['*'], 'targets.' + name + '.skills'),
      enabled: normalizeEnabled(raw.enabled, 'targets.' + name),
    };
    if (canonicalPath(target.path) === canonicalPath(libraryRoot)) {
      throw new Error('target ' + name + ' must not reuse the universal Skill library path: ' + libraryRoot);
    }
    return target;
  });

  const sources = requireObject(payload, 'sources');
  const policies = requireObject(payload, 'policies');
  const output = requireObject(payload, 'output');
  const codexHome = expandPath(env.CODEX_HOME || '~/.codex', pathOptions);
  return {
    schemaVersion: 1,
    projectRoot,
    homeDir,
    env,
    configPath,
    libraryRoot,
    libraryExclude: new Set(exclude),
    targets,
    codexUserSkillsPolicy: normalizeCodexUserSkillsPolicy(policies.codex_user_skills),
    codexGlobalGuidancePolicy: normalizeCodexGlobalGuidancePolicy(policies.codex_global_guidance),
    codexHome,
    codexAgentsFile: path.join(codexHome, 'AGENTS.md'),
    codexAgentsOverrideFile: path.join(codexHome, 'AGENTS.override.md'),
    agentsLock: expandPath(sources.agents_lock || '~/.agents/.skill-lock.json', pathOptions),
    codexRoot: expandPath(sources.codex_root || '~/.codex/skills', pathOptions),
    codexStoreLock: expandPath(
      sources.codex_store_lock || '~/.codex/skills/.skills_store_lock.json',
      pathOptions,
    ),
    pluginCache: expandPath(sources.plugin_cache || '~/.codex/plugins/cache', pathOptions),
    stateDir: expandPath(output.state_dir || '~/.ash/state/control-plane', pathOptions),
    catalogPath: expandPath(output.catalog || '~/.ash/CATALOG.md', pathOptions),
    packageOutputDir: expandPath(output.packages || '~/.ash/packages', pathOptions),
  };
}

function targetIsActive(target) {
  if (target.enabled === 'disabled') return false;
  if (target.enabled === 'always') return true;
  if (lexists(target.path)) return true;
  return isDirectory(path.dirname(target.path));
}

function targetIncludes(target, skillName) {
  return target.skills.indexOf('*') !== -1 || target.skills.indexOf(skillName) !== -1;
}

module.exports = {
  DEFAULT_CONFIG_NAME,
  loadSettings,
  normalizeCodexGlobalGuidancePolicy,
  targetIncludes,
  targetIsActive,
};
