// 主海克斯「镜像工程」：本体建成后玩家自选位置落一座连体镜像（同类型同等级、0 造价、
// 60% 属性含次要属性、随本体升级/消失、不可单独升级、单独出售 0 金消失、造价 ×1.45）。
// 全部走公开接口（Simulation + 钩子），不 mock 模拟层内部步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import { HEX_BY_ID } from '../public/js/shared/hexes.js';
import mirrorEngineering from '../public/js/shared/hexes/mirror-engineering.js';

const SEED = 'hex-mirror-seed';
const HEX = 'mirror_engineering';
const TOWER_TYPE = 'arrow';
const MIRROR_MUL = 0.6;
const COST_MUL = 1.45;
const UNLOCKED = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];

function makeSim(opts = {}) {
  const { map = makeMap(), hex = HEX, ...rest } = opts;
  return new Simulation({
    map,
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: UNLOCKED,
    onToast: () => {},
    hex,
    ...rest,
  });
}

// 镜像工程只需「一个本体格 + 一个空可建格」，不再要求对称地形；用非路径且非阻挡的
// 开放地形作为镜像测试基座。
function makeMap() {
  const map = generateMap(SEED);
  const path = new Set(map.pathCells.map((p) => `${p.c},${p.r}`));
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      map.buildable[r][c] = !path.has(`${c},${r}`) && !map.blocked[r][c];
    }
  }
  return map;
}

// 找 count 个互不相同的空可建格。
function findCells(sim, count) {
  const cells = [];
  for (let r = 0; r < sim.map.rows && cells.length < count; r++) {
    for (let c = 0; c < sim.map.cols && cells.length < count; c++) {
      if (sim.canBuild(c, r)) cells.push({ c, r });
    }
  }
  return cells;
}

function placeBody(sim, type, cell) {
  assert.equal(sim.placeTower(type, cell.c, cell.r), true, `建造本体 ${type} (${cell.c},${cell.r})`);
  const body = sim.towerAt(cell.c, cell.r);
  assert.ok(body, '本体应已落成');
  return body;
}

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

test('定义：implemented、scoreMul 与镜像工程钩子齐备', () => {
  assert.equal(mirrorEngineering.id, HEX);
  assert.equal(mirrorEngineering.scoreMul, 1.1);
  assert.equal(mirrorEngineering.implemented, true);
  assert.equal(HEX_BY_ID[HEX], mirrorEngineering, '注册表指向同一模块');
  for (const name of [
    'buildCost',
    'onTowerBuilt',
    'createMirror',
    'onTowerUpgraded',
    'onTowerRemoved',
    'upgradeCost',
    'modifyTowerStats',
  ]) {
    assert.equal(typeof mirrorEngineering.hooks[name], 'function', `钩子 ${name}`);
  }
});

test('建本体后进入镜像落位模式：不自动生成镜像，待玩家点空位', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.mirrorPlacing, true, '建本体后进入落位模式');
  assert.equal(sim.pendingMirror, body, '本体写进待落位槽');
  assert.equal(sim.mirrorPlacementType, TOWER_TYPE, '幽灵预览取本体类型');
  assert.equal(sim.towers.length, 1, '只生成本体，镜像待玩家落位');
  assert.equal(sim.towerAt(mirrorCell.c, mirrorCell.r), null);
});

test('点空位落镜像：同类型同等级、0 投资、mirrorOf 指向本体', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  const goldAfterBody = sim.gold;
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const mirror = sim.towerAt(mirrorCell.c, mirrorCell.r);
  assert.ok(mirror, '空位应落成镜像');
  assert.equal(mirror.type, body.type);
  assert.equal(mirror.level, body.level);
  assert.equal(mirror.invested, 0, '镜像不消耗金币');
  assert.equal(mirror.mirrorOf, body.id);
  assert.equal(sim.towers.length, 2, '只有本体与一座镜像');
  assert.equal(sim.gold, goldAfterBody, '落镜像不扣金币');
  assert.equal(sim.mirrorPlacing, false, '落位后退出镜像落位模式');
  assert.equal(sim.pendingMirror, null, '落位后清空待落位槽');
});

test('占格/不可建格不落镜像，待落位槽保留', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(bodyCell.c, bodyCell.r), false, '本体格已占用，不落');
  const pathCell = sim.map.pathCells[0];
  assert.equal(sim.placeMirror(pathCell.c, pathCell.r), false, '路径格不可建，不落');
  assert.equal(sim.pendingMirror, body, '失败后待落位槽保留');
  assert.equal(sim.mirrorPlacing, true);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true, '空可建格仍可落');
});

