// 远征领域服务：状态迁移规则、结算编排与响应序列化；SQL 全部委托给仓储层。
import crypto from 'node:crypto';

import { hydrateRun, normalizeStats, updateProfile } from '../db.mjs';
import {
  abandonActiveRuns,
  countFinishedDailyRuns,
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
import { personalBest, rankFor, recordLeaderboardEntry } from '../db/leaderboard.mjs';
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
import { generateWave } from '../../public/js/shared/waves.js';
import { findEventOption, rollEvent } from '../../public/js/shared/events.js';
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
  clampFinishPayload,
  computeOutcome,
  DAILY_MODIFIER_COUNT,
  dailyChallenge,
  dailyStreak,
  dayKey,
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
      status: run.status,
    };
    if (withVictory) payload.victory = !!run.victory;
    payload.maxRerolls = run.mode === 'daily' ? 1 : maxRerollsFor(profile);
    payload.rerollsUsed = run.rerollsUsed;
    payload.towersUnlocked =
      run.mode === 'daily' ? [...TOWER_ORDER] : unlockedTowerIds(profile.unlocks);
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
    const mode = body.mode === 'daily' ? 'daily' : 'normal';
    const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : 'standard';
    const diff = DIFFICULTIES[difficulty];
    const day = dayKey();
    const challenge = mode === 'daily' ? dailyChallenge(day) : null;

    // 技能选择：每日允许任意技能且固定 5 级；普通局必须已解锁，等级只从 DB 读。
    let skillId = null;
    if (body.skillId != null && body.skillId !== '') {
      skillId = String(body.skillId);
      if (!SKILLS[skillId]) throw new RunError(400, '未知技能', 'INVALID_SKILL');
      if (mode !== 'daily' && !skillUnlocked(token, skillId)) {
        throw new RunError(403, '技能尚未解锁', 'SKILL_LOCKED');
      }
    }
    if (!skillId) {
      const selected = readSelectedSkill(token);
      skillId =
        selected && (mode === 'daily' || skillUnlocked(token, selected)) ? selected : 'aurora';
    }
    const skillLevel = mode === 'daily' ? DAILY_SKILL_LEVEL : readSkillLevel(token, skillId);
    if (mode === 'daily' && finishedDailyToday(token) >= DAILY_ATTEMPTS) {
      throw new RunError(429, '今日挑战次数已用完');
    }

    const seed = testSeed
      ? `test-${testSeed}`
      : challenge
        ? challenge.seed
        : crypto.randomBytes(8).toString('hex');
    const unlocks = profile.unlocks;
    // 每日使用固定开局资源，忽略难度加成与账号 meta 加成，保证榜单公平。
    const startingGold =
      mode === 'daily'
        ? DAILY_START_GOLD
        : Math.max(100, START_GOLD + (unlocks.includes('start_gold') ? META_GOLD : 0) + diff.goldBonus);
    const baseHp =
      mode === 'daily'
        ? DAILY_START_HP
        : Math.max(8, START_HP + (unlocks.includes('start_hp') ? META_HP : 0) + diff.hpBonus);
    const maxRerolls = mode === 'daily' ? 1 : maxRerollsFor(profile);
    const ruleset = {
      v: 1,
      contentVersion: CONTENT_VERSION,
      skill: { id: skillId, level: skillLevel },
      meta: { startGold: startingGold, baseHp, maxRerolls },
    };
    if (mode === 'daily') ruleset.daily = { date: day, ruleset: DAILY_RULESET };
    const startRelics = unlocks.includes('start_relic')
      ? rollRelicOffers(`${seed}:start:${token}`, [], 1, 1)
          .filter((offer) => offer.kind === 'relic')
          .map((offer) => ({ id: offer.id, level: offer.toLevel }))
      : [];
    const candidates = generateMapCandidates(seed, challenge ? DAILY_MODIFIER_COUNT : 3);
    // 当日词缀即三张候选地图的词缀；校验种子派生结果与实际地图一致。
    const dailyModifiers = candidates
      .map((candidate) => candidate.modifier)
      .filter(Boolean)
      .map(({ id: modifierId, name, desc, color }) => ({
        id: modifierId,
        name,
        desc,
        color,
      }));
    if (challenge && !testSeed) {
      const expected = challenge.modifiers.map((modifier) => modifier.id).join(',');
      const actual = dailyModifiers.map((modifier) => modifier.id).join(',');
      if (actual !== expected) throw new RunError(500, '每日挑战词缀派生不一致');
    }

    const id = crypto.randomBytes(9).toString('base64url');
    const boardKey = mode === 'daily' ? `daily:${day}:v2` : 'normal';
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

    const daily = challenge
      ? {
          day,
          seed,
          modifiers: dailyModifiers,
          streak: dailyStreakFor(token, day),
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
      // 每日挑战开放全部塔，保证同一规则集下的榜单公平。
      towersUnlocked: mode === 'daily' ? [...TOWER_ORDER] : unlockedTowerIds(unlocks),
      skill: ruleset.skill,
      ruleset,
      maxRerolls,
      clearedWaves: 0,
      wavesServed: 0,
      dailyAttemptsLeft: mode === 'daily' ? dailyAttemptsLeft(token) : null,
      daily,
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
    const waveOptions = {
      portalCount: mapMeta.portalCount || 1,
      modifier: mapMeta.modifier || null,
    };
    // 有未结算波次时重放当前波，不推进波次、不重复发奖。
    if (run.clearedWaves < run.wavesServed) {
      const current = run.wavesServed;
      return {
        wave: generateWave(run.seed, current, run.difficulty, waveOptions),
        replay: true,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
      };
    }
    if (run.clearedWaves >= MAX_WAVE) throw new RunError(409, '已抵达最终波次');
    const next = run.wavesServed + 1;
    setWavesServed(run.id, next);
    return {
      wave: generateWave(run.seed, next, run.difficulty, waveOptions),
      replay: false,
      clearedWaves: run.clearedWaves,
      wavesServed: next,
    };
  }

  clearWave(run, wave) {
    if (!Number.isFinite(wave) || wave < 1 || wave > MAX_WAVE) {
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
    const event = rollEvent(run.seed, wave);
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
    const event = rollEvent(run.seed, wave);
    if (!event) throw new RunError(400, '当前波次没有事件节点');

    const offers = run.offers || {};
    const key = eventKey(wave);
    if (offers[key]?.picked) throw new RunError(409, '本次事件已经选择');

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

  settle(run, profile, body) {
    const token = run.token;
    const payload = clampFinishPayload(body, run.clearedWaves);
    const mapMeta =
      run.mapChoice >= 0
        ? generateMapCandidates(run.seed, 3)[run.mapChoice]?.meta || null
        : null;
    const outcome = computeOutcome({
      ...payload,
      wavesServed: run.clearedWaves,
      difficulty: run.difficulty,
      scoreMul: mapMeta?.scoreMul || 1,
    });
    const now = Date.now();
    const durationMs = Math.max(0, now - run.createdAt);

    const isPersonalBest = outcome.score > personalBest(token, run.mode, run.day);

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

    // 首通授予必须在更新战绩之前：skillUnlocked 会从历史首通派生，
    // 先写 wins 会让本次授予误判为「已解锁」而返回 null。
    const unlockedSkillId = outcome.victory
      ? grantVictorySkillUnlock(token, run.difficulty)
      : null;
    const unlockedSkills = unlockedSkillId
      ? [{ id: unlockedSkillId, name: SKILLS[unlockedSkillId].name }]
      : [];

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
      kills: payload.kills,
      victory: outcome.victory,
      contentVersion: run.contentVersion || CONTENT_VERSION,
      createdAt: now,
    });

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
    });

    return {
      victory: outcome.victory,
      difficulty: run.difficulty,
      waveReached: payload.waveReached,
      rawScore: outcome.rawScore,
      score: outcome.score,
      coresEarned: outcome.cores,
      totalCores: updated.cores,
      personalBest: isPersonalBest,
      rank,
      durationMs,
      skill: run.ruleset?.skill || null,
      unlockedSkill: unlockedSkillId || null,
      unlockedSkills,
      dailyAttemptsLeft: run.mode === 'daily' ? dailyAttemptsLeft(token) : null,
      unlockedAchievements,
    };
  }

  abandon(run) {
    markAbandoned(run.id, Date.now());
    return { ok: true };
  }
}
