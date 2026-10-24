// 系统公告通知：普通公告受 announcements 偏好控制，重要公告始终写入且不可关闭；
// 偏好键集中定义、接口可读写，通知只对被写入的账号可见。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-notif-announcement-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-notif-announcement-server-${process.pid}-${Date.now()}.db`);
const PORT = 20500 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = 'notif-announcement-alice-01';
const BOB = 'notif-announcement-bob-01';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const NOTIFICATIONS_UI = read('public/js/ui/notifications.js');

let db = null;
let createProfile = null;
let notify = null;
let notificationSummary = null;
let readPrefs = null;
let writePrefs = null;
let normalizePrefs = null;
let DEFAULT_NOTIFICATION_PREFS = null;
let NOTIFICATION_KINDS = null;
let NOTIFICATION_PREF_KEYS = null;
let isImportantAnnouncement = null;

let server = null;
let serverDb = null;

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

async function api(pathname, { method = 'GET', token = ALICE, body } = {}) {
  const headers = token ? { 'x-player-token': token } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
  ({
    notify,
    notificationSummary,
    readPrefs,
    writePrefs,
    normalizePrefs,
    DEFAULT_NOTIFICATION_PREFS,
    NOTIFICATION_KINDS,
    NOTIFICATION_PREF_KEYS,
    isImportantAnnouncement,
  } = await import('../server/db/notifications.mjs'));

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
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) break;
    } catch {
      /* 等待启动 */
    }
    await sleep(100);
  }

  await api('/api/notifications', { token: ALICE });
  await api('/api/notifications', { token: BOB });
  serverDb = new DatabaseSync(SERVER_DB);
  serverDb.exec('PRAGMA busy_timeout = 5000');
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

test('偏好键集中定义：announcement → announcements，默认开启', () => {
  assert.deepEqual([...NOTIFICATION_KINDS].sort(), [
    'achievement',
    'announcement',
    'bounty',
    'season',
  ]);
  assert.equal(NOTIFICATION_PREF_KEYS.announcement, 'announcements');
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFS, {
    achievement: true,
    bounty: true,
    season: true,
    announcements: true,
  });
  assert.deepEqual(readPrefs(ALICE), {
    achievement: true,
    bounty: true,
    season: true,
    announcements: true,
  });
  // 只接受已知偏好键，kind 名 announcement 不是偏好键。
  assert.deepEqual(normalizePrefs({ announcement: false }).invalid, ['announcement']);
  assert.deepEqual(normalizePrefs({ announcements: false }).prefs, { announcements: false });
});

test('普通公告可关闭：关闭后不再产生未读，历史保留', () => {
  const now = Date.now();
  notify(
    BOB,
    { kind: 'announcement', dedupeKey: 'announcement:history', payload: { title: '历史公告' } },
    now
  );
  assert.equal(notificationSummary(BOB).unread, 1);

  writePrefs(BOB, { announcements: false });
  const blocked = notify(
    BOB,
    { kind: 'announcement', dedupeKey: 'announcement:blocked', payload: { title: '普通公告' } },
    now + 1000
  );
  assert.equal(blocked, null, '关闭普通公告后不应写入');
  assert.equal(notificationSummary(BOB).unread, 1, '关闭只拦新增，历史未读保留');

  // 其它通知类型不受公告偏好影响。
  const bounty = notify(
    BOB,
    { kind: 'bounty', dedupeKey: 'bounty:daily:2026-10-24:bounty-1', payload: { bountyId: 'bounty-1' } },
    now + 2000
  );
  assert.ok(bounty, '公告偏好不应影响悬赏通知');

  writePrefs(BOB, { announcements: true });
  const reopened = notify(
    BOB,
    { kind: 'announcement', dedupeKey: 'announcement:reopened', payload: { title: '重新开启' } },
    now + 3000
  );
  assert.ok(reopened, '重新开启后普通公告恢复写入');
});

test('重要公告始终写入，normal 公告仍受开关控制', () => {
  writePrefs(ALICE, { announcements: false, achievement: false, season: false });
  const now = Date.now();

  const viaFlag = notify(
    ALICE,
    {
      kind: 'announcement',
      dedupeKey: 'announcement:maintenance',
      payload: { title: '维护公告' },
      important: true,
    },
    now
  );
  assert.ok(viaFlag, '重要公告不受 announcements 偏好影响');

  const viaPayload = notify(
    ALICE,
    {
      kind: 'announcement',
      dedupeKey: 'announcement:shutdown',
      payload: { title: '停服公告', important: true },
    },
    now + 1000
  );
  assert.ok(viaPayload, 'payload.important 同样视为重要公告');

  const items = notificationSummary(ALICE).items;
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.kind === 'announcement'));
  assert.ok(items.every((item) => item.payload.important === true), '重要标记需持久化');

  // 重要的只对公告生效：其它类型关闭后仍然不写。
  assert.equal(
    notify(ALICE, { kind: 'achievement', dedupeKey: 'achievement:x', payload: {}, important: true }, now + 2000),
    null
  );
  assert.equal(
    notify(ALICE, { kind: 'season', dedupeKey: 'season:x', payload: {}, important: true }, now + 3000),
    null
  );
  assert.equal(
    notify(ALICE, { kind: 'announcement', dedupeKey: 'announcement:normal', payload: { title: '普通公告' } }, now + 4000),
    null,
    '普通公告仍然可以被关闭'
  );

  assert.equal(isImportantAnnouncement({ kind: 'announcement', important: true }), true);
  assert.equal(isImportantAnnouncement({ kind: 'achievement', important: true }), false);
  assert.equal(isImportantAnnouncement({ kind: 'announcement', payload: {} }), false);
});

