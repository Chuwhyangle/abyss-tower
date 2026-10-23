// 本地运维 CLI 测试：账户查询、备份、禁用确认、恢复覆盖保护。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPS = path.join(ROOT, 'scripts', 'ops.mjs');

const SECRET_PASSWORD = 'SECRET-PASSWORD-HASH';
const SECRET_RECOVERY = 'SECRET-RECOVERY-HASH';

function runOps(args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.DB_PATH;
  const result = spawnSync(process.execPath, [OPS, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: childEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SCHEMA = `
  CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'unclaimed',
    username      TEXT,
    username_norm TEXT,
    password_hash TEXT,
    recovery_hash TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    meta          TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE player_wallets (
    account_id  TEXT NOT NULL,
    currency_id TEXT NOT NULL,
    balance     INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, currency_id)
  );
  CREATE TABLE player_stats (
    account_id TEXT NOT NULL,
    stat_key   TEXT NOT NULL,
    scope_key  TEXT NOT NULL DEFAULT '',
    value_num  NUMERIC NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, stat_key, scope_key)
  );
`;

function seedDb(file) {
  const db = new DatabaseSync(file);
  const now = Date.now();
  try {
    db.exec(SCHEMA);
    const insertAccount = db.prepare(
      `INSERT INTO accounts
         (id, kind, username, username_norm, password_hash, recovery_hash, status,
          meta, created_at, updated_at, last_login_at)
       VALUES (?, 'registered', ?, ?, ?, ?, 'active', '{}', ?, ?, NULL)`
    );
    insertAccount.run('acc-alice', 'Alice', 'alice', SECRET_PASSWORD, SECRET_RECOVERY, now - 3000, now - 3000);
    insertAccount.run('acc-bob', 'bob', 'bob', SECRET_PASSWORD, SECRET_RECOVERY, now - 2000, now - 2000);
    insertAccount.run('acc-carol', 'Carol', 'carol', SECRET_PASSWORD, SECRET_RECOVERY, now - 1000, now - 1000);

    db.prepare(
      "INSERT INTO player_wallets (account_id, currency_id, balance, updated_at) VALUES (?, 'cores', ?, ?)"
    ).run('acc-alice', 42, now);
    db.prepare(
      "INSERT INTO player_stats (account_id, stat_key, scope_key, value_num, updated_at) VALUES (?, 'wins', '', ?, ?)"
    ).run('acc-alice', 7, now);
  } finally {
    db.close();
  }
  return file;
}

function readStatus(file, accountId) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT status FROM accounts WHERE id = ?').get(accountId).status;
  } finally {
    db.close();
  }
}

function countAccounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  } finally {
    db.close();
  }
}

