// 主海克斯运行时：把注册表里的钩子包装成「缺失即跳过、返回值不合法即回退默认」的安全调用，
// 并承载每局可序列化的 hexState、波内临时 mod 与遗物类查询。
// 具体数值由各海克斯模块注入；没有海克斯时所有调用退化为原有行为。
// ctx（钩子上下文）由 Simulation 提供，只暴露受控入口：state / addTempMod / spawnAlly / rng。
import { HEX_BY_ID } from './index.js';
import { applyEffect, getEffect } from '../effects.js';

// 接受注册表 id 或完整定义；未知 id 按「无海克斯」处理，旧档与新档都不会因此崩溃。
function resolveHexDefinition(hex) {
  if (typeof hex === 'string') return HEX_BY_ID[hex] || null;
  if (isPlainRecord(hex) && typeof hex.id === 'string' && isPlainRecord(hex.hooks)) return hex;
  return null;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 非有限数字一律回退，避免海克斯返回 NaN 污染模拟状态。
function toFinite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class HexRuntime {
  /**
   * @param {string|object|null} definition 海克斯 id 或定义对象
   * @param {object|null} state 可序列化的每局状态（快照 hexState）
   */
  constructor(definition = null, state = null) {
    this.definition = resolveHexDefinition(definition);
    this.id = this.definition?.id || null;
    this.hooks = this.definition?.hooks || {};
    // 状态必须是纯对象；旧档/非法输入按空状态恢复，钩子写入后仍是可序列化的值。
    this.state = isPlainRecord(state) ? { ...state } : {};
    // 波内临时 mod：由海克斯在波次钩子里写入，波末由模拟层统一清理。
    this.tempMods = {};
  }

  get active() {
    return this.definition !== null;
  }

  has(name) {
    return typeof this.hooks[name] === 'function';
  }

  // 统一调用出口：缺失的钩子返回 undefined，调用方无需判空。
  call(name, ...args) {
    if (!this.has(name)) return undefined;
    return this.hooks[name](...args);
  }

  // ---------- 各钩子的默认值语义 ----------

  onRunInit(ctx) {
    this.call('onRunInit', ctx);
  }

  modifyTowerStats(tower, stats, ctx) {
    const next = this.call('modifyTowerStats', tower, stats, ctx);
    return isPlainRecord(next) ? next : stats;
  }

  towerMaxLevel(tower, base) {
    const next = Math.floor(toFinite(this.call('towerMaxLevel', tower, base), base));
    return next >= 1 ? next : base;
  }

  // 建造费用：钩子拿到数据表原价（尚未乘遗物 costMul），返回非法值即回退原价。
  buildCost(type, base) {
    return toFinite(this.call('buildCost', type, base), base);
  }

  // 返回 null 表示「不能继续升级」（例如扩展等级到顶）。
  upgradeCost(tower, base) {
    const next = this.call('upgradeCost', tower, base);
    if (next === null) return null;
    if (next === undefined) return base;
    return toFinite(next, base);
  }

  allowedEvolutions(tower, base) {
    const next = this.call('allowedEvolutions', tower, base);
    return Array.isArray(next) ? next : base;
  }

  // 默认允许建造；钩子显式返回 false 才拦截。
  canBuild(type, c, r, ctx) {
    const next = this.call('canBuild', type, c, r, ctx);
    return next === undefined ? true : Boolean(next);
  }

  sellRatio(base) {
    const next = toFinite(this.call('sellRatio', base), base);
    return next >= 0 && next <= 1 ? next : base;
  }

  relicOfferCount(base) {
    const next = Math.floor(toFinite(this.call('relicOfferCount', base), base));
    return next >= 0 ? next : base;
  }

  relicRerollCost(base, count) {
    const next = toFinite(this.call('relicRerollCost', base, count), base);
    return next >= 0 ? next : base;
  }

  // 刷新次数上限：基础次数（解锁/模式/变异算完后）交给海克斯加码，服务端 relicOffers/serialize 共用。
  relicRerollBonus(base) {
    const next = Math.floor(toFinite(this.call('relicRerollBonus', base), base));
    return next >= 0 ? next : base;
  }

  // ---------- 波内临时 mod ----------

  // 键必须已在 EFFECT_REGISTRY 声明（与遗物同一约束），未注册键立即报错而不是静默丢弃。
  addTempMod(key, value) {
    const amount = toFinite(value, 0);
    if (amount === 0) return false;
    getEffect(key);
    this.tempMods[key] = (this.tempMods[key] || 0) + amount;
    return true;
  }

  // 临时 mod 与遗物同源聚合，仍受注册表的单件/全局封顶约束。
  applyTempMods(mods) {
    for (const [key, value] of Object.entries(this.tempMods)) applyEffect(mods, key, value);
    return mods;
  }

  get hasTempMods() {
    return Object.keys(this.tempMods).length > 0;
  }

  clearTempMods() {
    this.tempMods = {};
  }
}
