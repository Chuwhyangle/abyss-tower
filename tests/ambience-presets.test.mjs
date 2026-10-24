// 氛围预设：群系 × 天气 → 色调/粒子/环境音 id。覆盖映射完整性、默认预设、
// 低配降级（只留色调、零粒子）、未知输入回退，以及画质不改变战斗结果的哈希回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  AMBIENCE_BIOME_IDS,
  AMBIENCE_KIND_BY_BIOME,
  AMBIENCE_KIND_BY_WEATHER,
  AMBIENCE_PARTICLE_BUDGETS,
  AMBIENCE_PRESETS,
  AMBIENCE_TINTS,
  AMBIENCE_WEATHER_IDS,
  DEFAULT_BIOME,
  ambiencePreset,
  normalizeAmbienceQuality,
  resolveAmbience,
} from '../public/js/shared/ambience.js';
import {
  BIOME_SCENES,
  DAY_PHASES,
  DAY_PHASE_IDS,
  WEATHER_IDS,
  WEATHER_TYPES,
} from '../public/js/render/background-renderer.js';
import {
  AMBIENCE_KINDS,
  AMBIENCE_PROFILES,
  AMBIENCE_WEATHER,
  ambienceFor,
} from '../public/js/audio.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SOURCE = (relative) =>
  fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const PRESET_SRC = SOURCE('public/js/shared/ambience.js');
const BACKGROUND_SRC = SOURCE('public/js/render/background-renderer.js');
const AUDIO_SRC = SOURCE('public/js/audio.js');

const WEATHER_KEYS = ['none', ...AMBIENCE_WEATHER_IDS];

// ---------- 映射完整性 ----------

test('预设覆盖六个群系 × 全部天气，且与渲染层/音频层注册表一致', () => {
  assert.deepEqual([...AMBIENCE_BIOME_IDS].sort(), Object.keys(BIOME_SCENES).sort());
  assert.deepEqual([...AMBIENCE_WEATHER_IDS], [...WEATHER_IDS]);

  for (const biome of AMBIENCE_BIOME_IDS) {
    const entry = AMBIENCE_PRESETS[biome];
    assert.deepEqual(Object.keys(entry).sort(), [...WEATHER_KEYS].sort(), `${biome} 天气映射不完整`);
    for (const weather of WEATHER_KEYS) {
      const preset = entry[weather];
      assert.ok(Object.isFrozen(preset), `${biome}/${weather} 预设必须冻结`);
      assert.equal(preset.biome, biome);
      assert.equal(preset.weather, weather === 'none' ? null : weather);
      assert.equal(preset, ambiencePreset(biome, weather === 'none' ? null : weather));

      assert.ok(DAY_PHASE_IDS.includes(preset.tint.id), `${biome}/${weather} 色调未注册`);
      assert.equal(preset.tint, DAY_PHASES[preset.tint.id], '色调必须复用渲染层同一份数据');

      assert.ok(AMBIENCE_KINDS[preset.ambienceKind], `${biome}/${weather} 环境音音色未定义`);
      assert.equal(
        preset.ambienceId,
        `${biome}:${preset.ambienceKind}:${weather}`,
        '环境音 id 必须由群系/音色/天气稳定组成'
      );

      if (weather === 'none') {
        assert.equal(preset.particles, null);
      } else {
        const def = WEATHER_TYPES[weather];
        assert.equal(preset.particles.id, weather);
        assert.equal(preset.particles.max, def.max);
        assert.equal(preset.particles.size, def.size);
        assert.equal(preset.particles.drift, def.drift);
        assert.equal(AMBIENCE_PARTICLE_BUDGETS[weather].max, def.max);
      }
    }
  }
});

