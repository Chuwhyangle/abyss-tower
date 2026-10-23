// 成就深度 v2：45+ 规模 / 新增 15 条 / id 唯一 / 新进度计算 / 服务端统计 / 隐藏遮罩 / 旧 id 兼容。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_RARITIES,
  achievementProgress,
  evaluateAchievements,
} from '../public/js/shared/achievements.js';

const NEW_IDS = [
  'skill_level_3',
  'skill_abyss_win_5',
  'skill_levels_20',
  'skill_all_max',
  'season_runs_10',
  'season_wins_5',
  'season_score_5000',
  'season_score_12000',
  'season_days_7',
  'season_top_10',
  'flawless_win',
  'flawless_win_3',
  'abyss_speedrun',
  'abyss_score_12000',
  'hidden_abyss_flawless',
];

const LEGACY_IDS = [
  'first_run',
  'first_win',
  'win_roam',
  'win_standard',
  'win_abyss',
  'all_difficulties',
  'boss_slayer',
  'wave_5',
  'wave_10',
  'wave_20',
  'wave_30',
  'speedrun',
  'relic_level_2',
  'relic_max',
  'relic_max_3',
  'relic_collector',
  'hidden_no_relic_win',
  'kills_100',
  'kills_1000',
  'kills_5000',
  'runs_10',
  'runs_50',
  'wins_5',
  'wins_20',
  'score_5000',
  'score_10000',
  'hidden_perfect_run',
  'daily_first',
  'daily_win',
  'daily_5',
  'achievement_10',
  'achievement_20',
  'skill_select',
  'skill_unlock_meteor',
  'skill_all_unlocked',
  'skill_max',
  'skill_abyss_win',
];

const DB_PATH = path.join(os.tmpdir(), `rtd-ach-depth2-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let deps = null;
let seasonKey = '';

before(async () => {
  const { db } = await import('../server/db/index.mjs');
  const accounts = await import('../server/db/accounts.mjs');
  const achievements = await import('../server/db/achievements.mjs');
  const { seasonOf } = await import('../server/db/leaderboard.mjs');

  const now = Date.now();
  seasonKey = seasonOf(now);
  const account = accounts.createAccount({
    kind: 'registered',
    username: `depth2${now.toString(36)}`,
    passwordHash: 'depth2-test-password',
  });
  const rival = accounts.createAccount({
    kind: 'registered',
    username: `depth2r${now.toString(36)}`,
    passwordHash: 'depth2-test-password',
  });

  const insertRun = db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, difficulty, seed, day, status, victory, score,
        wave_reached, kills, duration_ms, ruleset_json, result_json, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ruleset = (startHp, skillId) =>
    JSON.stringify({ v: 1, skill: { id: skillId, level: 10 }, meta: { baseHp: startHp } });
  const result = (baseHp) => JSON.stringify({ baseHp });

  // 3 局：标准无伤通关、深渊无伤通关、标准失败（基地受损），分布在 3 个日期。
  insertRun.run('d2-r1', account.id, 'normal', 'standard', 's1', `${seasonKey}-01`, 1, 6000, 30, 200, 900000, ruleset(20, 'meteor'), result(20), now, now);
  insertRun.run('d2-r2', account.id, 'normal', 'abyss', 's2', `${seasonKey}-02`, 1, 13000, 30, 300, 600000, ruleset(17, 'chrono'), result(17), now, now);
  insertRun.run('d2-r3', account.id, 'normal', 'standard', 's3', `${seasonKey}-03`, 0, 2000, 8, 100, 300000, ruleset(20, 'aurora'), result(5), now, now);

  // 技能养成：三技能全部满级（10 级）。
  const insertSkill = db.prepare(
    `INSERT INTO player_progress
       (account_id, progress_type, progress_key, value_num, state_json, updated_at)
     VALUES (?, 'skill', ?, 10, '{}', ?)`
  );
  for (const id of ['aurora', 'meteor', 'chrono']) insertSkill.run(account.id, id, now);

  // 赛季榜单：本人 1000 分，对手 5000 分 → 本人赛季最佳排名第 2。
  const insertEntry = db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES ('normal', ?, ?, NULL, 'standard', ?, 60000, 'v1.4-map2', '{}', ?)`
  );
  insertEntry.run(account.id, '本人', 1000, now);
  insertEntry.run(rival.id, '对手', 5000, now);

  deps = { db, account, ...achievements };
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

