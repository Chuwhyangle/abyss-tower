// 命中类别层（AC-030 / GOAL-005）：首领命中 / 破盾 / 护甲吸收三类由事件纯推导，
// 各有独立可辨识的飘字层与特效形态，消费端只读事件、不改变模拟。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IMPACT_CLASSES,
  IMPACT_CLASS_NAMES,
  classFloaterText,
  classParticleTotal,
  classVfxSpec,
  classifyImpactClasses,
} from '../public/js/shared/impact-class-feedback.js';
import { FLOATER_LAYERS, planFloaterFrame } from '../public/js/shared/floaters.js';
import { IMPACT_EVENT_LIMIT, makeImpactEvent, pushImpactEvent } from '../public/js/shared/impact-events.js';
import { EFFECT_EVENTS, EFFECT_PROFILES, classifyEffect } from '../public/js/render/effect-renderer.js';
import { ImpactFeedbackConsumer } from '../public/js/game-app.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { RELIC_BY_ID } from '../public/js/shared/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const CLASSES = ['armor', 'bossHit', 'shieldBreak'];
const BASE_LAYERS = ['damage', 'crit', 'reward', 'heal', 'penalty', 'status'];

// 事件工厂：字段形状与 shared/impact-events.js 的 makeImpactEvent 一致。
function impact(overrides = {}) {
  return makeImpactEvent({ x: 3, y: 4, target: { id: 1, type: 'grunt' }, hpLost: 10, ...overrides });
}

function makeSim({ seed = 'impact-class-seed', relicIds = [], skill = null } = {}) {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 50,
    maxBaseHp: 50,
    relics: relicIds.map((id) => ({ id, level: 1, ...RELIC_BY_ID[id] })),
    skill,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onToast: () => {},
  });
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(
    enemy,
    { hp: 100000, maxHp: 100000, armor: 0, shield: 0, boss: false, dead: false, slowUntil: 0, poisonUntil: 0 },
    overrides
  );
  return enemy;
}

const lastEvent = (sim) => sim.impactEvents[sim.impactEvents.length - 1];

// ---------- 分类器判据 ----------

test('首领命中：target.type 与 target.boss 两条输入都返回 bossHit', () => {
  assert.deepEqual(classifyImpactClasses(impact({ target: { id: 9, type: 'boss' } })), ['bossHit']);
  // 手工构造的事件可能直接带 boss 标记（makeImpactEvent 不产出该字段，分类器仍须兼容）。
  assert.deepEqual(
    classifyImpactClasses({ x: 1, y: 1, target: { id: 9, type: 'armored', boss: true }, hpLost: 10 }),
    ['bossHit']
  );
  // 普通敌人不受影响。
  assert.deepEqual(classifyImpactClasses(impact({ target: { id: 9, type: 'tank' } })), []);
});

test('破盾判据：打穿盾才算，纯吸收不算', () => {
  const pierced = impact({ shieldAbsorbed: 40, hpLost: 12 });
  assert.ok(classifyImpactClasses(pierced).includes('shieldBreak'));
  const pureAbsorb = impact({ shieldAbsorbed: 40, hpLost: 0 });
  assert.ok(!classifyImpactClasses(pureAbsorb).includes('shieldBreak'), '盾未破不得触发破盾层');
  assert.deepEqual(classifyImpactClasses(pureAbsorb), []);
});

test('护甲判据：armorAbsorbed > 0 返回 armor，忽略护甲时为零不触发', () => {
  assert.deepEqual(classifyImpactClasses(impact({ armorAbsorbed: 7, hpLost: 13 })), ['armor']);
  assert.deepEqual(classifyImpactClasses(impact({ armorAbsorbed: 0, hpLost: 20 })), []);
});

