// 主海克斯「独塔为王」：单塔限制、建造折扣、10 级扩展曲线、3/6/9 逐级选进化与 10 级大招。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import oneTower from '../public/js/shared/hexes/one-tower.js';

const SEED = 'hex-one-tower-seed';
const UNLOCKED = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];
const BASE_LEVELS = TOWERS.arrow.levels.length;
const MAX_LEVEL = 10;
const EXTRA_COSTS = [120, 180, 260, 360, 480, 620, 800];
// 进化选择等级（0 起索引）：3 / 6 / 9 级。
const EVOLUTION_TIERS = [2, 5, 8];

function makeSim(opts = {}) {
  const toasts = [];
  const sim = new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: UNLOCKED,
    hex: 'one_tower',
    onToast: (message) => toasts.push(message),
    ...opts,
  });
  return { sim, toasts };
}

function buildableCells(sim, count = 2) {
  const cells = [];
  for (let r = 0; r < sim.map.rows && cells.length < count; r++) {
    for (let c = 0; c < sim.map.cols && cells.length < count; c++) {
      if (sim.canBuild(c, r)) cells.push({ c, r });
    }
  }
  assert.equal(cells.length, count, '地图可建造格不足');
  return cells;
}

// 用建造 + 升级走到指定等级索引（0 起），保证走的是真实升级路径。
function buildTowerAt(sim, type, level) {
  const [cell] = buildableCells(sim, 1);
  assert.equal(sim.placeTower(type, cell.c, cell.r), true, '建造失败');
  const tower = sim.towerAt(cell.c, cell.r);
  while (tower.level < level) {
    assert.equal(sim.upgradeTower(tower), true, `升级到等级索引 ${tower.level + 1} 失败`);
  }
  return tower;
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);
}

test('定义：id / scoreMul / implemented 与设计一致', () => {
  assert.equal(oneTower.id, 'one_tower');
  assert.equal(oneTower.scoreMul, 1.2);
  assert.equal(oneTower.implemented, true);
  for (const hook of ['canBuild', 'buildCost', 'towerMaxLevel', 'upgradeCost', 'canEvolve', 'allowedEvolutions', 'ultimateSpec', 'modifyTowerStats']) {
    assert.equal(typeof oneTower.hooks[hook], 'function', `${hook} 钩子缺失`);
  }
});

test('建造费 ×0.70，且第二座塔被拒绝并 toast', () => {
  const { sim, toasts } = makeSim({ gold: 1000 });
  const [first, second] = buildableCells(sim);

  const buildCost = Math.round(TOWERS.arrow.cost * 0.7);
  assert.equal(sim.towerCost('arrow'), buildCost);
  assert.equal(sim.placeTower('arrow', first.c, first.r), true);
  assert.equal(sim.gold, 1000 - buildCost, '建造扣费按七折');

  const goldBefore = sim.gold;
  assert.equal(sim.placeTower('cannon', second.c, second.r), false, '第二座塔必须被拒绝');
  assert.equal(sim.towers.length, 1);
  assert.equal(sim.gold, goldBefore, '拒绝时不扣费');
  assert.ok(toasts.length > 0, '拒绝建造需要 toast');
  assert.equal(sim.canBuild(second.c, second.r, 'cannon'), false, '带类型预览也应为不可建造');
});

test('出售最后一塔后可以重建', () => {
  const { sim } = makeSim({ gold: 1000 });
  const [first, second] = buildableCells(sim);

  assert.equal(sim.placeTower('arrow', first.c, first.r), true);
  const tower = sim.towerAt(first.c, first.r);
  sim.sellTower(tower);
  assert.equal(sim.towers.length, 0);
  assert.equal(sim.canBuild(second.c, second.r, 'cannon'), true, '塔位数归零后恢复可建造');
  assert.equal(sim.placeTower('cannon', second.c, second.r), true, '出售后可以重建');

  // 重建的这一座同样受单塔限制。
  const [third] = buildableCells(sim, 1);
  assert.equal(sim.canBuild(third.c, third.r, 'frost'), false);
});

