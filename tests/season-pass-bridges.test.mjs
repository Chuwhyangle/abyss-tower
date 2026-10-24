// 通行证联动：悬赏领取与成就解锁在各自事务内写入积分，重复调用不重复计分。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BOUNTY_PERIODS,
  bountyPeriodBounds,
  bountyPeriodKey,
  deriveBounties,
} from '../public/js/shared/bounties.js';
import {
  SEASON_POINT_LEDGER_NAMESPACE,
  SEASON_POINT_SOURCES,
  seasonAchievementPoints,
  seasonAchievementUnlockPoints,
  seasonBountyPoints,
} from '../public/js/shared/season-pass.js';
import {
  ACHIEVEMENT_BY_ID,
  seasonalAchievementById,
} from '../public/js/shared/achievements.js';

const UNIT_DB = path.join(os.tmpdir(), `rtd-season-bridges-${process.pid}-${Date.now()}.db`);

const BOUNTY_TOKEN = 'season-bridges-bounty-token';
const BONUS_TOKEN = 'season-bridges-bonus-token';
const LEGACY_TOKEN = 'season-bridges-legacy-token';

// 60 局高分对局足以覆盖任何赛季悬赏的指标，同时给出确定的对局积分总量。
const RUN_COUNT = 60;
const RUN_SCORE = 200_000;
const EXPECTED_MATCH_POINTS = RUN_COUNT * RUN_SCORE;
const DAY_MS = 24 * 60 * 60 * 1000;

let db = null;
let createProfile = null;
let seasonPassSummary = null;
let claimBounty = null;
let unlockAchievements = null;

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

