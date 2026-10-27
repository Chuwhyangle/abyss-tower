// 场景精灵接入的真实浏览器验收（AC-031）：四场景 × 两视口走精灵资源，
// 以及屏蔽场景图集后的场景级程序化回退。复用隔离服务与临时数据库（tests/harness.mjs）。
// 用法：LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/browser-sprite-scenes.mjs
import path from 'node:path';

import { SCENE_KEYS, SCENE_SPRITES } from '../public/js/shared/scene-sprites.js';
import { chooseOpeningHex, launchBrowser, registerAndLogin, startTestServer } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const SETTINGS_KEY = 'abyss-tower.settings.v1';

// 两视口：桌面 1440×900（DPR 1）、移动 390×844（DPR 2）。id 集必须完全一致。
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
];

// 场景在 DOM 里的宿主选择器：标题是常驻页，选图/结算是弹窗，战斗是 Canvas。
const SCENE_HOSTS = {
  title: '#title-screen',
  map: '.map-modal',
  combat: '#game-screen canvas',
  result: '.result-modal',
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertSceneIds(actual, scene, label) {
  const expected = [...SCENE_SPRITES[scene].required].sort();
  if (!actual) throw new Error(`${label}：场景 ${scene} 未渲染`);
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error(`${label}：场景 ${scene} id 集不一致\n  期望 ${expected.join(', ')}\n  实际 ${actual.join(', ')}`);
  }
}

function sceneIdsExpression(scene) {
  const selector = JSON.stringify(SCENE_HOSTS[scene]);
  return `(() => {
    const root = document.querySelector(${selector});
    if (!root) return null;
    const ids = [...root.querySelectorAll('[data-sprite-id]')].map((el) => el.getAttribute('data-sprite-id'));
    return [...new Set(ids)].sort();
  })()`;
}

function sceneSpritesExpression(scene) {
  const selector = JSON.stringify(SCENE_HOSTS[scene]);
  return `(() => {
    const root = document.querySelector(${selector});
    if (!root) return null;
    return [...root.querySelectorAll('[data-sprite-id]')].map((el) => {
      const style = getComputedStyle(el);
      return {
        id: el.getAttribute('data-sprite-id'),
        fallback: el.getAttribute('data-sprite-fallback'),
        background: style.backgroundImage || '',
        width: style.width,
        height: style.height,
      };
    });
  })()`;
}

async function boot(browser, base, viewport, { blocked = [], label }) {
  // 移动视口用 DPR 2 设置，验证管线会选 @2x 变体；桌面固定 1。
  const dpr = viewport.deviceScaleFactor >= 2 ? 2 : 1;
  await browser.evaluate(
    `localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ qualityMode: 'manual', dpr: ${dpr}, decorations: 'full' }))`
  );
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
  await browser.send('Emulation.setTouchEmulationEnabled', {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1,
  });
  await browser.send('Network.setBlockedURLs', { urls: blocked });
  const stamp = `${Date.now()}-${label}`;
  await browser.send('Page.navigate', { url: `${base}/?boot=${stamp}` });
  await browser.waitFor(
    `location.search.includes('boot=${stamp}') && document.body.dataset.boot === 'ok'`,
    `页面启动（${label}）`
  );
}

// 等待后台精灵预载有结论（pending / inFlight 清零）。
async function waitSpritesSettled(browser, expression, label) {
  await browser.waitFor(
    `(() => {
      const sprites = ${expression};
      if (!sprites) return false;
      const stats = sprites.stats();
      return stats.total > 0 && stats.pending === 0 && stats.inFlight === 0;
    })()`,
    label
  );
}

async function enterMapScene(browser) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await chooseOpeningHex(browser);
  await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗');
}

async function enterCombat(browser) {
  await browser.evaluate(`document.querySelector('.map-card').click()`);
  await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '地图加载完成');
  await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
  await waitSpritesSettled(browser, 'window.__rtd.sprites', '战斗精灵预载完成');
}

