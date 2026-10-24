// 主海克斯运行时框架：钩子调用点、默认行为不变、塔生命、友方单位与快照往返。
// 全部用假海克斯（spy）验证「钩子被调用且能改变结果」，不依赖十个正式海克斯的数值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { TOWERS } from '../public/js/shared/data.js';
import { SAVE_VERSION, normalizeSnapshot } from '../public/js/shared/snapshot.js';
import { HexRuntime } from '../public/js/shared/hexes/runtime.js';
import { AllyRenderer } from '../public/js/render/ally-renderer.js';

const SEED = 'hex-runtime-seed';

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

// 假海克斯：形状与注册表定义一致（id + hooks），数值全部由测试注入。
function fakeHex(hooks = {}, id = 'test_hex') {
  return Object.freeze({ id, name: '测试海克斯', hooks: Object.freeze({ ...hooks }) });
}

function buildableCell(sim, skip = new Set()) {
  for (let r = 0; r < sim.map.rows; r++) {
    for (let c = 0; c < sim.map.cols; c++) {
      if (!skip.has(`${c},${r}`) && sim.canBuild(c, r)) return { c, r };
    }
  }
  throw new Error('地图没有可建造格');
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 1, 1, level, 0);
  sim.towers.push(tower);
  sim.recomputeTowerStats();
  return tower;
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(
    enemy,
    { hp: 100000, maxHp: 100000, armor: 0, boss: false, dead: false, slowUntil: 0, poisonUntil: 0 },
    overrides
  );
  return enemy;
}

function waveDef(index = 1) {
  return {
    index,
    groups: [],
    reward: 0,
    hpMul: 1,
    speedMul: 1,
    totalCount: 0,
    boss: false,
  };
}

test('无海克斯：运行时为空，等级/费用/进化与数据表一致', () => {
  const sim = makeSim();
  assert.equal(sim.hex, null);
  assert.equal(sim.hexRuntime.active, false);
  assert.deepEqual(sim.hexState, {});

  const tower = addTower(sim, 'arrow', 0);
  assert.equal(sim.towerMaxLevel(tower), TOWERS.arrow.levels.length);
  assert.equal(sim.upgradeCost(tower), TOWERS.arrow.levels[1].cost);
  assert.equal(sim.evolveTower(tower, 'arrow-longbow'), false, '未满级不能进化');

  // 塔生命默认 null = 无敌
  assert.equal(tower.maxHp, null);
  assert.equal(tower.hp, null);
  assert.equal(sim.damageTower(tower, 100), false);
  assert.ok(sim.towers.includes(tower));
});

test('onRunInit：基础 mods 之后调用，可写 hexState 与开局资源；读档不重放', () => {
  let seen = null;
  const hex = fakeHex({
    onRunInit(ctx) {
      seen = { mods: { ...ctx.sim.mods }, hasSim: ctx.sim instanceof Simulation };
      ctx.state.opened = true;
      ctx.sim.gold += 250;
    },
  });
  const sim = makeSim({ hex, gold: 100 });
  assert.equal(sim.gold, 350);
  assert.equal(sim.hexState.opened, true);
  assert.equal(seen?.hasSim, true, '钩子收到 ctx');
  assert.equal(seen?.mods.dmgAll, 0, '基础 mods 已完成聚合');

  const restored = makeSim({ hex, hexState: { opened: true }, gold: 350, restored: true });
  assert.equal(restored.gold, 350, '读档不重复结算开局效果');
});

test('modifyTowerStats：在 computeTowerStats 末尾生效并可改变结果', () => {
  const seen = [];
  const hex = fakeHex({
    modifyTowerStats(tower, stats, ctx) {
      seen.push({ tower, ctx });
      return { ...stats, dmg: stats.dmg * 2, rate: stats.rate + 0.5 };
    },
  });
  const sim = makeSim({ hex });
  const tower = addTower(sim, 'arrow', 0);
  const base = TOWERS.arrow.levels[0];
  assert.equal(sim.statsFor(tower).dmg, base.dmg * 2);
  assert.equal(sim.statsFor(tower).rate, base.rate + 0.5);
  assert.equal(seen[0].tower, tower);
  assert.equal(seen[0].ctx.sim, sim);
});

