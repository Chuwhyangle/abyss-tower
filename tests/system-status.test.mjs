// 运行状态诊断摘要：字段完整、权限、脱敏、异常时不抛。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { startTestServer } from './harness.mjs';

const TMP_DB = path.join(os.tmpdir(), `rtd-system-status-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.DB_BACKUP = '0';

const { DiagnosticsRoutes, canViewDiagnostics, collectSystemStatus, isLoopbackRequest } =
  await import('../server/routes/system.mjs');
const { RouteTable } = await import('../server/routes/router.mjs');

function dispatchStatus(remoteAddress) {
  const table = new RouteTable();
  new DiagnosticsRoutes().register(table);
  const responses = [];
  const ctx = {
    req: { socket: { remoteAddress }, headers: {} },
    method: 'GET',
    pathname: '/api/system/status',
    json(status, data) {
      responses.push({ status, data });
      return true;
    },
    fail(status, message, code) {
      responses.push({ status, message, code });
      return true;
    },
  };
  return table.dispatch(ctx).then(() => responses[0]);
}

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${TMP_DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('状态接口只允许回环地址或持有管理员令牌', async (t) => {
  const previous = process.env.DIAGNOSTICS_ADMIN_TOKEN;
  process.env.DIAGNOSTICS_ADMIN_TOKEN = '';
  t.after(() => {
    if (previous === undefined) delete process.env.DIAGNOSTICS_ADMIN_TOKEN;
    else process.env.DIAGNOSTICS_ADMIN_TOKEN = previous;
  });

  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '203.0.113.7' } }), false);
  assert.equal(canViewDiagnostics({ socket: { remoteAddress: '203.0.113.7' }, headers: {} }), false);

  const denied = await dispatchStatus('203.0.113.7');
  assert.equal(denied.status, 403);

  const allowed = await dispatchStatus('127.0.0.1');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.ok, true);

  process.env.DIAGNOSTICS_ADMIN_TOKEN = 'test-admin-token';
  const withToken = {
    socket: { remoteAddress: '203.0.113.7' },
    headers: { 'x-diagnostics-token': 'test-admin-token' },
  };
  assert.equal(canViewDiagnostics(withToken), true);
});

test('摘要字段完整且来自真实数据库', () => {
  const status = collectSystemStatus();

  assert.equal(status.ok, true);
  assert.ok(Number.isInteger(status.generatedAt));
  assert.equal(typeof status.version, 'string');
  assert.ok(status.version.length > 0);
  assert.match(status.contentVersion, /^v?\d+\.\d+\.\d+/);
  assert.ok(Number.isInteger(status.database.sizeBytes));
  assert.ok(status.database.sizeBytes > 0);

  const migrations = status.database.migrations;
  assert.ok(Number.isInteger(migrations.applied));
  assert.ok(migrations.applied >= 11);
  assert.equal(migrations.latestVersion, 11);
  assert.ok(Number.isInteger(migrations.total));
  assert.ok(migrations.total >= migrations.applied);
  assert.equal(migrations.pending, 0);
  assert.ok(Number.isFinite(migrations.latestAppliedAt));

  assert.ok(Number.isInteger(status.activeRuns));
  assert.ok(status.activeRuns >= 0);
  assert.ok(Number.isInteger(status.errors.last24h));
});

test('最近 24h 错误计数只覆盖窗口内条目', () => {
  const now = Date.now();
  const log = {
    capacity: 8,
    recent() {
      return [
        { time: now - 1000 },
        { time: now - 24 * 60 * 60 * 1000 - 1 },
        { time: now - 60 * 60 * 1000 },
        { time: 'bad' },
      ];
    },
  };

  const status = collectSystemStatus({ log, now, migrationsTotal: 10 });
  assert.equal(status.generatedAt, now);
  assert.equal(status.errors.last24h, 2);
});

test('单个数据源异常时降级为 null，整体不抛出', () => {
  const brokenLog = {
    capacity: 4,
    recent() {
      throw new Error('log unavailable');
    },
  };
  const partial = collectSystemStatus({ log: brokenLog, migrationsTotal: 10 });
  assert.ok(Number.isInteger(partial.database.migrations.applied));
  assert.ok(Number.isInteger(partial.activeRuns));
  assert.equal(partial.errors.last24h, null);

  const brokenDb = {
    prepare() {
      throw new Error('database unavailable at /home/wenhao/secret.db');
    },
  };
  const failed = collectSystemStatus({
    database: brokenDb,
    log: brokenLog,
    now: 1700000000000,
    migrationsTotal: null,
  });

  assert.equal(failed.ok, true);
  assert.equal(failed.generatedAt, 1700000000000);
  assert.equal(failed.database.sizeBytes, null);
  assert.deepEqual(failed.database.migrations, {
    applied: null,
    latestVersion: null,
    latestAppliedAt: null,
    total: null,
    pending: null,
  });
  assert.equal(failed.activeRuns, null);
  assert.equal(failed.errors.last24h, null);
  assert.ok(!JSON.stringify(failed).includes('secret'));
});

test('HTTP 摘要不泄露账号、令牌与明文路径', async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const response = await fetch(`${server.base}/api/system/status`);
  assert.equal(response.status, 200);
  const body = await response.text();
  const data = JSON.parse(body);

  assert.equal(data.ok, true);
  assert.ok(Number.isInteger(data.activeRuns));
  assert.ok(Number.isInteger(data.errors.last24h));
  assert.ok(!body.includes(server.dbPath), `响应不应包含数据库路径：${body}`);
  assert.ok(!body.includes(os.tmpdir()), `响应不应包含临时目录：${body}`);
  assert.ok(!/\/(home|tmp|etc|var)\//.test(body), `响应不应包含明文路径：${body}`);
  assert.ok(
    !/\b(pass(?:word|wd)?|token|secret|session|credential)\b/i.test(body),
    `响应不应包含凭据字段：${body}`
  );
});