test('成就定义：数量 ≥45、新增 15 条、id 唯一、分组与稀有度合法', () => {
  assert.ok(ACHIEVEMENTS.length >= 45, `实际 ${ACHIEVEMENTS.length} 条`);
  const ids = new Set();
  for (const achievement of ACHIEVEMENTS) {
    assert.ok(!ids.has(achievement.id), `重复 id：${achievement.id}`);
    ids.add(achievement.id);
    assert.ok(
      ACHIEVEMENT_GROUPS.some((group) => group.id === achievement.group),
      `非法分组：${achievement.group}`
    );
    assert.ok(ACHIEVEMENT_RARITIES[achievement.rarity], `非法稀有度：${achievement.rarity}`);
    assert.equal(typeof achievement.hidden, 'boolean');
    assert.equal(typeof achievement.check, 'function');
    if (achievement.target !== undefined) {
      assert.ok(Number.isInteger(achievement.target) && achievement.target > 0);
      assert.equal(typeof achievement.progress, 'function');
    }
  }
  for (const id of NEW_IDS) {
    assert.ok(ACHIEVEMENT_BY_ID[id], `缺少新增成就：${id}`);
    assert.ok(ACHIEVEMENT_BY_ID[id].desc.length > 0, `新增成就缺少文案：${id}`);
    assert.ok(ACHIEVEMENT_BY_ID[id].condition.length > 0, `新增成就缺少达成条件：${id}`);
  }
});

test('旧成就 id 保持兼容', () => {
  for (const id of LEGACY_IDS) assert.ok(ACHIEVEMENT_BY_ID[id], `旧成就定义缺失：${id}`);
});

test('新进度计算：技能 / 赛季 / 无伤 / 深渊极值，并封顶到目标值', () => {
  const ctx = {
    run: null,
    stats: { byDifficulty: { abyss: { bestScore: 9000 } } },
    skills: { levels: { aurora: 10, meteor: 5, chrono: 5 } },
    season: { runs: 4, wins: 1, bestScore: 3000, days: 2, rank: 12 },
    noDamageWins: 2,
    abyssFlawlessWins: 1,
  };
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.skill_levels_20, ctx), {
    current: 20,
    target: 20,
  });
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.skill_all_max, ctx), {
    current: 1,
    target: 3,
  });
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.season_runs_10, ctx), {
    current: 4,
    target: 10,
  });
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.season_days_7, ctx), {
    current: 2,
    target: 7,
  });
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.flawless_win_3, ctx), {
    current: 2,
    target: 3,
  });
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.abyss_score_12000, ctx), {
    current: 9000,
    target: 12000,
  });
  // 非进度型新成就没有进度结构。
  assert.equal(achievementProgress(ACHIEVEMENT_BY_ID.season_top_10, ctx), null);
  assert.equal(achievementProgress(ACHIEVEMENT_BY_ID.abyss_speedrun, ctx), null);
});

test('新成就按上下文解锁', () => {
  const ctx = {
    run: {
      mode: 'normal',
      difficulty: 'abyss',
      victory: true,
      waveReached: 30,
      kills: 300,
      score: 13000,
      durationMs: 10 * 60 * 1000,
      relics: [],
    },
    stats: {
      runs: 3,
      wins: 2,
      kills: 600,
      byDifficulty: {
        roam: { runs: 0, wins: 0, bestWave: 0, bestScore: 0 },
        standard: { runs: 2, wins: 1, bestWave: 30, bestScore: 6000 },
        abyss: { runs: 1, wins: 1, bestWave: 30, bestScore: 13000 },
      },
    },
    skills: {
      levels: { aurora: 10, meteor: 10, chrono: 10 },
      unlocked: { aurora: true, meteor: true, chrono: true },
      selected: 'aurora',
    },
    skillAbyssWins: 5,
    noDamageWins: 3,
    abyssFlawlessWins: 1,
    season: { key: seasonKey, runs: 10, wins: 5, bestScore: 12000, days: 7, rank: 8 },
    unlocked: new Set(),
  };
  const added = evaluateAchievements(ctx);
  for (const id of NEW_IDS) assert.ok(added.includes(id), `未解锁：${id}（实际 ${added.join(',')}）`);

  // 未达标的赛季排名不触发。
  const lowRank = evaluateAchievements({
    ...ctx,
    unlocked: new Set(added),
    season: { ...ctx.season, rank: 11 },
  });
  assert.ok(!lowRank.includes('season_top_10'));
});

