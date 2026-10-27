// 结构化命中事件：每次伤害产出事件，反馈开关不改变模拟与 RNG（AC-012 / GOAL-005）。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { RELIC_BY_ID } from '../public/js/shared/data.js';
import {
  IMPACT_EVENT_LIMIT,
  makeImpactEvent,
  pushImpactEvent,
} from '../public/js/shared/impact-events.js';

const EPS = 1e-9;
const ALMOST = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${message || ''} 期望 ${expected}，实际 ${actual}`
  );

function makeSim({ seed = 'impact-events-seed', relicIds = [], skill = null } = {}) {
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
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
  return { sim, map };
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 1, 1, level, 0);
  sim.towers.push(tower);
  return tower;
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(
    enemy,
    {
      hp: 100000,
      maxHp: 100000,
      armor: 0,
      shield: 0,
      boss: false,
      dead: false,
      slowUntil: 0,
      poisonUntil: 0,
      burnUntil: 0,
      burnDps: 0,
    },
    overrides
  );
  return enemy;
}

const lastEvent = (sim) => sim.impactEvents[sim.impactEvents.length - 1];

test('塔命中：事件带 weapon/source/towerId/位置/目标，数值可还原', () => {
  const { sim } = makeSim();
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  sim.dealDamage(enemy, 20, tower.type, { tower });

  assert.equal(sim.impactEvents.length, 1);
  const event = lastEvent(sim);
  assert.equal(event.weapon, 'arrow');
  assert.equal(event.source, 'tower');
  assert.equal(event.towerId, tower.id);
  assert.equal(event.crit, false);
  assert.equal(event.lethal, false);
  assert.equal(event.armorAbsorbed, 0);
  assert.equal(event.shieldAbsorbed, 0);
  ALMOST(event.amount, 20, '原始伤害');
  ALMOST(event.hpLost, 20, '扣血');
  ALMOST(event.t, sim.time, '事件时间');
  ALMOST(event.x, enemy.x, '事件 x');
  ALMOST(event.y, enemy.y, '事件 y');
  assert.equal(event.target.id, enemy.id);
  assert.equal(event.target.type, 'grunt');
});

test('暴击：crit 标记为 true，hpLost 为翻倍后的伤害', () => {
  const { sim } = makeSim({ relicIds: ['crit'] });
  sim.combatRng = { float: () => 0 }; // 必定暴击
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  sim.dealDamage(enemy, 20, tower.type, { tower });

  const event = lastEvent(sim);
  assert.equal(event.crit, true);
  ALMOST(event.hpLost, 40, '暴击伤害');
});

test('护甲吸收：armorAbsorbed 与 hpLost 之和等于护甲前伤害', () => {
  const { sim } = makeSim();
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim, { armor: 7 });
  sim.dealDamage(enemy, 20, tower.type, { tower });

  const event = lastEvent(sim);
  ALMOST(event.armorAbsorbed, 7, '护甲吸收');
  ALMOST(event.hpLost, 13, '扣血');
  ALMOST(event.amount, 20, '原始伤害');
});

test('护盾吸收：未破盾时 hpLost 为 0，shieldAbsorbed 记录吸收量', () => {
  const { sim } = makeSim();
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim, { shield: 100 });
  const hpBefore = enemy.hp;
  sim.dealDamage(enemy, 20, tower.type, { tower });

  const event = lastEvent(sim);
  assert.equal(event.hpLost, 0);
  ALMOST(event.shieldAbsorbed, 20, '护盾吸收');
  ALMOST(enemy.hp, hpBefore, '本体未掉血');
  ALMOST(enemy.shield, 80, '护盾剩余');
});

test('致死：lethal 为 true 且目标进入 dead', () => {
  const { sim } = makeSim();
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim, { hp: 5, maxHp: 5 });
  sim.dealDamage(enemy, 20, tower.type, { tower });

  const event = lastEvent(sim);
  assert.equal(event.lethal, true);
  assert.equal(enemy.dead, true);
  ALMOST(event.hpLost, 20, '致死过杀一并记录');
});

test('溅射：每个被波及的目标各一条事件', () => {
  const { sim } = makeSim();
  const tower = addTower(sim, 'cannon');
  const first = addEnemy(sim);
  const second = addEnemy(sim);
  Object.assign(first, { x: 5, y: 5, r: 0.3 });
  Object.assign(second, { x: 5.6, y: 5.2, r: 0.3 });

  sim.impact({ x: 5.1, y: 5.1, dmg: 10, towerType: 'cannon', tower, splash: 2 });

  assert.equal(sim.impactEvents.length, 2);
  for (const event of sim.impactEvents) {
    assert.equal(event.weapon, 'cannon');
    assert.equal(event.source, 'tower');
    assert.equal(event.towerId, tower.id);
    assert.equal(event.crit, false);
    ALMOST(event.hpLost, 10, '溅射伤害');
  }
  assert.deepEqual(
    sim.impactEvents.map((event) => event.target.id),
    [first.id, second.id],
    '溅射按其结算顺序各记一条'
  );
});

test('连锁电弧：每一跳各一条事件，weapon 为 arc 且无视护甲', () => {
  const { sim } = makeSim();
  const tower = addTower(sim, 'arc');
  const enemies = [addEnemy(sim, { armor: 30 }), addEnemy(sim, { armor: 30 }), addEnemy(sim, { armor: 30 })];
  Object.assign(enemies[0], { x: 3, y: 3, r: 0.3 });
  Object.assign(enemies[1], { x: 3.6, y: 3, r: 0.3 });
  Object.assign(enemies[2], { x: 4.2, y: 3, r: 0.3 });

  const stats = sim.statsFor(tower);
  sim.fire(tower, stats, enemies[0]);

  assert.ok(sim.impactEvents.length >= 2, `电弧至少两跳，实际 ${sim.impactEvents.length}`);
  for (const event of sim.impactEvents) {
    assert.equal(event.weapon, 'arc');
    assert.equal(event.source, 'tower');
    assert.equal(event.towerId, tower.id);
    assert.equal(event.armorAbsorbed, 0, '电弧无视护甲');
    ALMOST(event.hpLost, stats.dmg, '电弧伤害');
  }
});

test('盟友攻击：source 为 ally、weapon 为盟友种类、towerId 为空', () => {
  const { sim } = makeSim();
  const enemy = addEnemy(sim);
  const ally = sim.spawnAlly({
    x: enemy.x,
    y: enemy.y,
    kind: 'skeleton',
    dmg: 9,
    range: 3,
    rate: 1,
    ttl: 10,
  });

  sim.updateAllies(1 / 30);

  assert.equal(sim.impactEvents.length, 1);
  const event = lastEvent(sim);
  assert.equal(event.source, 'ally');
  assert.equal(event.weapon, 'skeleton');
  assert.equal(event.towerId, null);
  assert.equal(event.crit, false);
  ALMOST(event.hpLost, 9, '盟友伤害');
  assert.ok(ally);
});

test('技能伤害：source 为 skill、weapon 为技能 id，护甲/护盾/暴击均为 0', () => {
  const { sim } = makeSim({ skill: { id: 'meteor', level: 1 } });
  const enemy = addEnemy(sim, { armor: 20, shield: 50 });
  sim.skillDamage(enemy, 30);

  const event = lastEvent(sim);
  assert.equal(event.source, 'skill');
  assert.equal(event.weapon, 'meteor');
  assert.equal(event.armorAbsorbed, 0);
  assert.equal(event.shieldAbsorbed, 0);
  assert.equal(event.crit, false);
  assert.equal(event.lethal, false);
  ALMOST(event.hpLost, 30, '技能伤害');
});

test('灼烧跳伤：source 为 burn 且按帧结算记录', () => {
  const { sim } = makeSim({ skill: { id: 'meteor', level: 1 } });
  const enemy = addEnemy(sim, { burnUntil: 10, burnDps: 20 });

  sim.updateEnemySkillStatus(enemy, 0.5, 0, false);

  const event = lastEvent(sim);
  assert.equal(event.source, 'burn');
  assert.equal(event.weapon, 'meteor');
  ALMOST(event.hpLost, 10, '灼烧跳伤 = dps × dt');
});

test('中毒跳伤：source 为 dot、weapon 为 poison 且无视护甲', () => {
  const { sim } = makeSim();
  const enemy = addEnemy(sim, { armor: 50, poisonUntil: 10, poisonDps: 10 });

  sim.updateEnemies(1 / 30);

  assert.equal(sim.impactEvents.length, 1);
  const event = lastEvent(sim);
  assert.equal(event.source, 'dot');
  assert.equal(event.weapon, 'poison');
  assert.equal(event.armorAbsorbed, 0, '毒伤无视护甲');
  ALMOST(event.hpLost, 10 / 30, '中毒跳伤 = dps × dt');
  assert.ok(Number.isFinite(event.x) && Number.isFinite(event.y), '事件位置有效');
});

test('反馈关闭时仍逐次产出事件（单次命中）', () => {
  const { sim } = makeSim();
  sim.setVisualQuality({ effects: 'off', floaters: 'off' });
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  sim.dealDamage(enemy, 20, tower.type, { tower });

  assert.equal(sim.impactEvents.length, 1);
  ALMOST(lastEvent(sim).hpLost, 20, '关闭反馈不为 silent/dot 所吞');
});

test('环形上限：超出 IMPACT_EVENT_LIMIT 时裁掉最旧事件', () => {
  const { sim } = makeSim();
  for (let i = 0; i < IMPACT_EVENT_LIMIT + 30; i++) {
    pushImpactEvent(sim, { t: i, target: { id: i, type: 'grunt' }, hpLost: 1 });
  }
  assert.equal(sim.impactEvents.length, IMPACT_EVENT_LIMIT);
  assert.equal(sim.impactEvents[0].target.id, 30, '最旧的 30 条被裁掉');
  assert.equal(sim.impactEvents[IMPACT_EVENT_LIMIT - 1].target.id, IMPACT_EVENT_LIMIT + 29);
});

test('makeImpactEvent 归一化缺失字段', () => {
  const event = makeImpactEvent({ weapon: 'arrow' });
  assert.equal(event.t, 0);
  assert.equal(event.x, 0);
  assert.equal(event.target.id, 0);
  assert.equal(event.target.type, '');
  assert.equal(event.towerId, null);
  assert.equal(event.source, 'tower');
  assert.equal(event.crit, false);
  assert.equal(event.lethal, false);
});

// 记录一整局的 combatRng.float() 序列：beginWave 会按波次重建 RNG，需要重新挂钩。
function traceCombatRng(sim) {
  const sequence = [];
  const wrap = () => {
    const rng = sim.combatRng;
    if (!rng || rng.__traced) return;
    const original = rng.float;
    rng.float = function tracedFloat() {
      const value = original.call(this);
      sequence.push(value);
      return value;
    };
    rng.__traced = true;
  };
  wrap();
  const beginWave = sim.beginWave.bind(sim);
  sim.beginWave = (waveDef) => {
    const started = beginWave(waveDef);
    wrap();
    return started;
  };
  return sequence;
}

// 同一 seed 的整局：建塔 → 打两波 → 返回快照 / RNG 序列 / 事件流。
function playTwin(quality) {
  // 暴击遗物让 computeHit 真正走 combatRng.float()，RNG 序列才有内容可比。
  const { sim, map } = makeSim({ seed: 'impact-events-determinism', relicIds: ['crit'] });
  sim.setVisualQuality(quality);
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

  const rngSequence = traceCombatRng(sim);
  const waveOptions = { portalCount: map.meta?.portalCount || 1, modifier: map.meta?.modifier || null };
  for (let wave = 1; wave <= 2; wave += 1) {
    const def = generateWave(sim.seed, wave, 'standard', waveOptions, { endless: false });
    assert.equal(sim.beginWave(def), true, `第 ${wave} 波应可开始`);
    let steps = 0;
    while (sim.phase === 'wave' && steps < 30 * 240) {
      sim.update(1 / 30);
      steps += 1;
    }
    assert.notEqual(sim.phase, 'wave', `第 ${wave} 波应在步数上限内结束`);
  }

  const snapshot = sim.toSnapshot();
  delete snapshot.savedAt;
  delete snapshot.startedAt;
  return {
    snapshot: JSON.stringify(snapshot),
    rngSequence,
    events: JSON.stringify(sim.impactEvents),
    eventCount: sim.impactEvents.length,
    sources: [...new Set(sim.impactEvents.map((event) => event.source))].sort(),
  };
}

test('同一 seed：反馈全开与全关的模拟、RNG 序列与事件流逐字节一致', () => {
  const full = playTwin({ effects: 'full', floaters: 'all' });
  const off = playTwin({ effects: 'off', floaters: 'off' });

  assert.ok(full.eventCount > 0, '整局应产出命中事件');
  assert.ok(full.rngSequence.length > 0, '整局应消耗过战斗 RNG');
  assert.equal(full.snapshot, off.snapshot, '模拟快照应逐字节一致');
  assert.deepEqual(full.rngSequence, off.rngSequence, 'combatRng 调用序列应逐项相等');
  assert.equal(full.events, off.events, '事件条数与逐条字段应相同');
  assert.equal(off.eventCount, full.eventCount);
  assert.deepEqual(off.sources, full.sources);
});