test('默认预设：空输入回退 canyon + 无天气，默认质量为全量', () => {
  const fallback = ambiencePreset();
  assert.equal(fallback.biome, DEFAULT_BIOME);
  assert.equal(fallback.weather, null);
  assert.equal(fallback, AMBIENCE_PRESETS[DEFAULT_BIOME].none);

  const resolved = resolveAmbience();
  assert.equal(resolved.quality, 'full');
  assert.equal(resolved.tint, DAY_PHASES.day);
  assert.equal(resolved.particleCount, 0, '无天气时不应凭空产生天气粒子');
  assert.ok(Object.isFrozen(resolved));
});

// ---------- 低配降级 ----------

test('低配/关闭档位只保留色调：粒子清零且不改变天气映射', () => {
  assert.equal(normalizeAmbienceQuality('full'), 'full');
  assert.equal(normalizeAmbienceQuality('high'), 'full');
  assert.equal(normalizeAmbienceQuality('light'), 'light');
  assert.equal(normalizeAmbienceQuality('low'), 'light');
  assert.equal(normalizeAmbienceQuality('off'), 'off');
  assert.equal(normalizeAmbienceQuality('ultra'), 'light', '未知档位回退低配');
  assert.equal(normalizeAmbienceQuality(undefined), 'light');

  for (const biome of AMBIENCE_BIOME_IDS) {
    for (const weather of AMBIENCE_WEATHER_IDS) {
      const full = resolveAmbience(biome, weather, 'full');
      const light = resolveAmbience(biome, weather, 'light');
      const off = resolveAmbience(biome, weather, 'off');

      assert.equal(
        full.particleCount,
        WEATHER_TYPES[weather].max,
        `${biome}/${weather} 高配粒子`
      );
      assert.ok(full.particleCount > 0);
      for (const degraded of [light, off]) {
        assert.equal(degraded.tint, full.tint, '降级不得改变色调');
        assert.equal(degraded.particles, null, '降级后不得保留天气粒子');
        assert.equal(degraded.particleCount, 0, '低配必须零粒子');
        assert.equal(degraded.weather, full.weather, '降级不得改变天气映射');
        assert.equal(degraded.ambienceId, full.ambienceId, '降级不得改变环境音 id');
      }
    }
  }
});

test('未知群系/天气回退默认预设，不抛错', () => {
  for (const biome of [null, undefined, '', 'unknown', 42]) {
    const preset = ambiencePreset(biome, 'rain');
    assert.equal(preset.biome, DEFAULT_BIOME);
    assert.equal(preset.weather, 'rain', '未知群系不应吞掉合法天气');
  }
  for (const weather of [null, undefined, '', 'snow', 7]) {
    const preset = ambiencePreset('twin', weather);
    assert.equal(preset.weather, null, '未知天气回退无天气');
    assert.equal(preset.biome, 'twin');
  }
  const unknownQuality = resolveAmbience('ring', 'fog', 'ultra');
  assert.equal(unknownQuality.quality, 'light');
  assert.equal(unknownQuality.particleCount, 0);
});

// ---------- 纯数据 / 无素材 ----------

test('预设是纯数据：无导入、无副作用、无素材引用', () => {
  assert.doesNotMatch(PRESET_SRC, /^\s*import\s/m, '共享预设不得依赖其他模块');
  assert.doesNotMatch(PRESET_SRC, /document\.|window\.|localStorage|fetch\s*\(/);
  assert.doesNotMatch(PRESET_SRC, /Math\.random|Date\.now|performance\.now/);
  assert.doesNotMatch(PRESET_SRC, /\.(?:png|jpe?g|webp|svg|gif|mp3|ogg|wav)\b/);
  assert.match(PRESET_SRC, /export const AMBIENCE_PRESETS = Object\.freeze\(/);

  const assertPlain = (value, path) => {
    assert.notEqual(typeof value, 'function', `${path} 不应是可执行值`);
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value), `${path} 必须冻结`);
      for (const [key, child] of Object.entries(value)) assertPlain(child, `${path}.${key}`);
    }
  };
  assertPlain(AMBIENCE_PRESETS, 'AMBIENCE_PRESETS');
  assertPlain(AMBIENCE_TINTS, 'AMBIENCE_TINTS');
});

