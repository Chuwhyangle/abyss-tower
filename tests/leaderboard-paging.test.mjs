// 排行榜游标分页测试：逐页遍历、空页、缓存命中与写榜失效、上限钳制、
// 伪造/跨榜游标拒绝、旧版无游标请求兼容，以及缓存按赛季/模式隔离。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 21000 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-lb-paging-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB;
process.env.DB_BACKUP = '0';
const { db } = await import('../server/db/index.mjs');
const {
  LEADERBOARD_CACHE_TTL_MS,
  MAX_CURSOR_PAGE_SIZE,
  boardKeyFor,
  decodeCursor,
  encodeCursor,
  listEntries,
  recordLeaderboardEntry,
  seasonOf,
} = await import('../server/db/leaderboard.mjs');
const { dayKey } = await import('../public/js/shared/scoring.js');

const DAY = dayKey();
const SEASON = seasonOf();
const TRAVERSE_DAY = '2026-10-01';
const CACHE_DAY = '2026-10-02';

const TOKEN = 'lb-paging-0001';

let server = null;
let serverLog = '';

function shiftSeason(season, delta) {
  const [year, month] = season.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function api(pathname) {
  const response = await fetch(`${BASE}${pathname}`, {
    headers: { 'x-player-token': TOKEN },
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function seedAccount(id) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'registered', ?, ?)`
  ).run(id, now, now);
}

function seedEntry({
  accountId,
  runId,
  mode = 'daily',
  day = TRAVERSE_DAY,
  score,
  wave = 1,
  durationMs = 60_000,
  createdAt = Date.now(),
}) {
  seedAccount(accountId);
  db.prepare(
    `INSERT INTO runs (id, account_id, mode, board_key, difficulty, seed, day, created_at)
     VALUES (?, ?, ?, ?, 'standard', ?, ?, ?)`
  ).run(runId, accountId, mode, boardKeyFor(mode, day, { season: seasonOf(createdAt) }), runId, day, createdAt);
  recordLeaderboardEntry({
    accountId,
    displayName: accountId,
    runId,
    mode,
    day,
    difficulty: 'standard',
    score,
    durationMs,
    wave,
    kills: wave * 10,
    victory: false,
    contentVersion: 'test',
    createdAt,
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

test('游标逐页遍历：无重复、无遗漏、名次连续', async () => {
  const scores = [700, 600, 500, 400, 300, 200, 100];
  scores.forEach((score, index) => {
    seedEntry({
      accountId: `traverse-${index}`,
      runId: `traverse-run-${index}`,
      score,
    });
  });

  const collected = [];
  let cursor = null;
  let pages = 0;
  do {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const { status, data } = await api(
      `/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=3${suffix}`
    );
    assert.equal(status, 200);
    assert.equal(data.size, 3);
    assert.equal(data.total, 7);
    assert.equal(data.totalPages, 3);
    pages += 1;
    collected.push(...data.entries);
    cursor = data.nextCursor;
    assert.ok(pages <= 5, '游标没有收敛，疑似翻页死循环');
  } while (cursor);

  assert.equal(pages, 3);
  assert.deepEqual(
    collected.map((entry) => entry.name),
    scores.map((_, index) => `traverse-${index}`)
  );
  assert.deepEqual(
    collected.map((entry) => entry.rank),
    [1, 2, 3, 4, 5, 6, 7]
  );
  assert.equal(new Set(collected.map((entry) => entry.name)).size, 7);
});

test('空页：游标指向末尾之后返回空列表', async () => {
  const cursor = encodeCursor({
    offset: 99,
    mode: 'daily',
    day: TRAVERSE_DAY,
    season: SEASON,
    includeUnclaimed: true,
    score: 0,
    durationMs: 999_999,
    createdAt: 0,
    id: 0,
  });
  const { status, data } = await api(
    `/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=10&cursor=${encodeURIComponent(cursor)}`
  );
  assert.equal(status, 200);
  assert.deepEqual(data.entries, []);
  assert.equal(data.nextCursor, null);
});

test('缓存：5 秒内命中旧结果，写榜后立即失效', async () => {
  assert.equal(LEADERBOARD_CACHE_TTL_MS, 5_000);
  seedEntry({ accountId: 'cache-a', runId: 'cache-run-a', score: 30, day: CACHE_DAY });
  seedEntry({ accountId: 'cache-b', runId: 'cache-run-b', score: 20, day: CACHE_DAY });

  const opts = {
    mode: 'daily',
    day: CACHE_DAY,
    season: SEASON,
    includeUnclaimed: true,
    limit: 10,
  };

  // 先分别填充「测试进程」与「服务端进程」两处缓存。
  const before = listEntries(opts);
  assert.deepEqual(
    before.entries.map((entry) => entry.name),
    ['cache-a', 'cache-b']
  );
  const url = `/api/leaderboard?mode=daily&day=${CACHE_DAY}&limit=10`;
  const first = await api(url);
  assert.equal(first.status, 200);
  assert.equal(first.data.total, 2);

  // 直接删库绕过写榜失效：两处缓存在 5 秒内都仍返回旧结果。
  db.prepare("DELETE FROM leaderboard_entries WHERE account_id = 'cache-b'").run();
  const hit = listEntries(opts);
  assert.deepEqual(
    hit.entries.map((entry) => entry.name),
    ['cache-a', 'cache-b'],
    '模块内缓存仍命中'
  );
  const cached = await api(url);
  assert.deepEqual(
    cached.data.entries.map((entry) => entry.name),
    ['cache-a', 'cache-b'],
    '服务端缓存仍命中'
  );

  // 正常写榜会清空同进程缓存，新成绩立即出现在首页。
  seedEntry({ accountId: 'cache-top', runId: 'cache-run-top', score: 999, day: CACHE_DAY });
  const refreshed = listEntries(opts);
  assert.deepEqual(
    refreshed.entries.map((entry) => entry.name),
    ['cache-top', 'cache-a']
  );
  assert.deepEqual(
    refreshed.entries.map((entry) => entry.rank),
    [1, 2]
  );
});

test('limit 上限钳制为 100，非法值回落到默认 20', async () => {
  const clamped = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=999`);
  assert.equal(clamped.status, 200);
  assert.equal(clamped.data.size, MAX_CURSOR_PAGE_SIZE);
  assert.equal(MAX_CURSOR_PAGE_SIZE, 100);

  const fallback = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=abc`);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.data.size, 20);

  const zero = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=0`);
  assert.equal(zero.status, 200);
  assert.equal(zero.data.size, 1);
});