async function openResult(browser) {
  await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
  await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
  await browser.evaluate(`(() => {
    const sim = window.__rtd.state.sim;
    sim.baseHp = 0;
    sim.update(1 / 60);
    return true;
  })()`);
  await browser.waitFor(`!!document.querySelector('.result-modal')`, '结算弹窗', 25000);
}

function combatReportExpression() {
  const required = JSON.stringify([...SCENE_SPRITES.combat.required]);
  return `(() => {
    const sprites = window.__rtd.sprites;
    if (!sprites) return null;
    const stats = sprites.stats();
    const ids = ${required};
    const canvas = document.querySelector('#game-screen canvas');
    let painted = 0;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) painted += 1;
    }
    return {
      draws: Object.fromEntries(ids.map((id) => [id, sprites.drawCount(id)])),
      variants: Object.fromEntries(ids.map((id) => [id, sprites.frame(id)?.variantDpr ?? null])),
      stats,
      fallback: canvas ? canvas.getAttribute('data-sprite-fallback') : null,
      painted,
      bootErrors: window.__bootErrors || [],
    };
  })()`;
}

function menuStatsExpression() {
  return `(() => {
    const sprites = window.__rtd.ui && window.__rtd.ui.sceneSprites ? window.__rtd.ui.sceneSprites() : null;
    if (!sprites) return null;
    return sprites.stats();
  })()`;
}

// ── 资源齐全臂：四场景 × 一视口 ───────────────────────────────────────────────
async function runReadyArm(browser, base, viewport) {
  const label = `${viewport.name}/资源齐全`;
  const shots = {};
  await boot(browser, base, viewport, { label: `${viewport.name}-ready` });

  // 1) 标题场景
  await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '标题页');
  await waitSpritesSettled(browser, `window.__rtd.ui?.sceneSprites?.()`, '大厅精灵预载完成');
  await wait(120);
  const titleIds = await browser.evaluate(sceneIdsExpression('title'));
  assertSceneIds(titleIds, 'title', label);
  const titleEls = await browser.evaluate(sceneSpritesExpression('title'));
  for (const item of titleEls) {
    if (!item.background.includes('/assets/sprites/')) {
      throw new Error(`${label}：标题元素 ${item.id} 未解析到 /assets/sprites/（${item.background}）`);
    }
  }
  shots.title = path.join(OUT_DIR, `rtd-scene-${viewport.name}-title.png`);
  await browser.screenshot(shots.title);

  // 2) 选图场景
  await enterMapScene(browser);
  const mapIds = await browser.evaluate(sceneIdsExpression('map'));
  assertSceneIds(mapIds, 'map', label);
  const mapEls = await browser.evaluate(sceneSpritesExpression('map'));
  for (const item of mapEls) {
    if (!item.background.includes('/assets/sprites/')) {
      throw new Error(`${label}：选图元素 ${item.id} 未解析到 /assets/sprites/（${item.background}）`);
    }
  }
  shots.map = path.join(OUT_DIR, `rtd-scene-${viewport.name}-map.png`);
  await browser.screenshot(shots.map);

  // 3) 战斗场景（Canvas）：每个必需 id 的绘制计数 ≥ 1
  await enterCombat(browser);
  await wait(400);
  const combat = await browser.evaluate(combatReportExpression());
  if (!combat) throw new Error(`${label}：战斗精灵管线不可用`);
  for (const id of SCENE_SPRITES.combat.required) {
    if (!(combat.draws[id] > 0)) {
      throw new Error(`${label}：战斗必需精灵 ${id} 绘制计数为 ${combat.draws[id]}（统计 ${JSON.stringify(combat.stats)}）`);
    }
  }
  if (combat.fallback) throw new Error(`${label}：资源齐全时画布不应标回退`);
  if (!(combat.painted > 0)) throw new Error(`${label}：战斗画面为空`);
  if (combat.bootErrors.length) throw new Error(`${label} 启动错误：${combat.bootErrors.join(' | ')}`);
  shots.combat = path.join(OUT_DIR, `rtd-scene-${viewport.name}-combat.png`);
  await browser.screenshot(shots.combat);

  // 4) 结算场景
  await openResult(browser);
  const resultIds = await browser.evaluate(sceneIdsExpression('result'));
  assertSceneIds(resultIds, 'result', label);
  const resultEls = await browser.evaluate(sceneSpritesExpression('result'));
  for (const item of resultEls) {
    if (!item.background.includes('/assets/sprites/')) {
      throw new Error(`${label}：结算元素 ${item.id} 未解析到 /assets/sprites/（${item.background}）`);
    }
  }
  shots.result = path.join(OUT_DIR, `rtd-scene-${viewport.name}-result.png`);
  await browser.screenshot(shots.result);

  return {
    ids: { title: titleIds, map: mapIds, combat: [...SCENE_SPRITES.combat.required].sort(), result: resultIds },
    draws: combat.draws,
    variants: combat.variants,
    shots,
  };
}

