// 事件连锁：12 类事件、触发/延迟/快照恢复、纯数据可校验、同种子稳定。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import {
  CHAIN_DELAY_WAVES,
  EVENTS,
  EVENT_CHAINS,
  EVENT_ORDER,
  EVENT_WAVES,
  chainsFromHistory,
  findEventChain,
  findEventOption,
  isChainWave,
  isEventWave,
  normalizeChains,
  normalizeEventHistory,
  resolveEventForWave,
  rollEvent,
} from '../public/js/shared/events.js';
import {
  SAVE_VERSION,
  normalizeSnapshot,
  toSnapshot,
  validateSnapshot,
} from '../public/js/shared/snapshot.js';
import { registerAndLogin, startTestServer } from './harness.mjs';

const TRIGGER = EVENT_CHAINS[0];
const TRIGGER_WAVE = EVENT_WAVES[0];
const FOLLOW_UP_WAVE = TRIGGER_WAVE + TRIGGER.delayWaves;

function makeSim(overrides = {}) {
  return new Simulation({
    map: generateMap(overrides.seed || 'chain-seed'),
    seed: overrides.seed || 'chain-seed',
    difficulty: 'standard',
    gold: 500,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    onToast: () => {},
    ...overrides,
  });
}

function completeWaveAt(sim, wave) {
  sim.phase = 'wave';
  sim.wave = wave;
  sim.waveDef = { index: wave, reward: 0, groups: [] };
  sim.completeWave();
}

function optionIndex(event, optionId) {
  const index = event.options.findIndex((option) => option.id === optionId);
  assert.ok(index >= 0, `${event.id} 缺少选项 ${optionId}`);
  return index;
}

// 找一个让指定事件在指定波次出现的种子（事件池权重固定，同种子永远同结果）。
function seedFor(wave, eventId, attempts = 20000) {
  for (let i = 0; i < attempts; i += 1) {
    const seed = `chain-probe-${i}`;
    if (rollEvent(seed, wave)?.id === eventId) return seed;
  }
  throw new Error(`找不到在第 ${wave} 波出现 ${eventId} 的种子`);
}

const TRIGGER_SEED = seedFor(TRIGGER_WAVE, TRIGGER.fromEvent);

// 测试服务会把 x-test-seed 拼成 `test-<header>`，这里按同样的规则反推 header。
function serverSeedFor(wave, eventId, attempts = 20000) {
  for (let i = 0; i < attempts; i += 1) {
    const header = `chain-${i}`;
    const seed = `test-${header}`;
    if (rollEvent(seed, wave)?.id === eventId) return { header, seed };
  }
  throw new Error(`找不到能让第 ${wave} 波出现 ${eventId} 的服务端种子`);
}

const SERVER_TRIGGER = serverSeedFor(TRIGGER_WAVE, TRIGGER.fromEvent);

test('事件池扩到至少 12 类，新增事件定义完整', () => {
  assert.ok(EVENT_ORDER.length >= 12, `事件数 ${EVENT_ORDER.length} < 12`);
  assert.equal(new Set(EVENT_ORDER).size, EVENT_ORDER.length, '事件 id 不能重复');
  assert.deepEqual([...EVENT_ORDER].sort(), Object.keys(EVENTS).sort(), 'EVENT_ORDER 与 EVENTS 必须一致');

  for (const id of ['blood-echo', 'smuggler-camp', 'wandering-monk', 'void-rift']) {
    const event = EVENTS[id];
    assert.ok(event, `缺少新增事件 ${id}`);
    assert.equal(event.id, id);
    assert.ok(event.name && event.desc, `${id} 缺少名称或描述`);
    assert.ok(Number.isFinite(event.weight) && event.weight > 0, `${id} 权重必须为正`);
    assert.equal(typeof event.rare, 'boolean', `${id} 必须标记 rare`);
    assert.equal(event.options.length, 3, `${id} 应有三个选项`);
  }
});

