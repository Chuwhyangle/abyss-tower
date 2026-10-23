// 快照的单一来源：序列化（toSnapshot）、校验（validateSnapshot）与迁移（migrateSnapshot）。
// 战斗模拟与存档加载都走这里，版本号只在本文件定义一次。
// v2 只有遗物 ID，v3 使用 {id, level}，v4 增加 skill:{id, level, cooldown}；旧档一律按 Ⅰ 级恢复。
// 损坏输入统一由 validateSnapshot 判定：不抛异常，返回 { ok:false, reason } 交给调用方决定重开。
// 字段级异常（类型错误、越界数值、非法难度/地图）属于可恢复损坏，会收敛到安全默认值。
import {
  DIFFICULTY_ORDER,
  MAP_COLS,
  MAP_ROWS,
  MAX_WAVE,
  SKILLS,
  TOWERS,
  normalizeRelicStates,
  skillStats,
} from './data.js';
import { ARCHETYPES, MODIFIER_BY_ID } from './mapgen.js';
import { normalizeEventHistory } from './events.js';
import { ENDLESS } from './waves.js';

export const SAVE_VERSION = 4;
export const MIN_SAVE_VERSION = 2;
// 无技能的旧局仍写 v3，字段与旧版一致，避免旧客户端/旧测试误读。
export const BASE_SAVE_VERSION = 3;

