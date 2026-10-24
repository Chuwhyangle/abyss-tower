// 远征领域服务：状态迁移规则、结算编排与响应序列化；SQL 全部委托给仓储层。
import crypto from 'node:crypto';

import { hydrateRun, normalizeStats, transaction, updateProfile } from '../db.mjs';
import { REPLAY_LIMIT, archiveOld, insertReplay } from '../db/replays.mjs';
import {
  abandonActiveRuns,
  countFinishedDailyRuns,
  countFinishedWeeklyRuns,
  findActiveRun,
  findRun,
  insertRun,
  markAbandoned,
  participationDays,
  setClearedWaves,
  setMapChoice,
  setOffers,
  setOffersAndRerolls,
  setRelics,
  setWavesServed,
  settleRun,
} from '../db/runs.mjs';
import {
  boardKeyFor,
  personalBest,
  rankFor,
  recordLeaderboardEntry,
  seasonOf,
  validateLeaderboardEntry,
} from '../db/leaderboard.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import { unlockAchievements } from '../db/achievements.mjs';
import {
  grantVictorySkillUnlock,
  readSelectedSkill,
  readSkillLevel,
  skillUnlocked,
} from '../db/skills.mjs';
import { AUTH_ENABLED, CONTENT_VERSION } from '../config.mjs';
import { generateMapCandidates } from '../../public/js/shared/mapgen.js';
import { ENDLESS, generateWave } from '../../public/js/shared/waves.js';
import {
  findEventOption,
  normalizeEventHistory,
  resolveEventForWave,
} from '../../public/js/shared/events.js';
import {
  rollRelicOffers,
  normalizeRelicStates,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  DIFFICULTIES,
  SKILLS,
  TOWER_ORDER,
  unlockedTowerIds,
  MAX_WAVE,
} from '../../public/js/shared/data.js';
import {
  applyMutations,
  composeWaveModifier,
  mutationKey,
  mutationScoreMul,
  mutationSummary,
  validateMutationSelection,
} from '../../public/js/shared/mutations.js';
import {
  clampFinishPayload,
  computeOutcome,
  DAILY_MODIFIER_COUNT,
  dailyChallenge,
  dailyStreak,
  dayKey,
  WEEKLY_SKILL_LEVEL,
  weekKey,
  weeklyChallenge,
} from '../../public/js/shared/scoring.js';

const START_GOLD = 260;
const START_HP = 20;
const META_GOLD = 40;
const META_HP = 3;
// 每日挑战固定规则集：不随账号解锁与难度加成变化。
export const DAILY_RULESET = 'daily-v2';
export const DAILY_SKILL_LEVEL = 5;
const DAILY_START_GOLD = 260;
const DAILY_START_HP = 20;

export const DAILY_ATTEMPTS = 3;

// 本周挑战：固定规则集、每周独立榜单与每周次数上限。
export const WEEKLY_RULESET = 'weekly-v1';
export const WEEKLY_ATTEMPTS = 3;

// 预期内的领域/请求错误：路由层据此选择状态码，其余异常继续上抛。
export class RunError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'RunError';
    this.status = status;
    this.code = code;
  }
}

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
function isFixedRulesMode(mode) {
  return mode === 'daily' || mode === 'weekly';
}

// 把已落库的选择还原成事件历史；连锁排期由 shared/events.js 从历史推导，服务端不信任客户端。
function eventHistory(run) {
  const entries = Object.entries(run.offers || {})
    .filter(([key, slot]) => key.startsWith('event:') && slot?.picked)
    .map(([key, slot]) => ({
      wave: Number(key.slice('event:'.length)),
      eventId: slot.eventId,
      optionId: slot.optionId,
    }));
  return normalizeEventHistory(entries);
}

// 事件选择与遗物选择共用 offers JSON；事件槽位加前缀避免与遗物波次键冲突。
function eventKey(wave) {
  return `event:${wave}`;
}

function maxRerollsFor(profile) {
  return 1 + (profile.unlocks.includes('extra_reroll') ? 2 : 0);
}

function difficultyPayload(difficulty) {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
  return { ...diff };
}

