// 塔与敌人的程序化动画：配置表完整性、三档画质预算、渲染零写回、
// 死亡碎裂复用现有粒子池，以及"画质不改变战斗结果"的同种子哈希回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  EnemyRenderer,
  ENEMY_ANIMATIONS,
  ENEMY_ANIM_VARIANTS,
  ENEMY_WALK_PROFILES,
  enemyAnimVariant,
  enemyWalkProfile,
  hitFlashAlpha,
} from '../public/js/render/enemy-renderer.js';
import {
  TowerRenderer,
  TOWER_ANIMATIONS,
  TOWER_ANIM_VARIANTS,
  TOWER_RECOIL_SCALE,
  towerAnimVariant,
  towerRecoilAmount,
  towerUpgradePulse,
} from '../public/js/render/tower-renderer.js';
import { EFFECT_EVENTS } from '../public/js/render/effect-renderer.js';
import { GlowRenderer } from '../public/js/render/glow-renderer.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const TIERS = ['off', 'light', 'full'];
const ENEMY_SRC = fs.readFileSync(
  new URL('../public/js/render/enemy-renderer.js', import.meta.url),
  'utf8'
);
const TOWER_SRC = fs.readFileSync(
  new URL('../public/js/render/tower-renderer.js', import.meta.url),
  'utf8'
);

test('动画配置表完整：每种动画都有三档预算与有限参数', () => {
  for (const name of ['walk', 'hitFlash', 'deathShatter']) {
    const entry = ENEMY_ANIMATIONS[name];
    assert.ok(entry, `敌人缺少动画配置：${name}`);
    assert.equal(typeof entry.key, 'boolean', `${name}.key 必须显式声明`);
  }
  assert.equal(ENEMY_ANIMATIONS.hitFlash.duration, 0.08, '受击闪白固定 0.08s');
  assert.ok(ENEMY_ANIMATIONS.hitFlash.decay > 0, 'hitFlash 衰减速率必须为正');

  for (const tier of TIERS) {
    const variant = ENEMY_ANIM_VARIANTS[tier];
    assert.ok(variant, `敌人缺少 ${tier} 档视图`);
    assert.equal(variant.tier, tier);
    assert.equal(typeof variant.walk.enabled, 'boolean', `${tier}.walk.enabled 必须为布尔`);
    assert.ok(variant.walk.speed > 0 && variant.walk.flyingSpeed > 0, `${tier} 行走速度必须为正`);
    assert.equal(typeof variant.hitFlash.enabled, 'boolean');
    assert.ok(variant.hitFlash.alpha > 0 && variant.hitFlash.alpha <= 1, `${tier} 闪白透明度越界`);
    assert.ok(variant.hitFlash.radius >= 1, `${tier} 闪白半径不得小于本体`);
    assert.equal(typeof variant.deathShatter.enabled, 'boolean');
    assert.equal(variant.deathShatter.source, 'effects', `${tier} 死亡碎裂必须委托特效池`);
    assert.equal(variant.deathShatter.event, 'kill');
    assert.ok(variant.deathShatter.duration > 0 && variant.deathShatter.maxParticles > 0);
  }

  // 敌人表里的每个体型都必须有行走配置；未知体型回退 blob。
  for (const [id, def] of Object.entries(ENEMIES)) {
    const profile = ENEMY_WALK_PROFILES[def.shape];
    assert.ok(profile, `${id} 的体型 ${def.shape} 缺少行走配置`);
    assert.ok(profile.bob > 0, `${def.shape}.bob 必须为正`);
    assert.ok(profile.stride >= 0 && profile.lean >= 0, `${def.shape} 摆幅不得为负`);
  }
  assert.equal(enemyWalkProfile('mystery'), ENEMY_WALK_PROFILES.blob);

  for (const name of ['recoil', 'upgradePulse']) {
    const entry = TOWER_ANIMATIONS[name];
    assert.ok(entry, `塔缺少动画配置：${name}`);
    assert.equal(typeof entry.key, 'boolean', `${name}.key 必须显式声明`);
  }
  for (const tier of TIERS) {
    const variant = TOWER_ANIM_VARIANTS[tier];
    assert.ok(variant, `塔缺少 ${tier} 档视图`);
    assert.equal(variant.tier, tier);
    assert.equal(typeof variant.recoil.enabled, 'boolean');
    assert.ok(variant.recoil.duration > 0, `${tier} 后坐时长必须为正`);
    assert.ok(variant.recoil.distance >= 0 && variant.recoil.barrel >= 0, `${tier} 后坐位移不得为负`);
    assert.equal(typeof variant.upgradePulse.enabled, 'boolean');
    assert.ok(variant.upgradePulse.baseRadius > 0, `${tier} 脉冲基础半径必须为正`);
    assert.ok(variant.upgradePulse.grow >= 0 && variant.upgradePulse.alpha > 0);
  }

  // 塔表里的每个塔型都有后坐系数，支援塔为 0（不后坐）。
  for (const type of Object.keys(TOWERS)) {
    const scale = TOWER_RECOIL_SCALE[type];
    assert.ok(Number.isFinite(scale) && scale >= 0, `${type} 缺少后坐系数`);
  }
  assert.equal(TOWER_RECOIL_SCALE.banner, 0, '支援塔不应后坐');
  assert.equal(towerAnimVariant('mystery'), TOWER_ANIM_VARIANTS.light);
});

