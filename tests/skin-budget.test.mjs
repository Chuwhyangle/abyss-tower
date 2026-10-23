// 皮肤渲染预算：皮肤只改颜色/描边，不新增粒子与光晕；低配把轮廓并进已有描边，
// 高配才单独描环；未知皮肤回退默认；同种子同皮肤下低配/高配战斗状态哈希一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  EnemyRenderer,
  SKIN_OUTLINE_BUDGET as ENEMY_SKIN_BUDGET,
  skinOutlineBudget as enemySkinOutlineBudget,
} from '../public/js/render/enemy-renderer.js';
import {
  TowerRenderer,
  SKIN_OUTLINE_BUDGET as TOWER_SKIN_BUDGET,
  skinOutlineBudget as towerSkinOutlineBudget,
} from '../public/js/render/tower-renderer.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import {
  DEFAULT_SKIN_BY_TARGET,
  activeSkin,
  resetActiveSkins,
  setActiveSkins,
  skinColorFor,
} from '../public/js/shared/skins.js';
import { Palette } from '../public/js/render/palette.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const ENEMY_SRC = fs.readFileSync(
  new URL('../public/js/render/enemy-renderer.js', import.meta.url),
  'utf8'
);
const TOWER_SRC = fs.readFileSync(
  new URL('../public/js/render/tower-renderer.js', import.meta.url),
  'utf8'
);

const SKINNED = Object.freeze({ tower: 'ember_tower', enemy: 'frost_enemy' });
const DEFAULT = Object.freeze({ tower: 'default_tower', enemy: 'default_enemy' });

