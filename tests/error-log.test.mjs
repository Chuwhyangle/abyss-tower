// 错误日志与诊断端点：环形上限、脱敏、文件硬上限、权限与「不抛出」保证。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CAPACITY,
  ErrorLog,
  errorLog,
  redactErrorText,
} from '../server/http/error-log.mjs';
import {
  DiagnosticsRoutes,
  canViewDiagnostics,
  hasAdminToken,
} from '../server/routes/system.mjs';
import { startTestServer } from './harness.mjs';

const SECRETS = {
  password: 'hunter2',
  token: 'tok_live_9f3a',
  bearer: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
  recovery: 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789',
  hash: 'scrypt$16384$8$1$abcdef$0123456789',
};

function routeHandler(controller) {
  const routes = [];
  controller.register({
    add(method, pattern, handler) {
      routes.push({ method, pattern, handler });
    },
  });
  assert.equal(routes.length, 1);
  return routes[0].handler;
}

function fakeContext(req) {
  return {
    req,
    status: 0,
    data: null,
    json(status, data) {
      this.status = status;
      this.data = data;
      return true;
    },
    fail(status, message, code) {
      this.status = status;
      this.data = { error: message, code };
      return true;
    },
  };
}

test('环形缓冲条数固定，只保留最近记录且新→旧', () => {
  const log = new ErrorLog({ capacity: 3, now: () => 1700000000000 });
  for (let i = 0; i < 7; i += 1) {
    log.record({ method: 'GET', path: `/api/runs/${i}`, status: 500, code: 'E', message: `m${i}` });
  }
  assert.equal(log.capacity, 3);
  assert.equal(log.size, 3);
  const recent = log.recent(10);
  assert.deepEqual(
    recent.map((entry) => entry.message),
    ['m6', 'm5', 'm4']
  );

  // 返回值是副本，改动不会污染缓冲。
  recent[0].message = 'tampered';
  assert.equal(log.recent(1)[0].message, 'm6');

  log.clear();
  assert.equal(log.size, 0);
  assert.deepEqual(log.recent(5), []);
});

test('默认容量与最近 50 条上限', () => {
  assert.equal(DEFAULT_CAPACITY, 200);
  const log = new ErrorLog({ capacity: 60, now: () => 1 });
  for (let i = 0; i < 80; i += 1) log.record({ message: `m${i}` });
  assert.equal(log.recent().length, 50);
  assert.equal(log.recent()[0].message, 'm79');
});

test('脱敏：密码 / token / Bearer / 恢复码 / 密码哈希不进入日志', () => {
  const raw = [
    'login failed password=hunter2',
    'token: tok_live_9f3a',
    `Authorization: Bearer ${SECRETS.bearer}`,
    `recovery code ${SECRETS.recovery}`,
    `stored hash ${SECRETS.hash}`,
    '{"password":"hunter2","access_token":"tok_live_9f3a"}',
  ].join('; ');

  const text = redactErrorText(raw);
  for (const secret of Object.values(SECRETS)) {
    assert.ok(!text.includes(secret), `敏感值泄漏：${secret}`);
  }
  assert.ok(text.includes('[已脱敏]'));
});

test('记录路径同样脱敏，且消息有长度上限', () => {
  const log = new ErrorLog({ capacity: 2, now: () => 1 });
  log.record({
    path: `/api/login?token=${SECRETS.token}`,
    message: `password=${SECRETS.password} ${'x'.repeat(1000)}`,
  });
  const [entry] = log.recent(1);
  assert.ok(!entry.path.includes(SECRETS.token));
  assert.ok(!entry.message.includes(SECRETS.password));
  assert.ok(entry.message.length <= 500);
});

