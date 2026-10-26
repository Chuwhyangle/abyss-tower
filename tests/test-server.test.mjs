// 测试服务器运行时：端口分配（内核分配 + 租约）、启动就绪校验与共享起动器的换端口重试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allocatePort,
  leaseDir,
  pruneLeases,
  releasePort,
  startServer,
  waitForHealth,
} from './test-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function canBind(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

test('分配到的端口当前空闲，且并发分配互不相同', async () => {
  const ports = await Promise.all([allocatePort(), allocatePort(), allocatePort()]);
  assert.equal(new Set(ports).size, ports.length);
  for (const port of ports) {
    assert.ok(Number.isInteger(port) && port > 0);
    assert.equal(await canBind(port), true, `端口 ${port} 应处于空闲状态`);
    releasePort(port);
  }
});

test('租约文件记录持有进程，释放后消失', async () => {
  const port = await allocatePort();
  const file = path.join(leaseDir(), `${port}.json`);
  const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(lease.pid, process.pid);
  releasePort(port);
  assert.equal(fs.existsSync(file), false);
});

test('失效租约（进程已不存在）会被回收', () => {
  fs.mkdirSync(leaseDir(), { recursive: true });
  const file = path.join(leaseDir(), '1.json');
  fs.writeFileSync(file, `${JSON.stringify({ pid: 999999999, at: Date.now() })}\n`);
  pruneLeases();
  assert.equal(fs.existsSync(file), false);
});

test('waitForHealth 在服务应答后返回', async () => {
  const port = await allocatePort();
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    await waitForHealth({
      base: `http://127.0.0.1:${port}`,
      port,
      child: null,
      log: () => `[渊塔守卫] http://127.0.0.1:${port}`,
      attempts: 20,
      intervalMs: 20,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    releasePort(port);
  }
});

test('waitForHealth 在子进程退出后立即失败', async () => {
  const child = { exitCode: 1 };
  const started = Date.now();
  await assert.rejects(
    waitForHealth({ base: 'http://127.0.0.1:1', child, log: () => 'EADDRINUSE', attempts: 50, intervalMs: 100 }),
    /测试服务未能启动.*EADDRINUSE/s
  );
  assert.ok(Date.now() - started < 1000, '子进程已退出时不应等满超时');
});

test('waitForHealth 在子进程存活但端口无人应答时超时', async () => {
  const port = await allocatePort();
  try {
    await assert.rejects(
      waitForHealth({
        base: `http://127.0.0.1:${port}`,
        port,
        child: { exitCode: null },
        attempts: 2,
        intervalMs: 10,
      }),
      /测试服务未能启动/
    );
  } finally {
    releasePort(port);
  }
});

test('harness 不再用随机段猜端口', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tests', 'harness.mjs'), 'utf8');
  assert.doesNotMatch(source, /function randomPort/);
  assert.match(source, /allocatePort\(/);
});

test('startServer 首次尝试端口被占时换端口重试并成功启动', async () => {
  // 确定性注入：第一次尝试 spawn 之前，把分配到的端口用另一个 HTTP 服务占住，
  // 子进程 listen() 必然 EADDRINUSE 退出；起动器必须换端口重试而不是把失败当成功。
  const blocker = http.createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"ok":false,"blocker":true}');
  });
  const attempts = [];
  let server = null;
  try {
    server = await startServer({
      env: { AUTH_ENABLED: '0' },
      healthAttempts: 100,
      healthIntervalMs: 50,
      onAttempt: async ({ attempt, port }) => {
        attempts.push(port);
        if (attempt > 0) return;
        await new Promise((resolve, reject) => {
          blocker.once('error', reject);
          blocker.listen(port, '127.0.0.1', resolve);
        });
      },
    });

    assert.equal(attempts.length, 2, `应重试一次，实际尝试端口：${attempts.join(',')}`);
    assert.equal(server.attempts, 2);
    assert.notEqual(server.port, attempts[0], '重试必须换到新端口');
    assert.equal(server.port, attempts[1]);

    const health = await fetch(`${server.base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    assert.equal(server.exitCode, null, '成功启动的应该是存活的子进程');
  } finally {
    if (server) await server.stop();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('startServer 重试耗尽后抛出最后一次启动日志', async () => {
  // 每次尝试都占住当次分配到的端口，直到重试次数用尽。
  const blockers = [];
  try {
    await assert.rejects(
      startServer({
        attempts: 2,
        healthAttempts: 3,
        healthIntervalMs: 20,
        env: { AUTH_ENABLED: '0' },
        onAttempt: async ({ port }) => {
          const blocker = http.createServer((req, res) => {
            res.writeHead(503);
            res.end();
          });
          blockers.push(blocker);
          await new Promise((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(port, '127.0.0.1', resolve);
          });
        },
      }),
      /测试服务未能启动/
    );
    assert.equal(blockers.length, 2, '两次尝试都应在 spawn 前被注入端口占用');
  } finally {
    for (const blocker of blockers) await new Promise((resolve) => blocker.close(resolve));
  }
});

test('startServer 的 stop() 结束子进程并清掉临时库', async () => {
  const server = await startServer({ env: { AUTH_ENABLED: '0' } });
  const dbPath = server.dbPath;
  assert.equal(server.exitCode, null);
  assert.equal(fs.existsSync(dbPath), true);
  await server.stop();
  assert.notEqual(server.exitCode, null, 'stop() 之后子进程应已退出');
  assert.equal(fs.existsSync(dbPath), false, 'stop() 应清理临时数据库');
  assert.equal(fs.existsSync(path.join(leaseDir(), `${server.port}.json`)), false, 'stop() 应释放端口租约');
});
