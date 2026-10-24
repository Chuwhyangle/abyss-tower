// 塔进化路线视觉差异：24 条路线各有可辨识的轮廓 + 符文定义、画质预算单调、
// 未知回退安全，以及"画质不改变战斗结果"的同种子回归。
// 断言纯函数、绘制调用与源码级契约，不依赖 Canvas 像素。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  DEFAULT_EVOLUTION_VISUAL,
  EVOLUTION_RUNE_KINDS,
  EVOLUTION_SILHOUETTE_KINDS,
  EVOLUTION_VISUAL_BUDGET,
  EVOLUTION_VISUAL_RADIUS,
  EVOLUTION_VISUALS,
  TowerRenderer,
  evolutionVisual,
  evolutionVisualBudget,
  evolutionVisualCost,
} from '../public/js/render/tower-renderer.js';
import { TOWERS } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SRC = fs.readFileSync(
  new URL('../public/js/render/tower-renderer.js', import.meta.url),
  'utf8'
);

const TIERS = ['off', 'light', 'full'];

function allRoutes() {
  const routes = [];
  for (const [type, def] of Object.entries(TOWERS)) {
    for (const evolution of def.evolutions || []) {
      routes.push({ type, id: evolution.id, evolution });
    }
  }
  return routes;
}

// 记录路径点，用于比较两种轮廓/符文是否几何上不同。
function traceSignature(renderer, kind, radius = EVOLUTION_VISUAL_RADIUS) {
  const points = [];
  const ctx = {
    beginPath() {},
    closePath() {},
    moveTo(x, y) {
      points.push(['m', round(x), round(y)]);
    },
    lineTo(x, y) {
      points.push(['l', round(x), round(y)]);
    },
    quadraticCurveTo(cx, cy, x, y) {
      points.push(['q', round(cx), round(cy), round(x), round(y)]);
    },
    arc() {},
    rect() {},
  };
  renderer.traceEvolutionSilhouette(ctx, kind, radius, 0);
  return JSON.stringify(points);
}

function round(value) {
  return Number(value.toFixed(6));
}

function runeSignature(renderer, kind) {
  const points = [];
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo(x, y) {
      points.push(['m', round(x), round(y)]);
    },
    lineTo(x, y) {
      points.push(['l', round(x), round(y)]);
    },
    arc(x, y, r) {
      points.push(['a', round(x), round(y), round(r)]);
    },
    rect(x, y, w, h) {
      points.push(['r', round(x), round(y), round(w), round(h)]);
    },
    fill() {},
  };
  renderer.drawEvolutionRune(ctx, kind, 0, 0, 0);
  return JSON.stringify(points);
}

function makeCtx() {
  const calls = { stroke: 0, fill: 0, beginPath: 0, setLineDash: 0, rect: 0 };
  const ctx = {
    calls,
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {
      calls.beginPath += 1;
    },
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    ellipse() {},
    rect() {
      calls.rect += 1;
    },
    stroke() {
      calls.stroke += 1;
    },
    fill() {
      calls.fill += 1;
    },
    setLineDash() {
      calls.setLineDash += 1;
    },
  };
  return ctx;
}

function makeGame() {
  const towers = [];
  let i = 0;
  for (const [type, def] of Object.entries(TOWERS)) {
    const evolution = def.evolutions?.[0];
    if (!evolution) continue;
    towers.push({
      type,
      x: 1.5 + i * 1.2,
      y: 3.5,
      level: 2,
      angle: 0,
      recoil: 0,
      evolution: evolution.id,
      disabledUntil: 0,
    });
    i += 1;
  }
  return { towers, time: 2, selectedTower: null };
}

function renderOnce(renderer, game, tier) {
  const ctx = makeCtx();
  const settings = { decorations: tier, glow: false, highContrast: false, colorBlind: 'none' };
  renderer.render(ctx, game.time, settings);
  return ctx.calls;
}

