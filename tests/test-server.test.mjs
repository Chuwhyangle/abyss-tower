// 测试服务器运行时：端口分配（内核分配 + 租约）与启动就绪校验。
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
