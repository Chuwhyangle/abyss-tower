// 武器命中签名（AC-015）：8 种武器可辨识形态、两档粒子钳制、命中层并发预算与降级、
// 渲染层接线（spark/ring/bolt + 战旗光环脉冲）、以及"表现零接触模拟"的同种子回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  IMPACT_BUDGETS,
  IMPACT_POOL_CAPACITY,
  IMPACT_SHAPES,
  IMPACT_TIER_LIMITS,
  IMPACT_VARIANTS,
  IMPACT_VFX,
  ImpactVfxPool,
  drawImpactFallback,
  drawImpactShape,
  impactBudget,
  impactPlan,
  impactVariant,
} from '../public/js/render/impact-vfx.js';
import { EFFECT_PROFILES, EffectRenderer } from '../public/js/render/effect-renderer.js';
import { GlowRenderer } from '../public/js/render/glow-renderer.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { TOWER_ORDER } from '../public/js/shared/data/towers.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const WEAPONS = Object.keys(IMPACT_VFX).filter((key) => key !== 'fallback');
const NUMERIC_FIELDS = ['particles', 'spread', 'duration', 'size', 'ring', 'spin'];
const LOW = EFFECT_PROFILES.low;
const HIGH = EFFECT_PROFILES.high;

const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const IMPACT_SRC = source('../public/js/render/impact-vfx.js');
const EFFECT_SRC = source('../public/js/render/effect-renderer.js');
const PROJ_SRC = source('../public/js/sim/projectile-system.js');