test('24 条进化路线都有完整的视觉定义', () => {
  const routes = allRoutes();
  assert.equal(routes.length, 24, '塔进化路线数量应为 24');

  for (const { type, id } of routes) {
    const visual = evolutionVisual(id);
    assert.ok(visual, `${id} 缺少视觉定义`);
    assert.equal(visual, EVOLUTION_VISUALS[id], `${id} 未在注册表中`);
    assert.equal(visual.family, type, `${id} 的族归属错误`);
    assert.ok(
      EVOLUTION_SILHOUETTE_KINDS.includes(visual.shape),
      `${id} 轮廓形状未知：${visual.shape}`
    );
    assert.ok(EVOLUTION_RUNE_KINDS.includes(visual.rune), `${id} 符文未知：${visual.rune}`);
    assert.ok(visual.radius > 0 && visual.radius <= EVOLUTION_VISUAL_RADIUS);
    assert.ok(Object.isFrozen(visual), `${id} 视觉定义应冻结`);
  }

  // 没有多余的注册项：表与数据严格一一对应。
  assert.deepEqual(
    Object.keys(EVOLUTION_VISUALS).sort(),
    routes.map((route) => route.id).sort()
  );
});

test('同族三条路线的轮廓与符文两两不同，跨族也不撞同一组合', () => {
  const combos = new Set();
  for (const type of Object.keys(TOWERS)) {
    const visuals = (TOWERS[type].evolutions || []).map((evolution) =>
      evolutionVisual(evolution.id)
    );
    assert.equal(visuals.length, 3, `${type} 应有三条进化路线`);
    assert.equal(new Set(visuals.map((v) => v.shape)).size, 3, `${type} 三条路线轮廓必须互不相同`);
    assert.equal(new Set(visuals.map((v) => v.rune)).size, 3, `${type} 三条路线符文必须互不相同`);

    const renderer = new TowerRenderer({ towers: [] }, { glow: null });
    const shapes = visuals.map((v) => traceSignature(renderer, v.shape));
    assert.equal(new Set(shapes).size, 3, `${type} 轮廓必须产生不同几何，小尺寸才可辨`);
    const runes = visuals.map((v) => runeSignature(renderer, v.rune));
    assert.equal(new Set(runes).size, 3, `${type} 符文必须产生不同几何`);

    for (const visual of visuals) {
      const key = `${visual.shape}:${visual.rune}`;
      assert.ok(!combos.has(key), `跨族组合重复：${key}`);
      combos.add(key);
    }
  }
  assert.equal(combos.size, 24, '24 条路线必须两两组合不同');
});

test('画质预算单调：低配只显示轮廓，不出现符文粒子', () => {
  const off = evolutionVisualBudget('off');
  const light = evolutionVisualBudget('light');
  const full = evolutionVisualBudget('full');

  assert.equal(off.runes, 0);
  assert.equal(light.runes, 0, '低配不得出现符文粒子');
  assert.ok(full.runes > 0, '高配才有符文');
  assert.equal(off.spin, false);
  assert.equal(light.spin, false);
  assert.equal(full.spin, true);
  assert.equal(light.outline, true, '低配保留轮廓变化');
  assert.equal(off.outline, true, '关闭装饰仍保留静态轮廓，形态可辨');

  assert.ok(evolutionVisualCost(off) < evolutionVisualCost(light));
  assert.ok(evolutionVisualCost(light) < evolutionVisualCost(full));

  // 未知/缺失画质回退 light，渲染不中断。
  assert.equal(evolutionVisualBudget('bogus'), light);
  assert.equal(evolutionVisualBudget(undefined), light);
  assert.equal(evolutionVisualCost(), evolutionVisualCost(full));
});

test('绘制调用随画质递增，且只读塔状态', () => {
  const game = makeGame();
  const before = JSON.stringify(game);
  const renderer = new TowerRenderer(game, { glow: null });

  const off = renderOnce(renderer, game, 'off');
  const light = renderOnce(renderer, game, 'light');
  const full = renderOnce(renderer, game, 'full');

  assert.ok(light.stroke > off.stroke, `低配应多描内层轮廓（${off.stroke} → ${light.stroke}）`);
  assert.ok(full.stroke >= light.stroke, '高配不应少画轮廓');
  assert.equal(off.fill, light.fill, '低配/关闭档不得出现符文填充');
  assert.ok(full.fill > light.fill, `高配应多画符文（${light.fill} → ${full.fill}）`);
  assert.ok(full.setLineDash > light.setLineDash, '只有高配启用虚线滚动');
  assert.equal(JSON.stringify(game), before, '渲染不得写回塔/模拟状态');

  // 单独调用进化标识：符文数量严格等于预算。
  for (const tier of TIERS) {
    const ctx = makeCtx();
    renderer.drawEvolutionMark(
      ctx,
      1.25,
      DEFAULT_EVOLUTION_VISUAL,
      evolutionVisualBudget(tier),
      '#ffffff'
    );
    assert.ok(ctx.calls.stroke >= 1, `${tier} 至少描一次轮廓`);
    const expectedRunes = evolutionVisualBudget(tier).runes;
    assert.equal(ctx.calls.fill, expectedRunes, `${tier} 符文数量应与预算一致`);
  }
});