test('三档预算：低配关闭非关键动画，关键反馈保留', () => {
  const off = ENEMY_ANIM_VARIANTS.off;
  const light = ENEMY_ANIM_VARIANTS.light;
  const full = ENEMY_ANIM_VARIANTS.full;

  assert.equal(off.walk.enabled, false, '关闭档不绘制行走摆动');
  assert.equal(off.hitFlash.enabled, false, '关闭档不绘制受击闪白');
  assert.equal(off.deathShatter.enabled, false);

  assert.equal(light.walk.enabled, false, '低配关闭非关键行走摆动');
  assert.equal(light.hitFlash.enabled, true, '低配保留受击闪白');
  assert.equal(light.deathShatter.enabled, false, '低配关闭非关键死亡碎裂');

  assert.equal(full.walk.enabled, true);
  assert.equal(full.hitFlash.enabled, true);
  assert.equal(full.deathShatter.enabled, true);
  assert.ok(full.hitFlash.alpha > light.hitFlash.alpha, '高配闪白应更明显');

  assert.equal(TOWER_ANIM_VARIANTS.off.recoil.enabled, false);
  assert.equal(TOWER_ANIM_VARIANTS.light.recoil.enabled, true, '低配保留开火后坐');
  assert.equal(TOWER_ANIM_VARIANTS.light.upgradePulse.enabled, false, '低配关闭升级脉冲');
  assert.equal(TOWER_ANIM_VARIANTS.full.upgradePulse.enabled, true);
  assert.ok(
    TOWER_ANIM_VARIANTS.full.recoil.barrel > TOWER_ANIM_VARIANTS.light.recoil.barrel,
    '高配追加炮管回缩'
  );
});

test('受击闪白只在 0.08s 窗口内可见', () => {
  const variant = ENEMY_ANIM_VARIANTS.light;
  assert.equal(hitFlashAlpha(1, variant), 1);
  assert.ok(hitFlashAlpha(0.9, variant) > 0, '窗口内应可见');
  assert.ok(hitFlashAlpha(0.7, variant) > 0, '0.075s 仍应可见');
  assert.equal(hitFlashAlpha(0.65, variant), 0, '0.08s 之后不再闪白');
  assert.equal(hitFlashAlpha(0, variant), 0);
  assert.equal(hitFlashAlpha(1, ENEMY_ANIM_VARIANTS.off), 0, '关闭档不闪白');
});

test('动画视图是模块级冻结对象，渲染循环查表不新建对象', () => {
  for (const tier of TIERS) {
    assert.ok(Object.isFrozen(ENEMY_ANIM_VARIANTS[tier]), `敌人 ${tier} 视图未冻结`);
    assert.ok(Object.isFrozen(ENEMY_ANIM_VARIANTS[tier].walk));
    assert.ok(Object.isFrozen(TOWER_ANIM_VARIANTS[tier]), `塔 ${tier} 视图未冻结`);
  }
  assert.ok(Object.isFrozen(ENEMY_WALK_PROFILES) && Object.isFrozen(ENEMY_WALK_PROFILES.bug));
  assert.equal(enemyAnimVariant('full'), ENEMY_ANIM_VARIANTS.full);
  assert.equal(towerAnimVariant('full'), TOWER_ANIM_VARIANTS.full);
  assert.equal(enemyWalkProfile('bug'), ENEMY_WALK_PROFILES.bug);
  assert.equal(enemyWalkProfile('bug'), enemyWalkProfile('bug'));
});

test('死亡碎裂复用现有粒子池预算', () => {
  const shatter = ENEMY_ANIM_VARIANTS.full.deathShatter;
  assert.equal(shatter.source, 'effects');
  assert.equal(shatter.event, 'kill');
  assert.equal(shatter.duration, EFFECT_EVENTS.kill.duration, '碎裂时长必须与现有 kill 特效一致');
  assert.ok(shatter.maxParticles <= EFFECT_EVENTS.bossKill.particles, '不得超过高配特效粒子上限');
});

