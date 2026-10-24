// 审计导出：游标分页、CSV 转义、脱敏、只含本人、空数据与大记录量。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startTestServer, registerAndLogin } from './harness.mjs';

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
const DB_PATH = path.join(os.tmpdir(), `rtd-audit-export-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let db = null;
let accounts = null;
let audit = null;

const suffix = Date.now().toString(36);

function makeAccount(name) {
  return accounts.createAccount({
    kind: 'registered',
    username: `${name}-export-${suffix}`,
    passwordHash: 'audit-export-password',
  }).id;
}

function insertRaw(accountId, { action = 'password_change', meta = {}, createdAt = Date.now() } = {}) {
  db.prepare(
    'INSERT INTO audit_log (account_id, action, meta_json, created_at) VALUES (?, ?, ?, ?)'
  ).run(accountId, action, JSON.stringify(meta), createdAt);
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
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: response.status, data, text, headers: response.headers };
}

before(async () => {
  ({ db } = await import('../server/db/index.mjs'));
  accounts = await import('../server/db/accounts.mjs');
  audit = await import('../server/db/audit.mjs');
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

test('游标编码可逆，非法游标被拒绝', () => {
  const cursor = audit.encodeAuditCursor({ createdAt: 1700000000000, id: 42 });
  assert.equal(typeof cursor, 'string');
  assert.deepEqual(audit.parseAuditCursor(cursor), { createdAt: 1700000000000, id: 42 });

  const malformed = [
    null,
    '',
    'not-a-cursor',
    Buffer.from('12').toString('base64url'),
    Buffer.from(':5').toString('base64url'),
    Buffer.from('x:5').toString('base64url'),
    Buffer.from('10:-1').toString('base64url'),
  ];
  for (const value of malformed) {
    assert.equal(audit.parseAuditCursor(value), null, `应拒绝游标 ${value}`);
  }
});

test('exportRows 分页只返回本人记录并按时间倒序', () => {
  const alice = makeAccount('alice');
  const bob = makeAccount('bob');
  for (let i = 0; i < 5; i += 1) {
    insertRaw(alice, { meta: { i }, createdAt: 1000 + i });
  }
  insertRaw(bob, { meta: { other: true }, createdAt: 9999 });

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = audit.exportRows(alice, { limit: 2, cursor });
    pages += 1;
    seen.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(pages, 3, '5 条记录按每页 2 条分 3 页');
  assert.deepEqual(
    seen.map((row) => row.meta.i),
    [4, 3, 2, 1, 0],
    '按 created_at 倒序且不重不漏'
  );
  assert.ok(seen.every((row) => row.action === 'password_change'));
  assert.equal(seen.some((row) => row.meta.other), false, '看不到别人的导出');
});

test('大量记录逐页读完，每页大小受控', () => {
  const accountId = makeAccount('bulk');
  for (let i = 0; i < 250; i += 1) {
    insertRaw(accountId, { meta: { i }, createdAt: 5000 + i });
  }
  const pages = [...audit.auditExportPages(accountId, { pageSize: 100 })];
  assert.deepEqual(
    pages.map((page) => page.length),
    [100, 100, 50]
  );
  const flat = pages.flat();
  assert.equal(flat.length, 250);
  assert.equal(flat[0].meta.i, 249);
  assert.equal(flat[flat.length - 1].meta.i, 0);
});

test('CSV 按 RFC 4180 转义，并屏蔽敏感字段', () => {
  assert.equal(audit.auditCsvHeader(), 'id,action,createdAt,createdAtIso,meta\r\n');

  const row = audit.auditCsvRow({
    id: 7,
    action: 'a,b"c\nd',
    createdAt: 1700000000000,
    meta: { note: 'keep-me', passwordHash: 'secret-hash', token: 'secret-token', ip: '10.1.2.3' },
  });
  assert.ok(row.endsWith('\r\n'));
  assert.ok(row.includes('"a,b""c\nd"'), '逗号、引号与换行都需要引号包裹');
  assert.ok(!row.includes('secret-hash'));
  assert.ok(!row.includes('secret-token'));
  assert.ok(!row.includes('10.1.2.3'));
  assert.ok(row.includes('[redacted]'));

  const formula = audit.auditCsvRow({
    id: 8,
    action: '=SUM(A1)',
    createdAt: 1700000000001,
    meta: {},
  });
  assert.ok(formula.includes("'=SUM(A1)"), '中和表格公式注入');
});

test('HTTP 导出：JSON/CSV 只含本人、脱敏、空数据与非法格式', async () => {
  const server = await startTestServer();
  try {
    const alice = await registerAndLogin(server.base);
    const bob = await registerAndLogin(server.base);

    const second = await api(server.base, '/api/auth/login', {
      method: 'POST',
      body: { username: alice.username, password: alice.password },
    });
    assert.equal(second.status, 200);
    const revoke = await api(server.base, '/api/auth/sessions/revoke-others', {
      method: 'POST',
      cookie: alice.rawCookie,
    });
    assert.equal(revoke.status, 200);
    const changed = await api(server.base, '/api/auth/password', {
      method: 'POST',
      cookie: alice.rawCookie,
      body: { currentPassword: alice.password, newPassword: 'audit-export-new-password' },
    });
    assert.equal(changed.status, 200);

    const json = await api(server.base, '/api/profile/audit/export?format=json', {
      cookie: alice.rawCookie,
    });
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-type'), /application\/json/);
    assert.match(
      json.headers.get('content-disposition'),
      /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.json"/
    );
    const bundle = JSON.parse(json.text);
    assert.deepEqual(
      bundle.entries.map((entry) => entry.action),
      ['password_change', 'sessions_revoke_others'],
      'JSON 导出按时间倒序且只含本人'
    );
    assert.ok(bundle.entries.every((entry) => /^\d{4}-\d{2}-\d{2}T/.test(entry.createdAtIso)));
    const lowered = json.text.toLowerCase();
    for (const secret of ['password_hash', 'passwordhash', 'recovery_hash', 'token', 'account_id']) {
      assert.ok(!lowered.includes(secret), `JSON 导出不应包含 ${secret}`);
    }
    assert.ok(
      !/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(json.text),
      'JSON 导出不应包含 IP 明文'
    );

    const csv = await api(server.base, '/api/profile/audit/export?format=csv', {
      cookie: alice.rawCookie,
    });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(
      csv.headers.get('content-disposition'),
      /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/
    );
    const lines = csv.text.trimEnd().split('\r\n');
    assert.equal(lines[0], 'id,action,createdAt,createdAtIso,meta');
    assert.equal(lines.length, 3);
    assert.equal(lines[1].split(',')[1], 'password_change');
    assert.equal(lines[2].split(',')[1], 'sessions_revoke_others');
    assert.ok(!csv.text.toLowerCase().includes('token'));

    const bobJson = await api(server.base, '/api/profile/audit/export?format=json', {
      cookie: bob.rawCookie,
    });
    assert.equal(bobJson.status, 200);
    assert.deepEqual(JSON.parse(bobJson.text).entries, [], '看不到别人的审计');

    const bobCsv = await api(server.base, '/api/profile/audit/export?format=csv', {
      cookie: bob.rawCookie,
    });
    assert.equal(bobCsv.status, 200);
    assert.equal(bobCsv.text, 'id,action,createdAt,createdAtIso,meta\r\n', '空数据只有表头');

    const invalid = await api(server.base, '/api/profile/audit/export?format=xml', {
      cookie: alice.rawCookie,
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'INVALID_EXPORT_FORMAT');
  } finally {
    await server.stop();
  }
});
