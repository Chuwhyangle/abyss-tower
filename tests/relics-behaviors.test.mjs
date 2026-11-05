// 遗物升级行为词条（feat-relic-behaviors）：Ⅱ/Ⅲ 级解锁机制型效果的纯函数 + 战斗路由 + 确定性 + 存档兼容。
// 断言口径与任务 AC 逐条对齐：(a) ≥6 件遗物有 Ⅱ/Ⅲ 词条、Ⅲ 级为机制型（非纯数值）；
// (b) sim 按等级确定性消费（种子派生、不改 RNG 调用顺序）；(c) 存档兼容（旧档遗物等级不变、词条按等级补挂）。
import test from 'node:test';
import assert from 'node:assert/strict';

import { RELICS, relicBehaviorsAtLevel } from '../public/js/shared/data/relics.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { toSnapshot } from '../public/js/shared/snapshot.js';

const EPS = 1e-9;
const ALMOST = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPS, `${message || ''} 期望 ${expected}，实际 ${actual}`);

// 机制型 kind（非纯数值）：Ⅲ 级词条必须落在该集合，保证解锁的是「机制」而非单纯的数值加成。
const MECHANISM_KINDS = [
  'poisonHitSpread',
  'frostHitFreeze',
  'poisonKillSpread',
  'arcKillZap',
  'cannonKillBurst',
  'arrowShotPierce',
];

function withFixedNow(now, fn) {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

function makeSim({ relics = [], seed = 'relic-behaviors-seed' } = {}) {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    startedAt: 1700000000000,
    rogue2: {},
    onSave: () => {},
  });
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 5, 5, level, 0);
  sim.towers.push(tower);
  return tower;
}

// 生成一名可精确控制位置/护甲/减速/中毒/冻结状态的敌人（复用 spawnEnemy 的字段初始化）。
function addEnemy(sim, { x = 0, y = 0, armor = 0, slowUntil = 0, boss = false } = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, {
    hp: 100000,
    maxHp: 100000,
    armor,
    boss,
    dead: false,
    slowUntil,
    freezeUntil: 0,
    poisonUntil: 0,
    poisonDps: 0,
    poisonHop: 0,
    x,
    y,
  });
  return enemy;
}

// 直接命中一枚投射物（跳过弹道），便于逐发驱动 hitEnemy 的词条结算点。
function impactShot(sim, tower, target) {
  sim.fire(tower, sim.statsFor(tower), target);
  const proj = sim.projectiles.pop();
  if (proj) sim.projectileSystem.impact(proj);
}

test('relicBehaviorsAtLevel：按等级累积补挂 Ⅱ/Ⅲ 词条，非法输入返回空', () => {
  // venomfang Ⅱ 毒雾命中传播 + Ⅲ 中毒死亡传播。
  assert.deepEqual(
    relicBehaviorsAtLevel('venomfang', 3).map((b) => b.kind),
    ['poisonHitSpread', 'poisonKillSpread']
  );
  assert.deepEqual(relicBehaviorsAtLevel('venomfang', 2).map((b) => b.kind), ['poisonHitSpread']);
  assert.deepEqual(relicBehaviorsAtLevel('venomfang', 1), []);
  // 对象入参与字符串入参等价。
  assert.deepEqual(relicBehaviorsAtLevel(RELICS.find((r) => r.id === 'venomfang'), 3).length, 2);
  // 等级越界被收敛：99 → 3，0 → 1。
  assert.deepEqual(relicBehaviorsAtLevel('venomfang', 99).length, 2);
  assert.deepEqual(relicBehaviorsAtLevel('venomfang', 0), []);
  // 无 behaviors 字段的遗物、未知 id 都返回空数组。
  assert.deepEqual(relicBehaviorsAtLevel('sharp', 3), []);
  assert.deepEqual(relicBehaviorsAtLevel('nope', 3), []);
});

test('AC(a)：≥6 件遗物有 Ⅱ/Ⅲ 词条，且每条 Ⅲ 级词条均为机制型（非纯数值）', () => {
  const withBehaviors = RELICS.filter((r) => r.behaviors);
  assert.ok(withBehaviors.length >= 6, `需 ≥6 件遗物带行为词条，实际 ${withBehaviors.length}`);

  const tier3 = withBehaviors
    .filter((r) => r.behaviors['Ⅲ'])
    .flatMap((r) => r.behaviors['Ⅲ'].map((b) => ({ relicId: r.id, behavior: b })));
  assert.ok(tier3.length >= 1, '至少 1 件遗物有 Ⅲ 级词条');
  for (const { relicId, behavior } of tier3) {
    assert.ok(behavior.id, `${relicId} 的 Ⅲ 级词条缺 id`);
    assert.ok(behavior.towerType, `${relicId} 的 Ⅲ 级词条缺 towerType`);
    assert.ok(
      MECHANISM_KINDS.includes(behavior.kind),
      `${relicId} 的 Ⅲ 级词条 kind=${behavior.kind} 非机制型`
    );
  }
});

