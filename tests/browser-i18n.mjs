// 双语实机验收（AC-026）：en-US 下走一遍大厅 → 7 个面板 → 开局 → 结算，
// 逐屏断言正文、aria-label / title / placeholder 零 CJK、零裸键、window.__bootErrors 为空；
// 再切回 zh-CN 复跑一遍，确认切换后没有空洞。
// 用法：node tests/browser-i18n.mjs（需要本机 Chrome）
import path from 'node:path';
import {
  startTestServer,
  launchBrowser,
  registerAndLogin,
  chooseFirstMap,
} from './harness.mjs';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
// 裸键：形如 area.section.key（至少两段点分），且不在词典里。
const KEY_LOOKING = /[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){2,}/g;
const KNOWN_KEYS = new Set([...Object.keys(zhCN), ...Object.keys(enUS)]);

const LOCALE_KEY = 'abyss-tower.locale.v1';

const SNAPSHOT = `(() => {
  const attrs = [];
  document.querySelectorAll('[aria-label], [title], [placeholder]').forEach((node) => {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const value = node.getAttribute(name);
      if (value) attrs.push({ name, value, where: node.id || node.className || node.tagName });
    }
  });
  return {
    text: document.body.innerText || '',
    attrs,
    bootErrors: window.__bootErrors || [],
    locale: document.documentElement.lang,
  };
})()`;

function scanSnapshot(label, snapshot) {
  const problems = [];
  for (const line of String(snapshot.text).split('\n')) {
    if (CJK_RE.test(line)) problems.push(`${label} 正文残留中文：${line.trim().slice(0, 90)}`);
  }
  for (const attr of snapshot.attrs) {
    if (CJK_RE.test(attr.value)) {
      problems.push(`${label} ${attr.name} 残留中文：${attr.value}（${attr.where}）`);
    }
  }
  const haystack = [snapshot.text, ...snapshot.attrs.map((attr) => attr.value)].join('\n');
  for (const match of haystack.matchAll(KEY_LOOKING)) {
    if (!KNOWN_KEYS.has(match[0])) problems.push(`${label} 出现裸键：${match[0]}`);
  }
  if (snapshot.bootErrors.length) {
    problems.push(`${label} __bootErrors：${snapshot.bootErrors.join(' | ')}`);
  }
  return problems;
}

async function audit(browser, label) {
  const snapshot = await browser.evaluate(SNAPSHOT);
  const problems = scanSnapshot(label, snapshot);
  if (problems.length) {
    throw new Error(`[${label}] ${problems.length} 处问题：\n${problems.join('\n')}`);
  }
  console.log(`[i18n] ${label} 通过（${snapshot.text.length} 字符，${snapshot.attrs.length} 个属性）`);
}