test('扩展等级：towerMaxLevel/upgradeCost 钩子让塔超过数据表上限', () => {
  const baseLevels = TOWERS.arrow.levels.length;
  const hex = fakeHex({
    towerMaxLevel(tower, base) {
      return base + 2;
    },
    upgradeCost(tower, base) {
      return base == null ? 200 : base;
    },
  });
  const sim = makeSim({ hex });
  const tower = addTower(sim, 'arrow', 0);
  assert.equal(sim.towerMaxLevel(tower), baseLevels + 2);

  for (let level = 1; level < baseLevels; level += 1) {
    assert.ok(sim.upgradeTower(tower), `数据表内升级到 ${level}`);
  }
  assert.equal(tower.level, baseLevels - 1);
  assert.equal(sim.upgradeCost(tower), 200, '扩展等级没有表行时由钩子给价');
  assert.ok(sim.upgradeTower(tower));
  assert.ok(sim.upgradeTower(tower));
  assert.equal(tower.level, baseLevels + 1);
  assert.equal(sim.upgradeCost(tower), null, '到达扩展上限');
  assert.equal(sim.upgradeTower(tower), false);
});

test('allowedEvolutions：一次应用多条进化，系数依次相乘', () => {
  const hex = fakeHex({
    allowedEvolutions(tower, base) {
      return base;
    },
  });
  const sim = makeSim({ hex });
  const tower = addTower(sim, 'arrow', TOWERS.arrow.levels.length - 1);
  const ids = TOWERS.arrow.evolutions.map((entry) => entry.id);

  assert.deepEqual(sim.evolutionOptions(tower).map((entry) => entry.id), ids);
  assert.equal(sim.evolveTower(tower, ids), true);
  assert.deepEqual(tower.evolutions, ids);
  assert.equal(tower.evolution, ids[0], '首个进化保持旧字段兼容');
  assert.equal(sim.canEvolve(tower), false);

  const mul = TOWERS.arrow.evolutions.reduce((acc, entry) => acc * (entry.mods.dmg ?? 1), 1);
  const expected = TOWERS.arrow.levels[TOWERS.arrow.levels.length - 1].dmg * mul;
  assert.ok(Math.abs(sim.statsFor(tower).dmg - expected) < 1e-9);
});