test('伪造与跨榜游标被拒绝', async () => {
  const valid = encodeCursor({
    offset: 3,
    mode: 'daily',
    day: TRAVERSE_DAY,
    season: SEASON,
    includeUnclaimed: true,
    score: 400,
    durationMs: 60_000,
    createdAt: Date.now(),
    id: 4,
  });

  const crossBoard = await api(
    `/api/leaderboard?mode=endless&limit=5&cursor=${encodeURIComponent(valid)}`
  );
  assert.equal(crossBoard.status, 400);
  assert.equal(crossBoard.data.code, 'INVALID_CURSOR');

  const garbage = await api(
    `/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=5&cursor=not-a-cursor`
  );
  assert.equal(garbage.status, 400);
  assert.equal(garbage.data.code, 'INVALID_CURSOR');

  const wrongVersion = Buffer.from(JSON.stringify({ v: 2, o: 0 }), 'utf8').toString('base64url');
  const tampered = await api(
    `/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=5&cursor=${wrongVersion}`
  );
  assert.equal(tampered.status, 400);
  assert.equal(tampered.data.code, 'INVALID_CURSOR');

  assert.equal(decodeCursor(garbage), null);
  assert.equal(decodeCursor(wrongVersion), null);
  assert.equal(decodeCursor('x'.repeat(600)), null);
});

test('旧版无游标请求保持兼容', async () => {
  const page1 = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&page=1&size=2`);
  assert.equal(page1.status, 200);
  assert.equal(page1.data.page, 1);
  assert.equal(page1.data.size, 2);
  assert.equal(page1.data.total, 7);
  assert.equal(page1.data.totalPages, 4);
  assert.equal(page1.data.nextCursor, null);
  assert.deepEqual(page1.data.entries.map((entry) => entry.rank), [1, 2]);
  assert.deepEqual(page1.data.entries.map((entry) => entry.name), [
    'traverse-0',
    'traverse-1',
  ]);

  const page2 = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&page=2&size=2`);
  assert.equal(page2.status, 200);
  assert.deepEqual(page2.data.entries.map((entry) => entry.rank), [3, 4]);
  assert.deepEqual(page2.data.entries.map((entry) => entry.name), [
    'traverse-2',
    'traverse-3',
  ]);

  const beyond = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&page=9&size=2`);
  assert.equal(beyond.status, 200);
  assert.deepEqual(beyond.data.entries, []);
});

test('缓存按赛季与模式隔离', async () => {
  // 先让当前赛季/普通日榜进入缓存。
  const cached = await api(`/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&limit=3`);
  assert.equal(cached.status, 200);
  assert.equal(cached.data.total, 7);

  const prevSeason = shiftSeason(SEASON, -1);
  const otherSeason = await api(
    `/api/leaderboard?mode=daily&day=${TRAVERSE_DAY}&season=${prevSeason}&limit=3`
  );
  assert.equal(otherSeason.status, 200);
  assert.deepEqual(otherSeason.data.entries, []);
  assert.equal(otherSeason.data.total, 0);

  const otherMode = await api(`/api/leaderboard?mode=endless&limit=3`);
  assert.equal(otherMode.status, 200);
  assert.deepEqual(otherMode.data.entries, []);
  assert.equal(otherMode.data.total, 0);
});
