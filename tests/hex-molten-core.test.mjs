// 主海克斯「熔火核心」：命中附加 3 秒灼烧（每秒 30% 命中伤害）、重复命中刷新/取高、
// 攻速 ×0.80 的代价，以及无海克斯时行为完全不变。
// 全部走 Simulation 的真实管线（dealDamage → onHit；update → 灼烧跳伤），不直接改 hp。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import moltenCore from '../public/js/shared/hexes/molten-core.js';

const SEED = 'hex-molten-core-seed';
const STEP = 1 / 60;
const EPS = 1e-9;

function makeSim({ hex = null } = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'],
    hex,
    onToast: () => {},
  });
}

// 只用来取塔属性并按真实命中管线出手；默认不进场，避免塔自行开火干扰灼烧跳伤断言。
function makeTower(sim, type = 'arrow', level = 0) {
  return sim.makeTower(type, 1, 1, level, 0);
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(
    enemy,
    {
      hp: 1000000,
      maxHp: 1000000,
      armor: 0,
      boss: false,
      dead: false,
      slowUntil: 0,
      poisonUntil: 0,
      baseSpeed: 0,
    },
    overrides
  );
  return enemy;
}

function waveDef(index = 1) {
  return { index, groups: [], reward: 0, hpMul: 1, speedMul: 1, totalCount: 0, boss: false };
}

// 真实命中：塔出手 → dealDamage → onHit（tower 传入，与 Projectile 结算一致）。
function hit(sim, enemy, tower, amount = null) {
  const stats = sim.statsFor(tower);
  const base = amount === null ? stats.dmg : amount;
  const before = enemy.hp;
  const dealt = sim.dealDamage(enemy, base, tower.type, { tower });
  return { dealt, damage: before - enemy.hp, stats };
}

test('模块已实现：implemented=true 且钩子齐备', () => {
  assert.equal(moltenCore.id, 'molten_core');
  assert.equal(moltenCore.implemented, true);
  assert.equal(moltenCore.scoreMul, 1.05);
  assert.equal(typeof moltenCore.hooks.modifyTowerStats, 'function');
  assert.equal(typeof moltenCore.hooks.onHit, 'function');
});

test('命中后 3 秒内每秒造成 30% 命中伤害', () => {
  const sim = makeSim({ hex: 'molten_core' });
  const tower = makeTower(sim);
  const enemy = addEnemy(sim);
  const { dealt } = hit(sim, enemy, tower);

  assert.ok(dealt > 0);
  assert.ok(Math.abs(enemy.burnDps - dealt * 0.3) < EPS, '灼烧 DPS = 命中伤害 × 30%');
  assert.equal(enemy.burnUntil, 3, '命中时（t=0）灼烧持续到 3 秒');

  // 走真实 update 管线逐帧积分：3 秒窗口内总跳伤 ≈ 0.9 × 命中伤害。
  sim.beginWave(waveDef(1));
  enemy.hitFlash = 0; // 清掉本次直击的闪光，之后每帧跳伤若点火会重新置 1
  const before = enemy.hp;
  for (let i = 0; i < 180; i++) sim.update(STEP);
  const burned = before - enemy.hp;
  const perSecond = dealt * 0.3;
  assert.ok(
    burned >= perSecond * 2.9 && burned <= perSecond * 3.01,
    `3 秒内灼烧总量应约为 ${perSecond * 3}，实际 ${burned}`
  );
  // 灼烧跳伤走 dot 通道，不触发命中特效。
  assert.equal(enemy.hitFlash, 0, '持续伤害不产生命中特效');
});

test('重复命中刷新持续时间，DPS 取较高值且不叠层', () => {
  const sim = makeSim({ hex: 'molten_core' });
  const tower = makeTower(sim);
  const enemy = addEnemy(sim);

  hit(sim, enemy, tower, 100); // t=0 → dps 30，持续到 3
  assert.ok(Math.abs(enemy.burnDps - 30) < EPS);
  assert.equal(enemy.burnUntil, 3);

  sim.time = 1;
  hit(sim, enemy, tower, 40); // 较弱命中：DPS 保持 30，但持续时间刷新到 1+3=4
  assert.ok(Math.abs(enemy.burnDps - 30) < EPS, '较低 DPS 不覆盖较高值');
  assert.equal(enemy.burnUntil, 4, '重复命中刷新持续时间');

  sim.time = 2;
  hit(sim, enemy, tower, 200); // 更强命中：DPS 取高 60，持续到 5
  assert.ok(Math.abs(enemy.burnDps - 60) < EPS, '较高 DPS 覆盖旧值');
  assert.equal(enemy.burnUntil, 5);

  // 不叠层：DPS 是单值，而不是 30 + 60。
  assert.ok(enemy.burnDps < 60 + 30 - EPS);
});

