'use strict';

const fs = require('fs');

const { issue } = require('./discovery');
const { lexists } = require('./util');

const START_MARKER = '<!-- ash:codex-skill-management:start -->';
const END_MARKER = '<!-- ash:codex-skill-management:end -->';
const MANAGED_BLOCK = [
  START_MARKER,
  '## ASH-managed user Skill creation',
  '',
  '- Treat `$HOME/.agents/skills` as this user\'s selected default for every non-system, non-plugin Skill.',
  '- When asked to create a user Skill, run `ash create <skill-name> --description "what the Skill does and when it should be used"` before editing the generated files.',
  '- Update an existing Skill in `$HOME/.agents/skills` in place; do not create or migrate user Skills into `$CODEX_HOME/skills`.',
  '- Never modify Codex `.system` Skills or plugin-owned Skills.',
  '- After editing, run `ash doctor`. Preview deterministic repairs with `ash repair` before using `ash repair --apply`.',
  '- If `ash create` is unavailable, create the same standard Skill structure directly under `$HOME/.agents/skills`.',
  END_MARKER,
].join('\n');

function countOccurrences(text, marker) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(marker, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + marker.length;
  }
}

function inspectFile(filePath) {
  if (!lexists(filePath)) return { status: 'missing', content: '' };
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { status: 'invalid', content: '', detail: 'path is not a regular file' };
  }
  try {
    return { status: 'present', content: fs.readFileSync(filePath, 'utf8') };
  } catch (error) {
    return { status: 'invalid', content: '', detail: error.message };
  }
}

function inspectManagedBlock(content) {
  const startCount = countOccurrences(content, START_MARKER);
  const endCount = countOccurrences(content, END_MARKER);
  if (startCount === 0 && endCount === 0) return { status: 'missing' };
  if (startCount !== 1 || endCount !== 1) {
    return { status: 'malformed', detail: 'managed markers must each appear exactly once' };
  }
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  if (end < start) return { status: 'malformed', detail: 'managed end marker appears before start marker' };
  const endOffset = end + END_MARKER.length;
  const current = content.slice(start, endOffset);
  return {
    status: current === MANAGED_BLOCK ? 'current' : 'stale',
    start,
    end: endOffset,
  };
}

function inspectCodexGuidance(settings) {
  if (settings.codexGlobalGuidancePolicy !== 'manage') {
    return { status: 'disabled', overrideActive: false };
  }
  const override = inspectFile(settings.codexAgentsOverrideFile);
  const overrideActive = override.status === 'present' && override.content.trim().length > 0;
  const agents = inspectFile(settings.codexAgentsFile);
  if (agents.status === 'invalid') {
    return {
      status: 'invalid',
      detail: agents.detail,
      override,
      overrideActive,
    };
  }
  const managed = inspectManagedBlock(agents.content);
  return Object.assign({}, managed, {
    content: agents.content,
    fileStatus: agents.status,
    override,
    overrideActive,
  });
}

function codexGuidanceIssues(settings) {
  const inspection = inspectCodexGuidance(settings);
  if (inspection.status === 'disabled') return [];
  const issues = [];
  if (inspection.override.status === 'invalid') {
    issues.push(issue(
      'ERROR',
      'CODEX_AGENTS_OVERRIDE_INVALID',
      'Codex global override cannot be inspected safely: ' + inspection.override.detail,
      [settings.codexAgentsOverrideFile],
    ));
  } else if (inspection.overrideActive) {
    issues.push(issue(
      'WARN',
      'CODEX_AGENTS_OVERRIDE_SHADOWS_ASH',
      'non-empty AGENTS.override.md takes precedence over the ASH-managed AGENTS.md guidance',
      [settings.codexAgentsOverrideFile, settings.codexAgentsFile],
    ));
  }
  if (inspection.status === 'invalid') {
    issues.push(issue(
      'ERROR',
      'CODEX_AGENTS_FILE_INVALID',
      'refusing to manage Codex global guidance because AGENTS.md is not a regular file: ' + inspection.detail,
      [settings.codexAgentsFile],
    ));
  } else if (inspection.status === 'malformed') {
    issues.push(issue(
      'ERROR',
      'CODEX_ASH_GUIDANCE_MALFORMED',
      'ASH-managed markers in Codex AGENTS.md are ambiguous: ' + inspection.detail,
      [settings.codexAgentsFile],
    ));
  } else if (inspection.status === 'missing') {
    issues.push(issue(
      'WARN',
      'CODEX_ASH_GUIDANCE_MISSING',
      'Codex global instructions do not contain the ASH user Skill creation guidance',
      [settings.codexAgentsFile],
    ));
  } else if (inspection.status === 'stale') {
    issues.push(issue(
      'WARN',
      'CODEX_ASH_GUIDANCE_STALE',
      'ASH-managed Codex user Skill creation guidance is out of date',
      [settings.codexAgentsFile],
    ));
  }
  return issues;
}

function renderManagedGuidance(content, inspection) {
  if (inspection.status === 'current') return content;
  if (inspection.status === 'stale') {
    return content.slice(0, inspection.start) + MANAGED_BLOCK + content.slice(inspection.end);
  }
  if (inspection.status !== 'missing') {
    throw new Error('cannot render ambiguous Codex guidance: ' + inspection.status);
  }
  if (content.length === 0) return MANAGED_BLOCK + '\n';
  let separator = '\n\n';
  if (content.endsWith('\n\n')) separator = '';
  else if (content.endsWith('\n')) separator = '\n';
  return content + separator + MANAGED_BLOCK + '\n';
}

function buildCodexGuidancePlan(settings) {
  const inspection = inspectCodexGuidance(settings);
  const result = { actions: [], conflicts: [] };
  if (inspection.status === 'disabled') return result;
  if (inspection.override.status === 'invalid' || inspection.overrideActive) {
    result.conflicts.push.apply(result.conflicts, codexGuidanceIssues(settings));
    return result;
  }
  if (inspection.status === 'current') return result;
  if (inspection.status === 'invalid' || inspection.status === 'malformed') {
    result.conflicts.push.apply(result.conflicts, codexGuidanceIssues(settings));
    return result;
  }
  result.actions.push({
    kind: 'file_write',
    scope: 'codex-guidance',
    path: settings.codexAgentsFile,
    content: Buffer.from(renderManagedGuidance(inspection.content, inspection), 'utf8'),
  });
  return result;
}

module.exports = {
  END_MARKER,
  MANAGED_BLOCK,
  START_MARKER,
  buildCodexGuidancePlan,
  codexGuidanceIssues,
  inspectCodexGuidance,
  inspectManagedBlock,
  renderManagedGuidance,
};
