// 特效增强与画质预算：预算函数边界、画质档位映射、事件描述表完整性、
// 复用池上限、光晕缓存、以及"画质不改变战斗结果"的同种子回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BOSS_KILL_RADIUS,
  EFFECT_EVENTS,
  EFFECT_KIND_EVENTS,
  EFFECT_PROFILES,
  EffectRenderer,
  ParticlePool,
  clampCount,
  classifyEffect,
  effectProfile,
  effectProgress,
  particleCount,
  scaledCount,
} from '../public/js/render/effect-renderer.js';
import { GLOW_QUALITY, GlowRenderer, glowQuality } from '../public/js/render/glow-renderer.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const EFFECT_SRC = fs.readFileSync(
  new URL('../public/js/render/effect-renderer.js', import.meta.url),
  'utf8'
);
const GLOW_SRC = fs.readFileSync(
  new URL('../public/js/render/glow-renderer.js', import.meta.url),
  'utf8'
);

const REQUIRED_EVENT_FIELDS = ['color', 'accent', 'shape', 'duration', 'particles', 'ring', 'spin', 'glow', 'puffs'];

test('预算函数：负数/NaN/小数/超上限的边界', () => {
  assert.equal(clampCount(5, 10), 5);
  assert.equal(clampCount(-3, 10), 0);
  assert.equal(clampCount(NaN, 10), 0);
  assert.equal(clampCount(Number.POSITIVE_INFINITY, 10), 0);
  assert.equal(clampCount(12, 10), 10);
  assert.equal(clampCount(3.9, 10), 3);
  assert.equal(clampCount(4, 0), 0);
  assert.equal(clampCount(4, -1), 0);
  assert.equal(clampCount(4, NaN), 0);
});

test('粒子数按画质缩放且不超过每事件上限', () => {
  const low = EFFECT_PROFILES.low;
  const high = EFFECT_PROFILES.high;
  assert.equal(particleCount(8, high), 8);
  assert.equal(particleCount(8, low), Math.round(8 * low.particleScale));
  assert.ok(particleCount(8, low) < particleCount(8, high), '低配粒子数必须少于高配');
  assert.equal(particleCount(100, high), high.maxParticles);
  assert.equal(particleCount(0, high), 0);
  assert.equal(particleCount(-5, high), 0);
  // 装饰数量至少为 1，低配不能让环形/火花整体消失。
  assert.equal(scaledCount(6, low), Math.max(1, Math.round(6 * low.particleScale)));
  assert.equal(scaledCount(0, low), 1);
});

test('画质档位映射：低配/高配预设与自定义设置', () => {
  assert.equal(effectProfile(QUALITY_PRESETS.low).tier, 'low');
  assert.equal(effectProfile(QUALITY_PRESETS.high).tier, 'high');
  assert.equal(effectProfile(undefined).tier, 'low');
  assert.equal(effectProfile({}).tier, 'low');
  assert.equal(effectProfile({ decorations: 'light', glow: true, dpr: 1 }).tier, 'low');
  assert.equal(effectProfile({ decorations: 'full' }).tier, 'high');
  assert.equal(effectProfile({ decorations: 'light', glow: true, dpr: 2 }).tier, 'high');

  const low = effectProfile(QUALITY_PRESETS.low);
  const high = effectProfile(QUALITY_PRESETS.high);
  assert.ok(low.frameBudget < high.frameBudget);
  assert.ok(low.poolBudget <= high.poolBudget);
  assert.equal(low.halo, false);
  assert.equal(high.halo, true);

  assert.equal(glowQuality({ glow: false }), GLOW_QUALITY.low);
  assert.equal(glowQuality({ glow: true }), GLOW_QUALITY.high);
  assert.equal(glowQuality(undefined), GLOW_QUALITY.low);
  assert.equal(GLOW_QUALITY.low.enabled, false);
  assert.equal(GLOW_QUALITY.high.enabled, true);
  assert.ok(GLOW_QUALITY.low.layers < GLOW_QUALITY.high.layers);
});