test('等级上限 10，7 次额外升级费用曲线正确', () => {
  const { sim } = makeSim();
  assert.equal(sim.towerMaxLevel(sim.makeTower('arrow', 0, 0, 0, 0)), MAX_LEVEL);

  const [cell] = buildableCells(sim, 1);
  assert.equal(sim.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim.towerAt(cell.c, cell.r);

  const expected = [
    TOWERS.arrow.levels[1].cost,
    TOWERS.arrow.levels[2].cost,
    ...EXTRA_COSTS,
  ];
  assert.equal(expected.length, MAX_LEVEL - 1, '从 1 级升到 10 级共 9 次升级');

  for (const [index, cost] of expected.entries()) {
    assert.equal(sim.upgradeCost(tower), cost, `第 ${index + 1} 次升级费用`);
    assert.equal(sim.upgradeTower(tower), true, `第 ${index + 1} 次升级`);
  }
  assert.equal(tower.level, MAX_LEVEL - 1, '10 级（索引 9）');
  assert.equal(sim.upgradeCost(tower), null, '满级后不再提供升级');
  assert.equal(sim.upgradeTower(tower), false);
});

test('扩展等级费用受遗物 costMul 影响', () => {
  const { sim } = makeSim({ relics: [{ id: 'thrifty', level: 1 }] });
  assertClose(sim.mods.costMul, -0.08, '精打细算 costMul');

  assert.equal(sim.towerCost('arrow'), Math.round(TOWERS.arrow.cost * 0.7 * 0.92));
  const tower = buildTowerAt(sim, 'arrow', BASE_LEVELS - 1);

  assert.equal(sim.upgradeCost(tower), Math.round(EXTRA_COSTS[0] * 0.92), '首次额外升级折后价');
  assert.equal(sim.upgradeTower(tower), true);
  assert.equal(sim.upgradeCost(tower), Math.round(EXTRA_COSTS[1] * 0.92), '第二次额外升级折后价');
});

test('3 级以内保持表内数值，第 4 级起每级 +12% 伤害 / +4% 射程 / +6% 攻速', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'arrow', BASE_LEVELS - 1);
  const base = TOWERS.arrow.levels[BASE_LEVELS - 1];

  const atMaxBase = sim.statsFor(tower);
  assertClose(atMaxBase.dmg, base.dmg, '基础满级伤害不变');
  assertClose(atMaxBase.range, base.range, '基础满级射程不变');
  assertClose(atMaxBase.rate, base.rate, '基础满级攻速不变');

  assert.equal(sim.upgradeTower(tower), true);
  const lv4 = sim.statsFor(tower);
  assertClose(lv4.dmg, base.dmg * 1.12, '4 级伤害');
  assertClose(lv4.range, base.range * 1.04, '4 级射程');
  assertClose(lv4.rate, base.rate * 1.06, '4 级攻速');

  while (tower.level < 5) sim.upgradeTower(tower);
  const lv6 = sim.statsFor(tower);
  assertClose(lv6.dmg, base.dmg * 1.12 ** 3, '6 级伤害按级数累乘');
  assertClose(lv6.range, base.range * 1.04 ** 3, '6 级射程按级数累乘');
  assertClose(lv6.rate, base.rate * 1.06 ** 3, '6 级攻速按级数累乘');
});

