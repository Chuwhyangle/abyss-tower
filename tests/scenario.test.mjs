// 无头模拟场景构造器（TODO-13 地基）的自证 + 示范。
//
// 对比 ad-hoc：过去每个测试都要手写 makeSim/addTower/hit 样板（见 tests/combat.test.mjs），
// 现在一条 spec 声明 + buildScenario 即得到就绪 Simulation 与全部驱动 helper，
// 确定性/快照/不变量用 assertions.mjs 的复用断言一行落证——「轴测试走 harness」更省。
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScenario, digest } from './lib/scenario.mjs';
import {
  assertDeterministic,
  assertInvariants,
  assertNoCrash,
  assertSnapshotRoundTrip,
  assertStatsClose,
  hashesOf,
} from './lib/assertions.mjs';

// ---------- 地基：声明式构造 + 驱动 helper 全覆盖 ----------

test('buildScenario 声明式构造：spec 字段可组合，返回就绪 Simulation', () => {
  const sc = buildScenario({
    seed: 'scenario-default-seed',
    difficulty: 'abyss',
    mode: 'normal',
    gold: 2000,
    baseHp: 16,
    maxBaseHp: 30,
    relics: ['crit'],
    skill: { id: 'aurora', level: 1 },
    waves: 3,
  });

  assert.equal(sc.sim.seed, 'scenario-default-seed');
  assert.equal(sc.sim.difficulty, 'abyss');
  assert.equal(sc.sim.mode, 'normal');
  assert.equal(sc.sim.gold, 2000);
  assert.equal(sc.sim.baseHp, 16);
  assert.equal(sc.sim.maxBaseHp, 30);
  // 固定开局时间，避免 startedAt 退化成墙钟破坏确定性。
  assert.equal(sc.sim.startedAt, 1700000000000);
  assert.deepEqual(sc.sim.relics.map((r) => r.id), ['crit']);
  assert.equal(sc.sim.skill.id, 'aurora');
  assert.equal(sc.sim.skill.level, 1);
  assert.equal(sc.waves, 3);
  assert.deepEqual(sc.rngLog, []);
});

test('驱动 helper 覆盖塔生命周期：建/升/进化/卖', () => {
  const sc = buildScenario({ seed: 'tower-life', gold: 100000 });
  const cells = sc.buildableCells(3);
  assert.ok(cells.length >= 3, '地图应至少有 3 个可建格');

  // 建 + 连升到 2 级（arrow 满级为 2，正好够进化门槛）。
  const a = sc.build('arrow', cells[0].c, cells[0].r, 2);
  assert.ok(a, 'build 应返回塔');
  assert.equal(a.type, 'arrow');
  assert.equal(a.level, 2);

  // 进化分支追加。
  assert.equal(sc.evolve(a, 'arrow-longbow'), true);
  assert.deepEqual(a.evolutions, ['arrow-longbow']);

  // place + 单级 upgrade。
  const c = sc.place('cannon', cells[1].c, cells[1].r);
  assert.ok(c);
  assert.equal(sc.upgrade(c), true);
  assert.equal(c.level, 1);

  // sell 返回回收金并入账，塔位释放。
  const goldBefore = sc.sim.gold;
  const value = sc.sell(a);
  assert.ok(value > 0);
  assert.equal(sc.sim.gold, goldBefore + value);
  assert.equal(sc.sim.towers.length, 1);
});

test('驱动 helper 覆盖波次/技能/遗物/读状态', () => {
  const sc = buildScenario({
    seed: 'wave-helpers',
    gold: 5000,
    relics: ['crit'],
    skill: { id: 'aurora', level: 1 },
  });

  // 开波 → 步进 → 手动刷怪。
  const def = sc.startWave(1);
  assert.equal(def.index, 1);
  assert.equal(sc.sim.phase, 'wave');
  sc.step(1 / 60, 5);
  assert.ok(Math.abs(sc.sim.time - 5 / 60) < 1e-9);
  const enemy = sc.spawnEnemy('grunt');
  assert.ok(enemy);
  assert.equal(enemy.type, 'grunt');

  // 技能（独立随机流，不碰 combatRng）与遗物。
  assert.equal(sc.castSkill(), true);
  const relic = sc.buyRelic('sharp');
  assert.equal(relic.applied, true);

  // 读状态三合一：snapshot + stats + RNG hash。
  const { snapshot, stats, rngHash } = sc.read();
  assert.equal(typeof rngHash, 'string');
  assert.match(rngHash, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.seed, 'wave-helpers');
  assert.equal(stats.phase, 'wave');
  assert.equal(stats.relicCount, 2);
});

