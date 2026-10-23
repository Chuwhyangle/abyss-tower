// 安全基线验收：统一安全响应头、分动作限流分桶、429 带 Retry-After。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { SECURITY_HEADERS } from '../server/http/respond.mjs';
import { registerAndLogin, startTestServer } from './harness.mjs';

const TMP_DB = path.join(os.tmpdir(), `rtd-security-${process.pid}-${Date.now()}.db`);

let rateLimit = null;
let server = null;

before(async () => {
  // 限流模块在导入时打开数据库，先指向临时库，避免污染开发数据。
  process.env.DB_PATH = TMP_DB;
  process.env.DB_BACKUP = '0';
  rateLimit = await import('../server/auth/rate-limit.mjs');
  server = await startTestServer();
});

after(async () => {
  await server?.stop();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${TMP_DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function post(pathname, body, cookie) {
  return fetch(`${server.base}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('安全响应头：API 与静态资源都带统一安全头', async () => {
  for (const pathname of ['/api/health', '/']) {
    const response = await fetch(`${server.base}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', pathname);
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN', pathname);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', pathname);
    const csp = response.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/, `${pathname} 缺少 CSP default-src`);
    assert.match(csp, /script-src [^;]*'self'/, `${pathname} CSP 脚本来源应仅限 self`);
    assert.match(csp, /style-src [^;]*'unsafe-inline'/, `${pathname} CSP 需允许内联样式`);
    assert.doesNotMatch(csp, /unsafe-eval/, `${pathname} CSP 不应放开 unsafe-eval`);
  }
  // 常量与下发值一致，避免两处定义漂移。
  assert.equal(SECURITY_HEADERS['x-content-type-options'], 'nosniff');
});

test('限流分桶：共享失败计数，阈值与动作互相独立', () => {
  const ipHash = 'a'.repeat(64);
  const otherIp = 'b'.repeat(64);
  const accountId = 'acct-bucket-skill';
  const max = rateLimit.RATE_LIMITS['skill-upgrade'].maxPerAccount;

  for (let i = 0; i < max; i++) {
    rateLimit.recordRateLimitFailure('skill-upgrade', { accountId, ipHash });
  }

  const skill = rateLimit.actionRateLimited('skill-upgrade', { accountId, ipHash });
  assert.equal(skill.limited, true);
  assert.ok(skill.retryAfterSeconds > 0);

  // 同一账号的其它动作不受技能升级桶影响。
  assert.equal(rateLimit.actionRateLimited('run-create', { accountId, ipHash }).limited, false);
  assert.equal(
    rateLimit.actionRateLimited('login', { usernameNorm: 'bucket-user', ipHash }).limited,
    false
  );

  // 同一动作的其它账号/IP 不受影响。
  assert.equal(
    rateLimit.actionRateLimited('skill-upgrade', { accountId: 'another-account', ipHash: otherIp })
      .limited,
    false
  );
});

test('接口限流：技能升级超限 429 带 Retry-After，且不影响开局分桶', async () => {
  const session = await registerAndLogin(server.base);
  const max = rateLimit.RATE_LIMITS['skill-upgrade'].maxPerAccount;

  for (let i = 0; i < max; i++) {
    const response = await post('/api/skills/upgrade', { skillId: 'not-a-skill' }, session.rawCookie);
    assert.equal(response.status, 400, `第 ${i + 1} 次失败应被记录而不是直接限流`);
  }

  const limited = await post(
    '/api/skills/upgrade',
    { skillId: 'not-a-skill' },
    session.rawCookie
  );
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0, '429 必须带 Retry-After');

  // 分桶独立：技能升级被限流时，同一账号仍能正常开局。
  const created = await post('/api/runs', { mode: 'normal', difficulty: 'standard' }, session.rawCookie);
  assert.equal(created.status, 200);

  // 反向验证：开局失败累计到自己的阈值后才返回 429。
  const runMax = rateLimit.RATE_LIMITS['run-create'].maxPerAccount;
  for (let i = 0; i < runMax; i++) {
    const response = await post('/api/runs', { skillId: 'not-a-skill' }, session.rawCookie);
    assert.equal(response.status, 400, `第 ${i + 1} 次开局失败应被记录`);
  }
  const runLimited = await post('/api/runs', { mode: 'normal' }, session.rawCookie);
  assert.equal(runLimited.status, 429);
  assert.ok(Number(runLimited.headers.get('retry-after')) > 0, '429 必须带 Retry-After');
});