test('3/6/9 级各可三选一一条进化，选完三条到 9 级', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'arrow', 0);
  const ids = TOWERS.arrow.evolutions.map((entry) => entry.id);

  // 3 级之前不进入进化选择。
  assert.equal(sim.canEvolve(tower), false, '1 级不可进化');
  sim.upgradeTower(tower);
  assert.equal(sim.canEvolve(tower), false, '2 级不可进化');

  // 3 级（索引 2）→ 三选一第 1 条。
  sim.upgradeTower(tower);
  assert.equal(tower.level, 2);
  assert.equal(sim.canEvolve(tower), true, '3 级进入三选一');
  assert.deepEqual(sim.evolutionOptions(tower).map((entry) => entry.id), ids);
  assert.equal(sim.evolveTower(tower, ids[0]), true);
  assert.deepEqual(tower.evolutions, [ids[0]]);
  assert.equal(sim.canEvolve(tower), false, '选满当前层后不再弹');

  // 6 级（索引 5）→ 三选一第 2 条，只剩未选过的两条。
  while (tower.level < 5) sim.upgradeTower(tower);
  assert.equal(sim.canEvolve(tower), true, '6 级进入三选一');
  assert.deepEqual(sim.evolutionOptions(tower).map((entry) => entry.id), [ids[1], ids[2]]);
  assert.equal(sim.evolveTower(tower, ids[2]), true);
  assert.deepEqual(tower.evolutions, [ids[0], ids[2]]);
  assert.equal(sim.canEvolve(tower), false);

  // 9 级（索引 8）→ 三选一第 3 条，只剩最后一条。
  while (tower.level < 8) sim.upgradeTower(tower);
  assert.equal(sim.canEvolve(tower), true, '9 级进入三选一');
  assert.deepEqual(sim.evolutionOptions(tower).map((entry) => entry.id), [ids[1]]);
  assert.equal(sim.evolveTower(tower, ids[1]), true);
  assert.deepEqual(tower.evolutions, [ids[0], ids[2], ids[1]]);
  assert.equal(sim.canEvolve(tower), false, '三条选完不再弹');

  // 升到 10 级：不再「兼得全部进化」，也不再有新的进化选择。
  while (tower.level < MAX_LEVEL - 1) sim.upgradeTower(tower);
  assert.equal(tower.level, MAX_LEVEL - 1);
  assert.equal(sim.canEvolve(tower), false);
  assert.deepEqual(sim.evolutionOptions(tower), []);
});

test('10 级不再自动兼得全部进化（未逐级选的不会补记，但可补选）', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'cannon', MAX_LEVEL - 1);
  assert.deepEqual(tower.evolutions, [], '升满级不会自动兼得');
  assert.equal(tower.evolution, null);

  // 已到达全部层数，仍可补选（逐级选择不强制在升级瞬间完成）。
  assert.equal(sim.canEvolve(tower), true);
  assert.equal(sim.evolutionOptions(tower).length, 3);
  assert.equal(sim.evolveTower(tower, TOWERS.cannon.evolutions[0].id), true);
  assert.deepEqual(tower.evolutions, [TOWERS.cannon.evolutions[0].id]);
});

test('进化系数随逐级选择依次乘入属性，且未选进化不乘入', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'arrow', 0);
  const ids = TOWERS.arrow.evolutions.map((entry) => entry.id);
  const base = TOWERS.arrow.levels[BASE_LEVELS - 1];
  const mul = (id, key) => TOWERS.arrow.evolutions.find((entry) => entry.id === id).mods[key] ?? 1;

  // 走到 3 级（索引 2）只选第 1 条：此刻无额外等级成长，属性只乘第 1 条进化系数。
  while (tower.level < 2) sim.upgradeTower(tower);
  assert.equal(sim.evolveTower(tower, ids[0]), true);
  assertClose(sim.statsFor(tower).dmg, base.dmg * mul(ids[0], 'dmg'), '第 1 条进化伤害');
  assertClose(sim.statsFor(tower).range, base.range * mul(ids[0], 'range'), '第 1 条进化射程');
});

test('炮台 10 级解锁全图索敌（射程覆盖全图）', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'cannon', MAX_LEVEL - 1);
  const stats = sim.statsFor(tower);
  assert.equal(stats.fullMap, true, '10 级炮台 stats.fullMap');

  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  enemy.x = tower.x + 12;
  enemy.y = tower.y + 12;
  enemy.progress = 0.5;
  assert.equal(sim.findTarget(tower, stats.range), enemy, '全图索敌能锁定远距离敌人');
  assert.equal(sim.inRange(tower, enemy, stats.range), true, '全图索敌 inRange 恒真');

  // 未到 10 级不享有全图索敌。
  const { sim: low } = makeSim();
  const lowTower = buildTowerAt(low, 'cannon', 0);
  assert.ok(!low.statsFor(lowTower).fullMap, '低等级无 fullMap');
  low.spawnEnemy('grunt');
  const lowEnemy = low.enemies[low.enemies.length - 1];
  lowEnemy.x = lowTower.x + 12;
  lowEnemy.y = lowTower.y + 12;
  lowEnemy.progress = 0.5;
  assert.equal(low.findTarget(lowTower, low.statsFor(lowTower).range), null, '低等级不锁远距目标');
});

