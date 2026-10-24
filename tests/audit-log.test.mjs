// 敏感操作审计：写入、只读本人、meta 脱敏、写入失败不阻塞主流程，以及接口集成。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startTestServer, registerAndLogin } from './harness.mjs';

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
const DB_PATH = path.join(os.tmpdir(), `rtd-audit-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let db = null;
let accounts = null;
let audit = null;
let leaderboard = null;
let RouteTable = null;
let ProfileRoutes = null;

const suffix = Date.now().toString(36);

function makeAccount(name) {
  return accounts.createAccount({
    kind: 'registered',
    username: `${name}${suffix}`,
    passwordHash: 'audit-test-password',
  }).id;
}

function shiftSeason(season, delta) {
  const [year, month] = season.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addEntry(accountId, season, score) {
  const bounds = leaderboard.seasonBounds(season);
  db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES ('normal', ?, 'tester', NULL, 'standard', ?, 60000, 'v1.4-map2', '{}', ?)`
  ).run(accountId, score, bounds.start + 12 * 60 * 60 * 1000);
}

async function callAuditRoute(token) {
  const table = new RouteTable();
  new ProfileRoutes().register(table);
  const captured = {};
  const ctx = {
    token,
    pathname: '/api/profile/audit',
    method: 'GET',
    json(status, data) {
      captured.status = status;
      captured.data = data;
      return true;
    },
  };
  const handled = await table.dispatch(ctx);
  return { handled, ...captured };
}

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
  return { status: response.status, data, setCookie: response.headers.getSetCookie?.() || [] };
}

before(async () => {
  ({ db } = await import('../server/db/index.mjs'));
  accounts = await import('../server/db/accounts.mjs');
  audit = await import('../server/db/audit.mjs');
  leaderboard = await import('../server/db/leaderboard.mjs');
  ({ RouteTable } = await import('../server/routes/router.mjs'));
  ({ ProfileRoutes } = await import('../server/routes/profile.mjs'));
});

