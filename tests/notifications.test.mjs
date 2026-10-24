// 通知中心：写入幂等、最近 20 条自动清理、未读清零、只读本人，
// 以及通知写入失败不阻断成就结算等主流程。
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-notifications-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-notifications-server-${process.pid}-${Date.now()}.db`);
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = 'notifications-alice-01';
const BOB = 'notifications-bob-01';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const INDEX_HTML = read('public/index.html');
const NOTIFICATIONS_UI = read('public/js/ui/notifications.js');

let db = null;
let createProfile = null;
let notify = null;
let notificationSummary = null;
let markAllRead = null;
let unlockAchievements = null;

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

async function api(pathname, { method = 'GET', token = ALICE } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
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
  ({ notify, notificationSummary, markAllRead } = await import('../server/db/notifications.mjs'));
  ({ unlockAchievements } = await import('../server/db/achievements.mjs'));

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

  // 让服务端先建好两个账号（旧令牌门禁），再向服务端库写入通知。
  await api('/api/notifications', { token: ALICE });
  await api('/api/notifications', { token: BOB });
  serverDb = new DatabaseSync(SERVER_DB);
  serverDb.exec('PRAGMA busy_timeout = 5000');
  const accountId = (token) =>
    serverDb
      .prepare("SELECT account_id FROM account_aliases WHERE provider = 'legacy_token' AND alias_hash = ?")
      .get(crypto.createHash('sha256').update(token).digest('hex'))?.account_id;
  const now = Date.now();
  const insert = serverDb.prepare(
    `INSERT INTO account_notifications
       (account_id, kind, dedupe_key, payload, created_at, read_at)
     VALUES (?, 'achievement', ?, ?, ?, NULL)`
  );
  insert.run(accountId(ALICE), 'achievement:first_run', JSON.stringify({ achievementId: 'first_run', title: '首次远征' }), now);
  insert.run(accountId(BOB), 'achievement:first_win', JSON.stringify({ achievementId: 'first_win', title: '首胜' }), now);
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

test('同一事件重复写入保持幂等，未读数只增加一次', () => {
  const now = Date.now();
  const first = notify(ALICE, {
    kind: 'achievement',
    dedupeKey: 'achievement:first_run',
    payload: { achievementId: 'first_run', title: '首次远征' },
  }, now);
  const second = notify(ALICE, {
    kind: 'achievement',
    dedupeKey: 'achievement:first_run',
    payload: { achievementId: 'first_run', title: '首次远征' },
  }, now + 1000);

  assert.ok(first, '首次写入应返回记录');
  assert.equal(second, null, '重复写入应被幂等键拦下');
  const rows = db
    .prepare('SELECT COUNT(*) AS c FROM account_notifications WHERE account_id = ?')
    .get(ALICE);
  assert.equal(Number(rows.c), 1);

  const summary = notificationSummary(ALICE);
  assert.equal(summary.unread, 1);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].payload.title, '首次远征');
  assert.equal(summary.items[0].readAt, null);
});

test('超过 20 条只保留最新的 20 条', () => {
  const base = Date.now() + 5000;
  for (let i = 0; i < 25; i++) {
    notify(BOB, {
      kind: 'bounty',
      dedupeKey: `bounty:daily:2026-10-24:bounty-${i}`,
      payload: { bountyId: `bounty-${i}`, title: `悬赏 ${i}`, reward: i },
    }, base + i);
  }

  const summary = notificationSummary(BOB);
  const total = db
    .prepare('SELECT COUNT(*) AS c FROM account_notifications WHERE account_id = ?')
    .get(BOB);
  assert.equal(Number(total.c), 20, '数据库应清理到 20 条');
  assert.equal(summary.items.length, 20);
  assert.equal(summary.unread, 20);
  assert.equal(summary.items[0].payload.bountyId, 'bounty-24', '最新记录排在最前');
  assert.equal(summary.items.at(-1).payload.bountyId, 'bounty-5', '最旧的 5 条已被清理');
});

test('全部已读后未读清零，重复调用不再更新', () => {
  const result = markAllRead(BOB);
  assert.equal(result.ok, true);
  assert.equal(result.updated, 20);
  assert.equal(result.unread, 0);

  const summary = notificationSummary(BOB);
  assert.equal(summary.unread, 0);
  assert.ok(summary.items.every((item) => item.readAt != null));

  const again = markAllRead(BOB);
  assert.equal(again.updated, 0);
});

test('未读只统计本人，标记已读不影响他人', () => {
  notify(ALICE, {
    kind: 'season',
    dedupeKey: 'season:2026-10',
    payload: { season: '2026-10', rank: 3, cores: 50 },
  }, Date.now() + 20000);
  markAllRead(ALICE);

  assert.equal(notificationSummary(ALICE).unread, 0);
  // BOB 新增一条未读后，ALICE 仍保持已读，证明两账号互不影响。
  notify(BOB, {
    kind: 'achievement',
    dedupeKey: 'achievement:first_win',
    payload: { achievementId: 'first_win', title: '首胜' },
  }, Date.now() + 21000);
  assert.equal(notificationSummary(BOB).unread, 1);
  assert.equal(notificationSummary(ALICE).unread, 0, 'BOB 的新通知不应出现在 ALICE 的未读里');
  assert.ok(
    notificationSummary(ALICE).items.every((item) => item.kind !== 'bounty'),
    'ALICE 看不到 BOB 的悬赏通知'
  );
});

test('通知写入失败被吞掉，成就结算仍然完成', () => {
  const failingAccount = 'notifications-failing-01';
  seedAccount(failingAccount);
  db.exec(`
    CREATE TRIGGER trg_notifications_fail
    BEFORE INSERT ON account_notifications
    BEGIN
      SELECT RAISE(ABORT, 'notifications unavailable');
    END;
  `);
  try {
    const direct = notify(failingAccount, {
      kind: 'achievement',
      dedupeKey: 'achievement:first_run',
      payload: { achievementId: 'first_run' },
    });
    assert.equal(direct, null, '写入失败应返回 null 而不是抛出');

    const added = unlockAchievements(failingAccount, {
      stats: { runs: 1, wins: 0, kills: 0, byDifficulty: {} },
    });
    assert.ok(added.includes('first_run'), '成就结算本身不受通知写入失败影响');
    assert.equal(notificationSummary(failingAccount).items.length, 0);
  } finally {
    db.exec('DROP TRIGGER trg_notifications_fail');
  }
});

test('接口按账号隔离：本人可见、他人不可读', async () => {
  const alice = await api('/api/notifications', { token: ALICE });
  assert.equal(alice.status, 200);
  assert.ok(Array.isArray(alice.data.items));
  assert.ok(alice.data.items.length >= 1);
  assert.ok(
    alice.data.items.every((item) => item.payload?.achievementId !== 'first_win'),
    'ALICE 不应读到 BOB 的通知'
  );

  const bob = await api('/api/notifications', { token: BOB });
  assert.equal(bob.status, 200);
  assert.ok(
    bob.data.items.every((item) => item.payload?.achievementId !== 'first_run'),
    'BOB 不应读到 ALICE 的通知'
  );

  const readResult = await api('/api/notifications/read', { method: 'POST', token: ALICE });
  assert.equal(readResult.status, 200);
  assert.equal(readResult.data.unread, 0);

  const aliceAfter = await api('/api/notifications', { token: ALICE });
  assert.equal(aliceAfter.data.unread, 0);
  const bobAfter = await api('/api/notifications', { token: BOB });
  assert.equal(bobAfter.data.unread, 1, 'BOB 的未读不受 ALICE 已读操作影响');

  const anonymous = await api('/api/notifications', { token: '' });
  assert.equal(anonymous.status, 401);
});

test('客户端铃铛、面板与脚本已接入', () => {
  assert.match(INDEX_HTML, /id="btn-notifications"/, 'index.html 缺少通知铃铛');
  assert.match(INDEX_HTML, /id="notifications-badge"/, 'index.html 缺少未读角标');
  assert.match(INDEX_HTML, /id="notifications-panel"/, 'index.html 缺少通知面板');
  assert.match(INDEX_HTML, /src="\/js\/ui\/notifications\.js"/, 'index.html 未引入通知脚本');
  assert.match(NOTIFICATIONS_UI, /\/api\/notifications/);
  assert.match(NOTIFICATIONS_UI, /\/api\/notifications\/read/);
  assert.match(NOTIFICATIONS_UI, /notifications-badge/);
});
