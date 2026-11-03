// 复用断言：数值近似、确定性哈希（events/rng/state 三份）、快照 round-trip、no-crash、RNG 顺序不变。
// 依赖 scenario.mjs 的 digest/stripSavedAt/buildScenario，自身零第三方依赖、零 DOM。
import assert from 'node:assert/strict';

import { Simulation } from '../../public/js/sim.js';
import { validateSnapshot } from '../../public/js/shared/snapshot.js';
import { buildScenario, digest, stripSavedAt } from './scenario.mjs';

// 快照不含 waveTime/enemies 等波内瞬态；这里投影一份可复现的「活体状态」，
// 供 state 哈希把瞬态也纳入确定性证据（同一批 step 必然逐浮点一致）。
function liveState(sim) {
  return {
    time: sim.time,
    waveTime: sim.waveTime,
    wave: sim.wave,
    clearedWave: sim.clearedWave,
    phase: sim.phase,
    paused: sim.paused,
    gold: sim.gold,
    baseHp: sim.baseHp,
    maxBaseHp: sim.maxBaseHp,
    kills: sim.kills,
    spawnIndex: sim.spawnIndex,
    spawnQueue: sim.spawnQueue.length,
    enemies: sim.enemies.map((e) => ({
      type: e.type,
      hp: e.hp,
      maxHp: e.maxHp,
      progress: e.progress,
      x: e.x,
      y: e.y,
      dead: !!e.dead,
    })),
    towers: sim.towers.map((t) => ({
      type: t.type,
      c: t.c,
      r: t.r,
      level: t.level,
      invested: t.invested,
    })),
    projectiles: sim.projectiles.length,
    impactEvents: sim.impactEvents.length,
  };
}

// 确定性哈希三件套：events = 命中事件流，rng = 战斗 RNG 调用序列，state = 快照 + 活体状态。
export function hashesOf(scenario) {
  const sim = scenario.sim;
  return {
    events: digest(sim.impactEvents),
    rng: digest(scenario.rngLog),
    state: digest({ snapshot: stripSavedAt(sim.toSnapshot()), live: liveState(sim) }),
  };
}

// 数值近似：仅对 expected 里给出的键做绝对误差比较（stats 多为整数或按整型取整的数值）。
export function assertStatsClose(actual, expected, { eps = 1e-9, label = 'stats' } = {}) {
  for (const [key, want] of Object.entries(expected)) {
    assert.ok(key in actual, `${label}: 缺少字段 ${key}`);
    const got = actual[key];
    assert.equal(typeof got, 'number', `${label}: ${key} 应为数值`);
    assert.ok(Math.abs(got - want) <= eps, `${label}: ${key} 期望 ${want}±${eps}，实际 ${got}`);
  }
}

// 快照 round-trip：toSnapshot → validateSnapshot → 以快照重建 Simulation → toSnapshot
// 逐字段一致（savedAt 墙钟剥除）。重建路径与 public/js/app/run.js 的读档一致。
function rebuild(sim) {
  const snap = sim.toSnapshot();
  return new Simulation({
    map: sim.map,
    seed: snap.seed,
    difficulty: snap.difficulty,
    mode: snap.mode,
    runId: snap.runId,
    gold: snap.gold,
    baseHp: snap.baseHp,
    maxBaseHp: snap.maxBaseHp,
    kills: snap.kills,
    clearedWave: snap.clearedWave,
    wave: snap.clearedWave,
    pendingDraft: snap.pendingDraft,
    relics: snap.relics,
    towers: snap.towers,
    events: snap.events || [],
    startedAt: snap.startedAt,
    restored: true,
    destructibleState: snap.destructibles,
    skill: snap.skill,
    skillReadyAt: snap.skill?.readyAt ?? null,
    skillSpeed: snap.skill?.speed ?? 1,
    hex: snap.hexId ?? null,
    hexState: snap.hexState ?? null,
    tower: snap.tower ? { route: snap.tower.route } : null,
    rogue2: snap.rogue2,
    onToast: () => {},
  });
}

export function assertSnapshotRoundTrip(sim, { label = '快照 round-trip' } = {}) {
  const snap = sim.toSnapshot();
  const validated = validateSnapshot(snap);
  assert.equal(validated.ok, true, `${label}: 快照校验失败：${validated.reason || ''}`);
  const rebuilt = rebuild(sim);
  assert.deepEqual(
    stripSavedAt(rebuilt.toSnapshot()),
    stripSavedAt(snap),
    `${label}: toSnapshot → 重建 → toSnapshot 应逐字段一致`
  );
}

export function assertNoCrash(fn, { label = '场景' } = {}) {
  assert.doesNotThrow(fn, `${label}: 运行不应抛异常`);
}

// 确定性：同 seed 两次完整运行，events/rng/state 三份哈希一致，且 RNG 调用序列逐值一致
// （「normal 模式 RNG 顺序不变」这条铁律的强证据——比哈希更细）。
export function assertDeterministic(spec, run, { label = spec.seed ?? 'scenario' } = {}) {
  const first = buildScenario(spec);
  const second = buildScenario(spec);
  run(first);
  run(second);
  assert.deepEqual(hashesOf(second), hashesOf(first), `${label}: 两次运行确定性哈希不一致`);
  assert.deepEqual(second.rngLog, first.rngLog, `${label}: RNG 调用序列顺序变化`);
}

// 不变量全家桶：无崩溃（两次运行各跑一遍）+ 确定性 + 快照 round-trip。
export function assertInvariants(spec, run, { label = spec.seed ?? 'scenario' } = {}) {
  const first = buildScenario(spec);
  const second = buildScenario(spec);
  assertNoCrash(() => run(first), { label });
  assertNoCrash(() => run(second), { label });
  assert.deepEqual(hashesOf(second), hashesOf(first), `${label}: 两次运行确定性哈希不一致`);
  assert.deepEqual(second.rngLog, first.rngLog, `${label}: RNG 调用序列顺序变化`);
  assertSnapshotRoundTrip(first.sim, { label });
}