test('灼烧过期后不残留：新命中重新起算 DPS', () => {
  const sim = makeSim({ hex: 'molten_core' });
  const tower = makeTower(sim);
  const enemy = addEnemy(sim);

  hit(sim, enemy, tower, 100); // dps 30 到 t=3
  sim.time = 10; // 早已过期
  hit(sim, enemy, tower, 10); // 新命中：dps 3、持续到 13
  assert.ok(Math.abs(enemy.burnDps - 3) < EPS, '过期旧灼烧不参与取高');
  assert.equal(enemy.burnUntil, 13);
});

test('攻速降为 80%（攻击间隔 ×1.25）', () => {
  const plain = makeSim();
  const hexed = makeSim({ hex: 'molten_core' });
  for (const type of ['arrow', 'cannon', 'frost', 'arc', 'poison', 'shock', 'sniper']) {
    const base = plain.statsFor(makeTower(plain, type));
    const modified = hexed.statsFor(makeTower(hexed, type));
    assert.ok(
      Math.abs(modified.rate - base.rate * 0.8) < EPS,
      `${type} 攻速应 ×0.80：${base.rate} → ${modified.rate}`
    );
    assert.ok(
      Math.abs(1 / modified.rate - (1 / base.rate) * 1.25) < EPS,
      `${type} 攻击间隔应 ×1.25`
    );
  }
  // 支援塔本身不攻击（rate 0），保持 0 而不是 NaN/负值。
  assert.equal(hexed.statsFor(makeTower(hexed, 'banner')).rate, 0);
});

test('首领同样生效，且与毒雾塔的 poison 彼此独立', () => {
  const sim = makeSim({ hex: 'molten_core' });
  const tower = makeTower(sim);
  const enemy = addEnemy(sim, { boss: true });
  enemy.poisonDps = 7;
  enemy.poisonUntil = 99;

  const { dealt } = hit(sim, enemy, tower, 100);
  assert.ok(Math.abs(enemy.burnDps - dealt * 0.3) < EPS, '首领同样附加灼烧');
  assert.equal(enemy.burnUntil, 3);
  assert.equal(enemy.poisonDps, 7, '灼烧不改写毒伤 DPS');
  assert.equal(enemy.poisonUntil, 99, '灼烧不改写毒伤持续时间');

  // 灼烧跳伤单独结算：1 秒后掉血 = burnDps，毒伤仍由自己的字段驱动。
  enemy.hitFlash = 0;
  const before = enemy.hp;
  sim.updateEnemySkillStatus(enemy, 1, 1, false);
  assert.ok(Math.abs(before - enemy.hp - dealt * 0.3) < EPS, '每秒跳伤 = 30% 命中伤害');
  assert.equal(enemy.hitFlash, 0, '持续伤害不点燃命中特效');
  assert.equal(enemy.poisonDps, 7);
});

test('非塔命中（技能/盟友，tower=null）不附加灼烧', () => {
  const sim = makeSim({ hex: 'molten_core' });
  const enemy = addEnemy(sim);
  sim.dealDamage(enemy, 100, 'arrow', {}); // 无 tower
  assert.equal(enemy.burnDps, 0);
  assert.equal(enemy.burnUntil, 0);
});

test('无海克斯时行为完全不变', () => {
  const sim = makeSim();
  assert.equal(sim.hex, null);
  assert.equal(sim.hexRuntime.active, false);

  const tower = makeTower(sim);
  // 塔属性与数据表一致（没有被乘 0.8）。
  assert.ok(Math.abs(sim.statsFor(tower).rate - TOWERS.arrow.levels[0].rate) < EPS);

  const enemy = addEnemy(sim);
  const { dealt } = hit(sim, enemy, tower);
  assert.ok(dealt > 0);
  assert.equal(enemy.burnDps, 0, '无海克斯不写入灼烧 DPS');
  assert.equal(enemy.burnUntil, 0, '无海克斯不写入灼烧时间');

  // 空跑 3 秒：没有灼烧跳伤，敌人血量只因命中而变化。
  sim.beginWave(waveDef(1));
  const before = enemy.hp;
  for (let i = 0; i < 180; i++) sim.update(STEP);
  assert.ok(Math.abs(enemy.hp - before) < EPS, '无海克斯时无持续伤害');
});
