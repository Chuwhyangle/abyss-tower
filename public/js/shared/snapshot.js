// 快照的单一来源：序列化（toSnapshot）、校验（validateSnapshot）与迁移（migrateSnapshot）。
// 战斗模拟与存档加载都走这里，版本号只在本文件定义一次。
// v2 只有遗物 ID，v3 使用 {id, level}，v4 增加 skill:{id, level, cooldown}，
// v5 增加事件连锁排期 chains:[{chainId, wave}]，v6 增加主海克斯 hexId/hexState 与塔生命，
// v7 增加可破坏物拆除状态 destructibles:{destroyed, obeliskStacks}；
// 旧档一律按 Ⅰ 级 / 无连锁 / 无海克斯 / 无敌塔 / 可破坏物全存活恢复。
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
import { normalizeChains, normalizeEventHistory } from './events.js';
import { DESTRUCTIBLE_BY_ID } from './destructibles.js';
import { ENDLESS } from './waves.js';
import { normalizeBonusPoints, normalizeContractRecords } from './contracts.js';
import { normalizeDoctrineIds } from './doctrines.js';
import { normalizeAwakenings } from './awakenings.js';

export const SAVE_VERSION = 7;
export const MIN_SAVE_VERSION = 2;
// 没有连锁/海克斯时沿用旧版本号，避免旧客户端/旧测试误读：
// 有技能写 v4，无技能仍写 v3；有连锁写 v6（含 v5 的 chains 字段）。
export const SKILL_SAVE_VERSION = 4;
export const BASE_SAVE_VERSION = 3;