test('建造/升级/移除钩子：canBuild 可拦截，三态钩子依次触发', () => {
  const events = [];
  const hex = fakeHex({
    canBuild(type, c, r) {
      events.push(['checked', type, c, r]);
      return false;
    },
    onTowerBuilt(tower) {
      events.push(['built', tower.type]);
      tower.maxHp = 10;
      tower.hp = 10;
    },
    onTowerUpgraded(tower) {
      events.push(['upgraded', tower.level]);
    },
    onTowerRemoved(tower, reason) {
      events.push(['removed', reason]);
    },
  });
  const sim = makeSim({ hex, gold: 1000 });
  const blocked = buildableCell(sim);
  assert.equal(sim.placeTower('arrow', blocked.c, blocked.r), false, 'canBuild 钩子拦截');
  assert.deepEqual(events[0], ['checked', 'arrow', blocked.c, blocked.r]);
  assert.equal(sim.towers.length, 0);
  assert.equal(sim.gold, 1000, '拦截时不扣费');

  // 放开拦截后完成一次建造/升级/出售
  const openHex = fakeHex({ ...hex.hooks, canBuild: () => true });
  const sim2 = makeSim({ hex: openHex, gold: 1000 });
  const cell = buildableCell(sim2);
  assert.equal(sim2.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim2.towerAt(cell.c, cell.r);
  assert.equal(tower.maxHp, 10, 'onTowerBuilt 可写塔生命');
  assert.ok(sim2.upgradeTower(tower));
  const value = sim2.sellTower(tower);
  assert.equal(value, Math.floor(tower.invested * 0.7));
  assert.deepEqual(
    events.filter((entry) => entry[0] !== 'checked').map((entry) => entry[0]),
    ['built', 'upgraded', 'removed']
  );
  assert.deepEqual(events.filter((entry) => entry[0] === 'removed')[0], ['removed', 'sold']);
  assert.equal(sim2.towerAt(cell.c, cell.r), null);
});

test('sellRatio：海克斯可改写出售返还比例', () => {
  const hex = fakeHex({
    sellRatio() {
      return 0.35;
    },
  });
  const sim = makeSim({ hex, gold: 1000 });
  const cell = buildableCell(sim);
  assert.equal(sim.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim.towerAt(cell.c, cell.r);
  assert.equal(sim.sellValue(tower), Math.floor(tower.invested * 0.35));
});

test('波次钩子：onWaveStart 的临时 mod 生效，onWaveEnd 后可清理', () => {
  const starts = [];
  const ends = [];
  const hex = fakeHex({
    onWaveStart(wave, ctx) {
      starts.push(wave);
      ctx.addTempMod('dmgAll', 0.5);
      ctx.state.waves = (ctx.state.waves || 0) + 1;
    },
    onWaveEnd(wave, ctx) {
      ends.push(wave);
      assert.equal(ctx.sim.mods.dmgAll, 0.5, '波末仍可读到本波临时 mod');
    },
  });
  const sim = makeSim({ hex });
  assert.equal(sim.beginWave(waveDef(1)), true);
  assert.equal(sim.mods.dmgAll, 0.5, '临时 mod 已进入聚合状态');
  assert.equal(sim.hexState.waves, 1);

  sim.completeWave();
  assert.deepEqual(starts, [1]);
  assert.deepEqual(ends, [1]);
  assert.equal(sim.mods.dmgAll, 0, '波末清理临时 mod');
  assert.equal(sim.hexState.waves, 1, 'hexState 跨波保留');
});

test('战斗钩子：onHit 带出手塔与伤害，onEnemyKilled/onLeak 均可观察', () => {
  const hits = [];
  const kills = [];
  const leaks = [];
  const hex = fakeHex({
    onHit(enemy, tower, damage) {
      hits.push({ enemy, tower, damage });
    },
    onEnemyKilled(enemy) {
      kills.push(enemy);
    },
    onLeak(enemy) {
      leaks.push(enemy);
    },
  });
  const sim = makeSim({ hex });
  const tower = addTower(sim, 'arrow', 0);
  const enemy = addEnemy(sim, { hp: 100, maxHp: 100 });

  sim.dealDamage(enemy, 30, tower.type, { tower });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tower, tower);
  assert.equal(hits[0].damage, 30);

  sim.dealDamage(enemy, 1000, tower.type, { tower });
  assert.equal(kills.length, 1);
  assert.equal(kills[0], enemy);

  const leakEnemy = addEnemy(sim, { hp: 10, maxHp: 10, dmg: 1 });
  sim.leak(leakEnemy);
  assert.deepEqual(leaks, [leakEnemy]);
});

test('遗物钩子：onRelicGained 与 relicOfferCount/relicRerollCost 查询', () => {
  const gained = [];
  const hex = fakeHex({
    onRelicGained(relic) {
      gained.push(relic);
    },
    relicOfferCount(base) {
      return base + 1;
    },
    relicRerollCost(base, count) {
      return count > 0 ? 0 : base;
    },
  });
  const sim = makeSim({ hex });
  assert.equal(sim.addRelic('sharp').applied, true);
  assert.deepEqual(gained, [{ id: 'sharp', level: 1 }]);
  assert.equal(sim.hexRuntime.relicOfferCount(3), 4);
  assert.equal(sim.hexRuntime.relicRerollCost(50, 0), 50);
  assert.equal(sim.hexRuntime.relicRerollCost(50, 2), 0);
  // 未提供钩子时回退默认值（服务端可读同一入口）
  const bare = new HexRuntime('undead_legion');
  assert.equal(bare.relicOfferCount(3), 3);
  assert.equal(bare.relicRerollCost(50, 1), 50);
});

test('塔生命：归零后移除塔、释放塔位，快照记录并可恢复 hp/maxHp', () => {
  const removed = [];
  const hex = fakeHex({
    onTowerBuilt(tower) {
      tower.maxHp = 10;
      tower.hp = 10;
    },
    onTowerRemoved(tower, reason) {
      removed.push(reason);
    },
  });
  const saved = [];
  const sim = makeSim({ hex, onSave: (snapshot) => saved.push(snapshot) });
  const cell = buildableCell(sim);
  assert.equal(sim.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim.towerAt(cell.c, cell.r);
  assert.equal(tower.maxHp, 10);
  assert.equal(tower.hp, 10);
  assert.ok(saved.length > 0, '整备阶段建造即写快照');

  assert.equal(sim.damageTower(tower, 4), false);
  assert.equal(tower.hp, 6);

  const snap = sim.toSnapshot();
  assert.equal(snap.towers[0].maxHp, 10);
  assert.equal(snap.towers[0].hp, 6);

  const restored = makeSim({ hex, towers: snap.towers, clearedWave: snap.clearedWave, restored: true });
  const restoredTower = restored.towerAt(cell.c, cell.r);
  assert.ok(restoredTower);
  assert.equal(restoredTower.maxHp, 10);
  assert.equal(restoredTower.hp, 6, '快照恢复塔生命');

  assert.equal(sim.damageTower(tower, 6), true);
  assert.equal(sim.towers.includes(tower), false);
  assert.equal(sim.towerAt(cell.c, cell.r), null);
  assert.equal(sim.canBuild(cell.c, cell.r), true, '塔位已释放');
  assert.deepEqual(removed, ['destroyed']);
});

test('友方单位：更新存活时间、攻击最近敌人、过期清理', () => {
  const sim = makeSim();
  const enemy = addEnemy(sim, { hp: 100, maxHp: 100 });
  enemy.x = 10;
  enemy.y = 10;
  const ally = sim.spawnAlly({ x: 10, y: 10.5, dmg: 12, range: 3, rate: 2, ttl: 1 });
  assert.ok(ally);
  assert.equal(sim.allies.length, 1);

  sim.updateAllies(0.1);
  assert.equal(enemy.hp, 88, '攻击最近的敌人');
  assert.ok(ally.cd > 0, '攻击后进入冷却');

  sim.updateAllies(0.6);
  assert.equal(enemy.hp, 76, '冷却结束后再次攻击');

  sim.updateAllies(0.5);
  assert.equal(sim.allies.length, 0, '过期盟友被清理');
  assert.equal(sim.spawnAlly({}), null, '缺少坐标不生成盟友');
});

test('友方渲染器：无盟友零绘制，有盟友时只读绘制且不依赖 DOM', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        return (..._args) => {
          calls.push(String(key));
          return undefined;
        };
      },
      set() {
        return true;
      },
    }
  );
  const renderer = new AllyRenderer({ allies: [] });
  renderer.render(ctx, 0, {});
  assert.equal(calls.length, 0, '空列表不绘制');

  renderer.game = {
    allies: [{ x: 1, y: 1, ttl: 0.5, life: 1, r: 0.25, angle: 0, color: '#cfe8ff', recoil: 0 }],
  };
  renderer.render(ctx, 1, { glow: true });
  assert.ok(calls.includes('save'));
  assert.ok(calls.includes('arc'));
  assert.ok(calls.includes('restore'));
});

