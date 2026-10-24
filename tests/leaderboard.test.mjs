// 排行榜接口测试：分页边界、难度筛选、个人排名与未登录行为。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { allocatePort, waitForHealth } from './test-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-leaderboard-test-${process.pid}-${Date.now()}.db`);

const TOKENS = {
  alpha: 'lb-alpha-0001',
  beta: 'lb-beta-0001',
  gamma: 'lb-gamma-0001',
  delta: 'lb-delta-0001',
  epsilon: 'lb-epsilon-0001',
};

let server = null;
let serverLog = '';
const totals = new Map();

async function api(pathname, { method = 'GET', token = TOKENS.alpha, body } = {}) {
  const headers = {};
  if (token) headers['x-player-token'] = token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

// 真实走一遍开局 → 选图 → 放行/结算波次 → 结算，产生一条排行榜成绩。
async function play(token, { mode = 'normal', difficulty = 'standard', waves = 1 } = {}) {
  const start = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode, difficulty },
  });
  assert.equal(start.status, 200, `开局失败：${JSON.stringify(start.data)}`);
  const runId = start.data.runId;

  const map = await api(`/api/runs/${runId}/map`, {
    method: 'POST',
    token,
    body: { index: 0 },
  });
  assert.equal(map.status, 200);

  for (let wave = 1; wave <= waves; wave += 1) {
    const served = await api(`/api/runs/${runId}/wave`, { method: 'POST', token, body: {} });
    assert.equal(served.status, 200);
    const cleared = await api(`/api/runs/${runId}/clear`, {
      method: 'POST',
      token,
      body: { wave },
    });
    assert.equal(cleared.status, 200);
  }

  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    token,
    body: { waveReached: waves, kills: waves * 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200, `结算失败：${JSON.stringify(finished.data)}`);
  return finished.data;
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

  await waitForHealth({ base: BASE, port: PORT, child: server, log: () => serverLog });

  totals.set('alpha', (await play(TOKENS.alpha, { waves: 3 })).score);
  const betaHigh = await play(TOKENS.beta, { waves: 6 });
  const betaLow = await play(TOKENS.beta, { waves: 1 });
  totals.set('betaHigh', betaHigh.score);
  totals.set('betaLow', betaLow.score);
  totals.set('gamma', (await play(TOKENS.gamma, { waves: 2 })).score);
  totals.set('delta', (await play(TOKENS.delta, { difficulty: 'abyss', waves: 5 })).score);
  totals.set('epsilon', (await play(TOKENS.epsilon, { waves: 4 })).score);
});

