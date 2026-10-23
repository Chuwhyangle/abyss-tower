// 视觉分层与传送门表现：纯函数预算边界、生物群系分层定义、低配/高配绘制差异，
// 以及"画质不改变战斗结果"的同种子回归。渲染层只读模拟状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BACKGROUND_LAYERS,
  BIOME_SCENES,
  ambientParticleBudget,
  biomeScene,
  decorExclusion,
} from '../public/js/render/background-renderer.js';
import {
  PORTAL_PROFILES,
  PORTAL_SPARK_CAP,
  PortalRenderer,
  portalChargeLevel,
  portalProfile,
  portalSparkCount,
} from '../public/js/render/portal-renderer.js';
import { biomePalette } from '../public/js/render/palette.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const BACKGROUND_SRC = fs.readFileSync(
  new URL('../public/js/render/background-renderer.js', import.meta.url),
  'utf8'
);
const PORTAL_SRC = fs.readFileSync(
  new URL('../public/js/render/portal-renderer.js', import.meta.url),
  'utf8'
);

const ARCHETYPES = ['canyon', 'twin', 'triple', 'ring', 'cross'];
const PALETTE_KEYS = [
  'grass1', 'grass2', 'grid', 'pathEdge', 'path', 'pathInner',
  'pathLine', 'tuft', 'rock', 'rockEdge', 'accent', 'ambient',
];

test('每个生物群系都有调色板与完整分层定义', () => {
  assert.deepEqual([...BACKGROUND_LAYERS], ['far', 'mist', 'ground', 'decor', 'particles']);
  for (const archetype of ARCHETYPES) {
    const palette = biomePalette({ archetype });
    for (const key of PALETTE_KEYS) {
      assert.ok(palette[key], `${archetype}.palette.${key} 缺失`);
    }

    const scene = biomeScene({ archetype });
    assert.equal(scene, BIOME_SCENES[archetype], `${archetype} 分层定义未注册`);
    for (const layer of BACKGROUND_LAYERS) {
      assert.ok(scene[layer], `${archetype}.${layer} 分层缺失`);
    }
    assert.ok(scene.far.bands >= 2, `${archetype}.far.bands 至少两层`);
    assert.ok(scene.far.alpha > 0 && scene.far.alpha < 0.2, `${archetype}.far.alpha 低对比度`);
    assert.ok(scene.mist.patches > 0 && scene.mist.alpha > 0);
    assert.ok(scene.particles.max > 0 && scene.particles.size > 0);
    assert.ok(scene.decor.prop, `${archetype}.decor.prop 缺失`);
    assert.equal(typeof scene.ground.moss, 'number');
  }

  // 未知/缺失原型回退 canyon，渲染永不因地图数据缺字段而中断。
  assert.equal(biomeScene({ archetype: 'unknown' }), BIOME_SCENES.canyon);
  assert.equal(biomeScene(null), BIOME_SCENES.canyon);
  assert.equal(biomeScene({}), BIOME_SCENES.canyon);
});

test('环境粒子预算：低配降级、off 归零、永不超过场景上限', () => {
  assert.equal(ambientParticleBudget('off', 64), 0);
  assert.equal(ambientParticleBudget('full', 64), 64);
  assert.equal(ambientParticleBudget('light', 64), Math.round(64 * 0.35));
  assert.equal(ambientParticleBudget(undefined, 64), Math.round(64 * 0.35));
  assert.ok(ambientParticleBudget('light', 64) < ambientParticleBudget('full', 64));

  // 边界值：0/负数/NaN/小数/极小上限
  assert.equal(ambientParticleBudget('full', 0), 0);
  assert.equal(ambientParticleBudget('full', -10), 0);
  assert.equal(ambientParticleBudget('full', NaN), 0);
  assert.equal(ambientParticleBudget('full', Number.POSITIVE_INFINITY), 0);
  assert.equal(ambientParticleBudget('full', 3.9), 3);
  assert.equal(ambientParticleBudget('light', 1), 1);
  assert.equal(ambientParticleBudget('off', -1), 0);

  for (const scene of Object.values(BIOME_SCENES)) {
    assert.ok(ambientParticleBudget('full', scene.particles.max) <= scene.particles.max);
  }
});