test('大招触发框架：塔级计数器每 4 次攻击触发一次，10 级解锁', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'cannon', MAX_LEVEL - 1);
  const stats = sim.statsFor(tower);

  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  enemy.x = tower.x + 1;
  enemy.y = tower.y;
  enemy.progress = 0.5;
  enemy.hp = 10000;
  enemy.maxHp = 10000;

  for (let i = 1; i <= 3; i++) {
    sim.fire(tower, stats, enemy);
    const proj = sim.projectiles[sim.projectiles.length - 1];
    assert.equal(tower.ultimateShots, i, `第 ${i} 发计数`);
    assert.equal(proj.ultimate, null, `第 ${i} 发不触发`);
  }

  sim.fire(tower, stats, enemy);
  const ultimate = sim.projectiles[sim.projectiles.length - 1];
  assert.equal(tower.ultimateShots, 4, '第 4 发计数');
  assert.ok(ultimate.ultimate, '第 4 发触发大招');
  assert.ok(ultimate.ultimateSpec.aftershock, '大招规格带余波');

  // 未到 10 级不计数、不触发。
  const { sim: low } = makeSim();
  const lowTower = buildTowerAt(low, 'cannon', 5);
  low.spawnEnemy('grunt');
  const lowEnemy = low.enemies[low.enemies.length - 1];
  lowEnemy.x = lowTower.x + 1;
  lowEnemy.y = lowTower.y;
  lowEnemy.progress = 0.5;
  low.fire(lowTower, low.statsFor(lowTower), lowEnemy);
  assert.equal(lowTower.ultimateShots, undefined, '10 级前不启动计数器');
  assert.equal(low.projectiles[low.projectiles.length - 1].ultimate, null);
});

test('炮台轰击余波：对半径内敌人造成二次范围伤害，半径外不受影响', () => {
  const { sim } = makeSim();
  const tower = buildTowerAt(sim, 'cannon', MAX_LEVEL - 1);

  // 直接构造一发已触发轰击的炮弹（关掉主溅射，便于单独验证余波）。
  const proj = {
    id: 999,
    x: tower.x,
    y: tower.y,
    towerType: 'cannon',
    tower,
    dmg: 100,
    splash: 0,
    ignoreArmor: false,
    target: null,
    ultimate: { aftershock: { radius: 1.6, damageMul: 0.6 } },
    ultimateSpec: { aftershock: { radius: 1.6, damageMul: 0.6 } },
  };

  const spawnAt = (dx, dy) => {
    sim.spawnEnemy('grunt');
    const enemy = sim.enemies[sim.enemies.length - 1];
    enemy.x = tower.x + dx;
    enemy.y = tower.y + dy;
    enemy.armor = 0;
    enemy.hp = 10000;
    enemy.maxHp = 10000;
    return enemy;
  };

  const inside = spawnAt(1.0, 0);
  const outside = spawnAt(3.0, 0);
  sim.impact(proj);

  assert.equal(inside.hp, 10000 - 60, '半径内目标吃 60% 余波伤害');
  assert.equal(outside.hp, 10000, '半径外目标不受余波');
});

