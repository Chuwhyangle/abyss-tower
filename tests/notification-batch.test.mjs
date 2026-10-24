// 通知批量已读：单批边界、剩余数准确、只更新本人、重复/并发点击幂等，
// 以及接口 all=true 分批直到未读清零。
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

import { allocatePort, waitForHealth } from './test-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-notif-batch-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-notif-batch-server-${process.pid}-${Date.now()}.db`);
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const ALICE = 'notif-batch-alice-01';
const BOB = 'notif-batch-bob-01';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const NOTIFICATIONS_UI = read('public/js/ui/notifications.js');

let db = null;
let createProfile = null;
let markReadBatch = null;
let markAllRead = null;
let list = null;
let NOTIFICATION_READ_BATCH_SIZE = 0;

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

function insertUnread(accountId, count, prefix = 'batch') {
  const base = Date.now() - 60_000;
  const insert = db.prepare(
    `INSERT INTO account_notifications
       (account_id, kind, dedupe_key, payload, created_at, read_at)
     VALUES (?, 'achievement', ?, ?, ?, NULL)`
  );
  for (let i = 0; i < count; i++) {
    insert.run(accountId, `achievement:${prefix}-${i}`, JSON.stringify({ n: i }), base + i);
  }
}

const TRANSIENT_FETCH_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET']);

async function api(pathname, { method = 'GET', token = ALICE, body = null } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${pathname}`, {
        method,
        // 不复用连接：并行测试集下连接池里的陈旧套接字会以 fetch failed 结束。
        headers: {
          connection: 'close',
          ...(token ? { 'x-player-token': token } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    } catch (error) {
      // 连接级失败与被测接口的响应错误不同：前者重试一次，避免整套测试偶发变红。
      const code = error?.cause?.code;
      if (!TRANSIENT_FETCH_CODES.has(code) || attempt >= 1) {
        throw new Error(
          `API ${method} ${pathname} 失败：${error?.message}${code ? ` (${code})` : ''}`,
          { cause: error }
        );
      }
      await sleep(50);
    }
  }
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({ markReadBatch, markAllRead, list, NOTIFICATION_READ_BATCH_SIZE } = await import(
    '../server/db/notifications.mjs'
  ));

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

  // 先让服务端建好两个账号，再直接向服务端库写入 >1 批的未读通知。
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
     VALUES (?, 'achievement', ?, '{}', ?, NULL)`
  );
  const base = Date.now() - 60_000;
  for (let i = 0; i < 130; i++) {
    insert.run(accountId(ALICE), `achievement:api-alice-${i}`, base + i);
    insert.run(accountId(BOB), `achievement:api-bob-${i}`, base + i);
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

test('单批最多处理固定条数，剩余未读数逐批递减', () => {
  const account = 'batch-boundary-01';
  seedAccount(account);
  insertUnread(account, 250, 'boundary');

  assert.equal(list(account).unread, 250);

  const first = markReadBatch(account, 100);
  assert.equal(first.updated, 100);
  assert.equal(first.remaining, 150);
  assert.equal(list(account).unread, 150);

  const second = markReadBatch(account, 100);
  assert.equal(second.updated, 100);
  assert.equal(second.remaining, 50);

  const third = markReadBatch(account, 100);
  assert.equal(third.updated, 50, '最后一批只更新剩余记录');
  assert.equal(third.remaining, 0);

  const fourth = markReadBatch(account, 100);
  assert.equal(fourth.updated, 0, '已清零后不再更新');
  assert.equal(fourth.remaining, 0);
  assert.ok(list(account).unread >= 0, '未读数不得为负');
});

test('默认批量大小集中定义并被 markReadBatch 使用', () => {
  const account = 'batch-default-01';
  seedAccount(account);
  insertUnread(account, NOTIFICATION_READ_BATCH_SIZE + 30, 'default');

  assert.equal(NOTIFICATION_READ_BATCH_SIZE, 100);
  const result = markReadBatch(account);
  assert.equal(result.updated, NOTIFICATION_READ_BATCH_SIZE, '默认值必须来自集中常量');
  assert.equal(result.remaining, 30);

  const invalid = markReadBatch(account, 0);
  assert.equal(invalid.updated, 30, '非法批量大小回退默认值');
  assert.equal(invalid.remaining, 0);
});

test('批量已读只更新本人记录，不影响他人未读', () => {
  const alice = 'batch-priv-alice-01';
  const bob = 'batch-priv-bob-01';
  seedAccount(alice);
  seedAccount(bob);
  insertUnread(alice, 120, 'priv-alice');
  insertUnread(bob, 30, 'priv-bob');

  const result = markReadBatch(alice, 100);
  assert.equal(result.updated, 100);
  assert.equal(result.remaining, 20);
  assert.equal(list(bob).unread, 30, 'BOB 的未读不受 ALICE 操作影响');

  const bobRows = db
    .prepare('SELECT COUNT(*) AS c FROM account_notifications WHERE account_id = ? AND read_at IS NOT NULL')
    .get(bob);
  assert.equal(Number(bobRows.c), 0, 'BOB 的记录不应被标记');
});

test('markAllRead 循环处理到清零，重复调用幂等', () => {
  const account = 'batch-all-01';
  seedAccount(account);
  insertUnread(account, 230, 'all');

  const first = markAllRead(account);
  assert.equal(first.ok, true);
  assert.equal(first.updated, 230);
  assert.equal(first.unread, 0);
  assert.equal(first.remaining, 0);
  assert.equal(list(account).unread, 0);
  assert.ok(list(account).unread >= 0);

  const again = markAllRead(account);
  assert.equal(again.updated, 0, '重复调用不应重复计数');
  assert.equal(again.remaining, 0);
});

test('接口默认只处理一批，响应返回 remaining', async () => {
  const result = await api('/api/notifications/read', { method: 'POST', token: ALICE });
  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.updated, 100);
  assert.equal(result.data.remaining, 30);
  assert.equal(result.data.unread, 30);

  const after = await api('/api/notifications', { token: ALICE });
  assert.equal(after.data.unread, 30);
});

