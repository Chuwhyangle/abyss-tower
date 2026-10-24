// 主海克斯「过载电网」：4 邻接攻速/伤害加成、全塔射程 80%、邻居移除实时回落、
// 无海克斯时行为不变。数值全部对照同一布局下的无海克斯基线模拟，避免写死数据表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import overloadGrid from '../public/js/shared/hexes/overload-grid.js';

const SEED = 'hex-overload-grid-seed';
const EPS = 1e-9;

function makeSim(opts = {}) {
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
    onToast: () => {},
    ...opts,
  });
}

function addTower(sim, c, r, extra = {}) {
  const tower = Object.assign(sim.makeTower('arrow', c, r, 0, 0), extra);
  sim.towers.push(tower);
  sim.recomputeTowerStats();
  return tower;
}

// 同一组格子分别铺在「无海克斯」与「过载电网」两张模拟上，返回成对的塔。
function parallel(cells) {
  const base = makeSim();
  const hexed = makeSim({ hex: overloadGrid });
  const pairs = cells.map(([c, r, extra]) => [
    addTower(base, c, r, extra),
    addTower(hexed, c, r, extra),
  ]);
  return { base, hexed, pairs };
}

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)),
    `${message}: ${actual} != ${expected}`
  );
}

test('定义：overload_grid 已实现、计分倍率 1.05', () => {
  assert.equal(overloadGrid.id, 'overload_grid');
  assert.equal(overloadGrid.implemented, true);
  assert.equal(overloadGrid.scoreMul, 1.05);
  assert.equal(typeof overloadGrid.hooks.modifyTowerStats, 'function');
  // 无模拟上下文时保持入参不变（注册表契约）。
  const stats = { dmg: 10, rate: 1, range: 3 };
  assert.equal(overloadGrid.hooks.modifyTowerStats({}, stats, {}), stats);
});

test('无海克斯：四邻布局也不加成、不削射程，与数据表一致', () => {
  const { base, pairs } = parallel([
    [5, 5],
    [4, 5],
    [6, 5],
    [5, 4],
    [5, 6],
  ]);
  const level = TOWERS.arrow.levels[0];
  for (const tower of base.towers) {
    close(tower.stats.dmg, level.dmg, 'dmg 与数据表一致');
    close(tower.stats.rate, level.rate, 'rate 与数据表一致');
    close(tower.stats.range, level.range, 'range 与数据表一致');
  }
  assert.equal(pairs.length, 5);
});

test('孤立塔：无攻速/伤害加成，射程 80%', () => {
  const { pairs } = parallel([[5, 5]]);
  const [baseTower, hexedTower] = pairs[0];
  close(hexedTower.stats.rate, baseTower.stats.rate, '0 邻居攻速 +0%');
  close(hexedTower.stats.dmg, baseTower.stats.dmg, '0 邻居伤害 +0%');
  close(hexedTower.stats.range, baseTower.stats.range * 0.8, '射程 80%');
});

test('1 个邻居：攻速 +10%、伤害 +3%，射程仍为 80%', () => {
  const { pairs } = parallel([
    [5, 5],
    [6, 5],
  ]);
  for (const [baseTower, hexedTower] of pairs) {
    close(hexedTower.stats.rate, baseTower.stats.rate * 1.1, '1 邻居攻速 +10%');
    close(hexedTower.stats.dmg, baseTower.stats.dmg * 1.03, '1 邻居伤害 +3%');
    close(hexedTower.stats.range, baseTower.stats.range * 0.8, '射程 80%');
  }
});

