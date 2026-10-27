// 精灵管线真实浏览器验收：预载、图集切帧、DPR 变体、缺资源回退。
// 复用隔离服务与临时数据库（tests/harness.mjs），不改模拟层与数值。
// 用法：LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/browser-sprites.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chooseFirstMap, launchBrowser, registerAndLogin, startTestServer } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const SETTINGS_KEY = 'abyss-tower.settings.v1';
const ATLAS_JSON = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public/assets/sprites/probe/probe-atlas.json'
);
const ENTRY_ID = 'fx/probe';
const FRAME_NAME = 'probe-idle-0';

// 记录管线告警条数（不改变 console.warn 的原有行为）。
const WARN_SPY = `
  (() => {
    window.__spriteWarns = [];
    const original = console.warn.bind(console);
    console.warn = (...args) => {
      const text = args.map((arg) => String(arg)).join(' ');
      if (text.includes('[sprites]')) window.__spriteWarns.push(text);
      original(...args);
    };
  })();
`;

function readAtlas() {
  return JSON.parse(fs.readFileSync(ATLAS_JSON, 'utf8'));
}

async function bootWith(browser, base, { dpr, deviceScaleFactor = 1, label }) {
  await browser.evaluate(
    `localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ qualityMode: 'manual', dpr: ${dpr} }))`
  );
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor,
    mobile: false,
  });
  const stamp = `${Date.now()}-${label}`;
  await browser.send('Page.navigate', { url: `${base}/?boot=${stamp}` });
  await browser.waitFor(
    `location.search.includes('boot=${stamp}') && document.body.dataset.boot === 'ok'`,
    `页面启动（${label}）`
  );
}

async function startRun(browser) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await chooseFirstMap(browser);
  await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
  await browser.waitFor(
    `(() => {
      const sprites = window.__rtd.sprites;
      if (!sprites) return false;
      const stats = sprites.stats();
      return stats.total > 0 && stats.ready + stats.failed + stats.skipped === stats.total;
    })()`,
    '精灵预载完成'
  );
}

async function spriteReport(browser) {
  return browser.evaluate(`(() => {
    const sprites = window.__rtd.sprites;
    const frame = sprites.frame(${JSON.stringify(ENTRY_ID)});
    const resources = performance
      .getEntriesByType('resource')
      .map((item) => item.name)
      .filter((name) => name.includes('/assets/sprites/'));
    return {
      devicePixelRatio: window.devicePixelRatio,
      stats: sprites.stats(),
      frame: frame
        ? { sx: frame.sx, sy: frame.sy, sw: frame.sw, sh: frame.sh, dw: frame.dw, dh: frame.dh, variantDpr: frame.variantDpr }
        : null,
      resources,
      bootErrors: window.__bootErrors || [],
      spriteWarns: window.__spriteWarns || [],
    };
  })()`);
}

function assertHealthy(report, label) {
  if (report.bootErrors.length) throw new Error(`${label} 启动错误：${report.bootErrors.join(' | ')}`);
}

function assertAtlasGeometry(report, atlas, label) {
  const expected = atlas.frames[FRAME_NAME];
  if (!report.frame) throw new Error(`${label} 自检资源未就绪`);
  const scale = report.frame.variantDpr;
  if (report.frame.sw !== expected.w * scale || report.frame.sh !== expected.h * scale) {
    throw new Error(
      `${label} 帧尺寸与 atlas JSON 不一致：${report.frame.sw}×${report.frame.sh} != ${expected.w * scale}×${expected.h * scale}`
    );
  }
  if (report.frame.sx !== expected.x * scale || report.frame.sy !== expected.y * scale) {
    throw new Error(`${label} 帧源点与 atlas JSON 不一致`);
  }
}

async function measureDraw(browser) {
  return browser.evaluate(`(() => {
    const sprites = window.__rtd.sprites;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const drew = sprites.draw(ctx, ${JSON.stringify(ENTRY_ID)}, 48, 32);
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < after.length; i += 4) if (after[i] > 0) painted += 1;
    let beforePainted = 0;
    for (let i = 3; i < before.length; i += 4) if (before[i] > 0) beforePainted += 1;
    return { drew, painted, beforePainted };
  })()`);
}

async function frameMetrics(browser) {
  return browser.evaluate(`(() => {
    const app = window.__rtd.state.app;
    return { frames: app.metrics.frames, renders: app.metrics.renders, phase: window.__rtd.state.sim.phase };
  })()`);
}