after(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  for (const part of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB_PATH}${part}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('action 枚举集中定义且不可修改', () => {
  assert.ok(Object.isFrozen(audit.AUDIT_ACTIONS));
  assert.deepEqual(Object.values(audit.AUDIT_ACTIONS).sort(), [
    'account_delete',
    'password_change',
    'season_settle',
    'sessions_revoke_others',
  ]);
  for (const action of Object.values(audit.AUDIT_ACTIONS)) {
    assert.equal(audit.isAuditAction(action), true);
  }
  assert.equal(audit.isAuditAction('unknown_action'), false);
});

test('写入审计后只能读取本人记录，且按时间倒序', () => {
  const alice = makeAccount('alice');
  const bob = makeAccount('bob');

  assert.equal(
    audit.recordAudit(alice, audit.AUDIT_ACTIONS.PASSWORD_CHANGE, {}, 1000),
    true
  );
  assert.equal(
    audit.recordAudit(alice, audit.AUDIT_ACTIONS.SESSIONS_REVOKE_OTHERS, { revoked: 2 }, 2000),
    true
  );
  assert.equal(
    audit.recordAudit(bob, audit.AUDIT_ACTIONS.ACCOUNT_DELETE, {}, 1500),
    true
  );

  const aliceRows = audit.listAuditForAccount(alice);
  assert.deepEqual(
    aliceRows.map((row) => row.action),
    ['sessions_revoke_others', 'password_change'],
    '本人记录按时间倒序'
  );
  assert.deepEqual(aliceRows[0].meta, { revoked: 2 });

  const bobRows = audit.listAuditForAccount(bob);
  assert.equal(bobRows.length, 1);
  assert.equal(bobRows[0].action, 'account_delete', '看不到别人的审计');
});

test('meta 中的密码哈希与 token 在落库和读取时都被脱敏', () => {
  const accountId = makeAccount('redact');
  audit.recordAudit(accountId, audit.AUDIT_ACTIONS.PASSWORD_CHANGE, {
    password: 'hunter2-plain',
    passwordHash: 'deadbeefhash',
    token: 'session-token-value',
    recoveryCode: 'recovery-value',
    nested: { sessionToken: 'nested-token', note: 'keep-me' },
  });

  const stored = db
    .prepare('SELECT meta_json FROM audit_log WHERE account_id = ?')
    .get(accountId);
  for (const secret of [
    'hunter2-plain',
    'deadbeefhash',
    'session-token-value',
    'recovery-value',
    'nested-token',
  ]) {
    assert.ok(!stored.meta_json.includes(secret), `落库内容不应包含 ${secret}`);
  }

  const [row] = audit.listAuditForAccount(accountId);
  const serialized = JSON.stringify(row);
  for (const secret of [
    'hunter2-plain',
    'deadbeefhash',
    'session-token-value',
    'recovery-value',
    'nested-token',
  ]) {
    assert.ok(!serialized.includes(secret), `响应不应包含 ${secret}`);
  }
  assert.equal(row.meta.nested.note, 'keep-me', '非敏感字段保留');
});

test('审计写入失败可见但不阻塞赛季结算主流程', () => {
  const player = makeAccount('settle');
  const season = shiftSeason(leaderboard.seasonOf(Date.now()), -8);
  addEntry(player, season, 4321);

  const originalPrepare = db.prepare;
  const errors = [];
  const originalError = console.error;
  db.prepare = function patchedPrepare(sql) {
    if (/INSERT INTO audit_log/i.test(String(sql))) throw new Error('audit unavailable');
    return originalPrepare.call(db, sql);
  };
  console.error = (...args) => errors.push(args.map(String).join(' '));

  let result;
  try {
    assert.doesNotThrow(() => {
      const ok = audit.recordAudit(player, audit.AUDIT_ACTIONS.SEASON_SETTLE, {});
      assert.equal(ok, false, '写入失败返回 false');
    });
    result = leaderboard.settleSeason(season);
  } finally {
    db.prepare = originalPrepare;
    console.error = originalError;
  }

  assert.equal(result.alreadySettled, false, '结算主流程照常完成');
  assert.equal(result.settledCount, 1);
  assert.ok(result.rewards[0].cores > 0);
  const wallet = db
    .prepare("SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'")
    .get(player);
  assert.equal(wallet.balance, result.rewards[0].cores, '奖励照常发放');
  assert.ok(
    errors.some((line) => line.includes('[audit]')),
    '写入失败留下可见日志'
  );
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'season_settle'")
    .get().c;
  assert.equal(count, 0, '失败的写入不落库');
});

test('接口只返回本人审计，响应不含密码哈希与 token', async () => {
  const server = await startTestServer();
  try {
    const alice = await registerAndLogin(server.base);
    const bob = await registerAndLogin(server.base);

    const second = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username: alice.username, password: alice.password },
    });
    assert.equal(second.status, 200, '第二个设备登录成功');

    const revoke = await api(server.base, '/api/auth/sessions/revoke-others', {
      method: 'POST',
      cookie: alice.rawCookie,
    });
    assert.equal(revoke.status, 200);

    const changed = await api(server.base, '/api/auth/password', {
      method: 'POST',
      cookie: alice.rawCookie,
      body: { currentPassword: alice.password, newPassword: 'audit-new-password' },
    });
    assert.equal(changed.status, 200);

    const aliceAudit = await api(server.base, '/api/profile/audit', {
      cookie: alice.rawCookie,
    });
    assert.equal(aliceAudit.status, 200);
    assert.deepEqual(
      aliceAudit.data.entries.map((row) => row.action),
      ['password_change', 'sessions_revoke_others'],
      '改密与退出其他设备都已入审计'
    );
    assert.equal(aliceAudit.data.limit, audit.AUDIT_PAGE_SIZE);

    const bobAudit = await api(server.base, '/api/profile/audit', {
      cookie: bob.rawCookie,
    });
    assert.equal(bobAudit.status, 200);
    assert.deepEqual(bobAudit.data.entries, [], '看不到别人的审计');

    const leaked = JSON.stringify(aliceAudit.data).toLowerCase();
    for (const secret of ['password_hash', 'passwordhash', 'recovery_hash', 'token']) {
      assert.ok(!leaked.includes(secret), `响应不应包含 ${secret}`);
    }

    // 账号删除同样入审计：删除后原会话失效，直接读库核对。
    const removed = await api(server.base, '/api/profile', {
      method: 'DELETE',
      cookie: bob.rawCookie,
      body: { confirm: 'DELETE' },
    });
    assert.equal(removed.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const probe = new DatabaseSync(server.dbPath);
    try {
      const row = probe
        .prepare('SELECT action FROM audit_log WHERE account_id = ?')
        .get(bob.data.account.id);
      assert.equal(row?.action, 'account_delete');
    } finally {
      probe.close();
    }
  } finally {
    await server.stop();
  }
});