test('不在镜像落位模式时 placeMirror 失败', () => {
  const sim = makeSim();
  const [mirrorCell] = findCells(sim, 1);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), false);
});

test('镜像伤害/攻速/射程 ×0.60，本体保持 100%', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const mirror = sim.towerAt(mirrorCell.c, mirrorCell.r);
  const base = sim.previewStats(TOWER_TYPE, 0);
  approx(body.stats.dmg, base.dmg, '本体伤害');
  approx(body.stats.rate, base.rate, '本体攻速');
  approx(body.stats.range, base.range, '本体射程');
  approx(mirror.stats.dmg, base.dmg * MIRROR_MUL, '镜像伤害');
  approx(mirror.stats.rate, base.rate * MIRROR_MUL, '镜像攻速');
  approx(mirror.stats.range, base.range * MIRROR_MUL, '镜像射程');
});

test('镜像次要属性（slow/dot/splash/chain/光环）×0.60', () => {
  const cases = [
    { type: 'frost', keys: ['slow', 'slowDur'] },
    { type: 'poison', keys: ['dot', 'dotDur'] },
    { type: 'arc', keys: ['chain'] },
    { type: 'shock', keys: ['splash', 'slow', 'slowDur', 'knockback'] },
    { type: 'banner', keys: ['buffDmg', 'buffRate'] },
  ];
  for (const { type, keys } of cases) {
    const sim = makeSim();
    const [bodyCell, mirrorCell] = findCells(sim, 2);
    placeBody(sim, type, bodyCell);
    assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true, `${type} 落镜像`);
    const mirror = sim.towerAt(mirrorCell.c, mirrorCell.r);
    const base = sim.previewStats(type, 0);
    for (const key of keys) {
      assert.ok(base[key] > 0, `${type} 基座 ${key} 非零`);
      approx(mirror.stats[key], base[key] * MIRROR_MUL, `${type} 镜像 ${key}`);
    }
  }
});

test('本体升级时镜像同步等级并重算属性', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const mirror = sim.towerAt(mirrorCell.c, mirrorCell.r);
  assert.equal(sim.upgradeTower(body), true);
  assert.equal(body.level, 1);
  assert.equal(mirror.level, 1, '镜像等级随本体同步');
  const base = sim.previewStats(TOWER_TYPE, 1);
  approx(mirror.stats.dmg, base.dmg * MIRROR_MUL, '升级后镜像伤害');
  approx(mirror.stats.range, base.range * MIRROR_MUL, '升级后镜像射程');
});

test('镜像不能单独升级', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const mirror = sim.towerAt(mirrorCell.c, mirrorCell.r);
  assert.equal(sim.upgradeCost(mirror), null);
  assert.equal(sim.upgradeTower(mirror), false);
  assert.equal(mirror.level, body.level, '镜像等级不变');
});

test('镜像单独出售：0 金消失，本体保留', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const mirror = sim.towerAt(mirrorCell.c, mirrorCell.r);
  const goldBefore = sim.gold;
  assert.equal(sim.sellValue(mirror), 0, '镜像 0 投资，出售价 0');
  assert.equal(sim.sellTower(mirror), 0);
  assert.equal(sim.gold, goldBefore, '出售镜像不产生金币');
  assert.equal(sim.towerAt(mirrorCell.c, mirrorCell.r), null, '镜像消失');
  assert.equal(sim.towerAt(bodyCell.c, bodyCell.r), body, '本体保留');
  assert.equal(sim.towers.length, 1);
});

test('本体出售时镜像一起消失', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const expected = sim.sellValue(body);
  assert.equal(sim.sellTower(body), expected, '只结算本体的投资');
  assert.equal(sim.towerAt(bodyCell.c, bodyCell.r), null);
  assert.equal(sim.towerAt(mirrorCell.c, mirrorCell.r), null, '镜像随本体消失');
  assert.equal(sim.towers.length, 0);
});

test('本体被摧毁时镜像一起消失', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  assert.equal(sim.removeTower(body, 'destroyed'), true);
  assert.equal(sim.towerAt(mirrorCell.c, mirrorCell.r), null, '镜像随本体消失');
  assert.equal(sim.towers.length, 0);
});

test('Esc 暂存不丢弃：cancelMirrorPlacement 保留槽，resumeMirrorPlacement 恢复落位', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.mirrorPlacing, true);
  assert.equal(sim.cancelMirrorPlacement(), true);
  assert.equal(sim.mirrorPlacing, false, 'Esc 退出落位模式');
  assert.equal(sim.pendingMirror, body, '待落位槽暂存不丢弃');
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), false, '退出落位模式后不能直接落');
  assert.equal(sim.resumeMirrorPlacement(), true);
  assert.equal(sim.mirrorPlacing, true);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true, '恢复后可落镜像');
  assert.ok(sim.towerAt(mirrorCell.c, mirrorCell.r));
});