test('装饰排除区：路径格及其 8 邻域不放置地表道具', () => {
  const map = generateMap('render-visuals-decor');
  const excluded = decorExclusion(map);
  assert.ok(map.pathCells.length > 0, '地图应有路径格');
  for (const cell of map.pathCells) {
    assert.ok(excluded.has(cell.c * map.rows + cell.r), '路径格未被排除');
  }
  const target = map.pathCells[0];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = target.c + dc;
      const r = target.r + dr;
      if (c >= 0 && c < map.cols && r >= 0 && r < map.rows) {
        assert.ok(excluded.has(c * map.rows + r), `路径邻格 (${c},${r}) 未被排除`);
      }
    }
  }
});

test('传送门画质档位：低配光晕/环数/粒子均少于高配且不超上限', () => {
  assert.equal(portalProfile(true), PORTAL_PROFILES.high);
  assert.equal(portalProfile(false), PORTAL_PROFILES.low);
  assert.equal(portalProfile(undefined), PORTAL_PROFILES.low);

  const low = portalProfile(false);
  const high = portalProfile(true);
  assert.equal(low.halo, false);
  assert.equal(high.halo, true);
  assert.ok(low.haloRadius < high.haloRadius);
  assert.ok(low.rings < high.rings);
  assert.ok(low.trail < high.trail);
  assert.ok(portalSparkCount(low) < portalSparkCount(high));
  assert.ok(portalSparkCount(high) <= PORTAL_SPARK_CAP);

  assert.equal(portalSparkCount(undefined), 0);
  assert.equal(portalSparkCount({ sparks: -5 }), 0);
  assert.equal(portalSparkCount({ sparks: NaN }), 0);
  assert.equal(portalSparkCount({ sparks: 99 }), PORTAL_SPARK_CAP);
  assert.equal(portalSparkCount({ sparks: 2.9 }), 2);
});

test('充能预警强度：整备呼吸、波中满格、其余熄灭', () => {
  assert.equal(portalChargeLevel('wave', 0), 1);
  assert.equal(portalChargeLevel('wave', 99), 1);
  assert.equal(portalChargeLevel('over', 1), 0);
  assert.equal(portalChargeLevel(undefined, 1), 0);
  assert.equal(portalChargeLevel('prep', NaN), 0.55);

  for (const time of [0, 0.3, 0.7, 1.2, 2.4, 5]) {
    const level = portalChargeLevel('prep', time);
    assert.ok(level >= 0.37 && level <= 0.73, `充能强度越界：${level}`);
  }
  assert.equal(portalChargeLevel('prep', 0.6), portalChargeLevel('prep', 0.6), '必须确定性');
});

function makeCtx() {
  const counts = { arc: 0, lineTo: 0, fill: 0, stroke: 0, fillText: 0, setLineDash: 0 };
  const gradient = { addColorStop() {} };
  const ctx = {
    counts,
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() { counts.lineTo++; },
    arc() { counts.arc++; },
    ellipse() {},
    fill() { counts.fill++; },
    stroke() { counts.stroke++; },
    fillText() { counts.fillText++; },
    setLineDash() { counts.setLineDash++; },
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
  };
  return ctx;
}