// ── 缺资源臂：屏蔽场景图集图片，四场景仍可到达并渲染 ─────────────────────────
async function runFallbackArm(browser, base, viewport) {
  const label = `${viewport.name}/缺资源`;
  const blocked = ['*scene-atlas*.png'];
  await boot(browser, base, viewport, { blocked, label: `${viewport.name}-blocked` });

  await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '标题页（缺资源）');
  await waitSpritesSettled(browser, `window.__rtd.ui?.sceneSprites?.()`, '大厅精灵预载结论');
  await wait(120);
  const menuStats = await browser.evaluate(menuStatsExpression());
  if (!menuStats || !(menuStats.failed > 0)) {
    throw new Error(`${label}：屏蔽场景图集后应有失败条目：${JSON.stringify(menuStats)}`);
  }
  const titleIds = await browser.evaluate(sceneIdsExpression('title'));
  assertSceneIds(titleIds, 'title', label);
  const titleEls = await browser.evaluate(sceneSpritesExpression('title'));
  if (!titleEls.every((item) => item.fallback === '1')) {
    throw new Error(`${label}：标题场景缺少 data-sprite-fallback 标记`);
  }
  const shots = {};
  shots.title = path.join(OUT_DIR, `rtd-scene-${viewport.name}-fallback-title.png`);
  await browser.screenshot(shots.title);

  await enterMapScene(browser);
  const mapIds = await browser.evaluate(sceneIdsExpression('map'));
  assertSceneIds(mapIds, 'map', label);
  const mapEls = await browser.evaluate(sceneSpritesExpression('map'));
  if (!mapEls.every((item) => item.fallback === '1')) {
    throw new Error(`${label}：选图场景缺少 data-sprite-fallback 标记`);
  }
  shots.map = path.join(OUT_DIR, `rtd-scene-${viewport.name}-fallback-map.png`);
  await browser.screenshot(shots.map);

  await enterCombat(browser);
  await wait(400);
  const combat = await browser.evaluate(combatReportExpression());
  if (!combat) throw new Error(`${label}：战斗精灵管线不可用`);
  for (const id of SCENE_SPRITES.combat.required) {
    if (combat.draws[id] > 0) throw new Error(`${label}：缺资源时不应绘制 ${id}`);
  }
  if (!(combat.stats.failed > 0)) throw new Error(`${label}：战斗管线应记录失败条目：${JSON.stringify(combat.stats)}`);
  if (combat.fallback !== '1') throw new Error(`${label}：战斗画布缺少 data-sprite-fallback 标记`);
  if (!(combat.painted > 0)) throw new Error(`${label}：缺资源时画布为空（程序化回退未绘制）`);
  if (combat.bootErrors.length) throw new Error(`${label} 启动错误：${combat.bootErrors.join(' | ')}`);
  shots.combat = path.join(OUT_DIR, `rtd-scene-${viewport.name}-fallback-combat.png`);
  await browser.screenshot(shots.combat);

  await openResult(browser);
  const resultIds = await browser.evaluate(sceneIdsExpression('result'));
  assertSceneIds(resultIds, 'result', label);
  const resultEls = await browser.evaluate(sceneSpritesExpression('result'));
  if (!resultEls.every((item) => item.fallback === '1')) {
    throw new Error(`${label}：结算场景缺少 data-sprite-fallback 标记`);
  }
  shots.result = path.join(OUT_DIR, `rtd-scene-${viewport.name}-fallback-result.png`);
  await browser.screenshot(shots.result);

  if (browser.pageErrors.length) throw new Error(`${label} 控制台错误：${browser.pageErrors.join(' | ')}`);

  return {
    ids: { title: titleIds, map: mapIds, result: resultIds },
    stats: combat.stats,
    menuFailed: menuStats.failed,
    shots,
  };
}

