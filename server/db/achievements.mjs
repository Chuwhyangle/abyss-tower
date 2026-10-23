// 成就持久化：读取已解锁状态，按结算上下文幂等写入新解锁。
import { db } from './index.mjs';
import { careerStats } from './stats.mjs';
import { seasonBounds, seasonOf } from './leaderboard.mjs';
import { readSelectedSkill, readSkillLevels, skillUnlocked } from './skills.mjs';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_RARITIES,
  COSMETIC_FRAMES,
  COSMETIC_TITLES,
  achievementProgress,
  evaluateAchievements,
} from '../../public/js/shared/achievements.js';
import { SKILL_ORDER } from '../../public/js/shared/data.js';

const COSMETIC_NAMESPACE = 'cosmetics';
const SELECTED_COSMETIC_KEY = 'selected';

// 外观 id → 授予它的成就，接口据此展示来源。
const COSMETIC_SOURCES = (() => {
  const sources = { title: new Map(), frame: new Map() };
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.reward?.title) sources.title.set(achievement.reward.title, achievement);
    if (achievement.reward?.frame) sources.frame.set(achievement.reward.frame, achievement);
  }
  return sources;
})();

function cosmeticKey(kind, id) {
  return `${kind}:${id}`;
}

// 解锁写入 player_kv：title:<id> / frame:<id>，值记录来源成就与时间。
function writeCosmeticUnlocks(accountId, achievementIds, now) {
  const insert = db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO NOTHING`
  );
  for (const achievementId of achievementIds) {
    const reward = ACHIEVEMENT_BY_ID[achievementId]?.reward;
    if (!reward) continue;
    const value = JSON.stringify({ achievementId, unlockedAt: now });
    if (reward.title) insert.run(accountId, COSMETIC_NAMESPACE, cosmeticKey('title', reward.title), value, now);
    if (reward.frame) insert.run(accountId, COSMETIC_NAMESPACE, cosmeticKey('frame', reward.frame), value, now);
  }
}

// 已解锁外观 = player_kv 记录 ∪ 成就表派生（后者覆盖上线前已解锁的老档案）。
export function unlockedCosmetics(accountId) {
  const titles = new Set();
  const frames = new Set();
  for (const achievementId of listUnlocked(accountId).keys()) {
    const reward = ACHIEVEMENT_BY_ID[achievementId]?.reward;
    if (reward?.title) titles.add(reward.title);
    if (reward?.frame) frames.add(reward.frame);
  }
  const rows = db
    .prepare('SELECT key FROM player_kv WHERE account_id = ? AND namespace = ?')
    .all(accountId, COSMETIC_NAMESPACE);
  for (const row of rows) {
    const [kind, id] = String(row.key).split(':');
    if (kind === 'title' && COSMETIC_TITLES[id]) titles.add(id);
    else if (kind === 'frame' && COSMETIC_FRAMES[id]) frames.add(id);
  }
  return { titles, frames };
}

// 无选择 / 选择已失效时返回 null，旧档案因此默认无称号、无头像框。
export function readSelectedCosmetics(accountId, unlocks = unlockedCosmetics(accountId)) {
  const row = db
    .prepare('SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?')
    .get(accountId, COSMETIC_NAMESPACE, SELECTED_COSMETIC_KEY);
  let state = {};
  try {
    state = JSON.parse(row?.value_json || '{}') || {};
  } catch {
    state = {};
  }
  return {
    title: unlocks.titles.has(state.title) ? state.title : null,
    frame: unlocks.frames.has(state.frame) ? state.frame : null,
  };
}

// patch 只包含请求里显式给出的字段；undefined 表示保持原值。
export function setSelectedCosmetics(accountId, patch = {}) {
  const unlocks = unlockedCosmetics(accountId);
  const next = readSelectedCosmetics(accountId, unlocks);
  if (patch.title !== undefined) {
    if (patch.title !== null && !COSMETIC_TITLES[patch.title]) {
      return { ok: false, code: 'UNKNOWN_TITLE' };
    }
    if (patch.title !== null && !unlocks.titles.has(patch.title)) {
      return { ok: false, code: 'TITLE_LOCKED' };
    }
    next.title = patch.title;
  }
  if (patch.frame !== undefined) {
    if (patch.frame !== null && !COSMETIC_FRAMES[patch.frame]) {
      return { ok: false, code: 'UNKNOWN_FRAME' };
    }
    if (patch.frame !== null && !unlocks.frames.has(patch.frame)) {
      return { ok: false, code: 'FRAME_LOCKED' };
    }
    next.frame = patch.frame;
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`
  ).run(accountId, COSMETIC_NAMESPACE, SELECTED_COSMETIC_KEY, JSON.stringify(next), now);
  return { ok: true, selected: next };
}

