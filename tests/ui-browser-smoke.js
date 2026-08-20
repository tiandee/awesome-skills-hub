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
    assert.deepStrictEqual(await page.locator('.table-head > span').allTextContents(), ['名称', '体量', '更新', '健康']);
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
    await page.getByRole('button', { name: '添加扫描目录' }).click();
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
    assert(/待检查|最新|可更新|待接管|待重建|外部管理|异常/.test(await page.locator('#skill-detail .update-source').textContent()));
    await page.screenshot({ path: '/tmp/ash-ui-update-detail.png', fullPage: true });

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
    assert((await page.locator('#retention-card').textContent()).includes('清理历史事务'));
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

    await page.setViewportSize({ width: 390, height: 844 });
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
    assert.deepStrictEqual(browserErrors, []);
    process.stdout.write(JSON.stringify({
      title: await page.title(),
      skills: await page.locator('#metric-grid .metric-value').first().textContent(),
      readability,
      screenshots: ['/tmp/ash-ui-overview.png', '/tmp/ash-ui-library.png', '/tmp/ash-ui-update-detail.png', '/tmp/ash-ui-source-detail.png', '/tmp/ash-ui-source-link.png', '/tmp/ash-ui-maintenance.png', '/tmp/ash-ui-mobile.png'],
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
