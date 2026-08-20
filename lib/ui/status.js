'use strict';

const path = require('path');

const UPDATE_PRESENTATION = Object.freeze({
  'checkable': { key: 'check', label: '待检查', tone: 'neutral', detail: '来源完整，尚未检查', action: 'check-updates' },
  'up-to-date': { key: 'current', label: '最新', tone: 'info', detail: '已与上游一致', action: null },
  'update-available': { key: 'available', label: '可更新', tone: 'success', detail: '上游存在新内容', action: 'preview-update' },
  'unmanaged': { key: 'takeover', label: '待接管', tone: 'warning', detail: '尚未关联更新来源', action: 'link-source' },
  'baseline-missing': { key: 'baseline', label: '待重建', tone: 'warning', detail: '来源已知但缺少可比较基线', action: 'rebuild-baseline' },
  'repository-linked': { key: 'external', label: '外部管理', tone: 'neutral', detail: '由仓库链接管理', action: null },
  'read-only-source': { key: 'external', label: '外部管理', tone: 'neutral', detail: '来自只读扫描目录', action: null },
  'source-unavailable': { key: 'error', label: '异常', tone: 'danger', detail: '更新来源不可用', action: 'check-source' },
  'missing': { key: 'error', label: '异常', tone: 'danger', detail: '安装记录存在但本地缺失', action: 'inspect-missing' },
});

const OWNERSHIP_LABELS = Object.freeze({
  'installer-lock': '安装锁',
  'git-link': '仓库链接',
  'manual': '手动维护',
  'observed': '只读来源',
});

const SEVERITY_PRESENTATION = Object.freeze({
  ERROR: { level: 'error', label: '错误', tone: 'danger' },
  WARN: { level: 'warning', label: '警告', tone: 'warning' },
  INFO: { level: 'info', label: '提示', tone: 'info' },
});

function presentUpdateStatus(update) {
  const status = typeof update === 'string' ? update : String((update || {}).status || '');
  const selected = UPDATE_PRESENTATION[status];
  if (selected) return Object.assign({}, selected);
  return { key: 'error', label: '异常', tone: 'danger', detail: '无法识别内部状态：' + (status || 'empty'), action: 'inspect-status' };
}

function ownershipLabel(ownership) {
  return OWNERSHIP_LABELS[String(ownership || '')] || '未知来源';
}

function severityPresentation(severity) {
  return Object.assign({}, SEVERITY_PRESENTATION[String(severity || '')] || SEVERITY_PRESENTATION.INFO);
}

function summarizeHealth(issues) {
  const selected = Array.isArray(issues) ? issues : [];
  const counts = { errors: 0, warnings: 0, info: 0 };
  selected.forEach(function count(issue) {
    if (issue.severity === 'ERROR') counts.errors += 1;
    else if (issue.severity === 'WARN') counts.warnings += 1;
    else counts.info += 1;
  });
  let severity = null;
  let count = 0;
  if (counts.errors) { severity = 'ERROR'; count = counts.errors; }
  else if (counts.warnings) { severity = 'WARN'; count = counts.warnings; }
  else if (counts.info) { severity = 'INFO'; count = counts.info; }
  if (!severity) return Object.assign({ total: 0, severity: null, count: 0, label: '' }, counts, { level: 'clear', tone: 'neutral' });
  const display = severityPresentation(severity);
  return Object.assign({
    total: selected.length,
    severity,
    count,
    label: count + ' ' + display.label,
    level: display.level,
    tone: display.tone,
  }, counts);
}

function inside(root, selected) {
  return selected === root || selected.indexOf(root + path.sep) === 0;
}

function issuesForSkill(skill, issues) {
  const roots = new Set();
  if (skill && skill.path) roots.add(path.resolve(skill.path));
  if (skill && skill.physical_path) roots.add(path.resolve(skill.physical_path));
  ((skill && skill.locations) || []).forEach(function location(item) {
    if (item.path) roots.add(path.resolve(item.path));
  });
  return (issues || []).filter(function related(issue) {
    return (issue.paths || []).some(function issuePath(selected) {
      const normalized = path.resolve(selected);
      return Array.from(roots).some(function matching(root) { return inside(root, normalized); });
    });
  });
}

function accessPresentation(mode) {
  if (mode === 'managed') return { key: 'writable', label: '用户库 · 可写', tone: 'managed', can_write: true };
  return { key: 'read-only', label: '扫描来源 · 只读', tone: 'observed', can_write: false };
}

module.exports = {
  accessPresentation,
  issuesForSkill,
  ownershipLabel,
  presentUpdateStatus,
  severityPresentation,
  summarizeHealth,
};
