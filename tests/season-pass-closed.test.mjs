// 赛季通行证终态与历史：赛季边界、锁定轨道、历史归档只读、结束赛季拒绝领取。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SEASON_PASS_MILESTONES,
  isSeasonClosed,
  isSeasonKey,
  previousSeasonKey,
  seasonKeyOf,
  seasonPassProgress,
  seasonPassTerminal,
  seasonWindow,
} from '../public/js/shared/season-pass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = path.join(os.tmpdir(), `rtd-season-pass-closed-${process.pid}-${Date.now()}.db`);
const ACCOUNT = 'season-closed-test-account';

// DB_PATH 必须在动态 import 服务端模块之前生效。
process.env.DB_PATH = DB_FILE;
process.env.DB_BACKUP = '0';

let db = null;
let createProfile = null;
let archiveSeasonPassSeason = null;
let listSeasonPassHistory = null;
let seasonPassArchivedSummary = null;
let SeasonPassRoutes = null;
let serverSeasonOf = null;
let serverSeasonBounds = null;
let currentSeason = null;
let previousSeason = null;
let olderSeason = null;

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function insertFinishedRun({ id, score, createdAt }) {
  db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, board_key, difficulty, seed, day, content_version,
        ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
        rerolls_used, status, victory, score, wave_reached, kills, duration_ms,
        result_json, created_at, finished_at)
     VALUES (?, ?, 'normal', 'normal', 'standard', ?, '2026-10-24', 'v1.4-map2', ?, 20, 20, -1, '[]', '{}',
             0, 'finished', 1, ?, 20, 100, 60000, ?, ?, ?)`
  ).run(
    id,
    ACCOUNT,
    `seed-${id}`,
    JSON.stringify({ meta: { baseHp: 20 } }),
    score,
    JSON.stringify({ baseHp: 20 }),
    createdAt,
    createdAt + 60000
  );
}

// 路由处理器的最小上下文：记录 json/fail 的结果，供断言读取。
function makeCtx({ url = new URL('http://local/api/season-pass'), body = null } = {}) {
  return {
    token: ACCOUNT,
    url,
    async readJson() {
      return body ?? {};
    },
    json(status, data) {
      this.response = { status, data };
      return true;
    },
    fail(status, message, code) {
      this.response = { status, error: message, code };
      return true;
    },
  };
}

before(async () => {
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({
    archiveSeasonPassSeason,
    listSeasonPassHistory,
    seasonPassArchivedSummary,
  } = await import('../server/db/season_pass.mjs'));
  ({ seasonOf: serverSeasonOf, seasonBounds: serverSeasonBounds } = await import(
    '../server/db/leaderboard.mjs'
  ));
  ({ SeasonPassRoutes } = await import('../server/routes/season-pass.mjs'));

  currentSeason = serverSeasonOf();
  previousSeason = previousSeasonKey(currentSeason);
  olderSeason = previousSeasonKey(previousSeason);

  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(ACCOUNT, now, now);
  createProfile(ACCOUNT);

  // 上一赛季：三局各 10,000 分 → 前两个里程碑达标；第一个已领取，第二个错过。
  const window = seasonWindow(previousSeason);
  insertFinishedRun({ id: 'closed-run-1', score: 10000, createdAt: window.start + 1000 });
  insertFinishedRun({ id: 'closed-run-2', score: 10000, createdAt: window.start + 2000 });
  insertFinishedRun({ id: 'closed-run-3', score: 10000, createdAt: window.start + 3000 });
  db.prepare(
    `INSERT INTO account_season_pass_claims (account_id, season, milestone_id, points, claimed_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ACCOUNT, previousSeason, SEASON_PASS_MILESTONES[0].id, 30000, window.start + 5000);
});

after(() => {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  removeDb(DB_FILE);
});

