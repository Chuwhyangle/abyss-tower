// 赛季通行证积分来源：来源分类集中定义、聚合口径、旧数据兼容、跨赛季边界与面板明细。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SEASON_ACHIEVEMENT_POINT_BONUS,
  SEASON_BOUNTY_POINT_BONUS,
  SEASON_POINT_SOURCE_LABELS,
  SEASON_POINT_SOURCE_ORDER,
  SEASON_POINT_SOURCES,
  pointsBreakdown,
  seasonAchievementPoints,
  seasonBountyPoints,
} from '../public/js/shared/season-pass.js';
import { ACHIEVEMENT_BY_ID } from '../public/js/shared/achievements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-season-sources-${process.pid}-${Date.now()}.db`);

const MATCH_TOKEN = 'season-sources-match-token';
const LEGACY_TOKEN = 'season-sources-legacy-token';
const BOUNDARY_TOKEN = 'season-sources-boundary-token';

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SEASON_PASS_UI = read('public/js/ui/season-pass.js');

let db = null;
let createProfile = null;
let seasonPassSummary = null;
let seasonOf = null;
let seasonBounds = null;
let currentSeason = null;
let inSeasonAt = 0;

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function seedAccount(accountId) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  createProfile(accountId);
}

// 直接写入已完成对局，模拟上线前的旧数据（不经过任何通行证接口）。
function insertRun({ id, accountId, score, createdAt = inSeasonAt }) {
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
    accountId,
    `seed-${id}`,
    JSON.stringify({ meta: { baseHp: 20 } }),
    score,
    JSON.stringify({ baseHp: 20 }),
    createdAt,
    createdAt + 60000
  );
}

function insertSeasonBounty({ accountId, bountyId, season = currentSeason, claimedAt = inSeasonAt }) {
  db.prepare(
    `INSERT INTO account_bounties
       (account_id, period, period_key, bounty_id, target, progress, claimed_at, updated_at)
     VALUES (?, 'season', ?, ?, 100, 100, ?, ?)`
  ).run(accountId, season, bountyId, claimedAt, claimedAt);
}

function insertAchievement({ accountId, achievementId, unlockedAt = inSeasonAt }) {
  db.prepare(
    `INSERT INTO account_achievements (account_id, achievement_id, unlocked_at)
     VALUES (?, ?, ?)`
  ).run(accountId, achievementId, unlockedAt);
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({ seasonPassSummary } = await import('../server/db/season_pass.mjs'));
  ({ seasonOf, seasonBounds } = await import('../server/db/leaderboard.mjs'));

  currentSeason = seasonOf();
  const bounds = seasonBounds(currentSeason);
  inSeasonAt = Math.max(bounds.start + 1, Math.min(Date.now(), bounds.end - 60_000));

  seedAccount(MATCH_TOKEN);
  seedAccount(LEGACY_TOKEN);
  seedAccount(BOUNDARY_TOKEN);
});

after(() => {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  removeDb(UNIT_DB);
});

test('来源分类集中定义：三类来源顺序固定，额外积分由档位与稀有度决定', () => {
  assert.deepEqual(SEASON_POINT_SOURCE_ORDER, ['match', 'bounty', 'achievement']);
  assert.equal(SEASON_POINT_SOURCES.MATCH, 'match');
  assert.equal(SEASON_POINT_SOURCES.BOUNTY, 'bounty');
  assert.equal(SEASON_POINT_SOURCES.ACHIEVEMENT, 'achievement');
  for (const source of SEASON_POINT_SOURCE_ORDER) {
    assert.ok(SEASON_POINT_SOURCE_LABELS[source], `来源 ${source} 缺少展示文案`);
  }

  assert.equal(seasonBountyPoints('normal'), SEASON_BOUNTY_POINT_BONUS.normal);
  assert.equal(seasonBountyPoints('extreme'), SEASON_BOUNTY_POINT_BONUS.extreme);
  assert.equal(seasonBountyPoints('unknown'), 0);
  assert.equal(seasonAchievementPoints('rare'), SEASON_ACHIEVEMENT_POINT_BONUS.rare);
  assert.equal(seasonAchievementPoints(undefined), 0);
});

test('pointsBreakdown 聚合来源：固定顺序、时间取最新、合计等于各项之和', () => {
  const breakdown = pointsBreakdown([
    { source: 'bounty', points: 1_000, updatedAt: 20 },
    { source: 'match', points: 500, updatedAt: 10 },
    { source: 'achievement', points: 300 },
  ]);

  assert.deepEqual(
    breakdown.sources.map((item) => item.source),
    SEASON_POINT_SOURCE_ORDER
  );
  assert.deepEqual(
    breakdown.sources.map((item) => item.points),
    [500, 1_000, 300]
  );
  assert.equal(breakdown.total, 1_800);
  assert.equal(breakdown.sources[0].updatedAt, 10);
  assert.equal(breakdown.sources[2].updatedAt, null);

  // 同类多条聚合，时间取最新；负数与坏数据不计入。
  const merged = pointsBreakdown([
    { source: 'bounty', points: 500, updatedAt: 5 },
    { source: 'bounty', points: 700, updatedAt: 30 },
    { source: 'bounty', points: -100, updatedAt: 99 },
    { source: 'bounty', points: 'oops' },
  ]);
  assert.equal(merged.sources[1].points, 1_200);
  assert.equal(merged.sources[1].updatedAt, 30);

  const mapped = pointsBreakdown({ match: 2_000, bounty: 500, achievement: 300 });
  assert.equal(mapped.total, 2_800);
});

