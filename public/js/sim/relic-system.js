// 遗物与奖励：等级读写、遗物获得、金币/修复 offer 与 mod 聚合。
import { RELIC_BY_ID, RELIC_MAX_LEVEL, relicModsAtLevel } from '../shared/data.js';
import { applyEffect, clampMods, createMods, relicSetTierBonuses } from '../shared/effects.js';
import { applyContract as applyContractEffect } from '../shared/contracts.js';

export class RelicSystem {
  constructor(sim) {
    this.sim = sim;
  }

  getRelicLevel(id) {
    const state = this.sim.relics.find((item) => item.id === id);
    return state ? state.level : 0;
  }

  // 接受遗物 ID、{id, level} 或服务端 offer（{kind:'relic', id, toLevel}）。
  addRelic(relicOrOffer) {
    let id = null;
    let requestedLevel = null;
    if (typeof relicOrOffer === 'string') {
      id = relicOrOffer;
    } else if (relicOrOffer && relicOrOffer.kind === 'relic') {
      id = relicOrOffer.id;
      requestedLevel = relicOrOffer.toLevel;
    } else if (relicOrOffer) {
      id = relicOrOffer.id;
      requestedLevel = relicOrOffer.level ?? relicOrOffer.toLevel;
    }
    if (!RELIC_BY_ID[id]) return { applied: false, reason: 'unknown' };

    const existing = this.sim.relics.find((item) => item.id === id);
    const fromLevel = existing?.level || 0;
    if (fromLevel >= RELIC_MAX_LEVEL) return { applied: false, reason: 'max' };
    const toLevel = Math.min(
      RELIC_MAX_LEVEL,
      Math.max(fromLevel + 1, Math.floor(Number(requestedLevel) || fromLevel + 1))
    );

    // 即时生命效果只补发本次升级新增的部分。
    const oldBonus = fromLevel ? relicModsAtLevel(id, fromLevel).baseHp || 0 : 0;
    const newBonus = relicModsAtLevel(id, toLevel).baseHp || 0;
    const delta = Math.max(0, newBonus - oldBonus);
    if (delta) {
      this.sim.maxBaseHp += delta;
      this.sim.baseHp = Math.min(this.sim.maxBaseHp, this.sim.baseHp + delta);
      this.sim.addEffect({ kind: 'heal', x: this.sim.map.base.x, y: this.sim.map.base.y, ttl: 0.8 });
    }

    if (existing) existing.level = toLevel;
    else this.sim.relics.push({ id, level: toLevel });

    // 获得/升级遗物都走同一钩子；它先跑，随后统一重算，钩子对状态的改动才能落到塔属性上。
    if (this.sim.hexRuntime.active) {
      this.sim.hexCall('onRelicGained', { id, level: toLevel }, this.sim.hexCtx);
    }
    this.sim.recomputeMods();
    this.sim.save();
    return { applied: true, id, fromLevel, toLevel, baseHpDelta: delta };
  }

  applyOffer(offer) {
    if (!offer) return { applied: false };
    if (offer.kind === 'relic') return this.sim.addRelic(offer);
    if (offer.kind === 'gold') {
      const amount = Math.max(0, Math.floor(Number(offer.amount) || 0));
      this.sim.gold += amount;
      this.sim.addFloater(this.sim.map.base.x, this.sim.map.base.y - 0.6, `+${amount}`, '#ffd36b', true);
      this.sim.save();
      return { applied: true, kind: 'gold', amount };
    }
    if (offer.kind === 'repair') {
      const amount = Math.max(0, Math.floor(Number(offer.amount) || 0));
      const before = this.sim.baseHp;
      this.sim.baseHp = Math.min(this.sim.maxBaseHp, this.sim.baseHp + amount);
      this.sim.addEffect({ kind: 'heal', x: this.sim.map.base.x, y: this.sim.map.base.y, ttl: 0.8 });
      this.sim.save();
      return { applied: true, kind: 'repair', amount: this.sim.baseHp - before };
    }
    return { applied: false };
  }

  // 契约卡即时结算（§5.2/§5.3）：代价先于收益；只改客户端可模拟资源，绝不触碰敌人/波次。
  // offer 为服务端已解析的契约卡（含 id/faction/grantRelicId/burnRelicId）；opts.rerolls 是
  // 当前剩余刷新次数（sim 不持有该字段，由外层按 maxRerolls - rerollsUsed 传入），供债契代价门禁。
  applyContract(offer, { rerolls = 0 } = {}) {
    const sim = this.sim;
    const result = applyContractEffect(
      {
        accepted: sim.rogue2.contracts.length,
        wave: sim.clearedWave,
        gold: sim.gold,
        hp: sim.baseHp,
        maxHp: sim.maxBaseHp,
        rerolls,
        relics: sim.relics,
        nextOfferCount: null,
        bonusPoints: sim.rogue2.bonusPoints,
        contracts: sim.rogue2.contracts,
      },
      offer
    );
    if (!result.ok) return result;
    const state = result.state;
    sim.gold = state.gold;
    sim.maxBaseHp = state.maxHp;
    sim.baseHp = state.hp;
    sim.relics = state.relics;
    sim.rogue2 = { contracts: state.contracts, bonusPoints: state.bonusPoints };
    sim.factions.bonusPoints = state.bonusPoints;
    if (state.nextOfferCount != null) sim.pendingNextOfferCount = state.nextOfferCount;
    // bonusPoints 变更触发派系重算（§8.2 不变式 2）；recomputeMods 顺带刷新惰契攻速副作用。
    sim.recomputeFactions();
    sim.recomputeMods();
    sim.save();
    return result;
  }

  // 聚合与封顶完全由效果注册表驱动：未注册的键会在 relicModsAtLevel/applyEffect 中报错。
  recomputeMods() {
    const mods = createMods();
    for (const relic of this.sim.relics) {
      const levelMods = relicModsAtLevel(relic.id, relic.level);
      for (const [key, value] of Object.entries(levelMods)) {
        applyEffect(mods, key, value);
      }
    }
    // 套装按不同遗物计件：等级提升不重复计入，2/4 件档位依次叠加。
    const setPieces = new Map();
    const counted = new Set();
    for (const relic of this.sim.relics) {
      const def = RELIC_BY_ID[relic.id];
      if (!def?.set || counted.has(relic.id)) continue;
      counted.add(relic.id);
      setPieces.set(def.set, (setPieces.get(def.set) || 0) + 1);
    }
    for (const [setId, pieces] of setPieces) {
      for (const tier of relicSetTierBonuses(setId, pieces)) {
        for (const [key, value] of Object.entries(tier.mods)) {
          applyEffect(mods, key, value);
        }
      }
    }
    // 海克斯波内临时 mod 与遗物同源聚合，仍受注册表的单件/全局封顶约束。
    this.sim.hexRuntime.applyTempMods(mods);
    clampMods(mods);

    // 契约「惰契」（§5.2）：下一波全体塔攻速 −12%（本波 chip，untilWave = 接受波 +1）。
    // 只改客户端可模拟资源，不触碰敌人 HP/速度/入口；到波后重算即失效。
    const slothActive = (this.sim.rogue2?.contracts || []).some(
      (contract) => contract.id === 'sloth' && contract.untilWave === this.sim.clearedWave + 1
    );
    if (slothActive) mods.fireRate = (mods.fireRate || 0) - 0.12;

    this.sim.mods = mods;
    // 派系层独立重算：setMods 不走 clampMods，0 点时为空对象。
    this.sim.recomputeFactions();
    // 遗物变化时统一刷新塔的稳定属性，模拟步内不再重算。
    this.sim.recomputeTowerStats();
  }
}
