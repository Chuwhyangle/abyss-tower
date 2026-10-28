// 远征规则层：开局规则计算（每日/本周/固定图/变异/海克斯）、次数与连胜、地图候选与主海克斯派生。
// 只做规则判定与派生计算；建局持久化、状态迁移与错误类型在 run-service.mjs。
import crypto from 'node:crypto';

import {
  countFinishedDailyRuns,
  countFinishedWeeklyRuns,
  participationDays,
} from '../db/runs.mjs';
import { readSelectedSkill, readSkillLevel, skillUnlocked } from '../db/skills.mjs';
import { CONTENT_VERSION } from '../config.mjs';
import { boardKeyFor } from '../db/leaderboard-sql.mjs';
import {
  buildCandidate,
  candidatePlan,
  generateMapCandidates,
  legacyGenerateMap,
} from '../../public/js/shared/mapgen.js';
import {
  DIFFICULTIES,
  SKILLS,
  TOWER_ORDER,
  rollRelicOffers,
  unlockedTowerIds,
} from '../../public/js/shared/data.js';
import {
  HEX_BY_ID,
  HEX_ORDER,
  HEX_POOL_VERSION,
  offerHexes,
  offerHexesFromPool,
  validateHexChoice,
} from '../../public/js/shared/hexes.js';
import { HexRuntime } from '../../public/js/shared/hexes/runtime.js';
import {
  applyMutations,
  mutationKey,
  mutationSummary,
  validateMutationSelection,
} from '../../public/js/shared/mutations.js';
import {
  dailyChallenge,
  dailyStreak,
  dayKey,
  WEEKLY_SKILL_LEVEL,
  weeklyChallenge,
  weekKey,
} from '../../public/js/shared/scoring.js';
import { normalizeEventHistory } from '../../public/js/shared/events.js';

export const START_GOLD = 260;
export const START_HP = 20;
const META_GOLD = 40;
const META_HP = 3;
// 固定地图池标识：新 run 写入 ruleset.mapPool，旧 run 缺少该字段时只读回退 legacy carve。
export const FIXED_MAP_POOL = 'fixed-v1';
// 固定地图池恒为三张：canyon → twin → ring，mapChoice 仍为 0..2。
export const FIXED_MAP_COUNT = 3;
// 主海克斯三选一与遗物服务端默认值（遗物类数值由各海克斯钩子覆盖）。
export const HEX_OFFER_COUNT = 3;
export const RELIC_OFFER_COUNT = 3;
export const RELIC_REROLL_COST = 25;

// 每日挑战固定规则集：不随账号解锁与难度加成变化。
export const DAILY_RULESET = 'daily-v2';
export const DAILY_SKILL_LEVEL = 5;
export const DAILY_START_GOLD = 260;
export const DAILY_START_HP = 20;

export const DAILY_ATTEMPTS = 3;

// 本周挑战：固定规则集、每周独立榜单与每周次数上限。
export const WEEKLY_RULESET = 'weekly-v1';
export const WEEKLY_ATTEMPTS = 3;

export function finishedDailyToday(token) {
  return countFinishedDailyRuns(token, dayKey());
}

export function dailyAttemptsLeft(token) {
  return Math.max(0, DAILY_ATTEMPTS - finishedDailyToday(token));
}

export function dailyStreakFor(token, day = dayKey()) {
  return dailyStreak(participationDays(token), day);
}

export function finishedWeeklyThisWeek(token, week = weekKey()) {
  return countFinishedWeeklyRuns(token, week);
}

export function weeklyAttemptsLeft(token, week = weekKey()) {
  return Math.max(0, WEEKLY_ATTEMPTS - finishedWeeklyThisWeek(token, week));
}

// 每日与本周挑战共用固定规则：全塔、全技能可选、固定技能等级与固定资源。
export function isFixedRulesMode(mode) {
  return mode === 'daily' || mode === 'weekly';
}