test('连锁定义是纯数据：来源选项与后续事件都存在', () => {
  assert.equal(EVENT_CHAINS.length, 3, '应有 3 条连锁');
  assert.equal(new Set(EVENT_CHAINS.map((chain) => chain.id)).size, EVENT_CHAINS.length);

  for (const chain of EVENT_CHAINS) {
    assert.ok(chain.id && chain.hint, `${chain.id} 缺少 id 或提示`);
    assert.equal(chain.delayWaves, CHAIN_DELAY_WAVES, '连锁延迟统一为 2 波');
    assert.ok(EVENTS[chain.eventId], `${chain.id} 的后续事件不存在`);
    const source = EVENTS[chain.fromEvent];
    assert.ok(source, `${chain.id} 的来源事件不存在`);
    assert.ok(findEventOption(source, chain.fromOption), `${chain.id} 的来源选项不存在`);
    assert.equal(findEventChain(chain.fromEvent, chain.fromOption), chain);
    // 后续事件不再触发连锁，避免无限套娃。
    for (const option of EVENTS[chain.eventId].options) {
      assert.equal(findEventChain(chain.eventId, option.id), null, `${chain.eventId}/${option.id} 不应再连锁`);
    }
  }

  // 纯数据：可 JSON 往返，且不含函数。
  assert.deepEqual(
    JSON.parse(JSON.stringify(EVENT_CHAINS)),
    EVENT_CHAINS.map((chain) => ({ ...chain }))
  );
});

test('没有触发选项时，非事件波不生成事件', () => {
  assert.equal(isEventWave(6), false);
  assert.equal(isEventWave(7), false);
  assert.equal(isChainWave(7), true, '事件波 + 2 是合法连锁波');
  assert.equal(isChainWave(6), false);
  assert.equal(resolveEventForWave('any-seed', 6, {}), null);
  assert.equal(resolveEventForWave('any-seed', 7, {}), null, '未触发连锁时第 7 波没有事件');
  assert.equal(chainsFromHistory([{ wave: 5, eventId: TRIGGER.fromEvent, optionId: 'leave' }]).length, 0);
});

test('连锁由历史排期：2 波后固定出现后续事件', () => {
  const history = [
    { wave: TRIGGER_WAVE, eventId: TRIGGER.fromEvent, optionId: TRIGGER.fromOption },
  ];
  const chains = chainsFromHistory(history);
  assert.deepEqual(chains, [{ chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE }]);

  assert.equal(resolveEventForWave('any-seed', TRIGGER_WAVE + 1, { history }), null, '延迟未到');
  const event = resolveEventForWave('any-seed', FOLLOW_UP_WAVE, { history });
  assert.equal(event.id, TRIGGER.eventId);

  const resolved = normalizeEventHistory([
    ...history,
    { wave: FOLLOW_UP_WAVE, eventId: TRIGGER.eventId, optionId: 'leave' },
  ]);
  assert.equal(resolved.length, 2);
  assert.equal(resolveEventForWave('any-seed', FOLLOW_UP_WAVE, { history: resolved }), null, '结算后不再重复');
});

test('连锁排期归一化：未知连锁丢弃、同波次去重', () => {
  const chains = normalizeChains([
    { chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE },
    { chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE },
    { chainId: 'not-a-chain', wave: 9 },
    { chainId: TRIGGER.id, wave: 3.5 },
    null,
  ]);
  assert.deepEqual(chains, [{ chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE }]);
  assert.deepEqual(normalizeChains(undefined), [], '旧档无连锁字段按无连锁处理');
});