test('8 个武器键与 TOWER_ORDER 完全一致，签名参数齐全且低档粒子 ≥ 1', () => {
  assert.equal(WEAPONS.length, 8);
  assert.deepEqual(WEAPONS, TOWER_ORDER, '命中签名表的武器键必须与 TOWER_ORDER 同序同集');
  assert.equal(IMPACT_SHAPES.length, 8);

  for (const weapon of WEAPONS) {
    const entry = IMPACT_VFX[weapon];
    assert.ok(entry, `缺少武器签名：${weapon}`);
    assert.match(entry.color, /^#[0-9a-f]{6}$/i, `${weapon}.color 必须是十六进制色`);
    assert.match(entry.accent, /^#[0-9a-f]{6}$/i, `${weapon}.accent 必须是十六进制色`);
    assert.ok(IMPACT_SHAPES.includes(entry.shape), `${weapon}.shape 必须是登记形态`);
    for (const field of NUMERIC_FIELDS) {
      assert.ok(Number.isFinite(entry[field]), `${weapon}.${field} 必须是有限数`);
    }
    assert.ok(entry.particles >= 1, `${weapon}.particles 至少为 1`);
    assert.ok(entry.duration > 0, `${weapon}.duration 必须为正`);
    // 低档也不得为 0：任何画质档位命中链都可见。
    assert.ok(impactVariant(weapon, LOW).particles >= 1, `${weapon} 低档粒子不得为 0`);
    assert.ok(impactVariant(weapon, HIGH).particles >= 1);
  }
  assert.ok(IMPACT_VFX.fallback, '缺少 fallback 签名');
});

test('可分辨性：颜色/形状两两不同，三元组两两不同，任意两种武器至少 2 维可辨', () => {
  const colors = WEAPONS.map((weapon) => IMPACT_VFX[weapon].color);
  const shapes = WEAPONS.map((weapon) => IMPACT_VFX[weapon].shape);
  assert.equal(new Set(colors).size, 8, '8 种武器颜色必须两两不同');
  assert.equal(new Set(shapes).size, 8, '8 种武器形态必须两两不同');
  assert.equal(
    new Set(WEAPONS.map((w) => `${IMPACT_VFX[w].shape}|${IMPACT_VFX[w].particles}|${IMPACT_VFX[w].spread}`)).size,
    8,
    '(shape, particles, spread) 三元组必须两两不同'
  );

  for (let i = 0; i < WEAPONS.length; i++) {
    for (let j = i + 1; j < WEAPONS.length; j++) {
      const a = IMPACT_VFX[WEAPONS[i]];
      const b = IMPACT_VFX[WEAPONS[j]];
      const differ = [
        a.color !== b.color,
        a.shape !== b.shape,
        a.particles !== b.particles,
        a.spread !== b.spread,
      ].filter(Boolean).length;
      assert.ok(
        differ >= 2,
        `${WEAPONS[i]} 与 ${WEAPONS[j]} 只有 ${differ} 维可分辨（需要 ≥ 2）`
      );
    }
  }
});

test('预算钳制：逐武器不超过本档 maxParticles，低档严格少于高档，未知武器回退', () => {
  for (const tier of ['low', 'high']) {
    assert.equal(IMPACT_TIER_LIMITS[tier].particleScale, EFFECT_PROFILES[tier].particleScale);
    assert.equal(IMPACT_TIER_LIMITS[tier].maxParticles, EFFECT_PROFILES[tier].maxParticles);
  }

  for (const weapon of [...WEAPONS, 'fallback']) {
    const low = impactVariant(weapon, LOW);
    const high = impactVariant(weapon, HIGH);
    assert.ok(low.particles <= LOW.maxParticles, `${weapon} 低档超出 maxParticles`);
    assert.ok(high.particles <= HIGH.maxParticles, `${weapon} 高档超出 maxParticles`);
    assert.ok(low.particles >= 1, `${weapon} 低档粒子不得为 0`);
    assert.ok(low.particles < high.particles, `${weapon} 低档粒子必须严格少于高档`);
  }

  // 模块加载时预生成并冻结：渲染循环查表，不新建对象。
  assert.ok(Object.isFrozen(IMPACT_VARIANTS.low) && Object.isFrozen(IMPACT_VARIANTS.high));
  assert.equal(impactVariant('arrow', LOW), IMPACT_VARIANTS.low.arrow);
  assert.equal(impactVariant('cannon', HIGH), IMPACT_VARIANTS.high.cannon);
  assert.ok(Object.isFrozen(IMPACT_VARIANTS.high.arrow));

  // 未知武器：回退到 fallback，同样受本档上限约束，不抛错。
  for (const profile of [LOW, HIGH]) {
    for (const weapon of ['no-such-weapon', '', null, undefined, {}, 42]) {
      const fallback = impactVariant(weapon, profile);
      assert.equal(fallback, IMPACT_VARIANTS[profile.tier].fallback);
      assert.ok(fallback.particles <= profile.maxParticles);
      assert.ok(fallback.particles >= 1);
    }
  }
  assert.doesNotThrow(() => impactVariant('no-such-weapon'));
  assert.doesNotThrow(() => impactVariant('arrow', undefined));
});

test('命中层每帧总预算：低档 ≤ 32、高档 ≤ 128，且不超过 poolBudget', () => {
  assert.ok(IMPACT_BUDGETS.low <= 32);
  assert.ok(IMPACT_BUDGETS.high <= 128);
  for (const profile of [LOW, HIGH]) {
    const budget = impactBudget(profile);
    assert.ok(Number.isFinite(budget) && budget > 0, '预算必须是正有限数');
    assert.ok(budget <= IMPACT_BUDGETS[profile.tier]);
    assert.ok(budget <= profile.poolBudget, '命中预算不得超过本档池预算');
  }
  assert.ok(impactBudget(LOW) < impactBudget(HIGH), '低档预算必须少于高档');
  assert.equal(impactBudget(undefined), IMPACT_BUDGETS.high);
});

test('命中层并发预算：36 个同时命中不突破每帧总额，耗尽后降级且不抛错', () => {
  const profile = HIGH;
  const budget = impactBudget(profile);
  const pool = new ImpactVfxPool(IMPACT_POOL_CAPACITY);
  assert.equal(pool.capacity, IMPACT_POOL_CAPACITY);
  assert.equal(pool.slots.length, IMPACT_POOL_CAPACITY, '构造时一次性分配固定容量');

  // 跨帧复用同一槽位对象，容量不变。
  pool.reset(budget);
  const first = pool.acquire();
  assert.equal(first, pool.slots[0]);
  for (let frame = 0; frame < 20; frame++) {
    pool.reset(budget);
    assert.equal(pool.acquire(), first, '跨帧复用同一槽位对象');
    assert.equal(pool.slots.length, IMPACT_POOL_CAPACITY, '跨帧不重建槽位');
  }

  // 36 个同时命中：每次命中按自己的武器签名申请粒子，累计不得超过每帧总预算。
  pool.reset(budget);
  const plan = { degraded: false, count: 0 };
  let acquired = 0;
  let degraded = 0;
  for (let i = 0; i < 36; i++) {
    const weapon = WEAPONS[i % WEAPONS.length];
    impactPlan(pool, impactVariant(weapon, profile), plan);
    acquired += plan.count;
    if (plan.degraded) degraded++;
  }
  assert.ok(acquired <= budget, `累计 ${acquired} 超过每帧预算 ${budget}`);
  assert.equal(pool.active, acquired);
  assert.ok(degraded > 0, '36 敌混战必须触发降级路径');
  assert.equal(pool.acquire(), null, '预算耗尽后不再分配');

  // 完全耗尽后的单次命中：返回降级标记，不抛错。
  const lost = impactPlan(pool, impactVariant('cannon', profile), plan);
  assert.equal(lost, plan, '复用输出对象（渲染循环零临时对象）');
  assert.equal(lost.count, 0);
  assert.equal(lost.degraded, true);
  assert.doesNotThrow(() => impactPlan(null, impactVariant('arrow', profile)));
  assert.doesNotThrow(() => impactPlan(pool, null));
  assert.equal(impactPlan(pool, null).degraded, true);
});

test('绘制计划：预算耗尽时降级为核心闪白 + 武器色环，不抛错', () => {
  const ctx = makeCtx();
  const variant = impactVariant('arc', HIGH);
  assert.doesNotThrow(() => drawImpactShape(ctx, variant, 10, 10, 0.5, 1, 0));
  assert.equal(ctx.calls.stroke, 0, '0 个粒子槽时不画形态');
  assert.doesNotThrow(() => drawImpactFallback(ctx, variant, 10, 10, 0.5, 1));
  assert.ok(ctx.calls.arc > 0, '降级仍要画出核心与色环');
  assert.ok(ctx.calls.stroke > 0, '降级仍要画出武器色环');
  // 每个形态都能画出图元，且不抛错。
  for (const shape of IMPACT_SHAPES) {
    const custom = { ...variant, shape };
    const calls = makeCtx();
    assert.doesNotThrow(() => drawImpactShape(calls, custom, 10, 10, 0.4, 1, 4), `${shape} 绘制抛错`);
    assert.ok(calls.calls.stroke + calls.calls.arc + calls.calls.fill > 0, `${shape} 没有画出任何图元`);
  }
});

test('渲染接线：spark 按武器分派、ring/bolt 使用武器 accent，旧 spark 保持 6 条放射线', () => {
  // 旧事件（无 weapon）：既有通用外观不变。
  const legacyHigh = scene([{ kind: 'spark', x: 2, y: 2, ttl: 0.1, maxTtl: 0.15 }], QUALITY_PRESETS.high);
  const legacyLow = scene([{ kind: 'spark', x: 2, y: 2, ttl: 0.1, maxTtl: 0.15 }], QUALITY_PRESETS.low);
  assert.equal(legacyHigh.calls.moveTo, 6);
  assert.equal(legacyLow.calls.moveTo, Math.max(1, Math.round(6 * LOW.particleScale)));
  assert.equal(legacyHigh.renderer.impactDrawn.arrow, undefined, '旧事件不计入武器签名');

  // 7 种攻击塔的 spark 命中都能画出图元并计数。
  for (const weapon of WEAPONS.filter((w) => w !== 'banner')) {
    const { calls, renderer } = scene(
      [{ kind: 'spark', x: 2, y: 2, ttl: 0.1, maxTtl: 0.15, weapon }],
      QUALITY_PRESETS.high
    );
    assert.equal(renderer.impactDrawn[weapon], 1, `${weapon} 命中未计数`);
    assert.ok(calls.stroke + calls.arc + calls.fill > 0, `${weapon} 命中没有任何绘制`);
  }

  // 溅射武器（炮台/震荡）走 ring，电弧走 bolt，同样记账。
  const rings = scene(
    [
      { kind: 'ring', x: 3, y: 3, r0: 0.1, r1: 1, ttl: 0.2, maxTtl: 0.25, weapon: 'cannon' },
      { kind: 'ring', x: 5, y: 3, r0: 0.1, r1: 1, ttl: 0.2, maxTtl: 0.25, weapon: 'shock' },
      { kind: 'bolt', x: 7, y: 3, points: [{ x: 7, y: 3 }, { x: 8, y: 4 }], ttl: 0.1, maxTtl: 0.18, weapon: 'arc' },
    ],
    QUALITY_PRESETS.high
  );
  assert.equal(rings.renderer.impactDrawn.cannon, 1);
  assert.equal(rings.renderer.impactDrawn.shock, 1);
  assert.equal(rings.renderer.impactDrawn.arc, 1);
});

test('渲染：36 个同时命中单帧峰值不超预算，降级路径不抛错且命中不整块消失', () => {
  const effects = Array.from({ length: 36 }, (_, i) => ({
    kind: 'spark',
    x: (i % 9) * 1.2,
    y: Math.floor(i / 9) * 1.2,
    ttl: 0.1,
    maxTtl: 0.15,
    weapon: WEAPONS[i % WEAPONS.length],
  }));
  for (const settings of [QUALITY_PRESETS.low, QUALITY_PRESETS.high]) {
    const { calls, renderer } = scene(effects, settings);
    const budget = impactBudget(settings.decorations === 'full' ? HIGH : LOW);
    assert.ok(renderer.impactPeak <= budget, `单帧峰值 ${renderer.impactPeak} 超过预算 ${budget}`);
    assert.equal(renderer.impactPool.active, renderer.impactPeak);
    assert.ok(renderer.impactDegraded > 0, '36 命中共战必须触发降级');
    assert.ok(calls.stroke + calls.arc + calls.fill > 0, '降级后命中表现不能整块消失');
  }
});

test('战旗光环脉冲：只对 banner 塔绘制，相位驱动扩散且不消耗命中粒子预算', () => {
  const banner = { type: 'banner', x: 2, y: 2, stats: { range: 2.6 } };
  const renderer = new EffectRenderer(
    { effects: [], towers: [banner, { type: 'arrow', x: 4, y: 2, stats: { range: 3.2 } }] },
    { glow: makeGlow() }
  );
  const first = makeCtx();
  renderer.render(first, 0.2, QUALITY_PRESETS.high);
  assert.equal(renderer.auraPulses, 1, '每帧每座战旗一次脉冲');
  assert.equal(renderer.impactPool.active, 0, '光环脉冲不占命中粒子预算');
  const firstRadius = first.arcs[0][2];

  const later = makeCtx();
  renderer.render(later, 0.2 + 1 / 0.6 / 2, QUALITY_PRESETS.high);
  assert.equal(renderer.auraPulses, 2);
  assert.ok(later.arcs[0][2] > firstRadius, '相位推进后光环半径必须扩大');

  // 没有战旗塔时不画光环。
  const plain = new EffectRenderer({ effects: [], towers: [{ type: 'arrow', x: 1, y: 1 }] }, { glow: makeGlow() });
  const ctx = makeCtx();
  plain.render(ctx, 0.3, QUALITY_PRESETS.high);
  assert.equal(plain.auraPulses, 0);
  assert.equal(plain.renderAuraPulses(makeCtx(), 0.3, HIGH), 0);
  // 缺 towers 字段（旧构造）不抛错。
  assert.doesNotThrow(() => new EffectRenderer({ effects: [] }, { glow: makeGlow() }).render(makeCtx(), 0.1, QUALITY_PRESETS.high));
});

test('源码接线：spark 分支调用 impactVariant、渲染循环重置命中预算、存在 banner 光环分支', () => {
  const sparkStart = EFFECT_SRC.indexOf("effect.kind === 'spark'");
  const boltStart = EFFECT_SRC.indexOf("effect.kind === 'bolt'");
  assert.ok(sparkStart > 0 && boltStart > sparkStart, '特效层缺少 spark/bolt 分支');
  const sparkBranch = EFFECT_SRC.slice(sparkStart, boltStart);
  assert.match(sparkBranch, /impactVariant\(/, 'spark 分支必须按 weapon 取命中签名');
  assert.match(sparkBranch, /impactPlan\(/, 'spark 分支必须从命中层并发池取粒子');
  assert.match(sparkBranch, /drawImpactShape\(/, 'spark 分支必须按 shape 分派绘制');
  assert.match(sparkBranch, /plan\.degraded/, 'spark 分支必须有降级路径');
  assert.match(EFFECT_SRC, /this\.impactPool\.reset\(impactBudget\(profile\)\)/, '渲染循环必须按档位重置命中预算');
  assert.match(EFFECT_SRC, /renderAuraPulses\(/, '缺少战旗光环脉冲方法');
  assert.match(EFFECT_SRC, /type === 'banner'/, '光环脉冲必须只认战旗塔');
  assert.match(EFFECT_SRC, /time \* 0\.6\) % 1/, '光环相位必须是 (time * 0.6) % 1');
});

test('源码接线：spark/ring/bolt 事件对象都带 weapon（只加表现字段）', () => {
  for (const kind of ['spark', 'ring', 'bolt']) {
    const re = new RegExp(`kind: '${kind}'[\\s\\S]{0,260}?weapon:`);
    assert.match(PROJ_SRC, re, `${kind} 事件缺少 weapon 字段`);
  }
  assert.match(PROJ_SRC, /kind: 'bolt'[^}]*weapon: 'arc'/, 'bolt 固定归属电弧塔');
  // 只加表现字段：命中流程不新增随机数调用，结算顺序不变（impact 里仍只有一次 hitEnemy）。
  const impactBody = PROJ_SRC.slice(PROJ_SRC.indexOf('impact(proj)'), PROJ_SRC.indexOf('hitEnemy', PROJ_SRC.indexOf('impact(proj)')));
  assert.doesNotMatch(impactBody, /Math\.random/, '命中流程不得引入随机数');
});

test('表现零接触模拟：命中签名模块无随机数、不依赖模拟层', () => {
  assert.doesNotMatch(IMPACT_SRC, /Math\.random/, '渲染层不得引入随机数');
  assert.doesNotMatch(IMPACT_SRC, /from\s+'[^']*\/sim[^']*'/, '不得依赖模拟层');
  assert.doesNotMatch(IMPACT_SRC, /shared\/rng/, '不得接触 RNG');
  assert.doesNotMatch(IMPACT_SRC, /document\.|querySelector/, '只画在 Canvas 上');
  const imports = [...IMPACT_SRC.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../shared/data/constants.js'], '只允许引入纯常量模块');
});

function runSim(effectsLevel) {
  const seed = 'impact-vfx-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 3000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: [...TOWER_ORDER],
    onSave: () => {},
    onToast: () => {},
  });
  // 路径旁摆满 8 种塔（含战旗），确保这一局真的产生命中事件。
  const cells = [];
  outer: for (const p of map.pathCells) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = p.c + dc;
      const r = p.r + dr;
      if (map.buildable[r]?.[c] && !cells.some((cell) => cell.c === c && cell.r === r)) {
        cells.push({ c, r });
        if (cells.length >= TOWER_ORDER.length) break outer;
      }
    }
  }
  cells.forEach((cell, i) => {
    const tower = sim.makeTower(TOWER_ORDER[i], cell.c, cell.r, 0, 0);
    sim.towers.push(tower);
  });
  sim.recomputeTowerStats();
  sim.setVisualQuality({ effects: effectsLevel, floaters: 'all' });
  const meta = sim.map.meta || {};
  sim.beginWave(generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  }));
  let weaponEffects = 0;
  for (let i = 0; i < 1200; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
    for (const effect of sim.effects) if (effect.weapon) weaponEffects++;
  }
  return {
    weaponEffects,
    state: JSON.stringify({
      gold: Math.floor(sim.gold),
      baseHp: sim.baseHp,
      kills: sim.kills,
      wave: sim.wave,
      enemies: sim.enemies.map((e) => [e.type, Math.round(e.hp * 1e6), e.x.toFixed(6), e.y.toFixed(6)]),
    }),
  };
}