test('无来源占位：空数据返回三类零值，旧数据按对局积分处理', () => {
  const empty = pointsBreakdown();
  assert.equal(empty.total, 0);
  assert.deepEqual(
    empty.sources.map((item) => [item.source, item.points, item.updatedAt]),
    [
      ['match', 0, null],
      ['bounty', 0, null],
      ['achievement', 0, null],
    ]
  );

  // 旧快照只有裸总分，没有来源字段 ⇒ 整笔算对局积分。
  const legacyTotal = pointsBreakdown(180_000);
  assert.equal(legacyTotal.total, 180_000);
  assert.equal(legacyTotal.sources[0].points, 180_000);

  // 条目缺失/未知 source 同样按对局积分处理，明细不丢分。
  const missing = pointsBreakdown([{ points: 1_000 }, { source: 'legacy:foo', points: 200 }]);
  assert.equal(missing.total, 1_200);
  assert.equal(missing.sources[0].points, 1_200);
  assert.equal(missing.sources[1].points, 0);
});

test('明细合计等于当前赛季积分：对局 + 已领取赛季悬赏 + 本赛季成就', () => {
  insertRun({ id: 'src-run-a', accountId: MATCH_TOKEN, score: 10_000 });
  insertRun({ id: 'src-run-b', accountId: MATCH_TOKEN, score: 5_000 });
  insertSeasonBounty({ accountId: MATCH_TOKEN, bountyId: 'veteran:extreme' });
  insertSeasonBounty({ accountId: MATCH_TOKEN, bountyId: 'slayer' });
  insertAchievement({ accountId: MATCH_TOKEN, achievementId: 'first_run' });
  insertAchievement({ accountId: MATCH_TOKEN, achievementId: 'win_abyss' });

  const expectedBounty =
    seasonBountyPoints('extreme') + seasonBountyPoints('normal');
  const expectedAchievement =
    seasonAchievementPoints(ACHIEVEMENT_BY_ID.first_run.rarity) +
    seasonAchievementPoints(ACHIEVEMENT_BY_ID.win_abyss.rarity);
  const expectedTotal = 15_000 + expectedBounty + expectedAchievement;

  const summary = seasonPassSummary(MATCH_TOKEN);
  assert.equal(summary.points, expectedTotal);

  const bySource = Object.fromEntries(summary.sources.map((item) => [item.source, item.points]));
  assert.deepEqual(bySource, {
    match: 15_000,
    bounty: expectedBounty,
    achievement: expectedAchievement,
  });
  assert.equal(
    summary.sources.reduce((sum, item) => sum + item.points, 0),
    summary.points,
    '来源明细合计与赛季积分不一致'
  );
  for (const item of summary.sources) {
    assert.ok(item.label, `来源 ${item.source} 缺少展示文案`);
  }

  const snapshot = db
    .prepare('SELECT points FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(MATCH_TOKEN, currentSeason);
  assert.equal(Number(snapshot.points), expectedTotal, '积分快照未落库');

  const stored = db
    .prepare(
      'SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?'
    )
    .get(MATCH_TOKEN, 'season_pass_sources', `sources:${currentSeason}`);
  assert.ok(stored, '来源明细未落库');
  const parsed = JSON.parse(stored.value_json);
  assert.equal(parsed.total, expectedTotal);
  assert.equal(parsed.sources.length, 3);
});

test('跨赛季边界：上赛季的对局、悬赏与成就都不计入本赛季', () => {
  const bounds = seasonBounds(currentSeason);
  const prevSeasonAt = bounds.start - 1_000;
  const prevSeason = seasonOf(prevSeasonAt);
  assert.notEqual(prevSeason, currentSeason);

  insertRun({
    id: 'src-prev-run',
    accountId: BOUNDARY_TOKEN,
    score: 900_000,
    createdAt: prevSeasonAt,
  });
  insertRun({ id: 'src-current-run', accountId: BOUNDARY_TOKEN, score: 1_000 });
  insertSeasonBounty({
    accountId: BOUNDARY_TOKEN,
    bountyId: 'veteran:extreme',
    season: prevSeason,
    claimedAt: prevSeasonAt,
  });
  insertAchievement({
    accountId: BOUNDARY_TOKEN,
    achievementId: 'win_abyss',
    unlockedAt: prevSeasonAt,
  });

  const summary = seasonPassSummary(BOUNDARY_TOKEN);
  assert.equal(summary.points, 1_000);
  assert.deepEqual(
    summary.sources.map((item) => item.points),
    [1_000, 0, 0],
    '上赛季来源漏进了本赛季'
  );
});

test('旧快照没有来源记录时整笔按对局积分处理', () => {
  const legacyPoints = 12_345;
  db.prepare(
    `INSERT INTO account_season_pass (account_id, season, points, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(LEGACY_TOKEN, currentSeason, legacyPoints, inSeasonAt);

  const summary = seasonPassSummary(LEGACY_TOKEN);
  assert.equal(summary.points, legacyPoints);
  assert.deepEqual(
    summary.sources.map((item) => [item.source, item.points]),
    [
      ['match', legacyPoints],
      ['bounty', 0],
      ['achievement', 0],
    ]
  );
});

test('面板在里程碑列表内展示来源明细，缺来源时给出占位', () => {
  assert.match(SEASON_PASS_UI, /data\?\.sources/, '面板未读取来源字段');
  assert.match(SEASON_PASS_UI, /season-pass-source-list/, '缺少来源明细列表');
  assert.match(SEASON_PASS_UI, /暂无积分来源/, '无来源时缺少占位');
  assert.match(SEASON_PASS_UI, /sourcesBlock\(data\)/, '来源明细未进入渲染流程');
  assert.match(SEASON_PASS_UI, /escapeHtml\(item\?\.label/, '来源文案未转义');
});
