// 远征领域服务：状态迁移编排、对外响应序列化与领域错误；规则与开局计算在 run-rules.mjs，
// 结算编排在 run-settlement.mjs，SQL 全部委托给仓储层。
import crypto from 'node:crypto';

import { hydrateRun } from '../db.mjs';
import {
  abandonActiveRuns,
  findActiveRun,
  findRun,
  insertRun,
  markAbandoned,
  setClearedWaves,
  setMapChoice,
  setOffers,
  setOffersAndRerolls,
  setRelics,
  setRuleset,
  setWavesServed,
} from '../db/runs.mjs';
import { ENDLESS, generateWave } from '../../public/js/shared/waves.js';
import { findEventOption, resolveEventForWave } from '../../public/js/shared/events.js';
import {
  rollRelicOffers,
  normalizeRelicStates,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  TOWER_ORDER,
  unlockedTowerIds,
  MAX_WAVE,
} from '../../public/js/shared/data.js';
import { composeWaveModifier } from '../../public/js/shared/mutations.js';
import { HEX_POOL_VERSION, validateHexChoice } from '../../public/js/shared/hexes.js';
import { applyBossCore, isBossCoreWave, rollBossCoreOffers } from '../../public/js/shared/boss-core.js';
import { applyContract, CONTRACT_MAX_PER_RUN, rollContractOffer } from '../../public/js/shared/contracts.js';
import {
  RELIC_OFFER_COUNT,
  RELIC_REROLL_COST,
  chosenMapFor,
  dailyStreakFor,
  difficultyPayload,
  eventHistory,
  eventKey,
  hexFor,
  hexOffersOf,
  hexRuntimeFor,
  isFixedRulesMode,
  mapCandidatesFor,
  maxRerollsFor,
  planRunStart,
  starterFor,
} from './run-rules.mjs';
import { settleRunOutcome } from './run-settlement.mjs';

// 预期内的领域/请求错误：路由层据此选择状态码，其余异常继续上抛。
export class RunError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'RunError';
    this.status = status;
    this.code = code;
  }
}

// 首领核心（§4）：offers JSON 的 core:<wave> 槽位与 event:<wave> 同幂等模型；已选教义数与补给刷新加码都从已选槽位派生。
function coreDoctrineCount(run) {
  return Object.entries(run.offers || {}).filter(
    ([key, slot]) => key.startsWith('core:') && slot?.picked && slot.kind === 'doctrine'
  ).length;
}

function coreRerollBonus(run) {
  return Object.entries(run.offers || {})
    .filter(([key]) => key.startsWith('core:'))
    .reduce((sum, [, slot]) => sum + (slot?.picked && slot.kind === 'supply' && slot.option?.type === 'reroll'
      ? Math.max(0, Math.floor(Number(slot.option.amount) || 0))
      : 0), 0);
}

// 契约（§5）：已接受数从 ruleset.rogue2.contracts 派生，服务端据此控制每局上限与候选生成。
function contractCount(run) {
  return Array.isArray(run.ruleset?.rogue2?.contracts) ? run.ruleset.rogue2.contracts.length : 0;
}

export class RunService {
  // 同一份 run 序列化服务 active 与 resource，避免字段再次分叉。
  serialize(run, profile, { withVictory = true } = {}) {
    const chosen = chosenMapFor(run);
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
      // 已选主海克斯（旧 run 为 null）与本次开局的三选一；刷新恢复读同一组。
      hex: hexFor(run),
      hexOffers: hexOffersOf(run),
      // 信物三选一：旧 run 无该字段时为 null，客户端据此跳过信物流程。
      starter: starterFor(run),
      ruleset: run.ruleset || null,
      mutations: run.ruleset?.mutations || null,
      status: run.status,
    };
    if (withVictory) payload.victory = !!run.victory;
    // 刷新次数：基础（固定规则模式恒为 1）算清后交给主海克斯加码（遗物吞噬者 +2 / 赌徒之骰 +1）。
    const baseMaxRerolls = isFixedRulesMode(run.mode) ? 1 : maxRerollsFor(profile);
    payload.maxRerolls = hexRuntimeFor(run).relicRerollBonus(baseMaxRerolls) + coreRerollBonus(run);
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

