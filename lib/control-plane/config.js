'use strict';

const os = require('os');
const path = require('path');

const { expandPath, readJson } = require('./util');

const DEFAULT_CONFIG_NAME = 'ash-control.json';
const SCHEMA_VERSION = 2;

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

function normalizeCodexGlobalGuidancePolicy(value) {
  if (value === undefined || value === 'observe') return 'observe';
  if (value === 'manage') return value;
  throw new Error('policies.codex_global_guidance must be observe or manage');
}

function rejectDeprecatedConfiguration(payload, configPath) {
  if (payload.targets !== undefined) {
    throw new Error('targets is no longer supported in schema_version 2; remove per-Agent Skill directories from ' + configPath);
  }
  const policies = requireObject(payload, 'policies');
  if (policies.codex_user_skills !== undefined) {
    throw new Error('policies.codex_user_skills is obsolete; user Skills now live only in ~/.agents/skills');
  }
  const sources = requireObject(payload, 'sources');
  ['codex_root', 'codex_store_lock', 'plugin_cache'].forEach(function reject(key) {
    if (sources[key] !== undefined) throw new Error('sources.' + key + ' is obsolete in schema_version 2');
  });
}

function loadSettings(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const projectRoot = path.resolve(opts.projectRoot || path.join(__dirname, '..', '..'));
  const homeDir = path.resolve(opts.homeDir || env.HOME || env.USERPROFILE || os.homedir());
  const configPath = path.resolve(opts.configPath || path.join(projectRoot, DEFAULT_CONFIG_NAME));
  const payload = readJson(configPath);
  if (payload.schema_version !== SCHEMA_VERSION) {
    throw new Error('unsupported schema_version in ' + configPath + '; expected ' + SCHEMA_VERSION);
  }
  rejectDeprecatedConfiguration(payload, configPath);

  const pathOptions = { env, homeDir, projectRoot };
  const library = requireObject(payload, 'library');
  const policies = requireObject(payload, 'policies');
  const sources = requireObject(payload, 'sources');
  const output = requireObject(payload, 'output');
  const rawLibraryPath = env.ASH_SKILLS_DIR || library.path || '~/.agents/skills';
  const codexHome = expandPath(env.CODEX_HOME || '~/.codex', pathOptions);
  return {
    schemaVersion: SCHEMA_VERSION,
    projectRoot,
    homeDir,
    env,
    configPath,
    libraryRoot: expandPath(rawLibraryPath, pathOptions),
    libraryExclude: new Set(requireStringArray(library.exclude || [], 'library.exclude')),
    codexGlobalGuidancePolicy: normalizeCodexGlobalGuidancePolicy(policies.codex_global_guidance),
    codexHome,
    codexAgentsFile: path.join(codexHome, 'AGENTS.md'),
    codexAgentsOverrideFile: path.join(codexHome, 'AGENTS.override.md'),
    agentsLock: expandPath(sources.agents_lock || '~/.agents/.skill-lock.json', pathOptions),
    stateDir: expandPath(output.state_dir || '~/.agents/.ash/state/control-plane', pathOptions),
    packageOutputDir: expandPath(output.packages || '~/.agents/.ash/packages', pathOptions),
  };
}

module.exports = {
  DEFAULT_CONFIG_NAME,
  SCHEMA_VERSION,
  loadSettings,
  normalizeCodexGlobalGuidancePolicy,
  rejectDeprecatedConfiguration,
};
