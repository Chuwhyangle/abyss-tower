// 技能养成持久化：等级 / 选择 / 解锁，全部落在既有 player_progress / player_unlocks / player_stats。
// 等级与扣费在同一个 BEGIN IMMEDIATE 事务内完成，防止并发双花与重复升级。
import { db, transaction } from './index.mjs';
import { grantUnlock, spendCoresInTx } from '../db.mjs';
import {
  SKILLS,
  SKILL_ORDER,
  isSkillUnlocked,
  skillUpgradeCost,
} from '../../public/js/shared/data.js';

const PROGRESS_TYPE = 'skill';
export const SELECTED_KEY = 'selected';
export const MAX_SKILL_LEVEL = SKILLS.aurora.levels.length;

// 难度 → 首次通关授予的技能（严格按设计稿：漫游给星陨、远征给终章）。
export const SKILL_UNLOCK_BY_DIFFICULTY = {
  roam: 'meteor',
  standard: 'chrono',
};

export function skillUnlockId(skillId) {
  return `skill_${skillId}`;
}

function clampLevel(value) {
  const level = Math.floor(Number(value) || 1);
  return Math.max(1, Math.min(MAX_SKILL_LEVEL, level));
}

function readWins(accountId, difficulty) {
  const row = db
    .prepare(
      `SELECT value_num FROM player_stats
        WHERE account_id = ? AND stat_key = 'wins' AND scope_key = ?`
    )
    .get(accountId, `difficulty:${difficulty}`);
  return Math.max(0, Number(row?.value_num) || 0);
}

// 解锁 = 显式授予记录 或 从历史首通派生（覆盖上线前已通关的老账号）。
export function skillUnlocked(accountId, skillId) {
  const def = SKILLS[skillId];
  if (!def) return false;
  const granted = db
    .prepare('SELECT 1 AS ok FROM player_unlocks WHERE account_id = ? AND unlock_id = ?')
    .get(accountId, skillUnlockId(skillId));
  if (granted) return true;
  const derived = {
    stats: {
      byDifficulty: {
        roam: { wins: readWins(accountId, 'roam') },
        standard: { wins: readWins(accountId, 'standard') },
      },
    },
  };
  return isSkillUnlocked(skillId, derived);
}

export function readSkillLevel(accountId, skillId) {
  const row = db
    .prepare(
      `SELECT value_num FROM player_progress
        WHERE account_id = ? AND progress_type = ? AND progress_key = ?`
    )
    .get(accountId, PROGRESS_TYPE, skillId);
  return clampLevel(row?.value_num ?? 1);
}

export function readSkillLevels(accountId) {
  const rows = db
    .prepare(
      `SELECT progress_key, value_num FROM player_progress
        WHERE account_id = ? AND progress_type = ?`
    )
    .all(accountId, PROGRESS_TYPE);
  const levels = Object.fromEntries(SKILL_ORDER.map((id) => [id, 1]));
  for (const row of rows) {
    if (row.progress_key in levels) levels[row.progress_key] = clampLevel(row.value_num);
  }
  return levels;
}

export function readSelectedSkill(accountId) {
  const row = db
    .prepare(
      `SELECT state_json FROM player_progress
        WHERE account_id = ? AND progress_type = ? AND progress_key = ?`
    )
    .get(accountId, PROGRESS_TYPE, SELECTED_KEY);
  if (!row) return null;
  try {
    const state = JSON.parse(row.state_json);
    return SKILLS[state?.id] ? state.id : null;
  } catch {
    return null;
  }
}

export function setSelectedSkill(accountId, skillId) {
  if (!SKILLS[skillId]) return false;
  db.prepare(
    `INSERT INTO player_progress
       (account_id, progress_type, progress_key, value_num, state_json, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(account_id, progress_type, progress_key) DO UPDATE SET
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`
  ).run(accountId, PROGRESS_TYPE, SELECTED_KEY, JSON.stringify({ id: skillId }), Date.now());
  return true;
}

function writeSkillLevelInTx(accountId, skillId, level, now) {
  db.prepare(
    `INSERT INTO player_progress
       (account_id, progress_type, progress_key, value_num, state_json, updated_at)
     VALUES (?, ?, ?, ?, '{}', ?)
     ON CONFLICT(account_id, progress_type, progress_key) DO UPDATE SET
       value_num = excluded.value_num,
       updated_at = excluded.updated_at`
  ).run(accountId, PROGRESS_TYPE, skillId, level, now);
}

// 原子升级：事务内重读等级 → 校验 expectedLevel → 条件扣费 → 写新等级。
// 返回 { ok, status, from, to, cost }；status 为错误码（ok=false 时）。
export function upgradeSkillLevel(accountId, skillId, expectedLevel = null) {
  if (!SKILLS[skillId]) return { ok: false, status: 'INVALID_SKILL' };
  return transaction(() => {
    const from = readSkillLevel(accountId, skillId);
    if (expectedLevel != null && Number(expectedLevel) !== from) {
      return { ok: false, status: 'LEVEL_CONFLICT', from };
    }
    if (from >= MAX_SKILL_LEVEL) return { ok: false, status: 'MAX_LEVEL', from };
    const cost = skillUpgradeCost(from);
    const now = Date.now();
    if (!spendCoresInTx(accountId, cost, now)) {
      return { ok: false, status: 'INSUFFICIENT_CORES', from, cost };
    }
    const to = from + 1;
    writeSkillLevelInTx(accountId, skillId, to, now);
    return { ok: true, status: 'OK', from, to, cost };
  });
}

// 胜利授予：已解锁（含历史首通派生）时不重复提示，但会补齐显式记录。
export function grantVictorySkillUnlock(accountId, difficulty) {
  const skillId = SKILL_UNLOCK_BY_DIFFICULTY[difficulty];
  if (!skillId) return null;
  const already = skillUnlocked(accountId, skillId);
  grantUnlock(accountId, skillUnlockId(skillId));
  return already ? null : skillId;
}
