// 结算场景修复的真实浏览器验收（gap-result-scene-polish）：
// 两视口（桌面 1440×900、横屏 844×390）下验证：
// 1) 结算面板精灵宿主不再是空占位框（承载结局眉题 + 标题）；
// 2) 难度标签归属结算分数区且包含难度名；
// 3) 星核徽章使用金色奖励语义（--gold，而非泛化粉色）；
// 4) 844×390 首屏可见「最终得分」标签、首行战绩与分享按钮。
// 复用隔离服务与临时数据库（tests/harness.mjs）。
// 用法：LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/browser-result-scene.mjs
import path from 'node:path';

import { launchBrowser, registerAndLogin, startTestServer } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const SETTINGS_KEY = 'abyss-tower.settings.v1';
// --gold: #ffd36b（art-tokens.js 的 role.reward.color）
const GOLD_RGB = 'rgb(255, 211, 107)';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'mobile-landscape', width: 844, height: 390, touch: true },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot(browser, base, viewport, label) {
  await browser.evaluate(
    `localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ qualityMode: 'manual', dpr: 1, decorations: 'full' }))`
  );
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.touch,
  });
  await browser.send('Emulation.setTouchEmulationEnabled', {
    enabled: viewport.touch,
    maxTouchPoints: viewport.touch ? 5 : 1,
  });
  const stamp = `${Date.now()}-${label}`;
  await browser.send('Page.navigate', { url: `${base}/?boot=${stamp}` });
  await browser.waitFor(
    `location.search.includes('boot=${stamp}') && document.body.dataset.boot === 'ok'`,
    `页面启动（${label}）`
  );
}

async function openResult(browser) {
  await browser.evaluate(`(() => {
    window.__rtd.ui.showResult({
      stats: {
        wave: 12, clearedWave: 12, kills: 148, gold: 236, baseHp: 14, maxBaseHp: 20,
        victory: false, score: 8420, rawScore: 8420, cores: 34, mode: 'normal', difficulty: 'standard',
      },
      res: { reason: 'defeat', victory: false, score: 8420, coresEarned: 34, difficulty: 'standard' },
      mode: 'normal',
      dailyLeft: 3,
    });
    return true;
  })()`);
  await browser.waitFor('!!document.querySelector(".result-modal")', '结算弹窗');
  // 结算分数有 600ms 的数字滚动：等它停在终值，布局才稳定。
  await wait(900);
}

function metricsExpression() {
  return `(() => {
    const modal = document.querySelector('.result-modal');
    const panel = modal && modal.querySelector('[data-result-panel]');
    const hero = panel && panel.querySelector('.result-hero');
    const title = hero && hero.querySelector('h2');
    const diffTag = modal && modal.querySelector('.result-score .diff-tag');
    const coresB = modal && modal.querySelector('.result-cores b');
    const coresIcon = modal && modal.querySelector('.result-cores-icon .icon');
    const finalScore = modal && modal.querySelector('.result-score .muted');
    const firstGrid = modal && modal.querySelector('.result-grid div');
    const share = modal && modal.querySelector('[data-result-share]');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return {
      panelSpriteId: panel ? panel.getAttribute('data-sprite-id') : null,
      panelText: panel ? panel.textContent.trim() : null,
      heroInPanel: !!hero,
      titleText: title ? title.textContent.trim() : null,
      diffTagText: diffTag ? diffTag.textContent.trim() : null,
      diffTagInScore: !!diffTag,
      coresColor: coresB ? getComputedStyle(coresB).color : null,
      coresIconColor: coresIcon ? getComputedStyle(coresIcon).color : null,
      finalScoreText: finalScore ? finalScore.textContent.trim() : null,
      finalScoreRect: rect(finalScore),
      firstGridRect: rect(firstGrid),
      shareRect: rect(share),
      viewportHeight: window.innerHeight,
    };
  })()`;
}

function assertVisibleInViewport(rect, viewport, label) {
  if (!rect) throw new Error(`${label}：元素未渲染`);
  if (!(rect.width > 0 && rect.height > 0)) throw new Error(`${label}：元素尺寸为零（${JSON.stringify(rect)}）`);
  if (rect.top < 0 || rect.bottom > viewport.height) {
    throw new Error(`${label}：元素越出首屏（rect=${JSON.stringify(rect)}，视口高 ${viewport.height}）`);
  }
}

async function runViewport(browser, base, viewport) {
  const label = viewport.name;
  await boot(browser, base, viewport, label);
  await openResult(browser);

  const m = await browser.evaluate(metricsExpression());
  if (m.panelSpriteId !== 'ui/scene-result-panel') {
    throw new Error(`${label}：结算面板缺少精灵宿主 ui/scene-result-panel（${m.panelSpriteId}）`);
  }
  if (!m.panelText) throw new Error(`${label}：结算面板精灵宿主为空占位框`);
  if (!m.heroInPanel) throw new Error(`${label}：结算面板未承载 result-hero 标题块`);
  if (!m.titleText) throw new Error(`${label}：结算面板标题为空`);
  if (!m.diffTagInScore) throw new Error(`${label}：难度标签游离于结算分数区之外`);
  if (!m.diffTagText || !m.diffTagText.includes('远征')) {
    throw new Error(`${label}：难度标签未包含难度名（${m.diffTagText}）`);
  }
  if (m.coresColor !== GOLD_RGB) throw new Error(`${label}：星核数值不是金色（${m.coresColor}）`);
  if (m.coresIconColor !== GOLD_RGB) throw new Error(`${label}：星核图标不是金色（${m.coresIconColor}）`);
  if (m.finalScoreText !== '最终得分') throw new Error(`${label}：最终得分标签缺失（${m.finalScoreText}）`);

  // 首屏可见性只在短视口（≤520px）验收：桌面弹窗可滚动，分享入口无需压进首屏。
  const shortViewport = viewport.height <= 520;
  if (shortViewport) {
    assertVisibleInViewport(m.finalScoreRect, viewport, `${label}/最终得分`);
    assertVisibleInViewport(m.firstGridRect, viewport, `${label}/首行战绩`);
    assertVisibleInViewport(m.shareRect, viewport, `${label}/分享按钮`);
  }

  const shot = path.join(OUT_DIR, `rtd-result-scene-${label}.png`);
  await browser.screenshot(shot);
  return { shot, m };
}

async function main() {
  const server = await startTestServer();
  try {
    for (const viewport of VIEWPORTS) {
      const session = await registerAndLogin(server.base);
      const browser = await launchBrowser({
        base: server.base,
        name: `rtd-result-scene-${viewport.name}`,
        cookie: session.rawCookie,
      });
      try {
        const { shot } = await runViewport(browser, server.base, viewport);
        if (browser.pageErrors.length) {
          throw new Error(`${viewport.name} 控制台错误：${browser.pageErrors.join(' | ')}`);
        }
        console.log(`[result-scene] ${viewport.name} 通过，截图：${shot}`);
      } finally {
        await browser.close();
      }
    }
    console.log('[result-scene] 通过');
  } finally {
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[result-scene] FAIL: ${error.message || error}`);
  process.exit(1);
});
