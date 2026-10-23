// 赛季结算与奖励：名次奖励、重复结算幂等、事务原子性、个人结果接口与运维 CLI。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPS = path.join(ROOT, 'scripts', 'ops.mjs');
const DB_PATH = path.join(os.tmpdir(), `rtd-season-rewards-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let db = null;
let accounts = null;
let leaderboard = null;
let RouteTable = null;
let LeaderboardRoutes = null;

let currentSeason = null;
let rewardSeason = null;
let limitSeason = null;
let atomicSeason = null;
let cliSeason = null;
let dryRunSeason = null;

const now = Date.now();
const suffix = now.toString(36);

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
    passwordHash: 'season-test-password',
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

async function callRoute(pathname, token) {
  const table = new RouteTable();
  new LeaderboardRoutes().register(table);
  const captured = {};
  const ctx = {
    pathname,
    method: 'GET',
    token,
    json(status, data) {
      captured.status = status;
      captured.data = data;
      return true;
    },
    fail(status, message, code) {
      captured.status = status;
      captured.data = { error: message, code };
      return true;
    },
  };
  const handled = await table.dispatch(ctx);
  return { handled, ...captured };
}

function runOps(args) {
  const childEnv = { ...process.env, DB_PATH, DB_BACKUP: '0' };
  const result = spawnSync(process.execPath, [OPS, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: childEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(async () => {
  const index = await import('../server/db/index.mjs');
  db = index.db;
  accounts = await import('../server/db/accounts.mjs');
  leaderboard = await import('../server/db/leaderboard.mjs');
  ({ RouteTable } = await import('../server/routes/router.mjs'));
  ({ LeaderboardRoutes } = await import('../server/routes/leaderboard.mjs'));

  currentSeason = leaderboard.seasonOf(now);
  rewardSeason = shiftSeason(currentSeason, -2);
  limitSeason = shiftSeason(currentSeason, -3);
  atomicSeason = shiftSeason(currentSeason, -4);
  cliSeason = shiftSeason(currentSeason, -5);
  dryRunSeason = shiftSeason(currentSeason, -6);
});

after(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  for (const suffixPart of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB_PATH}${suffixPart}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('结算按赛季最高分排名发放星核，未注册账号不参与', () => {
  const alice = makeAccount('alice');
  const bob = makeAccount('bob');
  const carol = makeAccount('carol');
  const dave = accounts.createAccount({ kind: 'unclaimed' }).id;

  addEntry(alice, rewardSeason, 5000, 90000);
  addEntry(alice, rewardSeason, 2000, 30000); // 同一账号只取最高分
  addEntry(bob, rewardSeason, 3000, 60000);
  addEntry(carol, rewardSeason, 1000, 60000);
  addEntry(dave, rewardSeason, 9000, 1000); // 未注册，忽略

  const result = leaderboard.settleSeason(rewardSeason);
  assert.equal(result.alreadySettled, false);
  assert.equal(result.dryRun, false);
  assert.equal(result.settledCount, 3);
  assert.deepEqual(
    result.rewards.map((item) => ({ accountId: item.accountId, rank: item.rank, cores: item.cores })),
    [
      { accountId: alice, rank: 1, cores: 300 },
      { accountId: bob, rank: 2, cores: 180 },
      { accountId: carol, rank: 3, cores: 180 },
    ]
  );
  assert.equal(result.totalCores, 660);

  assert.equal(wallet(alice), 300);
  assert.equal(wallet(bob), 180);
  assert.equal(wallet(carol), 180);
  assert.equal(wallet(dave), 0, '未注册账号不应获得奖励');

  assert.deepEqual(
    resultsFor(rewardSeason).map((row) => [row.account_id, row.rank, row.cores]),
    [
      [alice, 1, 300],
      [bob, 2, 180],
      [carol, 3, 180],
    ]
  );
});

test('重复结算幂等：不重复发放，结果保持不变', () => {
  const beforeRows = resultsFor(rewardSeason);
  const beforeWallets = beforeRows.map((row) => [row.account_id, wallet(row.account_id)]);

  const again = leaderboard.settleSeason(rewardSeason);
  assert.equal(again.alreadySettled, true);
  assert.equal(again.settledCount, 3);
  assert.equal(again.totalCores, 660);
  assert.deepEqual(resultsFor(rewardSeason), beforeRows);
  assert.deepEqual(
    beforeRows.map((row) => [row.account_id, wallet(row.account_id)]),
    beforeWallets,
    '重复结算不应改变余额'
  );

  const dryAgain = leaderboard.settleSeason(rewardSeason, { dryRun: true });
  assert.equal(dryAgain.alreadySettled, true);
  assert.equal(dryAgain.dryRun, true);
});

test('dry-run 只预览奖励，不写结果也不发星核', () => {
  const eve = makeAccount('eve');
  const frank = makeAccount('frank');
  addEntry(eve, dryRunSeason, 4000);
  addEntry(frank, dryRunSeason, 2000);

  const preview = leaderboard.settleSeason(dryRunSeason, { dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.alreadySettled, false);
  assert.deepEqual(
    preview.rewards.map((item) => [item.accountId, item.rank, item.cores]),
    [
      [eve, 1, 300],
      [frank, 2, 180],
    ]
  );
  assert.equal(wallet(eve), 0);
  assert.equal(wallet(frank), 0);
  assert.equal(resultsFor(dryRunSeason).length, 0);

  const applied = leaderboard.settleSeason(dryRunSeason);
  assert.equal(applied.alreadySettled, false);
  assert.equal(wallet(eve), 300);
  assert.equal(wallet(frank), 180);
  assert.equal(resultsFor(dryRunSeason).length, 2);
});

test('只奖励前 N 名，名次区间与奖励集中定义', () => {
  const { SEASON_REWARD_LIMIT, seasonRewardForRank } = leaderboard;
  assert.equal(SEASON_REWARD_LIMIT, 50);
  assert.equal(seasonRewardForRank(1), 300);
  assert.equal(seasonRewardForRank(2), 180);
  assert.equal(seasonRewardForRank(3), 180);
  assert.equal(seasonRewardForRank(4), 100);
  assert.equal(seasonRewardForRank(10), 100);
  assert.equal(seasonRewardForRank(11), 40);
  assert.equal(seasonRewardForRank(50), 40);
  assert.equal(seasonRewardForRank(51), 0);
  assert.equal(seasonRewardForRank(0), 0);

  const ids = [];
  for (let i = 0; i < 55; i += 1) {
    const id = makeAccount(`limit${i}`);
    ids.push(id);
    addEntry(id, limitSeason, 5500 - i * 10);
  }

  const result = leaderboard.settleSeason(limitSeason);
  assert.equal(result.settledCount, SEASON_REWARD_LIMIT);
  assert.equal(resultsFor(limitSeason).length, SEASON_REWARD_LIMIT);
  assert.equal(result.rewards.at(-1).rank, 50);
  assert.equal(result.rewards.at(-1).cores, 40);
  assert.equal(result.totalCores, 300 + 180 * 2 + 100 * 7 + 40 * 40);

  assert.equal(wallet(ids[0]), 300);
  assert.equal(wallet(ids[49]), 40);
  for (let i = 50; i < 55; i += 1) {
    assert.equal(wallet(ids[i]), 0, `第 ${i + 1} 名不应获得奖励`);
    assert.ok(!resultsFor(limitSeason).some((row) => row.account_id === ids[i]));
  }
});

test('奖励发放与结算记录在同一事务内：任一失败全部回滚', () => {
  const gina = makeAccount('gina');
  const hank = makeAccount('hank');
  const iris = makeAccount('iris');
  addEntry(gina, atomicSeason, 3000);
  addEntry(hank, atomicSeason, 2000);
  addEntry(iris, atomicSeason, 1000);

  db.exec(`CREATE TRIGGER trg_settle_fail BEFORE INSERT ON season_results
           WHEN NEW.account_id = '${iris}'
           BEGIN SELECT RAISE(ABORT, 'settle failed'); END;`);
  try {
    assert.throws(() => leaderboard.settleSeason(atomicSeason), /settle failed/);
  } finally {
    db.exec('DROP TRIGGER trg_settle_fail');
  }

  assert.equal(resultsFor(atomicSeason).length, 0, '失败后不应留下结果记录');
  assert.equal(wallet(gina), 0, '失败后不应留下已发奖励');
  assert.equal(wallet(hank), 0);
  assert.equal(wallet(iris), 0);

  const retried = leaderboard.settleSeason(atomicSeason);
  assert.equal(retried.settledCount, 3);
  assert.equal(resultsFor(atomicSeason).length, 3);
  assert.equal(wallet(gina), 300);
});

test('个人赛季结果接口只返回本人结果，非法赛季返回 400', async () => {
  const settled = resultsFor(rewardSeason);
  const alice = settled[0].account_id;

  const mine = await callRoute(`/api/leaderboard/seasons/${rewardSeason}/result`, alice);
  assert.equal(mine.handled, true);
  assert.equal(mine.status, 200);
  assert.equal(mine.data.season, rewardSeason);
  assert.equal(mine.data.result.rank, 1);
  assert.equal(mine.data.result.cores, 300);
  assert.equal(mine.data.result.season, rewardSeason);
  assert.ok(Number.isInteger(mine.data.result.settledAt));

  const stranger = makeAccount('stranger');
  const other = await callRoute(`/api/leaderboard/seasons/${rewardSeason}/result`, stranger);
  assert.equal(other.status, 200);
  assert.equal(other.data.result, null);

  const invalid = await callRoute('/api/leaderboard/seasons/2026-13/result', alice);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_SEASON');
});

test('运维 CLI：settle-season 默认 dry-run，--yes 才写库', () => {
  const jack = makeAccount('jack');
  const kate = makeAccount('kate');
  addEntry(jack, cliSeason, 3000);
  addEntry(kate, cliSeason, 2000);

  const dry = runOps(['settle-season', cliSeason, '--db', DB_PATH, '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const dryResult = JSON.parse(dry.stdout);
  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.settledCount, 2);
  assert.equal(resultsFor(cliSeason).length, 0);
  assert.equal(wallet(jack), 0);

  const applied = runOps(['settle-season', cliSeason, '--db', DB_PATH, '--json', '--yes']);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedResult = JSON.parse(applied.stdout);
  assert.equal(appliedResult.dryRun, false);
  assert.equal(appliedResult.alreadySettled, false);
  assert.equal(resultsFor(cliSeason).length, 2);
  assert.equal(wallet(jack), 300);
  assert.equal(wallet(kate), 180);

  // 再次执行 CLI：幂等，余额不再变化。
  const repeat = runOps(['settle-season', cliSeason, '--db', DB_PATH, '--json', '--yes']);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).alreadySettled, true);
  assert.equal(wallet(jack), 300);
  assert.equal(wallet(kate), 180);

  const bad = runOps(['settle-season', '2026-13', '--db', DB_PATH, '--json']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /非法赛季/);
});
