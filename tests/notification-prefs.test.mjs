// 通知偏好：默认全开、关闭后不再产生未读但保留历史、非法值回退默认并告警，
// 以及偏好读写接口与客户端开关接线。
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
const UNIT_DB = path.join(os.tmpdir(), `rtd-notif-prefs-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-notif-prefs-server-${process.pid}-${Date.now()}.db`);
const PORT = 20100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = 'notif-prefs-alice-01';
const BOB = 'notif-prefs-bob-01';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const NOTIFICATIONS_UI = read('public/js/ui/notifications.js');

let db = null;
let createProfile = null;
let notify = null;
let notificationSummary = null;
let unlockAchievements = null;
let readPrefs = null;
let writePrefs = null;
let normalizePrefs = null;
let DEFAULT_NOTIFICATION_PREFS = null;

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

function captureWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
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
  } = await import('../server/db/notifications.mjs'));
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

test('偏好默认全开，读写后按类型持久化', () => {
  assert.deepEqual(readPrefs(ALICE), { achievement: true, bounty: true, season: true });
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFS, { achievement: true, bounty: true, season: true });

  const saved = writePrefs(ALICE, { season: false });
  assert.deepEqual(saved.prefs, { achievement: true, bounty: true, season: false });
  assert.deepEqual(saved.invalid, []);
  assert.deepEqual(readPrefs(ALICE), { achievement: true, bounty: true, season: false });

  // 只更新给出的类型，未提及的保持原值。
  writePrefs(ALICE, { bounty: false });
  assert.deepEqual(readPrefs(ALICE), { achievement: true, bounty: false, season: false });
});

test('关闭某类型后不再产生新的未读，历史仍可读', () => {
  writePrefs(BOB, { achievement: false });

  const blocked = notify(
    BOB,
    { kind: 'achievement', dedupeKey: 'achievement:first_run', payload: { achievementId: 'first_run' } },
    Date.now()
  );
  assert.equal(blocked, null, '关闭成就通知后不应写入');
  assert.equal(notificationSummary(BOB).items.length, 0);

  // 其它类型不受影响。
  const bounty = notify(
    BOB,
    { kind: 'bounty', dedupeKey: 'bounty:daily:2026-10-24:bounty-1', payload: { bountyId: 'bounty-1' } },
    Date.now() + 1000
  );
  assert.ok(bounty, '未关闭的悬赏通知仍应写入');
  assert.equal(notificationSummary(BOB).unread, 1);

  // 已有历史不受关闭影响。
  const now = Date.now() + 2000;
  db.prepare(
    `INSERT INTO account_notifications
       (account_id, kind, dedupe_key, payload, created_at, read_at)
     VALUES (?, 'achievement', 'achievement:old', ?, ?, NULL)`
  ).run(BOB, JSON.stringify({ achievementId: 'old' }), now);
  const summary = notificationSummary(BOB);
  assert.equal(summary.unread, 2, '关闭只拦新增，历史未读保留');
  assert.ok(summary.items.some((item) => item.kind === 'achievement'));

  // 历史已读后也不会被删除。
  const before = db
    .prepare('SELECT COUNT(*) AS c FROM account_notifications WHERE account_id = ?')
    .get(BOB);
  notify(BOB, { kind: 'achievement', dedupeKey: 'achievement:new', payload: {} }, now + 1000);
  const afterRow = db
    .prepare('SELECT COUNT(*) AS c FROM account_notifications WHERE account_id = ?')
    .get(BOB);
  assert.equal(Number(afterRow.c), Number(before.c), '关闭期间历史条数不变');
});

test('非法偏好回退默认并记录警告', () => {
  writePrefs(ALICE, { achievement: false });

  const { result, warnings } = captureWarnings(() =>
    writePrefs(ALICE, { achievement: 'yes', bounty: null, mystery: true })
  );
  assert.equal(result.prefs.achievement, true, '非布尔值回退默认开');
  assert.equal(result.prefs.bounty, true, 'null 回退默认开');
  assert.equal('mystery' in result.prefs, false, '未知类型不写入');
  assert.deepEqual(result.invalid.sort(), ['achievement', 'bounty', 'mystery']);
  assert.equal(warnings.length, 3, '每个非法字段记录一条警告');
  assert.ok(warnings.some((line) => line.includes('achievement')));
  // 只有非法字段回退默认，未提及的 season 保持此前关闭的状态。
  assert.deepEqual(readPrefs(ALICE), { achievement: true, bounty: true, season: false });

  assert.deepEqual(normalizePrefs(null), { prefs: {}, invalid: [] });
  assert.deepEqual(normalizePrefs(['nope']), { prefs: {}, invalid: [] });
});

