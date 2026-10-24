// 主海克斯「镜像工程」：对称格生成/顺时针找位、60% 属性、等级与移除同步、造价 135%、不递归、读档修复。
// 全部走 HEX-002 的公开接口（Simulation + 钩子），不 mock 模拟层内部步骤。
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
const COST_MUL = 1.35;
const UNLOCKED = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];

// 与实现同序的顺时针一圈（上 → 右上 → 右 → 右下 → 下 → 左下 → 左 → 左上），用于构造/校验用例。
const CLOCKWISE = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function makeSim(opts = {}) {
  const { map = generateMap(SEED), hex = HEX, ...rest } = opts;
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

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

// 找一对「本体格 + 对称格」都可建的格子；需要时额外要求顺时针第一个邻格（正上方）可建，
// 或整个 8 邻环都是可建地形且本体不占环（用于「全满不生成」）。
function findPair(sim, { requireFirstNeighbor = false, requireFullRing = false } = {}) {
  const { cols, rows } = sim.map;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!sim.canBuild(c, r)) continue;
      const sc = cols - 1 - c;
      const sr = rows - 1 - r;
      if (sc === c && sr === r) continue;
      if (!sim.canBuild(sc, sr)) continue;
      if (requireFirstNeighbor) {
        const nc = sc;
        const nr = sr - 1;
        if (nc === c && nr === r) continue;
        if (!sim.canBuild(nc, nr)) continue;
      }
      if (requireFullRing) {
        const inBounds = CLOCKWISE.every(([dc, dr]) => {
          const x = sc + dc;
          const y = sr + dr;
          return x >= 0 && y >= 0 && x < cols && y < rows;
        });
        if (!inBounds) continue;
        // 本体不能落在环上：测试要保留本体格可建。
        if (CLOCKWISE.some(([dc, dr]) => sc + dc === c && sr + dr === r)) continue;
        if (!CLOCKWISE.every(([dc, dr]) => sim.map.buildable[sr + dr][sc + dc])) continue;
      }
      return { c, r, sc, sr };
    }
  }
  return null;
}

function placeBody(sim, pair) {
  assert.equal(sim.placeTower(TOWER_TYPE, pair.c, pair.r), true, `建造本体 (${pair.c},${pair.r})`);
  const body = sim.towerAt(pair.c, pair.r);
  assert.ok(body, '本体应已落成');
  return body;
}

test('定义：implemented、scoreMul 与镜像工程钩子齐备', () => {
  assert.equal(mirrorEngineering.id, HEX);
  assert.equal(mirrorEngineering.scoreMul, 1.1);
  assert.equal(mirrorEngineering.implemented, true);
  assert.equal(HEX_BY_ID[HEX], mirrorEngineering, '注册表指向同一模块');
  for (const name of [
    'buildCost',
    'onTowerBuilt',
    'onTowerUpgraded',
    'onTowerRemoved',
    'upgradeCost',
    'modifyTowerStats',
  ]) {
    assert.equal(typeof mirrorEngineering.hooks[name], 'function', `钩子 ${name}`);
  }
});

test('对称格生成镜像：同类型同等级、0 投资、mirrorOf 指向本体', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  assert.ok(pair, '峡谷地图应存在可对称建造的格子对');
  const body = placeBody(sim, pair);
  const mirror = sim.towerAt(pair.sc, pair.sr);
  assert.ok(mirror, `对称格 (${pair.sc},${pair.sr}) 应生成镜像`);
  assert.equal(mirror.type, body.type);
  assert.equal(mirror.level, body.level);
  assert.equal(mirror.invested, 0, '镜像不消耗金币');
  assert.equal(mirror.mirrorOf, body.id);
  assert.equal(sim.towers.length, 2, '只有本体与一座镜像（不递归）');
  // 建造只扣本体造价：镜像 0 投资，金币差额等于本体造价。
  assert.equal(body.invested, sim.towerCost(TOWER_TYPE));
  assert.equal(sim.gold, 100000 - sim.towerCost(TOWER_TYPE));
});

test('镜像伤害/攻速/射程 ×0.60，本体保持 100%', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  const mirror = sim.towerAt(pair.sc, pair.sr);
  const base = sim.previewStats(TOWER_TYPE, 0);
  approx(body.stats.dmg, base.dmg, '本体伤害');
  approx(body.stats.rate, base.rate, '本体攻速');
  approx(body.stats.range, base.range, '本体射程');
  approx(mirror.stats.dmg, base.dmg * MIRROR_MUL, '镜像伤害');
  approx(mirror.stats.rate, base.rate * MIRROR_MUL, '镜像攻速');
  approx(mirror.stats.range, base.range * MIRROR_MUL, '镜像射程');
});

test('对称格不可建时顺时针找最近的空可建格', () => {
  const map = generateMap(SEED);
  const sim = makeSim({ map });
  const pair = findPair(sim, { requireFirstNeighbor: true });
  assert.ok(pair, '应存在「对称格可禁、正上方可建」的格子对');
  map.buildable[pair.sr][pair.sc] = false;
  assert.equal(sim.canBuild(pair.sc, pair.sr), false);
  const body = placeBody(sim, pair);
  const first = { c: pair.sc, r: pair.sr - 1 };
  const mirror = sim.towerAt(first.c, first.r);
  assert.ok(mirror, '应按顺时针顺序落在第一个空可建格（正上方）');
  assert.equal(mirror.mirrorOf, body.id);
  assert.equal(sim.towerAt(pair.sc, pair.sr), null, '不可建的对称格不生成');
});