test('非法输入返回空数组且不抛错', () => {
  for (const value of [undefined, null, 0, '', 'event', [], {}]) {
    assert.doesNotThrow(() => classifyImpactClasses(value));
    assert.deepEqual(classifyImpactClasses(value), []);
  }
  // 字段缺失/非数字同样安全。
  assert.deepEqual(classifyImpactClasses({ target: {} }), []);
  assert.deepEqual(classifyImpactClasses({ shieldAbsorbed: NaN, hpLost: NaN }), []);
});

test('多重命中：首领带盾一击穿透同时返回两类，顺序按 priority 稳定', () => {
  const event = impact({ target: { id: 5, type: 'boss' }, shieldAbsorbed: 30, hpLost: 20, armorAbsorbed: 5 });
  assert.deepEqual(classifyImpactClasses(event), ['shieldBreak', 'bossHit', 'armor']);
  // 同一输入重复调用顺序不变（不依赖对象键序）。
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(classifyImpactClasses(event), ['shieldBreak', 'bossHit', 'armor']);
  }
  assert.deepEqual(
    [...IMPACT_CLASS_NAMES],
    CLASSES.slice().sort((a, b) => IMPACT_CLASSES[a].priority - IMPACT_CLASSES[b].priority)
  );
});

// ---------- 文案 ----------

test('文案冻结：首领命中取实际扣血、破盾带前缀、护甲带后缀，数值取整', () => {
  assert.equal(classFloaterText(impact({ target: { id: 1, type: 'boss' }, hpLost: 87.6 }), 'bossHit'), '-88');
  // 盾完全吸收时退回吸收量，避免飘出「-0」。
  assert.equal(classFloaterText(impact({ target: { id: 1, type: 'boss' }, shieldAbsorbed: 42, hpLost: 0 }), 'bossHit'), '-42');
  assert.equal(classFloaterText(impact({ shieldAbsorbed: 60.4, hpLost: 3 }), 'shieldBreak'), '破盾 -60');
  assert.equal(classFloaterText(impact({ armorAbsorbed: 7.2 }), 'armor'), '-7 甲');
  // 后缀与类别表一致（破盾为前缀、护甲为后缀，首领命中无后缀）。
  assert.equal(IMPACT_CLASSES.shieldBreak.floater.suffix, '破盾');
  assert.equal(IMPACT_CLASSES.armor.floater.suffix, '甲');
  assert.equal(IMPACT_CLASSES.bossHit.floater.suffix, '');
  assert.ok(classFloaterText(impact({ shieldAbsorbed: 12, hpLost: 3 }), 'shieldBreak').includes(
    IMPACT_CLASSES.shieldBreak.floater.suffix
  ));
  assert.ok(classFloaterText(impact({ armorAbsorbed: 9 }), 'armor').endsWith(IMPACT_CLASSES.armor.floater.suffix));
  // 未知类别 / 非法事件不产出文案。
  assert.equal(classFloaterText(impact(), 'mystery'), null);
  assert.equal(classFloaterText(null, 'armor'), null);
});

// ---------- 可辨识性 ----------

test('三类之间：色、后缀、z 两两不同', () => {
  for (const field of ['color', 'suffix', 'z']) {
    const values = CLASSES.map((cls) => IMPACT_CLASSES[cls].floater[field]);
    assert.equal(new Set(values).size, values.length, `类别层的 floater.${field} 必须两两不同`);
  }
  // 特效形态也两两不同（撞成同一形状会读成同一类）。
  const shapes = CLASSES.map((cls) => IMPACT_CLASSES[cls].vfx.shape);
  assert.equal(new Set(shapes).size, shapes.length);
});