function cosmeticCatalogView(kind, unlocks) {
  const catalog = kind === 'title' ? COSMETIC_TITLES : COSMETIC_FRAMES;
  const owned = kind === 'title' ? unlocks.titles : unlocks.frames;
  return Object.values(catalog).map((item) => {
    const source = COSMETIC_SOURCES[kind].get(item.id) || null;
    return {
      ...item,
      unlocked: owned.has(item.id),
      achievementId: source?.id || null,
      achievementTitle: source?.title || null,
    };
  });
}

export function cosmeticSummary(accountId) {
  const unlocks = unlockedCosmetics(accountId);
  return {
    selected: readSelectedCosmetics(accountId, unlocks),
    titles: cosmeticCatalogView('title', unlocks),
    frames: cosmeticCatalogView('frame', unlocks),
  };
}

function unlockedRows(accountId) {
  return db
    .prepare(
      'SELECT achievement_id, unlocked_at FROM account_achievements WHERE account_id = ? ORDER BY unlocked_at ASC'
    )
    .all(accountId);
}

function dailySummary(accountId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(victory), 0) AS wins
         FROM runs
        WHERE account_id = ? AND mode = 'daily' AND status = 'finished'`
    )
    .get(accountId);
  return { runs: Number(row?.runs) || 0, wins: Number(row?.wins) || 0 };
}

// 技能养成状态：等级/选择来自 player_progress，解锁同时兼容显式授予与历史首通派生。
function skillContext(accountId) {
  const levels = readSkillLevels(accountId);
  const unlocked = {};
  for (const id of SKILL_ORDER) unlocked[id] = skillUnlocked(accountId, id);
  return { levels, unlocked, selected: readSelectedSkill(accountId) };
}

// 带技能通关深渊的局数：旧局缺少 ruleset.skill 时不计入。
function skillAbyssWins(accountId) {
  const rows = db
    .prepare(
      `SELECT ruleset_json FROM runs
        WHERE account_id = ? AND status = 'finished' AND victory = 1 AND difficulty = 'abyss'`
    )
    .all(accountId);
  let wins = 0;
  for (const row of rows) {
    try {
      if (JSON.parse(row.ruleset_json || '{}')?.skill?.id) wins += 1;
    } catch {
      /* 旧数据不是合法 JSON，忽略 */
    }
  }
  return wins;
}

// 无伤通关：结算时剩余基地生命不小于开局生命。旧局缺少 ruleset.meta 时无法判定，不计入。
function flawlessSummary(accountId) {
  const rows = db
    .prepare(
      `SELECT difficulty, ruleset_json, result_json FROM runs
        WHERE account_id = ? AND status = 'finished' AND victory = 1`
    )
    .all(accountId);
  let wins = 0;
  let abyssWins = 0;
  for (const row of rows) {
    try {
      const startHp = Number(JSON.parse(row.ruleset_json || '{}')?.meta?.baseHp);
      const leftHp = Number(JSON.parse(row.result_json || '{}')?.baseHp);
      if (!Number.isFinite(startHp) || startHp <= 0 || !Number.isFinite(leftHp)) continue;
      if (leftHp < startHp) continue;
      wins += 1;
      if (row.difficulty === 'abyss') abyssWins += 1;
    } catch {
      /* 旧数据不是合法 JSON，忽略 */
    }
  }
  return { wins, abyssWins };
}

// 赛季最佳排名：只统计注册账号，按榜单内个人最高分比较。
function seasonBestRank(accountId, bounds) {
  const boards = db
    .prepare(
      `SELECT DISTINCT board_key FROM leaderboard_entries
        WHERE account_id = ? AND created_at >= ? AND created_at < ?`
    )
    .all(accountId, bounds.start, bounds.end);
  let best = null;
  for (const row of boards) {
    const mine = db
      .prepare(
        `SELECT MAX(score) AS score FROM leaderboard_entries
          WHERE account_id = ? AND board_key = ? AND created_at >= ? AND created_at < ?`
      )
      .get(accountId, row.board_key, bounds.start, bounds.end);
    const myScore = Number(mine?.score) || 0;
    const better = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT e.account_id, MAX(e.score) AS score
             FROM leaderboard_entries e
             JOIN accounts a ON a.id = e.account_id
            WHERE e.board_key = ? AND a.kind = 'registered'
              AND e.created_at >= ? AND e.created_at < ?
            GROUP BY e.account_id
         ) WHERE score > ?`
      )
      .get(row.board_key, bounds.start, bounds.end, myScore);
    const rank = (Number(better?.c) || 0) + 1;
    if (best == null || rank < best) best = rank;
  }
  return best;
}