test('4 个邻居：攻速 +40%、伤害 +12%（封顶），射程 80%', () => {
  const { pairs } = parallel([
    [5, 5],
    [4, 5],
    [6, 5],
    [5, 4],
    [5, 6],
  ]);
  // pairs[0] 是中心的 (5,5)，四臂各只有中心一个邻居。
  const [baseCenter, hexedCenter] = pairs[0];
  close(hexedCenter.stats.rate, baseCenter.stats.rate * 1.4, '4 邻居攻速 +40%');
  close(hexedCenter.stats.dmg, baseCenter.stats.dmg * 1.12, '4 邻居伤害 +12%');
  close(hexedCenter.stats.range, baseCenter.stats.range * 0.8, '射程 80%');

  for (const [baseArm, hexedArm] of pairs.slice(1)) {
    close(hexedArm.stats.rate, baseArm.stats.rate * 1.1, '臂塔只有中心一个邻居');
    close(hexedArm.stats.dmg, baseArm.stats.dmg * 1.03, '臂塔只有中心一个邻居');
    close(hexedArm.stats.range, baseArm.stats.range * 0.8, '臂塔射程 80%');
  }
});

test('对角线不算邻居：斜放两塔都只吃射程惩罚', () => {
  const { pairs } = parallel([
    [5, 5],
    [6, 6],
  ]);
  for (const [baseTower, hexedTower] of pairs) {
    close(hexedTower.stats.rate, baseTower.stats.rate, '斜邻不提供攻速');
    close(hexedTower.stats.dmg, baseTower.stats.dmg, '斜邻不提供伤害');
    close(hexedTower.stats.range, baseTower.stats.range * 0.8, '射程 80%');
  }
});

test('镜像塔同样计入邻居', () => {
  const { pairs } = parallel([
    [5, 5],
    [6, 5, { mirror: true }],
  ]);
  const [baseCenter, hexedCenter] = pairs[0];
  close(hexedCenter.stats.rate, baseCenter.stats.rate * 1.1, '镜像邻居提供攻速');
  close(hexedCenter.stats.dmg, baseCenter.stats.dmg * 1.03, '镜像邻居提供伤害');
});

test('出售/摧毁邻居后加成实时下降，清空后只剩射程惩罚', () => {
  const { hexed, pairs } = parallel([
    [5, 5],
    [4, 5],
    [6, 5],
    [5, 4],
    [5, 6],
  ]);
  const baseCenter = pairs[0][0];
  const hexedCenter = pairs[0][1];

  // 出售一臂：4 → 3 个邻居。
  hexed.removeTower(hexed.towers[1], 'sold');
  close(hexedCenter.stats.rate, baseCenter.stats.rate * 1.3, '出售后攻速回落 +30%');
  close(hexedCenter.stats.dmg, baseCenter.stats.dmg * 1.09, '出售后伤害回落 +9%');

  // 摧毁另一臂：3 → 2 个邻居。
  hexed.removeTower(hexed.towers[1], 'destroyed');
  close(hexedCenter.stats.rate, baseCenter.stats.rate * 1.2, '摧毁后攻速回落 +20%');
  close(hexedCenter.stats.dmg, baseCenter.stats.dmg * 1.06, '摧毁后伤害回落 +6%');

  // 清空所有邻居：加成归零，射程惩罚保留。
  for (const tower of [...hexed.towers]) {
    if (tower !== hexedCenter) hexed.removeTower(tower, 'sold');
  }
  close(hexedCenter.stats.rate, baseCenter.stats.rate, '无邻居攻速 +0%');
  close(hexedCenter.stats.dmg, baseCenter.stats.dmg, '无邻居伤害 +0%');
  close(hexedCenter.stats.range, baseCenter.stats.range * 0.8, '射程仍为 80%');
});

test('预览塔不在场上：不吃相邻加成，但仍显示 80% 射程', () => {
  const { base, hexed } = parallel([
    [5, 5],
    [6, 5],
  ]);
  const basePreview = base.previewStats('arrow');
  const hexedPreview = hexed.previewStats('arrow');
  close(hexedPreview.rate, basePreview.rate, '预览攻速无相邻加成');
  close(hexedPreview.dmg, basePreview.dmg, '预览伤害无相邻加成');
  close(hexedPreview.range, basePreview.range * 0.8, '预览射程 80%');
});