test('accounts 列出摘要且不泄露密码/恢复码哈希', (t) => {
  const dir = tempDir(t);
  const db = seedDb(path.join(dir, 'game.db'));

  const json = runOps(['accounts', '--db', db, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const rows = JSON.parse(json.stdout);
  assert.equal(rows.length, 3);

  const alice = rows.find((row) => row.id === 'acc-alice');
  assert.ok(alice, '应包含 alice');
  assert.equal(alice.username, 'Alice');
  assert.equal(alice.cores, 42);
  assert.equal(alice.wins, 7);

  for (const secret of [SECRET_PASSWORD, SECRET_RECOVERY]) {
    assert.ok(!json.stdout.includes(secret), 'JSON 不应包含敏感哈希');
  }
  assert.ok(!/password_hash|recovery_hash/i.test(json.stdout));

  const human = runOps(['accounts', '--db', db]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Alice/);
  assert.match(human.stdout, /星核 42/);
  assert.match(human.stdout, /胜场 7/);
  assert.ok(!human.stdout.includes(SECRET_PASSWORD));
});

test('accounts 支持 --search 与 --limit', (t) => {
  const dir = tempDir(t);
  const db = seedDb(path.join(dir, 'game.db'));

  const searched = runOps(['accounts', '--db', db, '--search', 'ali', '--json']);
  assert.equal(searched.status, 0, searched.stderr);
  const rows = JSON.parse(searched.stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'Alice');

  const limited = runOps(['accounts', '--db', db, '--limit', '1', '--json']);
  assert.equal(limited.status, 0, limited.stderr);
  assert.equal(JSON.parse(limited.stdout).length, 1);

  const missing = runOps(['accounts', '--db', db, '--search', '100%', '--json']);
  assert.equal(missing.status, 0, missing.stderr);
  assert.deepEqual(JSON.parse(missing.stdout), []);
});

test('backup 生成独立快照并拒绝覆盖已有文件', (t) => {
  const dir = tempDir(t);
  const db = seedDb(path.join(dir, 'game.db'));
  const out = path.join(dir, 'snapshot.db');

  const first = runOps(['backup', '--db', db, '--out', out, '--json']);
  assert.equal(first.status, 0, first.stderr);
  const result = JSON.parse(first.stdout);
  assert.equal(result.target, path.resolve(out));
  assert.ok(result.bytes > 0);
  assert.ok(fs.existsSync(out));
  assert.equal(countAccounts(out), 3);

  const second = runOps(['backup', '--db', db, '--out', out]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /拒绝覆盖/);

  const human = runOps(['backup', '--db', db, '--out', path.join(dir, 'human.db')]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /备份完成/);
});

test('disable 默认 dry-run，只有 --yes 才落库', (t) => {
  const dir = tempDir(t);
  const db = seedDb(path.join(dir, 'game.db'));

  const dryRun = runOps(['disable', 'alice', '--db', db, '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryRunResult = JSON.parse(dryRun.stdout);
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.changed, false);
  assert.equal(readStatus(db, 'acc-alice'), 'active');

  const human = runOps(['disable', 'alice', '--db', db]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /dry-run/);
  assert.equal(readStatus(db, 'acc-alice'), 'active');

  const confirmed = runOps(['disable', 'alice', '--db', db, '--yes', '--json']);
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal(JSON.parse(confirmed.stdout).changed, true);
  assert.equal(readStatus(db, 'acc-alice'), 'disabled');

  const again = runOps(['disable', 'alice', '--db', db, '--yes', '--json']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).changed, false);

  const unknown = runOps(['disable', 'nobody', '--db', db, '--yes']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /未找到账号/);
});

test('restore 拒绝覆盖正在使用的数据库', (t) => {
  const dir = tempDir(t);
  const db = seedDb(path.join(dir, 'game.db'));
  const backup = path.join(dir, 'backup.db');
  assert.equal(runOps(['backup', '--db', db, '--out', backup]).status, 0);

  const target = seedDb(path.join(dir, 'target.db'));
  const lock = new DatabaseSync(target);
  lock.exec('BEGIN IMMEDIATE');
  try {
    const blocked = runOps(['restore', backup, '--to', target, '--yes']);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /正在使用中/);
  } finally {
    lock.exec('ROLLBACK');
    lock.close();
  }
  assert.equal(countAccounts(target), 3, '被拒绝时目标库不应被改写');

  const restored = runOps(['restore', backup, '--to', target, '--yes', '--json']);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).changed, true);
  assert.equal(countAccounts(target), 3);
});

test('restore 默认 dry-run，缺少 --to 或备份无效时报错', (t) => {
  const dir = tempDir(t);
  const db = seedDb(path.join(dir, 'game.db'));
  const backup = path.join(dir, 'backup.db');
  assert.equal(runOps(['backup', '--db', db, '--out', backup]).status, 0);

  const noTarget = runOps(['restore', backup]);
  assert.notEqual(noTarget.status, 0);
  assert.match(noTarget.stderr, /--to/);

  const fresh = path.join(dir, 'restored.db');
  const dryRun = runOps(['restore', backup, '--to', fresh, '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).dryRun, true);
  assert.ok(!fs.existsSync(fresh), 'dry-run 不应创建目标文件');

  const garbage = path.join(dir, 'garbage.db');
  fs.writeFileSync(garbage, 'not a sqlite database');
  const invalid = runOps(['restore', garbage, '--to', fresh, '--yes']);
  assert.notEqual(invalid.status, 0);
  assert.ok(!fs.existsSync(fresh));

  const done = runOps(['restore', backup, '--to', fresh, '--yes']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(countAccounts(fresh), 3);
});