// 当前赛季（自然月）统计：对局数、通关数、最高分、活跃天数与最佳榜单排名。
function seasonContext(accountId, now = Date.now()) {
  const key = seasonOf(now);
  const bounds = seasonBounds(key);
  if (!bounds) return { key: null, runs: 0, wins: 0, bestScore: 0, days: 0, rank: null };
  const row = db
    .prepare(
      `SELECT COUNT(*) AS runs,
              COALESCE(SUM(victory), 0) AS wins,
              COALESCE(MAX(score), 0) AS best_score,
              COUNT(DISTINCT day) AS days
         FROM runs
        WHERE account_id = ? AND status = 'finished'
          AND created_at >= ? AND created_at < ?`
    )
    .get(accountId, bounds.start, bounds.end);
  return {
    key,
    runs: Number(row?.runs) || 0,
    wins: Number(row?.wins) || 0,
    bestScore: Number(row?.best_score) || 0,
    days: Number(row?.days) || 0,
    rank: seasonBestRank(accountId, bounds),
  };
}

// 进度所需的上下文与结算时保持一致，但 run 为空：本局专属的进度只能从结算响应看到。
function progressContext(accountId, unlocked) {
  const career = careerStats(accountId);
  const byDifficulty = {};
  for (const item of career.byDifficulty) {
    byDifficulty[item.id] = {
      runs: item.runs,
      wins: item.wins,
      bestWave: item.bestWave,
      bestScore: item.bestScore,
    };
  }
  const daily = dailySummary(accountId);
  const flawless = flawlessSummary(accountId);
  return {
    run: null,
    stats: {
      runs: career.totals.runs,
      wins: career.totals.wins,
      kills: career.totals.kills,
      byDifficulty,
    },
    dailyRuns: daily.runs,
    dailyWins: daily.wins,
    skills: skillContext(accountId),
    skillAbyssWins: skillAbyssWins(accountId),
    noDamageWins: flawless.wins,
    abyssFlawlessWins: flawless.abyssWins,
    season: seasonContext(accountId),
    unlocked,
  };
}

export function listUnlocked(accountId) {
  return new Map(unlockedRows(accountId).map((row) => [row.achievement_id, row.unlocked_at]));
}

// 幂等：主键 (account_id, achievement_id) + INSERT OR IGNORE 保证重复结算不重复插入。
export function unlockAchievements(accountId, { run = null, stats = null } = {}) {
  const unlocked = new Set(listUnlocked(accountId).keys());
  const daily = dailySummary(accountId);
  const flawless = flawlessSummary(accountId);
  const added = evaluateAchievements({
    run,
    stats,
    dailyRuns: daily.runs,
    dailyWins: daily.wins,
    skills: skillContext(accountId),
    skillAbyssWins: skillAbyssWins(accountId),
    noDamageWins: flawless.wins,
    abyssFlawlessWins: flawless.abyssWins,
    season: seasonContext(accountId),
    unlocked,
  });
  if (!added.length) return [];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO account_achievements (account_id, achievement_id, unlocked_at)
     VALUES (?, ?, ?)`
  );
  const now = Date.now();
  for (const id of added) insert.run(accountId, id, now);
  writeCosmeticUnlocks(accountId, added, now);
  return added;
}

export function achievementSummary(accountId) {
  const unlocked = listUnlocked(accountId);
  const ctx = progressContext(accountId, new Set(unlocked.keys()));
  const achievements = ACHIEVEMENTS.map((achievement) => {
    const isUnlocked = unlocked.has(achievement.id);
    // 未解锁的隐藏成就只返回占位，描述与条件都不外泄。
    const masked = !!achievement.hidden && !isUnlocked;
    let progress = masked ? null : achievementProgress(achievement, ctx);
    if (progress && isUnlocked) progress = { ...progress, current: progress.target };
    return {
      id: achievement.id,
      title: masked ? '???' : achievement.title,
      desc: masked ? '' : achievement.desc,
      condition: masked ? '???' : achievement.condition,
      group: achievement.group,
      groupName: ACHIEVEMENT_GROUPS.find((group) => group.id === achievement.group)?.name || achievement.group,
      rarity: achievement.rarity,
      rarityName: ACHIEVEMENT_RARITIES[achievement.rarity]?.name || achievement.rarity,
      hidden: !!achievement.hidden,
      unlocked: isUnlocked,
      unlockedAt: isUnlocked ? unlocked.get(achievement.id) : null,
      progress,
    };
  });
  const groups = ACHIEVEMENT_GROUPS.map((group) => {
    const items = achievements.filter((item) => item.group === group.id);
    return {
      id: group.id,
      name: group.name,
      total: items.length,
      unlocked: items.filter((item) => item.unlocked).length,
    };
  });
  return {
    total: achievements.length,
    unlockedCount: achievements.filter((item) => item.unlocked).length,
    groups,
    achievements,
  };
}