test('服务端统计：无伤 / 赛季 / 技能进度来自数据库，隐藏成就遮罩', () => {
  const summary = deps.achievementSummary(deps.account.id);
  assert.ok(summary.total >= 45);
  const byId = new Map(summary.achievements.map((item) => [item.id, item]));

  // 2 次无伤通关（标准 + 深渊），其中深渊 1 次。
  assert.deepEqual(byId.get('flawless_win_3').progress, { current: 2, target: 3 });
  // 当前赛季 3 局、3 个活跃日、最高 13000 分。
  assert.deepEqual(byId.get('season_runs_10').progress, { current: 3, target: 10 });
  assert.deepEqual(byId.get('season_days_7').progress, { current: 3, target: 7 });
  assert.deepEqual(byId.get('season_score_12000').progress, { current: 12000, target: 12000 });
  // 技能三件满级、等级总和 30（封顶 20）。
  assert.deepEqual(byId.get('skill_all_max').progress, { current: 3, target: 3 });
  assert.deepEqual(byId.get('skill_levels_20').progress, { current: 20, target: 20 });
  // 深渊最高分 13000（封顶 12000）。
  assert.deepEqual(byId.get('abyss_score_12000').progress, { current: 12000, target: 12000 });

  const lockedHidden = summary.achievements.filter((item) => item.hidden && !item.unlocked);
  assert.ok(lockedHidden.length >= 1);
  const payload = JSON.stringify(summary);
  for (const item of lockedHidden) {
    assert.equal(item.title, '???');
    assert.equal(item.desc, '');
    assert.equal(item.condition, '???');
    assert.equal(item.progress, null);
    assert.ok(!payload.includes(ACHIEVEMENT_BY_ID[item.id].desc), '隐藏成就描述泄漏');
  }
});

test('结算判定：按服务端状态解锁新成就，且不重复写入', () => {
  const context = {
    run: {
      mode: 'normal',
      difficulty: 'abyss',
      victory: true,
      waveReached: 30,
      kills: 300,
      score: 13000,
      durationMs: 10 * 60 * 1000,
      relics: [],
    },
    stats: {
      runs: 3,
      wins: 2,
      kills: 600,
      byDifficulty: {
        roam: { runs: 0, wins: 0, bestWave: 0, bestScore: 0 },
        standard: { runs: 2, wins: 1, bestWave: 30, bestScore: 6000 },
        abyss: { runs: 1, wins: 1, bestWave: 30, bestScore: 13000 },
      },
    },
  };
  const added = deps.unlockAchievements(deps.account.id, context);
  for (const id of [
    'flawless_win',
    'hidden_abyss_flawless',
    'abyss_speedrun',
    'abyss_score_12000',
    'skill_level_3',
    'skill_levels_20',
    'skill_all_max',
    'season_score_5000',
    'season_score_12000',
    'season_top_10',
  ]) {
    assert.ok(added.includes(id), `未解锁：${id}（实际 ${added.join(',')}）`);
  }
  // 数据未达标的成就保持锁定。
  for (const id of ['season_runs_10', 'season_wins_5', 'season_days_7', 'skill_abyss_win_5', 'flawless_win_3']) {
    assert.ok(!added.includes(id), `不应解锁：${id}`);
  }
  // 幂等：重复结算不重复上报。
  assert.deepEqual(deps.unlockAchievements(deps.account.id, context), []);

  const summary = deps.achievementSummary(deps.account.id);
  const byId = new Map(summary.achievements.map((item) => [item.id, item]));
  // 已解锁的隐藏成就揭晓真实描述。
  assert.equal(byId.get('hidden_abyss_flawless').unlocked, true);
  assert.notEqual(byId.get('hidden_abyss_flawless').desc, '');
  // 仍未解锁的隐藏成就继续遮罩。
  assert.equal(byId.get('hidden_perfect_run').unlocked, false);
  assert.equal(byId.get('hidden_perfect_run').desc, '');
});