// ---------- 地基：复用断言 ----------

test('复用断言：哈希三件套 / 数值近似 / 快照 round-trip / no-crash', () => {
  const sc = buildScenario({ seed: 'assertions', gold: 1000, relics: ['crit'] });

  const hashes = hashesOf(sc);
  for (const key of ['events', 'rng', 'state']) {
    assert.match(hashes[key], /^[0-9a-f]{64}$/, `hash.${key} 应为 sha256 十六进制`);
  }

  assertStatsClose(sc.read().stats, { gold: 1000, baseHp: 20, maxBaseHp: 20 });
  assertSnapshotRoundTrip(sc.sim);
  assertNoCrash(() => sc.step(1 / 60, 3));
});

test('确定性断言：同 seed 两次运行 events/rng/state 三份哈希逐值一致', () => {
  const spec = { seed: 'deterministic', gold: 5000, relics: ['crit'] };
  const run = (sc) => {
    const cells = sc.buildableCells(2);
    sc.build('arrow', cells[0].c, cells[0].r, 1);
    sc.build('cannon', cells[1].c, cells[1].r, 0);
    sc.runWave(1, { maxFrames: 60 * 45 });
  };
  assertDeterministic(spec, run, { label: '确定性' });
});

// ---------- 不变量：全局铁律 ----------

test('不变量：同 seed 两次一致 + 快照 round-trip + 无崩溃 + RNG 顺序不变', () => {
  const spec = { seed: 'invariants', gold: 5000, relics: ['crit'] };
  const run = (sc) => {
    const cells = sc.buildableCells(2);
    sc.build('arrow', cells[0].c, cells[0].r, 1);
    sc.build('cannon', cells[1].c, cells[1].r, 0);
    sc.runWave(1, { maxFrames: 60 * 45 });
    sc.runWave(2, { maxFrames: 60 * 45 });
  };
  assertInvariants(spec, run, { label: '不变量' });
});

// ---------- 示范：一个塔轴 + 一个海克斯轴走 harness ----------

test('示范·塔轴：三塔型建/升/开波/步进走 harness', () => {
  const spec = { seed: 'axis-tower', gold: 10000, relics: ['crit'] };
  const run = (sc) => {
    const cells = sc.buildableCells(3);
    assert.ok(cells.length >= 3);
    sc.build('arrow', cells[0].c, cells[0].r, 1);
    sc.build('cannon', cells[1].c, cells[1].r, 1);
    sc.build('frost', cells[2].c, cells[2].r, 0);
    sc.runWave(1, { maxFrames: 60 * 45 });
  };
  assertInvariants(spec, run, { label: '塔轴' });

  // 带暴击遗物的战斗必然消耗 combatRng，证明 rng 哈希非平凡。
  const once = buildScenario(spec);
  run(once);
  assert.ok(once.rngLog.length > 0, '带暴击遗物的战斗应消耗 combatRng');
});

test('示范·海克斯轴：独塔为王约束 + 快照 round-trip + 确定性', () => {
  const sc = buildScenario({ seed: 'axis-hex', gold: 2000, hex: 'one_tower' });
  assert.equal(sc.sim.hex?.id, 'one_tower');
  assert.equal(sc.sim.hexRuntime.active, true);

  const cells = sc.buildableCells(2);
  assert.ok(cells.length >= 2);
  const first = sc.place('arrow', cells[0].c, cells[0].r);
  assert.ok(first, '第一座塔应建成');
  const second = sc.place('cannon', cells[1].c, cells[1].r);
  assert.equal(second, null, '独塔为王：第二座塔应被拒');
  assert.equal(sc.sim.towers.length, 1);
  assert.ok(sc.toasts.some((m) => /无法建造/.test(m)), '应记录无法建造 toast');

  // 快照 round-trip 带上 hexId 仍逐字段一致。
  assertSnapshotRoundTrip(sc.sim);

  // 单塔局（含暴击遗物）跑一波仍确定性成立。
  const spec = { seed: 'axis-hex-run', gold: 5000, hex: 'one_tower', relics: ['crit'] };
  assertInvariants(
    spec,
    (s) => {
      const [cell] = s.buildableCells(1);
      s.build('arrow', cell.c, cell.r, 2);
      s.runWave(1, { maxFrames: 60 * 45 });
    },
    { label: '海克斯轴·独塔为王' }
  );
});
