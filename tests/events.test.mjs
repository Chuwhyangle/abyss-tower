// 局内事件节点：同种子事件序列稳定、三选项效果合法、重复提交幂等。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import {
  EVENTS,
  EVENT_ORDER,
  EVENT_WAVES,
  canAffordEventOption,
  hasResolvedEvent,
  isEventWave,
  normalizeEventHistory,
  resolveEventOption,
  rollEvent,
} from '../public/js/shared/events.js';
import { normalizeSnapshot, toSnapshot, validateSnapshot } from '../public/js/shared/snapshot.js';
import { HarnessEnvError, registerAndLogin, startTestServer, withRetry } from './harness.mjs';

const SEED = 'events-test-seed';

function makeSim(overrides = {}) {
  return new Simulation({
    map: generateMap(overrides.seed || SEED),
    seed: overrides.seed || SEED,
    difficulty: 'standard',
    gold: 500,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    onToast: () => {},
    ...overrides,
  });
}

// 直接推进模拟到指定波次清波，避免跑真实战斗。
function completeWaveAt(sim, wave) {
  sim.phase = 'wave';
  sim.wave = wave;
  sim.waveDef = { index: wave, reward: 0, groups: [] };
  sim.completeWave();
}

test('事件只在第 5/10/15/20/25 波触发', () => {
  assert.deepEqual(EVENT_WAVES, [5, 10, 15, 20, 25]);
  for (const wave of EVENT_WAVES) assert.equal(isEventWave(wave), true);
  for (const wave of [0, 1, 4, 6, 9, 30]) assert.equal(isEventWave(wave), false);
  assert.equal(rollEvent(SEED, 4), null);
  assert.equal(rollEvent(SEED, 6), null);
});

test('同种子两次运行事件序列一致', () => {
  const once = EVENT_WAVES.map((wave) => rollEvent(SEED, wave).id);
  const twice = EVENT_WAVES.map((wave) => rollEvent(SEED, wave).id);
  assert.deepEqual(once, twice);
  // 每次触发都是定义内的事件，且三个事件在一局中都有机会出现。
  for (const id of once) assert.ok(EVENT_ORDER.includes(id));
});

test('每个事件的三个选项都有合法效果，资源不足时不可执行', () => {
  for (const eventId of EVENT_ORDER) {
    const event = EVENTS[eventId];
    assert.equal(event.options.length, 3, `${eventId} 应有三个选项`);
    for (const option of event.options) {
      const result = resolveEventOption(event, option.id, {
        seed: SEED,
        wave: 5,
        gold: 1000,
        baseHp: 20,
        maxHp: 20,
      });
      assert.equal(result.ok, true, `${eventId}/${option.id} 应可结算`);
      assert.equal(result.eventId, eventId);
      assert.equal(result.optionId, option.id);
      for (const value of Object.values(result.deltas)) {
        assert.ok(Number.isFinite(value), `${eventId}/${option.id} 效果必须是有限数字`);
      }
    }
  }

  const gamble = EVENTS.gamble;
  assert.equal(canAffordEventOption(gamble.options[1], { gold: 0, baseHp: 20, maxHp: 20 }), false);
  assert.equal(
    resolveEventOption(gamble, 'big', { seed: SEED, wave: 5, gold: 0, baseHp: 20, maxHp: 20 }).ok,
    false
  );
});

test('赌局结果按种子与波次确定性结算', () => {
  const ctx = { seed: SEED, wave: 10, gold: 500, baseHp: 20, maxHp: 20 };
  const first = resolveEventOption(EVENTS.gamble, 'small', ctx);
  const second = resolveEventOption(EVENTS.gamble, 'small', ctx);
  assert.deepEqual(first, second);
  assert.equal(typeof first.gamble.roll, 'number');
  assert.equal(typeof first.gamble.won, 'boolean');
});

test('清波进入事件阶段，选择后回到整备且写入历史', () => {
  const sim = makeSim();
  completeWaveAt(sim, 4);
  assert.equal(sim.pendingEvent, null, '第 4 波不触发事件');
  assert.equal(sim.phase, 'prep');

  completeWaveAt(sim, 5);
  assert.equal(sim.phase, 'event');
  assert.ok(sim.pendingEvent, '第 5 波应进入事件阶段');
  assert.equal(sim.pendingEvent.id, rollEvent(SEED, 5).id);

  const before = { gold: sim.gold, baseHp: sim.baseHp, maxBaseHp: sim.maxBaseHp };
  const leaveIndex = sim.pendingEvent.options.findIndex((option) => option.id === 'leave');
  const result = sim.applyEventOption(leaveIndex);
  assert.equal(result.ok, true);
  assert.equal(sim.phase, 'prep');
  assert.equal(sim.pendingEvent, null);
  assert.equal(sim.events.length, 1);
  assert.equal(sim.events[0].wave, 5);
  assert.equal(hasResolvedEvent(sim.events, 5), true);
  assert.equal(sim.gold, before.gold, '离开选项不改变资源');
  assert.equal(sim.baseHp, before.baseHp);
  assert.equal(sim.maxBaseHp, before.maxBaseHp);
});