const DEFAULT_DIFFICULTY = 'standard';
const DEFAULT_ARCHETYPE = 'canyon';
const DEFAULT_MODE = 'normal';
const MODES = new Set(['normal', 'daily', 'endless']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 深拷贝纯对象；不是纯对象或不可序列化时返回 null（调用方按「无状态」处理）。
function clonePlainRecord(value) {
  if (!isRecord(value)) return null;
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    return isRecord(cloned) ? cloned : null;
  } catch {
    return null;
  }
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

// 进化分支统一成去重后的 id 数组：兼容单条进化字符串与多进化数组，旧档缺字段按未进化处理。
function normalizeEvolutionIds(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const ids = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function normalizeTowers(towers) {
  if (!Array.isArray(towers)) return [];
  const states = [];
  for (const tower of towers) {
    if (!isRecord(tower) || !TOWERS[tower.type]) continue;
    const state = {
      type: tower.type,
      c: boundedInt(tower.c, 0, MAP_COLS - 1, 0),
      r: boundedInt(tower.r, 0, MAP_ROWS - 1, 0),
      level: boundedInt(tower.level, 0, Number.MAX_SAFE_INTEGER, 0),
      invested: boundedInt(tower.invested, 0, Number.MAX_SAFE_INTEGER, 0),
    };
    // 进化分支：evolutions 数组 / 单条 evolution 归一化成数组；旧档缺字段按未进化处理。
    const evolutions = normalizeEvolutionIds(tower.evolutions ?? tower.evolution);
    if (evolutions.length) state.evolutions = evolutions;
    // 塔生命只在有上限（海克斯赋予）时保留；旧档没有该字段时按无敌恢复。
    const maxHp = finiteNumber(tower.maxHp);
    if (maxHp !== null && maxHp > 0) {
      state.maxHp = Math.max(1, Math.floor(maxHp));
      const hp = finiteNumber(tower.hp);
      state.hp = Math.max(0, Math.min(state.maxHp, hp === null ? state.maxHp : Math.floor(hp)));
    }
    states.push(state);
  }
  return states;
}

function normalizeDifficulty(value) {
  return DIFFICULTY_ORDER.includes(value) ? value : DEFAULT_DIFFICULTY;
}

function normalizeMode(value) {
  return MODES.has(value) ? value : DEFAULT_MODE;
}

// 可破坏物存档字段：只保留拆除结果（id 列表 + 石碑层数），布点坐标随地图恢复。
// 旧档缺字段、类型错误、重复/空 id 统一收敛为「全部存活」；石碑层数钳到数据里的叠加上限。
function normalizeDestructibleState(raw) {
  const destroyed = [];
  const rawDestroyed = isRecord(raw) ? raw.destroyed : null;
  if (Array.isArray(rawDestroyed)) {
    for (const id of rawDestroyed) {
      if (typeof id === 'string' && id !== '' && !destroyed.includes(id)) destroyed.push(id);
    }
  }
  const maxStacks = DESTRUCTIBLE_BY_ID.obelisk?.effect?.maxStacks ?? 3;
  const obeliskStacks = boundedInt(isRecord(raw) ? raw.obeliskStacks : 0, 0, maxStacks, 0);
  return { destroyed, obeliskStacks };
}

// 只有真的拆过东西才写字段，没有可破坏物状态的旧对局保持原存档字节结构。
function hasDestructibleState(state) {
  return state.destroyed.length > 0 || state.obeliskStacks > 0;
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

// 契约/教义/觉醒局内状态（§8.4）：只落本任务拥有的 contracts + bonusPoints + doctrines + awakenings 四个字段；
// 旧档缺 rogue2 时按「无契约、零加点、无教义、无觉醒」处理，其余子字段由各自任务（核心/觉醒）落地。
function normalizeRogue2Save(state) {
  return {
    contracts: normalizeContractRecords(state?.rogue2?.contracts || []),
    bonusPoints: normalizeBonusPoints(state?.rogue2?.bonusPoints || {}),
    doctrines: normalizeDoctrineIds(state?.rogue2?.doctrines || []),
    awakenings: normalizeAwakenings(state?.rogue2?.awakenings || []),
  };
}

// 只有真的接受过契约、教义或觉醒才写 rogue2 块（bonusPoints 只由契约写入，有契约才有加点），
// 未受影响的旧对局保持原存档字节结构。
function hasRogue2State(rogue2) {
  return rogue2.contracts.length > 0 || rogue2.doctrines.length > 0 || rogue2.awakenings.length > 0;
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
  if ('chains' in snap && !Array.isArray(snap.chains)) warnings.push('invalid-chains');
  if ('rogue2' in snap && !isRecord(snap.rogue2)) warnings.push('invalid-rogue2');
  if ('destructibles' in snap && !isRecord(snap.destructibles)) {
    warnings.push('invalid-destructibles');
  }
  if ('hexId' in snap && (typeof snap.hexId !== 'string' || !snap.hexId)) {
    warnings.push('invalid-hex-id');
  }
  const rawWave = finiteNumber(snap.clearedWave ?? snap.wave);
  const maxWave = snap.mode === 'endless' ? ENDLESS.maxIndex : MAX_WAVE;
  if (rawWave !== null && (rawWave < 0 || rawWave > maxWave)) warnings.push('wave-clamped');
  return warnings;
}

/**
 * 从战斗模拟状态生成可持久化快照。字段与顺序即存档格式本身，改动需同步 SAVE_VERSION。
 * @param {object} state 具备 runId/seed/mode/difficulty/clearedWave/pendingDraft/gold/
 *   baseHp/maxBaseHp/kills/relics/towers/startedAt 的状态对象；模拟层额外暴露
 *   destructibleState:{destroyed, obeliskStacks} 记录可破坏物拆除结果。
 */
export function toSnapshot(state) {
  const skill = normalizeSkill(state.skill);
  const mode = normalizeMode(state.mode);
  const chains = normalizeChains(state.chains, mode);
  const hex = normalizeHexSave(state);
  // 模拟层作为快照视图暴露拆除结果；纯状态对象没有该字段时按「全部存活」处理。
  const destructibles = normalizeDestructibleState(state.destructibleState);
  const rogue2 = normalizeRogue2Save(state);
  const snapshot = {
    // 有海克斯/连锁/可破坏物/契约状态都写当前版本；否则沿用 v4/v3 的旧版本号。
    version:
      hex.id || chains.length || hasDestructibleState(destructibles) || hasRogue2State(rogue2)
        ? SAVE_VERSION
        : skill
          ? SKILL_SAVE_VERSION
          : BASE_SAVE_VERSION,
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
    towers: state.towers.map(serializeTower),
    skill,
    startedAt: state.startedAt,
    savedAt: Date.now(),
  };
  // 事件历史是可选字段：没有事件时保持旧存档字节不变。
  const events = normalizeEventHistory(state.events, mode);
  if (events.length) snapshot.events = events;
  // 连锁排期同理：没有连锁时不写该字段，v3/v4 存档结构保持不变。
  if (chains.length) snapshot.chains = chains;
  // 海克斯：id 必有，状态为空时不写字段（无海克斯的旧对局字节结构不变）。
  if (hex.id) {
    snapshot.hexId = hex.id;
    if (Object.keys(hex.state).length) snapshot.hexState = hex.state;
  }
  // 可破坏物同理：一件没拆时不写字段，未受影响的旧对局存档字节结构不变。
  if (hasDestructibleState(destructibles)) snapshot.destructibles = destructibles;
  // 契约同理：没接受过契约时不写 rogue2 块，旧对局字节结构不变。
  if (hasRogue2State(rogue2)) snapshot.rogue2 = rogue2;
  return snapshot;
}

// 塔生命只在有上限（海克斯赋予）时写入；进化分支只在真的选过时写入，
// 未受海克斯/未进化的塔保持旧字节结构（旧档缺字段按未进化处理）。
function serializeTower(tower) {
  const state = { type: tower.type, c: tower.c, r: tower.r, level: tower.level, invested: tower.invested };
  const evolutions = normalizeEvolutionIds(tower.evolutions ?? tower.evolution);
  if (evolutions.length) state.evolutions = evolutions;
  const maxHp = finiteNumber(tower.maxHp);
  if (maxHp === null || maxHp <= 0) return state;
  state.maxHp = Math.max(1, Math.floor(maxHp));
  const hp = finiteNumber(tower.hp);
  state.hp = Math.max(0, Math.min(state.maxHp, hp === null ? state.maxHp : Math.floor(hp)));
  return state;
}

// 海克斯存档字段：Simulation 暴露 hex/hexState，纯状态对象只读这两个字段。
// 状态必须可 JSON 序列化；不可序列化时退回空状态，绝不把函数/循环引用写进存档。
function normalizeHexSave(state) {
  const id =
    typeof state?.hex?.id === 'string'
      ? state.hex.id
      : typeof state?.hexRuntime?.id === 'string'
        ? state.hexRuntime.id
        : null;
  const raw = state?.hexState ?? state?.hexRuntime?.state;
  return { id, state: clonePlainRecord(raw) || {} };
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
  // 主海克斯：非法/空 id 视为「无海克斯」；状态只保留可序列化的纯对象。
  if ('hexId' in snap) {
    if (typeof snap.hexId === 'string' && snap.hexId) out.hexId = snap.hexId;
    else delete out.hexId;
  }
  if ('hexState' in snap) {
    const state = clonePlainRecord(snap.hexState);
    if ('hexId' in out && state) out.hexState = state;
    else delete out.hexState;
  }
  // 旧存档没有 events/chains：保持缺省（读取方按“无事件、无连锁”处理）。
  if ('events' in snap) out.events = normalizeEventHistory(snap.events, mode);
  if ('chains' in snap) out.chains = normalizeChains(snap.chains, mode);
  // 可破坏物：旧档缺字段视为「全部存活、零层石碑」，不写空字段以保持字节结构。
  if ('destructibles' in snap) {
    const destructibles = normalizeDestructibleState(snap.destructibles);
    if (hasDestructibleState(destructibles)) out.destructibles = destructibles;
    else delete out.destructibles;
  }
  // 契约局内状态：旧档缺字段视为「无契约、零加点」；没契约时不写空字段。
  if ('rogue2' in snap) {
    const rogue2 = normalizeRogue2Save(snap);
    if (hasRogue2State(rogue2)) out.rogue2 = rogue2;
    else delete out.rogue2;
  }
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