test('读档/预览路径：未选进化不补乘、已选进化不重复乘算', () => {
  const { sim } = makeSim();
  const base = TOWERS.cannon.levels[BASE_LEVELS - 1];
  const mul = (key) =>
    TOWERS.cannon.evolutions.reduce((acc, entry) => acc * (entry.mods[key] ?? 1), 1);
  const tiers = MAX_LEVEL - BASE_LEVELS;

  // 读档/预览直接用 makeTower 造出满级塔（不触发升级钩子）：未选进化不得补乘。
  const tower = sim.makeTower('cannon', 0, 0, MAX_LEVEL - 1, 0);
  assert.deepEqual(tower.evolutions, []);
  const stats = sim.computeTowerStats(tower);
  assertClose(stats.dmg, base.dmg * 1.12 ** tiers, '未选进化时只有等级成长');
  assertClose(stats.range, base.range * 1.04 ** tiers);
  assertClose(stats.rate, base.rate * 1.06 ** tiers);
  assert.ok(stats.fullMap, '满级读档路径也带全图索敌');

  // 已选进化由模拟层应用，等级成长只乘一次，二者相乘且不重复。
  tower.evolutions = TOWERS.cannon.evolutions.map((entry) => entry.id);
  const applied = sim.computeTowerStats(tower);
  assertClose(applied.dmg, base.dmg * 1.12 ** tiers * mul('dmg'), '已选进化与等级成长相乘');
  assertClose(applied.range, base.range * 1.04 ** tiers * mul('range'));
  assertClose(applied.rate, base.rate * 1.06 ** tiers * mul('rate'));
});

test('无海克斯时行为不变：满价、3 级上限、可建多塔', () => {
  const { sim } = makeSim({ hex: null, hexState: null });
  assert.equal(sim.hex, null);

  assert.equal(sim.towerCost('arrow'), TOWERS.arrow.cost, '无折扣');
  const tower = sim.makeTower('arrow', 0, 0, 0, 0);
  assert.equal(sim.towerMaxLevel(tower), BASE_LEVELS);
  assert.equal(sim.upgradeCost(tower), TOWERS.arrow.levels[1].cost);

  const cells = buildableCells(sim, 2);
  assert.equal(sim.placeTower('arrow', cells[0].c, cells[0].r), true);
  assert.equal(sim.placeTower('cannon', cells[1].c, cells[1].r), true, '无海克斯不限塔数');

  const first = sim.towerAt(cells[0].c, cells[0].r);
  while (first.level < BASE_LEVELS - 1) assert.equal(sim.upgradeTower(first), true);
  assert.equal(sim.upgradeCost(first), null, '无海克斯止步 3 级');
  const base = TOWERS.arrow.levels[BASE_LEVELS - 1];
  assertClose(sim.statsFor(first).dmg, base.dmg, '无海克斯无额外成长');
});

test('冻结中的飞行怪可被炮台锁定与命中，未冻结的飞行怪仍不可被地面塔打', () => {
  const { sim } = makeSim();
  // 直接造地面塔（炮台），绕开单塔建造限制，专注索敌判定。
  const tower = sim.makeTower('cannon', 1, 1, 0, 0);
  sim.towers.push(tower);
  sim.recomputeTowerStats();
  const range = sim.statsFor(tower).range;

  sim.spawnEnemy('flyer');
  const flyer = sim.enemies[sim.enemies.length - 1];
  flyer.x = tower.x + 1;
  flyer.y = tower.y;
  flyer.hp = 1000;
  flyer.maxHp = 1000;

  // 未冻结：地面塔打不到飞行怪，也不开火。
  flyer.freezeUntil = 0;
  assert.equal(sim.findTarget(tower, range), null, '未冻结飞行怪不可被炮台锁定');
  tower.cd = 0;
  sim.updateTowers(1 / 60);
  assert.equal(sim.projectiles.length, 0, '未冻结飞行怪不会引发开火');

  // 冻结中：地面塔可锁定、开火并命中。
  flyer.freezeUntil = sim.time + 1;
  const hpBefore = flyer.hp;
  sim.updateTowers(1 / 60);
  assert.equal(sim.findTarget(tower, range), flyer, '冻结飞行怪可被炮台锁定');
  assert.equal(sim.projectiles.length, 1, '炮台对冻结飞行怪开火');
  assert.equal(sim.projectiles[0].target, flyer, '投射物指向冻结飞行怪');

  // 弹道落地后命中扣血。
  sim.updateProjectiles(0.2);
  assert.ok(flyer.hp < hpBefore, '冻结飞行怪被炮台命中扣血');
});
