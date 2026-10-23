// 隐私合规：数据导出与账号删除（软删除、冷却期、取消与到期清理）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { startTestServer, registerAndLogin } from './harness.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

async function api(base, pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

async function withServer(fn) {
  const server = await startTestServer();
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

test('导出只包含本人数据，且不含密码哈希或恢复码的可逆形式', async () => {
  await withServer(async (server) => {
    const alice = await registerAndLogin(server.base);
    const bob = await registerAndLogin(server.base);

    const aliceRun = await api(server.base, '/api/runs', {
      method: 'POST',
      body: { mode: 'normal', difficulty: 'standard' },
      cookie: alice.rawCookie,
    });
    const bobRun = await api(server.base, '/api/runs', {
      method: 'POST',
      body: { mode: 'normal', difficulty: 'standard' },
      cookie: bob.rawCookie,
    });
    assert.equal(aliceRun.status, 200);
    assert.equal(bobRun.status, 200);

    const exported = await api(server.base, '/api/profile/export', {
      cookie: alice.rawCookie,
    });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.account.id, alice.data.account.id);
    assert.equal(exported.data.profile.name, alice.username);
    assert.ok(Array.isArray(exported.data.progress));
    assert.ok(exported.data.profile.stats);

    const runIds = exported.data.runs.map((run) => run.id);
    assert.ok(runIds.includes(aliceRun.data.runId), '应包含本人的对局');
    assert.ok(!runIds.includes(bobRun.data.runId), '不得包含他人的对局');

    const text = JSON.stringify(exported.data);
    assert.ok(!text.includes(bob.data.account.id), '不得包含他人的账号 id');
    assert.doesNotMatch(text, /password_hash|recovery_hash|passwordHash|recoveryHash/i);
    assert.doesNotMatch(text, /scrypt\$/i);
  });
});

test('删除需要 confirm=DELETE，删除后会话失效、登录被拒，冷却期内可取消', async () => {
  await withServer(async (server) => {
    const session = await registerAndLogin(server.base);

    const unconfirmed = await api(server.base, '/api/profile', {
      method: 'DELETE',
      body: {},
      cookie: session.rawCookie,
    });
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.data.code, 'CONFIRMATION_REQUIRED');

    const wrongConfirm = await api(server.base, '/api/profile', {
      method: 'DELETE',
      body: { confirm: 'delete' },
      cookie: session.rawCookie,
    });
    assert.equal(wrongConfirm.status, 400);

    const stillActive = await api(server.base, '/api/profile', {
      cookie: session.rawCookie,
    });
    assert.equal(stillActive.status, 200, '未确认时账号不应被删除');

    const removed = await api(server.base, '/api/profile', {
      method: 'DELETE',
      body: { confirm: 'DELETE' },
      cookie: session.rawCookie,
    });
    assert.equal(removed.status, 200);
    assert.equal(
      removed.data.deletion.dueAt - removed.data.deletion.requestedAt,
      7 * DAY_MS,
      '默认冷却期为 7 天'
    );

    const afterDelete = await api(server.base, '/api/profile', {
      cookie: session.rawCookie,
    });
    assert.equal(afterDelete.status, 401, '删除后旧会话必须失效');

    const blockedLogin = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username: session.username, password: session.password },
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal(blockedLogin.data.code, 'DELETION_PENDING');
    assert.ok(blockedLogin.data.deletionDueAt > Date.now());

    const audit = new DatabaseSync(server.dbPath);
    try {
      audit.exec('PRAGMA busy_timeout = 2000');
      const row = audit
        .prepare(
          "SELECT event FROM auth_events WHERE event = 'deletion_request' ORDER BY created_at DESC LIMIT 1"
        )
        .get();
      assert.equal(row?.event, 'deletion_request', '删除请求必须留下审计事件');
    } finally {
      audit.close();
    }

    const badCancel = await api(server.base, '/api/auth/cancel-deletion', {
      method: 'POST',
      body: { username: session.username, password: 'wrong-password' },
    });
    assert.equal(badCancel.status, 401);

    const cancelled = await api(server.base, '/api/auth/cancel-deletion', {
      method: 'POST',
      body: { username: session.username, password: session.password },
    });
    assert.equal(cancelled.status, 200);
    const newCookie = (cancelled.headers.getSetCookie?.() || [])[0]?.split(';')[0] || '';
    assert.ok(newCookie, '取消删除后应重新签发会话');

    const restored = await api(server.base, '/api/profile', { cookie: newCookie });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.profile.name, session.username);

    const relogin = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username: session.username, password: session.password },
    });
    assert.equal(relogin.status, 200, '取消删除后应可正常登录');
  });
});

test('软删除冷却期可取消，到期后彻底清理账号', async () => {
  const dbPath = path.join(os.tmpdir(), `rtd-privacy-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  const accounts = await import('../server/db/accounts.mjs');
  const sessions = await import('../server/db/sessions.mjs');
  const { db } = await import('../server/db/index.mjs');
  try {
    const account = accounts.createAccount({
      kind: 'registered',
      username: 'privacyuser',
      passwordHash: 'scrypt$fake',
      recoveryHash: 'scrypt$fake',
    });
    const session = sessions.createSession(account.id);
    assert.ok(sessions.findSessionByToken(session.token));

    const now = Date.now();
    const soft = accounts.softDeleteAccount(account.id, now);
    assert.equal(soft.account.status, 'deleted');
    assert.equal(soft.deletion.dueAt, now + accounts.DELETION_COOLDOWN_MS);
    assert.equal(accounts.getAccountDeletion(account.id).dueAt, soft.deletion.dueAt);
    assert.equal(sessions.findSessionByToken(session.token), null, '软删除后会话失效');

    const cancelled = accounts.cancelAccountDeletion(account.id, now + DAY_MS);
    assert.equal(cancelled.status, 'active');
    assert.equal(accounts.getAccountDeletion(account.id), null);

    accounts.softDeleteAccount(account.id, now - 8 * DAY_MS);
    const purged = accounts.purgeDueDeletions(now);
    assert.deepEqual(purged, [account.id]);
    assert.equal(accounts.findAccountById(account.id), null, '到期后应彻底删除账号');
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
    delete process.env.DB_PATH;
  }
});
