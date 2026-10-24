// 赛季成就：按赛季派生 5 个轮换目标、复用现有判定流程、跨赛季隔离、历史赛季保留展示。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  SEASONAL_ACHIEVEMENTS,
  SEASONAL_PER_SEASON,
  achievementProgress,
  parseSeasonalAchievementId,
  seasonIndex,
  seasonalAchievementById,
  seasonalAchievementId,
  seasonalAchievementsFor,
} from '../public/js/shared/achievements.js';

const DB_PATH = path.join(os.tmpdir(), `rtd-seasonal-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let deps = null;

function shiftSeason(season, delta) {
  const index = seasonIndex(season) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

// 结算数据固定满足这些模板；榜单类与 15000 分档刻意留空，用来验证未达成分支。
const GUARANTEED = new Set([
  'runs_5',
  'runs_15',
  'wins_3',
  'wins_8',
  'score_8000',
  'days_5',
  'days_10',
  'kills_300',
  'kills_1200',
]);

before(async () => {
  const { db } = await import('../server/db/index.mjs');
  const accounts = await import('../server/db/accounts.mjs');
  const achievements = await import('../server/db/achievements.mjs');
  const { seasonOf, seasonBounds } = await import('../server/db/leaderboard.mjs');

  const account = accounts.createAccount({
    kind: 'registered',
    username: `seasonal${Date.now().toString(36)}`,
    passwordHash: 'seasonal-test-password',
  });
  const season = seasonOf();
  assert.ok(season, '当前赛季应可派生');
  const bounds = seasonBounds(season);

  const insert = db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, difficulty, seed, day, status, victory, score,
        wave_reached, kills, duration_ms, created_at, finished_at)
     VALUES (?, ?, 'normal', 'standard', ?, ?, 'finished', 1, ?, 30, 100, 60000, ?, ?)`
  );
  // 15 局分散在 15 个日期、每局 12000 分 / 100 击杀：覆盖除榜单与 15000 分外的所有模板。
  for (let i = 0; i < 15; i += 1) {
    const day = `${season}-${String(i + 1).padStart(2, '0')}`;
    const createdAt = bounds.start + i * 3600 * 1000;
    insert.run(
      `seasonal-${i}`,
      account.id,
      `s${i}`,
      day,
      12000,
      createdAt,
      createdAt
    );
  }

  deps = {
    db,
    accounts,
    achievements,
    seasonOf,
    account,
    season,
  };
});

after(() => {
  try {
    deps?.db?.close();
  } catch {
    /* 已关闭 */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
});

test('赛季派生：每季 5 个目标，同季稳定、跨季轮换且赛季 id 隔离', () => {
  const season = '2026-10';
  const first = seasonalAchievementsFor(season);
  const second = seasonalAchievementsFor(season);
  assert.equal(first.length, SEASONAL_PER_SEASON);
  assert.equal(new Set(first.map((item) => item.id)).size, SEASONAL_PER_SEASON);
  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id),
    '同一赛季必须稳定派生同一组目标'
  );
  for (const template of first) {
    assert.equal(template.seasonal, true);
    assert.equal(typeof template.check, 'function');
  }

  // 相邻赛季窗口顺移：12 个连续赛季后覆盖整个模板池。
  const seen = new Set();
  for (let i = 0; i < 12; i += 1) {
    const ids = seasonalAchievementsFor(shiftSeason(season, i)).map((item) => item.id);
    assert.equal(new Set(ids).size, SEASONAL_PER_SEASON);
    for (const id of ids) seen.add(id);
  }
  assert.equal(seen.size, SEASONAL_ACHIEVEMENTS.length, '12 个赛季应覆盖全部模板');

  assert.deepEqual(seasonalAchievementsFor('2026-13'), []);
  assert.deepEqual(seasonalAchievementsFor(''), []);
  assert.equal(seasonIndex('2026-10'), seasonIndex('2026-09') + 1);

  const id = seasonalAchievementId('2026-10', 'runs_5');
  assert.notEqual(id, seasonalAchievementId('2026-11', 'runs_5'));
  assert.deepEqual(parseSeasonalAchievementId(id), { season: '2026-10', templateId: 'runs_5' });
  assert.equal(parseSeasonalAchievementId('season_runs_10'), null);
  assert.equal(seasonalAchievementById('seasonal:2026-10:unknown'), null);
  assert.equal(seasonalAchievementById(id).id, 'runs_5');
});

test('赛季进度读取本赛季统计并封顶', () => {
  const seasonCtx = {
    key: '2026-10',
    runs: 3,
    wins: 1,
    bestScore: 9000,
    kills: 400,
    days: 2,
    rank: null,
  };
  const progressOf = (id) =>
    achievementProgress(SEASONAL_ACHIEVEMENTS.find((item) => item.id === id), {
      season: seasonCtx,
    });

  assert.deepEqual(progressOf('runs_5'), { current: 3, target: 5 });
  assert.deepEqual(progressOf('score_8000'), { current: 8000, target: 8000 });
  assert.deepEqual(progressOf('kills_300'), { current: 300, target: 300 });
  assert.deepEqual(progressOf('days_10'), { current: 2, target: 10 });
  // 榜单类是判定型成就，没有进度结构。
  assert.equal(progressOf('top_20'), null);

  const top20 = SEASONAL_ACHIEVEMENTS.find((item) => item.id === 'top_20');
  const top5 = SEASONAL_ACHIEVEMENTS.find((item) => item.id === 'top_5');
  assert.equal(top20.check({ season: { ...seasonCtx, rank: null } }), false);
  assert.equal(top20.check({ season: { ...seasonCtx, rank: 18 } }), true);
  assert.equal(top5.check({ season: { ...seasonCtx, rank: 18 } }), false);
  assert.equal(top5.check({ season: { ...seasonCtx, rank: 3 } }), true);
});