const DEFAULT_DIFFICULTY = 'standard';
const DEFAULT_ARCHETYPE = 'canyon';
const DEFAULT_MODE = 'normal';
const MODES = new Set(['normal', 'daily', 'endless']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 只接受有限数字与数字字符串；布尔、对象、NaN/Infinity 一律视为损坏。
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boundedInt(value, min, max, fallback = min) {
  const parsed = finiteNumber(value);
  if (parsed === null) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

// 无尽模式的波次可超过 MAX_WAVE，但同样收敛到硬上限。
function clampWave(value, mode = DEFAULT_MODE) {
  const max = mode === 'endless' ? ENDLESS.maxIndex : MAX_WAVE;
  return boundedInt(value, 0, max, 0);
}

function normalizeTowers(towers) {
  if (!Array.isArray(towers)) return [];
  const states = [];
  for (const tower of towers) {
    if (!isRecord(tower) || !TOWERS[tower.type]) continue;
    states.push({
      type: tower.type,
      c: boundedInt(tower.c, 0, MAP_COLS - 1, 0),
      r: boundedInt(tower.r, 0, MAP_ROWS - 1, 0),
      level: boundedInt(tower.level, 0, Number.MAX_SAFE_INTEGER, 0),
      invested: boundedInt(tower.invested, 0, Number.MAX_SAFE_INTEGER, 0),
    });
  }
  return states;
}

function normalizeDifficulty(value) {
  return DIFFICULTY_ORDER.includes(value) ? value : DEFAULT_DIFFICULTY;
}

function normalizeMode(value) {
  return MODES.has(value) ? value : DEFAULT_MODE;
}

function normalizeSkill(raw) {
  if (!isRecord(raw)) return null;
  const def = SKILLS[raw.id];
  if (!def) return null;
  const level = boundedInt(raw.level, 1, def.levels.length, 1);
  const stats = skillStats(def.id, level);
  const rawCooldown = finiteNumber(raw.cooldown);
  const cooldown = rawCooldown === null ? 0 : Math.max(0, Math.min(stats.cd, rawCooldown));
  const out = { id: def.id, level, cooldown };
  const readyAt = finiteNumber(raw.readyAt);
  if (readyAt !== null && readyAt > 0) out.readyAt = readyAt;
  const speed = finiteNumber(raw.speed);
  if (speed !== null && speed > 0) out.speed = speed;
  return out;
}

function collectWarnings(snap) {
  const warnings = [];
  if ('relics' in snap && !Array.isArray(snap.relics)) warnings.push('relics-not-array');
  if ('towers' in snap && !Array.isArray(snap.towers)) warnings.push('towers-not-array');
  if ('difficulty' in snap && !DIFFICULTY_ORDER.includes(snap.difficulty)) {
    warnings.push('invalid-difficulty');
  }
  if ('mode' in snap && !MODES.has(snap.mode)) warnings.push('invalid-mode');
  if ('mapId' in snap && !ARCHETYPES[snap.mapId]) warnings.push('invalid-map-id');
  if ('modifierId' in snap && snap.modifierId != null && !MODIFIER_BY_ID[snap.modifierId]) {
    warnings.push('invalid-modifier-id');
  }
  if ('skill' in snap && snap.skill != null && normalizeSkill(snap.skill) === null) {
    warnings.push('invalid-skill');
  }
  if ('events' in snap && !Array.isArray(snap.events)) warnings.push('invalid-events');
  const rawWave = finiteNumber(snap.clearedWave ?? snap.wave);
  const maxWave = snap.mode === 'endless' ? ENDLESS.maxIndex : MAX_WAVE;
  if (rawWave !== null && (rawWave < 0 || rawWave > maxWave)) warnings.push('wave-clamped');
  return warnings;
}

/**
 * 从战斗模拟状态生成可持久化快照。字段与顺序即存档格式本身，改动需同步 SAVE_VERSION。
 * @param {object} state 具备 runId/seed/mode/difficulty/clearedWave/pendingDraft/gold/
 *   baseHp/maxBaseHp/kills/relics/towers/startedAt 的状态对象。
 */
export function toSnapshot(state) {
  const skill = normalizeSkill(state.skill);
  const snapshot = {
    version: skill ? SAVE_VERSION : BASE_SAVE_VERSION,
    runId: state.runId,
    seed: state.seed,
    mode: state.mode,
    difficulty: state.difficulty,
    wave: state.clearedWave,
    clearedWave: state.clearedWave,
    pendingDraft: state.pendingDraft,
    gold: Math.floor(state.gold),
    baseHp: Math.max(0, state.baseHp),
    maxBaseHp: state.maxBaseHp,
    kills: state.kills,
    relics: state.relics.map((r) => ({ id: r.id, level: r.level || 1 })),
    towers: state.towers.map((t) => ({
      type: t.type, c: t.c, r: t.r, level: t.level, invested: t.invested,
    })),
    skill,
    startedAt: state.startedAt,
    savedAt: Date.now(),
  };
  // 事件历史是可选字段：没有事件时保持旧存档字节不变。
  const events = normalizeEventHistory(state.events);
  if (events.length) snapshot.events = events;
  return snapshot;
}

// 版本迁移与字段收敛。只有 validateSnapshot 判定合法后才会调用。
export function migrateSnapshot(snap) {
  const mode = normalizeMode(snap.mode ?? DEFAULT_MODE);
  const clearedWave = clampWave(snap.clearedWave ?? snap.wave, mode);
  const out = {
    ...snap,
    version: SAVE_VERSION,
    relics: normalizeRelicStates(Array.isArray(snap.relics) ? snap.relics : []),
    skill: normalizeSkill(snap.skill),
    clearedWave,
    wave: clearedWave,
    pendingDraft: snap.pendingDraft === true,
  };

  if ('seed' in snap) out.seed = typeof snap.seed === 'string' && snap.seed ? snap.seed : null;
  if ('runId' in snap) out.runId = typeof snap.runId === 'string' ? snap.runId : null;
  if ('mode' in snap) out.mode = mode;
  if ('difficulty' in snap) out.difficulty = normalizeDifficulty(snap.difficulty);
  if ('gold' in snap) out.gold = boundedInt(snap.gold, 0, Number.MAX_SAFE_INTEGER, 0);
  if ('kills' in snap) out.kills = boundedInt(snap.kills, 0, Number.MAX_SAFE_INTEGER, 0);
  if ('baseHp' in snap) out.baseHp = boundedInt(snap.baseHp, 0, Number.MAX_SAFE_INTEGER, 0);
  if ('maxBaseHp' in snap) {
    out.maxBaseHp = boundedInt(snap.maxBaseHp, 0, Number.MAX_SAFE_INTEGER, 0);
    if ('baseHp' in out) out.maxBaseHp = Math.max(out.maxBaseHp, out.baseHp);
  }
  if ('towers' in snap) out.towers = normalizeTowers(snap.towers);
  // 旧存档没有 events：保持缺省（读取方按“无事件”处理）。
  if ('events' in snap) out.events = normalizeEventHistory(snap.events);
  if ('preWave' in snap) out.preWave = snap.preWave === true;

  if ('mapId' in snap) {
    out.mapId = ARCHETYPES[snap.mapId] ? snap.mapId : DEFAULT_ARCHETYPE;
  }
  if ('modifierId' in snap) {
    out.modifierId = MODIFIER_BY_ID[snap.modifierId] ? snap.modifierId : null;
  }
  if ('mapChoice' in snap) {
    out.mapChoice = boundedInt(snap.mapChoice, 0, Number.MAX_SAFE_INTEGER, 0);
  }

  return out;
}

/**
 * 快照入口校验：版本、必需字段、数值范围。
 * 不抛异常；损坏时返回 { ok:false, reason }，调用方可选择重开（丢弃）或自行部分恢复。
 * 合法时返回 { ok:true, snapshot }，字段级异常收敛为默认值并给出 warnings。
 */
export function validateSnapshot(snap) {
  if (!isRecord(snap)) return { ok: false, reason: 'not-an-object' };

  if (!('version' in snap)) return { ok: false, reason: 'missing-version' };
  const version = snap.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: 'invalid-version' };
  }
  if (version > SAVE_VERSION) return { ok: false, reason: 'future-version' };
  if (version < MIN_SAVE_VERSION) return { ok: false, reason: 'unsupported-version' };

  const result = { ok: true, snapshot: migrateSnapshot(snap) };
  const warnings = collectWarnings(snap);
  if (warnings.length) result.warnings = warnings;
  return result;
}

export function normalizeSnapshot(snap) {
  const result = validateSnapshot(snap);
  return result.ok ? result.snapshot : null;
}