test('文件日志有硬上限，并在写满时滚动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-log-'));
  const filePath = path.join(dir, 'errors.log');
  const maxFileBytes = 400;
  try {
    const log = new ErrorLog({ capacity: 5, filePath, maxFileBytes, now: () => 1 });
    for (let i = 0; i < 80; i += 1) {
      log.record({ method: 'GET', path: '/api/x', status: 500, code: 'E', message: `m${i}-${'y'.repeat(20)}` });
    }
    assert.equal(log.size, 5);
    assert.ok(fs.statSync(filePath).size <= maxFileBytes, '当前文件不得超过硬上限');
    assert.ok(fs.existsSync(`${filePath}.1`), '写满后应滚动出 .1 文件');
    assert.ok(fs.statSync(`${filePath}.1`).size <= maxFileBytes, '滚动文件同样有硬上限');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('日志写入失败不影响调用方，内存缓冲仍然可用', () => {
  const missingDir = path.join(os.tmpdir(), `error-log-missing-${process.pid}-${Date.now()}`);
  const log = new ErrorLog({ capacity: 2, filePath: path.join(missingDir, 'errors.log') });

  assert.doesNotThrow(() =>
    log.record({ method: 'POST', path: '/api/x', status: 500, message: 'boom' })
  );
  assert.equal(log.size, 1);
  assert.equal(log.recent(1)[0].message, 'boom');
});

test('record 对畸形输入永不抛出', () => {
  const log = new ErrorLog({ capacity: 2 });
  const poisonedValue = {
    toString() {
      throw new Error('toString exploded');
    },
  };
  assert.doesNotThrow(() => log.record({ message: poisonedValue }));
  assert.equal(log.recent(1)[0].message, '[错误信息不可读]');

  const poisonedInput = new Proxy(
    {},
    {
      get() {
        throw new Error('get exploded');
      },
    }
  );
  assert.doesNotThrow(() => log.record(poisonedInput));
});

test('诊断权限：仅回环或持有管理员 token', () => {
  const loopback = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  const loopbackV6 = { socket: { remoteAddress: '::1' }, headers: {} };
  const remote = { socket: { remoteAddress: '203.0.113.9' }, headers: {} };
  const remoteAdmin = {
    socket: { remoteAddress: '203.0.113.9' },
    headers: { 'x-diagnostics-token': 'admin-secret' },
  };
  const remoteWrong = {
    socket: { remoteAddress: '203.0.113.9' },
    headers: { 'x-diagnostics-token': 'wrong' },
  };

  assert.equal(canViewDiagnostics(loopback), true);
  assert.equal(canViewDiagnostics(loopbackV6), true);
  assert.equal(canViewDiagnostics(remote), false);
  assert.equal(canViewDiagnostics(remote, 'admin-secret'), false, '未带凭据不能访问');
  assert.equal(canViewDiagnostics(remoteAdmin, 'admin-secret'), true);
  assert.equal(canViewDiagnostics(remoteWrong, 'admin-secret'), false);
  assert.equal(canViewDiagnostics(remoteAdmin, ''), false, '未配置管理员 token 时禁用');

  assert.equal(hasAdminToken(remoteAdmin, 'admin-secret'), true);
  assert.equal(hasAdminToken({ headers: {} }, 'admin-secret'), false);
});

test('诊断路由：回环可读，远端拒绝，响应不含敏感值', () => {
  const handler = routeHandler(new DiagnosticsRoutes());

  errorLog.clear();
  errorLog.record({
    method: 'POST',
    path: `/api/auth/login?token=${SECRETS.token}`,
    status: 500,
    code: 'INTERNAL_ERROR',
    message: `password=${SECRETS.password} recovery code ${SECRETS.recovery} Bearer ${SECRETS.bearer}`,
  });

  const allowed = fakeContext({ socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  handler(allowed);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.ok, true);
  assert.ok(Array.isArray(allowed.data.errors));
  assert.equal(allowed.data.errors.length, 1);
  assert.equal(allowed.data.capacity, errorLog.capacity);

  const serialized = JSON.stringify(allowed.data);
  for (const secret of Object.values(SECRETS)) {
    assert.ok(!serialized.includes(secret), `诊断响应泄漏：${secret}`);
  }

  const denied = fakeContext({ socket: { remoteAddress: '203.0.113.9' }, headers: {} });
  handler(denied);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'FORBIDDEN');
});

test('HTTP 诊断端点：本地回环返回 200，容量来自环境配置', async () => {
  const server = await startTestServer({ env: { ERROR_LOG_CAPACITY: '4' } });
  try {
    const response = await fetch(`${server.base}/api/system/diagnostics`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.capacity, 4);
    assert.equal(data.count, 0);
    assert.deepEqual(data.errors, []);
  } finally {
    await server.stop();
  }
});
