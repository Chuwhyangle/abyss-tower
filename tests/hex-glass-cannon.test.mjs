// 主海克斯「玻璃大炮」：输出倍率、5 点塔生命、漏怪伤塔、摧毁后可重建与快照往返。
// 全部走 HEX-002 的公开接口（Simulation + 钩子），不 mock 模拟层内部步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { buildCandidate, generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import { HEX_BY_ID } from '../public/js/shared/hexes.js';
import glassCannon from '../public/js/shared/hexes/glass-cannon.js';

const SEED = 'hex-glass-cannon-seed';
const HEX = 'glass_cannon';
const TOWER_TYPE = 'arrow';

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
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'],
    onToast: () => {},
    hex,
    ...rest,
  });
}

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

function place(sim, c, r) {
  assert.equal(sim.placeTower(TOWER_TYPE, c, r), true, `建造 (${c},${r})`);
  return sim.towerAt(c, r);
}

function leakOnce(sim, lane = 0) {
  sim.spawnEnemy('grunt', lane);
  const enemy = sim.enemies[sim.enemies.length - 1];
  // 只关心漏怪本身：固定 1 点基地伤害，避免依赖波次数据。
  enemy.dmg = 1;
  sim.leak(enemy);
  return enemy;
}

test('定义：implemented、scoreMul 与四个钩子齐备', () => {
  assert.equal(glassCannon.id, HEX);
  assert.equal(glassCannon.scoreMul, 1.15);
  assert.equal(glassCannon.implemented, true);
  assert.equal(HEX_BY_ID[HEX], glassCannon, '注册表指向同一模块');
  for (const name of ['onRunInit', 'onTowerBuilt', 'modifyTowerStats', 'onLeak']) {
    assert.equal(typeof glassCannon.hooks[name], 'function', `钩子 ${name}`);
  }
});

test('onRunInit 写入 towerMaxHp=5，读档从 hexState 恢复而不重放', () => {
  const sim = makeSim();
  assert.equal(sim.hex.id, HEX);
  assert.equal(sim.hexState.towerMaxHp, 5);

  const restored = makeSim({ hexState: { towerMaxHp: 5 }, restored: true });
  assert.equal(restored.hexState.towerMaxHp, 5, '读档保留快照里的上限');
  assert.equal(restored.towers.length, 0, 'onRunInit 不重复执行');
});

test('伤害 ×1.70、攻速 ×1.10，乘在最终属性上', () => {
  const plain = makeSim({ hex: null });
  const boosted = makeSim();
  for (const [type, level] of [
    [TOWER_TYPE, 0],
    ['cannon', 1],
  ]) {
    const base = TOWERS[type].levels[level];
    const before = plain.previewStats(type, level);
    const after = boosted.previewStats(type, level);
    approx(before.dmg, base.dmg, `${type} 无海克斯伤害不变`);
    approx(after.dmg, before.dmg * 1.7, `${type} 伤害 ×1.70`);
    approx(after.rate, before.rate * 1.1, `${type} 攻速 ×1.10`);
    approx(after.range, before.range, `${type} 射程不变`);
  }
});

test('每座塔 5/5 生命，升级与遗物都不会提高上限', () => {
  const sim = makeSim();
  const tower = place(sim, 20, 8);
  assert.equal(tower.maxHp, 5);
  assert.equal(tower.hp, 5);

  assert.equal(sim.upgradeTower(tower), true);
  assert.equal(tower.maxHp, 5, '升级不提高上限');
  assert.equal(tower.hp, 5);

  assert.equal(sim.addRelic('sharp').applied, true);
  sim.recomputeTowerStats();
  assert.equal(tower.maxHp, 5, '遗物重算不提高上限');
  assert.equal(tower.hp, 5);

  // 掉血后重算不回满。
  assert.equal(sim.damageTower(tower, 2), false);
  sim.recomputeTowerStats();
  assert.equal(tower.maxHp, 5);
  assert.equal(tower.hp, 3);
});

test('5 次漏怪摧毁车道内距基地最近的塔，金币不返还', () => {
  const sim = makeSim();
  // 基地在 (20.5, 9.5)：三座塔距离分别 2、1.414、1，最近的是最后建造的 (20,8)。
  const far = place(sim, 20, 7);
  const mid = place(sim, 19, 8);
  const near = place(sim, 20, 8);
  const goldAfterBuild = sim.gold;
  const baseHpAfterBuild = sim.baseHp;

  for (let hit = 1; hit <= 5; hit += 1) {
    leakOnce(sim, 0);
    assert.equal(near.hp, 5 - hit, `第 ${hit} 次漏怪打到最近的塔`);
    assert.equal(mid.hp, 5, '更远的塔不受影响');
    assert.equal(far.hp, 5, '更远的塔不受影响');
  }

  assert.equal(sim.towers.includes(near), false, '归零后塔被移除');
  assert.equal(sim.towerAt(20, 8), null, '塔位空出');
  assert.deepEqual(sim.towers, [far, mid]);
  assert.equal(sim.gold, goldAfterBuild, '已投入金币不返还');
  assert.equal(sim.baseHp, baseHpAfterBuild - 5, '漏怪仍按原规则扣基地生命');
});