test('快照 v6：hexId/hexState 往返，旧快照按无海克斯恢复', () => {
  const sim = makeSim({ hex: 'one_tower' });
  sim.hexState.counter = 1;
  const snap = sim.toSnapshot();
  assert.equal(snap.version, SAVE_VERSION);
  assert.equal(snap.hexId, 'one_tower');
  assert.deepEqual(snap.hexState, { counter: 1 });

  const restored = makeSim({ hex: snap.hexId, hexState: snap.hexState });
  assert.equal(restored.hex.id, 'one_tower');
  assert.equal(restored.hexState.counter, 1);
  assert.notEqual(restored.hexState, snap.hexState, '恢复状态是独立拷贝');

  // 旧快照（无 hex 字段）按无海克斯恢复
  const legacy = normalizeSnapshot({ version: 3, wave: 0, relics: [] });
  assert.equal('hexId' in legacy, false);
  const plain = makeSim({ hex: legacy.hexId, hexState: legacy.hexState });
  assert.equal(plain.hex, null);
  assert.deepEqual(plain.hexState, {});

  // 未知 id 与非法状态一律按无海克斯处理
  assert.equal(new HexRuntime('not_a_hex', { x: 1 }).active, false);
  assert.deepEqual(new HexRuntime(null, ['bad']).state, {});
});