function requestedVariant(resources) {
  const hits = new Set();
  for (const url of resources) {
    if (/@2x\.png$/.test(url)) hits.add(2);
    else if (/\/probe\.png$/.test(url)) hits.add(1);
  }
  return [...hits].sort();
}

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  const atlas = readAtlas();
  let browser = null;
  const report = {};
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-sprites',
      cookie: session.rawCookie,
      initScript: WARN_SPY,
    });

    // 1) 设备 1x + settings.dpr=2：有效 DPR=1 → 只请求 @1x。
    await bootWith(browser, server.base, { dpr: 2, deviceScaleFactor: 1, label: 'device1-setting2' });
    await startRun(browser);
    const oneX = await spriteReport(browser);
    assertHealthy(oneX, 'DPR=1');
    assertAtlasGeometry(oneX, atlas, 'DPR=1');
    if (oneX.devicePixelRatio !== 1) throw new Error(`设备 DPR 期望 1，实际 ${oneX.devicePixelRatio}`);
    const oneXVariants = requestedVariant(oneX.resources);
    if (oneXVariants.includes(2)) throw new Error(`设备 DPR=1 时不得请求 @2x：${oneX.resources.join(', ')}`);
    if (!oneXVariants.includes(1)) throw new Error(`@1x 未被请求：${oneX.resources.join(', ')}`);
    const painted1x = await measureDraw(browser);
    if (!painted1x.drew || painted1x.painted === 0 || painted1x.beforePainted !== 0) {
      throw new Error(`draw() 未改变画布像素：${JSON.stringify(painted1x)}`);
    }
    await browser.screenshot(path.join(OUT_DIR, 'rtd-sprites-1x.png'));
    report.device1 = { ...oneX, variants: oneXVariants, painted: painted1x };

    // 2) 设备 2x + settings.dpr=2：有效 DPR=2 → 请求 @2x。
    await bootWith(browser, server.base, { dpr: 2, deviceScaleFactor: 2, label: 'device2-setting2' });
    await startRun(browser);
    const twoX = await spriteReport(browser);
    assertHealthy(twoX, 'DPR=2');
    assertAtlasGeometry(twoX, atlas, 'DPR=2');
    if (twoX.devicePixelRatio !== 2) throw new Error(`设备 DPR 期望 2，实际 ${twoX.devicePixelRatio}`);
    const twoXVariants = requestedVariant(twoX.resources);
    if (!twoXVariants.includes(2)) throw new Error(`设备 DPR=2 时未请求 @2x：${twoX.resources.join(', ')}`);
    if (twoXVariants.includes(1)) throw new Error(`设备 DPR=2 时不应再请求 @1x：${twoX.resources.join(', ')}`);
    if (twoX.frame.dw !== oneX.frame.dw * 2) throw new Error('@2x 变体的 dw 应为 @1x 的两倍');
    const painted2x = await measureDraw(browser);
    if (!painted2x.drew || painted2x.painted === 0) throw new Error('@2x 变体 draw() 未改变画布像素');
    report.device2 = { ...twoX, variants: twoXVariants, painted: painted2x };

    // 3) 设备 2x + settings.dpr=1：显式低画质只取 @1x（降级路径）。
    await bootWith(browser, server.base, { dpr: 1, deviceScaleFactor: 2, label: 'device2-setting1' });
    await startRun(browser);
    const downgraded = await spriteReport(browser);
    assertHealthy(downgraded, '降级');
    if (requestedVariant(downgraded.resources).includes(2)) throw new Error('settings.dpr=1 时不得请求 @2x');
    report.downgraded = { ...downgraded, variants: requestedVariant(downgraded.resources) };

    // 4) 缺资源：屏蔽自检 PNG 后重载——正常启动、条目 failed、画面照常推进、warn 只有一条。
    await browser.send('Network.setBlockedURLs', { urls: ['*probe*.png', '*probe@2x.png'] });
    await bootWith(browser, server.base, { dpr: 2, deviceScaleFactor: 1, label: 'blocked' });
    await startRun(browser);
    const blocked = await spriteReport(browser);
    assertHealthy(blocked, '缺资源');
    if (blocked.stats.failed !== 1) throw new Error(`缺资源条目应为 failed：${JSON.stringify(blocked.stats)}`);
    if (blocked.frame !== null) throw new Error('缺资源条目不应返回 frame');
    if (blocked.spriteWarns.length !== 1) {
      throw new Error(`缺资源 warn 应只有一条，实际 ${blocked.spriteWarns.length}：${blocked.spriteWarns.join(' | ')}`);
    }
    const before = await frameMetrics(browser);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const after = await frameMetrics(browser);
    if (!(after.frames > before.frames)) throw new Error('缺资源时渲染循环未继续推进');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-sprites-blocked.png'));
    report.blocked = { ...blocked, framesBefore: before.frames, framesAfter: after.frames };

    if (browser.pageErrors.length) throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);

    console.log('[sprites] 通过');
    console.log(
      JSON.stringify(
        {
          atlas: { frames: Object.keys(atlas.frames), size: atlas.size },
          device1: { stats: report.device1.stats, variants: report.device1.variants, dpr: report.device1.devicePixelRatio },
          device2: { stats: report.device2.stats, variants: report.device2.variants, dpr: report.device2.devicePixelRatio },
          downgraded: { variants: report.downgraded.variants, dpr: report.downgraded.devicePixelRatio },
          blocked: { stats: report.blocked.stats, warns: report.blocked.spriteWarns, frames: [report.blocked.framesBefore, report.blocked.framesAfter] },
          painted: { '1x': report.device1.painted.painted, '2x': report.device2.painted.painted },
        },
        null,
        2
      )
    );
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[sprites] FAIL: ${error.message || error}`);
  process.exit(1);
});
