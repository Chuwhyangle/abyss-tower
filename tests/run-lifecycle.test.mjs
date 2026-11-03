// 远征生命周期验收：放弃幂等、剩余次数回传、重开不重复扣次数；爬塔节点循环/选路恢复。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { registerAndLogin, startTestServer } from './harness.mjs';
import { Simulation } from '../public/js/sim.js';
import { CombatController } from '../public/js/app/combat.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { MAX_WAVE } from '../public/js/shared/data.js';
import { TOWER_LAYERS, generateTowerGraph, nodeKey, successors } from '../public/js/shared/tower.js';

let server = null;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  if (server) await server.stop();
});

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${server.base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function newSession() {
  return registerAndLogin(server.base);
}

// 注册限流（每 IP 每小时 5 次）：爬塔 API 用例共用同一隔离账号。
// 每次 startRun 会弃用该账号上一局，两个用例互不干扰。
let towerAuth = null;
async function towerSession() {
  if (!towerAuth) towerAuth = await newSession();
  return towerAuth;
}

test('放弃进行中的远征是幂等的，并返回每日剩余次数', async () => {
  const auth = await newSession();
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'daily', difficulty: 'roam' },
    cookie: auth.rawCookie,
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.dailyAttemptsLeft, 3);
  const runId = started.data.runId;

  const first = await request(`/api/runs/${runId}/abandon`, {
    method: 'POST',
    body: {},
    cookie: auth.rawCookie,
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.ok, true);
  assert.equal(first.data.status, 'abandoned');
  assert.equal(first.data.alreadyAbandoned, false);
  // 放弃不计入完成次数：今日仍是 3 次。
  assert.equal(first.data.dailyAttemptsLeft, 3);

  const repeat = await request(`/api/runs/${runId}/abandon`, {
    method: 'POST',
    body: {},
    cookie: auth.rawCookie,
  });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.ok, true);
  assert.equal(repeat.data.status, 'abandoned');
  assert.equal(repeat.data.alreadyAbandoned, true);
  assert.equal(repeat.data.dailyAttemptsLeft, 3);

  const info = await request(`/api/runs/${runId}`, { cookie: auth.rawCookie });
  assert.equal(info.status, 200);
  assert.equal(info.data.run.status, 'abandoned');
});

test('放弃已结算的远征不会回退结算状态与次数', async () => {
  const auth = await newSession();
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'daily', difficulty: 'roam' },
    cookie: auth.rawCookie,
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;

  const finished = await request(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 17 },
    cookie: auth.rawCookie,
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.dailyAttemptsLeft, 2);

  const abandoned = await request(`/api/runs/${runId}/abandon`, {
    method: 'POST',
    body: {},
    cookie: auth.rawCookie,
  });
  assert.equal(abandoned.status, 200);
  assert.equal(abandoned.data.status, 'finished');
  assert.equal(abandoned.data.alreadyAbandoned, true);
  assert.equal(abandoned.data.dailyAttemptsLeft, 2);

  const info = await request(`/api/runs/${runId}`, { cookie: auth.rawCookie });
  assert.equal(info.status, 200);
  assert.equal(info.data.run.status, 'finished');
});