test('同 seed 两局（命中特效开 / 关）战斗结算逐字节一致', () => {
  const full = runSim('full');
  const off = runSim('off');
  assert.ok(full.weaponEffects > 0, '特效开启的一局必须真的产生武器命中（否则该回归是空跑）');
  const hash = (json) => createHash('sha256').update(json).digest('hex');
  assert.equal(hash(off.state), hash(full.state));
});

// ---------- 测试替身 ----------

// 宽松 Canvas 2D 替身：记录绘制调用，未显式定义的方法一律空操作。
function makeCtx() {
  const calls = { save: 0, restore: 0, stroke: 0, fill: 0, arc: 0, moveTo: 0, lineTo: 0, closePath: 0 };
  const arcs = [];
  const ctx = {
    calls,
    arcs,
    save() { calls.save++; },
    restore() { calls.restore++; },
    beginPath() {},
    closePath() { calls.closePath++; },
    arc(x, y, r) { calls.arc++; arcs.push([x, y, r]); },
    ellipse() {},
    moveTo() { calls.moveTo++; },
    lineTo() { calls.lineTo++; },
    stroke() { calls.stroke++; },
    fill() { calls.fill++; },
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    fillRect() {},
    drawImage() {},
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return ctx;
}

function makeGlow() {
  return new GlowRenderer({ createSprite: (color) => ({ color }), capacity: 24 });
}

function scene(effects, settings, towers = []) {
  const renderer = new EffectRenderer({ effects, towers }, { glow: makeGlow() });
  const ctx = makeCtx();
  renderer.render(ctx, 1.25, settings);
  return { renderer, ctx, calls: ctx.calls };
}