test('类别层与既有六层：z、颜色、字号全部不同', () => {
  for (const cls of CLASSES) {
    const layer = IMPACT_CLASSES[cls].floater;
    assert.ok(FLOATER_LAYERS[layer.layer], `FLOATER_LAYERS 缺少类别层 ${layer.layer}`);
    assert.equal(FLOATER_LAYERS[layer.layer].z, layer.z);
    assert.equal(FLOATER_LAYERS[layer.layer].color, layer.color);
    assert.equal(FLOATER_LAYERS[layer.layer].size, layer.size);
    for (const base of BASE_LAYERS) {
      const existing = FLOATER_LAYERS[base];
      assert.notEqual(layer.z, existing.z, `${layer.layer}.z 与 ${base} 撞车`);
      assert.notEqual(layer.color, existing.color, `${layer.layer}.color 与 ${base} 撞车`);
      assert.notEqual(layer.size, existing.size, `${layer.layer}.size 与 ${base} 撞车`);
    }
  }
});

test('层序：九层 z 两两不同，类别层位于 penalty 之上、crit 之下', () => {
  const names = Object.keys(FLOATER_LAYERS);
  assert.equal(names.length, 9);
  const zs = names.map((name) => FLOATER_LAYERS[name].z);
  assert.equal(new Set(zs).size, zs.length, '九层 z 必须两两不同');
  for (const cls of CLASSES) {
    const z = FLOATER_LAYERS[IMPACT_CLASSES[cls].floater.layer].z;
    assert.ok(z > FLOATER_LAYERS.penalty.z, '类别层应压在惩罚层之上');
    assert.ok(z < FLOATER_LAYERS.crit.z, '类别层不得盖过暴击层');
  }
});

test('帧预算重要性：预算不足时先丢普通伤害，类别层全部保留', () => {
  const floaters = [];
  for (let i = 0; i < 20; i += 1) {
    floaters.push({
      x: i * 2,
      y: 5,
      text: String(20 + i),
      color: FLOATER_LAYERS.damage.color,
      layer: 'damage',
      ttl: 0.6,
      maxTtl: 0.6,
    });
  }
  for (const cls of CLASSES) {
    floaters.push({
      x: 1,
      y: 1,
      text: classFloaterText(impact({ armorAbsorbed: 3, shieldAbsorbed: 4, hpLost: 2, target: { id: 2, type: 'boss' } }), cls),
      color: IMPACT_CLASSES[cls].floater.color,
      layer: IMPACT_CLASSES[cls].floater.layer,
      key: true,
      ttl: 0.6,
      maxTtl: 0.6,
    });
  }
  const { draw } = planFloaterFrame(floaters, { mode: 'all', budget: 3 });
  assert.deepEqual(
    draw.map((item) => item.layer),
    ['armor', 'bossHit', 'shield'],
    '预算只够 3 条时应按重要性保留三个类别层，并按 z 升序绘制'
  );
});

// ---------- 档位与粒子预算 ----------

test('档位降级：低档粒子 ≥1 且少于高档，三类同帧合计不超池预算', () => {
  for (const cls of CLASSES) {
    const low = classVfxSpec(cls, EFFECT_PROFILES.low);
    const high = classVfxSpec(cls, EFFECT_PROFILES.high);
    assert.ok(low.particles >= 1, `${cls} 低档粒子必须 ≥ 1`);
    assert.ok(low.particles < high.particles, `${cls} 低档粒子应少于高档`);
    assert.equal(high.particles, IMPACT_CLASSES[cls].vfx.particles);
    // 保底层与档位无关：核心闪白 + 类别色环。
    assert.equal(low.degrade.core, '#ffffff');
    assert.equal(low.degrade.ring, true);
    assert.equal(low.color, high.color);
  }
  for (const tier of ['low', 'high']) {
    const profile = EFFECT_PROFILES[tier];
    assert.ok(
      classParticleTotal(profile) <= profile.poolBudget,
      `${tier} 档三类合计粒子 ${classParticleTotal(profile)} 超过池预算 ${profile.poolBudget}`
    );
  }
});

