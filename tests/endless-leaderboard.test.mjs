// 无尽榜赛季化测试：赛季归属、波次优先排序、旧数据兼容与普通/无尽榜隔离。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20500 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-endless-lb-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB;
process.env.DB_BACKUP = '0';
const { db } = await import('../server/db/index.mjs');
const {
  BOARD_SORT,
  boardKeyFor,
  boardSort,
  countBoard,
  isSeasonKey,
  listBoard,
  personalBest,
  rankFor,
  recordLeaderboardEntry,
  seasonBounds,
  seasonOf,
} = await import('../server/db/leaderboard.mjs');

const DAY = '2026-10-24';

const currentSeason = seasonOf();
const prevSeason = shiftSeason(currentSeason, -1);
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

let server = null;
let serverLog = '';

async function api(pathname, { method = 'GET', token, body } = {}) {
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

// 真实走一遍开局 → 选图 → 放行/结算波次 → 结算，产生一条无尽榜成绩。
async function playEndless(token, waves) {
  const start = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'endless', difficulty: 'standard' },
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
  return { runId, ...finished.data };
}

function seedAccount(id) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'registered', ?, ?)`
  ).run(id, now, now);
}

function seedRun(runId, accountId, mode, boardKey, createdAt) {
  db.prepare(
    `INSERT INTO runs (id, account_id, mode, board_key, difficulty, seed, day, created_at)
     VALUES (?, ?, ?, ?, 'standard', ?, ?, ?)`
  ).run(runId, accountId, mode, boardKey, runId, DAY, createdAt);
}

// 直接写入可控成绩：用于构造“波次高但分数低”这类排序分歧。
function seedEntry({
  accountId,
  runId,
  mode = 'endless',
  wave,
  score,
  durationMs = 60_000,
  difficulty = 'standard',
  createdAt = seasonMidpoint(currentSeason),
}) {
  seedAccount(accountId);
  seedRun(runId, accountId, mode, boardKeyFor(mode, DAY, { season: seasonOf(createdAt) }), createdAt);
  recordLeaderboardEntry({
    accountId,
    displayName: accountId,
    runId,
    mode,
    day: DAY,
    difficulty,
    score,
    durationMs,
    wave,
    kills: wave * 10,
    victory: false,
    contentVersion: 'test',
    createdAt,
  });
}

// 旧版无尽榜：board_key 没有赛季后缀，只能靠 created_at 归入赛季。
function seedLegacyEndless({ accountId, runId, wave, score, createdAt }) {
  seedAccount(accountId);
  seedRun(runId, accountId, 'endless', 'endless', createdAt);
  db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES ('endless', ?, ?, ?, 'standard', ?, ?, 'legacy', ?, ?)`
  ).run(
    accountId,
    accountId,
    runId,
    score,
    90_000,
    JSON.stringify({ wave, kills: wave * 10, victory: 0 }),
    createdAt
  );
}

function names(entries) {
  return entries.map((entry) => entry.name);
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
});

