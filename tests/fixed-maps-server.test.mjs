// 固定地图服务端接入：所有模式共用同一组三张固定图与固定 trait；
// 旧 ruleset（无 mapPool）在 serialize/选图/放波/结算时只读回退 legacy carve，不崩溃。
// 对应 MAP-002 的验收标准：node --test tests/fixed-maps-server.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { startServer } from './test-server.mjs';

import { ARCHETYPES, generateMapCandidates } from '../public/js/shared/mapgen.js';
import { FIXED_MAPS, FIXED_MAP_BY_ID, FIXED_TRAITS } from '../public/js/shared/maps/index.js';
import { dailyChallenge, weeklyChallenge } from '../public/js/shared/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;
let BASE = '';
const DB = path.join(os.tmpdir(), `rtd-fixed-maps-${process.pid}-${Date.now()}.db`);

// 新 run 的固定地图池标识（任务契约；测试不 import 服务端模块，避免打开默认数据库）。
const FIXED_MAP_POOL = 'fixed-v1';
const FIXED_IDS = ['canyon', 'twin', 'ring'];
const EXPECTED_TRAITS = { canyon: null, twin: 'trade', ring: 'echo' };

let server = null;

async function api(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function createRun(token, body = { mode: 'normal', difficulty: 'roam' }) {
  const res = await api('/api/runs', { method: 'POST', token, body });
  assert.equal(res.status, 200, `建局失败：${JSON.stringify(res.data)}`);
  return res.data;
}

function startWave(token, runId) {
  return api(`/api/runs/${runId}/wave`, { method: 'POST', token });
}

function clearWave(token, runId, wave) {
  return api(`/api/runs/${runId}/clear`, { method: 'POST', token, body: { wave } });
}

function chooseMap(token, runId, index) {
  return api(`/api/runs/${runId}/map`, { method: 'POST', token, body: { index } });
}

function getRun(token, runId) {
  return api(`/api/runs/${runId}`, { token });
}

function finish(token, runId, body) {
  return api(`/api/runs/${runId}/finish`, { method: 'POST', token, body });
}

// 旧存档模拟：直接抹掉 ruleset_json 里的 mapPool，等价于改造前落库的 run。
function stripMapPool(runId) {
  const db = new DatabaseSync(DB);
  try {
    const row = db.prepare('SELECT ruleset_json FROM runs WHERE id = ?').get(runId);
    assert.ok(row, `run ${runId} 不在数据库中`);
    const ruleset = JSON.parse(row.ruleset_json);
    delete ruleset.mapPool;
    db.prepare('UPDATE runs SET ruleset_json = ? WHERE id = ?').run(
      JSON.stringify(ruleset),
      runId
    );
  } finally {
    db.close();
  }
}

function candidateFingerprint(candidates) {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    scoreMul: candidate.meta.scoreMul,
    portalCount: candidate.meta.portalCount,
    trait: candidate.meta.modifier?.id || null,
    lanes: candidate.lanes.map((lane) => lane.cells.length),
  }));
}

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    env: { AUTH_ENABLED: '0' },
  });
  PORT = server.port;
  BASE = server.base;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('创建 run 返回 3 张固定图，且与服务端/客户端共用的固定池一致', async () => {
  const token = 'fixed-ac1-shape';
  const start = await createRun(token);

  assert.equal(start.ruleset.mapPool, FIXED_MAP_POOL, '新 run 必须写入固定地图池标识');
  assert.equal(start.candidates.length, 3);
  assert.deepEqual(
    start.candidates.map((candidate) => candidate.id),
    FIXED_IDS,
    '候选顺序必须固定为 canyon → twin → ring'
  );
  // 服务端返回的就是 shared/maps 里的同一份数据，没有复制第二份几何。
  for (const [index, candidate] of start.candidates.entries()) {
    const shared = FIXED_MAP_BY_ID[candidate.id];
    assert.ok(shared, `${candidate.id} 必须在固定池中`);
    assert.deepEqual(candidate.lanes, shared.lanes, `${candidate.id} 的 lane 几何来自共享模块`);
    assert.deepEqual(candidate.meta, shared.meta, `${candidate.id} 的 meta 来自共享模块`);
    assert.equal(candidate.meta.modifier?.id || null, EXPECTED_TRAITS[candidate.id]);
    assert.equal(candidate.index, index);
  }
});

