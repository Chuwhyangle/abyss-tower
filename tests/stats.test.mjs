// 生涯统计：注册登录 → 无对局零值 → 2 局（1 胜 1 负）聚合正确 → 未登录 401 且不泄露他人数据。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19900 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `rtd-stats-${process.pid}-${Date.now()}.db`);

let server = null;
let serverLog = '';
let cookie = '';

function api(pathname, { method = 'GET', body, as = cookie } = {}) {
  return fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(as ? { cookie: as } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function jsonApi(pathname, options) {
  const response = await api(pathname, options);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function register(username) {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'rtd-test-password' }),
  });
  const data = await response.json();
  assert.equal(response.status, 201, `注册失败：${JSON.stringify(data)}`);
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

async function playRun({ waves, survive }) {
  const started = await jsonApi('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;

  const map = await jsonApi(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } });
  assert.equal(map.status, 200);

  for (let wave = 1; wave <= waves; wave++) {
    const served = await jsonApi(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
    assert.equal(served.status, 200);
    const cleared = await jsonApi(`/api/runs/${runId}/clear`, {
      method: 'POST',
      body: { wave },
    });
    assert.equal(cleared.status, 200);
  }

  const finished = await jsonApi(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: {
      waveReached: waves,
      kills: waves * 10,
      goldLeft: 0,
      baseHp: survive ? 20 : 0,
    },
  });
  assert.equal(finished.status, 200);
  return finished.data;
}

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH,
      AUTH_ENABLED: '1',
      REGISTRATION_MODE: 'open',
      DB_BACKUP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });

  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* 等待启动 */
    }
    await sleep(100);
  }
  throw new Error(`测试服务未能启动：${serverLog}`);
});

after(async () => {
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    for (let i = 0; i < 40 && server.exitCode == null; i++) await sleep(50);
    if (server.exitCode == null) server.kill('SIGKILL');
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('未登录请求生涯统计返回 401', async () => {
  const response = await api('/api/stats', { as: null });
  assert.equal(response.status, 401);
});

test('无对局时返回零值', async () => {
  cookie = await register(`stats${Date.now().toString(36).slice(-8)}`);
  const { status, data } = await jsonApi('/api/stats');
  assert.equal(status, 200);
  assert.deepEqual(data.totals, {
    runs: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    bestWave: 0,
    avgWave: 0,
    bestScore: 0,
    kills: 0,
  });
  assert.equal(data.byDifficulty.length, 3);
  assert.deepEqual(
    data.byDifficulty.map((item) => item.id),
    ['roam', 'standard', 'abyss']
  );
  for (const item of data.byDifficulty) {
    assert.equal(item.runs, 0);
    assert.equal(item.wins, 0);
    assert.equal(item.winRate, 0);
    assert.equal(item.bestWave, 0);
  }
  assert.deepEqual(data.recent, []);
});

test('2 局（1 胜 1 负）聚合出总局数/通关数/最高波次', async () => {
  const loss = await playRun({ waves: 1, survive: false });
  assert.equal(loss.victory, false);
  await sleep(5);
  const win = await playRun({ waves: 30, survive: true });
  assert.equal(win.victory, true);

  const { status, data } = await jsonApi('/api/stats');
  assert.equal(status, 200);
  assert.equal(data.totals.runs, 2);
  assert.equal(data.totals.wins, 1);
  assert.equal(data.totals.losses, 1);
  assert.equal(data.totals.winRate, 0.5);
  assert.equal(data.totals.bestWave, 30);
  assert.equal(data.totals.avgWave, 15.5);
  assert.equal(data.totals.kills, 310);

  const standard = data.byDifficulty.find((item) => item.id === 'standard');
  assert.equal(standard.runs, 2);
  assert.equal(standard.wins, 1);
  assert.equal(standard.winRate, 0.5);
  assert.equal(standard.bestWave, 30);
  const idle = data.byDifficulty.filter((item) => item.id !== 'standard');
  assert.ok(idle.every((item) => item.runs === 0));

  assert.equal(data.recent.length, 2);
  assert.equal(data.recent[0].victory, true);
  assert.equal(data.recent[0].waveReached, 30);
  assert.equal(data.recent[0].difficultyName, '远征');
  assert.equal(data.recent[1].victory, false);
  assert.equal(data.recent[1].waveReached, 1);
  for (const run of data.recent) {
    assert.equal(typeof run.id, 'string');
    assert.equal(run.mode, 'normal');
    assert.equal(typeof run.score, 'number');
    assert.equal(typeof run.finishedAt, 'number');
  }
});

test('不泄露他人数据：新账号只能看到自己的零值', async () => {
  const otherCookie = await register(`stats${Date.now().toString(36).slice(-8)}o`);
  const other = await jsonApi('/api/stats', { as: otherCookie });
  assert.equal(other.status, 200);
  assert.equal(other.data.totals.runs, 0);
  assert.deepEqual(other.data.recent, []);

  const mine = await jsonApi('/api/stats');
  assert.equal(mine.data.totals.runs, 2);
});
