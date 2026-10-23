// 赛季自动结算脚本：只结算已结束赛季、dry-run 不写、重复运行幂等、失败点名赛季与原因。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'settle-seasons.mjs');
const DB_PATH = path.join(os.tmpdir(), `rtd-settle-seasons-${process.pid}-${Date.now()}.db`);

process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let db = null;
let accounts = null;
let leaderboard = null;

const now = Date.now();
const suffix = now.toString(36);

let currentSeason = null;
let dryRunSeason = null;
let failingSeason = null;

function shiftSeason(season, delta) {
  const [year, month] = season.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function seasonMidpoint(season) {
  const bounds = leaderboard.seasonBounds(season);
  return bounds.start + 12 * 60 * 60 * 1000;
}

function makeAccount(name) {
  return accounts.createAccount({
    kind: 'registered',
    username: `${name}${suffix}`,
    passwordHash: 'settle-seasons-password',
  }).id;
}

function addEntry(accountId, season, score, durationMs = 60000, boardKey = 'normal') {
  db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES (?, ?, 'tester', NULL, 'standard', ?, ?, 'v1.4-map2', '{}', ?)`
  ).run(boardKey, accountId, score, durationMs, seasonMidpoint(season));
}

function runScript(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DB_PATH, DB_BACKUP: '0' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseJson(run) {
  return JSON.parse(run.stdout);
}

function wallet(accountId) {
  const row = db
    .prepare("SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'")
    .get(accountId);
  return Number(row?.balance) || 0;
}

function resultsFor(season) {
  return db
    .prepare('SELECT account_id, rank, cores FROM season_results WHERE season = ? ORDER BY rank ASC')
    .all(season);
}

before(async () => {
  const index = await import('../server/db/index.mjs');
  db = index.db;
  accounts = await import('../server/db/accounts.mjs');
  leaderboard = await import('../server/db/leaderboard.mjs');

  currentSeason = leaderboard.seasonOf(now);
  dryRunSeason = shiftSeason(currentSeason, -2);
  failingSeason = shiftSeason(currentSeason, -3);
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

test('dry-run 只预览已结束赛季，不写结果也不发星核', () => {
  const alice = makeAccount('dry-alice');
  const bob = makeAccount('dry-bob');
  addEntry(alice, dryRunSeason, 5000, 90000);
  addEntry(bob, dryRunSeason, 3000, 60000);

  const run = runScript(['--season', dryRunSeason, '--dry-run', '--json']);
  assert.equal(run.status, 0, run.stderr);
  const report = parseJson(run);
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);

  const item = report.results.find((entry) => entry.season === dryRunSeason);
  assert.equal(item.status, 'would-settle');
  assert.equal(item.settledCount, 2);
  assert.equal(item.totalCores, 480);

  assert.deepEqual(resultsFor(dryRunSeason), []);
  assert.equal(wallet(alice), 0);
  assert.equal(wallet(bob), 0);
});

test('结算已结束赛季并写入结果表', () => {
  const run = runScript(['--season', dryRunSeason, '--json']);
  assert.equal(run.status, 0, run.stderr);
  const report = parseJson(run);
  assert.equal(report.dryRun, false);

  const item = report.results.find((entry) => entry.season === dryRunSeason);
  assert.equal(item.status, 'settled');
  assert.equal(item.settledCount, 2);
  assert.equal(item.totalCores, 480);

  assert.deepEqual(
    resultsFor(dryRunSeason).map((row) => [row.rank, row.cores]),
    [
      [1, 300],
      [2, 180],
    ]
  );
  const totalBefore = db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS total FROM player_wallets WHERE currency_id = 'cores'`
    )
    .get().total;
  assert.equal(Number(totalBefore), 480);
});

test('重复运行不重复发奖', () => {
  const rowsBefore = resultsFor(dryRunSeason);
  const balancesBefore = db
    .prepare(
      `SELECT account_id, balance FROM player_wallets WHERE currency_id = 'cores' ORDER BY account_id`
    )
    .all();

  const run = runScript(['--season', dryRunSeason, '--json']);
  assert.equal(run.status, 0, run.stderr);
  const item = parseJson(run).results.find((entry) => entry.season === dryRunSeason);
  assert.equal(item.status, 'already-settled');
  assert.equal(item.alreadySettled, true);
  assert.equal(item.settledCount, 2);
  assert.equal(item.totalCores, 480);

  assert.deepEqual(resultsFor(dryRunSeason), rowsBefore);
  assert.deepEqual(
    db
      .prepare(
        `SELECT account_id, balance FROM player_wallets WHERE currency_id = 'cores' ORDER BY account_id`
      )
      .all(),
    balancesBefore,
    '重复运行不应改变余额'
  );
});

test('未结束的赛季不参与自动结算', () => {
  const carol = makeAccount('current-carol');
  addEntry(carol, currentSeason, 4000, 60000);

  const run = runScript(['--json']);
  assert.equal(run.status, 0, run.stderr);
  const report = parseJson(run);

  const item = report.results.find((entry) => entry.season === currentSeason);
  assert.ok(item, '应报告当前赛季为跳过');
  assert.equal(item.status, 'not-ended');
  assert.match(item.reason, /未结束/);

  assert.deepEqual(resultsFor(currentSeason), []);
  assert.equal(wallet(carol), 0);

  const done = report.results.find((entry) => entry.season === dryRunSeason);
  assert.equal(done.status, 'already-settled');
});

test('单个赛季失败时点名赛季与原因，且不影响已成功结果', () => {
  const dave = makeAccount('fail-dave');
  addEntry(dave, failingSeason, 6000, 60000);

  db.exec(`
    CREATE TRIGGER fail_settle_season
    BEFORE INSERT ON season_results
    WHEN NEW.season = '${failingSeason}'
    BEGIN
      SELECT RAISE(ABORT, '模拟结算失败');
    END;
  `);

  try {
    const run = runScript(['--season', failingSeason]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, new RegExp(`赛季 ${failingSeason} 结算失败`));
    assert.match(run.stderr, /模拟结算失败/);
    assert.deepEqual(resultsFor(failingSeason), []);
    assert.equal(wallet(dave), 0);
    assert.deepEqual(resultsFor(dryRunSeason).length, 2, '其它赛季结果不受影响');
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_settle_season');
  }
});

test('非法赛季参数直接报错', () => {
  const run = runScript(['--season', '2024-13']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /非法赛季：2024-13/);
});