  // 开局：规则计算在 run-rules.mjs，这里只做领域错误转换与落库编排。
  create({ token, profile, body, testSeed }) {
    const plan = planRunStart({ token, profile, body, testSeed });
    if (plan.error) {
      throw new RunError(plan.error.status, plan.error.message, plan.error.code);
    }
    const id = crypto.randomBytes(9).toString('base64url');
    abandonActiveRuns(token, Date.now());
    insertRun({
      id,
      accountId: token,
      ...plan.run,
      relics: JSON.stringify(plan.run.relics),
      ruleset: JSON.stringify(plan.run.ruleset),
      createdAt: Date.now(),
    });
    const response = plan.response;
    // 连续参与天数由 runs 记录派生：本局落库后才计入当日参与，必须在插入之后读。
    if (response.daily) response.daily.streak = dailyStreakFor(token, response.day);
    return { runId: id, ...response };
  }

  // 开局主海克斯：必须在放行波次前选定；重复选择同一 id 幂等，换 id 一律 409。
  chooseHex(run, hexId) {
    const id = typeof hexId === 'string' ? hexId.trim() : '';
    const chosen = hexFor(run);
    const offers = hexOffersOf(run);
    if (chosen) {
      if (chosen.id === id) return { hex: chosen, hexOffers: offers, alreadyChosen: true };
      throw new RunError(409, '本局海克斯已经选择，不能更换', 'HEX_LOCKED');
    }
    if (run.wavesServed > 0) {
      throw new RunError(409, '远征已经开始，不能选择海克斯', 'HEX_LOCKED');
    }
    if (!validateHexChoice(id, offers)) {
      throw new RunError(400, '选择不在本次海克斯选项中', 'INVALID_HEX');
    }
    const ruleset = {
      ...(run.ruleset || {}),
      hex: { id, offers: [...offers], poolVersion: HEX_POOL_VERSION },
    };
    setRuleset(run.id, JSON.stringify(ruleset));
    run.ruleset = ruleset;
    return { hex: hexFor(run), hexOffers: offers, alreadyChosen: false };
  }

  // 开局信物：必须在放行波次前选定；重复选择同一 id 幂等，换 id 一律 409。
  // 候选由服务端开局时派生并持久化在 ruleset.rogue2.starter，客户端不得自造。
  chooseStarter(run, relicId) {
    const id = typeof relicId === 'string' ? relicId.trim() : '';
    const starter = starterFor(run);
    if (!starter) throw new RunError(409, '本局没有信物三选一', 'STARTER_LOCKED');
    if (starter.picked) {
      if (starter.picked === id) {
        return { starter, relics: normalizeRelicStates(run.relics), alreadyChosen: true };
      }
      throw new RunError(409, '本局信物已经选择，不能更换', 'STARTER_LOCKED');
    }
    if (run.wavesServed > 0) {
      throw new RunError(409, '远征已经开始，不能选择信物', 'STARTER_LOCKED');
    }
    if (!RELIC_BY_ID[id] || !starter.offers.includes(id)) {
      throw new RunError(400, '选择不在本次信物选项中', 'INVALID_STARTER');
    }
    const relics = [{ id, level: 1 }];
    const ruleset = {
      ...(run.ruleset || {}),
      rogue2: { starter: { offers: [...starter.offers], picked: id } },
    };
    setRelics(run.id, JSON.stringify(relics));
    setRuleset(run.id, JSON.stringify(ruleset));
    run.relics = relics;
    run.ruleset = ruleset;
    return { starter: starterFor(run), relics: normalizeRelicStates(run.relics), alreadyChosen: false };
  }

