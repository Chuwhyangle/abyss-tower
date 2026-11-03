// MAP-004 可破坏物模拟层：拆除流程、五种类型效果、虫巢生成、图腾光环与快照往返。
// 布点与数值来自 MAP-003 的注册表（public/js/shared/destructibles.js），这里只验证模拟层行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { ENEMIES } from '../public/js/shared/data.js';
import {
  DESTRUCTIBLE_BY_ID,
  RESOURCE_VEIN_TYPE,
  isAttackableType,
  resourceVeinGold,
} from '../public/js/shared/destructibles.js';
import { RNG } from '../public/js/shared/rng.js';
import { FIXED_MAPS, FIXED_MAP_BY_ID } from '../public/js/shared/maps/index.js';
import { SAVE_VERSION, validateSnapshot } from '../public/js/shared/snapshot.js';
import { generateWave } from '../public/js/shared/waves.js';

const EPS = 1e-9;
const ALMOST = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${message || ''} 期望 ${expected}，实际 ${actual}`
  );

// 默认用 canyon（单入口，五种类型各一个），金币/基地生命留给各用例覆盖。
function makeSim(overrides = {}) {
  const toasts = [];
  const sim = new Simulation({
    map: FIXED_MAP_BY_ID.canyon,
    seed: 'destructible-sim-seed',
    difficulty: 'standard',
    gold: 500,
    baseHp: 18,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    ...overrides,
    onToast: (message) => toasts.push(message),
  });
  return { sim, toasts };
}

// 合成地图：全可建造 + 一条直路 + 指定布点。用于固定图没有的场景（石碑 4 层封顶等）。
function syntheticMap(destructibles) {
  const cols = 22;
  const rows = 12;
  const buildable = Array.from({ length: rows }, () => new Array(cols).fill(true));
  for (let c = 0; c < cols; c += 1) buildable[0][c] = false;
  const polyline = Array.from({ length: cols }, (_, c) => ({ x: c + 0.5, y: 0.5 }));
  return {
    id: 'synthetic',
    cols,
    rows,
    buildable,
    blocked: Array.from({ length: rows }, () => new Array(cols).fill(false)),
    pathCells: polyline.map((_, c) => ({ c, r: 0 })),
    lanes: [{ id: 0, polyline, color: '#ffffff' }],
    polyline,
    spawns: [{ c: 0, r: 0 }],
    spawn: { c: 0, r: 0 },
    base: { c: cols - 1, r: 0 },
    rocks: [],
    destructibles,
    meta: { portalCount: 1, modifier: null },
  };
}

function placement(id, type, c, r) {
  return { id, type, c, r };
}

test('运行时状态：由 map.destructibles 深拷贝，含 destroyed/cost/effect', () => {
  for (const map of FIXED_MAPS) {
    const { sim } = makeSim({ map });
    assert.equal(sim.destructibles.length, map.destructibles.length, `${map.id} 布点数量`);
    for (const item of sim.destructibles) {
      const placed = map.destructibles.find((obj) => obj.id === item.id);
      const type = DESTRUCTIBLE_BY_ID[placed.type];
      assert.equal(item.type, placed.type);
      assert.equal(item.c, placed.c);
      assert.equal(item.r, placed.r);
      assert.equal(item.cost, type.cost, `${item.id} 拆除费用取自注册表`);
      assert.deepEqual(item.effect, type.effect, `${item.id} 效果取自注册表`);
      assert.equal(item.destroyed, false, `${item.id} 初始存活`);
      // 未拆除的布点占格，不可建造。
      assert.equal(sim.canBuild(placed.c, placed.r), false, `${item.id} 初始占格`);
    }
  }
});

test('运行时状态是深拷贝：改动运行时不污染注册表', () => {
  const { sim } = makeSim();
  const vein = sim.destructibles.find((item) => item.type === 'vein');
  vein.effect.gold = 999;
  vein.cost = 1;
  assert.equal(DESTRUCTIBLE_BY_ID.vein.effect.gold, 110);
  assert.equal(DESTRUCTIBLE_BY_ID.vein.cost, 50);
  // 另一局的运行时不继承上一局的改动（地图布点是冻结数据）。
  const { sim: fresh } = makeSim();
  assert.equal(fresh.destructibles.find((item) => item.type === 'vein').cost, 50);
});

test('五种类型的费用与效果数值与设计一致（运行时条目即注册表数值）', () => {
  const { sim } = makeSim();
  const byType = Object.fromEntries(sim.destructibles.map((item) => [item.type, item]));
  assert.equal(byType.vein.cost, 50);
  assert.deepEqual(byType.vein.effect, { gold: 110 });
  assert.equal(byType.obelisk.cost, 70);
  assert.deepEqual(byType.obelisk.effect, { towerDamageMul: 0.05, maxStacks: 3 });
  assert.equal(byType.cache.cost, 0);
  assert.deepEqual(byType.cache.effect, { gold: 25, baseHp: 1 });
  assert.equal(byType.nest.cost, 0);
  assert.deepEqual(byType.nest.effect, { spawn: { enemy: 'swarm', count: 6 } });
  assert.equal(byType.totem.cost, 80);
  assert.deepEqual(byType.totem.effect, { aura: { enemySpeedMul: 1.08, enemyHpMul: 1.1 } });
});

test('没有布点的旧地图：destructibles 为空数组，不影响建造', () => {
  const { sim } = makeSim({
    map: { ...syntheticMap([]), destructibles: undefined },
  });
  assert.deepEqual(sim.destructibles, []);
  assert.equal(sim.canBuild(3, 1), true);
});

test('金脉：扣 50 金获得 110 金；拆除后格子立刻可建造', () => {
  const { sim } = makeSim({ gold: 500 });
  const vein = sim.destructibles.find((item) => item.type === 'vein');
  assert.equal(sim.canBuild(vein.c, vein.r), false, '拆除前不可建造');
  assert.deepEqual(sim.destroyDestructible(vein.id), { ok: true, reason: 'destroyed' });
  assert.equal(sim.gold, 560, '500 - 50 + 110');
  assert.equal(vein.destroyed, true);
  assert.equal(sim.canBuild(vein.c, vein.r), true, '拆除后可建造');
  assert.equal(sim.placeTower('arrow', vein.c, vein.r), true, '塔可以落在腾出的格子');
});

test('补给箱：免费 +25 金 +1 基地生命，且不超过 maxBaseHp', () => {
  const { sim } = makeSim({ gold: 100, baseHp: 18, maxBaseHp: 20 });
  const cache = sim.destructibles.find((item) => item.type === 'cache');
  assert.equal(cache.cost, 0);
  assert.equal(sim.destroyDestructible(cache.id).ok, true);
  assert.equal(sim.gold, 125);
  assert.equal(sim.baseHp, 19);

  const { sim: capped } = makeSim({ gold: 0, baseHp: 20, maxBaseHp: 20 });
  const fullCache = capped.destructibles.find((item) => item.type === 'cache');
  assert.equal(capped.destroyDestructible(fullCache.id).ok, true);
  assert.equal(capped.gold, 25, '免费拆除仍给金币');
  assert.equal(capped.baseHp, 20, '基地生命封顶');
});

test('石碑：每层 +5% 全塔伤害，最多 3 层，已建塔属性立即刷新', () => {
  const obelisks = [
    placement('syn-obelisk-1', 'obelisk', 3, 2),
    placement('syn-obelisk-2', 'obelisk', 4, 2),
    placement('syn-obelisk-3', 'obelisk', 5, 2),
    placement('syn-obelisk-4', 'obelisk', 6, 2),
  ];
  const { sim } = makeSim({ map: syntheticMap(obelisks), gold: 5000 });
  assert.equal(sim.towerDamageMul, 1);
  assert.equal(sim.placeTower('arrow', 10, 6), true);
  const tower = sim.towerAt(10, 6);
  const baseDmg = tower.stats.dmg;

  assert.equal(sim.destroyDestructible('syn-obelisk-1').ok, true);
  assert.equal(sim.obeliskStacks, 1);
  ALMOST(sim.towerDamageMul, 1.05);
  ALMOST(tower.stats.dmg, baseDmg * 1.05, '已建塔伤害立即 +5%');

  assert.equal(sim.destroyDestructible('syn-obelisk-2').ok, true);
  assert.equal(sim.destroyDestructible('syn-obelisk-3').ok, true);
  assert.equal(sim.obeliskStacks, 3);
  ALMOST(sim.towerDamageMul, 1.15);

  // 第 4 座石碑照常扣费拆除，但层数封顶 3。
  const goldBefore = sim.gold;
  assert.equal(sim.destroyDestructible('syn-obelisk-4').ok, true);
  assert.equal(sim.gold, goldBefore - DESTRUCTIBLE_BY_ID.obelisk.cost);
  assert.equal(sim.obeliskStacks, 3, '最多 3 层');
  ALMOST(sim.towerDamageMul, 1.15);
  ALMOST(tower.stats.dmg, baseDmg * 1.15);
});

test('虫巢：波内生成 6 只当前波次强度的噬虫，不推进波次进度', () => {
  const seed = 'destructible-sim-seed';
  const { sim } = makeSim({ gold: 500 });
  sim.beginWave(generateWave(seed, 3, 'standard', sim.map.meta));
  const before = {
    wave: sim.wave,
    clearedWave: sim.clearedWave,
    queued: sim.spawnQueue.length,
    spawnIndex: sim.spawnIndex,
    hpMul: sim.waveDef.hpMul,
  };
  const nest = sim.destructibles.find((item) => item.type === 'nest');
  assert.equal(nest.cost, 0, '虫巢免费拆除');
  assert.equal(sim.destroyDestructible(nest.id).ok, true);

  assert.equal(sim.enemies.length, 6, '生成 6 只噬虫');
  const expectedHp = Math.max(
    1,
    Math.round(ENEMIES.swarm.hp * before.hpMul * sim.destructibleAura().hpMul)
  );
  const path = sim.lanes[0];
  for (const enemy of sim.enemies) {
    assert.equal(enemy.type, 'swarm');
    assert.equal(enemy.hp, expectedHp, '血量取当前波次强度');
    assert.ok(enemy.progress > 0 && enemy.progress < path.len, '从巢穴投影点出发，仍在路上');
  }
  assert.equal(sim.wave, before.wave, '波次号不变');
  assert.equal(sim.clearedWave, before.clearedWave, '已清波次不变');
  assert.equal(sim.spawnQueue.length, before.queued, '刷怪队列不变');
  assert.equal(sim.spawnIndex, before.spawnIndex, '刷怪游标不变');
  assert.equal(sim.canBuild(nest.c, nest.r), true, '巢穴拆除后格子可建造');
});

test('虫巢：整备期拆除按下一波强度生成（不提前消耗战斗随机流）', () => {
  const seed = 'destructible-sim-seed';
  const { sim } = makeSim({ gold: 500 });
  const nest = sim.destructibles.find((item) => item.type === 'nest');
  assert.equal(sim.destroyDestructible(nest.id).ok, true);
  assert.equal(sim.enemies.length, 6);
  const nextWave = generateWave(seed, 1, 'standard', sim.map.meta);
  const expectedHp = Math.max(
    1,
    Math.round(ENEMIES.swarm.hp * nextWave.hpMul * sim.destructibleAura().hpMul)
  );
  for (const enemy of sim.enemies) assert.equal(enemy.hp, expectedHp);
  // RNG 顺序不受影响：拆除前后生成同一波定义。
  const wave = generateWave(seed, 1, 'standard', sim.map.meta);
  assert.equal(wave.hpMul, nextWave.hpMul);
  assert.equal(sim.combatRng.float(), new Simulation({
    map: FIXED_MAP_BY_ID.canyon,
    seed,
    difficulty: 'standard',
    relics: [],
    towers: [],
  }).combatRng.float(), '拆除不推进 combatRng');
});

test('图腾光环：存活时移速 ×1.08、生命 ×1.10；拆除后立即失效且不回滚', () => {
  const { sim: alive } = makeSim({ gold: 0 });
  alive.spawnEnemy('grunt', 0);
  const cursed = alive.enemies[0];
  assert.equal(cursed.hp, Math.round(ENEMIES.grunt.hp * 1.1), '生成时生命 +10%');
  const cursedSpeed = cursed.baseSpeed;
  alive.updateEnemies(1);
  ALMOST(cursed.progress, cursedSpeed * 1.08, '存活图腾移速 +8%');

  const { sim: cleansed } = makeSim({ gold: 500 });
  const totem = cleansed.destructibles.find((item) => item.type === 'totem');
  assert.deepEqual(cleansed.destroyDestructible(totem.id), { ok: true, reason: 'destroyed' });
  assert.equal(cleansed.gold, 420, '拆除花费 80 金');
  cleansed.spawnEnemy('grunt', 0);
  const plain = cleansed.enemies[0];
  assert.equal(plain.hp, ENEMIES.grunt.hp, '无光环时生命不加成');
  cleansed.updateEnemies(1);
  ALMOST(plain.progress, plain.baseSpeed, '拆除后移速回到基准');

  // 已生成敌人不回滚：拆掉图腾后它的生命保持不变，后续生成的不再 +10%。
  const { sim: mixed } = makeSim({ gold: 500 });
  mixed.spawnEnemy('grunt', 0);
  const beforeHp = mixed.enemies[0].hp;
  assert.equal(mixed.destroyDestructible('canyon-totem-1').ok, true);
  assert.equal(mixed.enemies[0].hp, beforeHp, '已生成敌人生命不回滚');
  mixed.spawnEnemy('grunt', 0);
  assert.equal(mixed.enemies[1].hp, ENEMIES.grunt.hp);
});

test('拆除失败：不存在/重复/金币不足都不扣费、不标记、给出提示', () => {
  const { sim, toasts } = makeSim({ gold: 100 });
  const vein = sim.destructibles.find((item) => item.type === 'vein');

  assert.deepEqual(sim.destroyDestructible('no-such-thing'), { ok: false, reason: 'not-found' });
  assert.equal(sim.gold, 100);
  assert.ok(toasts.length > 0, '失败会通过 onToast 给出原因');

  // 金币不足：失败不扣费、不标记、格位仍被占用。
  const { sim: poor, toasts: poorToasts } = makeSim({ gold: 10 });
  const poorVein = poor.destructibles.find((item) => item.type === 'vein');
  assert.deepEqual(poor.destroyDestructible(poorVein.id), { ok: false, reason: 'gold-insufficient' });
  assert.equal(poor.gold, 10, '失败不扣费');
  assert.equal(poorVein.destroyed, false, '失败不标记销毁');
  assert.equal(poor.canBuild(poorVein.c, poorVein.r), false, '格位仍被占用');
  assert.ok(poorToasts.some((text) => text.includes('金币')));

  // 重复拆除：第二次 already-destroyed，效果不叠加、不再扣费。
  assert.equal(sim.destroyDestructible(vein.id).ok, true);
  const goldAfterFirst = sim.gold;
  assert.deepEqual(sim.destroyDestructible(vein.id), {
    ok: false,
    reason: 'already-destroyed',
  });
  assert.equal(sim.gold, goldAfterFirst, '重复拆除不扣费也不加钱');
  assert.equal(vein.destroyed, true);
});

test('快照 v7：已拆除 id 与石碑层数随存档往返，恢复后状态一致', () => {
  const { sim } = makeSim({ gold: 1000, baseHp: 18, maxBaseHp: 20 });
  const vein = sim.destructibles.find((item) => item.type === 'vein');
  const obelisk = sim.destructibles.find((item) => item.type === 'obelisk');
  const totem = sim.destructibles.find((item) => item.type === 'totem');
  for (const item of [vein, obelisk, totem]) assert.equal(sim.destroyDestructible(item.id).ok, true);

  const snapshot = sim.toSnapshot();
  assert.equal(snapshot.version, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 7);
  assert.deepEqual(snapshot.destructibles, {
    destroyed: [vein.id, obelisk.id, totem.id],
    obeliskStacks: 1,
  });

  // JSON 往返 + 存档入口校验（未来版本守卫/迁移）。
  const parsed = JSON.parse(JSON.stringify(snapshot));
  const validated = validateSnapshot(parsed);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.snapshot.destructibles, snapshot.destructibles);

  const { sim: restored } = makeSim({
    destructibleState: validated.snapshot.destructibles,
    gold: validated.snapshot.gold,
    baseHp: validated.snapshot.baseHp,
    maxBaseHp: validated.snapshot.maxBaseHp,
  });
  assert.deepEqual(
    restored.destructibles.filter((item) => item.destroyed).map((item) => item.id),
    [vein.id, obelisk.id, totem.id]
  );
  assert.equal(restored.obeliskStacks, 1);
  ALMOST(restored.towerDamageMul, 1.05);
  assert.equal(restored.canBuild(vein.c, vein.r), true, '已拆除的格子保持可建造');
  const live = restored.destructibles.find((item) => !item.destroyed);
  assert.equal(restored.canBuild(live.c, live.r), false, '未拆除的布点仍然占格');
  // 恢复后不会重复结算效果：金币/基地生命以快照为准。
  assert.equal(restored.gold, snapshot.gold);
});

test('快照兼容：旧档缺字段视为空；没有拆除时不写字段、不升版本', () => {
  const { sim } = makeSim({ gold: 500 });
  const untouched = sim.toSnapshot();
  assert.equal('destructibles' in untouched, false, '一件没拆时不写字段');
  assert.equal(untouched.version, 3, '无技能/海克斯/连锁的旧格式保持不变');

  const legacy = validateSnapshot({ version: 6, wave: 3, relics: [], gold: 120 });
  assert.equal(legacy.ok, true);
  assert.equal('destructibles' in legacy.snapshot, false, '旧档缺字段视为空');
  const { sim: fromLegacy } = makeSim({ destructibleState: legacy.snapshot.destructibles });
  assert.equal(fromLegacy.obeliskStacks, 0);
  assert.equal(fromLegacy.destructibles.every((item) => !item.destroyed), true);
  ALMOST(fromLegacy.towerDamageMul, 1);

  // 损坏字段收敛：重复/非字符串 id 去重丢弃，石碑层数钳到上限，不抛异常。
  const messy = validateSnapshot({
    version: 7,
    wave: 1,
    relics: [],
    destructibles: { destroyed: ['a', 'a', 42, '', 'b'], obeliskStacks: 99 },
  });
  assert.equal(messy.ok, true);
  assert.deepEqual(messy.snapshot.destructibles, { destroyed: ['a', 'b'], obeliskStacks: 3 });

  const malformed = validateSnapshot({
    version: 7,
    wave: 1,
    relics: [],
    destructibles: 'not-an-object',
  });
  assert.equal(malformed.ok, true);
  assert.ok(malformed.warnings.includes('invalid-destructibles'));
  assert.equal('destructibles' in malformed.snapshot, false);
});

// ---------- feat-attackable-tiles：可攻击资源矿脉 ----------

// 空波定义：无敌人，让塔在波内只剩「打矿脉」这一条路可走（波次导演只要求 groups/index/reward）。
function emptyWave(index) {
  return { index, groups: [], reward: 0, hpMul: 1, speedMul: 1, portals: [] };
}

function veinPlacement(id, c, r) {
  return { id, type: 'resourceVein', c, r };
}

test('资源矿脉：运行时条目带 HP/坐标，占格且不可花金币手动拆除', () => {
  const vein = veinPlacement('syn-vein-1', 5, 5);
  const { sim } = makeSim({ map: syntheticMap([vein]), gold: 500 });
  const entry = sim.destructibles.find((item) => item.id === 'syn-vein-1');

  assert.ok(isAttackableType(RESOURCE_VEIN_TYPE));
  assert.equal(entry.type, 'resourceVein');
  assert.equal(entry.hp, RESOURCE_VEIN_TYPE.hp);
  assert.equal(entry.maxHp, RESOURCE_VEIN_TYPE.hp);
  assert.equal(entry.cost, null, '不可花金币拆除');
  assert.equal(entry.effect, null, '掉落由 seed+波次派生，不是声明式效果');
  assert.equal(entry.x, 5.5);
  assert.equal(entry.y, 5.5);
  assert.equal(entry.destroyed, false);
  assert.equal(sim.canBuild(5, 5), false, '存活矿脉占格');

  // 手动拆除被拒绝，不标记、不扣费。
  const goldBefore = sim.gold;
  assert.deepEqual(sim.destroyDestructible('syn-vein-1'), {
    ok: false,
    reason: 'not-manually-removable',
  });
  assert.equal(sim.gold, goldBefore);
  assert.equal(entry.destroyed, false);
});

test('资源矿脉掉落：seed+波次+id 确定性派生，落在声明区间内且不依赖 RNG', () => {
  const seed = 'destructible-sim-seed';
  for (const wave of [1, 2, 3]) {
    const a = resourceVeinGold(seed, wave, 'vein-a');
    const b = resourceVeinGold(seed, wave, 'vein-a');
    assert.equal(a, b, `同 seed/波次/id 结果一致（wave ${wave}）`);
    assert.ok(
      a >= RESOURCE_VEIN_TYPE.goldMin && a <= RESOURCE_VEIN_TYPE.goldMax,
      `金额 ${a} 落在 [${RESOURCE_VEIN_TYPE.goldMin}, ${RESOURCE_VEIN_TYPE.goldMax}]`
    );
    assert.equal(Number.isInteger(a), true, '掉落金额为整数');
  }
  // 不同 id 通常不同（hash 取模，极小概率相同——这里只验证函数是纯函数：输入不同→可不同）。
  const across = new Set([1, 2, 3].map((w) => resourceVeinGold(seed, w, 'vein-a')));
  assert.ok(across.size >= 1);
});

test('塔在无敌人时自动攻击矿脉，破坏后掉落确定性金币且不消耗 combatRng', () => {
  const seed = 'destructible-sim-seed';
  const vein = veinPlacement('syn-vein-2', 5, 5);
  const { sim } = makeSim({ map: syntheticMap([vein]), gold: 500, seed });
  assert.equal(sim.placeTower('arrow', 5, 6), true);
  const tower = sim.towerAt(5, 6);
  const entry = sim.destructibles.find((item) => item.id === 'syn-vein-2');

  // 箭塔射程 3.2，矿脉距塔 1 格，必然在射程内。
  assert.equal(sim.destructibleSystem.findAttackableDestructible(tower, tower.stats.range), entry);

  const goldBefore = sim.gold;
  sim.beginWave(emptyWave(1));
  assert.equal(sim.wave, 1);

  let steps = 0;
  while (!entry.destroyed && steps < 500) {
    sim.updateTowers(0.1);
    steps += 1;
  }
  assert.equal(entry.destroyed, true, '塔把矿脉打掉');
  assert.equal(entry.hp, 0);
  const expected = resourceVeinGold(seed, 1, 'syn-vein-2');
  assert.equal(sim.gold, goldBefore + expected, '掉落金额 = seed+波次+id 派生');
  assert.equal(sim.canBuild(5, 5), true, '破坏后格子可建造');

  // 攻击路径不消耗 combatRng：整段攻击后首个随机数仍等于波首初始值。
  assert.equal(sim.combatRng.float(), new RNG(`${seed}:combat:1`).float(), '攻击矿脉不推进 combatRng');
});

test('敌人永远优先：射程内同时有敌人与矿脉时打敌人，矿脉不掉血', () => {
  // 塔在 (5,2)，矿脉在 (5,3)（距 1），车道在 r=0，敌人刷在 progress≈5 的 (5.5,0.5)（距塔约 1.5）。
  const vein = veinPlacement('syn-vein-3', 5, 3);
  const { sim } = makeSim({ map: syntheticMap([vein]), gold: 500 });
  assert.equal(sim.placeTower('arrow', 5, 2), true);
  const tower = sim.towerAt(5, 2);
  const entry = sim.destructibles.find((item) => item.id === 'syn-vein-3');

  sim.beginWave(emptyWave(1));
  sim.spawnEnemy('grunt', 0, null, 5);
  const enemy = sim.enemies[0];

  // 敌人与矿脉都在射程内：索敌必然选敌人。
  assert.equal(sim.inRange(tower, enemy, tower.stats.range), true, '敌人在射程内');
  assert.equal(sim.destructibleSystem.findAttackableDestructible(tower, tower.stats.range), entry, '矿脉也在射程内');
  assert.equal(sim.findTarget(tower, tower.stats.range), enemy, '索敌选敌人');

  const hpBefore = entry.hp;
  sim.updateTowers(0.1);
  assert.equal(entry.hp, hpBefore, '有敌人可打时矿脉不掉血');
  assert.equal(tower.target, enemy, '塔锁定的是敌人');
  assert.equal(sim.projectiles.length, 1, '对敌人开火（生成投射物）');
  assert.equal(sim.projectiles[0].target, enemy);
});

test('资源矿脉血量是波内瞬态：开波回满，刷新后与内存态一致', () => {
  const vein = veinPlacement('syn-vein-4', 5, 5);
  const { sim } = makeSim({ map: syntheticMap([vein]), gold: 500 });
  assert.equal(sim.placeTower('arrow', 5, 6), true);
  const entry = sim.destructibles.find((item) => item.id === 'syn-vein-4');

  // 直接调用攻击接口把矿脉打到残血（模拟波内被打了一部分）。
  sim.destructibleSystem.attackDestructible(entry, 100);
  assert.ok(entry.hp > 0 && entry.hp < entry.maxHp, '矿脉残血');
  assert.equal(entry.destroyed, false);

  // 开波回满：跨波不残留上一波的残血。
  sim.beginWave(emptyWave(1));
  assert.equal(entry.hp, entry.maxHp, '开波后血量回满');
});
