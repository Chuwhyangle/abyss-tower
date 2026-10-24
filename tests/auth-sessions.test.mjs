// 账号会话管理：会话列表、退出其他设备、当前会话保留、未登录拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, registerAndLogin } from './harness.mjs';
import { passwordStrength } from '../public/js/auth-ui.js';

async function api(base, pathname, { method = 'GET', body, cookie, ip } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return {
    status: response.status,
    data,
    setCookie: response.headers.getSetCookie?.() || [],
  };
}

async function withServer(fn) {
  const server = await startTestServer();
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

function cookieFrom(response) {
  return (response.setCookie[0] || '').split(';')[0];
}

test('会话列表只含本人，撤销其他设备后当前会话保留', async () => {
  await withServer(async (server) => {
    const alice = await registerAndLogin(server.base);

    // 第二个设备：不带 Cookie 重新登录，服务端不会吊销任何已有会话。
    const second = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username: alice.username, password: alice.password },
      ip: '203.0.113.9',
    });
    assert.equal(second.status, 200);
    const secondCookie = cookieFrom(second);
    assert.ok(secondCookie);

    const bob = await registerAndLogin(server.base);

    const aliceList = await api(server.base, '/api/auth/sessions', {
      cookie: alice.rawCookie,
    });
    assert.equal(aliceList.status, 200);
    assert.equal(aliceList.data.sessions.length, 2, '只包含 Alice 自己的两个会话');
    assert.equal(
      aliceList.data.sessions.filter((item) => item.current).length,
      1,
      '恰好一个当前会话'
    );
    assert.equal(
      aliceList.data.sessions.find((item) => item.current).id,
      aliceList.data.currentSessionId
    );

    const bobList = await api(server.base, '/api/auth/sessions', {
      cookie: bob.rawCookie,
    });
    assert.equal(bobList.status, 200);
    assert.equal(bobList.data.sessions.length, 1, 'Bob 看不到 Alice 的会话');
    assert.notEqual(bobList.data.currentSessionId, aliceList.data.currentSessionId);

    // 两个会话都能正常鉴权，随后撤销其他设备。
    assert.equal(
      (await api(server.base, '/api/auth/me', { cookie: secondCookie })).status,
      200
    );
    const revoked = await api(server.base, '/api/auth/sessions/revoke-others', {
      method: 'POST',
      body: {},
      cookie: alice.rawCookie,
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.data.revoked, 1);

    assert.equal(
      (await api(server.base, '/api/auth/me', { cookie: secondCookie })).status,
      401,
      '被撤销的会话立即失效'
    );
    assert.equal(
      (await api(server.base, '/api/auth/me', { cookie: alice.rawCookie })).status,
      200,
      '当前会话保留'
    );

    const afterList = await api(server.base, '/api/auth/sessions', {
      cookie: alice.rawCookie,
    });
    assert.equal(afterList.status, 200);
    assert.equal(afterList.data.sessions.length, 1);
    assert.equal(afterList.data.sessions[0].current, true);
  });
});

test('IP 只以哈希形式返回，未登录不能访问会话接口', async () => {
  await withServer(async (server) => {
    const rawIp = '198.51.100.7';
    const registered = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username: `ip${Date.now().toString(36).slice(-10)}`, password: 'rtd-test-password' },
      ip: rawIp,
    });
    assert.equal(registered.status, 201);
    const cookie = cookieFrom(registered);

    const list = await api(server.base, '/api/auth/sessions', { cookie });
    assert.equal(list.status, 200);
    const [session] = list.data.sessions;
    assert.match(session.ipHash, /^[a-f0-9]{64}$/);
    assert.notEqual(session.ipHash, rawIp);
    assert.equal(JSON.stringify(list.data).includes(rawIp), false, '响应中不含原始 IP');

    const anonymousList = await api(server.base, '/api/auth/sessions');
    assert.equal(anonymousList.status, 401);
    assert.equal(anonymousList.data.code, 'AUTH_REQUIRED');

    const anonymousRevoke = await api(server.base, '/api/auth/sessions/revoke-others', {
      method: 'POST',
      body: {},
    });
    assert.equal(anonymousRevoke.status, 401);
    assert.equal(anonymousRevoke.data.code, 'AUTH_REQUIRED');
  });
});

test('密码强度提示分级且不替代服务端校验', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.equal(passwordStrength('short').score, 0);
  assert.equal(passwordStrength('abcdefgh').score, 1);
  assert.equal(passwordStrength('Abcdefgh123!').score, 4);
  assert.equal(passwordStrength('Abcdefgh123!').tone, 'strong');
});