async function main() {
  const server = await startTestServer();
  const ready = {};
  const fallback = {};
  try {
    // 每个视口独立浏览器 + 独立账号：服务端的账号设置会覆盖 localStorage，
    // 复用同一账号会让移动臂的 DPR=2 设置被桌面臂保存的默认设置冲掉。
    for (const viewport of VIEWPORTS) {
      const session = await registerAndLogin(server.base);
      const browser = await launchBrowser({
        base: server.base,
        name: `rtd-sprite-scenes-${viewport.name}`,
        cookie: session.rawCookie,
      });
      try {
        ready[viewport.name] = await runReadyArm(browser, server.base, viewport);
        fallback[viewport.name] = await runFallbackArm(browser, server.base, viewport);
        if (browser.pageErrors.length) {
          throw new Error(`${viewport.name} 控制台错误：${browser.pageErrors.join(' | ')}`);
        }
      } finally {
        await browser.close();
      }
    }

    // 两视口同场景 id 集必须完全一致（DPR 变体可以不同）。
    for (const scene of SCENE_KEYS) {
      const left = ready.desktop.ids[scene];
      const right = ready.mobile.ids[scene];
      if (JSON.stringify(left) !== JSON.stringify(right)) {
        throw new Error(`两视口 ${scene} id 集不一致：桌面 ${left.join(',')} / 移动 ${right.join(',')}`);
      }
    }
    for (const scene of SCENE_KEYS) {
      console.log(`[sprite-scenes] ${scene.padEnd(7)} 桌面=${ready.desktop.ids[scene].join(',')}`);
      console.log(`[sprite-scenes] ${scene.padEnd(7)} 移动=${ready.mobile.ids[scene].join(',')}`);
    }
    console.log('[sprite-scenes] 战斗绘制计数：', JSON.stringify(ready.desktop.draws), JSON.stringify(ready.mobile.draws));
    console.log('[sprite-scenes] DPR 变体：', JSON.stringify(ready.desktop.variants), JSON.stringify(ready.mobile.variants));
    console.log('[sprite-scenes] 截图：');
    for (const [viewport, report] of Object.entries(ready)) {
      for (const [scene, file] of Object.entries(report.shots)) console.log(`  ${viewport}/${scene}: ${file}`);
    }
    console.log('[sprite-scenes] 缺资源臂截图：');
    for (const [viewport, report] of Object.entries(fallback)) {
      for (const [scene, file] of Object.entries(report.shots)) console.log(`  ${viewport}/${scene}: ${file}`);
    }
    console.log('[sprite-scenes] 缺资源臂统计：', JSON.stringify({
      desktop: fallback.desktop.stats,
      mobile: fallback.mobile.stats,
    }));
    console.log('[sprite-scenes] 通过');
  } finally {
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[sprite-scenes] FAIL: ${error.message || error}`);
  process.exit(1);
});