test('传送门状态与渲染：编号/方向/充能齐全，低配绘制量少于高配', () => {
  const map = generateMap('render-visuals-portal');
  const game = {
    map,
    lanes: map.lanes,
    phase: 'prep',
    time: 0.4,
    activePortals: [],
    baseHp: 12,
    maxBaseHp: 20,
  };
  const renderer = new PortalRenderer(game);

  const states = renderer.states(0.4);
  assert.equal(states.length, map.spawns.length);
  states.forEach((state, index) => {
    assert.equal(state.index, index);
    assert.equal(state.label, index + 1);
    assert.equal(state.active, true);
    assert.equal(state.dimmed, false);
    assert.ok(state.charge > 0, '整备阶段应处于充能状态');
  });

  // 状态原地更新：重复调用不新建数组。
  assert.equal(renderer.states(0.5), states);

  game.phase = 'wave';
  game.activePortals = [0];
  const waveStates = renderer.states();
  assert.equal(waveStates[0].active, true);
  assert.equal(waveStates[0].charge, 1);
  if (waveStates.length > 1) {
    assert.equal(waveStates[1].active, false);
    assert.equal(waveStates[1].dimmed, true);
  }

  game.phase = 'prep';
  const lowCtx = makeCtx();
  renderer.render(lowCtx, 0.4, false);
  const highCtx = makeCtx();
  renderer.render(highCtx, 0.4, true);
  assert.ok(lowCtx.counts.arc > 0);
  assert.ok(highCtx.counts.arc > lowCtx.counts.arc, '高配应绘制更多环/粒子');
  assert.ok(highCtx.counts.lineTo > lowCtx.counts.lineTo, '高配方向尾迹更长');
  assert.equal(lowCtx.counts.fillText, map.spawns.length, '每个入口都有编号');
  assert.ok(lowCtx.counts.setLineDash > 0, '整备阶段绘制充能虚线预警');
});

test('源码级：渲染层只读模拟状态，不依赖模拟模块', () => {
  for (const source of [BACKGROUND_SRC, PORTAL_SRC]) {
    assert.doesNotMatch(source, /from\s+'\.\.\/sim\.js'/, '渲染层不得依赖模拟模块');
    assert.doesNotMatch(source, /sim\.(?:update|beginWave|spawnEnemy)\s*\(/, '不得驱动模拟');
    assert.doesNotMatch(
      source,
      /game\.(?:phase|baseHp|maxBaseHp|gold|enemies|towers|projectiles|wave)\s*=(?!=)/,
      '不得写回模拟状态'
    );
  }
  // 背景渲染器只允许创建一个离屏 canvas，不碰 DOM 查询/标记。
  assert.doesNotMatch(BACKGROUND_SRC, /querySelector|innerHTML/);
  assert.doesNotMatch(PORTAL_SRC, /document\.|querySelector|innerHTML/);
});

test('源码级：每帧渲染不新建粒子/状态对象，背景只烘焙一次', () => {
  const renderBody = PORTAL_SRC.slice(PORTAL_SRC.indexOf('  render(g, time, glowOn)'));
  assert.doesNotMatch(renderBody, /\.push\(/, 'render 内不得向数组追加');
  assert.doesNotMatch(renderBody, /new\s+[A-Z]/, 'render 内不得新建对象');
  assert.doesNotMatch(renderBody, /\.map\(|\.filter\(|Array\.from/, 'render 内不得批量分配');
  assert.match(PORTAL_SRC, /this\._states = this\.spawns\.map/, '状态对象只在构造期创建');
  assert.match(PORTAL_SRC, /portalSparkCount\(profile\)/, '粒子数必须经过上限函数');
  assert.match(PORTAL_SRC, /profile\.pulseAmp/, '呼吸脉冲幅度随档位变化');
  assert.match(PORTAL_SRC, /portalChargeLevel/, '充能预警走纯函数');

  assert.match(BACKGROUND_SRC, /ambientParticleBudget\(decor, scene\.particles\.max\)/);
  assert.match(BACKGROUND_SRC, /decorExclusion\(map\)/);
  // 背景在 build() 中烘焙，render.js 只 drawImage 这份离屏 canvas。
  assert.match(BACKGROUND_SRC, /return bg;/);
});

function runSim(quality) {
  const seed = 'render-visuals-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 300,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow'],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({ effects: quality, floaters: quality === 'full' ? 'all' : 'off' });
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);
  for (let i = 0; i < 600; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }
  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    enemies: sim.enemies.map((e) => [
      e.type,
      Math.round(e.hp * 1e6),
      e.x.toFixed(6),
      e.y.toFixed(6),
    ]),
  });
}

test('同种子同布局：低配/高配战斗状态哈希一致', () => {
  const full = runSim('full');
  const off = runSim('off');
  const light = runSim('light');
  assert.equal(off, full);
  assert.equal(light, full);
});
