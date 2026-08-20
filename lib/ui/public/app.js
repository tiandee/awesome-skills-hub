'use strict';

(function boot() {
  const sessionToken = document.querySelector('meta[name="ash-session"]').content;
  const initialParams = new URLSearchParams(window.location.search);
  const state = {
    overview: null,
    selectedSkill: null,
    severity: ['ALL', 'ERROR', 'WARN', 'INFO'].indexOf(initialParams.get('severity')) !== -1
      ? initialParams.get('severity') : 'ALL',
    libraryFilter: initialParams.get('root') || 'all',
    skillLimit: 60,
    modal: null,
    workflow: null,
    workflowContext: null,
    sourceDiscoverySequence: 0,
    modalReturnFocus: null,
    toastTimer: null,
  };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(value) {
    if (!value) return '尚未检查';
    const selected = new Date(value);
    if (Number.isNaN(selected.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(selected);
  }

  async function api(route, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    if (opts.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['X-ASH-Session'] = sessionToken;
    }
    const response = await fetch(route, Object.assign({}, opts, { headers }));
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error ? payload.error.message : '请求失败');
      error.code = payload.error ? payload.error.code : 'REQUEST_FAILED';
      throw error;
    }
    return payload;
  }

  function post(route, body) {
    return api(route, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  function showToast(message, isError) {
    const toast = document.getElementById('toast');
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-error', Boolean(isError));
    toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(function hide() { toast.classList.remove('is-visible'); }, 4200);
  }

  function syncUrlState() {
    const params = new URLSearchParams();
    const query = document.getElementById('skill-search').value.trim();
    if (query) params.set('q', query);
    if (state.severity !== 'ALL') params.set('severity', state.severity);
    if (state.libraryFilter !== 'all') params.set('root', state.libraryFilter);
    const search = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (search ? '?' + search : '') + window.location.hash);
  }

  function setActionBusy(actionName, busy, busyLabel) {
    document.querySelectorAll('[data-action="' + actionName + '"]').forEach(function button(item) {
      if (busy) {
        item.dataset.wasDisabled = String(item.disabled);
        item.dataset.idleLabel = item.textContent;
        item.textContent = busyLabel;
        item.disabled = true;
        item.setAttribute('aria-busy', 'true');
      } else if (item.dataset.idleLabel) {
        item.textContent = item.dataset.idleLabel;
        item.disabled = item.dataset.wasDisabled === 'true';
        delete item.dataset.idleLabel;
        delete item.dataset.wasDisabled;
        item.removeAttribute('aria-busy');
      }
    });
  }

  function updatePresentation(update) {
    return (update && update.display) || { key: 'error', label: '异常', tone: 'danger', detail: '缺少状态展示信息' };
  }

  function toneClass(tone) {
    return ' tone-' + (tone || 'neutral');
  }

  function sourceLink(item, label) {
    return '<a class="source-link source-link-' + escapeHtml(item.kind) + '" href="' + escapeHtml(item.url) +
      '" target="_blank" rel="noopener noreferrer" translate="no" aria-label="' + escapeHtml((label || item.label) + '（在新标签页打开）') + '">' +
      escapeHtml(label || item.label) + '<span aria-hidden="true">↗</span></a>';
  }

  function severityLabel(severity) {
    if (severity === 'ERROR') return '错误';
    if (severity === 'WARN') return '警告';
    return '提示';
  }

  function healthBadge(health) {
    if (!health || !health.total) return '<span class="health-empty" aria-label="健康：无问题">—</span>';
    return '<span class="status-pill health-pill' + toneClass(health.tone) + '" aria-label="健康：' + escapeHtml(health.label) + '"><span class="visually-hidden">健康：</span>' + escapeHtml(health.label) + '</span>';
  }

  function updateReason(update) {
    if ((update || {}).error) return update.error;
    if (update && update.status === 'unmanaged') return '本地 Skill 可以正常使用，但尚未记录 GitHub 仓库与目录，无法检查更新。';
    if (update && update.baseline_reason === 'content-hash-not-remotely-comparable') return '安装锁使用 64 位本地内容摘要，v1 不会将它与远端 Git tree SHA 混合比较。';
    if (update && update.baseline_reason === 'missing-folder-hash') return '安装锁没有可比较的目录哈希。';
    if (update && update.baseline_reason) return '安装锁哈希格式暂不支持自动更新。';
    return '';
  }

  function metricCard(index, label, value, note, alert) {
    return '<article class="metric-card' + (alert ? ' is-alert' : '') + '" data-index="' + index + '">' +
      '<span class="metric-label">' + escapeHtml(label) + '</span>' +
      '<strong class="metric-value">' + escapeHtml(value) + '</strong>' +
      '<span class="metric-note">' + escapeHtml(note) + '</span>' +
      '</article>';
  }

  function issueCompact(item) {
    const label = severityLabel(item.severity);
    return '<div class="issue-compact">' +
      '<span class="issue-dot ' + escapeHtml(item.severity) + '" aria-hidden="true"></span>' +
      '<div><strong>' + escapeHtml(item.code) + '</strong><p>' + escapeHtml(item.message) + '</p></div>' +
      '<span>' + escapeHtml(label) + '</span>' +
      '</div>';
  }

  function sourceInsightMetric(label, value, note, tone) {
    return '<div class="source-insight-metric' + (tone ? ' is-' + tone : '') + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><p>' + escapeHtml(note) + '</p></div>';
  }

  function renderSourceInsights() {
    const insight = state.overview.source_insights;
    const counts = insight.counts;
    const stale = insight.stale_skills.slice(0, 5);
    const repositories = insight.repositories.slice(0, 5);
    document.getElementById('source-insights').innerHTML =
      '<div class="source-insight-grid">' +
        sourceInsightMetric('TRACKED SOURCE', insight.coverage_percent.toFixed(1) + '%', counts.tracked + ' / ' + counts.total + ' with source identity', '') +
        sourceInsightMetric('UPDATE READY', insight.update_ready_percent.toFixed(1) + '%', counts.update_ready + ' can check now', counts.update_ready ? 'signal' : 'muted') +
        sourceInsightMetric('NEEDS BASELINE', counts.baseline_missing, counts.unlinked + ' remain unlinked', counts.baseline_missing ? 'warn' : '') +
        sourceInsightMetric('STALE > ' + insight.stale_after_days + 'D', counts.stale, counts.undated + ' tracked without dates', counts.stale ? 'warn' : '') +
      '</div>' +
      '<div class="source-observatory-ledger"><div><h3>SOURCE HEALTH</h3><p class="source-observatory-lead">' +
        (insight.anomalies ? insight.anomalies + ' 个来源或本地安装异常需要处理。' : '当前没有来源不可用或本地缺失项。') + '</p>' +
        '<ul>' + repositories.map(function repository(item) { return '<li><code>' + escapeHtml(item.source) + '</code><span>' + item.count + '</span></li>'; }).join('') + '</ul></div>' +
        '<div><h3>OLDEST TRACKED</h3>' + (stale.length ? '<ul>' + stale.map(function oldSkill(item) {
          return '<li><code>' + escapeHtml(item.name) + '</code><span>' + item.age_days + 'd</span></li>';
        }).join('') + '</ul>' : '<p class="source-observatory-lead">没有超过时效窗口的来源记录。</p>') + '</div></div>';
  }

  function renderOverview() {
    const data = state.overview;
    const summary = data.summary;
    const issues = summary.issues;
    const updates = summary.updates;
    const checkedUpdateCount = updates.up_to_date + updates.update_available + updates.source_unavailable;
    document.getElementById('library-path').textContent = data.library.path +
      (summary.scan_roots > 1 ? '  +' + (summary.scan_roots - 1) + ' read-only roots' : '');
    document.getElementById('metric-grid').innerHTML = [
      metricCard('01', 'SCANNED SKILLS', formatNumber(summary.skills), summary.managed_skills + ' managed · ' + summary.scan_roots + ' roots', false),
      metricCard('02', 'PORTABLE FILES', formatNumber(summary.files), formatBytes(summary.bytes) + ' scanned content', false),
      metricCard('03', 'HEALTH ISSUES', formatNumber(issues.total), issues.errors + ' 错误 · ' + issues.warnings + ' 警告', issues.total > 0),
      metricCard('04', 'SKILL UPDATES', data.updates.checked_at ? formatNumber(updates.update_available) : '—', data.updates.checked_at
        ? checkedUpdateCount + ' checked · ' + updates.source_unavailable + ' unavailable'
        : updates.eligible + ' checkable · manual trigger', updates.update_available > 0),
    ].join('');

    document.getElementById('overview-issues').innerHTML = data.issues.length
      ? data.issues.slice(0, 5).map(issueCompact).join('')
      : '<div class="healthy-state"><div><strong>ALL CLEAR</strong><p>当前扫描目录没有诊断项。</p></div></div>';

    const repair = data.repair;
    document.getElementById('overview-repair').innerHTML =
      '<div class="repair-count">' + repair.action_count + '</div>' +
      '<p class="repair-copy">' + (repair.conflict_count
        ? '存在冲突，ASH 会拒绝写入，直到冲突被人工处理。'
        : repair.action_count ? '仅维护 ASH 标记的 Codex 创建引导；用户 Skill 与自定义扫描目录始终不改动。' : 'Codex 创建引导已处于期望状态。') + '</p>' +
      '<ul class="repair-scope-list">' +
        '<li><span>CODEX GUIDANCE</span><span>' + repair.actions.filter(function guidance(item) { return item.scope === 'codex-guidance'; }).length + '</span></li>' +
      '</ul>' +
      '<button class="primary-button" type="button" data-action="preview-repair"' +
        ((!repair.action_count || repair.conflict_count) ? ' disabled' : '') + '>预览修复计划</button>';
    renderSourceInsights();
  }

  function renderLibraryFilters() {
    const libraries = state.overview.libraries;
    if (state.libraryFilter !== 'all' && !libraries.some(function exists(item) { return item.id === state.libraryFilter; })) {
      state.libraryFilter = 'all';
      syncUrlState();
    }
    document.getElementById('library-filters').innerHTML =
      '<button class="library-filter' + (state.libraryFilter === 'all' ? ' is-active' : '') + '" type="button" data-library-filter="all">全部 <small>' + state.overview.summary.skills + '</small></button>' +
      libraries.map(function library(item) {
        const filter = '<button class="library-filter' + (state.libraryFilter === item.id ? ' is-active' : '') + '" type="button" data-library-filter="' + escapeHtml(item.id) + '" title="' + escapeHtml(item.path) + '">' +
          escapeHtml(item.name) + ' <small>' + item.skill_count + '</small></button>';
        if (item.mode === 'managed') return filter;
        return '<span class="library-filter-shell">' + filter + '<button class="library-remove" type="button" data-action="remove-root" data-library-id="' + escapeHtml(item.id) + '" aria-label="停止扫描 ' + escapeHtml(item.name) + '">×</button></span>';
      }).join('');
  }

  function filteredSkills() {
    const search = document.getElementById('skill-search').value.trim().toLowerCase();
    return state.overview.skills.filter(function matches(skill) {
      const matchesRoot = state.libraryFilter === 'all' || skill.library_ids.indexOf(state.libraryFilter) !== -1;
      const matchesSearch = !search || skill.name.toLowerCase().indexOf(search) !== -1 ||
        skill.description.toLowerCase().indexOf(search) !== -1 || skill.library_name.toLowerCase().indexOf(search) !== -1;
      return matchesRoot && matchesSearch;
    });
  }

  function renderLibrary() {
    renderLibraryFilters();
    const skills = filteredSkills();
    const container = document.getElementById('skill-list');
    if (!skills.length) {
      container.innerHTML = '<div class="empty-state"><div><span class="empty-glyph" aria-hidden="true">∅</span><h2>没有匹配项</h2><p>切换扫描来源或换一个关键词。</p></div></div>';
      return;
    }
    const visible = skills.slice(0, state.skillLimit);
    container.innerHTML = visible.map(function row(skill) {
      const active = state.selectedSkill && state.selectedSkill.key === skill.key;
      const origin = skill.update && skill.update.source_origin;
      const originLabel = origin && (origin.kind === 'skills-sh' || origin.kind === 'github-direct') ? ' · ' + origin.label : '';
      const sourceLabel = skill.access.label + (skill.linked_source_count ? ' · ' + skill.linked_source_count + ' 个关联位置' : '') + originLabel;
      const updateDisplay = updatePresentation(skill.update);
      return '<button class="skill-row' + (active ? ' is-active' : '') + '" type="button" data-skill="' + escapeHtml(skill.name) + '" data-library-id="' + escapeHtml(skill.library_id) + '">' +
        '<div><strong>' + escapeHtml(skill.name) + '</strong><p>' + escapeHtml(sourceLabel) + ' · ' + escapeHtml(skill.description || '缺少描述') + '</p></div>' +
        '<span class="size"><span class="visually-hidden">体量：</span>' + skill.file_count + ' files<br>' + skill.line_count + ' lines</span>' +
        '<span class="status-pill update-pill' + toneClass(updateDisplay.tone) + '" title="' + escapeHtml(updateDisplay.detail) + '"><span class="visually-hidden">更新：</span>' + escapeHtml(updateDisplay.label) + '</span>' +
        healthBadge(skill.health) +
        '</button>';
    }).join('') + (visible.length < skills.length
      ? '<div class="list-more"><button class="secondary-button" type="button" data-action="load-more-skills">再显示 ' + Math.min(60, skills.length - visible.length) + ' 个</button></div>' : '');
  }

  function renderSkillDetail() {
    const container = document.getElementById('skill-detail');
    const skill = state.selectedSkill;
    if (!skill) {
      container.innerHTML = '<div class="empty-state"><span class="empty-glyph" aria-hidden="true">↳</span><h2>选择一个 Skill</h2><p>查看来源、文件、正文和可用操作。</p></div>';
      return;
    }
    const issues = skill.issues.length ? skill.issues.map(issueCompact).join('') : '<p>这个 Skill 没有关联诊断。</p>';
    const locations = skill.locations.map(function location(item) {
      return '<div class="skill-location"><span>' + escapeHtml((item.access || {}).label || item.library_name) + '</span><code>' + escapeHtml(item.path) + '</code></div>';
    }).join('');
    const update = skill.update || { status: 'unmanaged' };
    const updateDisplay = updatePresentation(update);
    const updateSource = update.source || update.source_url || update.ownership_label || '未记录';
    const sourceOrigin = update.source_origin || { kind: 'none', label: '未关联' };
    const sourceLinks = update.source_links || [];
    const repositoryLink = sourceLinks.find(function repository(item) { return item.kind === 'github-repository'; });
    const sourceValue = repositoryLink ? sourceLink(repositoryLink, updateSource) : '<code translate="no">' + escapeHtml(updateSource || '未记录') + '</code>';
    const sourcePath = update.skill_path
      ? '<div class="source-path"><span>Skill 路径</span><code translate="no">' + escapeHtml(update.skill_path) + '</code></div>' : '';
    const sourceLinkBar = sourceLinks.length
      ? '<nav class="source-links" aria-label="外部来源链接">' + sourceLinks.map(function link(item) { return sourceLink(item); }).join('') + '</nav>' : '';
    const updateNote = updateReason(update);
    const updateNoteClass = update.error || update.status === 'source-unavailable' || update.status === 'missing' ? 'update-error' : 'update-note';
    const updateAction = skill.can_write && update.status === 'update-available'
      ? '<button class="primary-button" type="button" data-action="preview-skill-update">预览更新</button>'
      : skill.can_write && update.status === 'checkable'
        ? '<button class="secondary-button" type="button" data-action="check-updates" data-skill-name="' + escapeHtml(skill.name) + '">检查当前 Skill</button>'
        : skill.can_write && update.status === 'unmanaged'
          ? '<button class="primary-button" type="button" data-action="open-link-source">从 skills.sh 接管</button>'
          : skill.can_write && update.status === 'baseline-missing'
            ? '<button class="primary-button" type="button" data-action="preview-rebuild-baseline">重建基线</button>' : '';
    container.innerHTML =
      '<div class="detail-head"><span class="detail-source' + (skill.library_mode === 'observe' ? ' is-observe' : '') + '">' + escapeHtml(skill.access.label) + (skill.linked_source_count ? ' · ' + skill.linked_source_count + ' 个关联位置' : '') + '</span>' +
        '<h2>' + escapeHtml(skill.name) + '</h2><p>' + escapeHtml(skill.description || '缺少 description') + '</p></div>' +
      '<div class="detail-toolbar">' + (skill.can_write
        ? '<button class="secondary-button" type="button" data-action="open-edit-description">修改描述</button>' : '') +
        '<button class="secondary-button" type="button" data-action="preview-package" data-skill="' + escapeHtml(skill.name) + '" data-library-id="' + escapeHtml(skill.library_id) + '">打包 .skill</button>' + updateAction + '</div>' +
      '<div class="detail-meta"><div><span>FILES</span><strong>' + skill.file_count + '</strong></div><div><span>LINES</span><strong>' + skill.line_count + '</strong></div><div><span>SIZE</span><strong>' + escapeHtml(formatBytes(skill.total_bytes)) + '</strong></div></div>' +
      '<div class="detail-section update-source"><h3>更新来源</h3><div class="update-source-grid"><div><span>更新状态</span><strong class="update-state' + toneClass(updateDisplay.tone) + '">' + escapeHtml(updateDisplay.label) + '</strong></div><div><span>管理方式</span><strong>' + escapeHtml(update.ownership_label || '未知来源') + '</strong></div><div><span>接管渠道</span><strong class="source-origin is-' + escapeHtml(sourceOrigin.kind) + '">' + escapeHtml(sourceOrigin.label) + '</strong></div><div><span>上游仓库</span>' + sourceValue + '</div></div>' +
        ((sourcePath || sourceLinkBar) ? '<div class="source-identity">' + sourcePath + sourceLinkBar + '</div>' : '') +
        '<p class="update-note">' + escapeHtml(updateDisplay.detail) + '</p>' +
        (updateNote ? '<p class="' + updateNoteClass + '">' + escapeHtml(updateNote) + '</p>' : '') + '</div>' +
      '<div class="detail-section"><h3>LOCATIONS</h3><div class="skill-locations">' + locations + '</div></div>' +
      '<div class="detail-section"><h3>FILES</h3><div class="file-cloud">' + skill.files.map(function file(name) { return '<span>' + escapeHtml(name) + '</span>'; }).join('') + '</div></div>' +
      '<div class="detail-section"><h3>健康诊断</h3>' + issues + '</div>' +
      '<div class="detail-section"><h3>SKILL.MD / 只读</h3><pre class="skill-source">' + escapeHtml(skill.skill_md) + '</pre></div>';
  }

  function renderHealth() {
    document.querySelectorAll('[data-severity]').forEach(function selected(item) {
      const active = item.dataset.severity === state.severity;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    const issues = state.overview.issues.filter(function severity(item) { return state.severity === 'ALL' || item.severity === state.severity; });
    const container = document.getElementById('issue-ledger');
    if (!issues.length) {
      container.innerHTML = '<div class="healthy-state"><div><strong>无诊断问题</strong><p>这个严重等级下没有诊断项。</p></div></div>';
      return;
    }
    container.innerHTML = issues.map(function row(item) {
      return '<article class="issue-row"><span class="severity-badge ' + escapeHtml(item.severity) + '">' + escapeHtml(severityLabel(item.severity)) + '</span>' +
        '<h3>' + escapeHtml(item.code) + '</h3><div><p class="issue-message">' + escapeHtml(item.message) + '</p><ul class="issue-paths">' +
        item.paths.map(function itemPath(value) { return '<li>' + escapeHtml(value) + '</li>'; }).join('') + '</ul></div></article>';
    }).join('');
  }

  function actionItems(actions) {
    return actions.length ? actions.map(function item(action) { return '<li>' + escapeHtml(action.description || action) + '</li>'; }).join('') : '<li>当前没有可执行动作</li>';
  }

  function renderSnapshots() {
    const snapshots = state.overview.snapshots;
    const list = snapshots.length ? snapshots.map(function row(snapshot) {
      return '<div class="snapshot-row"><div><strong>' + escapeHtml(snapshot.file) + '</strong><span>' + (snapshot.valid
        ? snapshot.skill_count + ' Skills · ' + formatBytes(snapshot.bytes) : 'INVALID · ' + escapeHtml(snapshot.error)) + '</span></div>' +
        '<span>' + escapeHtml(snapshot.created_at || 'unknown') + '</span><div class="snapshot-actions">' +
        (snapshot.valid ? '<button class="secondary-button" type="button" data-action="verify-snapshot" data-snapshot="' + escapeHtml(snapshot.snapshot_id) + '">校验</button>' +
          '<button class="secondary-button" type="button" data-action="preview-snapshot-restore" data-snapshot="' + escapeHtml(snapshot.snapshot_id) + '">恢复缺失项</button>' : '') +
        '</div></div>';
    }).join('') : '<div class="snapshot-empty">还没有页面受管快照。创建后可在这里校验或增量恢复缺失 Skill。</div>';
    document.getElementById('snapshot-card').innerHTML =
      '<div class="snapshot-head"><div><span class="action-number" aria-hidden="true">06</span><span class="eyebrow">USER SNAPSHOTS</span><h2>备份与增量恢复</h2><p>仅包含受管用户库；系统、插件、自定义只读扫描目录不会进入快照。</p></div>' +
      '<button class="primary-button" type="button" data-action="preview-snapshot-create">创建快照</button></div><div class="snapshot-list">' + list + '</div>';
  }

  function renderMaintenance() {
    const repair = state.overview.repair;
    const rollback = state.overview.rollback;
    const updates = state.overview.updates;
    const updateRollback = state.overview.update_rollback;
    const retention = state.overview.retention;
    const checked = Boolean(updates.checked_at);
    document.getElementById('update-card').innerHTML =
      '<span class="action-number" aria-hidden="true">01</span><span class="eyebrow">SOURCE-AWARE UPDATE</span><h2>检查用户 Skill 更新</h2><p>' +
        (checked ? '最近检查：' + escapeHtml(formatDate(updates.checked_at)) + '。发现 ' + updates.summary.update_available + ' 个可更新 Skill。' : '只检查来源锁完整的 GitHub 用户 Skill；不会自动联网。') + '</p>' +
      '<ul class="action-list"><li><span>可检查</span><span>' + updates.summary.eligible + '</span></li><li><span>可更新</span><span>' + updates.summary.update_available + '</span></li><li><span>最新</span><span>' + updates.summary.up_to_date + '</span></li><li><span>待接管</span><span>' + updates.summary.unmanaged + '</span></li><li><span>待重建</span><span>' + updates.summary.baseline_missing + '</span></li></ul>' +
      '<button class="primary-button" type="button" data-action="check-updates">' + (checked ? '重新检查' : '检查更新') + '</button>';
    document.getElementById('update-rollback-card').innerHTML =
      '<span class="action-number" aria-hidden="true">02</span><span class="eyebrow">UPDATE ROLLBACK</span><h2>回滚最近 Skill 更新</h2><p>' +
        (updateRollback.available ? '最近更新：' + escapeHtml(updateRollback.name) + '。回滚前会验证 Skill、锁文件和本地保留项。' : '当前没有可安全回滚的 Skill 更新事务。') + '</p>' +
      '<ul class="action-list">' + actionItems(updateRollback.available ? [updateRollback.description] : []) + '</ul>' +
      '<button class="secondary-button" type="button" data-action="preview-update-rollback"' + (!updateRollback.available ? ' disabled' : '') + '>预览更新回滚</button>';
    document.getElementById('repair-card').innerHTML =
      '<span class="action-number" aria-hidden="true">03</span><span class="eyebrow">REPAIR</span><h2>修复 Codex 创建引导</h2><p>只维护 ~/.codex/AGENTS.md 中由 ASH 标记的区块。</p>' +
      '<ul class="action-list">' + actionItems(repair.actions) + '</ul><button class="primary-button" type="button" data-action="preview-repair"' + ((!repair.action_count || repair.conflict_count) ? ' disabled' : '') + '>生成新的预览</button>';
    document.getElementById('rollback-card').innerHTML =
      '<span class="action-number" aria-hidden="true">04</span><span class="eyebrow">ROLLBACK</span><h2>回滚最近事务</h2><p>' + (rollback.available
        ? '最近事务：' + escapeHtml(rollback.transaction_id) + '。执行前会重新验证目标文件。' : '当前没有已完成的修复事务可供回滚。') + '</p>' +
      '<ul class="action-list">' + actionItems(rollback.descriptions) + '</ul><button class="secondary-button" type="button" data-action="preview-rollback"' + (!rollback.available ? ' disabled' : '') + '>预览最近回滚</button>';
    document.getElementById('retention-card').innerHTML =
      '<div class="retention-head"><div><span class="action-number" aria-hidden="true">05</span><span class="eyebrow">RETENTION / IRREVERSIBLE</span><h2>清理历史事务</h2><p>保留每类最近 ' + retention.policy.keep_count + ' 次或 ' + retention.policy.max_age_days + ' 天内记录，并始终保护当前可回滚事务。</p></div>' +
        '<button class="secondary-button" type="button" data-action="preview-transaction-prune"' + (!retention.action_count ? ' disabled' : '') + '>预览事务清理</button></div>' +
      '<ul class="action-list retention-summary"><li><span>TOTAL</span><span>' + retention.summary.total + '</span></li><li><span>PROTECTED</span><span>' + ((retention.protected.repair ? 1 : 0) + (retention.protected.update ? 1 : 0)) + '</span></li><li><span>PRUNE</span><span>' + retention.summary.delete_count + '</span></li><li><span>RECLAIM</span><span>' + escapeHtml(formatBytes(retention.summary.delete_bytes)) + '</span></li></ul>';
    renderSnapshots();
  }

  function renderAll() {
    renderOverview();
    renderLibrary();
    renderSkillDetail();
    renderHealth();
    renderMaintenance();
  }

  function skillUrl(name, libraryId) {
    return '/api/skills/' + encodeURIComponent(libraryId || 'managed') + '/' + encodeURIComponent(name);
  }

  async function loadOverview(options) {
    const opts = options || {};
    const refresh = document.getElementById('refresh-button');
    refresh.disabled = true;
    try {
      const selected = state.selectedSkill && { name: state.selectedSkill.name, library_id: state.selectedSkill.library_id };
      state.overview = await api('/api/overview');
      if (selected && state.overview.skills.some(function same(skill) { return skill.name === selected.name && skill.library_id === selected.library_id; })) {
        state.selectedSkill = await api(skillUrl(selected.name, selected.library_id));
      } else if (selected) state.selectedSkill = null;
      renderAll();
      if (!opts.silent) showToast('已扫描 ' + state.overview.summary.scan_roots + ' 个目录、' + state.overview.summary.skills + ' 个 Skill。');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      refresh.disabled = false;
    }
  }

  async function selectSkill(name, libraryId) {
    try {
      state.selectedSkill = await api(skillUrl(name, libraryId));
      renderLibrary();
      renderSkillDetail();
    } catch (error) { showToast(error.message, true); }
  }

  const confirmations = {
    'transaction-prune': { eyebrow: 'RETENTION / IRREVERSIBLE', title: '确认清理历史事务', description: '这些历史目录会被永久删除。当前可安全回滚的 Repair 与 Skill 更新事务不会进入本计划。', apply: '永久删除', route: '/api/transactions/prune/apply', id: 'plan_id', busy: '正在清理…', success: '历史事务已清理。' },
    'skill-source': { eyebrow: 'SOURCE BASELINE / PREVIEW FIRST', title: '确认建立更新来源', description: '将记录 GitHub 来源与标准基线；若本地内容不同，会按下方差异采用上游版本，同时保留明确列出的本地项。', apply: '应用来源变更', route: '/api/updates/source/apply', id: 'plan_id', busy: '正在建立来源…', success: '更新来源与基线已建立。' },
    'skill-update': { eyebrow: 'UPSTREAM DIFF / ONE SKILL', title: '确认更新 Skill', description: '将按文件差异更新一个受管 Skill；确认时会重新拉取上游并验证本地内容、锁和远端哈希。', apply: '执行更新', route: '/api/updates/apply', id: 'plan_id', busy: '正在更新…', success: 'Skill 已安全更新。' },
    'skill-update-rollback': { eyebrow: 'UPDATE TRANSACTION / ROLLBACK', title: '确认回滚 Skill 更新', description: '回滚前会验证更新后的 Skill、本地保留项和安装锁均未变化。', apply: '回滚更新', route: '/api/updates/rollback/apply', id: 'rollback_id', busy: '正在回滚…', success: 'Skill 更新已安全回滚。' },
    repair: { eyebrow: 'REPAIR PREVIEW / ONE-TIME', title: '确认修复计划', description: '确认时服务会重新扫描；状态变化会让预览失效。', apply: '执行修复', route: '/api/repair/apply', id: 'plan_id', busy: '正在修复…', success: '修复事务已完成。' },
    rollback: { eyebrow: 'ROLLBACK PREVIEW / ONE-TIME', title: '确认回滚事务', description: '回滚前会验证文件类型和哈希，用户后续修改不会被覆盖。', apply: '执行回滚', route: '/api/rollback/apply', id: 'rollback_id', busy: '正在回滚…', success: '最近修复事务已安全回滚。' },
    'library-add': { eyebrow: 'SCAN ROOT / READ ONLY', title: '添加扫描目录', description: '只记录扫描来源，不修改目录内容。', apply: '添加目录', route: '/api/libraries/apply', id: 'plan_id', busy: '正在添加…', success: '自定义扫描目录已添加。' },
    'library-remove': { eyebrow: 'SCAN ROOT / REMOVE REFERENCE', title: '停止扫描目录', description: '只移除页面配置，不删除目录或任何 Skill。', apply: '停止扫描', route: '/api/libraries/apply', id: 'plan_id', busy: '正在移除…', success: '已停止扫描该目录。' },
    'skill-create': { eyebrow: 'CREATE / MANAGED LIBRARY', title: '创建用户 Skill', description: '目标只允许写入受管用户库；确认时会重新检查同名目录。', apply: '创建 Skill', route: '/api/skills/create/apply', id: 'plan_id', busy: '正在创建…', success: '用户 Skill 已创建。' },
    'skill-edit': { eyebrow: 'METADATA / TRANSACTIONAL', title: '修改 Skill 描述', description: '只修改受管 SKILL.md 的 description，并记录可回滚事务。', apply: '更新描述', route: '/api/skills/description/apply', id: 'plan_id', busy: '正在更新…', success: 'Skill 描述已更新。' },
    package: { eyebrow: 'PACKAGE / DETERMINISTIC', title: '打包 Skill', description: '输出到 ASH packages 目录，不修改 Skill 源文件。', apply: '生成 .skill', route: '/api/packages/apply', id: 'plan_id', busy: '正在打包…', success: 'Skill 包已生成。' },
    'snapshot-create': { eyebrow: 'SNAPSHOT / USER LIBRARY ONLY', title: '创建用户库快照', description: '快照仅包含受管用户 Skill，不包含自定义扫描目录。', apply: '创建快照', route: '/api/snapshots/create/apply', id: 'plan_id', busy: '正在创建…', success: '用户库快照已创建。' },
    'snapshot-restore': { eyebrow: 'SNAPSHOT / ADDITIVE RESTORE', title: '恢复缺失 Skill', description: '只创建缺失项；同名不同内容会阻止整次恢复。', apply: '恢复缺失项', route: '/api/snapshots/restore/apply', id: 'plan_id', busy: '正在恢复…', success: '缺失 Skill 已恢复。' },
  };

  function openConfirmation(kind, payload) {
    const config = confirmations[kind];
    state.modalReturnFocus = document.activeElement;
    state.modal = { kind, payload };
    document.getElementById('modal-eyebrow').textContent = config.eyebrow;
    document.getElementById('modal-title').textContent = config.title;
    document.getElementById('modal-description').textContent = config.description;
    const actions = payload.actions ? payload.actions.map(function action(item) { return item.description || item; }) : payload.descriptions || [];
    document.getElementById('modal-actions').innerHTML = actions.map(function row(item) { return '<div class="modal-action">' + escapeHtml(item) + '</div>'; }).join('');
    const checkbox = document.getElementById('modal-confirm-check');
    checkbox.checked = false;
    const applyButton = document.getElementById('modal-apply');
    applyButton.textContent = config.apply;
    applyButton.disabled = true;
    document.getElementById('confirmation-modal').hidden = false;
    document.body.classList.add('modal-open');
    checkbox.focus();
  }

  function closeConfirmation() {
    state.modal = null;
    document.getElementById('confirmation-modal').hidden = true;
    if (!state.workflow) document.body.classList.remove('modal-open');
    if (state.modalReturnFocus && typeof state.modalReturnFocus.focus === 'function') state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  function workflowField(label, name, options) {
    const opts = options || {};
    const control = opts.multiline
      ? '<textarea id="workflow-' + name + '" name="' + name + '" placeholder="' + escapeHtml(opts.placeholder || '') + '" required>' + escapeHtml(opts.value || '') + '</textarea>'
      : '<input id="workflow-' + name + '" name="' + name + '" type="text" value="' + escapeHtml(opts.value || '') + '" placeholder="' + escapeHtml(opts.placeholder || '') + '" autocomplete="off" spellcheck="false"' + (opts.required === false ? '' : ' required') + '>';
    return '<label class="workflow-field"><span>' + escapeHtml(label) + '</span>' + control + (opts.hint ? '<p class="workflow-hint">' + escapeHtml(opts.hint) + '</p>' : '') + '</label>';
  }

  function sourceDiscoveryShell() {
    return '<section class="source-discovery" id="source-discovery" aria-live="polite">' +
      '<div class="source-discovery-head"><div><span>AUTO DISCOVERY / EXPERIMENTAL</span><h3>正在查找精确同名来源…</h3></div>' +
      '<button class="secondary-button compact-button" type="button" data-action="retry-source-discovery" disabled>查找中…</button></div>' +
      '<p class="source-discovery-note">只查询候选，不会自动选择、下载或接管。</p>' +
      '<div class="source-discovery-loading" aria-hidden="true"><i></i><i></i><i></i></div></section>';
  }

  function renderSourceDiscovery(result) {
    const container = document.getElementById('source-discovery');
    if (!container) return;
    const candidates = result.candidates || [];
    const title = result.state === 'unavailable'
      ? '自动发现暂不可用'
      : result.state === 'no-match'
        ? '没有找到精确同名来源'
        : result.state === 'stale-cache'
          ? '显示缓存候选，请谨慎核对'
          : '找到 ' + candidates.length + ' 个精确同名来源';
    const note = result.error || (candidates.length
      ? '请选择明确的 owner/repo/skill。安装量只反映使用情况，不代表来源可信度；选择后仍需生成差异预览并确认。'
      : '你仍可在下方手动粘贴准确的 skills.sh URL，或填写 GitHub 仓库与 Skill 路径。');
    container.classList.toggle('is-warning', result.state === 'unavailable' || result.state === 'stale-cache');
    container.innerHTML = '<div class="source-discovery-head"><div><span>AUTO DISCOVERY / EXPERIMENTAL</span><h3>' + escapeHtml(title) + '</h3></div>' +
      '<button class="secondary-button compact-button" type="button" data-action="retry-source-discovery">重新查找</button></div>' +
      '<p class="source-discovery-note">' + escapeHtml(note) + '</p>' +
      (candidates.length ? '<div class="source-candidates">' + candidates.map(function candidate(item) {
        return '<button class="source-candidate" type="button" data-source-candidate-url="' + escapeHtml(item.skills_url) + '">' +
          '<span class="source-candidate-id"><strong>' + escapeHtml(item.source) + '</strong><code>' + escapeHtml(item.slug) + '</code></span>' +
          '<span class="source-candidate-meta">' + formatNumber(item.installs) + ' installs</span><b>选择</b></button>';
      }).join('') + '</div><p class="source-discovery-selection" id="source-discovery-selection">尚未选择候选。</p>' : '');
  }

  async function discoverWorkflowSource() {
    if (state.workflow !== 'link-source' || !state.workflowContext) return;
    const name = state.workflowContext.name;
    const sequence = ++state.sourceDiscoverySequence;
    const container = document.getElementById('source-discovery');
    if (container) container.outerHTML = sourceDiscoveryShell();
    try {
      const result = await post('/api/updates/source/discover', { name });
      if (sequence !== state.sourceDiscoverySequence || state.workflow !== 'link-source' || !state.workflowContext || state.workflowContext.name !== name) return;
      renderSourceDiscovery(result);
    } catch (error) {
      if (sequence !== state.sourceDiscoverySequence || state.workflow !== 'link-source') return;
      renderSourceDiscovery({ state: 'unavailable', candidates: [], error: error.message });
    }
  }

  function openWorkflow(kind, context) {
    state.modalReturnFocus = document.activeElement;
    state.workflow = kind;
    state.workflowContext = context || null;
    const root = kind === 'add-root';
    const editing = kind === 'edit-description';
    const linking = kind === 'link-source';
    document.getElementById('workflow-eyebrow').textContent = root ? 'CUSTOM SCAN ROOT / READ ONLY' : editing ? 'METADATA / MANAGED USER LIBRARY' : linking ? 'GITHUB SOURCE / MANAGED UPDATE' : 'CREATE / MANAGED USER LIBRARY';
    document.getElementById('workflow-title').textContent = root ? '添加扫描目录' : editing ? '修改 Skill 描述' : linking ? '从 skills.sh 接管 ' + context.name : '创建用户 Skill';
    document.getElementById('workflow-description').textContent = root
      ? '支持绝对路径、~/ 相对主目录路径。目录内容始终只读。'
      : editing ? '只更新 description 字段；正文、名称和目录保持不变。'
        : linking ? 'ASH 会按本地名称查找精确候选，但不会自动选择来源或接管；也可手动提供准确 URL。' : '页面只创建标准脚手架，不自动修改已有同名 Skill。';
    document.getElementById('workflow-fields').innerHTML = root
      ? workflowField('目录路径', 'path', { placeholder: '~/Projects/my-skills', hint: '目录下每个包含 SKILL.md 的一级子目录会被扫描。' }) + workflowField('显示名称（可选）', 'name', { placeholder: 'Team skills', required: false })
      : editing
        ? workflowField('触发描述', 'description', { placeholder: '说明这个 Skill 做什么以及何时使用…', multiline: true, value: context.description })
        : linking
          ? sourceDiscoveryShell() +
            workflowField('skills.sh Skill URL（推荐）', 'skills_url', { placeholder: 'https://skills.sh/owner/repository/' + context.name, hint: '从上方选择或手动粘贴包含 owner/repository/skill 的准确页面 URL。', required: false }) +
            '<div class="workflow-choice"><span>OR</span><p>直接指定 GitHub 来源</p></div>' +
            workflowField('GitHub 仓库', 'source_url', { placeholder: 'https://github.com/owner/repository.git', hint: '仅支持 HTTPS GitHub；与下方 Skill 路径必须同时填写。', required: false }) +
            workflowField('Skill 路径', 'skill_path', { placeholder: 'skills/' + context.name + '/SKILL.md', hint: '可填写 Skill 目录或仓库内的 SKILL.md 路径。', required: false }) +
            workflowField('分支或标签（可选）', 'ref', { placeholder: 'main', required: false })
          : workflowField('Skill 名称', 'name', { placeholder: 'review-release', hint: '仅小写字母、数字和连字符，最长 64 个字符。' }) + workflowField('触发描述', 'description', { placeholder: '说明这个 Skill 做什么以及何时使用…', multiline: true });
    document.getElementById('workflow-modal').hidden = false;
    document.body.classList.add('modal-open');
    document.querySelector('#workflow-fields input, #workflow-fields textarea').focus();
    if (linking) discoverWorkflowSource();
  }

  function closeWorkflow() {
    state.sourceDiscoverySequence += 1;
    state.workflow = null;
    state.workflowContext = null;
    document.getElementById('workflow-modal').hidden = true;
    if (!state.modal) document.body.classList.remove('modal-open');
    if (state.modalReturnFocus && typeof state.modalReturnFocus.focus === 'function') state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  async function submitWorkflow(event) {
    event.preventDefault();
    const kind = state.workflow;
    const form = new FormData(event.currentTarget);
    const submit = document.getElementById('workflow-submit');
    submit.disabled = true;
    submit.textContent = '正在生成预览…';
    try {
      const preview = kind === 'add-root'
        ? await post('/api/libraries/preview', { action: 'add', path: form.get('path'), name: form.get('name') })
        : kind === 'edit-description'
          ? await post('/api/skills/description/preview', { name: state.workflowContext.name, library_id: state.workflowContext.library_id, description: form.get('description') })
          : kind === 'link-source'
            ? await post('/api/updates/source/preview', { name: state.workflowContext.name, skills_url: form.get('skills_url'), source_url: form.get('source_url'), skill_path: form.get('skill_path'), ref: form.get('ref') })
            : await post('/api/skills/create/preview', { name: form.get('name'), description: form.get('description') });
      const confirmationKind = kind === 'add-root' ? 'library-add' : kind === 'edit-description' ? 'skill-edit' : kind === 'link-source' ? 'skill-source' : 'skill-create';
      closeWorkflow();
      openConfirmation(confirmationKind, preview);
    } catch (error) { showToast(error.message, true); }
    finally { submit.disabled = false; submit.textContent = '生成预览'; }
  }

  async function previewRepair() {
    setActionBusy('preview-repair', true, '正在生成预览…');
    try {
      const preview = await post('/api/repair/preview', { scope: 'all' });
      if (preview.conflict_count) showToast('存在 ' + preview.conflict_count + ' 个冲突，无法生成可执行计划。', true);
      else if (!preview.plan_id) showToast('当前没有需要修复的受管生成物。');
      else openConfirmation('repair', preview);
    } catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-repair', false); }
  }

  async function previewTransactionPrune() {
    setActionBusy('preview-transaction-prune', true, '正在扫描事务…');
    try {
      const preview = await post('/api/transactions/prune/preview', {});
      if (!preview.plan_id) showToast('当前没有超出保留策略的事务。');
      else openConfirmation('transaction-prune', preview);
    } catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-transaction-prune', false); }
  }

  async function checkUpdates(name) {
    const selectedName = name || null;
    setActionBusy('check-updates', true, '正在检查…');
    try {
      const result = await post('/api/updates/check', selectedName ? { name: selectedName } : {});
      await loadOverview({ silent: true });
      if (selectedName) {
        const display = result.skill && result.skill.display;
        showToast(selectedName + ' 检查完成：' + (display ? display.label : '状态已更新'), result.skill && result.skill.status === 'source-unavailable');
      } else {
        showToast('更新检查完成：' + result.summary.update_available + ' 个可更新，' + result.summary.source_unavailable + ' 个来源不可用。', result.summary.source_unavailable > 0);
      }
    } catch (error) { showToast(error.message, true); }
    finally { setActionBusy('check-updates', false); }
  }

  async function previewSkillUpdate() {
    if (!state.selectedSkill) return;
    setActionBusy('preview-skill-update', true, '正在拉取候选…');
    try {
      const preview = await post('/api/updates/preview', { name: state.selectedSkill.name });
      openConfirmation('skill-update', preview);
    } catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-skill-update', false); }
  }

  async function previewRebuildBaseline() {
    if (!state.selectedSkill) return;
    setActionBusy('preview-rebuild-baseline', true, '正在校验来源…');
    try {
      openConfirmation('skill-source', await post('/api/updates/source/preview', { name: state.selectedSkill.name }));
    } catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-rebuild-baseline', false); }
  }

  async function previewUpdateRollback() {
    setActionBusy('preview-update-rollback', true, '正在验证事务…');
    try { openConfirmation('skill-update-rollback', await post('/api/updates/rollback/preview', {})); }
    catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-update-rollback', false); }
  }

  async function previewRollback() {
    setActionBusy('preview-rollback', true, '正在读取事务…');
    try { openConfirmation('rollback', await post('/api/rollback/preview', { selector: 'latest' })); }
    catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-rollback', false); }
  }

  async function previewRootRemoval(libraryId) {
    try { openConfirmation('library-remove', await post('/api/libraries/preview', { action: 'remove', library_id: libraryId })); }
    catch (error) { showToast(error.message, true); }
  }

  async function previewPackage(name, libraryId) {
    try { openConfirmation('package', await post('/api/packages/preview', { name, library_id: libraryId })); }
    catch (error) { showToast(error.message, true); }
  }

  async function previewSnapshotCreate() {
    setActionBusy('preview-snapshot-create', true, '正在扫描用户库…');
    try { openConfirmation('snapshot-create', await post('/api/snapshots/create/preview')); }
    catch (error) { showToast(error.message, true); }
    finally { setActionBusy('preview-snapshot-create', false); }
  }

  async function previewSnapshotRestore(reference) {
    try {
      const preview = await post('/api/snapshots/restore/preview', { snapshot: reference });
      if (preview.conflicts.length) showToast('快照恢复存在 ' + preview.conflicts.length + ' 个冲突，未生成可执行计划。', true);
      else if (!preview.plan_id) showToast('当前没有缺失 Skill 需要恢复。');
      else openConfirmation('snapshot-restore', preview);
    } catch (error) { showToast(error.message, true); }
  }

  async function verifySnapshot(reference) {
    try {
      const result = await post('/api/snapshots/verify', { snapshot: reference });
      const value = result.verification;
      showToast('校验完成：匹配 ' + value.matched.length + '，缺失 ' + value.missing.length + '，变化 ' + value.changed.length + '，额外 ' + value.extra.length + '。', !value.ok);
    } catch (error) { showToast(error.message, true); }
  }

  async function applyConfirmation() {
    if (!state.modal) return;
    const modal = state.modal;
    const config = confirmations[modal.kind];
    const button = document.getElementById('modal-apply');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = config.busy;
    try {
      const request = { confirm: true };
      request[config.id] = modal.payload[config.id];
      const result = await post(config.route, request);
      closeConfirmation();
      if (modal.kind === 'package') showToast(config.success + ' ' + result.output);
      else showToast(config.success);
      await loadOverview({ silent: true });
      if ((modal.kind === 'skill-create' || modal.kind === 'skill-edit' || modal.kind === 'skill-source' || modal.kind === 'skill-update' || modal.kind === 'skill-update-rollback') && result.skill) {
        state.selectedSkill = result.skill;
        showView('library');
        renderLibrary();
        renderSkillDetail();
      }
    } catch (error) {
      showToast(error.message, true);
      closeConfirmation();
      await loadOverview({ silent: true });
    } finally { button.removeAttribute('aria-busy'); }
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function view(item) { item.classList.toggle('is-active', item.id === 'view-' + name); });
    document.querySelectorAll('.rail-item').forEach(function nav(item) { item.classList.toggle('is-active', item.dataset.view === name); });
    if (window.location.hash !== '#' + name) window.location.hash = name;
  }

  function visibleDialog() {
    if (!document.getElementById('confirmation-modal').hidden) return document.querySelector('#confirmation-modal .confirmation-modal');
    if (!document.getElementById('workflow-modal').hidden) return document.querySelector('#workflow-modal .confirmation-modal');
    return null;
  }

  document.getElementById('refresh-button').addEventListener('click', function refresh() { loadOverview(); });
  document.getElementById('skill-search').addEventListener('input', function searchChanged() { state.skillLimit = 60; syncUrlState(); renderLibrary(); });
  document.getElementById('modal-close').addEventListener('click', closeConfirmation);
  document.getElementById('modal-cancel').addEventListener('click', closeConfirmation);
  document.getElementById('modal-apply').addEventListener('click', applyConfirmation);
  document.getElementById('modal-confirm-check').addEventListener('change', function confirmation(event) { document.getElementById('modal-apply').disabled = !event.target.checked; });
  document.getElementById('confirmation-modal').addEventListener('click', function backdrop(event) { if (event.target.id === 'confirmation-modal') closeConfirmation(); });
  document.getElementById('workflow-close').addEventListener('click', closeWorkflow);
  document.getElementById('workflow-cancel').addEventListener('click', closeWorkflow);
  document.getElementById('workflow-form').addEventListener('submit', submitWorkflow);
  document.getElementById('workflow-modal').addEventListener('click', function backdrop(event) { if (event.target.id === 'workflow-modal') closeWorkflow(); });

  document.addEventListener('keydown', function keyboard(event) {
    if (event.key === 'Escape') {
      if (state.modal) closeConfirmation();
      else if (state.workflow) closeWorkflow();
      return;
    }
    const dialog = visibleDialog();
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  window.addEventListener('hashchange', function changed() {
    const selected = window.location.hash.slice(1);
    if (['overview', 'library', 'health', 'maintenance'].indexOf(selected) !== -1) showView(selected);
  });

  document.addEventListener('click', function delegated(event) {
    const sourceCandidate = event.target.closest('[data-source-candidate-url]');
    if (sourceCandidate) {
      const input = document.getElementById('workflow-skills_url');
      if (!input || state.workflow !== 'link-source') return;
      input.value = sourceCandidate.dataset.sourceCandidateUrl;
      const repositoryInput = document.getElementById('workflow-source_url');
      const pathInput = document.getElementById('workflow-skill_path');
      if (repositoryInput) repositoryInput.value = '';
      if (pathInput) pathInput.value = '';
      document.querySelectorAll('.source-candidate').forEach(function clear(button) { button.classList.remove('is-selected'); });
      sourceCandidate.classList.add('is-selected');
      const selection = document.getElementById('source-discovery-selection');
      if (selection) selection.textContent = '已选择 ' + sourceCandidate.dataset.sourceCandidateUrl + '；请继续生成差异预览。';
      input.focus();
      return;
    }
    const nav = event.target.closest('[data-view]');
    if (nav) { showView(nav.dataset.view); return; }
    const jump = event.target.closest('[data-jump]');
    if (jump) { showView(jump.dataset.jump); return; }
    const filter = event.target.closest('[data-library-filter]');
    if (filter) { state.libraryFilter = filter.dataset.libraryFilter; state.skillLimit = 60; syncUrlState(); renderLibrary(); return; }
    const skill = event.target.closest('[data-skill].skill-row');
    if (skill) { selectSkill(skill.dataset.skill, skill.dataset.libraryId); return; }
    const severity = event.target.closest('[data-severity]');
    if (severity) { state.severity = severity.dataset.severity; syncUrlState(); renderHealth(); return; }
    const action = event.target.closest('[data-action]');
    if (!action || action.disabled) return;
    const name = action.dataset.action;
    if (name === 'load-more-skills') { state.skillLimit += 60; renderLibrary(); }
    else if (name === 'open-add-root') openWorkflow('add-root');
    else if (name === 'open-create-skill') openWorkflow('create-skill');
    else if (name === 'open-edit-description') openWorkflow('edit-description', state.selectedSkill);
    else if (name === 'open-link-source') openWorkflow('link-source', state.selectedSkill);
    else if (name === 'retry-source-discovery') discoverWorkflowSource();
    else if (name === 'remove-root') previewRootRemoval(action.dataset.libraryId);
    else if (name === 'preview-package') previewPackage(action.dataset.skill, action.dataset.libraryId);
    else if (name === 'check-updates') checkUpdates(action.dataset.skillName || null);
    else if (name === 'preview-skill-update') previewSkillUpdate();
    else if (name === 'preview-rebuild-baseline') previewRebuildBaseline();
    else if (name === 'preview-update-rollback') previewUpdateRollback();
    else if (name === 'preview-repair') previewRepair();
    else if (name === 'preview-rollback') previewRollback();
    else if (name === 'preview-transaction-prune') previewTransactionPrune();
    else if (name === 'preview-snapshot-create') previewSnapshotCreate();
    else if (name === 'preview-snapshot-restore') previewSnapshotRestore(action.dataset.snapshot);
    else if (name === 'verify-snapshot') verifySnapshot(action.dataset.snapshot);
  });

  const initialView = ['overview', 'library', 'health', 'maintenance'].indexOf(window.location.hash.slice(1)) !== -1
    ? window.location.hash.slice(1) : 'overview';
  document.getElementById('skill-search').value = initialParams.get('q') || '';
  showView(initialView);
  loadOverview({ silent: true });
}());
