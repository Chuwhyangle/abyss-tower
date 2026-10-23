// 远征领域服务验收：黄金路径、结算幂等、未登录 401、序列化共用。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { registerAndLogin, startTestServer } from './harness.mjs';

let server = null;
let auth = null;

before(async () => {
  server = await startTestServer();
  auth = await registerAndLogin(server.base);
});

after(async () => {
  if (server) await server.stop();
});

async function request(pathname, { method = 'GET', body, cookie = auth.rawCookie } = {}) {
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

test('黄金路径：开局 → 选图 → 波次推进 → 遗物 → 结算', async () => {
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  assert.ok(started.data.runId);
  assert.equal(started.data.clearedWaves, 0);
  assert.equal(started.data.wavesServed, 0);
  assert.equal(started.data.candidates.length, 3);
  const runId = started.data.runId;

  const mapped = await request(`/api/runs/${runId}/map`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(mapped.status, 200);
  assert.equal(mapped.data.mapChoice, 0);

  const wave1 = await request(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(wave1.status, 200);
  assert.equal(wave1.data.wave.index, 1);
  assert.equal(wave1.data.replay, false);
  assert.equal(wave1.data.wavesServed, 1);

  const cleared = await request(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave: 1 },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.clearedWaves, 1);

  const offers = await request(`/api/runs/${runId}/relics`, {
    method: 'POST',
    body: {},
  });
  assert.equal(offers.status, 200);
  assert.equal(offers.data.offers.length, 3);
  assert.equal(offers.data.wave, 1);

  const picked = await request(`/api/runs/${runId}/relic`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(picked.status, 200);
  assert.equal(picked.data.picked, true);
  assert.ok(Array.isArray(picked.data.relics));

  const wave2 = await request(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(wave2.status, 200);
  assert.equal(wave2.data.wave.index, 2);
  assert.equal(wave2.data.clearedWaves, 1);
  assert.equal(wave2.data.wavesServed, 2);

  const finished = await request(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 2, kills: 25, goldLeft: 120, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  // 进行中的第 2 波不算已清，结算只认已结算波次。
  assert.equal(finished.data.waveReached, 1);
  assert.equal(finished.data.difficulty, 'standard');
  assert.ok(finished.data.score >= 0);
  assert.ok(finished.data.coresEarned >= 0);
  assert.equal(typeof finished.data.personalBest, 'boolean');
  assert.ok(finished.data.rank >= 1);

  const info = await request(`/api/runs/${runId}`);
  assert.equal(info.status, 200);
  assert.equal(info.data.run.status, 'finished');
});

test('结算幂等：重复提交返回 409 且不重复计分', async () => {
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;

  const first = await request(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(first.status, 200);

  const beforeRepeat = await request('/api/profile');
  const repeat = await request(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.data.error, '该远征已结束');

  const afterRepeat = await request('/api/profile');
  assert.equal(afterRepeat.data.profile.cores, beforeRepeat.data.profile.cores);
  assert.equal(afterRepeat.data.profile.stats.runs, beforeRepeat.data.profile.stats.runs);
});

test('未登录访问远征接口返回 401', async () => {
  const active = await request('/api/runs/active', { cookie: null });
  assert.equal(active.status, 401);
  assert.equal(active.data.code, 'AUTH_REQUIRED');

  const created = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'normal' },
    cookie: null,
  });
  assert.equal(created.status, 401);
});

test('active 与 resource 共用同一份 run 序列化', async () => {
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'roam' },
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;
  await request(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 1 } });

  const active = await request('/api/runs/active');
  assert.equal(active.status, 200);
  const info = await request(`/api/runs/${runId}`);
  assert.equal(info.status, 200);

  const activeRun = active.data.run;
  const infoRun = info.data.run;
  assert.ok(activeRun);
  assert.equal(infoRun.victory, false);
  assert.deepEqual(
    Object.keys(infoRun).filter((key) => key !== 'victory'),
    Object.keys(activeRun)
  );
  for (const key of Object.keys(activeRun)) {
    assert.deepEqual(infoRun[key], activeRun[key], `字段 ${key} 不一致`);
  }
});