test('同距离时取 id 最小的塔（与数组顺序无关）', () => {
  const sim = makeSim();
  // (21,7) 与 (19,7) 到基地 (20.5,9.5) 距离相同；先建的 id 更小。
  const first = place(sim, 21, 7);
  const second = place(sim, 19, 7);
  assert.ok(first.id < second.id);
  approx(
    Math.hypot(first.x - sim.map.base.x, first.y - sim.map.base.y),
    Math.hypot(second.x - sim.map.base.x, second.y - sim.map.base.y),
    '两塔到基地距离相同'
  );

  // 打乱数组顺序：选择依据必须是 id 而不是遍历顺序。
  sim.towers.reverse();
  leakOnce(sim, 0);
  assert.equal(first.hp, 4, 'id 更小的塔受伤');
  assert.equal(second.hp, 5, '同距离的另一座不受伤');
});

test('只伤害漏怪所在车道的塔', () => {
  const map = buildCandidate(SEED, 'twin', null, 0);
  assert.ok(map.lanes.length >= 2, '双径地图有两条车道');
  const sim = makeSim({ map });
  // 车道 0 的塔离基地更远，但仍应优先于「几何上更近」的车道 1 塔被选中。
  assert.equal(sim.laneProgressNear(0, 0).lane, 0);
  assert.equal(sim.laneProgressNear(0, 7).lane, 1);
  const onLane0 = place(sim, 0, 0);
  const onLane1 = place(sim, 0, 7);

  leakOnce(sim, 0);
  assert.equal(onLane0.hp, 4, '车道 0 的塔受伤');
  assert.equal(onLane1.hp, 5, '另一条车道的塔不受影响');

  leakOnce(sim, 1);
  assert.equal(onLane1.hp, 4, '漏怪换车道后伤害切换目标');
  assert.equal(onLane0.hp, 4);
});

test('没有塔时漏怪不报错，也没有额外效果', () => {
  const sim = makeSim();
  assert.equal(sim.towers.length, 0);
  assert.doesNotThrow(() => leakOnce(sim, 0));
  assert.equal(sim.towers.length, 0);
  assert.equal(sim.baseHp, 19, '基地生命照常扣除');
  assert.equal(sim.gold, 100000);
});

test('塔被摧毁后同格可重建，新塔满血', () => {
  const sim = makeSim();
  const tower = place(sim, 20, 8);
  assert.equal(sim.damageTower(tower, 5), true);
  assert.equal(sim.towerAt(20, 8), null);
  assert.equal(sim.canBuild(20, 8), true, '塔位已释放');

  const rebuilt = place(sim, 20, 8);
  assert.ok(rebuilt);
  assert.notEqual(rebuilt.id, tower.id);
  assert.equal(rebuilt.maxHp, 5);
  assert.equal(rebuilt.hp, 5);
});

test('快照保留塔 hp，读档恢复同一数值与倍率', () => {
  const sim = makeSim();
  const tower = place(sim, 20, 8);
  assert.equal(sim.damageTower(tower, 2), false);
  assert.equal(tower.hp, 3);

  const snapshot = sim.toSnapshot();
  assert.equal(snapshot.hexId, HEX);
  assert.equal(snapshot.hexState.towerMaxHp, 5);
  assert.equal(snapshot.towers[0].maxHp, 5);
  assert.equal(snapshot.towers[0].hp, 3);

  const restored = makeSim({
    towers: snapshot.towers,
    hexState: snapshot.hexState,
    clearedWave: snapshot.clearedWave,
    restored: true,
  });
  const saved = restored.towerAt(20, 8);
  assert.ok(saved, '塔随快照恢复');
  assert.equal(saved.maxHp, 5);
  assert.equal(saved.hp, 3, '快照 hp 保持，不因重算回满');

  const plain = makeSim({ hex: null });
  approx(restored.statsFor(saved).dmg, plain.previewStats(TOWER_TYPE, 0).dmg * 1.7, '读档后伤害倍率仍在');
  approx(restored.statsFor(saved).rate, plain.previewStats(TOWER_TYPE, 0).rate * 1.1, '读档后攻速倍率仍在');
});

test('无海克斯时行为不变：塔无敌、不伤塔、属性照旧', () => {
  const sim = makeSim({ hex: null });
  assert.equal(sim.hex, null);
  assert.equal(sim.hexRuntime.active, false);
  assert.deepEqual(sim.hexState, {});

  const tower = place(sim, 20, 8);
  assert.equal(tower.maxHp, null, '默认无敌');
  assert.equal(tower.hp, null);
  approx(sim.statsFor(tower).dmg, TOWERS[TOWER_TYPE].levels[0].dmg, '伤害不变');
  approx(sim.statsFor(tower).rate, TOWERS[TOWER_TYPE].levels[0].rate, '攻速不变');

  assert.equal(sim.damageTower(tower, 100), false);
  for (let i = 0; i < 5; i += 1) assert.doesNotThrow(() => leakOnce(sim, 0));
  assert.equal(sim.towers.includes(tower), true, '漏怪不摧毁塔');
  assert.equal(tower.hp, null);
  assert.equal(sim.baseHp, 15);
});