after(async () => {
  if (server && server.exitCode == null) server.kill('SIGTERM');
  for (let i = 0; i < 30 && server && server.exitCode == null; i += 1) await sleep(50);
  if (server && server.exitCode == null) server.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('分页：名次连续、total/totalPages 正确、旧字段完整', async () => {
  const page1 = await api('/api/leaderboard?mode=normal&size=2&page=1');
  assert.equal(page1.status, 200);
  assert.equal(page1.data.mode, 'normal');
  assert.equal(page1.data.page, 1);
  assert.equal(page1.data.size, 2);
  assert.equal(page1.data.total, 5);
  assert.equal(page1.data.totalPages, 3);
  assert.equal(page1.data.entries.length, 2);
  assert.deepEqual(
    page1.data.entries.map((entry) => entry.rank),
    [1, 2]
  );

  const oldFields = [
    'name',
    'difficulty',
    'wave',
    'score',
    'kills',
    'victory',
    'durationMs',
    'contentVersion',
    'createdAt',
  ];
  for (const field of oldFields) {
    assert.ok(field in page1.data.entries[0], `旧字段缺失：${field}`);
  }

  const page3 = await api('/api/leaderboard?mode=normal&size=2&page=3');
  assert.equal(page3.data.entries.length, 1);
  assert.equal(page3.data.entries[0].rank, 5);

  const beyond = await api('/api/leaderboard?mode=normal&size=2&page=9');
  assert.equal(beyond.data.entries.length, 0);
  assert.equal(beyond.data.total, 5);
  assert.equal(beyond.data.totalPages, 3);
});

test('分页边界：page 最小为 1，size 有上限，非法值回落到默认', async () => {
  const clamped = await api('/api/leaderboard?mode=normal&page=0&size=999');
  assert.equal(clamped.status, 200);
  assert.equal(clamped.data.page, 1);
  assert.equal(clamped.data.size, 50);
  assert.equal(clamped.data.entries.length, 5);
  assert.equal(clamped.data.entries[0].rank, 1);

  const garbage = await api('/api/leaderboard?mode=normal&page=abc&size=abc');
  assert.equal(garbage.status, 200);
  assert.equal(garbage.data.page, 1);
  assert.equal(garbage.data.size, 20);
});

test('难度筛选：只返回所选难度，未知难度按全部处理', async () => {
  const abyss = await api('/api/leaderboard?mode=normal&difficulty=abyss');
  assert.equal(abyss.data.difficulty, 'abyss');
  assert.equal(abyss.data.total, 1);
  assert.equal(abyss.data.entries.length, 1);
  assert.equal(abyss.data.entries[0].difficulty, 'abyss');
  assert.equal(abyss.data.entries[0].score, totals.get('delta'));

  const standard = await api('/api/leaderboard?mode=normal&difficulty=standard');
  assert.equal(standard.data.total, 4);
  assert.ok(standard.data.entries.every((entry) => entry.difficulty === 'standard'));

  const bogus = await api('/api/leaderboard?mode=normal&difficulty=bogus');
  assert.equal(bogus.data.difficulty, null);
  assert.equal(bogus.data.total, 5);
});

test('个人排名：标记自己、最佳/最近成绩与名次一致', async () => {
  const board = await api('/api/leaderboard?mode=normal&size=50', { token: TOKENS.beta });
  const mine = board.data.entries.find((entry) => entry.isMe);
  assert.ok(mine, '当前账号的成绩应被标记');
  assert.equal(board.data.entries.filter((entry) => entry.isMe).length, 1);

  assert.equal(mine.score, totals.get('betaHigh'));
  assert.equal(board.data.me.rank, mine.rank);
  assert.equal(board.data.me.best.score, totals.get('betaHigh'));
  assert.equal(board.data.me.latest.score, totals.get('betaLow'));
  assert.ok(board.data.me.latest.score < board.data.me.best.score);

  const better = board.data.entries.filter(
    (entry) =>
      entry.score > mine.score ||
      (entry.score === mine.score && entry.durationMs < mine.durationMs)
  );
  assert.equal(mine.rank, better.length + 1);

  const other = await api('/api/leaderboard?mode=normal&size=50', { token: TOKENS.alpha });
  assert.equal(other.data.me.best.score, totals.get('alpha'));
  assert.equal(other.data.entries.filter((entry) => entry.isMe).length, 1);
});

test('个人排名：受难度筛选影响，无成绩时返回空摘要且不泄露敏感字段', async () => {
  const abyss = await api('/api/leaderboard?mode=normal&difficulty=abyss', {
    token: TOKENS.delta,
  });
  assert.equal(abyss.data.me.rank, 1);
  assert.equal(abyss.data.me.best.difficulty, 'abyss');
  assert.equal(abyss.data.me.best.score, totals.get('delta'));

  const standard = await api('/api/leaderboard?mode=normal&difficulty=standard', {
    token: TOKENS.delta,
  });
  assert.equal(standard.data.me.rank, null);
  assert.equal(standard.data.me.best, null);
  assert.equal(standard.data.me.latest, null);

  const me = abyss.data.me;
  assert.deepEqual(Object.keys(me).sort(), ['best', 'latest', 'rank']);
  for (const key of ['accountId', 'account_id', 'runId', 'name', 'username']) {
    assert.ok(!(key in me.best), `个人摘要泄露字段：${key}`);
    assert.ok(!(key in me.latest), `个人摘要泄露字段：${key}`);
  }
});

test('空榜：无记录时 entries 为空数组且个人排名为空', async () => {
  const daily = await api('/api/leaderboard?mode=daily');
  assert.equal(daily.status, 200);
  assert.deepEqual(daily.data.entries, []);
  assert.equal(daily.data.total, 0);
  assert.equal(daily.data.totalPages, 1);
  assert.equal(daily.data.me.rank, null);
  assert.equal(daily.data.me.best, null);
});

test('未登录访问排行榜保持 401', async () => {
  const response = await fetch(`${BASE}/api/leaderboard?mode=normal`);
  assert.equal(response.status, 401);
  const data = await response.json();
  assert.ok(data.error);
});

test('前端接入：容器、脚本与空榜占位齐备', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /id="leaderboard-panel"/);
  assert.match(html, /\/js\/leaderboard-ui\.js/);

  const source = fs.readFileSync(path.join(ROOT, 'public/js/leaderboard-ui.js'), 'utf8');
  assert.match(source, /还没有记录，去拿下第一名。/);
  assert.match(source, /isMe/);
  assert.match(source, /我的排名/);
});
