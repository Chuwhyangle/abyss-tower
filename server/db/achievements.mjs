// 成就持久化：读取已解锁状态，按结算上下文幂等写入新解锁。
import { db } from './index.mjs';
import { careerStats } from './stats.mjs';
import { readSelectedSkill, readSkillLevels, skillUnlocked } from './skills.mjs';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_RARITIES,
  achievementProgress,
  evaluateAchievements,
} from '../../public/js/shared/achievements.js';
import { SKILL_ORDER } from '../../public/js/shared/data.js';

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
  const added = evaluateAchievements({
    run,
    stats,
    dailyRuns: daily.runs,
    dailyWins: daily.wins,
    skills: skillContext(accountId),
    skillAbyssWins: skillAbyssWins(accountId),
    unlocked,
  });
  if (!added.length) return [];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO account_achievements (account_id, achievement_id, unlocked_at)
     VALUES (?, ?, ?)`
  );
  const now = Date.now();
  for (const id of added) insert.run(accountId, id, now);
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
