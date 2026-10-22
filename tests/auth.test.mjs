// 账号体系接口测试：注册/登录/会话/限流/CSRF/旧令牌绑定/回退模式。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { startTestServer, registerAndLogin, testUsername } from './harness.mjs';

async function api(base, pathname, { method = 'GET', body, cookie, token, origin, ip } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { 'x-player-token': token } : {}),
      ...(origin ? { origin } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return {
    status: response.status,
    data,
    setCookie: response.headers.getSetCookie?.() || [],
    headers: response.headers,
  };
}

async function withServer(fn, options = {}) {
  const server = await startTestServer(options);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

test('未登录只能访问公开接口，游戏接口一律 401', async () => {
  await withServer(async (server) => {
    const health = await api(server.base, '/api/health');
    assert.equal(health.status, 200);

    const config = await api(server.base, '/api/config');
    assert.equal(config.status, 200);
    assert.equal(config.data.authEnabled, true);
    assert.equal(config.data.registrationMode, 'open');

    for (const [pathname, method] of [
      ['/api/profile', 'GET'],
      ['/api/leaderboard?mode=normal', 'GET'],
      ['/api/runs', 'POST'],
      ['/api/runs/active', 'GET'],
    ]) {
      const response = await api(server.base, pathname, {
        method,
        body: method === 'POST' ? {} : undefined,
      });
      assert.equal(response.status, 401, pathname);
      assert.equal(response.data.code, 'AUTH_REQUIRED', pathname);
    }

    const me = await api(server.base, '/api/auth/me');
    assert.equal(me.status, 401);
    assert.equal(me.data.code, 'AUTH_REQUIRED');

    const index = await fetch(`${server.base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /渊洲守卫|渊塔守卫/);
  });
});

test('注册、会话、改名、登出与重新登录', async () => {
  await withServer(async (server) => {
    const username = testUsername('reg');
    const password = 'rtd-test-password';
    const registered = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username, password },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.data.account.kind, 'registered');
    assert.equal(registered.data.profile.username, username);
    assert.match(registered.data.recoveryCode, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){7}$/);
    const setCookie = registered.setCookie[0] || '';
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/);
    const cookie = setCookie.split(';')[0];

    const me = await api(server.base, '/api/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.profile.name, username);
    assert.equal(me.data.profile.cores, 0);
    assert.equal(me.data.profile.stats.runs, 0);

    const renamed = await api(server.base, '/api/session', {
      method: 'POST',
      body: { name: '测试指挥官' },
      cookie,
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.profile.name, '测试指挥官');

    const logout = await api(server.base, '/api/auth/logout', {
      method: 'POST',
      body: {},
      cookie,
    });
    assert.equal(logout.status, 204);

    const afterLogout = await api(server.base, '/api/auth/me', { cookie });
    assert.equal(afterLogout.status, 401);

    const wrong = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username, password: 'wrong-password' },
    });
    assert.equal(wrong.status, 401);

    const login = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    assert.equal(login.status, 200);
    const newCookie = (login.setCookie[0] || '').split(';')[0];
    const meAgain = await api(server.base, '/api/auth/me', { cookie: newCookie });
    assert.equal(meAgain.status, 200);
    assert.equal(meAgain.data.profile.name, '测试指挥官');
  });
});

test('注册校验、重复用户名与 Origin 校验', async () => {
  await withServer(async (server) => {
    const badName = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'a', password: 'rtd-test-password' },
    });
    assert.equal(badName.status, 400);

    const badPassword = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username: testUsername('pw'), password: 'short' },
    });
    assert.equal(badPassword.status, 400);

    const username = testUsername('dup');
    const first = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username, password: 'rtd-test-password' },
    });
    assert.equal(first.status, 201);
    const duplicate = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username, password: 'rtd-test-password' },
    });
    assert.equal(duplicate.status, 409);

    const cookie = (first.setCookie[0] || '').split(';')[0];
    const badOrigin = await api(server.base, '/api/runs', {
      method: 'POST',
      body: { mode: 'normal', difficulty: 'standard' },
      cookie,
      origin: 'https://evil.example',
    });
    assert.equal(badOrigin.status, 403);

    const crossSite = await api(server.base, '/api/runs', {
      method: 'POST',
      body: { mode: 'normal', difficulty: 'standard' },
      cookie,
      origin: server.base,
      ip: '203.0.113.10',
    });
    // Origin 与 Host 同源时允许（Node fetch 的 Host 是 127.0.0.1:port）。
    assert.notEqual(crossSite.status, 403);
  });
});

test('登录失败限流返回 429 与 Retry-After', async () => {
  await withServer(async (server) => {
    const session = await registerAndLogin(server.base);
    await api(server.base, '/api/auth/logout', {
      method: 'POST',
      body: {},
      cookie: session.rawCookie,
    });
    for (let i = 0; i < 5; i++) {
      const response = await api(server.base, '/api/auth/login', {
        method: 'POST',
        body: { username: session.username, password: 'wrong-password' },
      });
      assert.equal(response.status, 401, `第 ${i + 1} 次失败`);
    }
    const limited = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username: session.username, password: session.password },
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

test('跨账号对局隔离与跨设备续玩', async () => {
  await withServer(async (server) => {
    const first = await registerAndLogin(server.base);
    const second = await registerAndLogin(server.base);
    const started = await api(server.base, '/api/runs', {
      method: 'POST',
      body: { mode: 'normal', difficulty: 'standard' },
      cookie: first.rawCookie,
    });
    assert.equal(started.status, 200);
    const runId = started.data.runId;

    const foreign = await api(server.base, `/api/runs/${runId}`, {
      cookie: second.rawCookie,
    });
    assert.equal(foreign.status, 404);

    const active = await api(server.base, '/api/runs/active', {
      cookie: first.rawCookie,
    });
    assert.equal(active.status, 200);
    assert.equal(active.data.run.id, runId);

    const none = await api(server.base, '/api/runs/active', {
      cookie: second.rawCookie,
    });
    assert.equal(none.status, 200);
    assert.equal(none.data.run, null);
  });
});

test('恢复码找回密码并轮换恢复码', async () => {
  await withServer(async (server) => {
    const username = testUsername('rec');
    const password = 'rtd-test-password';
    const registered = await api(server.base, '/api/auth/register', {
      method: 'POST',
      body: { username, password },
    });
    assert.equal(registered.status, 201);
    const recoveryCode = registered.data.recoveryCode;

    const wrong = await api(server.base, '/api/auth/recovery', {
      method: 'POST',
      body: { username, recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH', newPassword: 'new-password-123' },
    });
    assert.equal(wrong.status, 401);

    const recovered = await api(server.base, '/api/auth/recovery', {
      method: 'POST',
      body: { username, recoveryCode, newPassword: 'new-password-123' },
    });
    assert.equal(recovered.status, 200);
    assert.ok(recovered.data.recoveryCode);
    assert.notEqual(recovered.data.recoveryCode, recoveryCode);

    const oldLogin = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username, password: 'new-password-123' },
    });
    assert.equal(newLogin.status, 200);
  });
});

test('旧匿名令牌：迁移为 unclaimed，绑定后进度与榜单保留', async () => {
  const dbPath = path.join(os.tmpdir(), `rtd-auth-legacy-${process.pid}-${Date.now()}.db`);
  const legacy = new DatabaseSync(dbPath);
  const token = 'legacy-token-0001';
  const now = Date.now();
  legacy.exec(`
    CREATE TABLE profiles (
      token TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cores INTEGER NOT NULL DEFAULT 0,
      unlocks TEXT NOT NULL DEFAULT '[]',
      stats TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'standard',
      seed TEXT NOT NULL,
      day TEXT NOT NULL,
      waves_served INTEGER NOT NULL DEFAULT 0,
      cleared_waves INTEGER NOT NULL DEFAULT 0,
      map_choice INTEGER NOT NULL DEFAULT -1,
      relics TEXT NOT NULL DEFAULT '[]',
      offers TEXT NOT NULL DEFAULT '{}',
      rerolls_used INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      victory INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      wave_reached INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE TABLE leaderboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'standard',
      day TEXT NOT NULL,
      seed TEXT NOT NULL,
      wave INTEGER NOT NULL,
      score INTEGER NOT NULL,
      kills INTEGER NOT NULL,
      victory INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  legacy
    .prepare('INSERT INTO profiles (token, name, cores, unlocks, stats, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      token,
      '老指挥官',
      321,
      JSON.stringify(['arc', 'poison']),
      JSON.stringify({
        runs: 7,
        kills: 1234,
        wins: 2,
        byDifficulty: {
          standard: { bestWave: 18, bestScore: 9000, wins: 1, runs: 4 },
        },
      }),
      now,
      now
    );
  legacy
    .prepare(
      `INSERT INTO runs
         (id, token, mode, difficulty, seed, day, waves_served, cleared_waves, map_choice,
          relics, offers, rerolls_used, status, victory, score, wave_reached, kills, duration_ms, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'legacy-run-1',
      token,
      'normal',
      'standard',
      'legacy-seed',
      '2026-10-20',
      12,
      12,
      0,
      '[]',
      '{}',
      0,
      'finished',
      0,
      5000,
      12,
      300,
      600000,
      now,
      now
    );
  legacy
    .prepare(
      `INSERT INTO leaderboard
         (token, name, mode, difficulty, day, seed, wave, score, kills, victory, duration_ms, created_at)
       VALUES (?, ?, 'normal', 'standard', ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(token, '老指挥官', '2026-10-20', 'legacy-seed', 12, 5000, 300, 600000, now);
  legacy.close();

  try {
    await withServer(async (server) => {
      const legacyStatus = await api(server.base, '/api/auth/legacy', { token });
      assert.equal(legacyStatus.status, 200);
      assert.equal(legacyStatus.data.claimable, true);
      assert.equal(legacyStatus.data.displayName, '老指挥官');
      assert.equal(legacyStatus.data.summary.cores, 321);
      assert.equal(legacyStatus.data.summary.runs, 7);

      const blocked = await api(server.base, '/api/runs', {
        method: 'POST',
        body: { mode: 'normal', difficulty: 'standard' },
        token,
      });
      assert.equal(blocked.status, 401);
      assert.equal(blocked.data.code, 'AUTH_REQUIRED');

      const username = testUsername('claim');
      const claimed = await api(server.base, '/api/auth/claim', {
        method: 'POST',
        token,
        body: { username, password: 'rtd-test-password' },
      });
      assert.equal(claimed.status, 200);
      const cookie = (claimed.setCookie[0] || '').split(';')[0];
      assert.equal(claimed.data.profile.cores, 321);
      assert.deepEqual(claimed.data.profile.unlocks.sort(), ['arc', 'poison']);
      assert.equal(claimed.data.profile.stats.byDifficulty.standard.bestWave, 18);
      assert.equal(claimed.data.account.kind, 'registered');

      const board = await api(server.base, '/api/leaderboard?mode=normal', { cookie });
      assert.equal(board.status, 200);
      const row = board.data.entries.find((entry) => entry.name === '老指挥官');
      assert.ok(row, '绑定后旧榜单条目应可见');
      assert.equal(row.score, 5000);

      const run = await api(server.base, '/api/runs/legacy-run-1', { cookie });
      assert.equal(run.status, 200);
      assert.equal(run.data.run.clearedWaves, 12);
      assert.equal(run.data.run.status, 'finished');

      const aliasGone = await api(server.base, '/api/auth/legacy', { token });
      assert.equal(aliasGone.status, 404);
    }, { dbPath });
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
});

test('AUTH_ENABLED=0 回退旧匿名令牌模式', async () => {
  await withServer(
    async (server) => {
      const config = await api(server.base, '/api/config');
      assert.equal(config.data.authEnabled, false);

      const token = 'fallback-token-0001';
      const session = await api(server.base, '/api/session', {
        method: 'POST',
        body: {},
        token,
      });
      assert.equal(session.status, 200);
      assert.equal(session.data.profile.unlocks.length, 0);

      const started = await api(server.base, '/api/runs', {
        method: 'POST',
        body: { mode: 'normal', difficulty: 'standard' },
        token,
      });
      assert.equal(started.status, 200);
      assert.ok(started.data.runId);

      const register = await api(server.base, '/api/auth/register', {
        method: 'POST',
        body: { username: testUsername('off'), password: 'rtd-test-password' },
      });
      assert.equal(register.status, 404);
    },
    { env: { AUTH_ENABLED: '0' } }
  );
});