test('逐张选择后 serveWave 的 portalCount 与固定 trait 正确', async () => {
  const results = [];
  // 12 波及以后多入口地图才会同时激活全部入口：用 12 波验证 portalCount 确实生效。
  const WAVES = 12;
  for (const [index, id] of FIXED_IDS.entries()) {
    const token = `fixed-ac1-pick-${index}`;
    const start = await createRun(token);
    const expected = start.candidates[index];
    assert.equal(expected.id, id);

    const picked = await chooseMap(token, start.runId, index);
    assert.equal(picked.status, 200);
    assert.equal(picked.data.mapChoice, index);
    assert.equal(picked.data.map.id, id);
    assert.equal(picked.data.mapMeta.portalCount, expected.meta.portalCount);
    assert.equal(picked.data.mapMeta.modifier?.id || null, EXPECTED_TRAITS[id]);

    // serialize 与 chooseMap 用同一套取图逻辑，刷新后仍是同一张图。
    const info = await getRun(token, start.runId);
    assert.equal(info.status, 200);
    assert.deepEqual(info.data.run.map, picked.data.map);
    assert.deepEqual(info.data.run.mapMeta, picked.data.mapMeta);

    const portalCount = expected.meta.portalCount;
    let maxPortal = -1;
    for (let wave = 1; wave <= WAVES; wave++) {
      const served = await startWave(token, start.runId);
      assert.equal(served.status, 200, `第 ${wave} 波放行失败：${JSON.stringify(served.data)}`);
      assert.equal(served.data.wave.index, wave);
      assert.equal(
        served.data.wave.modifierId,
        EXPECTED_TRAITS[id],
        `${id} 第 ${wave} 波必须带固定 trait`
      );
      assert.ok(
        served.data.wave.portals.every((portal) => portal >= 0 && portal < portalCount),
        `${id} 第 ${wave} 波入口编号越界：${JSON.stringify(served.data.wave.portals)}`
      );
      maxPortal = Math.max(maxPortal, ...served.data.wave.portals);
      const cleared = await clearWave(token, start.runId, wave);
      assert.equal(cleared.status, 200);
    }
    assert.equal(
      maxPortal,
      portalCount - 1,
      `${id} 的入口数 ${portalCount} 必须在波次里全部出现`
    );
    results.push({ id, portalCount, trait: EXPECTED_TRAITS[id] });
  }
  assert.deepEqual(
    results.map((item) => item.portalCount),
    FIXED_MAPS.map((map) => map.meta.portalCount)
  );
});

test('同一 day 的每日挑战、同一周的每周挑战返回完全一致的三张图与 trait', async () => {
  const dailyA = await createRun('fixed-ac2-daily-a', { mode: 'daily', difficulty: 'roam' });
  const dailyB = await createRun('fixed-ac2-daily-b', { mode: 'daily', difficulty: 'roam' });
  assert.equal(dailyA.day, dailyB.day);
  assert.equal(dailyA.seed, dailyB.seed);
  assert.deepEqual(
    candidateFingerprint(dailyA.candidates),
    candidateFingerprint(dailyB.candidates),
    '同一天的所有玩家必须拿到同一组三张固定图与 trait'
  );
  assert.deepEqual(
    dailyA.candidates.map((candidate) => candidate.id),
    FIXED_IDS
  );
  assert.deepEqual(
    dailyA.candidates.map((candidate) => candidate.meta.modifier?.id || null),
    FIXED_MAPS.map((map) => map.meta.modifier?.id || null)
  );
  // 每日挑战的“词缀”就是固定地图的固定 trait，不再依赖随机词缀派生。
  assert.deepEqual(
    dailyA.daily.modifiers.map((modifier) => modifier.id),
    FIXED_TRAITS.map((trait) => trait.id)
  );
  assert.deepEqual(
    dailyA.daily.modifiers.map((modifier) => modifier.id),
    dailyChallenge(dailyA.day).modifiers.map((modifier) => modifier.id)
  );

  const weeklyA = await createRun('fixed-ac2-weekly-a', { mode: 'weekly', difficulty: 'roam' });
  const weeklyB = await createRun('fixed-ac2-weekly-b', { mode: 'weekly', difficulty: 'roam' });
  assert.equal(weeklyA.day, weeklyB.day);
  assert.equal(weeklyA.seed, weeklyB.seed);
  assert.deepEqual(
    candidateFingerprint(weeklyA.candidates),
    candidateFingerprint(weeklyB.candidates),
    '同一周的所有玩家必须拿到同一组三张固定图与 trait'
  );
  assert.deepEqual(
    weeklyA.weekly.modifiers.map((modifier) => modifier.id),
    expectedWeeklyTraitIds()
  );
  assert.deepEqual(
    weeklyA.weekly.modifiers.map((modifier) => modifier.id),
    weeklyChallenge().modifiers.map((modifier) => modifier.id)
  );
});

function expectedWeeklyTraitIds() {
  return FIXED_TRAITS.slice(0, weeklyChallenge().modifiers.length).map((trait) => trait.id);
}