// 把已落库的选择还原成事件历史；连锁排期由 shared/events.js 从历史推导，服务端不信任客户端。
export function eventHistory(run) {
  const entries = Object.entries(run.offers || {})
    .filter(([key, slot]) => key.startsWith('event:') && slot?.picked)
    .map(([key, slot]) => ({
      wave: Number(key.slice('event:'.length)),
      eventId: slot.eventId,
      optionId: slot.optionId,
    }));
  return normalizeEventHistory(entries, run.mode);
}

// 事件选择与遗物选择共用 offers JSON；事件槽位加前缀避免与遗物波次键冲突。
export function eventKey(wave) {
  return `event:${wave}`;
}

export function maxRerollsFor(profile) {
  return 1 + (profile.unlocks.includes('extra_reroll') ? 2 : 0);
}

export function difficultyPayload(difficulty) {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
  return { ...diff };
}

// 旧 run 回退（只读）：按改造前 generateMapCandidates(seed, 3) 的调用顺序重建当时的三张候选，
// 供没有 ruleset.mapPool 的旧存档/回放读取。RNG 顺序由 candidatePlan/buildCandidate 内部固定。
function legacyMapCandidates(seed, count = FIXED_MAP_COUNT) {
  const { ids, modifierPool } = candidatePlan(seed, count);
  return Array.from({ length: count }, (_, index) =>
    buildCandidate(
      `${seed}:candidate:${index}`,
      ids[index % ids.length],
      modifierPool[index % modifierPool.length],
      index
    )
  );
}

// 地图候选的唯一入口：新 run 读固定池，旧 ruleset 只读回退 legacy carve。
// 同一 run 的 serialize/chooseMap/serveWave/replaySummary/settle 都从这里取图，避免字段再次分叉。
export function mapCandidatesFor(run) {
  if (run?.ruleset?.mapPool === FIXED_MAP_POOL) {
    return generateMapCandidates(run.seed, FIXED_MAP_COUNT);
  }
  return legacyMapCandidates(run.seed, FIXED_MAP_COUNT);
}

// 已选地图；mapChoice < 0 表示尚未选图。旧数据取不到候选时退回单张 legacy 地图，绝不抛错。
export function chosenMapFor(run) {
  if (!run || run.mapChoice < 0) return null;
  const chosen = mapCandidatesFor(run)[run.mapChoice];
  if (chosen) return chosen;
  return run.ruleset?.mapPool === FIXED_MAP_POOL ? null : legacyGenerateMap(run.seed);
}

// ---------- 主海克斯：开局三选一与已选快照 ----------

// 三选一的派生 seed：每日/本周按 day/week 维度（同组所有人一致），其余模式按本局种子。
export function hexOfferSeed(run) {
  if (run?.mode === 'daily') return `daily:${run.day}`;
  if (run?.mode === 'weekly') return `weekly:${run.day}`;
  return `run:${run?.seed ?? ''}`;
}

// 候选池优先取已实现定义；十个实现任务（HEX-004..013）落地前注册表全是桩，
// 退化为完整注册表，保证 HEX-003 的开局三选一始终有牌可发。
function hexOfferPool(seed, mode) {
  const implemented = offerHexes(seed, HEX_OFFER_COUNT, mode);
  if (implemented.length >= HEX_OFFER_COUNT) return implemented;
  return offerHexesFromPool(HEX_ORDER, seed, HEX_OFFER_COUNT, mode);
}

// 同一 run 的 offers 只由 seed/mode 派生：刷新、重进与同一天的每日/本周挑战都得到同一组。
export function hexOffersFor(run) {
  return hexOfferPool(hexOfferSeed(run), run?.mode || 'normal');
}

// 已选海克斯（写入 ruleset.hex）；旧 run 没有该字段时返回 null，结算按 1.0 处理。
export function hexFor(run) {
  const hex = run?.ruleset?.hex;
  if (!hex || typeof hex.id !== 'string' || !HEX_BY_ID[hex.id]) return null;
  return {
    id: hex.id,
    offers: Array.isArray(hex.offers) ? [...hex.offers] : [],
    poolVersion: hex.poolVersion || HEX_POOL_VERSION,
  };
}

// serialize/选择校验共用的 offers 入口：已选后锁定为写入时的一组，绝不重新洗牌。
export function hexOffersOf(run) {
  const chosen = hexFor(run);
  return chosen ? chosen.offers : hexOffersFor(run);
}