test('重开不重复扣次数：新建次日挑战沿用已完成次数', async () => {
  const auth = await newSession();
  const first = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'daily', difficulty: 'roam' },
    cookie: auth.rawCookie,
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.dailyAttemptsLeft, 3);

  const finished = await request(`/api/runs/${first.data.runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 17 },
    cookie: auth.rawCookie,
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.dailyAttemptsLeft, 2);

  // 重开一次：只统计已完成的 1 局，剩余次数保持 2。
  const restarted = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'daily', difficulty: 'roam' },
    cookie: auth.rawCookie,
  });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.data.dailyAttemptsLeft, 2);

  // 再重开一次会弃用上一局，但仍不扣次数。
  const again = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'daily', difficulty: 'roam' },
    cookie: auth.rawCookie,
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.dailyAttemptsLeft, 2);

  const previous = await request(`/api/runs/${restarted.data.runId}`, {
    cookie: auth.rawCookie,
  });
  assert.equal(previous.status, 200);
  assert.equal(previous.data.run.status, 'abandoned');

  const abandon = await request(`/api/runs/${again.data.runId}/abandon`, {
    method: 'POST',
    body: {},
    cookie: auth.rawCookie,
  });
  assert.equal(abandon.status, 200);
  assert.equal(abandon.data.dailyAttemptsLeft, 2);
});

test('普通/本周挑战的放弃返回对应模式的次数，未涉及的模式为 null', async () => {
  const auth = await newSession();

  const normal = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
    cookie: auth.rawCookie,
  });
  assert.equal(normal.status, 200);
  const normalAbandon = await request(`/api/runs/${normal.data.runId}/abandon`, {
    method: 'POST',
    body: {},
    cookie: auth.rawCookie,
  });
  assert.equal(normalAbandon.status, 200);
  assert.equal(normalAbandon.data.status, 'abandoned');
  assert.equal(normalAbandon.data.dailyAttemptsLeft, null);
  assert.equal(normalAbandon.data.weeklyAttemptsLeft, null);

  const weekly = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'weekly', difficulty: 'roam' },
    cookie: auth.rawCookie,
  });
  assert.equal(weekly.status, 200);
  assert.equal(weekly.data.weeklyAttemptsLeft, 3);
  const weeklyAbandon = await request(`/api/runs/${weekly.data.runId}/abandon`, {
    method: 'POST',
    body: {},
    cookie: auth.rawCookie,
  });
  assert.equal(weeklyAbandon.status, 200);
  assert.equal(weeklyAbandon.data.weeklyAttemptsLeft, 3);
  assert.equal(weeklyAbandon.data.dailyAttemptsLeft, null);
});

// 固定时间冻结：toSnapshot 的 savedAt 用墙钟，确定性对比前固定它。
function withFixedNow(now, fn) {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

// 爬塔战斗节点清波：开波（楼层=波次）+ 结算，供节点循环测试推进游标。
async function clearTowerNodeWave(runId, cookie, graph, key) {
  const node = graph.byKey.get(key);
  if (!node || !['fight', 'elite', 'boss'].includes(node.type)) return;
  const wave = await request(`/api/runs/${runId}/wave`, { method: 'POST', body: {}, cookie });
  assert.equal(wave.status, 200);
  assert.equal(wave.data.wave.index, node.layer);
  const cleared = await request(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave: node.layer },
    cookie,
  });
  assert.equal(cleared.status, 200);
}

test('爬塔：节点图读图、相邻后继推进与服务端校验形成节点循环', async () => {
  const auth = await towerSession();
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'tower', difficulty: 'standard' },
    cookie: auth.rawCookie,
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;
  const graph = generateTowerGraph(started.data.seed);

  // 起始节点 1:0（首层固定 fight）。
  const nodes = await request(`/api/runs/${runId}/nodes`, { cookie: auth.rawCookie });
  assert.equal(nodes.status, 200);
  assert.equal(nodes.data.route.node, '1:0');
  assert.equal(nodes.data.node.type, 'fight');
  assert.deepEqual(nodes.data.route.path, ['1:0']);

  // 战斗节点未清波不可推进（服务端防作弊）。
  const skip = await request(`/api/runs/${runId}/choose`, {
    method: 'POST',
    body: { node: '2:0' },
    cookie: auth.rawCookie,
  });
  assert.equal(skip.status, 409);

  // 清首层波后，逐层选可达后继推进游标（非战斗节点抵达即完成、无需清波）。
  await clearTowerNodeWave(runId, auth.rawCookie, graph, '1:0');
  let cursor = '1:0';
  for (let step = 0; step < 4; step++) {
    const next = successors(graph, cursor)[0];
    assert.ok(next, `第 ${graph.byKey.get(cursor).layer} 层应有后继`);
    const chosen = await request(`/api/runs/${runId}/choose`, {
      method: 'POST',
      body: { node: next.key },
      cookie: auth.rawCookie,
    });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.data.route.node, next.key);
    assert.equal(chosen.data.node.key, next.key);
    assert.equal(chosen.data.route.path[chosen.data.route.path.length - 1], next.key);
    cursor = next.key;
    await clearTowerNodeWave(runId, auth.rawCookie, graph, cursor);
  }

  // 跨层非法跳选被服务端拒绝。
  const far = await request(`/api/runs/${runId}/choose`, {
    method: 'POST',
    body: { node: nodeKey(graph.byKey.get(cursor).layer + 2, 0) },
    cookie: auth.rawCookie,
  });
  assert.equal(far.status, 400);
});

test('爬塔：getRun 回传选路 route/node，供续玩恢复节点图', async () => {
  const auth = await towerSession();
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'tower', difficulty: 'standard' },
    cookie: auth.rawCookie,
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;
  const graph = generateTowerGraph(started.data.seed);

  await clearTowerNodeWave(runId, auth.rawCookie, graph, '1:0');
  const next = successors(graph, '1:0')[0];
  const chosen = await request(`/api/runs/${runId}/choose`, {
    method: 'POST',
    body: { node: next.key },
    cookie: auth.rawCookie,
  });
  assert.equal(chosen.status, 200);

  const info = await request(`/api/runs/${runId}`, { cookie: auth.rawCookie });
  assert.equal(info.status, 200);
  assert.equal(info.data.run.mode, 'tower');
  assert.ok(info.data.run.tower, 'getRun 应回传 tower 状态');
  assert.equal(info.data.run.tower.node, next.key);
  assert.equal(info.data.run.tower.route.node, next.key);
  assert.deepEqual(info.data.run.tower.route.path, ['1:0', next.key]);
});

test('sim：computePendingEvent 按 mode 分支——普通模式沿用波次，爬塔只在事件节点派发', () => {
  const seed = 'tower-mode-branch-seed';
  // 普通模式：第 5 波事件照常派发（爬塔分支不改 normal 路径）。
  const normal = new Simulation({
    map: generateMap(seed),
    seed,
    mode: 'normal',
    difficulty: 'standard',
    clearedWave: 5,
    gold: 260,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    relics: [],
  });
  assert.ok(normal.computePendingEvent(), '普通模式第 5 波应派发事件');

  const graph = generateTowerGraph(seed);
  const eventNode = graph.nodes.find((node) => node.type === 'event');
  assert.ok(eventNode, '样例 seed 图应含事件节点');

  const tower = new Simulation({
    map: generateMap(seed),
    seed,
    mode: 'tower',
    difficulty: 'standard',
    clearedWave: 1,
    gold: 260,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    relics: [],
    tower: { route: { path: ['1:0'], node: '1:0' } },
  });
  assert.equal(tower.computePendingEvent(), null, '爬塔 fight 节点不派发事件');

  tower.setTowerRoute({ path: [eventNode.key], node: eventNode.key });
  assert.ok(tower.computePendingEvent(), '爬塔事件节点应派发事件');
  assert.equal(tower.pendingEvent.id, tower.computePendingEvent().id);
});

test('sim：gameOver 通关口径按 mode 分支，爬塔登顶 30 层、普通模式清满 30 波', () => {
  const seed = 'tower-victory-seed';
  let towerStats = null;
  const tower = new Simulation({
    map: generateMap(seed),
    seed,
    mode: 'tower',
    difficulty: 'standard',
    gold: 260,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    relics: [],
    tower: { route: { path: ['1:0'], node: '1:0' } },
    onGameOver: (stats) => {
      towerStats = stats;
    },
  });
  tower.clearedWave = TOWER_LAYERS;
  tower.gameOver(true);
  assert.equal(tower.phase, 'over');
  assert.equal(tower.clearedWave, TOWER_LAYERS);
  assert.equal(towerStats.maxWave, TOWER_LAYERS);
  assert.equal(towerStats.victory, true);

  let normalStats = null;
  const normal = new Simulation({
    map: generateMap(seed),
    seed,
    mode: 'normal',
    difficulty: 'standard',
    gold: 260,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    relics: [],
    onGameOver: (stats) => {
      normalStats = stats;
    },
  });
  normal.clearedWave = MAX_WAVE;
  normal.gameOver(true);
  assert.equal(normal.phase, 'over');
  assert.equal(normalStats.maxWave, MAX_WAVE);
  assert.equal(normalStats.victory, true);
  assert.equal(TOWER_LAYERS, MAX_WAVE);
});

test('sim：普通模式确定性不受爬塔分支影响（同 seed 快照字节一致）', () => {
  const seed = 'normal-determinism-seed';
  const makeOpts = () => ({
    map: generateMap(seed),
    seed,
    mode: 'normal',
    difficulty: 'standard',
    gold: 300,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    relics: [{ id: 'sharp', level: 1 }],
    kills: 7,
    startedAt: 1700000000000,
  });
  const a = new Simulation(makeOpts());
  const b = new Simulation(makeOpts());
  const snapA = withFixedNow(1700000000123, () => a.toSnapshot());
  const snapB = withFixedNow(1700000000123, () => b.toSnapshot());
  assert.deepEqual(snapA, snapB);
  assert.equal(snapA.mode, 'normal');
  assert.equal('tower' in snapA, false, '普通模式快照不写 tower 块');
});

// 结算控制器：用假 api/state/ui/store 记录调用顺序，验证最终波清波同步与结算链路。
function combatHarness(runId) {
  const calls = [];
  const controller = new CombatController({
    state: {
      run: { id: runId },
      app: { setPaused() {} },
      dailyLeft: 3,
    },
    api: {
      async clearWave(id, wave) {
        calls.push(['clearWave', id, wave]);
        return { ok: true, clearedWaves: wave, wavesServed: wave };
      },
      async finishRun(id, payload) {
        calls.push(['finishRun', id, payload]);
        return { victory: payload.waveReached >= MAX_WAVE, waveReached: payload.waveReached };
      },
    },
    ui: {
      closeModal() {},
      showResult(args) {
        calls.push(['showResult', args]);
      },
    },
    store: { clearSnapshot() {} },
    onRefreshProfile: async () => {},
    onRequestError() {},
  });
  return { controller, calls };
}

test('combat：通关最终波先补同步 clearWave(30)，finishRun 的 waveReached=30 不被钳到 29', async () => {
  const { controller, calls } = combatHarness('run-victory');
  await controller.handleGameOver({
    wave: MAX_WAVE,
    clearedWave: MAX_WAVE,
    kills: 10,
    gold: 5,
    baseHp: 20,
    victory: true,
    score: 0,
    rawScore: 0,
    cores: 0,
    mode: 'normal',
    difficulty: 'standard',
    maxWave: MAX_WAVE,
  });
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['clearWave', 'finishRun', 'showResult'],
    'victory 结算应先 clearWave 再 finishRun'
  );
  assert.equal(calls[0][1], 'run-victory');
  assert.equal(calls[0][2], MAX_WAVE, '最终波应同步 clearWave(30)');
  assert.equal(calls[1][2].waveReached, MAX_WAVE, 'finishRun 应携带 waveReached=30');
  assert.equal(calls[2][1].res.victory, true);
});

test('combat：非通关（死亡）不误同步最终波，waveReached 用已清波次', async () => {
  const { controller, calls } = combatHarness('run-defeat');
  await controller.handleGameOver({
    wave: 29,
    clearedWave: 29,
    kills: 10,
    gold: 5,
    baseHp: 0,
    victory: false,
    score: 0,
    rawScore: 0,
    cores: 0,
    mode: 'normal',
    difficulty: 'standard',
    maxWave: MAX_WAVE,
  });
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['finishRun', 'showResult'],
    '非通关不应调用 clearWave'
  );
  assert.equal(calls[0][2].waveReached, 29, '死亡结算 waveReached 应为已清波次 29');
});