test('未知类别返回 null，不抛错；缺档位参数按高配原值', () => {
  assert.equal(classVfxSpec('mystery', EFFECT_PROFILES.low), null);
  assert.equal(classVfxSpec(undefined, EFFECT_PROFILES.high), null);
  const fallback = classVfxSpec('armor', undefined);
  assert.equal(fallback.particles, IMPACT_CLASSES.armor.vfx.particles);
  assert.doesNotThrow(() => classVfxSpec('armor', null));
});

// ---------- 消费端接线（源码断言） ----------

test('接线：消费者引用类别表，层模型与特效表都含三个类别键', () => {
  const app = read('public/js/game-app.js');
  assert.match(app, /classifyImpactClasses\(/, 'game-app 必须调用分类器');
  assert.match(app, /IMPACT_CLASSES/, 'game-app 必须读取类别表');
  assert.match(app, /class ImpactFeedbackConsumer/, '消费者类必须导出在页面编排层');
  assert.match(app, /impactFeedback\.consume\(/, '消费者必须挂在逐帧 tick 上');

  const floaters = read('public/js/shared/floaters.js');
  for (const layer of ['shield', 'armor', 'bossHit']) {
    assert.match(floaters, new RegExp(`\\b${layer}:`), `FLOATER_LAYERS 缺少 ${layer}`);
  }

  for (const event of ['bossHit', 'shieldBreak', 'armorAbsorb']) {
    assert.ok(EFFECT_EVENTS[event], `EFFECT_EVENTS 缺少 ${event}`);
    assert.ok(EFFECT_EVENTS[event].particles >= 1);
  }
  // 渲染分支按 kind 可达：类别名与事件键都归到事件表里的三个条目。
  assert.equal(classifyEffect({ kind: 'bossHit' }), 'bossHit');
  assert.equal(classifyEffect({ kind: 'shieldBreak' }), 'shieldBreak');
  assert.equal(classifyEffect({ kind: 'armor' }), 'armorAbsorb');
  assert.equal(classifyEffect({ kind: 'armorAbsorb' }), 'armorAbsorb');
  const renderer = read('public/js/render/effect-renderer.js');
  for (const event of ['bossHit', 'shieldBreak', 'armorAbsorb']) {
    assert.ok(renderer.includes(`event === '${event}'`), `渲染分支未按 ${event} 分流`);
  }
  assert.match(renderer, /classDrawn\[/, '类别特效需要可读取的绘制计数');
});

test('shared/impact-class-feedback.js 无随机源、不依赖 sim/render/DOM', () => {
  const source = read('public/js/shared/impact-class-feedback.js');
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /from\s+['"][^'"]*\/(?:sim|render)(?:[.\/'"])/, '不得 import 模拟或渲染层');
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|\bglobalThis\./, '不得触碰 DOM/全局对象');
});

// ---------- 消费端去重 ----------

test('消费端：同一批事件喂两次，第二次不产出任何类别表现', () => {
  const sim = makeSim();
  const consumer = new ImpactFeedbackConsumer(sim);
  const events = [
    impact({ target: { id: 1, type: 'boss' }, hpLost: 30 }),
    impact({ shieldAbsorbed: 25, hpLost: 8 }),
    impact({ armorAbsorbed: 6, hpLost: 9 }),
  ];
  sim.impactEvents.push(...events);

  const first = consumer.consume(sim.impactEvents);
  assert.ok(first >= 3, `首次应产出类别表现，实际 ${first}`);
  const floaters = sim.floaters.length;
  const effects = sim.effects.length;
  assert.ok(floaters >= 3, '三类各一条类别飘字');
  assert.ok(effects >= 3, '三类各一条类别特效');
  assert.deepEqual(sim.floaters.map((floater) => floater.layer).sort(), ['armor', 'bossHit', 'shield']);
  assert.deepEqual(sim.effects.map((effect) => effect.kind).sort(), ['armorAbsorb', 'bossHit', 'shieldBreak']);

  const second = consumer.consume(sim.impactEvents);
  assert.equal(second, 0, '第二次消费必须返回 0');
  assert.equal(sim.floaters.length, floaters, '第二次不得新增飘字');
  assert.equal(sim.effects.length, effects, '第二次不得新增特效');
});

