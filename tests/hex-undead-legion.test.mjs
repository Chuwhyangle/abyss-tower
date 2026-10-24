// 主海克斯「亡者军团」：20% 击杀转化、35% 生命继承、12 秒 / 12 个上限、
// 骷髅按目标最大生命 4%（首领 1%）每秒攻击一次、击杀金币 ×0.45，
// 以及同种子同击杀序列的确定性与无海克斯时的行为不变。
// 攻击频率/索敌走真实盟友框架（sim.updateAllies），击杀金币走真实 killEnemy 入账。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { HEX_BY_ID } from '../public/js/shared/hexes.js';
import undeadLegion from '../public/js/shared/hexes/undead-legion.js';

const SEED = 'hex-undead-legion-seed';
const HEX = 'undead_legion';
const STEP = 1 / 60;
const EPS = 1e-9;

function makeSim({ hex = HEX, seed = SEED, ...rest } = {}) {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'],
    onToast: () => {},
    hex,
    ...rest,
  });
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(
    enemy,
    { hp: 1000, maxHp: 1000, armor: 0, boss: false, dead: false, gold: 10, baseSpeed: 0 },
    overrides
  );
  return enemy;
}

function waveDef(index = 1) {
  return { index, groups: [], reward: 0, hpMul: 1, speedMul: 1, totalCount: 0, boss: false };
}

// 直接调钩子：roll 固定时等价于「这一次必定/必定不转化」，用来单独验证数值与边界。
function killThroughHook(sim, enemy, roll = 0) {
  const before = sim.allies.length;
  undeadLegion.hooks.onEnemyKilled(enemy, {
    sim,
    state: sim.hexState,
    rng: { float: () => roll },
    spawnAlly: (spec) => sim.spawnAlly(spec),
    toast: () => {},
  });
  return sim.allies.length > before ? sim.allies[sim.allies.length - 1] : null;
}

function fillAllies(sim, count) {
  for (let i = 0; i < count; i++) sim.spawnAlly({ x: 1, y: 1, ttl: 12 });
}

function summonAt(sim, enemy, roll = 0) {
  const skull = killThroughHook(sim, enemy, roll);
  assert.ok(skull, '本次击杀应转化出骷髅');
  return skull;
}

test('定义：implemented=true、scoreMul 与击杀钩子齐备，并已进入注册表', () => {
  assert.equal(undeadLegion.id, HEX);
  assert.equal(undeadLegion.name, '亡者军团');
  assert.equal(undeadLegion.scoreMul, 1.15);
  assert.equal(undeadLegion.implemented, true);
  assert.equal(typeof undeadLegion.hooks.onEnemyKilled, 'function');
  assert.equal(HEX_BY_ID[HEX], undeadLegion, '注册表指向同一模块');
});

test('击杀转化概率约为 20%', () => {
  const sim = makeSim();
  let spawned = 0;
  const kills = 1000;
  for (let i = 0; i < kills; i++) {
    // 清空盟友，避免 12 个上限干扰概率统计。
    sim.allies = [];
    const enemy = addEnemy(sim);
    const before = sim.allies.length;
    sim.killEnemy(enemy);
    if (sim.allies.length > before) spawned += 1;
  }
  const rate = spawned / kills;
  // 3σ（σ≈0.0126）容差：确定性 RNG 下这条断言也锁定「不会退化成 0% 或 100%」。
  assert.ok(rate > 0.16 && rate < 0.24, `转化率应约 20%，实际 ${(rate * 100).toFixed(1)}%`);
});

test('骷髅属性：继承 35% 最大生命、12 秒、1.2 格、每秒 1 次、4%/1% 百分比', () => {
  const sim = makeSim();
  const enemy = addEnemy(sim, { maxHp: 2000, hp: 2000 });
  const skull = summonAt(sim, enemy);

  assert.equal(skull.kind, 'skeleton');
  assert.ok(Math.abs(skull.maxHp - 700) < EPS, '继承 35% 最大生命');
  assert.ok(Math.abs(skull.hp - 700) < EPS);
  assert.ok(Math.abs(skull.ttl - 12) < EPS, '持续 12 秒');
  assert.ok(Math.abs(skull.life - 12) < EPS);
  assert.ok(Math.abs(skull.range - 1.2) < EPS, '索敌 1.2 格');
  assert.ok(Math.abs(skull.rate - 1) < EPS, '每秒攻击 1 次');
  assert.ok(Math.abs(skull.pct - 0.04) < EPS, '普通目标 4%');
  assert.ok(Math.abs(skull.pctBoss - 0.01) < EPS, '首领 1%');
  assert.equal(skull.dmg, 0, '伤害走百分比而不是固定值');
});