test('结算解锁当前赛季成就，重复结算不重复解锁', () => {
  const { achievements, account, season } = deps;
  const first = achievements.unlockAchievements(account.id, {});
  const seasonalAdded = first.filter((id) => id.startsWith('seasonal:'));
  assert.ok(seasonalAdded.length >= 3, `应解锁多个赛季成就，实际：${seasonalAdded.join(',')}`);

  for (const id of seasonalAdded) {
    const parsed = parseSeasonalAchievementId(id);
    assert.ok(parsed, `赛季成就 id 结构错误：${id}`);
    assert.equal(parsed.season, season, '只应解锁当前赛季的成就');
  }

  const currentIds = new Map(
    seasonalAchievementsFor(season).map((template) => [
      template.id,
      seasonalAchievementId(season, template.id),
    ])
  );
  for (const [templateId, id] of currentIds) {
    assert.equal(
      seasonalAdded.includes(id),
      GUARANTEED.has(templateId),
      `${templateId} 的解锁状态与结算数据不符`
    );
  }

  // 同一赛季重复结算不再上报，也不重复插入。
  const second = achievements.unlockAchievements(account.id, {});
  assert.deepEqual(
    second.filter((id) => id.startsWith('seasonal:')),
    []
  );
  const count = () =>
    deps.db
      .prepare(
        "SELECT COUNT(*) AS c FROM account_achievements WHERE account_id = ? AND achievement_id LIKE 'seasonal:%'"
      )
      .get(account.id).c;
  assert.equal(count(), seasonalAdded.length);

  const summary = achievements.achievementSummary(account.id);
  assert.equal(summary.seasonal.season, season);
  assert.equal(summary.seasonal.total, SEASONAL_PER_SEASON);
  assert.equal(summary.seasonal.achievements.length, SEASONAL_PER_SEASON);
  assert.equal(summary.seasonal.unlockedCount, seasonalAdded.length);
  assert.equal(summary.seasonalHistory.length, 0, '当前赛季不应出现在历史里');
  for (const item of summary.seasonal.achievements) {
    assert.match(item.id, /^seasonal:\d{4}-\d{2}:/);
    assert.equal(item.unlocked, seasonalAdded.includes(item.id));
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.desc, 'string');
    if (item.progress) {
      assert.ok(item.progress.current >= 0 && item.progress.current <= item.progress.target);
    }
  }
});

test('往季成就保留为荣誉历史，且不串到本赛季', () => {
  const { achievements, accounts, account, season } = deps;
  const fresh = accounts.createAccount({
    kind: 'registered',
    username: `seasonal-hist${Date.now().toString(36)}`,
    passwordHash: 'seasonal-test-password',
  });

  const pastSeason = shiftSeason(season, -1);
  const pastTemplate = seasonalAchievementsFor(pastSeason)[0];
  const pastId = seasonalAchievementId(pastSeason, pastTemplate.id);
  const unlockedAt = Date.now() - 7 * 24 * 3600 * 1000;
  deps.db
    .prepare(
      `INSERT INTO account_achievements (account_id, achievement_id, unlocked_at)
       VALUES (?, ?, ?)`
    )
    .run(fresh.id, pastId, unlockedAt);

  const summary = achievements.achievementSummary(fresh.id);
  assert.equal(summary.seasonal.season, season);
  assert.equal(summary.seasonal.unlockedCount, 0, '往季解锁不得算进本赛季');
  assert.ok(
    summary.seasonal.achievements.every((item) => item.id !== pastId),
    '本赛季列表不得包含往季成就'
  );

  assert.equal(summary.seasonalHistory.length, 1);
  const entry = summary.seasonalHistory[0];
  assert.equal(entry.season, pastSeason);
  assert.equal(entry.total, 1);
  assert.equal(entry.achievements.length, 1);
  assert.equal(entry.achievements[0].id, pastId);
  assert.equal(entry.achievements[0].templateId, pastTemplate.id);
  assert.equal(entry.achievements[0].title, pastTemplate.title);
  assert.equal(entry.achievements[0].unlocked, true);
  assert.equal(entry.achievements[0].unlockedAt, unlockedAt);

  // 若往季目标恰好也在本赛季轮换池中，本赛季那份仍必须保持未解锁。
  const sameTemplate = summary.seasonal.achievements.find(
    (item) => item.templateId === pastTemplate.id
  );
  if (sameTemplate) assert.equal(sameTemplate.unlocked, false);

  // 本赛季再结算也不会把往季记录洗掉或重复解锁。
  const added = achievements.unlockAchievements(fresh.id, {});
  assert.ok(!added.includes(pastId));
  assert.equal(achievements.achievementSummary(fresh.id).seasonalHistory.length, 1);
});