test('消费端：环形缓冲裁掉旧事件后不抛错、不重复，也不重复消费同批', () => {
  const sim = makeSim();
  const consumer = new ImpactFeedbackConsumer(sim);
  for (let i = 0; i < IMPACT_EVENT_LIMIT + 20; i += 1) {
    pushImpactEvent(sim, { x: 1, y: 1, target: { id: i, type: 'boss' }, hpLost: 5 });
  }
  const firstPass = consumer.consume(sim.impactEvents);
  assert.ok(firstPass > 0);
  assert.doesNotThrow(() => consumer.consume(sim.impactEvents));
  assert.equal(consumer.consume(sim.impactEvents), 0);
  // 数组被整体替换成同一批引用（旧窗口整体重放）时仍按对象身份去重。
  const replay = [...sim.impactEvents];
  assert.equal(consumer.consume(replay), 0);
  // 追加新事件后只消费新的那一条。
  pushImpactEvent(sim, { x: 2, y: 2, target: { id: 999, type: 'boss' }, hpLost: 7 });
  assert.equal(consumer.consume(sim.impactEvents), 1);
});

test('消费端：非事件输入安全；档位关闭时不产出对象但消费游标照常前进', () => {
  const sim = makeSim();
  const consumer = new ImpactFeedbackConsumer(sim);
  assert.equal(consumer.consume(undefined), 0);
  assert.equal(consumer.consume([null, 0, 'x']), 0);

  sim.setVisualQuality({ effects: 'off', floaters: 'off' });
  sim.impactEvents.push(impact({ target: { id: 1, type: 'boss' }, hpLost: 20 }));
  assert.equal(consumer.consume(sim.impactEvents), 1, '类别判定与档位无关');
  assert.equal(sim.floaters.length, 0, '飘字 off 档不生成');
  assert.equal(sim.effects.length, 0, '特效 off 档不生成类别特效');
});

// ---------- 真实对局可制造三类事件 ----------

test('真实伤害管线：首领命中 / 破盾 / 护甲吸收各自可复现且分类一致', () => {
  const sim = makeSim();

  // 首领命中：spawnEnemy('boss') 的 type 就是 'boss'；首领自带护甲，故同时带护甲层。
  sim.spawnEnemy('boss');
  const boss = sim.enemies[sim.enemies.length - 1];
  sim.dealDamage(boss, 40, 'arrow');
  const bossHit = lastEvent(sim);
  assert.equal(bossHit.target.type, 'boss');
  assert.ok(classifyImpactClasses(bossHit).includes('bossHit'));
  assert.ok(bossHit.armorAbsorbed > 0);
  assert.equal(classFloaterText(bossHit, 'bossHit'), `-${Math.round(bossHit.hpLost)}`);

  // 破盾：石盾一击打穿护盾（余量落到本体）才算破盾；小伤害只是纯吸收。
  sim.spawnEnemy('shielder');
  const shielder = sim.enemies[sim.enemies.length - 1];
  sim.dealDamage(shielder, 10, 'arrow');
  const absorbed = lastEvent(sim);
  assert.ok(absorbed.shieldAbsorbed > 0);
  assert.equal(absorbed.hpLost, 0);
  assert.ok(!classifyImpactClasses(absorbed).includes('shieldBreak'), '盾未破时不得报破盾');
  sim.dealDamage(shielder, 90, 'arrow');
  const broken = lastEvent(sim);
  assert.ok(broken.shieldAbsorbed > 0 && broken.hpLost > 0);
  assert.ok(classifyImpactClasses(broken).includes('shieldBreak'));
  assert.equal(classFloaterText(broken, 'shieldBreak'), `破盾 -${Math.round(broken.shieldAbsorbed)}`);

  // 护甲吸收：普通怪加护甲即可复现。
  const armored = addEnemy(sim, { armor: 7 });
  sim.dealDamage(armored, 20, 'arrow');
  const armorEvent = lastEvent(sim);
  assert.equal(armorEvent.armorAbsorbed, 7);
  assert.deepEqual(classifyImpactClasses(armorEvent), ['armor']);
  assert.equal(classFloaterText(armorEvent, 'armor'), '-7 甲');
});

