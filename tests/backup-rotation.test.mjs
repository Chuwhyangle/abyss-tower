// 备份轮转测试：保留集纯函数、损坏备份不删除、空目录安全。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  isoWeekKey,
  parseRotate,
  planRotation,
  rotateBackups,
  verifyBackupIntegrity,
} from '../scripts/backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'backup.mjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rotation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function entry(file, iso) {
  return { file, mtimeMs: Date.parse(iso) };
}

function makeValidDb(dir, name, iso) {
  const file = path.join(dir, name);
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO t (value) VALUES (?)').run('ok');
  } finally {
    db.close();
  }
  const when = new Date(iso);
  fs.utimesSync(file, when, when);
  return file;
}

function makeCorrupt(dir, name, iso) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '这不是一个 SQLite 数据库');
  const when = new Date(iso);
  fs.utimesSync(file, when, when);
  return file;
}

function makeSourceDb(dir, name = 'source.db') {
  const file = path.join(dir, name);
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT)');
    db.prepare('INSERT INTO accounts (username) VALUES (?)').run('alice');
  } finally {
    db.close();
  }
  return file;
}

test('保留集：最近 N 份 + 每周首份', () => {
  const entries = [
    entry('a', '2026-01-05T10:00:00Z'),
    entry('b', '2026-01-06T10:00:00Z'),
    entry('c', '2026-01-07T10:00:00Z'),
    entry('d', '2026-01-12T10:00:00Z'),
    entry('e', '2026-01-13T10:00:00Z'),
    entry('f', '2026-01-19T10:00:00Z'),
  ];

  const plan = planRotation(entries, { keep: 2 });
  assert.deepEqual(plan.keep, ['a', 'd', 'e', 'f']);
  assert.deepEqual(plan.remove, ['b', 'c']);
});

test('保留集：份数超过总数时全部保留，同周只留最早一份', () => {
  const entries = [
    entry('a', '2026-01-05T10:00:00Z'),
    entry('b', '2026-01-06T10:00:00Z'),
    entry('c', '2026-01-07T10:00:00Z'),
  ];
  assert.deepEqual(planRotation(entries, { keep: 99 }), { keep: ['a', 'b', 'c'], remove: [] });
  // keep=1 时最近一份是 c，周首份是 a，中间的 b 删除。
  assert.deepEqual(planRotation(entries, { keep: 1 }), { keep: ['a', 'c'], remove: ['b'] });
});

test('ISO 周键：跨年与边界正确', () => {
  assert.equal(isoWeekKey(Date.parse('2026-01-05T10:00:00Z')), '2026-W02');
  assert.equal(isoWeekKey(Date.parse('2025-12-29T10:00:00Z')), '2026-W01');
  assert.equal(isoWeekKey(Date.parse('2026-01-01T10:00:00Z')), '2026-W01');
});

test('--rotate 只接受正整数', () => {
  assert.equal(parseRotate(null), null);
  assert.equal(parseRotate(undefined), null);
  assert.equal(parseRotate('5'), 5);
  for (const bad of ['0', '-1', '2.5', 'abc', '']) {
    assert.throws(() => parseRotate(bad), /--rotate/);
  }
  assert.throws(() => planRotation([], { keep: 0 }), /正整数/);
});

test('完整性校验识别有效与损坏备份', (t) => {
  const dir = tempDir(t);
  const good = makeValidDb(dir, 'game-good.db', '2026-01-05T10:00:00Z');
  const bad = makeCorrupt(dir, 'game-bad.db', '2026-01-05T10:00:00Z');

  assert.deepEqual(verifyBackupIntegrity(good), { ok: true, verdict: 'ok' });
  const verdict = verifyBackupIntegrity(bad);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.verdict);
});