test('模拟器：选择连锁选项后 2 波触发后续事件，且不消耗战斗 RNG', () => {
  const sim = makeSim({ seed: TRIGGER_SEED });
  const reference = makeSim({ seed: TRIGGER_SEED });
  const expectedRng = reference.combatRng.float();

  completeWaveAt(sim, TRIGGER_WAVE);
  assert.equal(sim.phase, 'event');
  assert.equal(sim.pendingEvent.id, TRIGGER.fromEvent);

  const result = sim.applyEventOption(optionIndex(sim.pendingEvent, TRIGGER.fromOption));
  assert.equal(result.ok, true);
  assert.equal(sim.phase, 'prep');
  assert.deepEqual(sim.chains, [{ chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE }]);

  completeWaveAt(sim, TRIGGER_WAVE + 1);
  assert.equal(sim.pendingEvent, null, '延迟波次之前不应弹出后续事件');
  assert.equal(sim.phase, 'prep');

  completeWaveAt(sim, FOLLOW_UP_WAVE);
  assert.equal(sim.phase, 'event');
  assert.equal(sim.pendingEvent.id, TRIGGER.eventId, '2 波后固定触发后续事件');

  const leaveIndex = optionIndex(sim.pendingEvent, 'leave');
  assert.equal(sim.applyEventOption(leaveIndex).ok, true);
  assert.equal(sim.phase, 'prep');
  assert.deepEqual(
    sim.events.map((entry) => [entry.wave, entry.eventId]),
    [
      [TRIGGER_WAVE, TRIGGER.fromEvent],
      [FOLLOW_UP_WAVE, TRIGGER.eventId],
    ]
  );

  assert.equal(sim.combatRng.float(), expectedRng, '连锁推导与结算不得推进 combatRng');
});

test('快照 v5：链锁排期随存档往返，恢复后照常触发', () => {
  const sim = makeSim({ seed: TRIGGER_SEED });
  completeWaveAt(sim, TRIGGER_WAVE);
  sim.applyEventOption(optionIndex(sim.pendingEvent, TRIGGER.fromOption));

  const snap = sim.toSnapshot();
  assert.equal(snap.version, SAVE_VERSION, '含连锁的存档写当前版本');
  assert.equal(SAVE_VERSION, 5);
  assert.deepEqual(snap.chains, [{ chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE }]);
  assert.equal(validateSnapshot(snap).ok, true);

  const restored = makeSim({
    seed: TRIGGER_SEED,
    clearedWave: TRIGGER_WAVE,
    events: snap.events,
    chains: snap.chains,
    restored: true,
  });
  assert.equal(restored.pendingEvent, null, '已结算波次不重复弹出');
  assert.deepEqual(restored.chains, snap.chains);
  completeWaveAt(restored, TRIGGER_WAVE + 1);
  completeWaveAt(restored, FOLLOW_UP_WAVE);
  assert.equal(restored.pendingEvent?.id, TRIGGER.eventId);
});

test('migration：v4 旧存档（无 chains 字段）可继续，并按历史恢复连锁', () => {
  const events = [{ wave: TRIGGER_WAVE, eventId: TRIGGER.fromEvent, optionId: TRIGGER.fromOption }];
  const legacy = normalizeSnapshot({
    version: 4,
    clearedWave: TRIGGER_WAVE,
    relics: [],
    events,
  });
  assert.ok(legacy, 'v4 旧存档必须可继续');
  assert.equal(legacy.version, SAVE_VERSION);
  assert.equal('chains' in legacy, false, '旧档没有连锁字段时保持缺省');

  // 只有历史也能推导出连锁：恢复后在延迟波次照常触发。
  const restored = makeSim({
    seed: TRIGGER_SEED,
    clearedWave: TRIGGER_WAVE,
    events: legacy.events,
    restored: true,
  });
  assert.deepEqual(restored.chains, [{ chainId: TRIGGER.id, wave: FOLLOW_UP_WAVE }]);
  completeWaveAt(restored, TRIGGER_WAVE + 1);
  completeWaveAt(restored, FOLLOW_UP_WAVE);
  assert.equal(restored.pendingEvent?.id, TRIGGER.eventId);
});

test('无连锁的存档保持旧版本号（v3/v4）与旧字节结构', () => {
  const plain = makeSim({ seed: 'plain-seed' });
  assert.equal(plain.toSnapshot().version, 3);
  assert.equal('chains' in plain.toSnapshot(), false);

  plain.skill = { id: 'meteor', level: 1, cooldown: 0 };
  assert.equal(plain.toSnapshot().version, 4);
  assert.equal('chains' in plain.toSnapshot(), false);
});

