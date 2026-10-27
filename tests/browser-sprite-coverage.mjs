// 单位精灵覆盖的真实浏览器验收：六类实体各自由图集帧绘制、状态切换换帧、缺资源程序化回退。
// 复用隔离服务与临时数据库（tests/harness.mjs），只读模拟状态；绘制计数靠测试侧给
// sprites.draw 包一层，不新增生产 API，也不改模拟层与数值。
// 用法：LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/browser-sprite-coverage.mjs
import fs from 'node:fs';
import path from 'node:path';

import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import { BOSS_VARIANTS } from '../public/js/shared/data/enemies.js';
import { DESTRUCTIBLE_TYPES } from '../public/js/shared/destructibles.js';
import { entityRecords } from '../public/js/render/sprite-coverage.js';
import { chooseFirstMap, launchBrowser, registerAndLogin, startTestServer } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const SETTINGS_KEY = 'abyss-tower.settings.v1';
const TOWER_TYPES = Object.keys(TOWERS);
const ENEMY_TYPES = Object.keys(ENEMIES);
const BOSS_VARIANTS_LIST = Object.keys(BOSS_VARIANTS);
const DESTRUCTIBLE_IDS = DESTRUCTIBLE_TYPES.map((type) => type.id);
const EVOLUTIONS = Object.fromEntries(
  TOWER_TYPES.map((type) => [type, TOWERS[type].evolutions.map((evolution) => evolution.id)])
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 测试侧插桩：只统计「真的画出来了」的调用（draw 返回 true），失败调用单独计数。
const SPY = `(() => {
  const sprites = window.__rtd.sprites;
  if (!sprites) return false;
  if (sprites.__spied) return true;
  const original = sprites.draw.bind(sprites);
  window.__spriteDrawn = {};
  window.__spriteMisses = 0;
  sprites.draw = (ctx, id, ...rest) => {
    const ok = original(ctx, id, ...rest);
    if (ok) window.__spriteDrawn[id] = (window.__spriteDrawn[id] || 0) + 1;
    else window.__spriteMisses += 1;
    return ok;
  };
  sprites.__spied = true;
  return true;
})()`;

function spawnScript() {
  return `(() => {
    const sim = window.__rtd.state.sim;
    const towerTypes = ${JSON.stringify(TOWER_TYPES)};
    const enemyTypes = ${JSON.stringify(ENEMY_TYPES)};
    const variants = ${JSON.stringify(BOSS_VARIANTS_LIST)};
    const destructibleIds = ${JSON.stringify(DESTRUCTIBLE_IDS)};
    sim.gold = 999999;
    // 全部塔型解锁（模拟层只认已解锁列表；覆盖率采样不涉及解锁玩法）。
    for (const type of towerTypes) {
      if (!sim.unlockedTowers.includes(type)) sim.unlockedTowers.push(type);
    }
    const cells = [];
    for (let r = 0; r < sim.map.rows; r += 1) {
      for (let c = 0; c < sim.map.cols; c += 1) {
        if (sim.canBuild(c, r)) cells.push({ c, r });
      }
    }
    const report = { towers: [], enemies: [], allies: 0, destructibles: [], skipped: [] };
    // 塔：每型一座，升到满级以便逐条应用进化。
    towerTypes.forEach((type, index) => {
      const cell = cells[index];
      if (!cell) { report.skipped.push('tower:' + type); return; }
      if (!sim.placeTower(type, cell.c, cell.r)) { report.skipped.push('tower:' + type); return; }
      const tower = sim.towerAt(cell.c, cell.r);
      if (!tower) { report.skipped.push('tower:' + type); return; }
      tower.level = sim.towerMaxLevel(tower) - 1;
      report.towers.push({ id: tower.id, type });
    });
    // 敌人：12 型各一只，外加 3 个首领变体；血量拉高，保证整段采样都活着。
    // spawnEnemy 只返回布尔/无返回值，实体从数组尾部取。
    const lastEnemy = () => sim.enemies[sim.enemies.length - 1];
    enemyTypes.forEach((type, index) => {
      const before = sim.enemies.length;
      sim.spawnEnemy(type, index % Math.max(1, sim.lanes.length), 1, 0.02 + index * 0.03);
      const enemy = sim.enemies.length > before ? lastEnemy() : null;
      if (!enemy) { report.skipped.push('enemy:' + type); return; }
      enemy.hp = 1e9;
      enemy.maxHp = 1e9;
      report.enemies.push({ id: enemy.id, type, variant: null });
    });
    variants.forEach((variant, index) => {
      const before = sim.enemies.length;
      sim.spawnEnemy('boss', index % Math.max(1, sim.lanes.length), 1, 0.4 + index * 0.05);
      const enemy = sim.enemies.length > before ? lastEnemy() : null;
      if (!enemy) { report.skipped.push('variant:' + variant); return; }
      enemy.variant = variant;
      enemy.hp = 1e9;
      enemy.maxHp = 1e9;
      report.enemies.push({ id: enemy.id, type: 'boss', variant });
    });
    // 召唤物：亡者军团的骷髅。
    const ally = sim.spawnAlly({ kind: 'skeleton', x: 2.5, y: 2.5, r: 0.22, ttl: 600, range: 6, rate: 1, dmg: 1 });
    report.allies = ally ? 1 : 0;
    // 可破坏物：地图不一定含全部 5 型，测试侧补齐（只新增展示用实例）。
    const have = new Set((sim.destructibles || []).map((item) => item.type));
    destructibleIds.forEach((type, index) => {
      if (have.has(type)) return;
      sim.destructibles.push({ id: 'coverage-' + type, type, c: 1 + index, r: sim.map.rows - 2, destroyed: false });
    });
    report.destructibles = (sim.destructibles || []).map((item) => ({ id: item.id, type: item.type }));
    return report;
  })()`;
}

function evolveScript(routeIndex, recoil = false) {
  return `(() => {
    const sim = window.__rtd.state.sim;
    const evolutions = ${JSON.stringify(EVOLUTIONS)};
    const applied = [];
    for (const tower of sim.towers) {
      const routes = evolutions[tower.type] || [];
      const route = routes[${routeIndex}];
      if (!route) continue;
      tower.evolutions = [];
      tower.evolution = null;
      tower.disabledUntil = 0;
      tower.recoil = ${recoil ? 1 : 0};
      if (sim.evolveTower(tower, [route])) applied.push(route);
    }
    return applied;
  })()`;
}

function stateScript() {
  return `(() => {
    const sim = window.__rtd.state.sim;
    // 塔：后坐帧 + 停摆帧各采样一次（渲染循环一帧内只取一个状态，故分两次调用）。
    for (const tower of sim.towers) {
      tower.recoil = 1;
      tower.disabledUntil = 0;
    }
    // 敌人：杂兵受击、首领吟唱。
    for (const enemy of sim.enemies) {
      if (enemy.variant) enemy.cast = { kind: 'roar', progress: 0.4 };
      else enemy.hitFlash = 1;
    }
    // 召唤物：出手帧。
    for (const ally of sim.allies) ally.recoil = 1;
    // 可破坏物：已毁帧。
    for (const item of sim.destructibles) item.destroyed = true;
    // 基地：低血受损帧。
    sim.baseHp = Math.max(1, Math.round(sim.maxBaseHp * 0.2));
    return true;
  })()`;
}

function towerDisabledScript() {
  return `(() => {
    const sim = window.__rtd.state.sim;
    for (const tower of sim.towers) {
      tower.recoil = 0;
      tower.disabledUntil = sim.time + 5;
    }
    return true;
  })()`;
}

function drawnIds() {
  return `Object.keys(window.__spriteDrawn || {}).sort()`;
}

function misses() {
  return `window.__spriteMisses || 0`;
}

async function bootWith(browser, base, { label, blocked = [] } = {}) {
  await browser.evaluate(
    `localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ qualityMode: 'manual', dpr: 1, decorations: 'full' }))`
  );
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.send('Network.setBlockedURLs', { urls: blocked });
  const stamp = `${Date.now()}-${label}`;
  await browser.send('Page.navigate', { url: `${base}/?boot=${stamp}` });
  await browser.waitFor(`location.search.includes('boot=${stamp}') && document.body.dataset.boot === 'ok'`, `页面启动（${label}）`);
}

async function startRun(browser, { waitSprites = true } = {}) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await chooseFirstMap(browser);
  await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
  if (!waitSprites) return;
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

function assertHas(drawn, id, label) {
  if (!drawn.includes(id)) throw new Error(`${label}：未绘制 ${id}`);
}

function assertAny(drawn, pattern, label) {
  if (!drawn.some((id) => pattern.test(id))) {
    throw new Error(`${label}：没有命中 ${pattern} 的帧（已绘制 ${drawn.length} 个：${drawn.join(', ')}）`);
  }
}

function assertFamily(drawn, family, label) {
  if (!drawn.some((id) => id.startsWith(`${family}.`))) {
    throw new Error(`${label}：实体族 ${family} 没有任何精灵帧被绘制（已绘制 ${drawn.length} 个：${drawn.join(', ')}）`);
  }
}

async function canvasPainted(browser) {
  return browser.evaluate(`(() => {
    const canvas = document.querySelector('#game-screen canvas');
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) painted += 1;
    return painted;
  })()`);
}

async function collectBlocked(browser) {
  return browser.evaluate(`(() => {
    const sprites = window.__rtd.sprites;
    const canvas = document.querySelector('#game-screen canvas');
    let painted = 0;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) painted += 1;
    }
    return {
      stats: sprites ? sprites.stats() : null,
      drawn: Object.keys(window.__spriteDrawn || {}),
      misses: window.__spriteMisses || 0,
      bootErrors: window.__bootErrors || [],
      painted,
    };
  })()`);
}

function assertFallback(report, { label, frames, requireFailed }) {
  if (report.drawn.length !== 0) throw new Error(`${label}：缺资源时不应绘制精灵帧：${report.drawn.join(', ')}`);
  if (!(report.misses > 0)) throw new Error(`${label}：draw() 应全部返回 false`);
  if (report.bootErrors.length) throw new Error(`${label} 启动错误：${report.bootErrors.join(' | ')}`);
  if (!(frames[1] > frames[0])) throw new Error(`${label}：渲染循环未推进`);
  if (!(report.painted > 0)) throw new Error(`${label}：画面为空，程序化回退未绘制`);
  if (requireFailed && !(report.stats && report.stats.failed > 0)) {
    throw new Error(`${label}：条目应为 failed：${JSON.stringify(report.stats)}`);
  }
  if (!requireFailed && report.stats && report.stats.total > 0 && report.stats.failed === 0) {
    throw new Error(`${label}：清单不可用时应没有可用条目：${JSON.stringify(report.stats)}`);
  }
}

async function frameCount(browser) {
  return browser.evaluate(`window.__rtd.state.app.metrics.frames`);
}

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  const report = {};
  try {
    browser = await launchBrowser({ base: server.base, name: 'rtd-sprite-coverage', cookie: session.rawCookie });

    // ── 1) 正常臂：六类实体各自被图集帧绘制 ────────────────────────────────
    await bootWith(browser, server.base, { label: 'coverage' });
    await startRun(browser);
    if (!(await browser.evaluate(SPY))) throw new Error('精灵管线未就绪，无法插桩');
    const spawned = await browser.evaluate(spawnScript());
    if (!spawned.towers.length || spawned.enemies.length < ENEMY_TYPES.length) {
      throw new Error(`实体生成不完整：${JSON.stringify(spawned.skipped)}`);
    }
    // 传送门在整备阶段按蓄能呼吸在待机/充能两帧间切换，采样窗口要跨过半个呼吸周期。
    await wait(1700);
    const baseDrawn = await browser.evaluate(drawnIds());
    for (const family of ['tower', 'enemy', 'summon', 'destructible', 'portal', 'base']) {
      assertFamily(baseDrawn, family, '基础采样');
    }
    for (const type of TOWER_TYPES) assertHas(baseDrawn, `tower.${type}.idle`, '塔基础形态');
    for (const type of ENEMY_TYPES) {
      if (ENEMIES[type].boss) continue;
      assertHas(baseDrawn, `enemy.${type}.move`, '敌人基础形态');
    }
    assertHas(baseDrawn, 'enemy.boss.move', '通用首领');
    for (const variant of BOSS_VARIANTS_LIST) assertHas(baseDrawn, `enemy.${variant}.move`, '首领变体');
    assertHas(baseDrawn, 'summon.skeleton.idle', '召唤物');
    for (const type of DESTRUCTIBLE_IDS) assertHas(baseDrawn, `destructible.${type}.alive`, '可破坏物');
    // 传送门按相位选帧：波次里恒为充能帧；整备待机帧由单测覆盖（相位切换会扰动波次逻辑，
    // 浏览器臂只断言当前相位下确实用图集帧而非程序化形体）。
    assertHas(baseDrawn, 'portal.spawn.charge', '传送门充能帧');
    assertHas(baseDrawn, 'base.crystal.idle', '基地待机帧');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-sprite-coverage.png'));
    report.base = { drawn: baseDrawn.length, misses: await browser.evaluate(misses()) };

    // ── 2) 进化形态：逐条应用 3 条进化，32 个塔形态全部出现 ────────────────
    const reached = new Set(baseDrawn);
    // 底座形态的后坐帧：先集中打一次 recoil，再清掉，避免与进化轮转耦合。
    await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      for (const tower of sim.towers) { tower.recoil = 1; tower.disabledUntil = 0; tower.evolutions = []; tower.evolution = null; }
      return true;
    })()`);
    await wait(220);
    for (const id of await browser.evaluate(drawnIds())) reached.add(id);
    await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      for (const tower of sim.towers) tower.recoil = 0;
      return true;
    })()`);
    for (let route = 0; route < 3; route += 1) {
      // 每条路线采样两帧：待机与后坐（同一形态的两种状态都要真的换帧）。
      for (const recoil of [false, true]) {
        const applied = await browser.evaluate(evolveScript(route, recoil));
        if (!applied.length) throw new Error(`第 ${route + 1} 条进化路线没有生效`);
        await wait(200);
        for (const id of await browser.evaluate(drawnIds())) reached.add(id);
      }
    }
    const missingForms = [];
    for (const type of TOWER_TYPES) {
      for (const evolution of EVOLUTIONS[type]) {
        const expected = `tower.${evolution}.idle`;
        if (!reached.has(expected)) missingForms.push(expected);
      }
    }
    if (missingForms.length) throw new Error(`进化形态未绘制：${missingForms.join(', ')}`);
    const missingAttacks = [];
    for (const type of TOWER_TYPES) {
      if (!reached.has(`tower.${type}.attack`)) missingAttacks.push(`tower.${type}.attack`);
    }
    for (const type of TOWER_TYPES) {
      for (const evolution of EVOLUTIONS[type]) {
        const expected = `tower.${evolution}.attack`;
        if (!reached.has(expected)) missingAttacks.push(expected);
      }
    }
    if (missingAttacks.length) throw new Error(`进化形态的后坐帧未绘制：${missingAttacks.join(', ')}`);
    report.evolutions = { applied: 24, samples: reached.size, attackFrames: 24 };

    // ── 3) 状态切换：帧 id 必须随状态变化 ────────────────────────────────
    await browser.evaluate(stateScript());
    await wait(260);
    const hurtDrawn = await browser.evaluate(drawnIds());
    // 进化轮转后塔已是最后一支进化形态，按模式断言而不锁死某个形态 id。
    assertAny(hurtDrawn, /^tower\..+\.attack$/, '塔后坐帧');
    assertHas(hurtDrawn, 'enemy.grunt.hit', '敌人受击帧');
    assertHas(hurtDrawn, 'enemy.armored.cast', '首领吟唱帧');
    assertHas(hurtDrawn, 'summon.skeleton.attack', '召唤物出手帧');
    assertHas(hurtDrawn, 'destructible.vein.ruined', '可破坏物已毁帧');
    assertHas(hurtDrawn, 'base.crystal.hurt', '基地受损帧');
    await browser.evaluate(towerDisabledScript());
    await wait(220);
    const disabledDrawn = await browser.evaluate(drawnIds());
    assertAny(disabledDrawn, /^tower\..+\.disabled$/, '塔停摆帧');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-sprite-coverage-states.png'));
    report.states = {
      recoil: hurtDrawn.filter((id) => id.endsWith('.attack')).length,
      hit: hurtDrawn.filter((id) => id.endsWith('.hit')).length,
      cast: hurtDrawn.filter((id) => id.endsWith('.cast')).length,
      ruined: hurtDrawn.filter((id) => id.endsWith('.ruined')).length,
      hurt: hurtDrawn.filter((id) => id.endsWith('.hurt')).length,
      disabled: disabledDrawn.filter((id) => id.endsWith('.disabled')).length,
    };
    // 绘制计数必须在本次导航内取：后面的缺资源臂会重新加载页面。
    const counts = await browser.evaluate(`window.__spriteDrawn || {}`);

    // ── 4) 缺资源臂：屏蔽 sprites 目录后六类实体程序化回退 ───────────────────
    // 4a 全屏蔽：清单本身也拿不到 → 管线没有任何条目，全部走程序化。
    await bootWith(browser, server.base, { label: 'blocked-all', blocked: ['*assets/sprites/*'] });
    await startRun(browser, { waitSprites: false });
    await browser.evaluate(SPY);
    await browser.evaluate(spawnScript());
    const allBefore = await frameCount(browser);
    await wait(900);
    const blockedAll = await collectBlocked(browser);
    const allAfter = await frameCount(browser);
    assertFallback(blockedAll, { label: '全屏蔽', frames: [allBefore, allAfter], requireFailed: false });
    await browser.screenshot(path.join(OUT_DIR, 'rtd-sprite-coverage-blocked.png'));

    // 4b 仅屏蔽图片：清单与图集 JSON 仍可加载 → stats().failed > 0，帧取不到 → 程序化回退。
    await bootWith(browser, server.base, { label: 'blocked-images', blocked: ['*entity-atlas*.png', '*probe*.png'] });
    await startRun(browser, { waitSprites: false });
    await browser.evaluate(SPY);
    await browser.evaluate(spawnScript());
    const imgBefore = await frameCount(browser);
    await wait(900);
    const blockedImages = await collectBlocked(browser);
    const imgAfter = await frameCount(browser);
    assertFallback(blockedImages, { label: '仅屏蔽图片', frames: [imgBefore, imgAfter], requireFailed: true });
    report.blocked = {
      all: { stats: blockedAll.stats, misses: blockedAll.misses, frames: [allBefore, allAfter] },
      images: { stats: blockedImages.stats, misses: blockedImages.misses, frames: [imgBefore, imgAfter] },
    };

    if (browser.pageErrors.length) throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);

    // DoD：打印每个实体的 id、精灵 id、状态帧 id 与绘制计数（本段采样跨基础/进化/状态三次）。
    console.log('[sprite-coverage] 实体 → 状态帧 → 绘制次数：');
    for (const record of entityRecords()) {
      const cells = Object.entries(record.states).map(([state, id]) => `${state}=${id}×${counts[id] || 0}`);
      console.log(`  ${record.id.padEnd(26)} ${cells.join('  ')}`);
    }
    console.log('[sprite-coverage] 通过');
    console.log(
      JSON.stringify(
        {
          实体: { 塔形态: spawned.towers.length, 敌人: spawned.enemies.length, 召唤物: spawned.allies, 可破坏物: spawned.destructibles.length },
          基础采样: report.base,
          进化: report.evolutions,
          状态: report.states,
          缺资源: report.blocked,
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
  console.error(`\n[sprite-coverage] FAIL: ${error.message || error}`);
  process.exit(1);
});
