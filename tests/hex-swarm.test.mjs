// 主海克斯「虫群战术」：建造/升级费 45%、伤害 60%、射程 85%、攻速 115%，
// 不新增塔数上限、不改出售返还与遗物；无海克斯时行为与现状完全一致。
// 倍率一律与「同一 seed / 同一塔型 / 同一等级」的无海克斯基线对照，避免写死数据表。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import { HEX_BY_ID } from '../public/js/shared/hexes/index.js';
import { hexScoreMul } from '../public/js/shared/scoring.js';
import swarm from '../public/js/shared/hexes/swarm.js';

const SEED = 'hex-swarm-seed';
const TOWER_TYPES = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];
const BUILD_MUL = 0.45;
const UPGRADE_MUL = 0.45;
const MIN_BUILD_COST = 20;
const MIN_UPGRADE_COST = 10;
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
    unlockedTowers: TOWER_TYPES,
    onToast: () => {},
    ...opts,
  });
}

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)),
    `${message}: ${actual} != ${expected}`
  );
}

function buildableCells(sim, count) {
  const cells = [];
  for (let r = 0; r < sim.map.rows && cells.length < count; r++) {
    for (let c = 0; c < sim.map.cols && cells.length < count; c++) {
      if (sim.canBuild(c, r)) cells.push({ c, r });
    }
  }
  assert.equal(cells.length, count, `可建造格不足 ${count}`);
  return cells;
}

// 同一格分别在「无海克斯」与「虫群战术」下走真实建造路径，返回两座塔。
function buildPair(type) {
  const base = makeSim();
  const hexed = makeSim({ hex: 'swarm' });
  const [cell] = buildableCells(base, 1);
  assert.equal(base.placeTower(type, cell.c, cell.r), true, '基线建造失败');
  assert.equal(hexed.placeTower(type, cell.c, cell.r), true, '虫群建造失败');
  return { base, hexed, baseTower: base.towerAt(cell.c, cell.r), hexTower: hexed.towerAt(cell.c, cell.r) };
}

test('定义：id / scoreMul / implemented 与注册表一致', () => {
  assert.equal(swarm.id, 'swarm');
  assert.equal(swarm.scoreMul, 1.05);
  assert.equal(swarm.implemented, true);
  assert.equal(HEX_BY_ID.swarm, swarm, '注册表应直接引用本模块');
  assert.equal(hexScoreMul('swarm'), 1.05, '计分链读同一 scoreMul');
  for (const hook of ['buildCost', 'upgradeCost', 'modifyTowerStats']) {
    assert.equal(typeof swarm.hooks[hook], 'function', `${hook} 钩子缺失`);
  }
});

test('建造费约为原价 45%（全塔型），且仍受 20 金下限保护', () => {
  const sim = makeSim({ hex: 'swarm' });
  const base = makeSim();
  for (const type of TOWER_TYPES) {
    const expected = Math.max(MIN_BUILD_COST, Math.round(TOWERS[type].cost * BUILD_MUL));
    assert.equal(sim.towerCost(type), expected, `${type} 建造成本应打 45% 折`);
    assert.equal(base.towerCost(type), TOWERS[type].cost, `${type} 无海克斯应为表价`);
    assert.ok(sim.towerCost(type) >= MIN_BUILD_COST, `${type} 不得低于 20 金下限`);
  }
});

test('遗物 costMul 在 45% 之上乘法叠加，而非把 -0.55 塞进加价系数', () => {
  const sim = makeSim({ hex: 'swarm', relics: [{ id: 'thrifty', level: 1 }] });
  assert.ok(sim.mods.costMul < 0, '精打细算应产生负 costMul');
  const expected = Math.max(
    MIN_BUILD_COST,
    Math.round(TOWERS.arrow.cost * BUILD_MUL * (1 + sim.mods.costMul))
  );
  assert.equal(sim.towerCost('arrow'), expected);
  // 加价系数路线会被 EFFECT_REGISTRY 封顶 -0.2（即最多 8 折），永远到不了 45%，故走 buildCost 钩子。
  assert.ok(sim.towerCost('arrow') < Math.round(TOWERS.arrow.cost * 0.8));
});

