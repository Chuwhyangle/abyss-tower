// 每日挑战历史：最近 14 天派生纯函数、本人最佳成绩合并、越权隔离与登录门禁。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  dailyChallenge,
  dayKey,
  recentDailyChallenges,
  shiftDay,
} from '../public/js/shared/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18900 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-daily-history-test-${process.pid}-${Date.now()}.db`);
const TOKEN_A = 'daily-history-token-a01';
const TOKEN_B = 'daily-history-token-b01';

let server = null;
let serverLog = '';

async function api(pathname, { method = 'GET', body, token = TOKEN_A } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { 'x-player-token': token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function startDaily(token = TOKEN_A) {
  return api('/api/runs', { method: 'POST', body: { mode: 'daily', difficulty: 'roam' }, token });
}

function finishDaily(runId, baseHp, token = TOKEN_A) {
  return api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp },
    token,
  });
}

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: DB,
      AUTH_ENABLED: '0',
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

test('最近 14 天派生稳定，按日期从新到旧排列', () => {
  const first = recentDailyChallenges('2026-10-24', 14);
  const second = recentDailyChallenges('2026-10-24', 14);
  assert.deepEqual(first, second);
  assert.equal(first.length, 14);
  assert.equal(first[0].day, '2026-10-24');
  assert.equal(first[13].day, '2026-10-11');

  for (let i = 1; i < first.length; i++) {
    assert.equal(first[i].day, shiftDay(first[i - 1].day, -1), '历史未按日期连续倒序');
  }
  for (const entry of first) {
    const challenge = dailyChallenge(entry.day);
    assert.equal(entry.seed, challenge.seed);
    assert.deepEqual(
      entry.modifiers,
      challenge.modifiers.map((modifier) => modifier.id),
      `词缀 id 与 dailyChallenge 不一致：${entry.day}`
    );
  }
});

test('跨年边界连续且种子不重复', () => {
  const list = recentDailyChallenges('2025-01-02', 14);
  assert.equal(list[0].day, '2025-01-02');
  assert.equal(list[13].day, '2024-12-20');
  assert.ok(list.some((entry) => entry.day === '2024-12-31'));
  assert.ok(list.some((entry) => entry.day === '2025-01-01'));
  assert.equal(new Set(list.map((entry) => entry.seed)).size, 14);
});

test('未登录访问返回 401', async () => {
  const response = await fetch(`${BASE}/api/daily/history?days=14`);
  assert.equal(response.status, 401);
});

test('接口只返回本人成绩，并按日期从新到旧稳定排列', async () => {
  const beforePlay = await api('/api/daily/history?days=14');
  assert.equal(beforePlay.status, 200);
  assert.equal(beforePlay.data.days, 14);
  assert.equal(beforePlay.data.history.length, 14);
  assert.equal(beforePlay.data.today, dayKey());
  assert.equal(beforePlay.data.history[0].day, dayKey());
  assert.equal(beforePlay.data.history[0].played, false);

  const scores = [];
  for (const baseHp of [10, 20]) {
    const started = await startDaily();
    assert.equal(started.status, 200);
    const finished = await finishDaily(started.data.runId, baseHp);
    assert.equal(finished.status, 200);
    scores.push(finished.data.score);
  }

  const mine = await api('/api/daily/history?days=14');
  assert.equal(mine.status, 200);
  const today = mine.data.history.find((entry) => entry.day === dayKey());
  assert.equal(today.played, true);
  assert.equal(today.bestScore, Math.max(...scores));
  assert.equal(today.attempts, 2);
  assert.deepEqual(
    today.modifiers,
    dailyChallenge(dayKey()).modifiers.map((modifier) => modifier.id)
  );
  for (let i = 1; i < mine.data.history.length; i++) {
    assert.ok(
      mine.data.history[i - 1].day > mine.data.history[i].day,
      '历史未按日期从新到旧排列'
    );
  }

  const other = await api('/api/daily/history?days=14', { token: TOKEN_B });
  assert.equal(other.status, 200);
  const otherToday = other.data.history.find((entry) => entry.day === dayKey());
  assert.equal(otherToday.played, false, '泄露了其他玩家的每日成绩');
  assert.equal(otherToday.bestScore, null);
  assert.equal(otherToday.attempts, 0);
});

test('days 参数被限制在 1 到 14 天', async () => {
  const capped = await api('/api/daily/history?days=99', { token: TOKEN_B });
  assert.equal(capped.status, 200);
  assert.equal(capped.data.days, 14);
  assert.equal(capped.data.history.length, 14);

  const single = await api('/api/daily/history?days=1', { token: TOKEN_B });
  assert.equal(single.status, 200);
  assert.equal(single.data.days, 1);
  assert.equal(single.data.history.length, 1);
  assert.equal(single.data.history[0].day, dayKey());

  const invalid = await api('/api/daily/history?days=abc', { token: TOKEN_B });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.data.days, 14);
});
