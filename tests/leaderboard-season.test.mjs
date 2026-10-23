// 排行榜赛季测试：自然月分榜、当前赛季默认、非法参数回退与跨月/跨年边界。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-lb-season-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB;
process.env.DB_BACKUP = '0';
const { isSeasonKey, seasonBounds, seasonOf } = await import(
  '../server/db/leaderboard.mjs'
);

const TOKENS = {
  alpha: 'season-alpha-0001',
  beta: 'season-beta-0001',
  gamma: 'season-gamma-0001',
  delta: 'season-delta-0001',
};

const currentSeason = seasonOf();
const prevSeason = shiftSeason(currentSeason, -1);
const crossYearSeason = shiftSeason(currentSeason, -13);
const emptySeason = shiftSeason(currentSeason, -6);

function shiftSeason(season, delta) {
  const [year, month] = season.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function seasonMidpoint(season) {
  return seasonBounds(season).start + 12 * 60 * 60 * 1000;
}

function lastDayOf(season) {
  const [year, month] = season.split('-').map(Number);
  const day = new Date(year, month, 0).getDate();
  return `${season}-${String(day).padStart(2, '0')}`;
}

let server = null;
let db = null;
let serverLog = '';
const scores = new Map();

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

async function play(token, { mode = 'normal', difficulty = 'standard', waves = 1 } = {}) {
  const start = await api('/api/runs', { method: 'POST', token, body: { mode, difficulty } });
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
  return { runId, ...finished.data };
}

// 把真实成绩改写到指定赛季，验证旧数据按 created_at 归入所在赛季。
function moveRunToSeason(runId, season) {
  const result = db
    .prepare('UPDATE leaderboard_entries SET created_at = ? WHERE run_id = ?')
    .run(seasonMidpoint(season), runId);
  assert.equal(result.changes, 1, `未找到对局 ${runId} 的排行榜记录`);
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

  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode != null) break;
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) break;
    } catch {
      /* 等待服务启动 */
    }
    await sleep(100);
  }
  if (server.exitCode != null) throw new Error(`测试服务启动失败：${serverLog}`);

  db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 5000;');

  const alpha = await play(TOKENS.alpha, { waves: 3 });
  scores.set('alpha', alpha.score);

  const betaHigh = await play(TOKENS.beta, { waves: 6 });
  const betaLow = await play(TOKENS.beta, { waves: 2 });
  scores.set('betaHigh', betaHigh.score);
  scores.set('betaLow', betaLow.score);
  moveRunToSeason(betaHigh.runId, prevSeason);
  moveRunToSeason(betaLow.runId, prevSeason);

  const gamma = await play(TOKENS.gamma, { waves: 4 });
  scores.set('gamma', gamma.score);
  moveRunToSeason(gamma.runId, crossYearSeason);

  const delta = await play(TOKENS.delta, { waves: 5 });
  scores.set('delta', delta.score);
});