// ---------- 渲染层 / 音频层读取预设 ----------

test('渲染层通过预设决定色调与粒子，低配不画粒子', () => {
  assert.match(BACKGROUND_SRC, /resolveAmbience\(map\?\.archetype, weather\.weather, decor\)/);
  assert.match(BACKGROUND_SRC, /preset\.quality === 'full'\s*\?\s*ambientParticleBudget\(decor, scene\.particles\.max\)\s*:\s*0/);
  assert.match(BACKGROUND_SRC, /drawDayNightTint\(g, width, height, preset\.tint\)/);
  assert.match(BACKGROUND_SRC, /particles: preset\.particleCount/);
  assert.match(BACKGROUND_SRC, /if \(preset\.particleCount > 0\)/);
  assert.doesNotMatch(
    BACKGROUND_SRC,
    /game\.(?:enemies|towers|projectiles|effects|floaters|baseHp|gold|kills|wave)\b/,
    '预设/渲染不得读取战斗状态'
  );
});

test('音频层从共享预设取音色，群系与天气映射保持一致', () => {
  assert.match(AUDIO_SRC, /resolveAmbience\(mapMeta\?\.archetype, weather, 'full'\)/);
  assert.match(AUDIO_SRC, /preset\.ambienceKind/);
  assert.doesNotMatch(AUDIO_SRC, /\.(?:png|jpe?g|webp|svg|gif|mp3|ogg|wav)\b|fetch\s*\(/);

  assert.deepEqual(Object.keys(AMBIENCE_PROFILES).sort(), [...AMBIENCE_BIOME_IDS].sort());
  assert.deepEqual(Object.keys(AMBIENCE_WEATHER).sort(), [...AMBIENCE_WEATHER_IDS].sort());

  for (const biome of AMBIENCE_BIOME_IDS) {
    const base = resolveAmbience(biome, null, 'full');
    assert.equal(base.ambienceKind, AMBIENCE_KIND_BY_BIOME[biome]);
    assert.equal(AMBIENCE_PROFILES[biome].kind, base.ambienceKind);
    const spec = ambienceFor({ archetype: biome });
    assert.equal(spec.kind, base.ambienceKind, `${biome} 音频层未采用预设音色`);
    assert.equal(spec.key, base.ambienceId);

    for (const weather of AMBIENCE_WEATHER_IDS) {
      const preset = resolveAmbience(biome, weather, 'full');
      assert.equal(preset.ambienceKind, AMBIENCE_KIND_BY_WEATHER[weather]);
      const overlaid = ambienceFor({ archetype: biome }, weather);
      assert.equal(overlaid.kind, preset.ambienceKind);
      assert.equal(overlaid.weather, weather);
      assert.equal(overlaid.key, preset.ambienceId);
    }
  }

  // 未知输入在音频层同样回退，不抛错。
  assert.equal(ambienceFor({ archetype: 'unknown' }, 'snow').biome, DEFAULT_BIOME);
  assert.equal(ambienceFor(null, null).kind, AMBIENCE_KIND_BY_BIOME[DEFAULT_BIOME]);
});

test('三个模块都不引入素材文件', () => {
  for (const src of [PRESET_SRC, BACKGROUND_SRC, AUDIO_SRC]) {
    assert.doesNotMatch(src, /new\s+Image\s*\(|new\s+Audio\s*\(/);
    assert.doesNotMatch(src, /\.(?:png|jpe?g|webp|svg|gif|mp3|ogg|wav)\b/);
  }
});

// ---------- 画质不改变战斗结果 ----------

function makeSim(quality) {
  const seed = 'ambience-presets-hash';
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

test('同种子低配/高配战斗状态哈希一致', () => {
  const light = makeSim('light');
  const full = makeSim('full');
  assert.equal(stateHash(light), stateHash(full), '低配画质不得改变战斗结果');
});