after(async () => {
  try {
    db.close();
  } catch {
    /* ignore */
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

test('榜单 key：无尽榜按赛季后缀，其余榜不受影响', () => {
  assert.equal(boardKeyFor('endless', DAY, { season: '2026-10' }), 'endless:2026-10');
  assert.equal(boardKeyFor('endless', DAY), `endless:${currentSeason}`);
  assert.equal(boardKeyFor('normal', DAY, { season: '2026-10' }), 'normal');
  assert.equal(boardKeyFor('daily', DAY, { season: '2026-10' }), `daily:${DAY}:v2`);
  assert.equal(boardKeyFor('weekly', '2026-W43', { season: '2026-10' }), 'weekly:2026-W43');
});

test('排序规则集中定义：无尽榜波次优先，其余榜分数优先', () => {
  assert.deepEqual(boardSort('endless'), ['wave', 'score', 'duration']);
  assert.deepEqual(boardSort('normal'), ['score', 'duration']);
  assert.equal(BOARD_SORT.endless[0], 'wave');
  assert.equal(BOARD_SORT.normal[0], 'score');
  assert.ok(isSeasonKey(currentSeason));
});

test('无尽榜排序：波次优先、同波次比分数、再比用时', () => {
  seedEntry({
    accountId: 'endless-low-wave-high-score',
    runId: 'endless-sort-a',
    wave: 30,
    score: 900_000,
    durationMs: 50_000,
    difficulty: 'abyss',
  });
  seedEntry({
    accountId: 'endless-high-wave-low-score',
    runId: 'endless-sort-b',
    wave: 95,
    score: 1_200,
    durationMs: 400_000,
    difficulty: 'abyss',
  });
  seedEntry({
    accountId: 'endless-tie-slow',
    runId: 'endless-sort-c',
    wave: 50,
    score: 5_000,
    durationMs: 60_000,
    difficulty: 'abyss',
  });
  seedEntry({
    accountId: 'endless-tie-fast',
    runId: 'endless-sort-d',
    wave: 50,
    score: 7_000,
    durationMs: 30_000,
    difficulty: 'abyss',
  });
  seedEntry({
    accountId: 'endless-tie-mid',
    runId: 'endless-sort-e',
    wave: 50,
    score: 7_000,
    durationMs: 90_000,
    difficulty: 'abyss',
  });

  const entries = listBoard('endless', DAY, {
    includeUnclaimed: true,
    difficulty: 'abyss',
    season: currentSeason,
    limit: 50,
  });

  assert.deepEqual(names(entries), [
    'endless-high-wave-low-score',
    'endless-tie-fast',
    'endless-tie-mid',
    'endless-tie-slow',
    'endless-low-wave-high-score',
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.rank),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    entries.map((entry) => entry.wave),
    [95, 50, 50, 50, 30]
  );
  assert.equal(countBoard('endless', DAY, { includeUnclaimed: true, difficulty: 'abyss', season: currentSeason }), 5);
});

test('赛季归属：真实无尽结算写入当前赛季榜，其他赛季不可见', async () => {
  const token = 'endless-season-runner';
  const result = await playEndless(token, 3);
  assert.equal(typeof result.rank, 'number');

  const row = db
    .prepare('SELECT board_key FROM leaderboard_entries WHERE run_id = ?')
    .get(result.runId);
  assert.ok(row, '无尽成绩应入榜');
  assert.equal(row.board_key, `endless:${currentSeason}`);

  const current = await api(`/api/leaderboard?mode=endless&season=${currentSeason}&size=50`, {
    token,
  });
  assert.equal(current.status, 200);
  assert.equal(current.data.season, currentSeason);
  assert.ok(
    current.data.entries.some((entry) => entry.isMe && entry.wave === 3),
    '当前赛季榜应包含本局'
  );
  assert.equal(current.data.me.best.wave, 3);

  const previous = await api(`/api/leaderboard?mode=endless&season=${prevSeason}&size=50`, {
    token,
  });
  assert.equal(previous.status, 200);
  assert.ok(!previous.data.entries.some((entry) => entry.isMe), '其他赛季榜不应含本局');
  assert.equal(previous.data.me.rank, null);
});

test('旧数据兼容：无赛季后缀的 endless 记录按 created_at 归入赛季', () => {
  seedLegacyEndless({
    accountId: 'endless-legacy-current',
    runId: 'endless-legacy-a',
    wave: 12,
    score: 800,
    createdAt: seasonMidpoint(currentSeason),
  });
  seedLegacyEndless({
    accountId: 'endless-legacy-prev',
    runId: 'endless-legacy-b',
    wave: 88,
    score: 100,
    createdAt: seasonMidpoint(prevSeason),
  });

  const current = listBoard('endless', DAY, {
    includeUnclaimed: true,
    season: currentSeason,
    limit: 50,
  });
  assert.ok(names(current).includes('endless-legacy-current'));
  assert.ok(!names(current).includes('endless-legacy-prev'), '旧赛季数据不得混入当前赛季');

  const previous = listBoard('endless', DAY, {
    includeUnclaimed: true,
    season: prevSeason,
    limit: 50,
  });
  assert.ok(names(previous).includes('endless-legacy-prev'));
  assert.ok(!names(previous).includes('endless-legacy-current'));
});

test('普通榜与无尽榜互不污染', () => {
  seedEntry({
    accountId: 'normal-only-player',
    runId: 'endless-isolation-normal',
    mode: 'normal',
    wave: 9,
    score: 4_321,
    difficulty: 'standard',
  });

  const normal = listBoard('normal', DAY, {
    includeUnclaimed: true,
    season: currentSeason,
    limit: 50,
  });
  assert.ok(names(normal).includes('normal-only-player'));
  for (const name of [
    'endless-low-wave-high-score',
    'endless-high-wave-low-score',
    'endless-tie-fast',
    'endless-legacy-current',
  ]) {
    assert.ok(!names(normal).includes(name), `普通榜混入无尽成绩：${name}`);
  }

  const endless = listBoard('endless', DAY, {
    includeUnclaimed: true,
    season: currentSeason,
    limit: 50,
  });
  assert.ok(endless.length > 0);
  assert.ok(!names(endless).includes('normal-only-player'), '无尽榜混入普通成绩');
});

test('赛季内名次与个人最佳按无尽排序规则计算', () => {
  seedEntry({
    accountId: 'endless-rank-low',
    runId: 'endless-rank-a',
    wave: 20,
    score: 50_000,
    durationMs: 120_000,
    createdAt: seasonMidpoint(emptySeason),
  });
  seedEntry({
    accountId: 'endless-rank-high',
    runId: 'endless-rank-b',
    wave: 70,
    score: 1_000,
    durationMs: 300_000,
    createdAt: seasonMidpoint(emptySeason),
  });

  assert.equal(
    rankFor('endless', DAY, 1_000, {
      includeUnclaimed: true,
      season: emptySeason,
      wave: 70,
      durationMs: 300_000,
    }),
    1
  );
  assert.equal(
    rankFor('endless', DAY, 50_000, {
      includeUnclaimed: true,
      season: emptySeason,
      wave: 20,
      durationMs: 120_000,
    }),
    2
  );

  assert.equal(personalBest('endless-rank-low', 'endless', DAY, { season: emptySeason }), 50_000);
  assert.equal(personalBest('endless-rank-low', 'endless', DAY, { season: currentSeason }), 0);
});

test('赛季化排序不改无尽计分', () => {
  // 只校验榜单层：分数原样入库，排序不重写分数。
  const row = db
    .prepare('SELECT score FROM leaderboard_entries WHERE run_id = ?')
    .get('endless-sort-a');
  assert.equal(row.score, 900_000);
});
