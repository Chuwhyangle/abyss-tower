// HTTP 层加固验收：路径穿越、超长路径、超大请求体、未知 MIME、未登录 401。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { StaticFiles } from '../server/http/static.mjs';
import { MAX_BODY_BYTES, SECURITY_HEADERS, fail } from '../server/http/respond.mjs';
import { registerAndLogin, startTestServer } from './harness.mjs';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtd-http-'));
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>ok</title>');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(publicDir, 'blob.xyz'), 'opaque-bytes');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP_SECRET');
  return { root, publicDir };
}

function startStaticServer(rootDir) {
  const files = new StaticFiles(rootDir);
  const server = http.createServer((req, res) => {
    // 直接把原始路径交给 StaticFiles：URL 构造器会预先归一化 `..`，就测不到加固逻辑了。
    files.serve(req, res, req.url.split('?')[0]);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: rawPath, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function assertNoLeak(body) {
  assert.ok(!body.includes('TOP_SECRET'), '穿越请求泄露了根目录外的文件内容');
  assert.ok(!/\/(home|tmp|etc)\//.test(body), `错误响应泄露了文件系统路径：${body}`);
  assert.ok(!/\n\s+at /.test(body), `错误响应泄露了堆栈：${body}`);
}

test('静态资源：正常文件与未知扩展名', async (t) => {
  const { root, publicDir } = makeFixture();
  const { server, port } = await startStaticServer(publicDir);
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const js = await get(port, '/app.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.body, 'console.log(1)');

  const unknown = await get(port, '/blob.xyz');
  assert.equal(unknown.status, 200);
  assert.equal(unknown.headers['content-type'], 'application/octet-stream');
  assert.equal(unknown.body, 'opaque-bytes');
});

test('静态资源：目录穿越、空字节与超长路径都被拒绝', async (t) => {
  const { root, publicDir } = makeFixture();
  const { server, port } = await startStaticServer(publicDir);
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const rawPath of [
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/%2e%2e/etc/passwd',
  ]) {
    const response = await get(port, rawPath);
    assert.ok(
      response.status === 400 || response.status === 404,
      `${rawPath} 应返回 400/404，实际 ${response.status}`
    );
    assertNoLeak(response.body);
  }

  const nul = await get(port, '/%00');
  assert.equal(nul.status, 404);
  assertNoLeak(nul.body);

  const longPath = await get(port, `/${'a'.repeat(2000)}`);
  assert.equal(longPath.status, 404);
  assertNoLeak(longPath.body);
});

test('静态资源：缺失资源 404，未知路由回退 index.html', async (t) => {
  const { root, publicDir } = makeFixture();
  const { server, port } = await startStaticServer(publicDir);
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const missingAsset = await get(port, '/missing.js');
  assert.equal(missingAsset.status, 404);
  assertNoLeak(missingAsset.body);

  const spa = await get(port, '/some/route');
  assert.equal(spa.status, 200);
  assert.match(spa.headers['content-type'], /text\/html/);
});

test('fail 输出统一错误结构且带安全头', () => {
  const res = {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };

  fail(res, 413, '请求体过大');
  assert.equal(res.statusCode, 413);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(res.headers[name], value);
  }
  const data = JSON.parse(res.body);
  assert.deepEqual(Object.keys(data).sort(), ['code', 'error']);
  assert.equal(data.error, '请求体过大');
  assert.equal(data.code, 'PAYLOAD_TOO_LARGE');
});

test('HTTP 服务：未登录 401、超大请求体 413', async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const unauthorized = await fetch(`${server.base}/api/profile`);
  assert.equal(unauthorized.status, 401);
  const unauthorizedBody = await unauthorized.text();
  assert.equal(JSON.parse(unauthorizedBody).code, 'AUTH_REQUIRED');
  assertNoLeak(unauthorizedBody);

  // 编码后的分隔符不会被 URL 归一化，会一路到达 StaticFiles。
  const traversal = await get(Number(new URL(server.base).port), '/..%2f..%2fetc%2fpasswd');
  assert.ok(traversal.status === 400 || traversal.status === 404, `穿越返回 ${traversal.status}`);
  assertNoLeak(traversal.body);

  const session = await registerAndLogin(server.base);
  const oversized = JSON.stringify({ name: 'x'.repeat(MAX_BODY_BYTES + 1024) });
  const response = await fetch(`${server.base}/api/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${session.cookie.name}=${session.cookie.value}`,
    },
    body: oversized,
  });
  assert.equal(response.status, 413);
  const body = await response.text();
  assert.equal(JSON.parse(body).code, 'PAYLOAD_TOO_LARGE');
  assertNoLeak(body);
});
