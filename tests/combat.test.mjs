// 伤害管线回归：面板数值 = 对零护甲目标的实际伤害；各类增伤只应用一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { RELIC_BY_ID } from '../public/js/shared/data.js';

const EPS = 1e-9;
const ALMOST = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${message || ''} 期望 ${expected}，实际 ${actual}`
  );

function makeSim(relicIds = []) {
  const sim = new Simulation({
    map: generateMap('combat-test-seed'),
    seed: 'combat-test-seed',
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: relicIds.map((id) => ({ id, level: 1, ...RELIC_BY_ID[id] })),
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onToast: () => {},
  });
  return sim;
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 1, 1, level, 0);
  sim.towers.push(tower);
  return tower;
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, {
    hp: 100000,
    maxHp: 100000,
    armor: 0,
    boss: false,
    dead: false,
    slowUntil: 0,
    poisonUntil: 0,
  }, overrides);
  return enemy;
}

function hit(sim, enemy, tower, extra = {}) {
  const stats = sim.statsFor(tower);
  const before = enemy.hp;
  sim.dealDamage(enemy, stats.dmg, tower.type, extra);
  return { before, after: enemy.hp, damage: before - enemy.hp, stats };
}

test('弩塔 +25% 遗物：面板 16.25，零护甲实际伤害也是 16.25', () => {
  const sim = makeSim(['sharp']);
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  const result = hit(sim, enemy, tower);
  ALMOST(result.stats.dmg, 16.25, '面板伤害');
  ALMOST(result.damage, 16.25, '实际伤害');
});

test('塔专属与全局增伤叠加且只应用一次', () => {
  const sim = makeSim(['sharp', 'warlord']); // +25% 弩塔，+18% 全体
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  const result = hit(sim, enemy, tower);
  ALMOST(result.stats.dmg, 13 * (1 + 0.25 + 0.18), '面板伤害');
  ALMOST(result.damage, 13 * (1 + 0.25 + 0.18), '实际伤害');
});

test('暴击：在增伤之后翻倍，且使用战斗 RNG', () => {
  const sim = makeSim(['sharp', 'crit']);
  sim.combatRng = { float: () => 0 }; // 必定暴击
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  const result = hit(sim, enemy, tower);
  ALMOST(result.damage, 16.25 * 2, '暴击伤害');
});

test('护甲与破甲：先增伤，再减免护甲', () => {
  const sim = makeSim(['sharp']);
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim, { armor: 5 });
  const result = hit(sim, enemy, tower);
  ALMOST(result.damage, 16.25 - 5, '有护甲');

  const sim2 = makeSim(['sharp', 'pierce']); // 无视 50% 护甲
  const tower2 = addTower(sim2, 'arrow');
  const enemy2 = addEnemy(sim2, { armor: 5 });
  const result2 = hit(sim2, enemy2, tower2);
  ALMOST(result2.damage, 16.25 - 5 * 0.5, '半破甲');
});

test('条件增伤：首领、残血基地、减速易伤', () => {
  const bossSim = makeSim(['sharp', 'bosslayer']);
  const bossTower = addTower(bossSim, 'arrow');
  const boss = addEnemy(bossSim, { boss: true });
  ALMOST(hit(bossSim, boss, bossTower).damage, 16.25 * 1.5, '首领增伤');

  const lowSim = makeSim(['sharp', 'laststand']);
  lowSim.baseHp = 1; // 低于 40%
  const lowTower = addTower(lowSim, 'arrow');
  const lowEnemy = addEnemy(lowSim);
  ALMOST(hit(lowSim, lowEnemy, lowTower).damage, 16.25 * 1.35, '背水一战');

  const frostSim = makeSim(['sharp', 'frostbite']);
  const frostTower = addTower(frostSim, 'arrow');
  const frostEnemy = addEnemy(frostSim, { slowUntil: 10 });
  ALMOST(hit(frostSim, frostEnemy, frostTower).damage, 16.25 * 1.2, '寒霜易伤');
});

test('特殊塔：电弧无视护甲，毒伤无视护甲', () => {
  const sim = makeSim();
  const enemy = addEnemy(sim, { armor: 20 });
  const before = enemy.hp;
  sim.dealDamage(enemy, 20, 'arc', { ignoreArmor: true });
  ALMOST(before - enemy.hp, 20, '电弧无视护甲');

  const poisonEnemy = addEnemy(sim, { armor: 20 });
  const beforePoison = poisonEnemy.hp;
  sim.damage(poisonEnemy, 10, { ignoreArmor: true, silent: true, dot: true });
  ALMOST(beforePoison - poisonEnemy.hp, 10, '毒伤无视护甲');
});

test('面板与实际伤害在多种塔型/等级下一致（零护甲、无暴击）', () => {
  for (const type of ['arrow', 'cannon', 'frost', 'arc', 'poison']) {
    for (let level = 0; level < 3; level++) {
      const sim = makeSim(['sharp', 'warlord']);
      const tower = addTower(sim, type, level);
      const enemy = addEnemy(sim);
      const result = hit(sim, enemy, tower);
      ALMOST(result.stats.dmg, result.damage, `${type} Lv.${level + 1}`);
    }
  }
});