after(async () => {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
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

test('赛季键：本地时区自然月，月末与跨年边界正确', () => {
  assert.equal(seasonOf(new Date(2026, 9, 23, 12, 0, 0)), '2026-10');
  assert.equal(seasonOf(new Date(2025, 11, 31, 23, 59, 59, 999)), '2025-12');
  assert.equal(seasonOf(new Date(2026, 0, 1, 0, 0, 0, 0)), '2026-01');
  assert.equal(seasonOf(new Date(2026, 0, 31, 23, 59, 59, 999)), '2026-01');
  assert.equal(seasonOf(new Date(2026, 1, 1, 0, 0, 0, 0)), '2026-02');
  assert.equal(seasonOf(Number.NaN), null);

  // 跨年：12 月的区间在次年 1 月 1 日零点结束。
  const december = seasonBounds('2025-12');
  assert.equal(december.start, new Date(2025, 11, 1).getTime());
  assert.equal(december.end, new Date(2026, 0, 1).getTime());
  assert.equal(seasonOf(december.start), '2025-12');
  assert.equal(seasonOf(december.end - 1), '2025-12');
  assert.equal(seasonOf(december.end), '2026-01');

  const february = seasonBounds('2026-02');
  assert.equal(february.end - february.start, 28 * 24 * 60 * 60 * 1000);

  assert.equal(seasonBounds('2026-13'), null);
  assert.equal(seasonBounds('2026-1'), null);
  assert.equal(isSeasonKey('2026-10'), true);
  assert.equal(isSeasonKey('2026-00'), false);
  assert.equal(isSeasonKey('2026-10-01'), false);
  assert.equal(isSeasonKey(null), false);
});

test('默认赛季：不传 season 查询当前自然月，并返回赛季起止与列表', async () => {
  const board = await api('/api/leaderboard?mode=normal&size=50');
  assert.equal(board.status, 200);
  assert.equal(board.data.season, currentSeason);
  assert.equal(board.data.seasonStart, `${currentSeason}-01`);
  assert.equal(board.data.seasonEnd, lastDayOf(currentSeason));
  assert.equal(board.data.total, 2);
  assert.deepEqual(
    board.data.entries.map((entry) => entry.score).sort((a, b) => b - a),
    [scores.get('alpha'), scores.get('delta')].sort((a, b) => b - a)
  );
  assert.deepEqual(board.data.seasons, [
    currentSeason,
    prevSeason,
    crossYearSeason,
  ].sort().reverse());
});

test('赛季过滤：跨月成绩只落在各自赛季，榜单与总数一致', async () => {
  const previous = await api(`/api/leaderboard?mode=normal&size=50&season=${prevSeason}`);
  assert.equal(previous.status, 200);
  assert.equal(previous.data.season, prevSeason);
  // 同一账号只取最佳成绩参与排名，所以两局 beta 只占一个名次。
  assert.equal(previous.data.total, 1);
  assert.equal(previous.data.entries.length, 1);
  assert.equal(previous.data.entries[0].score, scores.get('betaHigh'));
  assert.equal(previous.data.entries[0].rank, 1);

  const crossYear = await api(`/api/leaderboard?mode=normal&season=${crossYearSeason}`);
  assert.equal(crossYear.data.season, crossYearSeason);
  assert.equal(crossYear.data.total, 1);
  assert.equal(crossYear.data.entries[0].score, scores.get('gamma'));

  // 旧字段：createdAt 仍指向被迁移到对应赛季的时间。
  const moved = crossYear.data.entries[0];
  assert.equal(seasonOf(moved.createdAt), crossYearSeason);
});

test('非法赛季参数回退当前赛季，空赛季返回空榜', async () => {
  for (const bogus of ['2026-13', '2026-1', 'abc', '']) {
    const result = await api(`/api/leaderboard?mode=normal&season=${bogus}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.season, currentSeason, `非法赛季 ${bogus} 应回退当前赛季`);
    assert.equal(result.data.total, 2);
  }

  const empty = await api(`/api/leaderboard?mode=normal&season=${emptySeason}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.data.season, emptySeason);
  assert.deepEqual(empty.data.entries, []);
  assert.equal(empty.data.total, 0);
  assert.equal(empty.data.totalPages, 1);
  assert.ok(empty.data.seasons.includes(emptySeason));
});

test('个人排名按赛季隔离：所选赛季的最佳/最近与名次', async () => {
  const previous = await api(`/api/leaderboard?mode=normal&size=50&season=${prevSeason}`, {
    token: TOKENS.beta,
  });
  assert.equal(previous.data.me.rank, 1);
  assert.equal(previous.data.me.best.score, scores.get('betaHigh'));
  assert.equal(previous.data.me.latest.score, scores.get('betaLow'));
  assert.equal(previous.data.entries.filter((entry) => entry.isMe).length, 1);

  const current = await api('/api/leaderboard?mode=normal&season=' + currentSeason, {
    token: TOKENS.beta,
  });
  assert.equal(current.data.me.rank, null);
  assert.equal(current.data.me.best, null);
  assert.equal(current.data.me.latest, null);

  const mine = await api(`/api/leaderboard?mode=normal&season=${prevSeason}`, {
    token: TOKENS.delta,
  });
  assert.equal(mine.data.me.rank, null);
});

test('旧版响应字段完整，赛季字段为增量', async () => {
  const board = await api('/api/leaderboard?mode=normal&season=' + currentSeason);
  for (const field of [
    'mode',
    'day',
    'page',
    'size',
    'difficulty',
    'total',
    'totalPages',
    'entries',
    'me',
  ]) {
    assert.ok(field in board.data, `旧字段缺失：${field}`);
  }
  for (const field of ['season', 'seasons', 'seasonStart', 'seasonEnd']) {
    assert.ok(field in board.data, `赛季字段缺失：${field}`);
  }

  const entryFields = [
    'name',
    'difficulty',
    'wave',
    'score',
    'kills',
    'victory',
    'durationMs',
    'contentVersion',
    'createdAt',
    'rank',
    'isMe',
  ];
  for (const field of entryFields) {
    assert.ok(field in board.data.entries[0], `条目字段缺失：${field}`);
  }
  assert.deepEqual(Object.keys(board.data.me).sort(), ['best', 'latest', 'rank']);
});