test('待落位槽一次一个：新本体覆盖旧槽', () => {
  const sim = makeSim();
  const [c1, c2, c3] = findCells(sim, 3);
  const bodyA = placeBody(sim, TOWER_TYPE, c1);
  assert.equal(sim.pendingMirror, bodyA);
  const bodyB = placeBody(sim, TOWER_TYPE, c2);
  assert.equal(sim.pendingMirror, bodyB, '建新本体覆盖旧槽');
  assert.equal(sim.placeMirror(c3.c, c3.r), true);
  assert.equal(sim.towerAt(c3.c, c3.r).mirrorOf, bodyB.id, '只给最新的本体落镜像');
  assert.equal(sim.towers.length, 3, '本体A、本体B、B 的镜像');
  assert.equal(sim.towers.filter((t) => t.mirrorOf === bodyA.id).length, 0, '本体A 无镜像');
});

test('所有塔造价 ×1.45', () => {
  const sim = makeSim();
  for (const type of ['arrow', 'cannon', 'frost']) {
    assert.equal(sim.towerCost(type), Math.max(20, Math.round(TOWERS[type].cost * COST_MUL)), `${type} 造价`);
  }
  const plain = makeSim({ hex: null });
  for (const type of ['arrow', 'cannon', 'frost']) {
    assert.equal(plain.towerCost(type), Math.max(20, Math.round(TOWERS[type].cost)), `${type} 基础造价`);
  }
});

test('无海克斯时行为不变：不进入落位模式、不生成镜像、属性与造价照旧', () => {
  const sim = makeSim({ hex: null });
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  const body = placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.towers.length, 1);
  assert.equal(sim.mirrorPlacing, false, '无海克斯不进入落位模式');
  assert.equal(sim.pendingMirror, null);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), false, '无海克斯不落镜像');
  assert.equal(sim.towers.length, 1);
  assert.equal(body.mirrorOf, undefined);
  const base = sim.previewStats(TOWER_TYPE, 0);
  approx(body.stats.dmg, base.dmg, '无海克斯伤害');
  assert.equal(sim.towerCost(TOWER_TYPE), Math.max(20, Math.round(TOWERS[TOWER_TYPE].cost)));
});

test('读档后按 mirrorOf 格坐标补回镜像身份与 60% 属性', () => {
  const sim = makeSim();
  const [bodyCell, mirrorCell] = findCells(sim, 2);
  placeBody(sim, TOWER_TYPE, bodyCell);
  assert.equal(sim.placeMirror(mirrorCell.c, mirrorCell.r), true);
  const snap = sim.toSnapshot();
  assert.equal(snap.hexId, HEX);
  assert.equal(snap.towers.length, 2);
  // 快照里的 mirrorOf 存本体格坐标；本体自身不带 mirrorOf。
  const snapMirror = snap.towers.find((t) => t.c === mirrorCell.c && t.r === mirrorCell.r);
  const snapBody = snap.towers.find((t) => t.c === bodyCell.c && t.r === bodyCell.r);
  assert.ok(snapMirror && snapBody);
  assert.deepEqual(snapMirror.mirrorOf, { c: bodyCell.c, r: bodyCell.r });
  assert.equal(snapBody.mirrorOf, undefined);

  const restored = new Simulation({
    map: makeMap(),
    seed: SEED,
    difficulty: 'standard',
    gold: snap.gold,
    baseHp: snap.baseHp,
    maxBaseHp: snap.maxBaseHp,
    relics: [],
    towers: snap.towers,
    restored: true,
    hex: snap.hexId,
    hexState: snap.hexState,
    unlockedTowers: UNLOCKED,
    onToast: () => {},
  });
  const restoredBody = restored.towerAt(bodyCell.c, bodyCell.r);
  const restoredMirror = restored.towerAt(mirrorCell.c, mirrorCell.r);
  assert.ok(restoredBody);
  assert.ok(restoredMirror);
  assert.equal(restoredMirror.mirrorOf, restoredBody.id, '镜像身份补回');
  const base = restored.previewStats(TOWER_TYPE, 0);
  approx(restoredMirror.stats.dmg, base.dmg * MIRROR_MUL, '读档后镜像伤害仍是 60%');
  approx(restoredMirror.stats.range, base.range * MIRROR_MUL, '读档后镜像射程仍是 60%');
  assert.equal(restored.upgradeCost(restoredMirror), null, '读档后镜像仍不可单独升级');
});