test('Simulation 路由：collectBehaviors/behaviorsFor/hasBehavior 按等级消费', () => {
  const sim = makeSim({ relics: [{ id: 'venomfang', level: 3 }, { id: 'sparkplug', level: 3 }] });
  assert.equal(sim.relicSystem.hasBehavior('poisonHitSpread', 'poison'), true);
  assert.equal(sim.relicSystem.hasBehavior('poisonKillSpread', 'poison'), true);
  assert.equal(sim.relicSystem.hasBehavior('arcKillZap', 'arc'), true);
  assert.equal(sim.relicSystem.hasBehavior('poisonHitSpread', 'arc'), false, '塔类型不匹配不命中');
  assert.equal(sim.relicSystem.hasBehavior('nope'), false);

  const poisonSpreads = sim.relicSystem.behaviorsFor('poison', 'poisonHitSpread');
  assert.equal(poisonSpreads.length, 1);
  assert.equal(poisonSpreads[0].id, 'venomfang-spread-2');
  assert.equal(poisonSpreads[0].relicId, 'venomfang');

  // 等级 1 无行为词条，未持有相关遗物时为空。
  const level1 = makeSim({ relics: [{ id: 'venomfang', level: 1 }] });
  assert.equal(level1.relicSystem.hasBehavior('poisonHitSpread', 'poison'), false);
  assert.deepEqual(level1.relicSystem.behaviorsFor('poison'), []);
});

test('frostHitFreeze：霜塔每第 hits 次命中冻结 duration 秒，首领减半', () => {
  const sim = makeSim({ relics: [{ id: 'frostglint', level: 3 }] });
  sim.time = 10;
  const target = addEnemy(sim);
  const proj = { towerType: 'frost', dmg: 0, ignoreArmor: false, tower: null, slow: 0, slowDur: 0, dot: 0, dotDur: 0, knockback: 0 };

  for (let i = 0; i < 4; i++) sim.hitEnemy(target, proj);
  assert.equal(target.freezeUntil, 0, '前 4 次命中不冻结');
  sim.hitEnemy(target, proj); // 第 5 次
  assert.equal(target.freezeUntil, 10.5, '第 5 次冻结 0.5s');

  // 首领冻结减半：0.5 / 2 = 0.25s。
  const boss = addEnemy(sim, { boss: true });
  for (let i = 0; i < 5; i++) sim.hitEnemy(boss, proj);
  assert.equal(boss.freezeUntil, 10.25, '首领冻结时长减半');
});

test('poisonHitSpread：毒雾命中向半径内最近 targets 名敌人传播 dpsMul 毒伤', () => {
  const sim = makeSim({ relics: [{ id: 'venomfang', level: 2 }] });
  sim.time = 0;
  const target = addEnemy(sim, { x: 0, y: 0 });
  const near = addEnemy(sim, { x: 0.5, y: 0 });
  const far = addEnemy(sim, { x: 5, y: 0 });
  const proj = { towerType: 'poison', dmg: 0, ignoreArmor: false, tower: null, slow: 0, slowDur: 0, dot: 20, dotDur: 3, knockback: 0 };

  sim.hitEnemy(target, proj);
  ALMOST(near.poisonDps, 20 * 0.3, '毒雾命中向 0.8 格内传播 30% 毒伤');
  assert.equal(near.poisonUntil, 3, '传播毒层时长沿用 dotDur');
  assert.equal(far.poisonDps, 0, '0.8 格外不传播');
});

test('poisonKillSpread：中毒死亡向半径内最近敌人传播毒层，最多 hops 跳', () => {
  const sim = makeSim({ relics: [{ id: 'venomfang', level: 3 }] });
  sim.time = 10;
  const a = addEnemy(sim, { x: 0, y: 0 });
  const b = addEnemy(sim, { x: 0.5, y: 0 });
  const c = addEnemy(sim, { x: 1.0, y: 0 });
  const d = addEnemy(sim, { x: 1.5, y: 0 });
  const e = addEnemy(sim, { x: 2.0, y: 0 });
  Object.assign(a, { poisonDps: 20, poisonUntil: 15 });

  sim.killEnemy(a); // 第 1 跳 a → b
  ALMOST(b.poisonDps, 20);
  assert.equal(b.poisonHop, 1);
  assert.equal(c.poisonDps, 0, '每次只传播 1 个目标');

  sim.killEnemy(b); // 第 2 跳 b → c
  ALMOST(c.poisonDps, 20);
  assert.equal(c.poisonHop, 2);

  sim.killEnemy(c); // 第 3 跳 c → d
  ALMOST(d.poisonDps, 20);
  assert.equal(d.poisonHop, 3);

  sim.killEnemy(d); // hops=3 落地后不再传播
  assert.equal(e.poisonDps, 0, '第 4 跳不传播');
});

test('arcKillZap：电弧击杀对半径内敌人造成 killingDamage × damageMul', () => {
  const sim = makeSim({ relics: [{ id: 'sparkplug', level: 3 }] });
  sim.time = 10;
  const dying = addEnemy(sim, { x: 0, y: 0 });
  const near = addEnemy(sim, { x: 0.5, y: 0 });
  const far = addEnemy(sim, { x: 5, y: 0 });
  const beforeNear = near.hp;
  const beforeFar = far.hp;

  sim.killEnemy(dying, 100);
  ALMOST(beforeNear - near.hp, 100 * 0.6, '半径内目标承受 60% 击杀伤害');
  assert.equal(far.hp, beforeFar, '1.2 格外不受击');
});

