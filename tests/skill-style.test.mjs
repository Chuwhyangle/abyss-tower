// 技能视觉语义统一：危险/控制/增益三套语义集中定义、所有技能（玩家 + 首领）
// 都有预警定义、低配/高配预算单调，以及"画质不改变战斗结果"的同种子回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  ACCESSIBILITY_MIN_DISTANCE,
  Palette,
  SKILL_SEMANTIC_MAP,
  SKILL_SEMANTICS,
  SKILL_WARNING_STYLE,
} from '../public/js/render/palette.js';
import {
  SKILL_QUALITY_PROFILES,
  SKILL_WARNING_PROFILES,
  SKILL_WARNING_REGISTRY,
  qualityProfile,
  warningProfile,
} from '../public/js/render/skill-renderer.js';
import { BOSS_SKILLS, SKILL_ORDER } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const ROOT = new URL('../', import.meta.url);
const readSource = (relative) => fs.readFileSync(new URL(relative, ROOT), 'utf8');
const SKILL_SRC = readSource('public/js/render/skill-renderer.js');
const EFFECT_SRC = readSource('public/js/render/effect-renderer.js');
const PALETTE_SRC = readSource('public/js/render/palette.js');

const SHAPES = ['ring', 'hex', 'star'];
const ALL_SKILL_IDS = [...SKILL_ORDER, ...Object.keys(BOSS_SKILLS)];
const SEMANTIC_IDS = Object.keys(SKILL_SEMANTICS);

function assertPairwiseDistinct(colors, label) {
  const entries = Object.entries(colors);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [leftId, left] = entries[i];
      const [rightId, right] = entries[j];
      const distance = Palette.labDistance(left, right);
      assert.ok(
        distance >= ACCESSIBILITY_MIN_DISTANCE,
        `${label}: ${leftId}(${left}) 与 ${rightId}(${right}) 色差 ${distance.toFixed(1)} 低于 ${ACCESSIBILITY_MIN_DISTANCE}`
      );
    }
  }
}