test('旧 ruleset（无 mapPool）仍能 serialize，并在选图/放波/结算时只读回退 legacy', async () => {
  // 情况 A：旧 run 尚未选图 —— serialize 不抛错，map/mapMeta 为 null。
  const tokenNoChoice = 'fixed-ac3-legacy-nochoice';
  const legacyNoChoice = await createRun(tokenNoChoice);
  stripMapPool(legacyNoChoice.runId);
  const active = await api('/api/runs/active', { token: tokenNoChoice });
  assert.equal(active.status, 200);
  assert.equal(active.data.run.id, legacyNoChoice.runId);
  assert.equal(active.data.run.map, null);
  assert.equal(active.data.run.mapMeta, null);
  assert.equal(active.data.run.ruleset.mapPool, undefined, '旧 run 不应被补写 mapPool');

  // 情况 B：旧 run 已选图 —— 取图回退 legacy carve（不再是固定池），放波与结算都不崩溃。
  const token = 'fixed-ac3-legacy';
  const legacy = await createRun(token);
  stripMapPool(legacy.runId);
  const index = 2;
  const picked = await chooseMap(token, legacy.runId, index);
  assert.equal(picked.status, 200);
  assert.equal(picked.data.map.id, undefined, '旧 run 回退的地图不是固定池地图');
  assert.equal(picked.data.map.seed, `${legacy.seed}:candidate:${index}`, '必须重建旧随机候选');
  assert.ok(ARCHETYPES[picked.data.map.meta.archetype], '旧候选的原型必须合法');
  assert.equal(
    picked.data.mapMeta.modifier?.id || null,
    picked.data.map.modifier?.id || null
  );

  const served = await startWave(token, legacy.runId);
  assert.equal(served.status, 200);
  assert.equal(served.data.wave.modifierId, picked.data.mapMeta.modifier?.id || null);
  assert.ok(served.data.wave.portals.every((portal) => portal < picked.data.mapMeta.portalCount));
  const cleared = await clearWave(token, legacy.runId, 1);
  assert.equal(cleared.status, 200);

  // 结算会走 replaySummary + settle 的同一套取图逻辑。
  const settled = await finish(token, legacy.runId, {
    waveReached: 1,
    kills: 0,
    goldLeft: 0,
    baseHp: 20,
  });
  assert.equal(settled.status, 200, `旧 run 结算失败：${JSON.stringify(settled.data)}`);
  assert.equal(typeof settled.data.score, 'number');
});

test('普通/每日/本周/无尽/变异模式都能选到三张固定图', async () => {
  const cases = [
    { mode: 'normal', token: 'fixed-ac4-normal' },
    { mode: 'daily', token: 'fixed-ac4-daily' },
    { mode: 'weekly', token: 'fixed-ac4-weekly' },
    { mode: 'endless', token: 'fixed-ac4-endless', difficulty: 'roam' },
    {
      mode: 'mutated',
      token: 'fixed-ac4-mutated',
      mutations: ['no_reroll', 'famine', 'narrow_towers'],
    },
  ];
  for (const item of cases) {
    const body = { mode: item.mode, difficulty: item.difficulty || 'roam' };
    if (item.mutations) body.mutations = item.mutations;
    const start = await createRun(item.token, body);
    assert.equal(start.mode, item.mode);
    assert.equal(start.ruleset.mapPool, FIXED_MAP_POOL, `${item.mode} 必须写入 mapPool`);
    assert.deepEqual(
      start.candidates.map((candidate) => candidate.id),
      FIXED_IDS,
      `${item.mode} 的三张固定图顺序`
    );
    assert.deepEqual(
      start.candidates.map((candidate) => candidate.meta.modifier?.id || null),
      FIXED_MAPS.map((map) => map.meta.modifier?.id || null),
      `${item.mode} 的固定 trait`
    );

    const picked = await chooseMap(item.token, start.runId, 1);
    assert.equal(picked.status, 200);
    assert.equal(picked.data.map.id, 'twin');
    assert.equal(picked.data.mapMeta.modifier.id, 'trade');
  }
});

test('客户端共享入口与服务端固定池同源（fixedMapCandidates 与 create 一致）', async () => {
  const start = await createRun('fixed-shared-source');
  // 客户端刷新恢复用 fixedMapCandidates(seed)，必须与服务端 create 的候选逐字一致。
  const candidates = generateMapCandidates(start.seed, 3);
  assert.deepEqual(
    candidateFingerprint(candidates),
    candidateFingerprint(start.candidates),
    '客户端固定池与服务端候选不一致'
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    FIXED_MAPS.map((map) => map.id)
  );
});