async function openPanel(browser, { click, selector, close, label }) {
  await browser.evaluate(`document.querySelector(${JSON.stringify(click)}).click()`);
  await browser.waitFor(
    `(() => { const node = document.querySelector(${JSON.stringify(selector)}); return !!node && !node.hidden; })()`,
    label,
    15000
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  await audit(browser, label);
  await browser.screenshot(path.join(OUT_DIR, `rtd-i18n-${label.replace(/[^\w-]/g, '')}.png`));
  if (close) {
    await browser.evaluate(`document.querySelector(${JSON.stringify(close)}).click()`);
    await browser.waitFor(
      `(() => { const node = document.querySelector(${JSON.stringify(selector)}); return !node || node.hidden; })()`,
      `${label} 关闭`,
      10000
    );
  }
}

async function lobbyAudit(browser) {
  await audit(browser, '标题页');
  await openPanel(browser, {
    click: '#btn-board',
    selector: '#leaderboard-panel',
    close: '#lb-close',
    label: '排行榜',
  });
  await openPanel(browser, {
    click: '#btn-bounties',
    selector: '#bounties-panel',
    close: '#btn-bounties-close',
    label: '悬赏',
  });
  await openPanel(browser, {
    click: '#btn-season-pass',
    selector: '#season-pass-panel',
    close: '#btn-season-pass-close',
    label: '通行证',
  });
  await openPanel(browser, {
    click: '#btn-cosmetics',
    selector: '#cosmetics-panel',
    close: '#btn-cosmetics-close',
    label: '外观',
  });
  await openPanel(browser, {
    click: '#btn-notifications',
    selector: '#notifications-panel',
    close: '#btn-notifications-close',
    label: '通知偏好',
  });
  await openPanel(browser, {
    click: '#btn-share',
    selector: '#share-panel',
    close: '[data-share-close]',
    label: '分享码',
  });
}

// 局内切换语言：走设置面板的真实 select（setLocale 会重建面板并广播 i18n:change）。
async function switchLocale(browser, locale) {
  await browser.evaluate(`document.querySelector('#btn-settings-title').click()`);
  await browser.waitFor(`!!document.querySelector('#set-locale')`, '设置面板');
  await browser.evaluate(`(() => {
    const select = document.querySelector('#set-locale');
    select.value = ${JSON.stringify(locale)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await browser.waitFor(
    `document.documentElement.lang === ${JSON.stringify(locale)}`,
    `切到 ${locale}`
  );
  await browser.evaluate(`document.querySelector('#settings-cancel').click()`);
  await browser.waitFor(`!document.querySelector('.settings')`, '设置面板关闭');
  console.log(`[i18n] 语言切换 → ${locale} 生效`);
}

async function playToResult(browser) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await chooseFirstMap(browser);
  await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
  await new Promise((resolve) => setTimeout(resolve, 400));
  await audit(browser, '战斗 HUD');
  await browser.screenshot(path.join(OUT_DIR, 'rtd-i18n-game.png'));

  // 先开波（结算只在波次中判定），再直接打空基地生命，走真实失败结算路径。
  await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
  await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
  await browser.evaluate(`
    (() => {
      const sim = window.__rtd.state.sim;
      sim.baseHp = 0;
      sim.update(1 / 60);
    })()
  `);
  await browser.waitFor(`!!document.querySelector('.result-modal')`, '结算弹窗', 25000);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await audit(browser, '结算');
  await browser.screenshot(path.join(OUT_DIR, 'rtd-i18n-result.png'));

  // 回放面板与分享区在结算弹窗内渲染，单独再扫一次可见区块。
  const replayVisible = await browser.evaluate(`!!document.querySelector('[data-replay-panel]')`);
  if (!replayVisible) throw new Error('结算弹窗内没有回放面板（[data-replay-panel]）');
  const shareVisible = await browser.evaluate(`!!document.querySelector('[data-share-result]')`);
  if (!shareVisible) throw new Error('结算弹窗内没有分享区（[data-share-result]）');

  await browser.evaluate(`document.querySelector('#btn-home').click()`);
  await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '结算返回大厅');
}

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-i18n',
      cookie: session.rawCookie,
      initScript: `try { localStorage.setItem('${LOCALE_KEY}', 'en-US'); } catch (error) { /* about:blank */ }`,
    });

    const locale = await browser.evaluate(`document.documentElement.lang`);
    if (locale !== 'en-US') throw new Error(`语言未生效：documentElement.lang=${locale}`);

    await lobbyAudit(browser);
    await playToResult(browser);

    // 局内切换语言：设置面板的 select 触发 setLocale（zh-CN ⇄ en-US 各两次），不重载页面。
    for (const target of ['zh-CN', 'en-US', 'zh-CN', 'en-US', 'zh-CN']) {
      await switchLocale(browser, target);
      if (target === 'en-US') {
        await audit(browser, `切回 ${target}`);
      } else {
        const zhText = await browser.evaluate(`document.body.innerText`);
        if (!CJK_RE.test(zhText)) throw new Error(`切到 ${target} 后界面没有中文，语言切换未生效`);
      }
    }
    const zhLocale = await browser.evaluate(`document.documentElement.lang`);
    if (zhLocale !== 'zh-CN') throw new Error(`切回中文失败：documentElement.lang=${zhLocale}`);
    const zhText = await browser.evaluate(`document.body.innerText`);
    if (!CJK_RE.test(zhText)) throw new Error('切回 zh-CN 后界面没有中文，语言切换未生效');
    // 中文界面里允许中文，但仍不允许裸键与启动错误。
    const zhSnapshot = await browser.evaluate(SNAPSHOT);
    const bare = [];
    const hay = [zhSnapshot.text, ...zhSnapshot.attrs.map((attr) => attr.value)].join('\n');
    for (const match of hay.matchAll(KEY_LOOKING)) {
      if (!KNOWN_KEYS.has(match[0])) bare.push(match[0]);
    }
    if (bare.length) throw new Error(`zh-CN 界面出现裸键：${bare.join(', ')}`);
    if (zhSnapshot.bootErrors.length) {
      throw new Error(`zh-CN 界面 __bootErrors：${zhSnapshot.bootErrors.join(' | ')}`);
    }
    await browser.screenshot(path.join(OUT_DIR, 'rtd-i18n-zh-title.png'));

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }
    console.log('[i18n] 通过：en-US 大厅/6 面板/战斗/结算零 CJK、零裸键，zh-CN 切回无空洞');
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error('[i18n] 失败：', error.message);
  process.exit(1);
});