test('损坏备份永不自动删除，其余旧备份正常清理', (t) => {
  const dir = tempDir(t);
  const weekFirst = makeValidDb(dir, 'game-2026-01-05T10-00-00.db', '2026-01-05T10:00:00Z');
  const corrupt = makeCorrupt(dir, 'game-2026-01-06T10-00-00.db', '2026-01-06T10:00:00Z');
  const redundant = makeValidDb(dir, 'game-2026-01-07T10-00-00.db', '2026-01-07T10:00:00Z');
  const newest = makeValidDb(dir, 'game-2026-01-08T10-00-00.db', '2026-01-08T10:00:00Z');

  const result = rotateBackups(dir, { keep: 1 });

  assert.deepEqual(result.removed, [redundant]);
  assert.deepEqual(result.failed.map((item) => item.file), [corrupt]);
  assert.ok(fs.existsSync(corrupt), '损坏备份不得删除');
  assert.ok(fs.existsSync(weekFirst));
  assert.ok(fs.existsSync(newest));
  assert.ok(!fs.existsSync(redundant));
});

test('轮转保护源库与新建备份', (t) => {
  const dir = tempDir(t);
  const source = makeValidDb(dir, 'game-source.db', '2026-01-05T10:00:00Z');
  makeValidDb(dir, 'game-2026-01-08T10-00-00.db', '2026-01-08T10:00:00Z');

  const result = rotateBackups(dir, { keep: 1, protect: [source] });

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.failed, []);
  assert.ok(fs.existsSync(source), '源库不得被轮转删除');
});

test('空目录、不存在的目录与无关文件都安全', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(planRotation([]), { keep: [], remove: [] });

  const missing = rotateBackups(path.join(dir, 'missing'), { keep: 3 });
  assert.deepEqual(missing, { keep: [], remove: [], removed: [], failed: [] });

  const emptyDir = path.join(dir, 'empty');
  fs.mkdirSync(emptyDir);
  const unrelated = path.join(emptyDir, 'notes.txt');
  fs.writeFileSync(unrelated, '不参与轮转');

  const empty = rotateBackups(emptyDir, { keep: 1 });
  assert.deepEqual(empty.removed, []);
  assert.deepEqual(empty.failed, []);
  assert.ok(fs.existsSync(unrelated));
});

test('CLI：--rotate 保留最近 N 份与每周首份，损坏备份保留并告警', (t) => {
  const dir = tempDir(t);
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups);
  const source = makeSourceDb(dir);

  const weekFirst = makeValidDb(backups, 'game-2026-01-05T10-00-00.db', '2026-01-05T10:00:00Z');
  const corrupt = makeCorrupt(backups, 'game-2026-01-06T10-00-00.db', '2026-01-06T10:00:00Z');
  const redundant = makeValidDb(backups, 'game-2026-01-07T10-00-00.db', '2026-01-07T10:00:00Z');
  const nextWeek = makeValidDb(backups, 'game-2026-01-12T10-00-00.db', '2026-01-12T10:00:00Z');
  const target = path.join(backups, 'game-2026-02-01T10-00-00.db');

  const result = spawnSync(
    process.execPath,
    ['--no-warnings', SCRIPT, target, '--rotate', '1'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_PATH: source } }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /备份完成/);
  assert.match(result.stdout, /轮转：删除 1 份旧备份/);
  assert.match(result.stderr, /校验失败，保留不删/);
  assert.ok(fs.existsSync(target), '新备份必须存在');
  assert.ok(!fs.existsSync(redundant), '通过校验的旧备份应被删除');
  assert.ok(fs.existsSync(corrupt), '损坏备份不得删除');
  assert.ok(fs.existsSync(weekFirst), '每周首份应保留');
  assert.ok(fs.existsSync(nextWeek), '最近 N 份应保留');
});

test('CLI：非法 --rotate 在生成备份前拒绝', (t) => {
  const dir = tempDir(t);
  const source = makeSourceDb(dir);
  const target = path.join(dir, 'game-2026-02-01T10-00-00.db');

  const result = spawnSync(
    process.execPath,
    ['--no-warnings', SCRIPT, target, '--rotate', '0'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_PATH: source } }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--rotate 必须是正整数/);
  assert.ok(!fs.existsSync(target));
});