test('语义色集中定义：危险/控制/增益三类齐全且形状固定', () => {
  assert.deepEqual(SEMANTIC_IDS.sort(), ['buff', 'control', 'danger']);
  const shapes = {};
  for (const [id, def] of Object.entries(SKILL_SEMANTICS)) {
    assert.equal(def.id, id);
    assert.equal(typeof def.label, 'string');
    assert.match(def.color, /^#[0-9a-f]{6}$/i, `${id}.color 必须是十六进制色`);
    assert.match(def.accent, /^#[0-9a-f]{6}$/i, `${id}.accent 必须是十六进制色`);
    assert.ok(SHAPES.includes(def.shape), `${id}.shape 未知`);
    shapes[id] = def.shape;
  }
  assert.deepEqual(shapes, { danger: 'ring', control: 'hex', buff: 'star' });
  assertPairwiseDistinct(
    Object.fromEntries(SEMANTIC_IDS.map((id) => [id, SKILL_SEMANTICS[id].color])),
    '默认语义色'
  );
});

test('色盲模式复用调色映射：三类语义仍两两可辨', () => {
  for (const mode of ['none', 'deuteranopia', 'protanopia', 'tritanopia']) {
    const colors = Object.fromEntries(
      SEMANTIC_IDS.map((id) => [id, Palette.semanticColor(id, { colorBlind: mode })])
    );
    for (const color of Object.values(colors)) {
      assert.match(color, /^#[0-9a-f]{6}$/i, `${mode} 语义色必须是十六进制`);
    }
    assertPairwiseDistinct(colors, `${mode} 语义色`);
  }

  // 未知语义 fail-safe 回退危险；高对比仍输出合法颜色。
  assert.equal(Palette.semanticColor('unknown-skill'), Palette.semanticColor('danger'));
  assert.equal(Palette.semanticShape('unknown-skill'), 'ring');
  for (const id of SEMANTIC_IDS) {
    assert.match(Palette.semanticColor(id, { highContrast: true }), /^#[0-9a-f]{6}$/i);
    assert.match(Palette.semanticAccent(id, { highContrast: true }), /^#[0-9a-f]{6}$/i);
  }
});

test('所有技能（玩家 + 首领）都有预警定义并映射到统一语义', () => {
  assert.deepEqual([...SKILL_ORDER].sort(), Object.keys(SKILL_WARNING_PROFILES).sort());
  assert.deepEqual(ALL_SKILL_IDS.slice().sort(), Object.keys(SKILL_WARNING_REGISTRY).sort());
  assert.deepEqual(ALL_SKILL_IDS.slice().sort(), Object.keys(SKILL_SEMANTIC_MAP).sort());

  for (const id of ALL_SKILL_IDS) {
    const profile = warningProfile(id);
    assert.equal(profile, SKILL_WARNING_REGISTRY[id], `${id} 必须命中注册表`);
    const semantic = SKILL_SEMANTICS[profile.semantic];
    assert.ok(semantic, `${id} 映射到未知语义 ${profile.semantic}`);
    assert.equal(profile.shape, semantic.shape, `${id} 形状未跟随语义`);
    assert.ok(profile.ttl > 0 && profile.ttl <= 1.2, `${id} 预警时长不合理`);
    assert.ok(profile.radius > 0, `${id} 预警半径缺失`);
    assert.equal(profile.ring, true, `${id} 缺少倒计时环`);
    assert.ok(profile.source === 'cast' || profile.source === 'event', `${id} 预警来源未知`);

    // 线宽 / 虚线 / 填充 / 倒计时样式在所有技能间统一。
    assert.deepEqual([...profile.dash], [...SKILL_WARNING_STYLE.dash], `${id} 虚线未统一`);
    assert.equal(profile.fill, SKILL_WARNING_STYLE.fill, `${id} 填充未统一`);
    assert.equal(profile.lineWidth, SKILL_WARNING_STYLE.lineWidth, `${id} 线宽未统一`);
    assert.equal(profile.countdownWidth, SKILL_WARNING_STYLE.countdownWidth, `${id} 倒计时环未统一`);
    assert.ok(profile.fill > 0 && profile.fill < 0.2, `${id} 填充过重，会遮挡路径信息`);
  }

  // 三类语义都被实际使用，且首领技能一律归入危险。
  const used = new Set(ALL_SKILL_IDS.map((id) => SKILL_SEMANTIC_MAP[id]));
  assert.deepEqual([...used].sort(), ['buff', 'control', 'danger']);
  for (const id of Object.keys(BOSS_SKILLS)) {
    assert.equal(warningProfile(id).semantic, 'danger', `首领技能 ${id} 应为危险语义`);
  }
  assert.equal(warningProfile('meteor').source, 'event');
  assert.equal(warningProfile('aurora').source, 'cast');
  assert.equal(warningProfile('chrono').source, 'cast');
});

test('低配/高配画质预算单调，预警样式与画质无关', () => {
  const minimal = qualityProfile('minimal');
  const standard = qualityProfile('standard');
  const full = qualityProfile('full');

  assert.ok(minimal.particles < standard.particles, '低配粒子预算必须低于中配');
  assert.ok(standard.particles < full.particles, '中配粒子预算必须低于高配');
  assert.equal(minimal.particles, SKILL_QUALITY_PROFILES.minimal.particles);
  assert.equal(full.particles, SKILL_QUALITY_PROFILES.full.particles);

  for (const flag of ['glow', 'afterglow', 'ambient', 'banner']) {
    const toNumber = (value) => (value ? 1 : 0);
    assert.ok(toNumber(minimal[flag]) <= toNumber(standard[flag]), `${flag} 中配不应低于低配`);
    assert.ok(toNumber(standard[flag]) <= toNumber(full[flag]), `${flag} 高配不应低于中配`);
  }
  assert.ok(minimal.tint <= standard.tint && standard.tint <= full.tint, '屏幕色层应单调递增');

  // 预警是玩法信息：三档共用同一份定义，不随画质裁剪。
  for (const id of ALL_SKILL_IDS) {
    assert.equal(warningProfile(id), SKILL_WARNING_REGISTRY[id]);
  }
});

test('源码级：语义色与预警几何只有一个来源，预警不遮挡 HUD', () => {
  for (const [id, semantic] of Object.entries(SKILL_SEMANTICS)) {
    assert.ok(PALETTE_SRC.includes(semantic.color), `palette.js 缺少 ${id} 主色`);
    assert.ok(!SKILL_SRC.includes(semantic.color), `skill-renderer 硬编码了 ${id} 主色`);
    assert.ok(!EFFECT_SRC.includes(semantic.color), `effect-renderer 硬编码了 ${id} 主色`);
  }
  assert.match(SKILL_SRC, /Palette\.semanticColor/);
  assert.match(EFFECT_SRC, /Palette\.semanticColor/);
  assert.match(SKILL_SRC, /SKILL_WARNING_STYLE\.dash/);
  assert.match(SKILL_SRC, /SKILL_WARNING_STYLE\.countdownColor/);
  assert.match(EFFECT_SRC, /SKILL_WARNING_STYLE\.dash/);

  // 预警区间只做低透明地面标记，不允许整屏覆盖。
  const start = SKILL_SRC.indexOf('_drawTelegraph(g, time) {');
  const end = SKILL_SRC.indexOf('// ---------- L2 世界');
  assert.ok(start > 0 && end > start, '未找到预警绘制区间');
  const warningBody = SKILL_SRC.slice(start, end);
  assert.doesNotMatch(warningBody, /fillRect/, '预警不得整屏填充遮挡 HUD');

  // 不引入素材：渲染层只 import 同目录/上级目录的 JS 模块。
  for (const [name, source] of [['skill-renderer', SKILL_SRC], ['effect-renderer', EFFECT_SRC]]) {
    const imports = [...source.matchAll(/^import .* from '([^']+)';/gm)].map((match) => match[1]);
    assert.ok(imports.length > 0, `${name} 缺少 import`);
    for (const spec of imports) {
      assert.match(spec, /^\.\.?\//, `${name} 引入了外部依赖 ${spec}`);
    }
    assert.doesNotMatch(source, /\.(?:png|jpe?g|webp|gif|svg|mp3|wav|ogg)\b/i, `${name} 引入了素材`);
  }
});

function runBattle(tier) {
  const seed = 'skill-style-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 400,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    skill: { id: 'meteor', level: 10 },
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({
    effects: tier === 'minimal' ? 'off' : 'full',
    floaters: tier === 'minimal' ? 'off' : 'all',
  });
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);

  let cast = false;
  for (let i = 0; i < 900; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
    if (!cast && i === 240) cast = sim.castSkill();
  }

  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    cooldown: Number((sim.skill?.cooldown ?? 0).toFixed(6)),
    enemies: sim.enemies.map((enemy) => [
      enemy.type,
      Math.round(enemy.hp * 1e6),
      enemy.x.toFixed(6),
      enemy.y.toFixed(6),
      enemy.burnUntil ? enemy.burnUntil.toFixed(6) : 0,
    ]),
  });
}

test('同种子下低配/高配战斗状态哈希一致', () => {
  const hash = (json) => createHash('sha256').update(json).digest('hex');
  assert.equal(hash(runBattle('minimal')), hash(runBattle('full')));
});