test('偏好接口支持 announcements 键，且不改变其它类型', async () => {
  const defaults = await api('/api/notifications/prefs');
  assert.equal(defaults.status, 200);
  assert.deepEqual(defaults.data.prefs, {
    achievement: true,
    bounty: true,
    season: true,
    announcements: true,
  });

  const saved = await api('/api/notifications/prefs', {
    method: 'PUT',
    body: { prefs: { announcements: false } },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.prefs.announcements, false);
  assert.equal(saved.data.prefs.achievement, true, '公告偏好不影响成就');
  assert.deepEqual(saved.data.ignored, []);

  const readback = await api('/api/notifications/prefs');
  assert.equal(readback.data.prefs.announcements, false);

  // 非法值回退默认并出现在 ignored 中。
  const invalid = await api('/api/notifications/prefs', {
    method: 'PUT',
    body: { prefs: { announcements: 'off' } },
  });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.data.prefs.announcements, true);
  assert.deepEqual(invalid.data.ignored, ['announcements']);
});

test('公告只读本人：他人账号不可见', async () => {
  const accountId = (token) =>
    serverDb
      .prepare("SELECT account_id FROM account_aliases WHERE provider = 'legacy_token' AND alias_hash = ?")
      .get(crypto.createHash('sha256').update(token).digest('hex'))?.account_id;

  const aliceId = accountId(ALICE);
  const bobId = accountId(BOB);
  assert.ok(aliceId && bobId);

  const now = Date.now();
  serverDb
    .prepare(
      `INSERT INTO account_notifications
         (account_id, kind, dedupe_key, payload, created_at, read_at)
       VALUES (?, 'announcement', 'announcement:api-important', ?, ?, NULL)`
    )
    .run(aliceId, JSON.stringify({ title: '维护通知', important: true }), now);
  serverDb
    .prepare(
      `INSERT INTO account_notifications
         (account_id, kind, dedupe_key, payload, created_at, read_at)
       VALUES (?, 'announcement', 'announcement:api-normal', ?, ?, NULL)`
    )
    .run(bobId, JSON.stringify({ title: 'BOB 的公告' }), now);

  const aliceList = await api('/api/notifications');
  assert.equal(aliceList.status, 200);
  const aliceItems = aliceList.data.items.filter((item) => item.kind === 'announcement');
  assert.equal(aliceItems.length, 1);
  assert.equal(aliceItems[0].payload.title, '维护通知');
  assert.equal(aliceItems[0].payload.important, true);

  const bobList = await api('/api/notifications', { token: BOB });
  assert.equal(bobList.status, 200);
  const bobItems = bobList.data.items.filter((item) => item.kind === 'announcement');
  assert.equal(bobItems.length, 1);
  assert.equal(bobItems[0].payload.title, 'BOB 的公告');
  assert.ok(
    bobItems.every((item) => item.payload.title !== '维护通知'),
    'BOB 不应看到 ALICE 的公告'
  );
});

test('客户端公告样式与开关已接线', async () => {
  const ui = await import('../public/js/ui/notifications.js');
  assert.match(NOTIFICATIONS_UI, /announcement: '系统公告'/);
  assert.match(NOTIFICATIONS_UI, /key: 'announcements'/);
  assert.match(NOTIFICATIONS_UI, /important-announcement/);
  assert.match(NOTIFICATIONS_UI, /重要公告/);
  assert.match(NOTIFICATIONS_UI, /data-notification-pref/);

  assert.equal(ui.isImportantAnnouncement({ kind: 'announcement', payload: { important: true } }), true);
  assert.equal(ui.isImportantAnnouncement({ kind: 'announcement', payload: {} }), false);
  assert.equal(
    ui.notificationKindLabel({ kind: 'announcement', payload: { important: true } }),
    '重要公告'
  );
  assert.equal(ui.notificationKindLabel({ kind: 'announcement', payload: {} }), '系统公告');
  assert.equal(
    ui.describeNotification({ kind: 'announcement', payload: { message: '今晚 23:00 维护' } }),
    '今晚 23:00 维护'
  );
});
