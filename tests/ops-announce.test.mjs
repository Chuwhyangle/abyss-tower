// 公告管理 CLI：发布 / 撤回 / 列表，dry-run 不写库，撤回后未读清零。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPS = path.join(ROOT, 'scripts', 'ops.mjs');
const DB_FILE = path.join(os.tmpdir(), `ops-announce-${process.pid}-${Date.now()}.db`);
const ACCOUNTS = ['announce-alice', 'announce-bob', 'announce-carol'];

let db = null;
let createProfile = null;
let writePrefs = null;
let notificationSummary = null;
let announcementId = null;

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function runOps(args) {
  const env = { ...process.env };
  delete env.DB_PATH;
  const result = spawnSync(process.execPath, [OPS, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function countRows() {
  return Number(
    db.prepare("SELECT COUNT(*) AS c FROM account_notifications WHERE kind = 'announcement'").get()
      .c
  );
}

function unreadRows() {
  return Number(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM account_notifications WHERE kind = 'announcement' AND read_at IS NULL"
      )
      .get().c
  );
}

before(async () => {
  process.env.DB_PATH = DB_FILE;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({ writePrefs, notificationSummary } = await import('../server/db/notifications.mjs'));

  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at) VALUES (?, 'unclaimed', ?, ?)`
  );
  for (const id of ACCOUNTS) {
    insert.run(id, now, now);
    createProfile(id);
  }
});

after(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  removeDb(DB_FILE);
});

test('announce list 在空库上可运行', () => {
  const json = runOps(['announce', 'list', '--db', DB_FILE, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.action, 'list');
  assert.deepEqual(payload.items, []);

  const human = runOps(['announce', 'list', '--db', DB_FILE]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /没有生效中的公告/);
});

test('announce publish 默认 dry-run，不写任何通知', () => {
  const dry = runOps([
    'announce',
    'publish',
    '--title',
    '维护通知',
    '--body',
    '今晚 23:00 停服',
    '--db',
    DB_FILE,
    '--json',
  ]);
  assert.equal(dry.status, 0, dry.stderr);
  const result = JSON.parse(dry.stdout);
  assert.equal(result.dryRun, true);
  assert.equal(result.delivered, 0);
  assert.equal(result.recipients, ACCOUNTS.length);
  assert.match(result.id, /^announcement:/);
  assert.equal(countRows(), 0, 'dry-run 不应写通知');

  const human = runOps([
    'announce',
    'publish',
    '--title',
    '维护通知',
    '--body',
    '今晚停服',
    '--db',
    DB_FILE,
  ]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /dry-run/);
  assert.equal(countRows(), 0);
});

test('announce publish --yes 扇出通知，announce list 可见', () => {
  const published = runOps([
    'announce',
    'publish',
    '--title',
    '维护通知',
    '--body',
    '今晚 23:00 停服',
    '--important',
    '--yes',
    '--db',
    DB_FILE,
    '--json',
  ]);
  assert.equal(published.status, 0, published.stderr);
  const result = JSON.parse(published.stdout);
  assert.equal(result.dryRun, false);
  assert.equal(result.delivered, ACCOUNTS.length);
  announcementId = result.id;

  assert.equal(countRows(), ACCOUNTS.length, '每个账号一条通知');
  assert.equal(unreadRows(), ACCOUNTS.length);

  const list = runOps(['announce', 'list', '--db', DB_FILE, '--json']);
  assert.equal(list.status, 0, list.stderr);
  const items = JSON.parse(list.stdout).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, announcementId);
  assert.equal(items[0].title, '维护通知');
  assert.equal(items[0].body, '今晚 23:00 停服');
  assert.equal(items[0].important, true);
  assert.equal(items[0].recipients, ACCOUNTS.length);
  assert.equal(items[0].unread, ACCOUNTS.length);
  assert.equal(items[0].revoked, false);

  const human = runOps(['announce', 'list', '--db', DB_FILE]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /\[重要\]/);
  assert.match(human.stdout, /未读 3\/3/);
});

test('announce revoke 默认 dry-run，不清未读', () => {
  const dry = runOps(['announce', 'revoke', announcementId, '--db', DB_FILE, '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const result = JSON.parse(dry.stdout);
  assert.equal(result.dryRun, true);
  assert.equal(result.affected, ACCOUNTS.length);
  assert.equal(result.unreadCleared, ACCOUNTS.length);
  assert.equal(unreadRows(), ACCOUNTS.length, 'dry-run 不应改动未读');
});

test('announce revoke --yes 清零未读，默认列表不再展示', () => {
  const done = runOps(['announce', 'revoke', announcementId, '--yes', '--db', DB_FILE, '--json']);
  assert.equal(done.status, 0, done.stderr);
  const result = JSON.parse(done.stdout);
  assert.equal(result.affected, ACCOUNTS.length);
  assert.equal(result.unreadCleared, ACCOUNTS.length);
  assert.equal(countRows(), ACCOUNTS.length, '撤回保留历史记录');
  assert.equal(unreadRows(), 0, '撤回后不再计入未读');
  for (const accountId of ACCOUNTS) {
    assert.equal(notificationSummary(accountId).unread, 0);
  }

  const list = runOps(['announce', 'list', '--db', DB_FILE, '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).items, []);

  const all = runOps(['announce', 'list', '--include-revoked', '--db', DB_FILE, '--json']);
  assert.equal(all.status, 0, all.stderr);
  const items = JSON.parse(all.stdout).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].revoked, true);
  assert.equal(items[0].unread, 0);

  const again = runOps(['announce', 'revoke', announcementId, '--yes', '--db', DB_FILE, '--json']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).unreadCleared, 0, '重复撤回是幂等的');

  const unknown = runOps(['announce', 'revoke', 'announcement:missing', '--yes', '--db', DB_FILE]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /未找到公告/);
});

test('重要公告不受偏好影响，普通公告尊重 announcements 偏好', () => {
  writePrefs('announce-bob', { announcements: false });
  try {
    const normal = runOps([
      'announce',
      'publish',
      '--title',
      '周末活动',
      '--body',
      '双倍星核',
      '--yes',
      '--db',
      DB_FILE,
      '--json',
    ]);
    assert.equal(normal.status, 0, normal.stderr);
    const normalResult = JSON.parse(normal.stdout);
    assert.equal(normalResult.recipients, ACCOUNTS.length);
    assert.equal(normalResult.delivered, ACCOUNTS.length - 1);

    const important = runOps([
      'announce',
      'publish',
      '--title',
      '紧急维护',
      '--body',
      '立即停服',
      '--important',
      '--yes',
      '--db',
      DB_FILE,
      '--json',
    ]);
    assert.equal(important.status, 0, important.stderr);
    const importantResult = JSON.parse(important.stdout);
    assert.equal(importantResult.delivered, ACCOUNTS.length, '重要公告强制送达');
  } finally {
    writePrefs('announce-bob', { announcements: true });
  }
});