test('cannonKillBurst：炮台击杀对半径内敌人造成 killingDamage × ratio', () => {
  const sim = makeSim({ relics: [{ id: 'siege', level: 3 }] });
  sim.time = 10;
  const dying = addEnemy(sim, { x: 0, y: 0 });
  const near = addEnemy(sim, { x: 0.5, y: 0 });
  const far = addEnemy(sim, { x: 5, y: 0 });
  const beforeNear = near.hp;

  sim.killEnemy(dying, 100);
  ALMOST(beforeNear - near.hp, 100 * 0.5, '半径内目标承受 50% 击杀伤害');
  assert.equal(far.hp, 100000, '1.0 格外不受击');
});

test('arrowShotPierce：弩塔每第 every 发穿透 pierce 个目标，各 damageMul 伤害', () => {
  const sim = makeSim({ relics: [{ id: 'steadyaim', level: 3 }] });
  const tower = addTower(sim, 'arrow');
  const dmg = sim.statsFor(tower).dmg;
  const t0 = addEnemy(sim, { x: 0, y: 0 });
  const t1 = addEnemy(sim, { x: 0.5, y: 0 });
  const t2 = addEnemy(sim, { x: 1.0, y: 0 });

  for (let i = 0; i < 5; i++) impactShot(sim, tower, t0);
  const t1Before = t1.hp;
  const t2Before = t2.hp;
  impactShot(sim, tower, t0); // 第 6 发
  ALMOST(t1Before - t1.hp, dmg * 0.6, '第 1 个穿透目标承受 60%');
  ALMOST(t2Before - t2.hp, dmg * 0.6, '第 2 个穿透目标承受 60%');
});

test('确定性：含行为词条的同 seed 逐字节一致', () => {
  const drive = (seed) => {
    const sim = makeSim({
      relics: [
        { id: 'venomfang', level: 3 },
        { id: 'steadyaim', level: 3 },
        { id: 'sparkplug', level: 3 },
        { id: 'frostglint', level: 3 },
      ],
      seed,
    });
    const tower = addTower(sim, 'arrow');
    const enemies = [addEnemy(sim, { x: 0, y: 0 }), addEnemy(sim, { x: 1, y: 0 }), addEnemy(sim, { x: 0.5, y: 0 })];
    // 覆盖命中/暴击 RNG + 投射物开火 + 行为词条计数器路径。
    for (let i = 0; i < 6; i++) {
      sim.dealDamage(enemies[i % 3], 10, 'arrow', { tower });
      impactShot(sim, tower, enemies[i % 3]);
    }
    return withFixedNow(1700000000999, () => JSON.stringify(sim.toSnapshot()));
  };

  assert.equal(drive('det-a'), drive('det-a'), '同 seed 逐字节一致');
  assert.equal(drive('det-b'), drive('det-b'), '另一 seed 亦逐字节一致');
});

test('存档兼容：旧档遗物等级不变，行为词条按等级补挂（不进快照）', () => {
  // 快照层：relics 仍只写 { id, level }，行为词条是派生状态，不序列化。
  const snap = withFixedNow(1700000000123, () =>
    toSnapshot({
      runId: 'run-behaviors',
      seed: 'seed-behaviors',
      mode: 'normal',
      difficulty: 'standard',
      clearedWave: 4,
      pendingDraft: false,
      gold: 100,
      baseHp: 20,
      maxBaseHp: 20,
      kills: 2,
      relics: [{ id: 'venomfang', level: 3 }],
      towers: [],
      startedAt: 1700000000000,
      rogue2: { contracts: [], bonusPoints: {}, doctrines: [], awakenings: [] },
    })
  );
  assert.deepEqual(snap.relics, [{ id: 'venomfang', level: 3 }], '旧档遗物等级原样保留');
  assert.equal('relicBehaviors' in snap, false, '行为词条不进快照');
  assert.equal(JSON.stringify(snap).includes('relicBehaviors'), false);

  // 模拟层：从旧档（无 relicBehaviors 字段）构造，行为词条按等级补挂。
  const sim = makeSim({ relics: [{ id: 'venomfang', level: 3 }] });
  assert.deepEqual(sim.relics, [{ id: 'venomfang', level: 3 }], '遗物等级不变');
  assert.equal(sim.relicSystem.hasBehavior('poisonHitSpread', 'poison'), true, 'Ⅲ 级按等级补挂 Ⅱ 词条');
  assert.equal(sim.relicSystem.hasBehavior('poisonKillSpread', 'poison'), true, 'Ⅲ 级按等级补挂 Ⅲ 词条');

  const level1 = makeSim({ relics: [{ id: 'venomfang', level: 1 }] });
  assert.equal(level1.relicSystem.hasBehavior('poisonHitSpread', 'poison'), false, '旧档 Ⅰ 级不补挂词条');
});