test('事件结算不消耗战斗 RNG', () => {
  const sim = makeSim();
  const reference = makeSim();
  const expected = reference.combatRng.float();
  completeWaveAt(sim, 5);
  const leaveIndex = sim.pendingEvent.options.findIndex((option) => option.id === 'leave');
  sim.applyEventOption(leaveIndex);
  assert.equal(sim.combatRng.float(), expected);
});

test('事件历史纳入快照，旧存档无事件字段时可继续', () => {
  const sim = makeSim();
  completeWaveAt(sim, 5);
  const leaveIndex = sim.pendingEvent.options.findIndex((option) => option.id === 'leave');
  sim.applyEventOption(leaveIndex);

  const snap = sim.toSnapshot();
  assert.deepEqual(snap.events, [{ wave: 5, eventId: sim.events[0].eventId, optionId: 'leave' }]);
  assert.equal(validateSnapshot(snap).ok, true);

  // 续玩：已结算的事件不再重复弹出。
  const restored = makeSim({ clearedWave: 5, events: snap.events, restored: true });
  assert.equal(restored.pendingEvent, null);
  assert.equal(restored.events.length, 1);

  // 旧存档没有 events 字段：校验通过，且按无事件历史归一化。
  const legacy = normalizeSnapshot({ version: 3, clearedWave: 5, relics: [] });
  assert.ok(legacy);
  assert.equal(legacy.events, undefined);
  assert.deepEqual(normalizeEventHistory(legacy.events), []);

  // 未结算的事件：续玩时由波次推导出待办节点。
  const pending = makeSim({ clearedWave: 10, restored: true });
  assert.ok(pending.pendingEvent);
  assert.equal(pending.pendingEvent.id, rollEvent(SEED, 10).id);
});

test('无事件时快照保持旧字节结构', () => {
  const snap = toSnapshot({
    runId: 'r',
    seed: SEED,
    mode: 'normal',
    difficulty: 'standard',
    clearedWave: 3,
    pendingDraft: false,
    gold: 100,
    baseHp: 20,
    maxBaseHp: 20,
    kills: 0,
    relics: [],
    towers: [],
    skill: null,
    startedAt: 1,
  });
  assert.equal('events' in snap, false);
});

// ---------- 服务端：非法/重复选择被拒绝 ----------

let server = null;
let auth = null;

after(async () => {
  if (server) await server.stop();
});

// 连接层失败（服务进程抖动）不是断言失败：标成环境类，由 withRetry 换一台新服务从头
// 重跑，⛔ 不在同一个 run 上重放有状态的 POST。
async function fetchOrEnvError(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new HarnessEnvError(
      `服务端请求失败：${error.message}\n${server?.log?.() || ''}`,
      'timeout',
    );
  }
}

async function request(pathname, { method = 'GET', body } = {}) {
  const headers = { cookie: auth.rawCookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetchOrEnvError(`${server.base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function startFreshServer() {
  if (server) await server.stop();
  server = await startTestServer({ seedHeader: true });
  auth = await registerAndLogin(server.base);
}

test('服务端事件节点：合法性校验与重复提交幂等', async () => {
  await withRetry(async () => {
    // 每次尝试都从全新服务与全新 run 开始，失败重试不会重复应用任何操作。
    await startFreshServer();
    await runServerEventFlow();
  });
});

async function runServerEventFlow() {
  // 固定种子：服务端事件必须与 rollEvent(seed, wave) 完全一致。
  const createdWithSeed = await fetchOrEnvError(`${server.base}/api/runs`, {
    method: 'POST',
    headers: {
      cookie: auth.rawCookie,
      'content-type': 'application/json',
      'x-test-seed': 'events-api',
    },
    body: JSON.stringify({ mode: 'normal', difficulty: 'standard' }),
  });
  assert.equal(createdWithSeed.status, 200);
  const start = await createdWithSeed.json();
  const runId = start.runId;
  const seed = start.seed;

  const mapped = await request(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } });
  assert.equal(mapped.status, 200);

  for (let wave = 1; wave <= 5; wave += 1) {
    const served = await request(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
    assert.equal(served.status, 200);
    if (wave === 1) {
      const early = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
      assert.equal(early.status, 409, '非事件波次应拒绝');
    }
    const cleared = await request(`/api/runs/${runId}/clear`, {
      method: 'POST',
      body: { wave },
    });
    assert.equal(cleared.status, 200);
  }

  const node = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
  assert.equal(node.status, 200);
  assert.equal(node.data.wave, 5);
  assert.equal(node.data.picked, false);
  assert.equal(node.data.event.id, rollEvent(seed, 5).id, '服务端事件与服务端种子一致');

  const illegal = await request(`/api/runs/${runId}/event`, {
    method: 'POST',
    body: { index: 99 },
  });
  assert.equal(illegal.status, 400, '非法选项应被拒绝');

  const picked = await request(`/api/runs/${runId}/event`, {
    method: 'POST',
    body: { index: 0, optionId: node.data.event.options[0].id },
  });
  assert.equal(picked.status, 200);
  assert.equal(picked.data.picked, true);
  assert.equal(picked.data.applied.optionId, node.data.event.options[0].id);

  const duplicate = await request(`/api/runs/${runId}/event`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(duplicate.status, 409, '重复提交应被拒绝');

  const afterNode = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
  assert.equal(afterNode.status, 200);
  assert.equal(afterNode.data.picked, true);
  assert.equal(afterNode.data.choice.optionId, node.data.event.options[0].id);
}
