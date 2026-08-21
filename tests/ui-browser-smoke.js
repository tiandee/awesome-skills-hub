'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

function removeTree(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { fs.unlinkSync(target); return; }
  fs.readdirSync(target).forEach(function child(name) { removeTree(path.join(target, name)); });
  fs.rmdirSync(target);
}

async function main() {
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-ui-browser-root-'));
  fs.mkdirSync(path.join(scanRoot, 'browser-preview'));
  fs.writeFileSync(path.join(scanRoot, 'browser-preview', 'SKILL.md'), '---\nname: browser-preview\ndescription: Browser-only scan preview.\n---\n', 'utf8');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ASH_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', function capture(message) {
    if (message.type() === 'error') browserErrors.push('console: ' + message.text());
  });
  page.on('pageerror', function capture(error) { browserErrors.push('page: ' + error.message); });

  try {
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.locator('#metric-grid .metric-card').first().waitFor();
    assert((await page.locator('#library-path').textContent()).includes('.agents/skills'));
    assert.strictEqual(await page.locator('#metric-grid .metric-card').count(), 4);
    assert((await page.locator('#metric-grid').textContent()).includes('SKILL UPDATES'));
    assert.strictEqual(await page.locator('#source-insights .source-insight-metric').count(), 4);
    assert((await page.locator('#source-insights').textContent()).includes('TRACKED SOURCE'));
    const readability = await page.evaluate(function inspectReadability() {
      function size(selector) {
        return parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      }
      function luminance(hex) {
        const values = hex.match(/[a-f\d]{2}/gi).map(function channel(value) {
          const selected = parseInt(value, 16) / 255;
          return selected <= 0.04045 ? selected / 12.92 : Math.pow((selected + 0.055) / 1.055, 2.4);
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      }
      function contrast(first, second) {
        const a = luminance(first);
        const b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }
      const root = getComputedStyle(document.documentElement);
      const background = root.getPropertyValue('--bg').trim();
      return {
        libraryPath: size('#library-path'),
        navigation: size('.rail-item'),
        metricLabel: size('.metric-label'),
        metricNote: size('.metric-note'),
        sourceMetric: size('.source-insight-metric > span'),
        issueCode: size('.issue-compact strong'),
        issueCopy: size('.issue-compact p'),
        mutedContrast: contrast(root.getPropertyValue('--muted').trim(), background),
        faintContrast: contrast(root.getPropertyValue('--faint').trim(), background),
      };
    });
    assert(readability.libraryPath >= 12);
    assert(readability.navigation >= 13);
    assert(readability.metricLabel >= 11);
    assert(readability.metricNote >= 12);
    assert(readability.sourceMetric >= 10);
    assert(readability.issueCode >= 13);
    assert(readability.issueCopy >= 13);
    assert(readability.mutedContrast >= 7);
    assert(readability.faintContrast >= 4.5);
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(function focused() { return document.activeElement.classList.contains('skip-link'); }), true);
    await page.evaluate(function clearFocus() { document.activeElement.blur(); });
    await page.screenshot({ path: '/tmp/ash-ui-overview.png', fullPage: true });

    await page.getByRole('link', { name: /Skill 库/ }).click();
    await page.getByRole('button', { name: '检查更新' }).waitFor();
    assert.strictEqual(await page.getByRole('button', { name: '热门接管' }).count(), 1);
    await page.getByRole('button', { name: 'Skill 扫描' }).click();
    await page.locator('#scan-modal:not([hidden])').waitFor();
    assert.strictEqual(await page.locator('#scan-sources-list .scan-source-row').count(), 2);
    const scanText = await page.locator('#scan-sources-list').textContent();
    assert(scanText.includes('.agents/skills'));
    assert(scanText.includes('skills-src'));
    assert(scanText.includes('只读'));
    await page.locator('#scan-cancel').click();

    const removalCandidate = await page.evaluate(async function findRemovalCandidate() {
      const overview = await fetch('/api/overview').then(function json(response) { return response.json(); });
      const skill = overview.skills.find(function matching(item) { return item.removal && item.removal.available; });
      return skill && { name: skill.name, label: skill.removal.label };
    });
    assert(removalCandidate);
    await page.locator('#skill-search').fill(removalCandidate.name);
    const removalRow = page.locator('#skill-list .skill-row[data-skill="' + removalCandidate.name + '"]');
    await removalRow.waitFor();
    await page.route('**/api/skills/removal/preview', function routeRemovalPreview(route) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        plan_id: 'browser-removal-plan', name: removalCandidate.name, mode: 'quarantine', ownership: 'manual',
        path: '/tmp/' + removalCandidate.name, file_count: 3, total_bytes: 2048, recoverable: true,
        confirmation_name: removalCandidate.name,
        actions: [{ kind: 'skill_quarantine', path: '/tmp/' + removalCandidate.name, description: '将用户 Skill 移入 ASH 回收站 /tmp/' + removalCandidate.name }],
      }) });
    });
    await removalRow.locator('.skill-actions-trigger').click();
    assert.strictEqual(await removalRow.locator('.skill-actions-trigger').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await removalRow.locator('.skill-actions-menu [role="menuitem"]').count(), 2);
    await removalRow.locator('[data-action="preview-skill-removal"]').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('回收站'));
    assert.strictEqual(await page.locator('#modal-confirm-name-field').isVisible(), true);
    assert.strictEqual(await page.locator('#modal-confirm-check-field').isVisible(), false);
    assert.strictEqual(await page.locator('#modal-apply').isDisabled(), true);
    await page.locator('#modal-confirm-name').fill(removalCandidate.name);
    assert.strictEqual(await page.locator('#modal-apply').isEnabled(), true);
    await page.locator('#modal-cancel').click();
    await page.unroute('**/api/skills/removal/preview');
    await page.locator('#skill-search').fill('');
    await page.route('**/api/updates/source/popular/discover', function routeDiscover(route) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        discovery_id: 'browser-popular-discovery', provider: 'skills.sh', experimental: true,
        scanned_count: 2, total_unmanaged: 2, remaining_count: 0, selected_names: ['beta'], selected_count: 1,
        ambiguous_count: 1, no_match_count: 0, unavailable_count: 0,
        proposals: [
          { name: 'beta', state: 'selected', auto_selected: true, confidence: 'dominant', reason: '安装量明显领先。', candidate: { source: 'example/ui-skills', slug: 'beta', installs: 240 }, alternatives: [] },
          { name: 'manual', state: 'ambiguous', auto_selected: false, reason: '候选来源接近，需手动选择。', candidate: { source: 'first/ui-skills', slug: 'manual', installs: 20 }, alternatives: [] },
        ],
      }) });
    });
    await page.route('**/api/updates/source/popular/preview', function routePopularPreview(route) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        plan_id: 'browser-popular-plan', selected_count: 2, ready_count: 1, skipped_count: 1,
        actions: [{ kind: 'skill_source_batch', path: '/tmp/beta', description: 'TAKE OVER beta FROM SKILLS.SH https://skills.sh/example/ui-skills/beta :: +1 ~1 -0' }],
        ready: [{ name: 'beta', diff: { added: 1, changed: 1, deleted: 0, executable: 0, preserved: 0, discarded: 0 } }],
        skipped: [{ name: 'gamma', reason: '候选包含可执行文件，需单独人工预览和确认。' }],
      }) });
    });
    await page.route('**/api/updates/source/popular/progress*', function routePopularProgress(route) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'running', plan_id: 'browser-popular-plan', current_name: 'beta',
        done_count: 0, total_count: 1, applied_count: 0, failed_count: 0, remaining_count: 1,
        items: [{ name: 'beta', index: 0, state: 'running', reason: null }],
      }) });
    });
    let releasePopularApply;
    const holdPopularApply = new Promise(function wait(resolve) { releasePopularApply = resolve; });
    await page.route('**/api/updates/source/popular/apply', async function routePopularApply(route) {
      await holdPopularApply;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'aborted', batch_transaction_id: 'browser-batch-transaction',
        applied: [{ name: 'beta', transaction_id: 'browser-item-transaction' }],
        failed: [{ name: 'manual', code: 'LOCAL_APPLY_FAILED', phase: 'local_apply', rollback_failed: true, reason: 'rollback failed' }],
        applied_count: 1, failed_count: 1, remaining_count: 1, count: 1,
      }) });
    });
    await page.getByRole('button', { name: '热门接管' }).click();
    await page.locator('#popular-modal:not([hidden])').waitFor();
    await page.locator('#popular-proposals .popular-proposal').first().waitFor();
    const popularSummaryText = await page.locator('#popular-summary').textContent();
    assert(popularSummaryText.includes('自动选择 1 个'), popularSummaryText);
    assert.strictEqual(await page.locator('#popular-proposals input[name="popular-skill"]:checked').count(), 1);
    await page.locator('#popular-preview').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('TAKE OVER beta FROM SKILLS.SH'));
    assert((await page.locator('#modal-actions .popular-apply-item.is-queued .popular-apply-status').textContent()).includes('等待中'));
    assert((await page.locator('#modal-apply-progress').textContent()).includes('将执行 1 个，预览跳过 1 个'));
    assert((await page.locator('#modal-actions').textContent()).includes('gamma'));
    assert((await page.locator('#modal-actions').textContent()).includes('可执行文件'));
    assert((await page.locator('#modal-actions .popular-apply-item.is-preview-skipped .popular-apply-status').textContent()).includes('已跳过'));
    assert((await page.locator('#modal-description').textContent()).includes('若自动回滚失败，批处理会立即中止'));
    await page.locator('#modal-confirm-check').check();
    await page.locator('#modal-apply').click();
    try {
      await page.locator('#modal-actions .popular-apply-item.is-running').waitFor();
      assert((await page.locator('#modal-apply-progress').textContent()).includes('正在接管 beta'));
      assert((await page.locator('#modal-apply').textContent()).includes('1 / 1'));
    } finally {
      releasePopularApply();
    }
    await page.locator('#confirmation-modal').waitFor({ state: 'hidden' });
    assert((await page.locator('#toast').textContent()).includes('批量接管已中止：自动回滚失败，未执行 1 项；早先成功 1 项已保留。'));
    await page.unroute('**/api/updates/source/popular/discover');
    await page.unroute('**/api/updates/source/popular/preview');
    await page.unroute('**/api/updates/source/popular/progress*');
    await page.unroute('**/api/updates/source/popular/apply');
    const tableHeadText = await page.locator('.table-head').textContent();
    ['名称', '体量', '状态', '健康', '操作'].forEach(function label(value) { assert(tableHeadText.includes(value)); });
    const statusContract = await page.evaluate(async function inspectStatusLabels() {
      const overview = await fetch('/api/overview').then(function json(response) { return response.json(); });
      const labels = Array.from(new Set(overview.skills.map(function label(skill) { return skill.update.display.label; })));
      const weeklyReport = overview.skills.find(function matching(skill) { return skill.name === 'weekly-report'; });
      const readOnly = overview.skills.find(function matching(skill) { return skill.update.status === 'read-only-source'; });
      return {
        labels,
        lengths: labels.map(function length(label) { return Array.from(label).length; }),
        weekly_report: weeklyReport && weeklyReport.update.display.label,
        read_only: readOnly && { name: readOnly.name, library_id: readOnly.library_id },
      };
    });
    assert(statusContract.lengths.every(function four(length) { return length === 4; }));
    assert.strictEqual(statusContract.weekly_report, '用户链接');
    await page.locator('#skill-search').fill('weekly-report');
    const weeklyReportRow = page.locator('#skill-list .skill-row[data-skill="weekly-report"]');
    await weeklyReportRow.waitFor();
    const weeklyReportStatus = (await weeklyReportRow.locator('.update-pill').textContent()).replace(/^更新：/, '').trim();
    assert.strictEqual(weeklyReportStatus, '用户链接');
    await weeklyReportRow.locator('.skill-actions-trigger').click();
    assert.strictEqual(await weeklyReportRow.locator('[data-action="preview-skill-unlink"]').textContent(), '解除链接');
    assert.strictEqual(await weeklyReportRow.locator('[data-action="preview-skill-removal"]').textContent(), '移入回收站');
    await weeklyReportRow.locator('[data-action="preview-skill-unlink"]').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-title').textContent()).includes('解除用户链接'));
    assert((await page.locator('#modal-actions').textContent()).includes('不会移入回收站'));
    await page.locator('#modal-cancel').click();
    await weeklyReportRow.locator('.skill-row-select').click();
    await page.locator('#skill-detail .detail-head h2', { hasText: 'weekly-report' }).waitFor();
    await page.locator('#skill-detail [data-action="preview-skill-removal"]').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-title').textContent()).includes('移入回收站'));
    await page.locator('#modal-cancel').click();
    await page.locator('#skill-search').fill('');
    if (statusContract.read_only) {
      await page.locator('#skill-search').fill(statusContract.read_only.name);
      const readOnlyRow = page.locator('#skill-list .skill-row[data-skill="' + statusContract.read_only.name + '"]');
      await readOnlyRow.waitFor();
      assert((await readOnlyRow.locator('.update-pill').textContent()).includes('只读来源'));
      await readOnlyRow.locator('.skill-actions-trigger').click();
      await readOnlyRow.locator('[data-action="preview-skill-link"]').click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor();
      assert((await page.locator('#modal-title').textContent()).includes('链接到用户库'));
      assert((await page.locator('#modal-actions').textContent()).includes('链接只读 Skill 到用户库'));
      await page.locator('#modal-cancel').click();
      await page.locator('#skill-search').fill('');
    }
    assert.strictEqual((await page.locator('body').textContent()).includes('SIGNAL'), false);
    const healthSamples = await page.evaluate(async function currentHealthSamples() {
      const overview = await fetch('/api/overview').then(function json(response) { return response.json(); });
      const issue = overview.skills.find(function matching(skill) { return skill.health && skill.health.total > 0; });
      const clear = overview.skills.find(function matching(skill) { return skill.health && skill.health.total === 0; });
      return { issue: issue && issue.name, clear: clear && clear.name };
    });
    assert(healthSamples.issue);
    assert(healthSamples.clear);
    await page.locator('#skill-search').fill(healthSamples.issue);
    const issueRow = page.locator('#skill-list .skill-row[data-skill="' + healthSamples.issue + '"]');
    await issueRow.waitFor();
    assert((await issueRow.locator('.update-pill').textContent()).trim().length > 0);
    assert(/错误|警告|提示/.test(await issueRow.locator('.health-pill').textContent()));
    const warningColor = await issueRow.locator('.health-pill').evaluate(function color(element) { return getComputedStyle(element).color; });
    assert(['rgb(255, 102, 85)', 'rgb(233, 185, 73)', 'rgb(118, 169, 181)'].includes(warningColor));
    await page.locator('#skill-search').fill(healthSamples.clear);
    const clearRow = page.locator('#skill-list .skill-row[data-skill="' + healthSamples.clear + '"]');
    await clearRow.waitFor();
    assert.strictEqual(await clearRow.locator('.health-pill').count(), 0);
    assert.strictEqual(await clearRow.locator('.health-empty').count(), 1);
    await page.locator('#skill-search').fill('');
    const initialRootCount = (await page.locator('#library-filters .library-filter').count()) - 1;
    await page.getByRole('button', { name: 'Skill 扫描' }).click();
    await page.locator('#scan-add-root').click();
    await page.getByLabel('目录路径').fill(scanRoot);
    await page.getByLabel('显示名称（可选）').fill('Skills source preview');
    await page.locator('#workflow-submit').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('READ-ONLY SCAN ROOT'));
    await page.locator('#modal-cancel').click();

    await page.getByRole('button', { name: '创建 Skill' }).click();
    await page.getByLabel('Skill 名称').fill('ui-preview-probe');
    await page.getByLabel('触发描述').fill('Disposable browser preview that must never be applied.');
    await page.locator('#workflow-submit').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('CREATE USER SKILL'));
    await page.locator('#modal-cancel').click();
    assert.strictEqual((await page.locator('#library-filters .library-filter').count()) - 1, initialRootCount);

    assert.strictEqual(await page.locator('#skill-list .skill-row').count(), 60);
    await page.getByRole('button', { name: /再显示/ }).click();
    assert.strictEqual(await page.locator('#skill-list .skill-row').count(), 120);
    await page.locator('#skill-search').fill('nadou');
    await page.locator('#skill-list .skill-row').first().waitFor();
    assert.strictEqual(new URL(page.url()).searchParams.get('q'), 'nadou');
    await page.locator('#skill-list .skill-row').first().click();
    await page.locator('#skill-detail .detail-head').waitFor();
    assert((await page.locator('#skill-detail').textContent()).toLowerCase().includes('nadou'));
    await page.getByRole('button', { name: '修改描述' }).click();
    await page.getByLabel('触发描述').fill('Browser-only description preview that must never be applied.');
    await page.locator('#workflow-submit').click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('UPDATE SKILL DESCRIPTION'));
    await page.locator('#modal-cancel').click();
    await page.getByRole('button', { name: '打包 .skill' }).click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('WRITE SKILL PACKAGE'));
    await page.locator('#modal-cancel').click();
    await page.evaluate(function resetLibraryViewport() { window.scrollTo(0, 0); document.activeElement.blur(); });
    await page.waitForTimeout(250);
    await page.screenshot({ path: '/tmp/ash-ui-library.png', fullPage: true });
    await page.locator('#skill-search').fill('delivery-loop');
    await page.locator('#skill-list .skill-row').first().click();
    await page.locator('#skill-detail .detail-head h2', { hasText: 'delivery-loop' }).waitFor();
    assert.strictEqual(await page.locator('#skill-detail .skill-location').count(), 2);
    await page.locator('#skill-search').fill('lark-doc');
    await page.locator('#skill-list .skill-row[data-skill="lark-doc"]').waitFor();
    await page.locator('#skill-list .skill-row[data-skill="lark-doc"]').click();
    await page.locator('#skill-detail .detail-head h2', { hasText: 'lark-doc' }).waitFor();
    await page.locator('#skill-detail .update-source').waitFor();
    assert(/等待检查|已是最新|发现更新|等待接管|等待重建|用户链接|只读来源|状态异常/.test(await page.locator('#skill-detail .update-source').textContent()));
    await page.screenshot({ path: '/tmp/ash-ui-update-detail.png', fullPage: true });

    const updateCandidate = await page.evaluate(async function findUpdateCandidate() {
      const overview = await fetch('/api/overview').then(function json(response) { return response.json(); });
      const skill = overview.skills.find(function matching(item) {
        return item.update && item.update.status === 'update-available' && item.library_ids.includes('managed');
      });
      return skill && skill.name;
    });
    if (updateCandidate) {
      await page.locator('#skill-search').fill(updateCandidate);
      await page.locator('#skill-list .skill-row[data-skill="' + updateCandidate + '"]').click();
      await page.getByRole('button', { name: '预览更新' }).click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor({ timeout: 120000 });
      assert((await page.locator('#modal-actions').textContent()).includes('UPDATE'));
      await page.locator('#modal-cancel').click();
    }

    await page.locator('#skill-search').fill('1password');
    const managedSourceRow = page.locator('#skill-list .skill-row[data-skill="1password"]');
    await managedSourceRow.waitFor();
    assert((await managedSourceRow.textContent()).includes('skills.sh 接管'));
    await managedSourceRow.click();
    await page.locator('#skill-detail .detail-head h2', { hasText: '1password' }).waitFor();
    const sourceDetailText = await page.locator('#skill-detail .update-source').textContent();
    assert(sourceDetailText.includes('skills.sh 接管'));
    assert(sourceDetailText.includes('上游仓库'));
    assert(sourceDetailText.includes('Skill 路径'));
    const skillsShLink = page.getByRole('link', { name: /skills\.sh 页面/ });
    const repositoryLink = page.getByRole('link', { name: /GitHub 仓库/ });
    const skillFileLink = page.getByRole('link', { name: /SKILL\.md 源码/ });
    assert.strictEqual(await skillsShLink.getAttribute('href'), 'https://skills.sh/openclaw/openclaw/1password');
    assert.strictEqual(await repositoryLink.getAttribute('href'), 'https://github.com/openclaw/openclaw');
    assert.strictEqual(await skillFileLink.getAttribute('href'), 'https://github.com/openclaw/openclaw/blob/HEAD/skills/1password/SKILL.md');
    const sourceLinkAttributes = await page.locator('#skill-detail .source-link').evaluateAll(function inspect(links) {
      return links.map(function link(item) {
        return { tag: item.tagName, target: item.target, rel: item.rel, href: item.getAttribute('href') };
      });
    });
    assert(sourceLinkAttributes.every(function semantic(item) {
      return item.tag === 'A' && item.target === '_blank' && item.rel.includes('noopener') && item.rel.includes('noreferrer');
    }));
    const idleLinkColor = await skillsShLink.evaluate(function color(element) { return getComputedStyle(element).color; });
    await skillsShLink.hover();
    await page.waitForTimeout(160);
    const hoverLinkColor = await skillsShLink.evaluate(function color(element) { return getComputedStyle(element).color; });
    assert.notStrictEqual(hoverLinkColor, idleLinkColor);
    await skillsShLink.focus();
    await page.keyboard.press('Tab');
    assert.notStrictEqual(await repositoryLink.evaluate(function outline(element) { return getComputedStyle(element).outlineStyle; }), 'none');
    assert.strictEqual(await page.getByRole('button', { name: '更换上游' }).count(), 1);
    await page.getByRole('button', { name: '更换上游' }).click();
    assert((await page.locator('#workflow-title').textContent()).includes('更换上游 1password'));
    await page.locator('#workflow-cancel').click();
    await page.screenshot({ path: '/tmp/ash-ui-source-detail.png', fullPage: true });

    const sourceActionSkills = await page.evaluate(async function currentSourceActions() {
      const overview = await fetch('/api/overview').then(function json(response) { return response.json(); });
      const unmanaged = overview.skills.find(function preferred(skill) {
        return skill.name === '1password' && skill.update.status === 'unmanaged' && skill.library_ids.includes('managed');
      }) || overview.skills.find(function matching(skill) { return skill.update.status === 'unmanaged' && skill.library_ids.includes('managed'); });
      const baseline = overview.skills.find(function matching(skill) { return skill.update.status === 'baseline-missing' && skill.library_ids.includes('managed'); });
      return { unmanaged: unmanaged && unmanaged.name, baseline: baseline && baseline.name };
    });
    assert(sourceActionSkills.unmanaged);
    assert(sourceActionSkills.baseline);
    await page.locator('#skill-search').fill(sourceActionSkills.unmanaged);
    await page.locator('#skill-list .skill-row[data-skill="' + sourceActionSkills.unmanaged + '"]').click();
    await page.getByRole('button', { name: '从 skills.sh 接管' }).click();
    await page.getByLabel('skills.sh Skill URL（推荐）').waitFor();
    await page.getByLabel('GitHub 仓库').waitFor();
    assert.strictEqual(await page.locator('#workflow-skill_path').count(), 1);
    if (sourceActionSkills.unmanaged === '1password') {
      await page.locator('.source-candidate').first().waitFor({ timeout: 15000 });
      assert((await page.locator('.source-candidate').count()) > 1);
      assert.strictEqual(await page.getByLabel('skills.sh Skill URL（推荐）').inputValue(), '');
      await page.locator('.source-candidate').first().click();
      assert.strictEqual(await page.getByLabel('skills.sh Skill URL（推荐）').inputValue(), 'https://skills.sh/openclaw/openclaw/1password');
      assert((await page.locator('#source-discovery-selection').textContent()).includes('请继续生成差异预览'));
    }
    await page.screenshot({ path: '/tmp/ash-ui-source-link.png', fullPage: true });
    if (sourceActionSkills.unmanaged === '1password') {
      await page.locator('#workflow-submit').click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor({ timeout: 60000 });
      assert((await page.locator('#modal-actions').textContent()).includes('TAKE OVER FROM SKILLS.SH'));
      await page.locator('#modal-cancel').click();
    } else {
      await page.locator('#workflow-cancel').click();
    }
    await page.locator('#skill-search').fill(sourceActionSkills.baseline);
    await page.locator('#skill-list .skill-row[data-skill="' + sourceActionSkills.baseline + '"]').click();
    await page.locator('#skill-detail .detail-head h2', { hasText: sourceActionSkills.baseline }).waitFor();
    await page.getByRole('button', { name: '重建基线' }).waitFor();
    assert.strictEqual(await page.getByRole('button', { name: '重建基线' }).count(), 1);

    await page.getByRole('link', { name: /健康/ }).click();
    await page.locator('#issue-ledger').waitFor();
    assert((await page.locator('#issue-ledger').textContent()).trim().length > 0);
    await page.getByRole('button', { name: '警告' }).click();
    assert.strictEqual(new URL(page.url()).searchParams.get('severity'), 'WARN');

    await page.getByRole('link', { name: /维护/ }).click();
    assert((await page.locator('#update-card').textContent()).includes('检查用户 Skill 更新'));
    assert((await page.locator('#update-rollback-card').textContent()).includes('回滚最近 Skill 更新'));
    assert((await page.locator('#removal-rollback-card').textContent()).includes('回收站管理'));
    const recoveryRow = page.locator('#removal-rollback-card .removal-row').first();
    if (await recoveryRow.count()) {
      const recoveryName = (await recoveryRow.locator('.removal-copy strong').textContent()).trim();
      await page.route('**/api/skills/removal/purge/preview', function routePurgePreview(route) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          plan_id: 'browser-purge-plan', transaction_id: 'browser-removal', name: recoveryName,
          path: '/tmp/removals/browser-removal', recovery_path: '/tmp/removals/browser-removal/removed-skill',
          file_count: 4, total_bytes: 4096, confirmation_name: recoveryName,
          actions: [
            { kind: 'skill_removal_purge', path: '/tmp/removals/browser-removal', description: '永久删除可恢复 Skill ' + recoveryName + ' 及其恢复事务 /tmp/removals/browser-removal' },
            { kind: 'skill_removal_purge_size', path: '/tmp/removals/browser-removal', description: '永久释放 4 个文件、4096 bytes；操作后不可恢复' },
          ],
        }) });
      });
      await recoveryRow.getByRole('button', { name: '永久删除' }).click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor();
      assert((await page.locator('#modal-title').textContent()).includes('永久删除'));
      assert((await page.locator('#modal-actions').textContent()).includes('操作后不可恢复'));
      assert.strictEqual(await page.locator('#modal-confirm-name-field').isVisible(), true);
      assert.strictEqual(await page.locator('#modal-confirm-check-field').isVisible(), false);
      await page.locator('#modal-confirm-name').fill(recoveryName);
      assert.strictEqual(await page.locator('#modal-apply').isEnabled(), true);
      await page.locator('#modal-cancel').click();
      await page.unroute('**/api/skills/removal/purge/preview');
    }
    const recoveryCount = await page.locator('#removal-rollback-card .removal-row').count();
    if (recoveryCount) {
      const confirmationText = '永久删除全部 ' + recoveryCount + ' 个 Skill';
      await page.route('**/api/skills/removal/bulk-purge/preview', function routeBulkPurgePreview(route) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          plan_id: 'browser-bulk-purge-plan', count: recoveryCount, names: ['browser-items'],
          file_count: recoveryCount * 2, total_bytes: recoveryCount * 2048,
          confirmation_text: confirmationText,
          actions: [
            { kind: 'skill_removal_bulk_purge', path: '/tmp/removals', description: '永久删除当前 ' + recoveryCount + ' 条可恢复记录' },
            { kind: 'skill_removal_bulk_purge_size', description: '总计永久释放 ' + (recoveryCount * 2) + ' 个文件；操作后不可恢复' },
          ],
        }) });
      });
      await page.getByRole('button', { name: '永久删除全部' }).click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor();
      assert((await page.locator('#modal-title').textContent()).includes('永久删除全部'));
      assert.strictEqual(await page.locator('#modal-confirm-name-value').textContent(), confirmationText);
      assert.strictEqual(await page.locator('#modal-confirm-check-field').isVisible(), false);
      await page.locator('#modal-confirm-name').fill('永久删除全部');
      assert.strictEqual(await page.locator('#modal-apply').isDisabled(), true);
      await page.locator('#modal-confirm-name').fill(confirmationText);
      assert.strictEqual(await page.locator('#modal-apply').isEnabled(), true);
      await page.locator('#modal-cancel').click();
      await page.unroute('**/api/skills/removal/bulk-purge/preview');
    }
    assert((await page.locator('#retention-card').textContent()).includes('清理历史事务'));
    assert.strictEqual(await page.getByRole('button', { name: '打开快照目录' }).count(), 1);
    await page.getByRole('button', { name: '创建快照' }).click();
    await page.locator('#confirmation-modal:not([hidden])').waitFor();
    assert((await page.locator('#modal-actions').textContent()).includes('CREATE USER SKILL SNAPSHOT'));
    await page.locator('#modal-cancel').click();
    const preview = page.locator('[data-action="preview-repair"]').last();
    if (await preview.isEnabled()) {
      await preview.click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor();
      assert((await page.locator('#modal-actions').textContent()).includes('WRITE_'));
      await page.locator('#modal-cancel').click();
    }
    const retentionPreview = page.locator('[data-action="preview-transaction-prune"]');
    if (await retentionPreview.isEnabled()) {
      await retentionPreview.click();
      await page.locator('#confirmation-modal:not([hidden])').waitFor();
      assert((await page.locator('#modal-actions').textContent()).includes('DELETE'));
      await page.locator('#modal-cancel').click();
    }
    await page.evaluate(function resetMaintenanceViewport() { window.scrollTo(0, 0); document.activeElement.blur(); });
    await page.waitForTimeout(250);
    await page.screenshot({ path: '/tmp/ash-ui-maintenance.png', fullPage: true });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('link', { name: /总览/ }).click();
    await page.evaluate(function top() { window.scrollTo(0, 0); });
    await page.waitForTimeout(450);
    const mobileLayout = await page.evaluate(function inspectLayout() {
      const rail = document.querySelector('.rail').getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        railLeft: rail.left,
        railRight: rail.right,
        railTop: rail.top,
        railBottom: rail.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    assert(mobileLayout.scrollWidth <= mobileLayout.clientWidth);
    assert(mobileLayout.railLeft >= 0 && mobileLayout.railRight <= mobileLayout.clientWidth);
    assert(mobileLayout.railTop > mobileLayout.viewportHeight - 90);
    assert(Math.abs(mobileLayout.railBottom - mobileLayout.viewportHeight) <= 20);
    await page.getByRole('link', { name: /Skill 库/ }).click();
    await page.locator('#skill-search').fill(healthSamples.issue);
    const mobileIssueRow = page.locator('#skill-list .skill-row[data-skill="' + healthSamples.issue + '"]');
    await mobileIssueRow.waitFor();
    await mobileIssueRow.click();
    await page.locator('#skill-detail .detail-head h2', { hasText: healthSamples.issue }).waitFor();
    assert.strictEqual(await mobileIssueRow.locator('.size').evaluate(function hidden(element) { return getComputedStyle(element).display; }), 'none');
    assert.notStrictEqual(await mobileIssueRow.locator('.update-pill').evaluate(function visible(element) { return getComputedStyle(element).display; }), 'none');
    assert.notStrictEqual(await mobileIssueRow.locator('.health-pill').evaluate(function visible(element) { return getComputedStyle(element).display; }), 'none');
    assert.strictEqual(await page.evaluate(function noHorizontalScroll() { return document.documentElement.scrollWidth <= document.documentElement.clientWidth; }), true);
    await page.locator('#skill-search').fill('1password');
    await page.locator('#skill-list .skill-row[data-skill="1password"]').click();
    await page.locator('#skill-detail .detail-head h2', { hasText: '1password' }).waitFor();
    assert.strictEqual(await page.locator('#skill-detail .source-links .source-link').count(), 3);
    assert.strictEqual(await page.evaluate(function sourceLinksFit() { return document.documentElement.scrollWidth <= document.documentElement.clientWidth; }), true);
    await page.screenshot({ path: '/tmp/ash-ui-mobile.png', fullPage: true });
    await page.getByRole('link', { name: /维护/ }).click();
    await page.locator('#removal-rollback-card').waitFor();
    assert.strictEqual(await page.evaluate(function mobileRecoveryFits() { return document.documentElement.scrollWidth <= document.documentElement.clientWidth; }), true);
    const mobileRecoveryRow = page.locator('#removal-rollback-card .removal-row').first();
    if (await mobileRecoveryRow.count()) {
      assert.strictEqual(await mobileRecoveryRow.getByRole('button', { name: '恢复' }).isVisible(), true);
      assert.strictEqual(await mobileRecoveryRow.getByRole('button', { name: '永久删除' }).isVisible(), true);
    }
    await page.screenshot({ path: '/tmp/ash-ui-mobile-maintenance.png', fullPage: true });
    await page.setViewportSize({ width: 812, height: 375 });
    await page.waitForTimeout(250);
    assert.strictEqual(await page.evaluate(function landscapeRecoveryFits() { return document.documentElement.scrollWidth <= document.documentElement.clientWidth; }), true);
    assert.deepStrictEqual(browserErrors, []);
    process.stdout.write(JSON.stringify({
      title: await page.title(),
      skills: await page.locator('#metric-grid .metric-value').first().textContent(),
      readability,
      screenshots: ['/tmp/ash-ui-overview.png', '/tmp/ash-ui-library.png', '/tmp/ash-ui-update-detail.png', '/tmp/ash-ui-source-detail.png', '/tmp/ash-ui-source-link.png', '/tmp/ash-ui-maintenance.png', '/tmp/ash-ui-mobile.png', '/tmp/ash-ui-mobile-maintenance.png'],
      browser_errors: browserErrors,
    }, null, 2) + '\n');
  } finally {
    await browser.close();
    removeTree(scanRoot);
  }
}

main().catch(function failed(error) {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
