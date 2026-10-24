// 远征生命周期验收：放弃幂等、剩余次数回传、重开不重复扣次数。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { registerAndLogin, startTestServer } from './harness.mjs';

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