test('未知 / 缺失进化 id 安全回退', () => {
  assert.equal(evolutionVisual('not-a-route'), DEFAULT_EVOLUTION_VISUAL);
  assert.equal(evolutionVisual(undefined), DEFAULT_EVOLUTION_VISUAL);
  assert.equal(evolutionVisual(null), DEFAULT_EVOLUTION_VISUAL);
  assert.ok(EVOLUTION_SILHOUETTE_KINDS.includes(DEFAULT_EVOLUTION_VISUAL.shape));
  assert.ok(EVOLUTION_RUNE_KINDS.includes(DEFAULT_EVOLUTION_VISUAL.rune));
  assert.equal(evolutionVisual('not-a-route'), evolutionVisual('also-missing'));
});

test('源码级：走路线注册表、不遮挡、不引入素材', () => {
  assert.match(SRC, /evolutionVisual\(evolution\.id\)/, '渲染必须按进化 id 查视觉定义');
  assert.match(SRC, /evolutionVisualBudget\(settings\.decorations\)/, '预算必须由画质档位驱动');
  assert.match(SRC, /drawEvolutionMark\(/);
  assert.match(SRC, /traceEvolutionSilhouette\(/);
  assert.match(SRC, /drawEvolutionRune\(/);
  assert.doesNotMatch(SRC, /\.(?:png|jpe?g|webp|svg|gif)\b|new\s+Image\s*\(|fetch\s*\(/, '不得引入素材');
  // 进化标识只描边不填充底色，且半径受限于塔位尺度，避免遮挡血条与射程提示。
  assert.ok(EVOLUTION_VISUAL_RADIUS <= 25, '轮廓半径不得超过塔位尺度');
  const mark = SRC.slice(SRC.indexOf('  drawEvolutionMark('), SRC.indexOf('  // 停摆'));
  assert.doesNotMatch(mark, /globalAlpha|globalCompositeOperation/, '进化标识不得压暗其它图层');
});

function runBattle(decorations) {
  const seed = 'tower-evo-visuals-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 400,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [
      { type: 'arrow', c: 3, r: 3, level: 2, evolution: 'arrow-longbow' },
      { type: 'frost', c: 5, r: 7, level: 2, evolution: 'frost-icelance' },
      { type: 'cannon', c: 8, r: 4, level: 2, evolution: 'cannon-mortar' },
    ],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({
    effects: decorations === 'off' ? 'off' : 'full',
    floaters: decorations === 'off' ? 'off' : 'all',
  });
  const settings = { decorations, glow: false, highContrast: false, colorBlind: 'none' };
  const renderer = new TowerRenderer(sim, { glow: null });
  const ctx = makeCtx();
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);

  for (let i = 0; i < 900; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
    renderer.render(ctx, i / 60, settings);
  }

  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    towers: sim.towers.map((tower) => [tower.type, tower.evolution, tower.level, tower.c, tower.r]),
    enemies: sim.enemies.map((enemy) => [
      enemy.type,
      Math.round(enemy.hp * 1e6),
      enemy.x.toFixed(6),
      enemy.y.toFixed(6),
    ]),
  });
}

test('同种子：低配/高配战斗状态哈希一致', () => {
  const hash = (json) => createHash('sha256').update(json).digest('hex');
  const full = hash(runBattle('full'));
  const light = hash(runBattle('light'));
  const off = hash(runBattle('off'));
  assert.equal(light, full);
  assert.equal(off, full);
});