test('接口 all=true 分批直到清零，剩余未读归零且不为负', async () => {
  const result = await api('/api/notifications/read', {
    method: 'POST',
    token: ALICE,
    body: { all: true },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.updated, 30);
  assert.equal(result.data.remaining, 0);
  assert.equal(result.data.unread, 0);

  const after = await api('/api/notifications', { token: ALICE });
  assert.equal(after.data.unread, 0);
});

test('并发点击幂等：两个 all=true 请求不会重复计数', async () => {
  const before = await api('/api/notifications', { token: BOB });
  assert.equal(before.data.unread, 130);

  const [first, second] = await Promise.all([
    api('/api/notifications/read', { method: 'POST', token: BOB, body: { all: true } }),
    api('/api/notifications/read', { method: 'POST', token: BOB, body: { all: true } }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(
    first.data.updated + second.data.updated,
    130,
    '两个请求合计只更新原有未读条数'
  );
  assert.equal(first.data.remaining, 0);
  assert.equal(second.data.remaining, 0);

  const after = await api('/api/notifications', { token: BOB });
  assert.equal(after.data.unread, 0);
  assert.ok(after.data.unread >= 0);
});

test('客户端逐批处理并展示进度、更新角标', async () => {
  const { readProgressText } = await import('../public/js/ui/notifications.js');
  assert.equal(readProgressText(100, 30), '已标记 100 条，剩余 30 条');
  assert.equal(readProgressText(0, 0), '已标记 0 条，剩余 0 条');
  assert.equal(readProgressText('bad', -5), '已标记 0 条，剩余 0 条');

  assert.match(NOTIFICATIONS_UI, /read-progress|readProgressText/);
  assert.match(NOTIFICATIONS_UI, /notifications-read-status/);
  assert.match(NOTIFICATIONS_UI, /remaining/);
  assert.match(NOTIFICATIONS_UI, /all: false/);
  assert.match(NOTIFICATIONS_UI, /updateBadge\(remaining\)/);
});