test('升级费同步 45%，并随遗物 costMul 叠加、受 10 金下限保护', () => {
  const { hexed, hexTower: tower } = buildPair('arrow');
  assert.equal(
    hexed.upgradeCost(tower),
    Math.max(MIN_UPGRADE_COST, Math.round(TOWERS.arrow.levels[1].cost * UPGRADE_MUL)),
    '首次升级费应打 45% 折'
  );
  assert.equal(hexed.upgradeTower(tower), true);
  assert.equal(
    hexed.upgradeCost(tower),
    Math.max(MIN_UPGRADE_COST, Math.round(TOWERS.arrow.levels[2].cost * UPGRADE_MUL)),
    '满级前逐级升级费同样打折'
  );
  assert.equal(hexed.upgradeCost(tower) >= MIN_UPGRADE_COST, true);

  const relicSim = makeSim({ hex: 'swarm', relics: [{ id: 'thrifty', level: 1 }] });
  const [cell] = buildableCells(relicSim, 1);
  assert.equal(relicSim.placeTower('arrow', cell.c, cell.r), true);
  const relicTower = relicSim.towerAt(cell.c, cell.r);
  assert.equal(
    relicSim.upgradeCost(relicTower),
    Math.max(MIN_UPGRADE_COST, Math.round(TOWERS.arrow.levels[1].cost * UPGRADE_MUL * (1 + relicSim.mods.costMul)))
  );
});

test('单塔属性：伤害 60%、射程 85%、攻速 115%', () => {
  for (const type of TOWER_TYPES) {
    const { baseTower, hexTower } = buildPair(type);
    close(hexTower.stats.dmg, baseTower.stats.dmg * 0.6, `${type} 伤害应为 60%`);
    close(hexTower.stats.range, baseTower.stats.range * 0.85, `${type} 射程应为 85%`);
    close(hexTower.stats.rate, baseTower.stats.rate * 1.15, `${type} 攻速应为 115%`);
  }
});

test('升级后属性倍率仍成立（与等级成长乘算）', () => {
  const { base, hexed, baseTower, hexTower } = buildPair('cannon');
  assert.equal(base.upgradeTower(baseTower), true);
  assert.equal(hexed.upgradeTower(hexTower), true);
  close(hexTower.stats.dmg, baseTower.stats.dmg * 0.6, '二级塔伤害 60%');
  close(hexTower.stats.range, baseTower.stats.range * 0.85, '二级塔射程 85%');
  close(hexTower.stats.rate, baseTower.stats.rate * 1.15, '二级塔攻速 115%');
});

test('不新增塔数上限：可连续铺满多座塔，每座都按 45% 扣费', () => {
  const sim = makeSim({ hex: 'swarm', gold: 100000 });
  const cells = buildableCells(sim, 8);
  const types = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];
  let gold = sim.gold;
  cells.forEach((cell, index) => {
    const type = types[index];
    const cost = sim.towerCost(type);
    assert.equal(sim.placeTower(type, cell.c, cell.r), true, `第 ${index + 1} 座塔应可建造`);
    assert.equal(sim.gold, gold - cost, `第 ${index + 1} 座塔按折后价扣费`);
    gold = sim.gold;
  });
  assert.equal(sim.towers.length, cells.length, '塔数沿用现有规则，不被海克斯限制');
});

test('只在建造成本与属性上生效：出售返还比例仍为 70%', () => {
  const { hexed, baseTower, hexTower } = buildPair('arrow');
  assert.equal(baseTower.invested, TOWERS.arrow.cost);
  assert.equal(hexTower.invested, Math.round(TOWERS.arrow.cost * BUILD_MUL));
  assert.equal(hexed.sellValue(hexTower), Math.floor(hexTower.invested * 0.7), '出售比例不变');
});

test('无海克斯时行为不变：表价建造、表价升级、表内属性', () => {
  const sim = makeSim();
  const [cell] = buildableCells(sim, 1);
  assert.equal(sim.towerCost('arrow'), TOWERS.arrow.cost);
  assert.equal(sim.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim.towerAt(cell.c, cell.r);
  const level = TOWERS.arrow.levels[0];
  close(tower.stats.dmg, level.dmg, '基线伤害为表内值');
  close(tower.stats.rate, level.rate, '基线攻速为表内值');
  close(tower.stats.range, level.range, '基线射程为表内值');
  assert.equal(sim.upgradeCost(tower), TOWERS.arrow.levels[1].cost, '基线升级费为表价');
});