test('事件描述表完整：击杀/首领死亡/基地受击都有可区分定义', () => {
  for (const event of ['kill', 'bossKill', 'baseHit']) {
    const entry = EFFECT_EVENTS[event];
    assert.ok(entry, `缺少事件定义：${event}`);
    for (const field of REQUIRED_EVENT_FIELDS) {
      assert.ok(entry[field] !== undefined, `${event}.${field} 未定义`);
    }
    assert.ok(entry.duration > 0, `${event}.duration 必须为正`);
    assert.ok(entry.particles > 0, `${event}.particles 必须为正`);
    assert.match(entry.color, /^#[0-9a-f]{6}$/i, `${event}.color 必须是十六进制色`);
  }
  assert.notEqual(EFFECT_EVENTS.kill.color, EFFECT_EVENTS.bossKill.color);
  assert.notEqual(EFFECT_EVENTS.kill.shape, EFFECT_EVENTS.bossKill.shape);
  assert.notEqual(EFFECT_EVENTS.bossKill.shape, EFFECT_EVENTS.baseHit.shape);
  assert.notEqual(EFFECT_EVENTS.kill.duration, EFFECT_EVENTS.bossKill.duration);
  assert.notEqual(EFFECT_EVENTS.bossKill.duration, EFFECT_EVENTS.baseHit.duration);
  assert.ok(EFFECT_EVENTS.bossKill.particles > EFFECT_EVENTS.kill.particles);
});

test('模拟发出的每种特效 kind 都有事件映射', () => {
  const simKinds = ['spawn', 'poison', 'heal', 'leak', 'bolt', 'muzzle', 'ring', 'spark', 'death', 'place'];
  for (const kind of simKinds) {
    assert.ok(EFFECT_KIND_EVENTS[kind], `模拟 kind 缺少映射：${kind}`);
    assert.ok(classifyEffect({ kind }));
  }
});

test('classifyEffect：普通死亡/首领死亡/基地受击分流', () => {
  assert.equal(classifyEffect({ kind: 'death', r: 0.3 }), 'kill');
  assert.equal(classifyEffect({ kind: 'death', r: 0.42 }), 'kill');
  assert.equal(classifyEffect({ kind: 'death', r: BOSS_KILL_RADIUS }), 'bossKill');
  assert.equal(classifyEffect({ kind: 'death', r: 0.58 }), 'bossKill');
  assert.equal(classifyEffect({ kind: 'death' }), 'kill');
  assert.equal(classifyEffect({ kind: 'leak' }), 'baseHit');
  assert.equal(classifyEffect({ kind: 'spark' }), 'spark');
  assert.equal(classifyEffect({ kind: 'mystery' }), 'mystery');
  assert.equal(classifyEffect(null), 'unknown');
});

test('effectProgress 边界：出生/终了/越界都被钳制', () => {
  const entry = EFFECT_EVENTS.kill;
  const born = effectProgress({ ttl: 0.3, maxTtl: 0.3 }, entry);
  assert.equal(born.p, 0);
  assert.equal(born.fade, 1);
  const dead = effectProgress({ ttl: 0, maxTtl: 0.3 }, entry);
  assert.equal(dead.p, 1);
  assert.equal(dead.fade, 0);
  const over = effectProgress({ ttl: 9, maxTtl: 0.3 }, entry);
  assert.equal(over.p, 0);
  assert.equal(over.fade, 1);
  const under = effectProgress({ ttl: -1, maxTtl: 0.3 }, entry);
  assert.equal(under.p, 1);
  assert.equal(under.fade, 0);
  // 首领死亡按自身时长推进，与普通击杀同一时刻的进度不同。
  const boss = effectProgress({ ttl: 0.15, maxTtl: 0.45 }, EFFECT_EVENTS.bossKill);
  const kill = effectProgress({ ttl: 0.15, maxTtl: 0.45 }, EFFECT_EVENTS.kill);
  assert.ok(boss.p < kill.p, '首领死亡动画应更慢');
});

test('effectProgress 支持复用输出对象（渲染循环零临时对象）', () => {
  const out = { p: 0, fade: 0 };
  const first = effectProgress({ ttl: 0.2, maxTtl: 0.4 }, EFFECT_EVENTS.kill, out);
  assert.equal(first, out);
  effectProgress({ ttl: 0.2, maxTtl: 0.4 }, EFFECT_EVENTS.bossKill, out);
  assert.equal(out.p, 0.5);
  assert.equal(out.fade, 0.5);
});

test('复用池：构造后不再分配、上限内循环复用', () => {
  const pool = new ParticlePool(4);
  assert.equal(pool.slots.length, 4);
  const first = pool.acquire();
  assert.ok(first);
  const identity = pool.slots[0];
  for (let frame = 0; frame < 50; frame++) {
    pool.reset(2);
    const a = pool.acquire();
    const b = pool.acquire();
    assert.equal(pool.acquire(), null, '超过本帧预算后不再分配');
    assert.equal(a, identity, '跨帧复用同一槽位对象');
    assert.equal(b, pool.slots[1]);
    assert.equal(pool.active, 2);
  }
  assert.equal(pool.slots.length, 4, '复用期间池容量不变');

  const empty = new ParticlePool(0);
  assert.equal(empty.acquire(), null);
  const negative = new ParticlePool(-3);
  assert.equal(negative.slots.length, 0);

  // 每帧预算不能突破池容量。
  pool.reset(99);
  let acquired = 0;
  while (pool.acquire()) acquired++;
  assert.equal(acquired, 4);
});

test('复用池与每帧预算在源码中被渲染循环使用', () => {
  assert.match(EFFECT_SRC, /class ParticlePool/);
  assert.match(EFFECT_SRC, /this\.pool\.reset\(profile\.poolBudget\)/);
  assert.match(EFFECT_SRC, /this\.pool\.acquire\(\)/);
  assert.match(EFFECT_SRC, /profile\.frameBudget/);
});

test('光晕缓存：同色复用、低配关闭、条数有上限', () => {
  let created = 0;
  const createSprite = (color) => {
    created++;
    return { color, width: 64, height: 64 };
  };
  const renderer = new GlowRenderer({ capacity: 2, createSprite });

  renderer.configure({ glow: true, dpr: 2, decorations: 'full' });
  const calls = [];
  const g = {
    save() {},
    restore() {},
    drawImage(...args) { calls.push(args); },
  };

  assert.equal(renderer.draw(g, '#ff0000', 10, 10, 8, 0.5), true);
  assert.equal(renderer.draw(g, '#ff0000', 20, 20, 8, 0.5), true);
  assert.equal(created, 1, '同色光晕只创建一次贴图');
  assert.equal(calls.length, 2);
  assert.equal(renderer.size, 1);

  renderer.sprite('#00ff00');
  renderer.sprite('#0000ff');
  assert.equal(renderer.size, 2, '缓存条数不超过容量');
  const beforeEvicted = created;
  renderer.sprite('#ff0000');
  assert.equal(created, beforeEvicted + 1, '最久未用的颜色被淘汰后重新创建');

  renderer.configure({ glow: false });
  const beforeLow = calls.length;
  assert.equal(renderer.draw(g, '#ffffff', 0, 0, 10, 1), false);
  assert.equal(calls.length, beforeLow, '低配不产生额外光晕绘制');
  assert.equal(renderer.quality, GLOW_QUALITY.low);
});

test('源码级：特效层只读模拟状态，不碰 DOM/HUD', () => {
  assert.doesNotMatch(EFFECT_SRC, /effects\.(push|splice|pop|shift)\s*\(/, '不得修改模拟特效列表');
  assert.doesNotMatch(EFFECT_SRC, /from\s+'\.\.\/sim\.js'/, '不得依赖模拟模块');
  assert.doesNotMatch(EFFECT_SRC, /document\.|querySelector|innerHTML/, '特效只画在 Canvas 上');
  assert.doesNotMatch(EFFECT_SRC, /fillRect\(0,\s*0/, '不得整屏覆盖');
  assert.match(GLOW_SRC, /this\._glowCache/);
  assert.match(GLOW_SRC, /get size\(\)/);
  assert.match(GLOW_SRC, /capacity/);
});

function makeCtx() {
  const calls = { save: 0, arc: 0, moveTo: 0, drawImage: 0, fillRect: 0 };
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
    setLineDash() {},
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

test('渲染循环：全部特效 kind 在低配/高配下都不报错', () => {
  const effects = [
    { kind: 'ring', x: 1, y: 1, r0: 0.1, r1: 1, ttl: 0.2, maxTtl: 0.25 },
    { kind: 'spark', x: 2, y: 2, ttl: 0.1, maxTtl: 0.15 },
    { kind: 'bolt', x: 3, y: 3, points: [{ x: 3, y: 3 }, { x: 4, y: 4 }], ttl: 0.1, maxTtl: 0.18 },
    { kind: 'muzzle', x: 4, y: 4, angle: 0.5, ttl: 0.1, maxTtl: 0.15 },
    { kind: 'spawn', x: 5, y: 5, ttl: 0.3, maxTtl: 0.4 },
    { kind: 'death', x: 6, y: 6, r: 0.3, ttl: 0.3, maxTtl: 0.45, color: '#d1717b' },
    { kind: 'death', x: 6.5, y: 6.5, r: 0.58, ttl: 0.3, maxTtl: 0.45, color: '#e2609e' },
    { kind: 'heal', x: 7, y: 7, ttl: 0.4, maxTtl: 0.6 },
    { kind: 'place', x: 8, y: 8, ttl: 0.3, maxTtl: 0.45, color: '#ffd36b' },
    { kind: 'poison', x: 9, y: 9, ttl: 0.3, maxTtl: 0.5 },
    { kind: 'leak', x: 10, y: 10, ttl: 0.3, maxTtl: 0.5 },
  ];
  for (const settings of [QUALITY_PRESETS.low, QUALITY_PRESETS.high]) {
    const calls = renderScene(effects, settings);
    assert.ok(calls.arc > 0);
  }
});

test('渲染循环：低配火花射线少于高配', () => {
  const spark = [{ kind: 'spark', x: 2, y: 2, ttl: 0.1, maxTtl: 0.15 }];
  const low = renderScene(spark, QUALITY_PRESETS.low);
  const high = renderScene(spark, QUALITY_PRESETS.high);
  assert.ok(low.moveTo < high.moveTo, `低配射线 ${low.moveTo} 应少于高配 ${high.moveTo}`);
  assert.equal(high.moveTo, 6);
  assert.equal(low.moveTo, scaledCount(6, EFFECT_PROFILES.low));
});

test('渲染循环：每帧特效数量受预算上限约束', () => {
  const rings = Array.from({ length: 400 }, (_, i) => ({
    kind: 'ring', x: i, y: 0, r0: 0.1, r1: 1, ttl: 0.2, maxTtl: 0.25,
  }));
  const low = renderScene(rings, QUALITY_PRESETS.low);
  const high = renderScene(rings, QUALITY_PRESETS.high);
  // 每个环形特效画两圈；超出预算的环不再进入绘制。
  assert.equal(low.arc, EFFECT_PROFILES.low.frameBudget * 2);
  assert.equal(high.arc, EFFECT_PROFILES.high.frameBudget * 2);
  assert.ok(low.arc < 400 * 2);
});

function runSim(effectsLevel) {
  const seed = 'render-effects-determinism';
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

test('同种子下低配/高配特效不改变战斗结果', () => {
  const full = runSim('full');
  const off = runSim('off');
  const light = runSim('light');
  assert.equal(off, full);
  assert.equal(light, full);
});