test('渲染循环高配比低配多绘制动画，且不写回模拟状态', () => {
  const game = makeGame();
  const before = JSON.stringify(game);
  const renderer = new EnemyRenderer(game, { glow: makeGlow() });

  const low = makeCtx();
  renderer.render(low, 1.25, QUALITY_PRESETS.low);
  const high = makeCtx();
  renderer.render(high, 1.25, QUALITY_PRESETS.high);

  assert.ok(
    high.calls.rotate > low.calls.rotate,
    `高配旋转 ${high.calls.rotate} 应多于低配 ${low.calls.rotate}`
  );
  assert.ok(high.calls.arc >= low.calls.arc, '高配不应少画基础形体');

  const towers = new TowerRenderer(game, { glow: makeGlow() });
  const towerLow = makeCtx();
  towers.render(towerLow, 1.25, QUALITY_PRESETS.low);
  const towerHigh = makeCtx();
  towers.render(towerHigh, 1.25, QUALITY_PRESETS.high);
  assert.ok(towerHigh.calls.arc > towerLow.calls.arc, '高配升级脉冲应增加绘制');
  assert.ok(towerHigh.calls.translate >= towerLow.calls.translate, '后坐不应减少变换次数');

  assert.equal(JSON.stringify(game), before, '渲染不得写回敌人/塔/模拟状态');
});

test('动画只读渲染时间，不引入素材或第三方依赖', () => {
  for (const src of [ENEMY_SRC, TOWER_SRC]) {
    assert.doesNotMatch(src, /\.(png|jpe?g|webp|gif|svg)['"]/i, '不得引用素材文件');
    assert.doesNotMatch(src, /\bnew Image\b/, '不得加载外部图片');
    const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
    assert.ok(imports.length > 0);
    for (const spec of imports) {
      assert.match(spec, /^\.\.?\//, `引入了非相对依赖：${spec}`);
    }
  }
  assert.doesNotMatch(ENEMY_SRC, /enemy\.\w+\s*=(?!=)/, '敌人渲染不得写回实体字段');
  assert.doesNotMatch(TOWER_SRC, /tower\.\w+\s*=(?!=)/, '塔渲染不得写回实体字段');
});

test('后坐与升级脉冲的换算保持确定', () => {
  const full = TOWER_ANIM_VARIANTS.full;
  assert.equal(towerRecoilAmount(0, 'cannon', full), 0);
  assert.ok(towerRecoilAmount(1, 'cannon', full) > towerRecoilAmount(1, 'arrow', full));
  assert.equal(towerRecoilAmount(1, 'banner', full), 0, '支援塔不后坐');
  assert.equal(towerRecoilAmount(1, 'arrow', TOWER_ANIM_VARIANTS.off), 0);
  assert.equal(towerUpgradePulse(0, 1.2, full), 0, '未升级的塔不出现脉冲');
  assert.equal(towerUpgradePulse(2, 1.2, TOWER_ANIM_VARIANTS.light), 0, '低配不出现脉冲');
  const a = towerUpgradePulse(2, 1.2, full, 0.3);
  const b = towerUpgradePulse(2, 1.2, full, 0.3);
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1);
});

function makeCtx() {
  const calls = {
    save: 0,
    arc: 0,
    rotate: 0,
    translate: 0,
    drawImage: 0,
    setLineDash: 0,
  };
  const ctx = {
    calls,
    save() { calls.save++; },
    restore() {},
    beginPath() {},
    closePath() {},
    arc() { calls.arc++; },
    ellipse() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    stroke() {},
    fill() {},
    translate() { calls.translate++; },
    rotate() { calls.rotate++; },
    scale() {},
    setLineDash(list) { calls.setLineDash += Array.isArray(list) ? list.length : 0; },
    fillRect() {},
    strokeRect() {},
    drawImage() { calls.drawImage++; },
    fillText() {},
    strokeText() {},
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
  return new GlowRenderer({ createSprite: (color) => ({ color }), capacity: 24 });
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
    level: (i % 3),
    angle: i * 0.4,
    recoil: i % 2,
    evolution: null,
    disabledUntil: 0,
  }));
  return { enemies, towers, time: 2, selectedTower: null };
}

function runSim(settings) {
  const seed = 'render-animations-determinism';
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
  sim.setVisualQuality({ effects: settings.decorations, floaters: settings.floaters });
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
  const low = runSim(QUALITY_PRESETS.low);
  const high = runSim(QUALITY_PRESETS.high);
  const hash = (json) => createHash('sha256').update(json).digest('hex');
  assert.equal(hash(low), hash(high));
});
