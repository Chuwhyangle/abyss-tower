// 事件变体：事件表完整性、低配/高配预算单调、未知事件回退、
// 每帧零分配（模块级冻结视图）、以及"画质不改变战斗结果"的同种子哈希回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  EFFECT_EVENTS,
  EFFECT_PROFILES,
  EFFECT_VARIANTS,
  EffectRenderer,
  classifyEffect,
  eventVariant,
} from '../public/js/render/effect-renderer.js';
import { GlowRenderer } from '../public/js/render/glow-renderer.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const EVENT_NAMES = ['kill', 'bossKill', 'baseHit', 'towerDisable', 'evolve'];
const REQUIRED_FIELDS = [
  'color', 'accent', 'shape', 'duration', 'particles', 'ring', 'spin', 'glow', 'puffs',
];
const LOW = EFFECT_PROFILES.low;
const HIGH = EFFECT_PROFILES.high;
const EFFECT_SRC = fs.readFileSync(
  new URL('../public/js/render/effect-renderer.js', import.meta.url),
  'utf8'
);

test('每个事件都有独立的颜色/时长/粒子/光晕配置', () => {
  for (const name of EVENT_NAMES) {
    const entry = EFFECT_EVENTS[name];
    assert.ok(entry, `缺少事件配置：${name}`);
    for (const field of REQUIRED_FIELDS) {
      assert.notEqual(entry[field], undefined, `${name}.${field} 未定义`);
    }
    assert.match(entry.color, /^#[0-9a-f]{6}$/i, `${name}.color 必须是十六进制色`);
    assert.match(entry.accent, /^#[0-9a-f]{6}$/i, `${name}.accent 必须是十六进制色`);
    assert.ok(entry.duration > 0, `${name}.duration 必须为正`);
    assert.ok(entry.particles > 0, `${name}.particles 必须为正`);
    assert.equal(typeof entry.key, 'boolean', `${name}.key 必须显式声明`);
    assert.ok(entry.tiers?.low && entry.tiers?.high, `${name} 缺少低/高配覆盖`);
  }

  // 关键事件两两可区分：颜色、形状、时长至少一项不同。
  const core = ['kill', 'bossKill', 'baseHit', 'towerDisable'];
  for (let i = 0; i < core.length; i++) {
    for (let j = i + 1; j < core.length; j++) {
      const a = EFFECT_EVENTS[core[i]];
      const b = EFFECT_EVENTS[core[j]];
      assert.ok(
        a.color !== b.color || a.shape !== b.shape || a.duration !== b.duration,
        `${core[i]} 与 ${core[j]} 的表现无法区分`
      );
    }
  }
  assert.notEqual(EFFECT_EVENTS.towerDisable.color, EFFECT_EVENTS.evolve.color);
});

test('低配/高配预算单调，低配只保留关键事件', () => {
  for (const name of EVENT_NAMES) {
    const low = EFFECT_VARIANTS.low[name];
    const high = EFFECT_VARIANTS.high[name];
    assert.ok(low, `低配缺少 ${name}`);
    assert.ok(high, `高配缺少 ${name}`);
    assert.ok(low.particles <= high.particles, `${name} 粒子数不单调`);
    assert.ok(low.puffs <= high.puffs, `${name} 烟尘数不单调`);
    assert.ok(low.glow <= high.glow, `${name} 光晕强度不单调`);
    assert.equal(low.duration, high.duration, `${name} 时长不应随画质变化`);
    assert.equal(high.enabled, true, `${name} 在高配必须可见`);
    assert.equal(low.enabled, EFFECT_EVENTS[name].key, `${name} 低配可见性不符合 key 标记`);
    assert.equal(low.extras, false, `${name} 低配不应保留细节层`);
    assert.equal(high.extras, true, `${name} 高配应保留完整层次`);
    for (const variant of [low, high]) {
      for (const field of ['particles', 'puffs', 'ring', 'spin', 'glow', 'duration']) {
        assert.ok(Number.isFinite(variant[field]), `${name}.${field} 必须是有限数`);
      }
    }
  }
  assert.equal(EFFECT_VARIANTS.low.evolve.enabled, false, '低配不画进化');
  assert.equal(EFFECT_VARIANTS.high.evolve.enabled, true, '高配保留进化层');
});

test('未知事件回退到普通击杀，字段有限且不抛错', () => {
  for (const profile of [LOW, HIGH]) {
    const fallback = eventVariant('mystery', profile);
    assert.equal(fallback, eventVariant('kill', profile), '未知事件应复用普通击杀配置');
    assert.equal(fallback, eventVariant(null, profile));
    assert.ok(fallback.particles <= profile.maxParticles, '回退粒子数不得超过本档上限');
    for (const field of ['particles', 'puffs', 'ring', 'glow', 'duration']) {
      assert.ok(Number.isFinite(fallback[field]), `回退字段 ${field} 必须是有限数`);
    }
  }
  assert.equal(classifyEffect({ kind: 'mystery' }), 'mystery');
  assert.equal(classifyEffect(null), 'unknown');

  const renderer = new EffectRenderer(
    { effects: [{ kind: 'mystery', x: 1, y: 1, ttl: 0.2, maxTtl: 0.2 }] },
    { glow: makeGlow() }
  );
  assert.doesNotThrow(() => renderer.render(makeCtx(), 0.5, QUALITY_PRESETS.high));
});

test('事件变体是模块级冻结对象，渲染循环查表不新建对象', () => {
  assert.equal(eventVariant('kill', LOW), eventVariant('kill', LOW));
  assert.equal(eventVariant('bossKill', HIGH), EFFECT_VARIANTS.high.bossKill);
  assert.ok(Object.isFrozen(EFFECT_VARIANTS.low) && Object.isFrozen(EFFECT_VARIANTS.high));
  for (const name of EVENT_NAMES) {
    assert.ok(Object.isFrozen(EFFECT_VARIANTS.low[name]), `${name} 低配视图未冻结`);
    assert.ok(Object.isFrozen(EFFECT_VARIANTS.high[name]), `${name} 高配视图未冻结`);
  }
  // 事件表是唯一来源：停摆分支不再硬编码半径/电弧数。
  assert.match(EFFECT_SRC, /entry\.ring \* T/);
  assert.match(EFFECT_SRC, /entry\.particles/);
  assert.doesNotMatch(EFFECT_SRC, /const rr = 22;/);
  assert.match(EFFECT_SRC, /this\.pool\.acquire\(\)/);
});

test('特效层不引入第三方依赖，也不会整屏覆盖', () => {
  const imports = [...EFFECT_SRC.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const spec of imports) {
    assert.match(spec, /^\.\.?\//, `特效层引入了第三方依赖：${spec}`);
  }
  assert.doesNotMatch(EFFECT_SRC, /fillRect\(\s*0\s*,\s*0\s*,/, '不得整屏覆盖遮挡 HUD');
  for (const name of EVENT_NAMES) {
    assert.ok(EFFECT_EVENTS[name].ring <= 2, `${name} 半径过大，可能遮挡路径`);
  }
});

function makeCtx() {
  const calls = { save: 0, arc: 0, moveTo: 0, drawImage: 0, fillRect: 0, setLineDash: 0 };
  const ctx = {
    calls,
    save() { calls.save++; },
    restore() {},
    beginPath() {},
    closePath() {},
    arc() { calls.arc++; },
    ellipse() {},
    moveTo() { calls.moveTo++; },
    lineTo() {},
    stroke() {},
    fill() {},
    translate() {},
    rotate() {},
    setLineDash(list) { calls.setLineDash += Array.isArray(list) ? list.length : 0; },
    fillRect() { calls.fillRect++; },
    drawImage() { calls.drawImage++; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return ctx;
}

function makeGlow() {
  return new GlowRenderer({ createSprite: (color) => ({ color }), capacity: 24 });
}

function renderScene(effects, settings) {
  const renderer = new EffectRenderer({ effects }, { glow: makeGlow() });
  const ctx = makeCtx();
  renderer.render(ctx, 1.25, settings);
  return ctx.calls;
}

test('渲染循环：低配首领死亡层次少于高配', () => {
  const effects = [
    { kind: 'death', x: 4, y: 4, r: 0.58, ttl: 0.3, maxTtl: 0.45, color: '#e2609e' },
  ];
  const low = renderScene(effects, QUALITY_PRESETS.low);
  const high = renderScene(effects, QUALITY_PRESETS.high);
  assert.ok(low.arc < high.arc, `低配 arc ${low.arc} 应少于高配 ${high.arc}`);
});

test('渲染循环：低配跳过进化，高配绘制', () => {
  const effects = [{ kind: 'evolve', x: 3, y: 3, ttl: 0.25, maxTtl: 0.5 }];
  const low = renderScene(effects, QUALITY_PRESETS.low);
  const high = renderScene(effects, QUALITY_PRESETS.high);
  assert.equal(low.arc, 0, '低配不绘制进化环');
  assert.ok(high.arc > 0, '高配应绘制进化粒子/环');
});

function runSim(effectsLevel) {
  const seed = 'effect-variants-determinism';
  const sim = new Simulation({
    map: generateMap(seed),
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
  sim.setVisualQuality({ effects: effectsLevel, floaters: effectsLevel === 'full' ? 'all' : 'off' });
  const meta = sim.map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);
  for (let i = 0; i < 900; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }
  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    enemies: sim.enemies.map((e) => [e.type, Math.round(e.hp * 1e6), e.x.toFixed(6), e.y.toFixed(6)]),
  });
}

test('同种子下低配/高配战斗状态哈希一致', () => {
  const low = runSim('off');
  const high = runSim('full');
  const hash = (json) => createHash('sha256').update(json).digest('hex');
  assert.equal(hash(low), hash(high));
});