function makeCtx() {
  const calls = { ops: 0, stroke: 0, fill: 0, arc: 0, beginPath: 0 };
  const count = (name) => {
    calls.ops++;
    if (name in calls) calls[name]++;
  };
  const ctx = {
    calls,
    save() {},
    restore() {},
    beginPath() { count('beginPath'); },
    closePath() { count(); },
    arc() { count('arc'); },
    ellipse() { count(); },
    moveTo() { count(); },
    lineTo() { count(); },
    quadraticCurveTo() { count(); },
    bezierCurveTo() { count(); },
    stroke() { count('stroke'); },
    fill() { count('fill'); },
    translate() { count(); },
    rotate() { count(); },
    scale() { count(); },
    setLineDash() { count(); },
    fillRect() { count(); },
    strokeRect() { count(); },
    fillText() { count(); },
    strokeText() { count(); },
    drawImage() { count(); },
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'calls') return calls;
      return undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function makeGlow() {
  const glow = {
    draws: 0,
    draw() {
      glow.draws++;
      return true;
    },
  };
  return glow;
}

function makeGame() {
  const enemies = Object.values(ENEMIES).map((def, i) => ({
    id: i + 1,
    type: def.id,
    x: 2 + (i % 6) * 0.9,
    y: 3 + Math.floor(i / 6) * 0.9,
    r: def.r,
    flying: !!def.flying,
    angle: 0.3,
    hitFlash: i % 3 === 0 ? 0.85 : 0,
    hp: def.hp,
    maxHp: def.hp,
    shield: def.shield || 0,
    maxShield: def.shield || 0,
    heal: def.heal || 0,
    boss: !!def.boss,
    aura: def.aura || null,
    slowUntil: 0,
    poisonUntil: 0,
    dead: false,
  }));
  const towers = Object.keys(TOWERS).map((type, i) => ({
    type,
    x: 1.5 + i * 1.1,
    y: 6.5,
    level: i % 3,
    angle: i * 0.4,
    recoil: i % 2,
    evolution: null,
    disabledUntil: 0,
  }));
  return { enemies, towers, time: 2, selectedTower: null };
}

function renderScene(settings) {
  const game = makeGame();
  const glow = makeGlow();
  const towerCtx = makeCtx();
  const enemyCtx = makeCtx();
  new TowerRenderer(game, { glow }).render(towerCtx, 2, settings);
  new EnemyRenderer(game, { glow }).render(enemyCtx, 2, settings);
  return { game, glow, towerCtx, enemyCtx };
}

function totalOps(result) {
  return result.towerCtx.calls.ops + result.enemyCtx.calls.ops;
}

test('皮肤预算三档：关闭档不描边、低配合并、高配单独描环', () => {
  for (const budget of [TOWER_SKIN_BUDGET, ENEMY_SKIN_BUDGET]) {
    assert.equal(budget.off, 'none');
    assert.equal(budget.light, 'merged');
    assert.equal(budget.full, 'ring');
    assert.ok(Object.isFrozen(budget));
  }
  assert.equal(towerSkinOutlineBudget('off'), 'none');
  assert.equal(towerSkinOutlineBudget('light'), 'merged');
  assert.equal(towerSkinOutlineBudget('full'), 'ring');
  assert.equal(enemySkinOutlineBudget('full'), 'ring');
  // 未知/损坏档位回退低配，与动画视图的回退口径一致。
  assert.equal(towerSkinOutlineBudget('mystery'), 'merged');
  assert.equal(enemySkinOutlineBudget(undefined), 'merged');
});

test('低配皮肤零新增绘制调用：轮廓并进已有描边', () => {
  setActiveSkins(DEFAULT);
  const base = renderScene(QUALITY_PRESETS.low);
  setActiveSkins(SKINNED);
  const skinned = renderScene(QUALITY_PRESETS.low);

  assert.equal(skinned.towerCtx.calls.ops, base.towerCtx.calls.ops, '低配塔渲染不得新增绘制调用');
  assert.equal(skinned.enemyCtx.calls.ops, base.enemyCtx.calls.ops, '低配敌人渲染不得新增绘制调用');
  assert.equal(skinned.towerCtx.calls.stroke, base.towerCtx.calls.stroke);
  assert.equal(skinned.enemyCtx.calls.stroke, base.enemyCtx.calls.stroke);
  assert.equal(skinned.towerCtx.calls.fill, base.towerCtx.calls.fill, '皮肤不得新增填充/粒子');
  assert.equal(skinned.enemyCtx.calls.fill, base.enemyCtx.calls.fill);
  resetActiveSkins();
});

test('高配皮肤只多描一圈轮廓，不新增填充或光晕', () => {
  setActiveSkins(DEFAULT);
  const base = renderScene(QUALITY_PRESETS.high);
  setActiveSkins(SKINNED);
  const skinned = renderScene(QUALITY_PRESETS.high);

  const towerCount = base.game.towers.length;
  const enemyCount = base.game.enemies.filter((enemy) => !enemy.dead).length;

  assert.equal(
    skinned.towerCtx.calls.stroke - base.towerCtx.calls.stroke,
    towerCount,
    '高配每座塔只多 1 次皮肤环描边'
  );
  assert.equal(
    skinned.enemyCtx.calls.stroke - base.enemyCtx.calls.stroke,
    enemyCount,
    '高配每个敌人只多 1 次皮肤环描边'
  );
  assert.equal(skinned.towerCtx.calls.fill, base.towerCtx.calls.fill, '皮肤不得新增填充/粒子');
  assert.equal(skinned.enemyCtx.calls.fill, base.enemyCtx.calls.fill);
  assert.equal(skinned.glow.draws, base.glow.draws, '皮肤不得新增光晕绘制');
  resetActiveSkins();
});

test('低配绘制调用可测量地不高于高配', () => {
  setActiveSkins(SKINNED);
  const low = renderScene(QUALITY_PRESETS.low);
  const high = renderScene(QUALITY_PRESETS.high);

  assert.ok(
    totalOps(low) < totalOps(high),
    `低配总调用 ${totalOps(low)} 应少于高配 ${totalOps(high)}`
  );
  assert.ok(
    low.towerCtx.calls.ops <= high.towerCtx.calls.ops,
    '低配塔绘制调用不得高于高配'
  );
  assert.ok(
    low.enemyCtx.calls.ops <= high.enemyCtx.calls.ops,
    '低配敌人绘制调用不得高于高配'
  );
  resetActiveSkins();
});

test('未知皮肤回退默认：绘制预算与默认皮肤一致', () => {
  setActiveSkins(DEFAULT);
  const base = renderScene(QUALITY_PRESETS.low);
  setActiveSkins({ tower: 'no_such_tower', enemy: 'no_such_enemy' });

  assert.equal(activeSkin('tower').id, DEFAULT_SKIN_BY_TARGET.tower);
  assert.equal(activeSkin('enemy').id, DEFAULT_SKIN_BY_TARGET.enemy);

  const fallback = renderScene(QUALITY_PRESETS.low);
  assert.equal(fallback.towerCtx.calls.ops, base.towerCtx.calls.ops);
  assert.equal(fallback.enemyCtx.calls.ops, base.enemyCtx.calls.ops);
  resetActiveSkins();
});

function stateHash(settings) {
  const seed = 'skin-budget-determinism';
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
  sim.setVisualQuality({ effects: settings.decorations, floaters: settings.floaters });
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);

  const game = { towers: sim.towers, enemies: sim.enemies, time: 0, selectedTower: null };
  const glow = makeGlow();
  const towerRenderer = new TowerRenderer(game, { glow });
  const enemyRenderer = new EnemyRenderer(game, { glow });
  const towerCtx = makeCtx();
  const enemyCtx = makeCtx();

  for (let i = 0; i < 600; i++) {
    // 每帧走一遍完整皮肤渲染，证明渲染只读、不触碰模拟状态。
    game.time = sim.time;
    towerRenderer.render(towerCtx, sim.time, settings);
    enemyRenderer.render(enemyCtx, sim.time, settings);
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }

  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    enemies: sim.enemies.map((enemy) => [
      enemy.type,
      Math.round(enemy.hp * 1e6),
      enemy.x.toFixed(6),
      enemy.y.toFixed(6),
    ]),
  });
}

test('同种子同皮肤下低配/高配战斗状态哈希一致', () => {
  const hash = (json) => createHash('sha256').update(json).digest('hex');
  setActiveSkins(SKINNED);
  const low = stateHash(QUALITY_PRESETS.low);
  const high = stateHash(QUALITY_PRESETS.high);
  assert.equal(hash(low), hash(high));
  resetActiveSkins();
});

test('皮肤渲染不引入素材或新依赖', () => {
  for (const src of [ENEMY_SRC, TOWER_SRC]) {
    assert.doesNotMatch(src, /\.(png|jpe?g|webp|gif|svg)['"]/i, '不得引用素材文件');
    assert.doesNotMatch(src, /\bnew Image\b/, '不得加载外部图片');
  }
  // 皮肤上色走共享的纯函数缓存，渲染器只读颜色。
  assert.match(TOWER_SRC, /skinColorFor/);
  assert.match(ENEMY_SRC, /skinColorFor/);
  assert.equal(skinColorFor(null, '#ffffff'), '#ffffff', '默认皮肤保持原色');
});