// ---------- 表现零接触模拟 ----------

// 同一 seed 的整局：build → 两波 → 对比快照与事件流；attach 决定是否挂类别消费端。
function playTwin(attach) {
  const sim = makeSim({ seed: 'impact-class-determinism', relicIds: ['crit'] });
  const map = sim.map;
  const consumer = attach ? new ImpactFeedbackConsumer(sim) : null;
  const cells = [];
  for (let r = 0; r < map.rows; r += 1) {
    for (let c = 0; c < map.cols; c += 1) {
      if (sim.canBuild(c, r)) cells.push([c, r]);
    }
  }
  const types = ['arrow', 'cannon', 'frost', 'arc'];
  for (let i = 0; i < Math.min(types.length, cells.length); i += 1) {
    sim.placeTower(types[i], cells[i][0], cells[i][1]);
  }

  const waveOptions = { portalCount: map.meta?.portalCount || 1, modifier: map.meta?.modifier || null };
  let produced = 0;
  for (let wave = 1; wave <= 2; wave += 1) {
    const def = generateWave(sim.seed, wave, 'standard', waveOptions, { endless: false });
    assert.equal(sim.beginWave(def), true, `第 ${wave} 波应可开始`);
    // 保证三类事件在整局里真实产生：首领（bossHit）、石盾（shieldBreak）、加甲普通怪（armor）。
    // 施加次序与步数在两个对照组里完全相同，差值只可能来自类别消费端本身。
    sim.spawnEnemy('boss');
    const boss = sim.enemies[sim.enemies.length - 1];
    sim.spawnEnemy('shielder');
    const shielder = sim.enemies[sim.enemies.length - 1];
    sim.spawnEnemy('grunt');
    const armored = sim.enemies[sim.enemies.length - 1];
    armored.armor = 8;

    const steps = 30 * 90;
    for (let step = 1; step <= steps && sim.phase === 'wave'; step += 1) {
      sim.update(1 / 30);
      if (consumer) produced += consumer.consume(sim.impactEvents);
      sim.updateVisuals(1 / 30);
      // 每 30 步各敲一下，让三类事件在整局中持续出现（不依赖塔的射程覆盖）。
      if (step % 30 === 0) {
        sim.dealDamage(boss, 45, 'arrow');
        sim.dealDamage(shielder, 45, 'arrow');
        sim.dealDamage(armored, 25, 'arrow');
      }
    }
  }

  return {
    state: JSON.stringify({
      gold: sim.gold,
      baseHp: sim.baseHp,
      kills: sim.kills,
      wave: sim.wave,
      clearedWave: sim.clearedWave,
      enemies: sim.enemies.map((enemy) => [enemy.id, enemy.type, enemy.x, enemy.y, enemy.hp, enemy.shield]),
    }),
    events: JSON.stringify(sim.impactEvents),
    eventCount: sim.impactEvents.length,
    produced,
  };
}

test('同一 seed：挂载 / 不挂载类别消费端，模拟状态与事件流逐字节一致', () => {
  const attached = playTwin(true);
  const plain = playTwin(false);

  assert.ok(attached.eventCount > 0, '整局应产出命中事件');
  assert.ok(attached.produced > 0, '整局应至少产出一次类别表现');
  assert.equal(plain.produced, 0);
  assert.equal(attached.state, plain.state, '模拟结算必须逐字节一致');
  assert.equal(attached.events, plain.events, '事件流必须逐字节一致');
});
