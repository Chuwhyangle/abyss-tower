// 通知分页与 90 天归档：游标边界、同毫秒稳定排序、按周聚合、归档幂等、
// 未读数不为负，以及分页不会越权读到他人通知。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { allocatePort, waitForHealth } from './test-server.mjs';
import { weekKey } from '../public/js/shared/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-notif-paging-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-notif-paging-server-${process.pid}-${Date.now()}.db`);
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = 'notif-paging-alice-01';
const BOB = 'notif-paging-bob-01';
const DAY_MS = 24 * 60 * 60 * 1000;

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const NOTIFICATIONS_UI = read('public/js/ui/notifications.js');

let db = null;
let createProfile = null;
let list = null;
let archiveOld = null;
let readArchive = null;

let server = null;
let serverDb = null;
let serverLog = '';

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function seedAccount(accountId) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  createProfile(accountId);
}

function insertNotification(
  accountId,
  { kind = 'achievement', dedupeKey, createdAt, readAt = null, payload = {} }
) {
  db.prepare(
    `INSERT INTO account_notifications
       (account_id, kind, dedupe_key, payload, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(accountId, kind, dedupeKey, JSON.stringify(payload), createdAt, readAt);
}

function detailCount(accountId) {
  return Number(
    db
      .prepare('SELECT COUNT(*) AS c FROM account_notifications WHERE account_id = ?')
      .get(accountId).c
  );
}

function collectPages(accountId, limit) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = list(accountId, { cursor, limit });
    assert.ok(page, '合法游标不应返回 null');
    items.push(...page.items);
    if (!page.nextCursor) return { items, pages: guard + 1 };
    assert.equal(seenCursors.has(page.nextCursor), false, '游标不应循环');
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('分页未在合理页数内结束');
}

async function api(pathname, { token = ALICE } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    headers: token ? { 'x-player-token': token } : {},
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({ list, archiveOld, readArchive } = await import('../server/db/notifications.mjs'));

  seedAccount(ALICE);
  seedAccount(BOB);

  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: SERVER_DB,
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

  // 先让服务端按旧令牌建好账号，再直接向服务端库写入可预期顺序的通知。
  await api('/api/notifications', { token: ALICE });
  await api('/api/notifications', { token: BOB });
  serverDb = new DatabaseSync(SERVER_DB);
  serverDb.exec('PRAGMA busy_timeout = 5000');
  const accountId = (token) =>
    serverDb
      .prepare(
        "SELECT account_id FROM account_aliases WHERE provider = 'legacy_token' AND alias_hash = ?"
      )
      .get(crypto.createHash('sha256').update(token).digest('hex'))?.account_id;
  const insert = serverDb.prepare(
    `INSERT INTO account_notifications
       (account_id, kind, dedupe_key, payload, created_at, read_at)
     VALUES (?, 'season', ?, ?, ?, NULL)`
  );
  const base = Date.now() - 60_000;
  for (let i = 0; i < 5; i++) {
    insert.run(
      accountId(ALICE),
      `season:paging-${i}`,
      JSON.stringify({ n: i, owner: 'alice' }),
      base + i
    );
  }
  for (let i = 0; i < 2; i++) {
    insert.run(
      accountId(BOB),
      `season:paging-bob-${i}`,
      JSON.stringify({ n: i, owner: 'bob' }),
      base + i
    );
  }
});

after(() => {
  if (server) server.kill('SIGTERM');
  if (serverDb) {
    try {
      serverDb.close();
    } catch {
      /* ignore */
    }
  }
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  removeDb(UNIT_DB);
  removeDb(SERVER_DB);
});

test('游标分页覆盖全部记录，边界不重复也不遗漏', () => {
  const account = 'paging-boundary-01';
  seedAccount(account);
  const base = Date.now() - 60_000;
  for (let i = 0; i < 7; i++) {
    insertNotification(account, {
      dedupeKey: `achievement:page-${i}`,
      createdAt: base + i,
      payload: { n: i },
    });
  }

  const first = list(account, { limit: 3 });
  assert.equal(first.items.length, 3);
  assert.deepEqual(
    first.items.map((item) => item.payload.n),
    [6, 5, 4],
    '最新记录排在最前'
  );
  assert.ok(first.nextCursor, '还有下一页时应返回 nextCursor');

  const second = list(account, { cursor: first.nextCursor, limit: 3 });
  assert.deepEqual(second.items.map((item) => item.payload.n), [3, 2, 1]);
  assert.ok(second.nextCursor);

  const third = list(account, { cursor: second.nextCursor, limit: 3 });
  assert.deepEqual(third.items.map((item) => item.payload.n), [0]);
  assert.equal(third.nextCursor, null, '最后一页的 nextCursor 必须为空');

  const all = collectPages(account, 2);
  assert.equal(all.items.length, 7);
  assert.equal(new Set(all.items.map((item) => item.id)).size, 7, '分页不应重复返回同一条');
  assert.deepEqual(
    all.items.map((item) => item.payload.n),
    [6, 5, 4, 3, 2, 1, 0]
  );
});

test('同毫秒写入按 id 稳定排序，分页不跳过记录', () => {
  const account = 'paging-tie-01';
  seedAccount(account);
  const createdAt = Date.now() - 30_000;
  for (let i = 0; i < 4; i++) {
    insertNotification(account, {
      dedupeKey: `achievement:tie-${i}`,
      createdAt,
      payload: { n: i },
    });
  }

  const all = collectPages(account, 2);
  assert.equal(all.items.length, 4);
  assert.deepEqual(
    all.items.map((item) => item.payload.n),
    [3, 2, 1, 0],
    '同一时间戳按 id 倒序保持稳定'
  );
  assert.equal(new Set(all.items.map((item) => item.id)).size, 4);
});

test('limit 越界被夹紧，非法游标返回 null', () => {
  const account = 'paging-limit-01';
  seedAccount(account);
  const base = Date.now() - 20_000;
  for (let i = 0; i < 7; i++) {
    insertNotification(account, {
      dedupeKey: `achievement:limit-${i}`,
      createdAt: base + i,
      payload: { n: i },
    });
  }

  assert.equal(list(account, { limit: 999 }).items.length, 7, 'limit 上限不改变结果集完整性');
  assert.equal(list(account, { limit: 0 }).items.length, 7, '非法 limit 回退默认值');
  assert.equal(list(account, { limit: 'abc' }).items.length, 7);
  assert.equal(list(account, { cursor: 'not-a-cursor' }), null, '非法游标应由调用方转成 400');
});

test('90 天前的明细按周聚合后删除，未读数保持正确', () => {
  const account = 'paging-archive-01';
  seedAccount(account);
  const now = Date.now();
  const oldRows = [
    { ago: 100, read: false, kind: 'achievement' },
    { ago: 95, read: true, kind: 'bounty' },
    { ago: 91, read: false, kind: 'season' },
  ];
  for (let i = 0; i < oldRows.length; i++) {
    const row = oldRows[i];
    const createdAt = now - row.ago * DAY_MS;
    insertNotification(account, {
      kind: row.kind,
      dedupeKey: `${row.kind}:old-${i}`,
      createdAt,
      readAt: row.read ? now - (row.ago - 1) * DAY_MS : null,
      payload: { n: i },
    });
  }
  insertNotification(account, {
    kind: 'achievement',
    dedupeKey: 'achievement:recent-1',
    createdAt: now - 10 * DAY_MS,
    payload: { n: 3 },
  });
  insertNotification(account, {
    kind: 'bounty',
    dedupeKey: 'bounty:recent-2',
    createdAt: now - 1 * DAY_MS,
    payload: { n: 4 },
  });

  assert.equal(detailCount(account), 5);
  assert.equal(list(account).unread, 4, '归档前 4 条未读');

  // 期望的周聚合：只统计 90 天前的 3 条，其中 2 条未读。
  const expected = new Map();
  for (const row of oldRows) {
    const week = weekKey(new Date(now - row.ago * DAY_MS));
    const bucket = expected.get(week) || { total: 0, unread: 0 };
    bucket.total += 1;
    if (!row.read) bucket.unread += 1;
    expected.set(week, bucket);
  }

  const result = archiveOld(account, 90, now);
  assert.equal(result.archived, 3);
  assert.equal(result.unreadArchived, 2);
  assert.equal(result.archive.totalArchived, 3);
  assert.equal(result.archive.weeks.length, expected.size);
  for (const entry of result.archive.weeks) {
    const want = expected.get(entry.week);
    assert.ok(want, `归档出现未预期的周：${entry.week}`);
    assert.equal(entry.total, want.total);
    assert.equal(entry.unread, want.unread);
  }

  const after = list(account);
  assert.equal(after.items.length, 2, '只保留 90 天内的明细');
  assert.ok(after.items.every((item) => item.createdAt >= now - 90 * DAY_MS));
  assert.ok(Number.isInteger(after.unread) && after.unread >= 0, '未读数不得为负');
  assert.equal(after.unread, 2, '归档删除的未读不再计入当前未读');
  assert.equal(detailCount(account), 2);

  // 幂等：重复归档不再计数、不改变摘要与明细。
  const again = archiveOld(account, 90, now);
  assert.equal(again.archived, 0);
  assert.deepEqual(again.archive, result.archive, '重复归档不应重复累加');
  assert.equal(detailCount(account), 2);
  assert.equal(list(account).unread, 2);
  assert.deepEqual(readArchive(account), result.archive);
});

test('全部旧通知归档后未读归零而不是负数', () => {
  const account = 'paging-archive-all-01';
  seedAccount(account);
  const now = Date.now();
  for (let i = 0; i < 2; i++) {
    insertNotification(account, {
      dedupeKey: `achievement:all-old-${i}`,
      createdAt: now - (120 + i) * DAY_MS,
      payload: { n: i },
    });
  }
  assert.equal(list(account).unread, 2);

  const result = archiveOld(account, 90, now);
  assert.equal(result.archived, 2);
  const after = list(account);
  assert.equal(after.unread, 0);
  assert.ok(after.unread >= 0);
  assert.equal(after.items.length, 0);
  assert.equal(after.archive.totalArchived, 2);
});

test('分页严格按账号隔离，他人游标读不到他人记录', () => {
  const alice = 'paging-priv-alice-01';
  const bob = 'paging-priv-bob-01';
  seedAccount(alice);
  seedAccount(bob);
  const base = Date.now() - 10_000;
  for (let i = 0; i < 3; i++) {
    insertNotification(alice, {
      dedupeKey: `achievement:priv-alice-${i}`,
      createdAt: base + i,
      payload: { owner: 'alice', n: i },
    });
    insertNotification(bob, {
      dedupeKey: `achievement:priv-bob-${i}`,
      createdAt: base + i,
      payload: { owner: 'bob', n: i },
    });
  }

  const bobIds = new Set(
    db
      .prepare('SELECT id FROM account_notifications WHERE account_id = ?')
      .all(bob)
      .map((row) => Number(row.id))
  );
  const aliceFirst = list(alice, { limit: 2 });
  assert.ok(aliceFirst.items.every((item) => item.payload.owner === 'alice'));

  // 用 ALICE 的游标查询 BOB：游标只含时间/id，结果仍被 account_id 收窄到 BOB。
  const crossed = list(bob, { cursor: aliceFirst.nextCursor, limit: 10 });
  assert.ok(crossed);
  assert.ok(crossed.items.every((item) => item.payload.owner === 'bob'));
  assert.ok(crossed.items.every((item) => bobIds.has(item.id)));

  const allBob = collectPages(bob, 2);
  assert.equal(allBob.items.length, 3);
  assert.ok(allBob.items.every((item) => item.payload.owner === 'bob'));
  assert.ok(allBob.items.every((item) => bobIds.has(item.id)));
});

test('接口支持 limit / cursor 并返回 nextCursor，非法游标返回 400', async () => {
  const first = await api('/api/notifications?limit=2');
  assert.equal(first.status, 200);
  assert.equal(first.data.items.length, 2);
  assert.deepEqual(first.data.items.map((item) => item.payload.n), [4, 3]);
  assert.ok(first.data.nextCursor);

  const second = await api(
    `/api/notifications?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`
  );
  assert.equal(second.status, 200);
  assert.deepEqual(second.data.items.map((item) => item.payload.n), [2, 1]);
  assert.ok(second.data.nextCursor);

  const third = await api(
    `/api/notifications?limit=2&cursor=${encodeURIComponent(second.data.nextCursor)}`
  );
  assert.deepEqual(third.data.items.map((item) => item.payload.n), [0]);
  assert.equal(third.data.nextCursor, null);

  const clamped = await api('/api/notifications?limit=999');
  assert.equal(clamped.status, 200);
  assert.equal(clamped.data.items.length, 5, 'limit 被夹紧到 50，不改变结果完整性');
  assert.ok(Array.isArray(clamped.data.archive.weeks));

  const invalid = await api('/api/notifications?cursor=bogus');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_CURSOR');

  const bob = await api('/api/notifications?limit=10', { token: BOB });
  assert.equal(bob.status, 200);
  assert.equal(bob.data.items.length, 2);
  assert.ok(bob.data.items.every((item) => item.payload.owner === 'bob'));
});

test('客户端已接入加载更多与归档摘要', async () => {
  const { archiveWeekLabel, archiveSummaryLines } = await import('../public/js/ui/notifications.js');
  assert.equal(archiveWeekLabel('2026-W05'), '2026 年第 5 周');
  assert.equal(archiveWeekLabel('bad'), 'bad');
  assert.deepEqual(archiveSummaryLines(null), []);
  assert.deepEqual(
    archiveSummaryLines({ weeks: [{ week: '2026-W05', total: 3, unread: 1 }] }),
    ['2026 年第 5 周：3 条（1 条未读）']
  );

  assert.match(NOTIFICATIONS_UI, /\/api\/notifications\?/);
  assert.match(NOTIFICATIONS_UI, /nextCursor/);
  assert.match(NOTIFICATIONS_UI, /加载更多/);
  assert.match(NOTIFICATIONS_UI, /归档摘要/);
  assert.match(NOTIFICATIONS_UI, /btn-notifications-more/);
});