export class RunService {
  // 同一份 run 序列化服务 active 与 resource，避免字段再次分叉。
  serialize(run, profile, { withVictory = true } = {}) {
    const candidates = generateMapCandidates(run.seed, 3);
    const chosen = run.mapChoice >= 0 ? candidates[run.mapChoice] || null : null;
    const payload = {
      id: run.id,
      mode: run.mode,
      difficulty: run.difficulty,
      difficultyConfig: difficultyPayload(run.difficulty),
      seed: run.seed,
      day: run.day,
      wavesServed: run.wavesServed,
      clearedWaves: run.clearedWaves,
      inProgress: run.clearedWaves < run.wavesServed,
      currentWave: run.clearedWaves < run.wavesServed ? run.wavesServed : run.clearedWaves,
      mapChoice: run.mapChoice,
      map: chosen,
      mapMeta: chosen?.meta || null,
      relics: normalizeRelicStates(run.relics),
      skill: run.ruleset?.skill || null,
      ruleset: run.ruleset || null,
      mutations: run.ruleset?.mutations || null,
      status: run.status,
    };
    if (withVictory) payload.victory = !!run.victory;
    payload.maxRerolls = isFixedRulesMode(run.mode) ? 1 : maxRerollsFor(profile);
    payload.rerollsUsed = run.rerollsUsed;
    payload.towersUnlocked = isFixedRulesMode(run.mode)
      ? [...TOWER_ORDER]
      : unlockedTowerIds(profile.unlocks);
    payload.createdAt = run.createdAt;
    return payload;
  }

  active(token, profile) {
    const run = hydrateRun(findActiveRun(token));
    if (!run) return { run: null };
    return { run: this.serialize(run, profile, { withVictory: false }) };
  }

  // 只返回属于当前账号的远征，避免跨账号读取。
  ownRun(id, token) {
    const run = hydrateRun(findRun(id));
    if (!run || run.token !== token) return null;
    return run;
  }

  create({ token, profile, body, testSeed }) {
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
      if (!selection.ok) throw new RunError(400, selection.error, 'INVALID_MUTATION_COMBO');
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
      if (!SKILLS[skillId]) throw new RunError(400, '未知技能', 'INVALID_SKILL');
      if (!fixedRules && !skillUnlocked(token, skillId)) {
        throw new RunError(403, '技能尚未解锁', 'SKILL_LOCKED');
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
      throw new RunError(429, '今日挑战次数已用完');
    }
    if (mode === 'weekly' && finishedWeeklyThisWeek(token, weekly.week) >= WEEKLY_ATTEMPTS) {
      throw new RunError(429, '本周挑战次数已用完');
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
      skill: { id: skillId, level: skillLevel },
      meta: { startGold: startingGold, baseHp, maxRerolls },
    };
    if (daily) ruleset.daily = { date: day, ruleset: DAILY_RULESET };
    if (weekly) ruleset.weekly = { week: weekly.week, ruleset: WEEKLY_RULESET };
    if (mutationInfo) ruleset.mutations = mutationInfo;
    const startRelics = unlocks.includes('start_relic')
      ? rollRelicOffers(`${seed}:start:${token}`, [], 1, 1)
          .filter((offer) => offer.kind === 'relic')
          .map((offer) => ({ id: offer.id, level: offer.toLevel }))
      : [];
    const candidates = generateMapCandidates(seed, (daily || weekly) ? DAILY_MODIFIER_COUNT : 3);
    // 词缀即候选地图的词缀；校验种子派生结果与实际地图一致。
    const mapModifiers = candidates
      .map((candidate) => candidate.modifier)
      .filter(Boolean)
      .map(({ id: modifierId, name, desc, color }) => ({
        id: modifierId,
        name,
        desc,
        color,
      }));
    if (daily && !testSeed) {
      const expected = daily.modifiers.map((modifier) => modifier.id).join(',');
      const actual = mapModifiers.map((modifier) => modifier.id).join(',');
      if (actual !== expected) throw new RunError(500, '每日挑战词缀派生不一致');
    }
    if (weekly && !testSeed) {
      const expected = weekly.modifiers.map((modifier) => modifier.id).join(',');
      const actual = mapModifiers
        .slice(0, weekly.modifiers.length)
        .map((modifier) => modifier.id)
        .join(',');
      if (actual !== expected) throw new RunError(500, '本周挑战词缀派生不一致');
    }

    const id = crypto.randomBytes(9).toString('base64url');
    const boardKey = boardKeyFor(mode, day);
    abandonActiveRuns(token, Date.now());
    insertRun({
      id,
      accountId: token,
      mode,
      boardKey,
      difficulty,
      seed,
      day,
      contentVersion: CONTENT_VERSION,
      relics: JSON.stringify(startRelics),
      ruleset: JSON.stringify(ruleset),
      createdAt: Date.now(),
    });

    const dailyInfo = daily
      ? {
          day,
          seed,
          modifiers: mapModifiers,
          streak: dailyStreakFor(token, day),
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
      runId: id,
      seed,
      mode,
      difficulty,
      difficultyConfig: difficultyPayload(difficulty),
      day,
      candidates,
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
      boardKey,
      clearedWaves: 0,
      wavesServed: 0,
      dailyAttemptsLeft: mode === 'daily' ? dailyAttemptsLeft(token) : null,
      weeklyAttemptsLeft: mode === 'weekly' ? weeklyAttemptsLeft(token, weekly.week) : null,
      daily: dailyInfo,
      weekly: weeklyInfo,
    };
  }