test('偏好数据损坏时回退默认且不影响通知写入', () => {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, 'notifications', 'prefs', '{bad json', ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(ALICE, Date.now());

  const { result, warnings } = captureWarnings(() => readPrefs(ALICE));
  assert.deepEqual(result, { achievement: true, bounty: true, season: true });
  assert.ok(warnings.some((line) => line.includes('损坏')));

  const written = captureWarnings(() =>
    notify(ALICE, { kind: 'season', dedupeKey: 'season:2026-10', payload: { season: '2026-10' } }, Date.now())
  );
  assert.ok(written.result, '损坏的偏好数据不应阻断通知');
});

test('关闭通知偏好不影响成就解锁与奖励发放', () => {
  const account = 'notif-prefs-reward-01';
  seedAccount(account);
  writePrefs(account, { achievement: false });

  const added = unlockAchievements(account, {
    stats: { runs: 1, wins: 0, kills: 0, byDifficulty: {} },
  });
  assert.ok(added.includes('first_run'), '成就本身仍然解锁');
  assert.equal(notificationSummary(account).items.length, 0, '只是不写通知');
});

test('偏好接口：默认值、局部更新、非法值回退与匿名拒绝', async () => {
  const defaults = await api('/api/notifications/prefs');
  assert.equal(defaults.status, 200);
  assert.deepEqual(defaults.data.prefs, { achievement: true, bounty: true, season: true });

  const saved = await api('/api/notifications/prefs', {
    method: 'PUT',
    body: { prefs: { season: false, bounty: 'invalid', extra: 1 } },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.prefs.season, false);
  assert.equal(saved.data.prefs.achievement, true);
  assert.equal(saved.data.prefs.bounty, true, '非法值回退默认，而不是保留旧值');
  assert.deepEqual(saved.data.ignored.sort(), ['bounty', 'extra']);

  const readback = await api('/api/notifications/prefs');
  assert.deepEqual(readback.data.prefs, { achievement: true, bounty: true, season: false });

  // 支持直接传偏好对象。
  const flat = await api('/api/notifications/prefs', { method: 'PUT', body: { bounty: false } });
  assert.equal(flat.status, 200);
  assert.equal(flat.data.prefs.bounty, false);

  const invalid = await api('/api/notifications/prefs', { method: 'PUT', body: { prefs: [] } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_NOTIFICATION_PREFS');

  const anonymous = await api('/api/notifications/prefs', { token: '' });
  assert.equal(anonymous.status, 401);
});

test('关闭类型后接口读到的历史仍然完整', async () => {
  const accountId = (token) =>
    serverDb
      .prepare("SELECT account_id FROM account_aliases WHERE provider = 'legacy_token' AND alias_hash = ?")
      .get(crypto.createHash('sha256').update(token).digest('hex'))?.account_id;

  await api('/api/notifications/prefs', { method: 'PUT', body: { prefs: { achievement: false } } });
  const now = Date.now();
  serverDb
    .prepare(
      `INSERT INTO account_notifications
         (account_id, kind, dedupe_key, payload, created_at, read_at)
       VALUES (?, 'achievement', 'achievement:before-off', ?, ?, NULL)`
    )
    .run(accountId(ALICE), JSON.stringify({ achievementId: 'before-off' }), now);

  const listed = await api('/api/notifications');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.unread, 1, '关闭前的历史未读仍可见');
  assert.ok(listed.data.items.some((item) => item.kind === 'achievement'));
});

test('客户端开关已接线：双语标签、请求方法与响应式布局', () => {
  assert.match(NOTIFICATIONS_UI, /\/api\/notifications\/prefs/);
  assert.match(NOTIFICATIONS_UI, /method: 'PUT'/);
  assert.match(NOTIFICATIONS_UI, /data-notification-pref/);
  assert.match(NOTIFICATIONS_UI, /通知偏好 \/ Notification preferences/);
  assert.match(NOTIFICATIONS_UI, /成就通知/);
  assert.match(NOTIFICATIONS_UI, /Achievements/);
  assert.match(NOTIFICATIONS_UI, /repeat\(auto-fit, minmax\(150px, 1fr\)\)/, '开关网格需适配大小屏');
});