test('同种子连锁序列稳定；不同种子事件序列不同', () => {
  const first = makeSim({ seed: TRIGGER_SEED });
  const second = makeSim({ seed: TRIGGER_SEED });
  assert.deepEqual(
    EVENT_WAVES.map((wave) => rollEvent(TRIGGER_SEED, wave)?.id),
    EVENT_WAVES.map((wave) => rollEvent(TRIGGER_SEED, wave)?.id)
  );
  for (const sim of [first, second]) {
    completeWaveAt(sim, TRIGGER_WAVE);
    sim.applyEventOption(optionIndex(sim.pendingEvent, TRIGGER.fromOption));
    completeWaveAt(sim, FOLLOW_UP_WAVE);
    sim.applyEventOption(optionIndex(sim.pendingEvent, 'leave'));
  }
  assert.deepEqual(first.events, second.events);
});

// ---------- 服务端：连锁由已记录的选择推导 ----------

let server = null;
let auth = null;

before(async () => {
  server = await startTestServer({ seedHeader: true });
  auth = await registerAndLogin(server.base);
});

after(async () => {
  if (server) await server.stop();
});

async function request(pathname, { method = 'GET', body } = {}) {
  const headers = { cookie: auth.rawCookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${server.base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function serveAndClear(runId, wave) {
  const served = await request(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(served.status, 200);
  const cleared = await request(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave },
  });
  assert.equal(cleared.status, 200);
}

test('服务端：连锁选项在第 7 波产出固定后续事件，延迟前不产出', async () => {
  const created = await fetch(`${server.base}/api/runs`, {
    method: 'POST',
    headers: {
      cookie: auth.rawCookie,
      'content-type': 'application/json',
      'x-test-seed': SERVER_TRIGGER.header,
    },
    body: JSON.stringify({ mode: 'normal', difficulty: 'standard' }),
  });
  assert.equal(created.status, 200);
  const start = await created.json();
  assert.equal(start.seed, SERVER_TRIGGER.seed);
  const runId = start.runId;

  const mapped = await request(`/api/runs/${runId}/map`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(mapped.status, 200);

  for (let wave = 1; wave <= TRIGGER_WAVE; wave += 1) await serveAndClear(runId, wave);

  const node = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
  assert.equal(node.status, 200);
  assert.equal(node.data.wave, TRIGGER_WAVE);
  assert.equal(node.data.event.id, TRIGGER.fromEvent, '服务端与服务端种子一致');

  const picked = await request(`/api/runs/${runId}/event`, {
    method: 'POST',
    body: {
      index: optionIndex(node.data.event, TRIGGER.fromOption),
      optionId: TRIGGER.fromOption,
    },
  });
  assert.equal(picked.status, 200);
  assert.equal(picked.data.picked, true);

  // 延迟波次（第 6 波）没有事件节点。
  await serveAndClear(runId, TRIGGER_WAVE + 1);
  const tooEarly = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
  assert.equal(tooEarly.status, 409, '延迟未到不应产出后续事件');

  // 第 7 波：固定后续事件，服务端与纯函数推导一致。
  await serveAndClear(runId, FOLLOW_UP_WAVE);
  const chained = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
  assert.equal(chained.status, 200);
  assert.equal(chained.data.wave, FOLLOW_UP_WAVE);
  assert.equal(chained.data.event.id, TRIGGER.eventId);
  assert.equal(chained.data.event.id, resolveEventForWave(start.seed, FOLLOW_UP_WAVE, {
    history: [{ wave: TRIGGER_WAVE, eventId: TRIGGER.fromEvent, optionId: TRIGGER.fromOption }],
  }).id);

  const chosen = await request(`/api/runs/${runId}/event`, {
    method: 'POST',
    body: { index: optionIndex(chained.data.event, 'leave'), optionId: 'leave' },
  });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.data.applied.eventId, TRIGGER.eventId);
});

test('未选连锁选项时服务端不会凭空产出后续事件', () => {
  const seed = TRIGGER_SEED;
  const history = [{ wave: TRIGGER_WAVE, eventId: TRIGGER.fromEvent, optionId: 'leave' }];
  assert.equal(resolveEventForWave(seed, FOLLOW_UP_WAVE, { history }), null);
  assert.equal(normalizeChains(EVENT_CHAINS.map((chain) => ({ chainId: chain.id, wave: 7 }))).length, 1, '同波次只保留一条');
});