  chooseMap(run, index) {
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      throw new RunError(400, '地图编号不合法');
    }
    const candidates = generateMapCandidates(run.seed, 3);
    const chosen = candidates[index];
    if (!chosen) throw new RunError(400, '地图不存在');
    if (run.wavesServed > 0) throw new RunError(409, '远征已经开始，不能更换地图');
    if (run.mapChoice >= 0) {
      if (run.mapChoice === index) {
        return { map: chosen, mapMeta: chosen.meta, mapChoice: index };
      }
      throw new RunError(409, '本局地图已经选择');
    }
    setMapChoice(run.id, index);
    return { map: chosen, mapMeta: chosen.meta, mapChoice: index };
  }

  serveWave(run) {
    if (run.mapChoice < 0) throw new RunError(409, '请先选择地图');
    const candidates = generateMapCandidates(run.seed, 3);
    const mapMeta = candidates[run.mapChoice]?.meta || {};
    // 变异挑战在既有地图词缀上叠加 hpMul/speedMul，不改波次结构与 RNG 顺序。
    const mutationIds = run.ruleset?.mutations?.ids || [];
    const waveOptions = {
      portalCount: mapMeta.portalCount || 1,
      modifier: composeWaveModifier(mapMeta.modifier || null, mutationIds),
    };
    const endless = run.mode === 'endless';
    // 有未结算波次时重放当前波，不推进波次、不重复发奖。
    if (run.clearedWaves < run.wavesServed) {
      const current = run.wavesServed;
      return {
        wave: generateWave(run.seed, current, run.difficulty, waveOptions, { endless }),
        replay: true,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
      };
    }
    // 普通/每日模式在第 30 波后结束；无尽模式继续生成递增波次。
    if (!endless && run.clearedWaves >= MAX_WAVE) throw new RunError(409, '已抵达最终波次');
    const next = run.wavesServed + 1;
    setWavesServed(run.id, next);
    return {
      wave: generateWave(run.seed, next, run.difficulty, waveOptions, { endless }),
      replay: false,
      clearedWaves: run.clearedWaves,
      wavesServed: next,
    };
  }

  clearWave(run, wave) {
    const maxWave = run.mode === 'endless' ? ENDLESS.maxIndex : MAX_WAVE;
    if (!Number.isFinite(wave) || wave < 1 || wave > maxWave) {
      throw new RunError(400, '波次号不合法');
    }
    if (wave > run.wavesServed) throw new RunError(409, '该波次尚未放行');
    if (wave <= run.clearedWaves) {
      return {
        ok: true,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
        nextWave: run.wavesServed + 1,
        duplicate: true,
      };
    }
    if (wave !== run.wavesServed) throw new RunError(409, '只能结算当前进行中的波次');
    setClearedWaves(run.id, wave);
    return {
      ok: true,
      clearedWaves: wave,
      wavesServed: run.wavesServed,
      nextWave: wave + 1,
    };
  }

  relicOffers(run, profile, { reroll = false } = {}) {
    if (run.clearedWaves !== run.wavesServed) {
      throw new RunError(409, '当前波次尚未结算完成');
    }
    const key = String(run.clearedWaves);
    const maxRerolls = maxRerollsFor(profile);
    let rerollsUsed = run.rerollsUsed;
    const offers = run.offers || {};

    if (reroll) {
      if (offers[key]?.picked) throw new RunError(409, '本次遗物已选择，不能刷新');
      if (rerollsUsed >= maxRerolls) throw new RunError(409, '刷新次数已用完');
      rerollsUsed += 1;
      delete offers[key];
    }

    const relicStates = normalizeRelicStates(run.relics);
    let slot = offers[key];
    // 兼容旧进行中远征的 { ids: [...] } 格式。
    if (slot && Array.isArray(slot.ids)) {
      slot = {
        offers: slot.ids
          .map((id) => {
            if (!RELIC_BY_ID[id]) return null;
            const fromLevel = relicStates.find((state) => state.id === id)?.level || 0;
            return {
              kind: 'relic',
              id,
              fromLevel,
              toLevel: Math.min(RELIC_MAX_LEVEL, fromLevel + 1),
            };
          })
          .filter(Boolean),
        picked: false,
      };
      offers[key] = slot;
    }
    if (!slot) {
      slot = {
        offers: rollRelicOffers(
          `${run.seed}:relic:${run.clearedWaves}:${rerollsUsed}`,
          relicStates,
          3,
          run.clearedWaves
        ),
        picked: false,
      };
      offers[key] = slot;
    }

    setOffersAndRerolls(run.id, JSON.stringify(offers), rerollsUsed);

    return {
      wave: run.clearedWaves,
      offers: slot.offers,
      picked: !!slot.picked,
      relics: relicStates,
      rerollsUsed,
      maxRerolls,
    };
  }

  pickRelic(run, { index, relicId } = {}) {
    if (run.clearedWaves !== run.wavesServed) {
      throw new RunError(409, '当前波次尚未结算完成');
    }
    const offers = run.offers || {};
    const key = String(run.clearedWaves);
    const slot = offers[key];
    if (!slot || !Array.isArray(slot.offers)) throw new RunError(400, '本次遗物选项不存在');
    if (slot.picked) throw new RunError(409, '本次遗物已经选择');

    let offer = null;
    const offerIndex = Number(index);
    if (Number.isInteger(offerIndex) && offerIndex >= 0 && offerIndex < slot.offers.length) {
      offer = slot.offers[offerIndex];
    } else if (relicId) {
      offer = slot.offers.find(
        (item) => item.kind === 'relic' && item.id === String(relicId)
      );
    }
    if (!offer) throw new RunError(400, '选择不在本次选项中');

    const states = normalizeRelicStates(run.relics);
    if (offer.kind === 'relic') {
      const existing = states.find((state) => state.id === offer.id);
      const targetLevel = Math.min(
        RELIC_MAX_LEVEL,
        Math.max(offer.toLevel || 1, (existing?.level || 0) + 1)
      );
      if (existing) existing.level = targetLevel;
      else states.push({ id: offer.id, level: targetLevel });
      setRelics(run.id, JSON.stringify(states));
    }

    slot.picked = true;
    setOffers(run.id, JSON.stringify(offers));
    return { applied: offer, picked: true, relics: states };
  }

  // 局内事件节点：与遗物选择同一套幂等模型，状态寄存在 offers JSON 的 event:<wave> 槽位。
  eventNode(run) {
    if (run.clearedWaves !== run.wavesServed) {
      throw new RunError(409, '当前波次尚未结算完成');
    }
    const wave = run.clearedWaves;
    // 已选择的波次仍要回显节点：剔除本波历史后重新推导，未选择时才按“未结算”判断。
    const history = eventHistory(run).filter((entry) => entry.wave !== wave);
    const event = resolveEventForWave(run.seed, wave, { history });
    if (!event) throw new RunError(409, '当前波次没有事件节点');
    const slot = (run.offers || {})[eventKey(wave)];
    return {
      wave,
      event,
      picked: !!slot?.picked,
      choice: slot?.picked
        ? { eventId: slot.eventId, optionId: slot.optionId, optionIndex: slot.optionIndex }
        : null,
    };
  }

  pickEvent(run, { index, optionId } = {}) {
    if (run.clearedWaves !== run.wavesServed) {
      throw new RunError(409, '当前波次尚未结算完成');
    }
    const wave = run.clearedWaves;
    const offers = run.offers || {};
    const key = eventKey(wave);
    // 先判幂等：已选择的事件不能再解析（否则历史会让该波次看起来“没有事件节点”）。
    if (offers[key]?.picked) throw new RunError(409, '本次事件已经选择');

    const event = resolveEventForWave(run.seed, wave, { history: eventHistory(run) });
    if (!event) throw new RunError(400, '当前波次没有事件节点');

    let option = null;
    let optionIndex = -1;
    const parsed = Number(index);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < event.options.length) {
      option = event.options[parsed];
      optionIndex = parsed;
    } else if (optionId != null) {
      option = findEventOption(event, optionId);
      if (option) optionIndex = event.options.indexOf(option);
    }
    if (!option) throw new RunError(400, '选择不在本次事件选项中');

    offers[key] = {
      picked: true,
      eventId: event.id,
      optionId: option.id,
      optionIndex,
    };
    setOffers(run.id, JSON.stringify(offers));
    return {
      wave,
      applied: { kind: 'event', eventId: event.id, optionId: option.id, optionIndex },
      picked: true,
    };
  }

  // 回放摘要只保留决策与结果：种子、地图、遗物、事件节点与波次/结算数据。
  // 不包含任何模拟帧或逐帧状态。
  replaySummary(run, payload) {
    const chosen =
      run.mapChoice >= 0 ? generateMapCandidates(run.seed, 3)[run.mapChoice] || null : null;
    const events = Object.entries(run.offers || {})
      .filter(([key]) => key.startsWith('event:'))
      .map(([key, slot]) => {
        const wave = Number(key.slice('event:'.length));
        if (!slot?.picked || !Number.isInteger(wave)) return null;
        return {
          wave,
          eventId: slot.eventId,
          optionId: slot.optionId,
          optionIndex: slot.optionIndex,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.wave - b.wave);
    return {
      map: {
        choice: run.mapChoice,
        archetype: chosen?.archetype || null,
        archetypeName: chosen?.archetypeName || null,
        modifier: chosen?.modifier || null,
      },
      skill: run.ruleset?.skill || null,
      mutations: run.ruleset?.mutations || null,
      relics: normalizeRelicStates(run.relics),
      events,
      waves: {
        served: run.wavesServed,
        cleared: run.clearedWaves,
        reached: payload.waveReached,
      },
    };
  }

  settle(run, profile, body) {
    const token = run.token;
    const payload = clampFinishPayload(body, run.clearedWaves);
    const mapMeta =
      run.mapChoice >= 0
        ? generateMapCandidates(run.seed, 3)[run.mapChoice]?.meta || null
        : null;
    const mutationMul = mutationScoreMul(run.ruleset?.mutations?.ids || []);
    const outcome = computeOutcome({
      ...payload,
      wavesServed: run.clearedWaves,
      difficulty: run.difficulty,
      scoreMul: (mapMeta?.scoreMul || 1) * mutationMul,
      mode: run.mode,
    });
    const now = Date.now();
    const durationMs = Math.max(0, now - run.createdAt);
    // 无尽榜按结算时间归入赛季，与榜单 created_at 的赛季边界保持一致。
    const season = seasonOf(now);

    const isPersonalBest = outcome.score > personalBest(token, run.mode, run.day, { season });
    const replayId = crypto.randomBytes(9).toString('base64url');
    const replayResult = {
      victory: outcome.victory,
      score: outcome.score,
      rawScore: outcome.rawScore,
      coresEarned: outcome.cores,
      waveReached: payload.waveReached,
      kills: payload.kills,
      goldLeft: payload.goldLeft,
      baseHp: payload.baseHp,
      durationMs,
      contentVersion: run.contentVersion,
    };

    // 结算与回放摘要在同一事务里落地：任一步失败都不会留下半局记录。
    transaction(() => {
      settleRun(run.id, {
        victory: outcome.victory,
        score: outcome.score,
        waveReached: payload.waveReached,
        kills: payload.kills,
        durationMs,
        result: JSON.stringify({
          rawScore: outcome.rawScore,
          coresEarned: outcome.cores,
          goldLeft: payload.goldLeft,
          baseHp: payload.baseHp,
          contentVersion: run.contentVersion,
        }),
        finishedAt: now,
      });
      insertReplay({
        id: replayId,
        accountId: token,
        runId: run.id,
        mode: run.mode,
        difficulty: run.difficulty,
        seed: run.seed,
        mapChoice: run.mapChoice,
        summary: JSON.stringify(this.replaySummary(run, payload)),
        result: JSON.stringify(replayResult),
        createdAt: run.createdAt,
        finishedAt: now,
      });
    });

    // 归档发生在结算事务之外：失败只影响历史聚合，绝不影响本局结算。
    // 明细删除与聚合写入同事务，下次结算会整体重试。
    try {
      archiveOld(token, REPLAY_LIMIT);
    } catch {
      /* 归档失败不影响结算 */
    }

    // 首通授予必须在更新战绩之前：skillUnlocked 会从历史首通派生，
    // 先写 wins 会让本次授予误判为「已解锁」而返回 null。
    const unlockedSkillId = outcome.victory
      ? grantVictorySkillUnlock(token, run.difficulty)
      : null;
    const unlockedSkills = unlockedSkillId
      ? [{ id: unlockedSkillId, name: SKILLS[unlockedSkillId].name }]
      : [];

    // 入榜前过基线反作弊：异常成绩直接拒绝入榜但照常结算，可疑成绩钳制后标记。
    // 变异倍率同步放宽反作弊上下限，否则合法的高倍率成绩会被误判。
    const guard = validateLeaderboardEntry(
      {
        score: outcome.score,
        durationMs,
        wave: payload.waveReached,
        kills: payload.kills,
      },
      { scoreMul: mutationMul }
    );
    const guardEvent = {
      runId: run.id,
      reason: guard.reason,
      flags: guard.flags,
      mode: run.mode,
      difficulty: run.difficulty,
      wave: payload.waveReached,
      kills: guard.kills,
      durationMs,
      score: outcome.score,
    };
    let leaderboardNotice = null;

    if (guard.accepted) {
      recordLeaderboardEntry({
        accountId: token,
        displayName: profile.name,
        runId: run.id,
        mode: run.mode,
        day: run.day,
        difficulty: run.difficulty,
        score: outcome.score,
        durationMs,
        wave: payload.waveReached,
        kills: guard.kills,
        victory: outcome.victory,
        suspect: guard.suspect,
        contentVersion: run.contentVersion || CONTENT_VERSION,
        createdAt: now,
      });
      if (guard.suspect) {
        recordPlayerEvent(token, 'leaderboard_suspect', guardEvent);
        leaderboardNotice = '本局成绩已记录，正在复核。';
      }
    } else {
      recordPlayerEvent(token, 'leaderboard_rejected', guardEvent);
      leaderboardNotice = '本局成绩未能进入排行榜，已提交复核。';
    }

    const stats = normalizeStats(profile.stats);
    stats.runs += 1;
    stats.kills += payload.kills;
    if (outcome.victory) stats.wins += 1;
    const byDiff = stats.byDifficulty[run.difficulty];
    byDiff.runs += 1;
    byDiff.bestWave = Math.max(byDiff.bestWave, payload.waveReached);
    byDiff.bestScore = Math.max(byDiff.bestScore, outcome.score);
    if (outcome.victory) byDiff.wins += 1;

    const updated = updateProfile(token, {
      cores: profile.cores + outcome.cores,
      stats,
    });

    recordPlayerEvent(token, 'run_finished', {
      runId: run.id,
      mode: run.mode,
      difficulty: run.difficulty,
      score: outcome.score,
      victory: outcome.victory,
      waveReached: payload.waveReached,
    });

    const unlockedAchievements = unlockAchievements(token, {
      run: {
        mode: run.mode,
        difficulty: run.difficulty,
        victory: outcome.victory,
        waveReached: payload.waveReached,
        kills: payload.kills,
        score: outcome.score,
        durationMs,
        relics: run.relics,
      },
      stats: updated.stats,
    });

    const rank = rankFor(run.mode, run.day, outcome.score, {
      includeUnclaimed: !AUTH_ENABLED,
      season,
      wave: payload.waveReached,
      durationMs,
    });

    return {
      victory: outcome.victory,
      difficulty: run.difficulty,
      replayId,
      waveReached: payload.waveReached,
      rawScore: outcome.rawScore,
      score: outcome.score,
      coresEarned: outcome.cores,
      totalCores: updated.cores,
      personalBest: guard.accepted && isPersonalBest,
      rank,
      durationMs,
      skill: run.ruleset?.skill || null,
      mutations: run.ruleset?.mutations || null,
      unlockedSkill: unlockedSkillId || null,
      unlockedSkills,
      dailyAttemptsLeft: run.mode === 'daily' ? dailyAttemptsLeft(token) : null,
      weeklyAttemptsLeft:
        run.mode === 'weekly' ? weeklyAttemptsLeft(token, run.day) : null,
      unlockedAchievements,
      // 仅在成绩被拒绝或标记可疑时附加面向玩家的非技术化提示；正常对局不增加字段。
      ...(leaderboardNotice ? { leaderboardNotice } : {}),
    };
  }

  abandon(run) {
    markAbandoned(run.id, Date.now());
    return { ok: true };
  }
}