test('转化上限 12 个：11 个时仍可生成，满 12 个不再生成', () => {
  const sim = makeSim();
  fillAllies(sim, 11);
  const enemy = addEnemy(sim);
  assert.ok(summonAt(sim, enemy), '11 个时第 12 个仍可生成');
  assert.equal(sim.allies.length, 12);

  assert.equal(killThroughHook(sim, addEnemy(sim), 0), null, '达到上限后不再生成');
  assert.equal(sim.allies.length, 12);
});

test('普通目标：每秒一次、每次目标最大生命 4%，无视护甲', () => {
  const sim = makeSim();
  const enemy = addEnemy(sim, { maxHp: 1000, hp: 1000, armor: 50 });
  summonAt(sim, enemy);

  const before = enemy.hp;
  for (let i = 0; i < 60; i++) sim.updateAllies(STEP);
  assert.ok(Math.abs(before - enemy.hp - 40) < EPS, '1 秒内命中 1 次 × 4% = 40（护甲不减免）');

  // 再过 2 秒：每秒 1 次，总伤害 3 次。
  for (let i = 0; i < 120; i++) sim.updateAllies(STEP);
  assert.ok(Math.abs(before - enemy.hp - 120) < EPS, '3 秒共命中 3 次');
});

test('首领目标：每次只造成最大生命 1%', () => {
  const sim = makeSim();
  const boss = addEnemy(sim, { boss: true, maxHp: 100000, hp: 100000 });
  summonAt(sim, boss);

  const before = boss.hp;
  sim.updateAllies(STEP);
  assert.ok(Math.abs(before - boss.hp - 1000) < EPS, '首领 1% × 100000 = 1000');
});

test('只打 1.2 格内最近的敌人', () => {
  const sim = makeSim();
  const center = { x: 6.5, y: 4.5 };
  const near = addEnemy(sim, { ...center, maxHp: 1000, hp: 1000 });
  const far = addEnemy(sim, { x: center.x, y: center.y + 1, maxHp: 1000, hp: 1000 });
  const outside = addEnemy(sim, { x: center.x + 3, y: center.y, maxHp: 1000, hp: 1000 });
  // 召唤源不加入 sim.enemies，避免它自己成为最近目标。
  const skull = killThroughHook(sim, { x: center.x, y: center.y, maxHp: 1000, gold: 0 });
  assert.ok(skull);

  const beforeNear = near.hp;
  const beforeFar = far.hp;
  const beforeOutside = outside.hp;
  sim.updateAllies(STEP);
  assert.ok(near.hp < beforeNear, '最近目标受伤');
  assert.equal(far.hp, beforeFar, '范围内但较远的敌人不受伤');
  assert.equal(outside.hp, beforeOutside, '1.2 格外不攻击');
});

test('骷髅 12 秒后过期清理', () => {
  const sim = makeSim();
  summonAt(sim, addEnemy(sim));
  assert.equal(sim.allies.length, 1);

  for (let i = 0; i < 719; i++) sim.updateAllies(STEP);
  assert.equal(sim.allies.length, 1, '11.98 秒时仍存活');

  for (let i = 0; i < 2; i++) sim.updateAllies(STEP);
  assert.equal(sim.allies.length, 0, '超过 12 秒后清理');
});

test('击杀金币 ×0.45；无海克斯时为全额', () => {
  const withHex = makeSim();
  const plain = makeSim({ hex: null });
  for (const sim of [withHex, plain]) {
    const enemy = addEnemy(sim, { gold: 100 });
    const before = sim.gold;
    sim.killEnemy(enemy);
    const delta = sim.gold - before;
    if (sim === withHex) assert.equal(delta, 45, '亡者军团击杀金币 45%');
    else assert.equal(delta, 100, '无海克斯时击杀金币不变');
  }
});