function insertRun({ id, accountId, createdAt, score = RUN_SCORE }) {
  db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, board_key, difficulty, seed, day, content_version,
        ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
        rerolls_used, status, victory, score, wave_reached, kills, duration_ms,
        result_json, created_at, finished_at)
     VALUES (?, ?, 'normal', 'normal', ?, ?, '2026-10-24', 'v1.4-map2', ?, 20, 20, -1, '[]', '{}',
             0, 'finished', 1, ?, 100, 2000, 60000, ?, ?, ?)`
  ).run(
    id,
    accountId,
    id.endsWith('abyss') ? 'abyss' : 'standard',
    `seed-${id}`,
    JSON.stringify({ meta: { baseHp: 20 } }),
    score,
    JSON.stringify({ baseHp: 20 }),
    createdAt,
    createdAt + 60_000
  );
}

// 同一悬赏 id 会在不同周期重复出现；claimBounty 按日→周→赛季取第一条匹配。
// 这里向后找一个「赛季悬赏 id 不与日/周重合」的时间点，确保测的是赛季领取。
function findSeasonOnlyPeriod() {
  for (let offset = 0; offset <= 120; offset += 1) {
    const now = Date.now() + offset * DAY_MS;
    const taken = new Set(
      BOUNTY_PERIODS.filter((period) => period !== 'season').flatMap((period) =>
        deriveBounties(period, bountyPeriodKey(period, now)).map((item) => item.id)
      )
    );
    const seasonDefs = deriveBounties('season', bountyPeriodKey('season', now));
    const unique = seasonDefs.find((item) => !taken.has(item.id));
    if (unique) return { now, definition: unique };
  }
  throw new Error('找不到只属于赛季周期的悬赏 id');
}

function seasonRow(accountId) {
  return db
    .prepare('SELECT points, updated_at FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(accountId, bountyPeriodKey('season', Date.now()));
}

function seasonRowAt(accountId, now) {
  return db
    .prepare('SELECT points, updated_at FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(accountId, bountyPeriodKey('season', now));
}

function bonusLedgerCount(accountId) {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM player_kv WHERE account_id = ? AND namespace = ?')
    .get(accountId, SEASON_POINT_LEDGER_NAMESPACE);
  return Number(row?.total) || 0;
}

function sourcePoints(summary) {
  return Object.fromEntries(summary.sources.map((item) => [item.source, item.points]));
}

function sumSources(summary) {
  return summary.sources.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
}

function rarityOf(id) {
  return (ACHIEVEMENT_BY_ID[id] || seasonalAchievementById(id))?.rarity;
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({ seasonPassSummary } = await import('../server/db/season_pass.mjs'));
  ({ claimBounty } = await import('../server/db/bounties.mjs'));
  ({ unlockAchievements } = await import('../server/db/achievements.mjs'));

  seedAccount(BOUNTY_TOKEN);
  seedAccount(BONUS_TOKEN);
  seedAccount(LEGACY_TOKEN);
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

test('悬赏领取在事务内写入通行证积分，重复领取不重复计分', () => {
  const { now, definition } = findSeasonOnlyPeriod();
  const bounds = bountyPeriodBounds('season', now);
  const createdAt = bounds.start + 60_000;

  for (let index = 0; index < RUN_COUNT; index += 1) {
    insertRun({
      id: `bridge-run-${index}${index % 2 === 0 ? '-abyss' : ''}`,
      accountId: BOUNTY_TOKEN,
      createdAt,
    });
  }

  assert.equal(seasonRowAt(BOUNTY_TOKEN, now), undefined, '领取前不应有积分快照');

  const claimed = claimBounty(BOUNTY_TOKEN, definition.id, now);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.claimed, true, '悬赏未成功领取');

  const expectedBounty = seasonBountyPoints(definition.tier);
  assert.ok(expectedBounty > 0, '赛季悬赏档位没有对应积分');

  // 不调用 seasonPassSummary：快照必须由领取事务自己写入。
  const afterClaim = seasonRowAt(BOUNTY_TOKEN, now);
  assert.ok(afterClaim, '领取没有写入积分快照');
  assert.equal(
    Number(afterClaim.points),
    EXPECTED_MATCH_POINTS + expectedBounty,
    '领取后的积分快照未包含悬赏积分'
  );

  const summary = seasonPassSummary(BOUNTY_TOKEN, now);
  assert.equal(summary.points, EXPECTED_MATCH_POINTS + expectedBounty);
  assert.equal(sourcePoints(summary).bounty, expectedBounty);
  assert.equal(sourcePoints(summary).match, EXPECTED_MATCH_POINTS);
  assert.equal(sumSources(summary), summary.points, '来源明细合计与赛季积分不一致');

  const again = claimBounty(BOUNTY_TOKEN, definition.id, now);
  assert.equal(again.ok, true);
  assert.equal(again.alreadyClaimed, true);
  assert.equal(again.claimed, false);

  assert.equal(
    Number(seasonRowAt(BOUNTY_TOKEN, now).points),
    EXPECTED_MATCH_POINTS + expectedBounty,
    '重复领取导致积分重复累计'
  );
  assert.equal(seasonPassSummary(BOUNTY_TOKEN, now).points, summary.points);
});

test('成就解锁发放一次性通行证加成，同一成就不重复计分', () => {
  const context = {
    run: {
      mode: 'normal',
      difficulty: 'standard',
      victory: true,
      waveReached: 30,
      kills: 100,
      score: 50_000,
      durationMs: 60_000,
      relics: [],
    },
    stats: {
      runs: 1,
      wins: 1,
      kills: 100,
      byDifficulty: { standard: { runs: 1, wins: 1, bestWave: 30, bestScore: 50_000 } },
    },
  };

  const first = unlockAchievements(BONUS_TOKEN, context);
  assert.ok(first.length > 0, '测试上下文没有解锁任何成就');

  const expectedBonus = first.reduce(
    (sum, id) => sum + seasonAchievementUnlockPoints(rarityOf(id)),
    0
  );
  const expectedDerived = first.reduce((sum, id) => {
    const rarity = ACHIEVEMENT_BY_ID[id]?.rarity;
    return sum + seasonAchievementPoints(rarity);
  }, 0);
  assert.ok(expectedBonus > 0, '解锁的成就没有对应加成');

  // 解锁事务自己写入快照：此时还没有调用 seasonPassSummary。
  const afterUnlock = seasonRow(BONUS_TOKEN);
  assert.ok(afterUnlock, '解锁没有写入积分快照');
  assert.equal(
    Number(afterUnlock.points),
    expectedDerived + expectedBonus,
    '解锁事务写入的积分缺少一次性加成'
  );
  assert.equal(bonusLedgerCount(BONUS_TOKEN), first.length, '加成账本与解锁数量不一致');

  const summary = seasonPassSummary(BONUS_TOKEN);
  const bySource = sourcePoints(summary);
  assert.equal(bySource.achievement, expectedDerived);
  assert.equal(bySource[SEASON_POINT_SOURCES.ACHIEVEMENT_BONUS], expectedBonus);
  assert.equal(summary.points, expectedDerived + expectedBonus);
  assert.equal(sumSources(summary), summary.points, '来源明细合计与赛季积分不一致');

  const second = unlockAchievements(BONUS_TOKEN, context);
  assert.deepEqual(second, [], '重复结算不应再次解锁');

  assert.equal(bonusLedgerCount(BONUS_TOKEN), first.length, '重复结算写入了额外加成');
  assert.equal(
    Number(seasonRow(BONUS_TOKEN).points),
    expectedDerived + expectedBonus,
    '重复结算导致积分重复累计'
  );
  assert.equal(seasonPassSummary(BONUS_TOKEN).points, summary.points);
});

test('旧档案只有成就记录时按稀有度派生积分，不追溯发放加成', () => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO account_achievements (account_id, achievement_id, unlocked_at)
     VALUES (?, 'first_run', ?)`
  ).run(LEGACY_TOKEN, now);

  const summary = seasonPassSummary(LEGACY_TOKEN);
  const bySource = sourcePoints(summary);
  assert.equal(bySource.achievement, seasonAchievementPoints('common'));
  assert.equal(bySource[SEASON_POINT_SOURCES.ACHIEVEMENT_BONUS], undefined);
  assert.equal(summary.points, seasonAchievementPoints('common'));
  assert.equal(sumSources(summary), summary.points);
  assert.equal(bonusLedgerCount(LEGACY_TOKEN), 0, '旧档案被补发了加成');
});
