// 天气层与昼夜色调：天气定义完整、按地图词缀/种子确定派生、预算单调且低配可关闭、
// 渲染只读地图元数据（不读战斗状态），以及「画质不改变战斗结果」的同种子哈希回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  DAY_PHASE_IDS,
  DAY_PHASES,
  WEATHER_IDS,
  WEATHER_TYPES,
  timeOfDayFor,
  weatherFor,
  weatherLayer,
  weatherParticleBudget,
} from '../public/js/render/background-renderer.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SRC = fs.readFileSync(
  new URL('../public/js/render/background-renderer.js', import.meta.url),
  'utf8'
);

test('天气定义完整：雨/雾/流星雨都带预算与绘制参数', () => {
  assert.deepEqual([...WEATHER_IDS].sort(), ['fog', 'meteor', 'rain']);
  for (const id of WEATHER_IDS) {
    const def = WEATHER_TYPES[id];
    assert.equal(def.id, id, `${id}.id 与键名不一致`);
    assert.ok(def.name, `${id} 缺少可读名称`);
    assert.ok(def.max > 0 && def.max <= 80, `${id} 粒子上限非法`);
    assert.ok(def.size > 0, `${id} 尺寸非法`);
    assert.ok(def.alpha > 0 && def.alpha <= 0.3, `${id} 透明度必须低且可见`);
    assert.match(def.color, /^#[0-9a-f]{6}$/i, `${id} 颜色必须是十六进制色`);
    assert.ok(Number.isFinite(def.angle), `${id} 角度缺失`);
  }
});

test('天气与时段由地图词缀或种子确定派生', () => {
  assert.equal(weatherFor({ modifier: { id: 'mist' } }, 'seed'), 'fog');
  assert.equal(weatherFor({ modifier: 'mist' }, 'seed'), 'fog', '字符串词缀也要识别');
  assert.equal(weatherFor({ modifier: { id: 'starlit' } }, 'seed'), 'meteor');
  assert.equal(weatherFor({ modifier: { id: 'swift' } }, 'seed'), 'rain');
  assert.equal(weatherFor({ modifier: { id: 'surge' } }, 'seed'), 'rain');

  // 无词缀时同种子稳定，且总是落在已注册的天气里。
  for (const seed of ['alpha', 'beta', 'gamma', 'weather-visuals']) {
    const picked = weatherFor(null, seed);
    assert.equal(picked, weatherFor({}, seed));
    assert.equal(picked, weatherFor({ modifier: null }, seed));
    assert.ok(WEATHER_IDS.includes(picked), `${seed} 派生了未知天气 ${picked}`);
  }
  // 未知词缀不抛错，回退到种子派生。
  assert.ok(WEATHER_IDS.includes(weatherFor({ modifier: { id: 'nope' } }, 'seed')));

  assert.equal(timeOfDayFor({ modifier: { id: 'dusk' } }, 'seed'), 'dusk');
  assert.equal(timeOfDayFor({ modifier: 'dusk' }, 'seed'), 'dusk');
  assert.equal(timeOfDayFor({ modifier: { id: 'starlit' } }, 'seed'), 'night');
  for (const seed of ['alpha', 'beta', 'gamma', 'weather-visuals']) {
    const phase = timeOfDayFor(null, seed);
    assert.equal(phase, timeOfDayFor({}, seed));
    assert.ok(DAY_PHASE_IDS.includes(phase), `${seed} 派生了未知时段 ${phase}`);
  }
});

test('时段色调低透明度，不压过路径对比', () => {
  assert.deepEqual([...DAY_PHASE_IDS].sort(), ['dawn', 'day', 'dusk', 'night']);
  for (const id of DAY_PHASE_IDS) {
    const phase = DAY_PHASES[id];
    assert.equal(phase.id, id);
    assert.ok(phase.name, `${id} 缺少可读名称`);
    assert.match(phase.color, /^\d{1,3}, \d{1,3}, \d{1,3}$/, `${id} 颜色必须是 rgb 分量`);
    assert.ok(phase.alpha > 0 && phase.alpha <= 0.08, `${id} 色调透明度必须低`);
  }
});

test('天气粒子预算单调：低配/高配/关闭', () => {
  for (const id of WEATHER_IDS) {
    const cap = WEATHER_TYPES[id].max;
    assert.equal(weatherParticleBudget('off', cap), 0, `${id} 关闭画质必须完全关闭粒子`);
    const light = weatherParticleBudget('light', cap);
    const full = weatherParticleBudget('full', cap);
    assert.ok(light > 0 && light < full, `${id} 低配粒子必须少于高配`);
    assert.ok(full <= cap, `${id} 粒子不得超过场景上限`);
    assert.equal(weatherParticleBudget('unknown', cap), light, `${id} 未知档位回退低配`);
    assert.equal(weatherParticleBudget('full', 0), 0);
    assert.equal(weatherParticleBudget('full', NaN), 0);
  }
});

test('weatherLayer 汇总天气/时段/预算，低配可完全关闭', () => {
  const full = weatherLayer({ modifier: { id: 'mist' } }, 'seed', 'full');
  assert.equal(full.weather, 'fog');
  assert.equal(full.phase, 'dawn');
  assert.equal(full.tint, DAY_PHASES[full.phase]);
  assert.equal(full.particles, WEATHER_TYPES.fog.max);

  const off = weatherLayer({ modifier: { id: 'mist' } }, 'seed', 'off');
  assert.equal(off.particles, 0);

  const light = weatherLayer({ modifier: { id: 'mist' } }, 'seed', 'light');
  assert.ok(light.particles > 0 && light.particles < full.particles);

  // 默认档位按高配处理；缺省元数据也不抛错。
  assert.equal(weatherLayer(null, 'seed').particles, WEATHER_TYPES[weatherFor(null, 'seed')].max);
});

test('源码级：只读地图元数据，不读战斗状态，且不引入素材', () => {
  assert.match(SRC, /weatherLayer\(meta, weatherSeed, decor\)/, '天气必须由地图元数据/种子派生');
  assert.match(SRC, /game\.mapMeta \|\| map\.meta/, '天气读取地图元数据而非模拟实体');
  assert.match(SRC, /new RNG\(`\$\{weatherSeed\}:\$\{weather\.weather\}`\)/, '天气使用独立 RNG');
  assert.match(SRC, /excluded\?\.has\(/, '天气粒子必须遵循路径排除区');
  assert.doesNotMatch(
    SRC,
    /game\.(?:enemies|towers|projectiles|effects|floaters|baseHp|gold|kills|wave)\b/,
    '渲染层不得读取战斗模拟状态'
  );
  assert.doesNotMatch(SRC, /\.(?:png|jpe?g|webp|svg|gif)\b|new\s+Image\s*\(|fetch\s*\(/, '不引入素材文件');

  const path = SRC.indexOf('// 路径：逐条绘制');
  const weather = SRC.indexOf('this.drawWeather(');
  assert.ok(path >= 0 && weather > path, '天气层绘制在路径之后，但粒子排除路径格');
});

function makeSim(quality) {
  const seed = 'weather-visuals-hash';
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
    unlockedTowers: ['arrow', 'cannon', 'frost'],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({ effects: quality, floaters: quality === 'full' ? 'all' : 'off' });
  const meta = sim.mapMeta || {};
  sim.beginWave(generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  }));
  for (let i = 0; i < 600; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }
  return sim;
}

function stateHash(sim) {
  const json = JSON.stringify({
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
  return createHash('sha256').update(json).digest('hex');
}

test('同种子下低配/高配战斗状态哈希一致', () => {
  const off = makeSim('off');
  const light = makeSim('light');
  const full = makeSim('full');
  const baseline = stateHash(full);
  assert.equal(stateHash(off), baseline, '关闭特效不得改变战斗结果');
  assert.equal(stateHash(light), baseline, '低配画质不得改变战斗结果');
});