test('击杀金币按实际入账（含波次成长）扣到 45%，不重复乘现有倍率', () => {
  const sim = makeSim();
  sim.wave = 10; // 入账 = round(100 × (1 + 10 × 0.005)) = 105
  const enemy = addEnemy(sim, { gold: 100 });
  const before = sim.gold;
  sim.killEnemy(enemy);
  assert.equal(sim.gold - before, 47, '105 × 0.45 四舍五入 = 47');

  const plain = makeSim({ hex: null });
  plain.wave = 10;
  const enemy2 = addEnemy(plain, { gold: 100 });
  const before2 = plain.gold;
  plain.killEnemy(enemy2);
  assert.equal(plain.gold - before2, 105, '无海克斯仍按原式入账');
});

test('首领死亡同样可以转化（伤害另按 1% 结算）', () => {
  const sim = makeSim();
  const boss = addEnemy(sim, { boss: true, maxHp: 8000, hp: 8000, gold: 500 });
  const skull = summonAt(sim, boss);
  assert.ok(Math.abs(skull.maxHp - 2800) < EPS, '首领骷髅同样继承 35% 最大生命');

  const before = boss.hp;
  sim.updateAllies(STEP);
  assert.ok(Math.abs(before - boss.hp - 80) < EPS, '对首领 1% × 8000 = 80');
});

test('同种子 + 同击杀序列的生成结果完全一致，不同种子可出现差异', () => {
  const run = (seed) => {
    const sim = makeSim({ seed });
    for (let i = 0; i < 30; i++) {
      // 每只敌人最大生命不同，可据此还原「哪几次击杀发生了转化」。
      const enemy = addEnemy(sim, { maxHp: 1000 + i, hp: 1000 + i });
      sim.killEnemy(enemy);
    }
    return sim.allies.map((ally) => ({
      kind: ally.kind,
      maxHp: ally.maxHp,
      ttl: ally.ttl,
      x: ally.x,
      y: ally.y,
    }));
  };

  assert.deepEqual(run(SEED), run(SEED), '同种子同击杀序列结果一致');

  const signatures = new Set();
  for (const seed of ['legion-a', 'legion-b', 'legion-c', 'legion-d', 'legion-e', 'legion-f']) {
    signatures.add(JSON.stringify(run(seed)));
  }
  assert.ok(signatures.size > 1, '不同种子的转化序列应能不同');
});

test('无海克斯时行为不变：不召唤、金币全额、路径不被阻挡', () => {
  const sim = makeSim({ hex: null });
  assert.equal(sim.hex, null);
  sim.killEnemy(addEnemy(sim));
  assert.equal(sim.allies.length, 0);
  const noHex = makeSim({ hex: null });
  const enemy = addEnemy(noHex, { gold: 100 });
  const before = noHex.gold;
  noHex.killEnemy(enemy);
  assert.equal(noHex.gold - before, 100);
});

test('骷髅不阻挡敌人：同种子下有无骷髅的路径进度一致', () => {
  const run = (withSkull) => {
    const sim = makeSim();
    const enemy = addEnemy(sim, { hp: 100000, maxHp: 100000, baseSpeed: 2 });
    if (withSkull) sim.spawnAlly({ kind: 'skeleton', x: enemy.x, y: enemy.y, ttl: 12, range: 1.2, rate: 1, pct: 0.04 });
    sim.beginWave(waveDef(1));
    for (let i = 0; i < 60; i++) sim.update(STEP);
    return { progress: enemy.progress, alive: !enemy.dead };
  };

  const without = run(false);
  const withSkull = run(true);
  assert.ok(withSkull.alive && without.alive, '敌人在两种情况下都存活');
  assert.ok(
    Math.abs(withSkull.progress - without.progress) < EPS,
    `骷髅不应阻挡敌人：${withSkull.progress} != ${without.progress}`
  );
});