test('对称格与 8 邻格全满时不生成镜像', () => {
  const map = generateMap(SEED);
  const sim = makeSim({ map });
  const pair = findPair(sim, { requireFullRing: true });
  assert.ok(pair, '应存在 8 邻环全可建的格子对');
  map.buildable[pair.sr][pair.sc] = false;
  for (const [dc, dr] of CLOCKWISE) map.buildable[pair.sr + dr][pair.sc + dc] = false;
  const body = placeBody(sim, pair);
  assert.equal(sim.towers.length, 1, '没有可用格位时只保留本体');
  assert.equal(sim.towers[0], body);
  assert.equal(body.mirrorOf, undefined);
});

test('本体升级时镜像同步等级并重算属性', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  const mirror = sim.towerAt(pair.sc, pair.sr);
  assert.equal(sim.upgradeTower(body), true);
  assert.equal(body.level, 1);
  assert.equal(mirror.level, 1, '镜像等级随本体同步');
  const base = sim.previewStats(TOWER_TYPE, 1);
  approx(mirror.stats.dmg, base.dmg * MIRROR_MUL, '升级后镜像伤害');
  approx(mirror.stats.rate, base.rate * MIRROR_MUL, '升级后镜像攻速');
  approx(mirror.stats.range, base.range * MIRROR_MUL, '升级后镜像射程');
});

test('镜像不能单独升级', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  const mirror = sim.towerAt(pair.sc, pair.sr);
  assert.equal(sim.upgradeCost(mirror), null);
  assert.equal(sim.upgradeTower(mirror), false);
  assert.equal(mirror.level, body.level, '镜像等级不变');
});

test('镜像不能单独出售：不出金币且原位回位', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  const mirror = sim.towerAt(pair.sc, pair.sr);
  const goldBefore = sim.gold;
  assert.equal(sim.sellValue(mirror), 0, '镜像 0 投资，出售价 0');
  assert.equal(sim.sellTower(mirror), 0);
  assert.equal(sim.gold, goldBefore, '出售镜像不产生金币');
  const restored = sim.towerAt(pair.sc, pair.sr);
  assert.ok(restored, '镜像应回到原位');
  assert.equal(restored.mirrorOf, body.id);
  assert.equal(sim.towers.length, 2, '本体与镜像都还在');
  const base = sim.previewStats(TOWER_TYPE, 0);
  approx(restored.stats.dmg, base.dmg * MIRROR_MUL, '回位后仍是 60% 属性');
});

test('本体出售时镜像一起消失', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  assert.ok(sim.towerAt(pair.sc, pair.sr));
  const expected = sim.sellValue(body);
  assert.equal(sim.sellTower(body), expected, '只结算本体的投资');
  assert.equal(sim.towerAt(pair.c, pair.r), null);
  assert.equal(sim.towerAt(pair.sc, pair.sr), null, '镜像随本体消失');
  assert.equal(sim.towers.length, 0);
});

test('本体被摧毁时镜像一起消失', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  assert.equal(sim.removeTower(body, 'destroyed'), true);
  assert.equal(sim.towerAt(pair.sc, pair.sr), null, '镜像随本体消失');
  assert.equal(sim.towers.length, 0);
});

test('所有塔造价 ×1.35', () => {
  const sim = makeSim();
  for (const type of ['arrow', 'cannon', 'frost']) {
    assert.equal(sim.towerCost(type), Math.max(20, Math.round(TOWERS[type].cost * COST_MUL)), `${type} 造价`);
  }
  const plain = makeSim({ hex: null });
  for (const type of ['arrow', 'cannon', 'frost']) {
    assert.equal(plain.towerCost(type), Math.max(20, Math.round(TOWERS[type].cost)), `${type} 基础造价`);
  }
});

test('无海克斯时行为不变：不生成镜像、属性与造价照旧', () => {
  const sim = makeSim({ hex: null });
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  assert.equal(sim.towers.length, 1);
  assert.equal(sim.towerAt(pair.sc, pair.sr), null);
  assert.equal(body.mirrorOf, undefined);
  const base = sim.previewStats(TOWER_TYPE, 0);
  approx(body.stats.dmg, base.dmg, '无海克斯伤害');
  assert.equal(sim.towerCost(TOWER_TYPE), Math.max(20, Math.round(TOWERS[TOWER_TYPE].cost)));
});

test('读档后按镜像格记录补回镜像身份与 60% 属性', () => {
  const sim = makeSim();
  const pair = findPair(sim);
  const body = placeBody(sim, pair);
  const before = sim.towerAt(pair.sc, pair.sr);
  assert.ok(before);
  const snap = sim.toSnapshot();
  assert.equal(snap.hexId, HEX);
  assert.ok(Array.isArray(snap.hexState?.mirrorSites), '镜像格写进 hexState');
  assert.equal(snap.towers.length, 2);
  // 快照本身不含 mirrorOf：模拟层的塔序列化只保留 type/c/r/level/invested。
  assert.ok(snap.towers.every((tower) => tower.mirrorOf === undefined));

  const restored = new Simulation({
    map: generateMap(SEED),
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
  const restoredBody = restored.towerAt(pair.c, pair.r);
  const restoredMirror = restored.towerAt(pair.sc, pair.sr);
  assert.ok(restoredBody);
  assert.ok(restoredMirror);
  assert.equal(restoredMirror.mirrorOf, restoredBody.id, '镜像身份补回');
  const base = restored.previewStats(TOWER_TYPE, 0);
  approx(restoredMirror.stats.dmg, base.dmg * MIRROR_MUL, '读档后镜像伤害仍是 60%');
  approx(restoredMirror.stats.range, base.range * MIRROR_MUL, '读档后镜像射程仍是 60%');
  assert.equal(restored.upgradeCost(restoredMirror), null, '读档后镜像仍不可单独升级');
});