test('赛季边界与排行榜一致：本地自然月，结束时刻即终态', () => {
  for (const season of ['2026-01', '2026-02', '2026-12', currentSeason, previousSeason]) {
    const shared = seasonWindow(season);
    const server = serverSeasonBounds(season);
    assert.equal(shared.start, server.start, `${season} 起始边界不一致`);
    assert.equal(shared.end, server.end, `${season} 结束边界不一致`);
    assert.equal(seasonKeyOf(shared.end), serverSeasonOf(shared.end), `${season} 结束后的赛季键不一致`);

    assert.equal(isSeasonClosed(season, shared.start), false, '赛季开始不应判定为结束');
    assert.equal(isSeasonClosed(season, shared.end - 1), false, '结束前 1ms 仍属于该赛季');
    assert.equal(isSeasonClosed(season, shared.end), true, '到达结束时刻即进入终态');
    assert.equal(isSeasonClosed(season, shared.end + 1), true);
  }

  assert.equal(isSeasonClosed('2026-13', Date.now()), false, '非法赛季不应判定为结束');
  assert.equal(isSeasonKey('2026-13'), false);
  assert.equal(isSeasonKey('2026-1'), false);
  assert.equal(previousSeasonKey('2026-01'), '2025-12');
  assert.equal(previousSeasonKey('2026-10'), '2026-09');
  assert.equal(previousSeasonKey('bad'), null);
});

test('终态轨道锁定：达标未领取标记错过，claimable 恒为 false', () => {
  const [first, second] = SEASON_PASS_MILESTONES;
  const closedTrack = seasonPassProgress(second.points, [first.id], { closed: true });

  assert.equal(closedTrack[0].claimed, true);
  assert.equal(closedTrack[0].claimable, false);
  assert.equal(closedTrack[1].complete, true);
  assert.equal(closedTrack[1].missed, true);
  assert.equal(closedTrack[1].claimable, false);
  assert.equal(closedTrack[2].complete, false);
  assert.equal(closedTrack[2].claimable, false);
  assert.ok(closedTrack.every((item) => item.claimable === false));
  assert.equal(
    closedTrack.at(-1).target,
    SEASON_PASS_MILESTONES.at(-1).points,
    '终态不应改动奖励阈值'
  );

  const terminal = seasonPassTerminal({ points: second.points, claimed: [first.id] });
  assert.equal(terminal.closed, true);
  assert.equal(terminal.points, second.points);
  assert.equal(terminal.claimedCount, 1);
  assert.equal(terminal.claimableCount, 0);
  assert.equal(terminal.missedCount, 1);
  assert.equal(terminal.completedCount, 2);

  const openTrack = seasonPassProgress(second.points, []);
  assert.equal(openTrack[1].claimable, true, '未结束赛季仍可领取');
  assert.equal(openTrack[1].closed, false);
});