// 遗物类数值从共享 hex 定义读取：无海克斯时退化为服务端默认值。
export function hexRuntimeFor(run) {
  return new HexRuntime(hexFor(run)?.id || null);
}

// ---------- 开局规则计算 ----------

// 建局前的全部规则推导：模式/难度/技能/开局资源/规则集/固定图/变异与开局响应字段。
// 领域错误以 { error: { status, message, code } } 返回，由服务层转成 RunError
// （规则层不认识错误类型，避免规则与服务互相 import 成环）。
export function planRunStart({ token, profile, body, testSeed }) {
  const mode =
    body.mode === 'daily'
      ? 'daily'
      : body.mode === 'weekly'
        ? 'weekly'
        : body.mode === 'endless'
          ? 'endless'
          : body.mode === 'mutated'
            ? 'mutated'
            : 'normal';
  const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : 'standard';
  const diff = DIFFICULTIES[difficulty];
  const daily = mode === 'daily' ? dailyChallenge(dayKey()) : null;
  const weekly = mode === 'weekly' ? weeklyChallenge() : null;
  // 变异组合必须先通过校验，非法组合直接拒绝建局。
  let mutationIds = null;
  if (mode === 'mutated') {
    const selection = validateMutationSelection(body.mutations);
    if (!selection.ok) {
      return { error: { status: 400, message: selection.error, code: 'INVALID_MUTATION_COMBO' } };
    }
    mutationIds = selection.ids;
  }
  // 每日以日期为维度，本周挑战以 ISO 周为维度，变异挑战以规范化组合为维度。
  const day =
    mutationIds != null
      ? mutationKey(mutationIds)
      : daily
        ? daily.day
        : weekly
          ? weekly.week
          : dayKey();
  const fixedRules = isFixedRulesMode(mode);

  // 技能选择：每日/本周挑战允许任意技能且固定等级；普通局必须已解锁，等级只从 DB 读。
  let skillId = null;
  if (body.skillId != null && body.skillId !== '') {
    skillId = String(body.skillId);
    if (!SKILLS[skillId]) {
      return { error: { status: 400, message: '未知技能', code: 'INVALID_SKILL' } };
    }
    if (!fixedRules && !skillUnlocked(token, skillId)) {
      return { error: { status: 403, message: '技能尚未解锁', code: 'SKILL_LOCKED' } };
    }
  }
  if (!skillId) {
    const selected = readSelectedSkill(token);
    skillId = selected && (fixedRules || skillUnlocked(token, selected)) ? selected : 'aurora';
  }
  const skillLevel =
    mode === 'weekly'
      ? WEEKLY_SKILL_LEVEL
      : mode === 'daily'
        ? DAILY_SKILL_LEVEL
        : readSkillLevel(token, skillId);
  if (mode === 'daily' && finishedDailyToday(token) >= DAILY_ATTEMPTS) {
    return { error: { status: 429, message: '今日挑战次数已用完' } };
  }
  if (mode === 'weekly' && finishedWeeklyThisWeek(token, weekly.week) >= WEEKLY_ATTEMPTS) {
    return { error: { status: 429, message: '本周挑战次数已用完' } };
  }

  const seed = testSeed
    ? `test-${testSeed}`
    : daily
      ? daily.seed
      : weekly
        ? weekly.seed
        : crypto.randomBytes(8).toString('hex');
  const unlocks = profile.unlocks;
  // 每日/本周挑战使用固定开局资源，忽略难度加成与账号 meta 加成，保证榜单公平。
  let startingGold = fixedRules
    ? DAILY_START_GOLD
    : Math.max(100, START_GOLD + (unlocks.includes('start_gold') ? META_GOLD : 0) + diff.goldBonus);
  let baseHp = fixedRules
    ? DAILY_START_HP
    : Math.max(8, START_HP + (unlocks.includes('start_hp') ? META_HP : 0) + diff.hpBonus);
  let maxRerolls = fixedRules ? 1 : maxRerollsFor(profile);
  let towersUnlocked = fixedRules ? [...TOWER_ORDER] : unlockedTowerIds(unlocks);
  // 变异只改既有开局参数与波次倍率，不改机制本身。
  let mutationInfo = null;
  if (mutationIds) {
    const applied = applyMutations({ startingGold, baseHp, maxRerolls, towersUnlocked }, mutationIds);
    startingGold = applied.startingGold;
    baseHp = applied.baseHp;
    maxRerolls = applied.maxRerolls;
    towersUnlocked = applied.towersUnlocked;
    mutationInfo = {
      ids: mutationIds,
      key: mutationKey(mutationIds),
      scoreMul: applied.scoreMul,
      hpMul: applied.hpMul,
      speedMul: applied.speedMul,
    };
  }
  const ruleset = {
    v: 1,
    contentVersion: CONTENT_VERSION,
    // 固定地图池：新 run 一律标注，旧 run 缺省即走 legacy 只读回退。
    mapPool: FIXED_MAP_POOL,
    skill: { id: skillId, level: skillLevel },
    meta: { startGold: startingGold, baseHp, maxRerolls },
  };
  if (daily) ruleset.daily = { date: day, ruleset: DAILY_RULESET };
  if (weekly) ruleset.weekly = { week: weekly.week, ruleset: WEEKLY_RULESET };
  if (mutationInfo) ruleset.mutations = mutationInfo;
  const startRelics = unlocks.includes('start_relic')
    ? rollRelicOffers(`${seed}:start:${token}`, [], 1, 1, mode)
        .filter((offer) => offer.kind === 'relic')
        .map((offer) => ({ id: offer.id, level: offer.toLevel }))
    : [];
  // 固定地图池：所有模式（普通/每日/本周/无尽/变异）都是同一组三张图与固定 trait。
  const candidates = generateMapCandidates(seed, FIXED_MAP_COUNT);
  // 词缀即固定地图的 trait（无 trait 的 canyon 不参与）；不再做随机词缀一致性校验。
  const mapModifiers = candidates
    .map((candidate) => candidate.modifier)
    .filter(Boolean)
    .map(({ id: modifierId, name, desc, color }) => ({
      id: modifierId,
      name,
      desc,
      color,
    }));

  const dailyInfo = daily
    ? {
        day,
        seed,
        modifiers: mapModifiers,
        // 连胜由参与天数派生，必须在开局落库之后由服务层补齐。
        streak: null,
      }
    : null;
  const weeklyInfo = weekly
    ? {
        week: weekly.week,
        seed,
        modifiers: mapModifiers.slice(0, weekly.modifiers.length),
        rules: weekly.rules,
      }
    : null;

  return {
    // 落库所需的最小规则字段；id 与时间戳由服务层生成。
    run: {
      mode,
      difficulty,
      seed,
      day,
      boardKey: boardKeyFor(mode, day),
      contentVersion: CONTENT_VERSION,
      relics: startRelics,
      ruleset,
    },
    response: {
      seed,
      mode,
      difficulty,
      difficultyConfig: difficultyPayload(difficulty),
      day,
      candidates,
      // 主海克斯三选一：每日/本周由 day/week seed 派生，同组所有人一致；其余模式按本局种子。
      hex: null,
      hexOffers: hexOffersFor({ seed, mode, day }),
      hexPoolVersion: HEX_POOL_VERSION,
      startingGold,
      baseHp,
      relics: startRelics,
      // 每日/本周挑战开放全部塔，保证同一规则集下的榜单公平；变异会收窄可用塔。
      towersUnlocked,
      skill: ruleset.skill,
      ruleset,
      maxRerolls,
      mutations: mutationInfo ? mutationSummary(mutationIds) : null,
      mutationScoreMul: mutationInfo?.scoreMul ?? null,
      boardKey: boardKeyFor(mode, day),
      clearedWaves: 0,
      wavesServed: 0,
      dailyAttemptsLeft: mode === 'daily' ? dailyAttemptsLeft(token) : null,
      weeklyAttemptsLeft: mode === 'weekly' ? weeklyAttemptsLeft(token, weekly.week) : null,
      daily: dailyInfo,
      weekly: weeklyInfo,
    },
  };
}