  chooseMap(run, index) {    if (!Number.isInteger(index) || index < 0 || index > 2) {
      throw new RunError(400, '地图编号不合法');
    }
    const candidates = mapCandidatesFor(run);
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
    const candidates = mapCandidatesFor(run);
    const mapMeta = candidates[run.mapChoice]?.meta || {};
    // 变异挑战在既有地图词缀上叠加 hpMul/speedMul，不改波次结构与 RNG 顺序。
    const mutationIds = run.ruleset?.mutations?.ids || [];
    const waveOptions = {
      portalCount: mapMeta.portalCount || 1,
      modifier: composeWaveModifier(mapMeta.modifier || null, mutationIds),
    };
    const endless = run.mode === 'endless';
    // 未选海克斯的旧流程仍可进行；hex 只作为本局规则从 ruleset 回传。
    const hex = hexFor(run);
    // 有未结算波次时重放当前波，不推进波次、不重复发奖。
    if (run.clearedWaves < run.wavesServed) {
      const current = run.wavesServed;
      return {
        wave: generateWave(run.seed, current, run.difficulty, waveOptions, { endless }),
        replay: true,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
        hex,
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
      hex,
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
    // 遗物数量/刷新费用/刷新次数上限/抽取模式经由共享 hex 定义（遗物吞噬者、赌徒之骰）。
    const hexRuntime = hexRuntimeFor(run);
    const maxRerolls = hexRuntime.relicRerollBonus(maxRerollsFor(profile)) + coreRerollBonus(run);
    const offerCount = hexRuntime.relicOfferCount(RELIC_OFFER_COUNT);
    const rerollCost = hexRuntime.relicRerollCost(RELIC_REROLL_COST, run.rerollsUsed);
    // 赌徒之骰：跳过稀有度权重，走完全随机池（与 run.mode 分离，无尽模式同样生效）。
    const relicMode = hexRuntime.gamblerRelicMode ? 'gambler' : run.mode;
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
      const rolled = rollRelicOffers(
        `${run.seed}:relic:${run.clearedWaves}:${rerollsUsed}`,
        relicStates,
        offerCount,
        run.clearedWaves,
        relicMode
      );
      // 契约卡（§5.1）：仅在契约波次的首次三选一替换一张遗物卡；刷新后随整组消失，不再补插。
      if (!reroll) {
        const contract = rollContractOffer(run.seed, run.clearedWaves, {
          accepted: contractCount(run),
          relics: relicStates,
        });
        if (contract && rolled.length) rolled[rolled.length - 1] = contract;
      }
      slot = {
        offers: rolled,
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
      rerollCost,
      offerCount,
    };
  }

  pickRelic(run, { index, relicId } = {}, profile = null) {
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
    } else if (offer.kind === 'contract') {
      // 契约卡（§5）：服务端权威结算遗物/契约记录/bonusPoints；金币/生命等客户端可模拟资源随客户端本地结算。
      if (contractCount(run) >= CONTRACT_MAX_PER_RUN) {
        throw new RunError(409, '本局已接受两次契约', 'CONTRACT_LIMIT');
      }
      const maxRerolls = hexRuntimeFor(run).relicRerollBonus(maxRerollsFor(profile)) + coreRerollBonus(run);
      const remaining = Math.max(0, maxRerolls - (run.rerollsUsed || 0));
      const result = applyContract(
        {
          gold: 0,
          hp: 1,
          maxHp: 1,
          rerolls: remaining,
          relics: states,
          bonusPoints: run.ruleset?.rogue2?.bonusPoints || {},
          contracts: run.ruleset?.rogue2?.contracts || [],
          wave: run.clearedWaves,
        },
        offer
      );
      if (!result.ok) throw new RunError(400, '契约代价不足', 'CONTRACT_UNAFFORDABLE');
      if (JSON.stringify(result.state.relics) !== JSON.stringify(states)) {
        setRelics(run.id, JSON.stringify(result.state.relics));
      }
      const rogue2 = {
        ...(run.ruleset?.rogue2 || {}),
        contracts: result.state.contracts,
        bonusPoints: result.state.bonusPoints,
      };
      const ruleset = { ...(run.ruleset || {}), rogue2 };
      setRuleset(run.id, JSON.stringify(ruleset));
      run.ruleset = ruleset;
      slot.picked = true;
      if (offer.id === 'debt') {
        run.rerollsUsed = (run.rerollsUsed || 0) + 1;
        setOffersAndRerolls(run.id, JSON.stringify(offers), run.rerollsUsed);
      } else {
        setOffers(run.id, JSON.stringify(offers));
      }
      return {
        applied: offer,
        picked: true,
        relics: result.state.relics,
        contracts: result.state.contracts,
        bonusPoints: result.state.bonusPoints,
        rerollsUsed: run.rerollsUsed,
        event: result.event,
      };
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
    const event = resolveEventForWave(run.seed, wave, { history, mode: run.mode });
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

    const event = resolveEventForWave(run.seed, wave, {
      history: eventHistory(run),
      mode: run.mode,
    });
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

  // 首领核心节点（§4.1）：清波后、遗物三选一前发放；候选由服务端从种子确定性派生。
  bossCoreNode(run) {
    if (run.clearedWaves !== run.wavesServed) {
      throw new RunError(409, '当前波次尚未结算完成');
    }
    const wave = run.clearedWaves;
    if (!isBossCoreWave(wave)) throw new RunError(409, '当前波次没有首领核心');
    const offers = run.offers || {};
    const key = `core:${wave}`;
    let slot = offers[key];
    if (!slot || !Array.isArray(slot.offers)) {
      slot = {
        offers: rollBossCoreOffers(run.seed, wave, normalizeRelicStates(run.relics), {
          doctrineTaken: coreDoctrineCount(run),
        }),
        picked: false,
      };
      offers[key] = slot;
      setOffers(run.id, JSON.stringify(offers));
    }
    return {
      wave,
      offers: slot.offers,
      picked: !!slot.picked,
      choice: slot.picked
        ? { kindIndex: slot.kindIndex, optionIndex: slot.optionIndex, kind: slot.kind, option: slot.option }
        : null,
    };
  }

  pickBossCore(run, { index, optionIndex } = {}) {
    if (run.clearedWaves !== run.wavesServed) {
      throw new RunError(409, '当前波次尚未结算完成');
    }
    const wave = run.clearedWaves;
    if (!isBossCoreWave(wave)) throw new RunError(400, '当前波次没有首领核心');
    const offers = run.offers || {};
    const key = `core:${wave}`;
    const slot = offers[key];
    if (!slot || !Array.isArray(slot.offers)) throw new RunError(400, '本次首领核心选项不存在');
    if (slot.picked) throw new RunError(409, '本次首领核心已经选择');

    const kindIndex = Number(index);
    const parsedOption = Number(optionIndex);
    if (!Number.isInteger(kindIndex) || kindIndex < 0 || kindIndex >= slot.offers.length) {
      throw new RunError(400, '首领核心编号不合法');
    }
    const kindOffer = slot.offers[kindIndex];
    const option = Array.isArray(kindOffer.options)
      ? kindOffer.options[parsedOption]
      : null;
    if (!Number.isInteger(parsedOption) || parsedOption < 0 || !option) {
      throw new RunError(400, '选择不在本次首领核心选项中');
    }

    const beforeRelics = normalizeRelicStates(run.relics);
    const delta = applyBossCore({ kind: kindOffer.kind, option }, beforeRelics);
    // 遗物等级是服务端权威：升阶/搜寻即时落库；金币/生命/刷新等客户端模拟资源随 delta 回传。
    if (JSON.stringify(delta.relics) !== JSON.stringify(beforeRelics)) {
      setRelics(run.id, JSON.stringify(delta.relics));
    }
    offers[key] = {
      offers: slot.offers,
      picked: true,
      kindIndex,
      optionIndex: parsedOption,
      kind: kindOffer.kind,
      option,
    };
    setOffers(run.id, JSON.stringify(offers));
    return {
      wave,
      applied: { kind: kindOffer.kind, option, kindIndex, optionIndex: parsedOption },
      delta: {
        gold: delta.gold,
        baseHp: delta.baseHp,
        maxBaseHp: delta.maxBaseHp,
        rerolls: delta.rerolls,
        doctrines: delta.doctrines,
        awakenings: delta.awakenings,
      },
      relics: delta.relics,
      picked: true,
    };
  }

  // 回放摘要只保留决策与结果：种子、地图、遗物、事件节点与波次/结算数据。
  // 不包含任何模拟帧或逐帧状态。
  replaySummary(run, payload) {
    const chosen = chosenMapFor(run);
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
      // 主海克斯记入回放摘要：旧 run 为 null，读档端按无海克斯处理。
      hex: hexFor(run),
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
    return settleRunOutcome({
      run,
      profile,
      body,
      replaySummary: (target, payload) => this.replaySummary(target, payload),
    });
  }

  abandon(run) {
    markAbandoned(run.id, Date.now());
    return { ok: true };
  }
}