test('历史归档：固化上一赛季终态，重复归档不覆盖，列表按倒序只含过去赛季', () => {
  const firstArchive = archiveSeasonPassSeason(ACCOUNT, previousSeason);
  assert.equal(firstArchive.archived, true);
  assert.equal(firstArchive.points, 30000);

  const snapshot = db
    .prepare('SELECT points FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(ACCOUNT, previousSeason);
  assert.equal(Number(snapshot.points), 30000);

  const secondArchive = archiveSeasonPassSeason(ACCOUNT, previousSeason);
  assert.equal(secondArchive.archived, false, '已归档赛季不应被再次覆盖');
  assert.equal(secondArchive.points, 30000);

  const history = listSeasonPassHistory(ACCOUNT, currentSeason);
  assert.deepEqual(history, [previousSeason], '历史列表应只包含当前赛季之前的归档赛季');
  assert.equal(seasonPassArchivedSummary(ACCOUNT, 'not-a-season'), null);
});

test('历史赛季只读：终态摘要不暴露可领取，旧数据回退为对局积分', async () => {
  // 旧数据：只有总分快照、没有来源明细。
  db.prepare(
    `INSERT INTO account_season_pass (account_id, season, points, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(ACCOUNT, olderSeason, 12345, seasonWindow(olderSeason).end - 1);

  const legacy = seasonPassArchivedSummary(ACCOUNT, olderSeason);
  assert.equal(legacy.closed, true);
  assert.equal(legacy.readOnly, true);
  assert.equal(legacy.points, 12345);
  assert.equal(legacy.claimableCount, 0);
  assert.equal(legacy.sources.length, 3);
  assert.equal(legacy.sources[0].source, 'match');
  assert.equal(legacy.sources[0].points, 12345);

  const routes = new SeasonPassRoutes();
  const ctx = makeCtx({ url: new URL(`http://local/api/season-pass?season=${previousSeason}`), body: null });
  await routes.list(ctx);
  assert.equal(ctx.response.status, 200);
  const data = ctx.response.data;
  assert.equal(data.season, previousSeason);
  assert.equal(data.closed, true);
  assert.equal(data.readOnly, true);
  assert.equal(data.points, 30000);
  assert.equal(data.claimedCount, 1);
  assert.equal(data.claimableCount, 0);
  assert.equal(data.missedCount, 1);
  assert.ok(data.milestones.every((milestone) => milestone.claimable === false));
  assert.ok(data.history.includes(previousSeason));
  assert.ok(data.history.includes(olderSeason));

  // 历史数据只读：再次读取不会改变快照或领取记录。
  const before = db
    .prepare('SELECT points FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(ACCOUNT, previousSeason);
  const claimsBefore = db
    .prepare('SELECT COUNT(*) AS total FROM account_season_pass_claims WHERE account_id = ? AND season = ?')
    .get(ACCOUNT, previousSeason);
  await routes.list(ctx);
  const after = db
    .prepare('SELECT points FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(ACCOUNT, previousSeason);
  const claimsAfter = db
    .prepare('SELECT COUNT(*) AS total FROM account_season_pass_claims WHERE account_id = ? AND season = ?')
    .get(ACCOUNT, previousSeason);
  assert.equal(Number(after.points), Number(before.points));
  assert.equal(Number(claimsAfter.total), Number(claimsBefore.total));
});

test('已结束赛季无法再领取：单个与一键领取都被拒绝且不发奖', async () => {
  const routes = new SeasonPassRoutes();
  const milestone = SEASON_PASS_MILESTONES[1];

  const single = makeCtx({ body: { id: milestone.id, season: previousSeason } });
  await routes.claim(single);
  assert.equal(single.response.status, 409);
  assert.equal(single.response.code, 'SEASON_CLOSED');

  const all = makeCtx({ body: { season: previousSeason } });
  await routes.claimAll(all);
  assert.equal(all.response.status, 409);
  assert.equal(all.response.code, 'SEASON_CLOSED');

  const claimedRows = db
    .prepare('SELECT COUNT(*) AS total FROM account_season_pass_claims WHERE account_id = ? AND season = ?')
    .get(ACCOUNT, previousSeason);
  assert.equal(Number(claimedRows.total), 1, '历史赛季领取记录不应改变');

  const invalid = makeCtx({ body: { id: milestone.id, season: '2026-13' } });
  await routes.claim(invalid);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.response.code, 'INVALID_SEASON');

  const futureSeason = seasonKeyOf(seasonWindow(currentSeason).end + 1000);
  const future = makeCtx({ body: { id: milestone.id, season: futureSeason } });
  await routes.claim(future);
  assert.equal(future.response.status, 400);
  assert.equal(future.response.code, 'SEASON_UNAVAILABLE');
});

test('当前赛季接口返回未结束标记与历史列表', async () => {
  const routes = new SeasonPassRoutes();
  const ctx = makeCtx();
  await routes.list(ctx);
  assert.equal(ctx.response.status, 200);
  const data = ctx.response.data;
  assert.equal(data.season, currentSeason);
  assert.equal(data.currentSeason, currentSeason);
  assert.equal(data.closed, false);
  assert.equal(data.readOnly, false);
  assert.equal(data.claimableCount, 0, '新赛季没有积分，不应有可领取里程碑');
  assert.ok(data.history.includes(previousSeason));

  const missing = makeCtx({ url: new URL('http://local/api/season-pass?season=2000-01') });
  await routes.list(missing);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.response.code, 'SEASON_NOT_FOUND');
});

test('面板接线：终态文案与历史赛季切换', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'public/js/ui/season-pass.js'), 'utf8');
  assert.match(ui, /season-pass-history/, '缺少历史赛季切换控件');
  assert.match(ui, /\/api\/season-pass\?season=\$\{encodeURIComponent\(season\)\}/, '历史赛季未走查询参数');
  assert.match(ui, /赛季已结束/, '缺少终态文案');
  assert.match(ui, /已错过/, '缺少达标未领取的终态状态');
  assert.match(ui, /readOnly/, '未消费只读终态标记');
  assert.match(ui, /item\.claimed/, '未展示领取状态');
  assert.match(ui, /credentials: 'same-origin'/, '请求未携带同源凭据');
  assert.match(ui, /response\.status === 401/, '未处理未登录');
});

test('零第三方依赖：新增与改动的模块只使用相对导入', () => {
  const files = [
    'public/js/shared/season-pass.js',
    'public/js/ui/season-pass.js',
    'server/routes/season-pass.mjs',
    'server/db/season_pass.mjs',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    if (!specifiers.length) continue;
    for (const specifier of specifiers) {
      assert.match(specifier, /^\./, `${file} 不允许第三方或裸导入：${specifier}`);
    }
  }
});
