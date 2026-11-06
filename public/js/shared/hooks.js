// 战斗行为 hook 总线（阶段 5）：把「行为类内容」从共享 sim 核心剥离到各来源模块。
// 海克斯 / 遗物（未来天赋）各自注册 provider，总线严格按注册顺序调度。
//
// 确定性红线（上一版翻车点）：
//   1. 调度顺序只来自 providers 数组的插入顺序与 HOOK_NAMES 固定名单，绝不遍历对象键；
//   2. 总线自身不创建/不预取随机数；需要随机的 provider 用 rngFor(name) 拿独立随机流，
//      流种子与 combatRng / 海克斯流完全隔离，抽取顺序不影响战斗结算；
//   3. emit/fold 对名单外的 hook 直接跳过，缺失的 provider 方法也跳过，调用方无需判空。
import { RNG } from './rng.js';

// hook 名单：固定数组顺序即调度顺序（确定性红线：绝不 Object.keys 序）。
// 副作用型（emit）：返回值忽略；值型（fold）：按注册顺序变换，非法返回回退上一手值。
export const HOOK_NAMES = Object.freeze([
  'onHit',           // dealDamage 尾部：塔/盟友/技能命中（海克斯里程碑命中）
  'onProjectileHit', // hitEnemy 尾部：投射物命中结算（遗物命中词条统一消费点）
  'onEnemyKilled',   // killEnemy 头部：里程碑击杀钩子（海克斯）
  'onKillSettle',    // killEnemy 尾部：击杀派生结算（遗物击杀词条统一消费点）
  'onLeak',          // leak 尾部：漏怪结算（海克斯）
  'onRelicGained',   // addRelic 尾部：获得/升级遗物（海克斯）
]);

const HOOK_SET = new Set(HOOK_NAMES);

export class HookBus {
  /**
   * @param {object} [opts]
   * @param {string} [opts.seed] 本局种子，用于派生 provider 的独立随机流
   * @param {(key: string) => object} [opts.rngFactory] 注入随机流工厂（测试用；默认 RNG）
   */
  constructor({ seed = '', rngFactory = null } = {}) {
    // 有序注册表：同序即同次调度；顺序变化会改变行为，确定性依赖它。
    this.providers = [];
    this.seed = String(seed ?? '');
    this._rngFactory = rngFactory;
    this._streams = new Map();
  }

  // 注册一个 provider（形如 { name, onHit, onKillSettle, ... }）。
  // name 必填且唯一：随机流按名字派生，重复注册返回 false 而不是静默覆盖。
  register(provider) {
    if (!provider || typeof provider !== 'object') return false;
    if (typeof provider.name !== 'string' || provider.name === '') return false;
    if (this.providers.some((item) => item.name === provider.name)) return false;
    this.providers.push(provider);
    return true;
  }

  // 是否有任一 provider 处理该 hook（调用点判空用，通常可省）。
  has(name) {
    if (!HOOK_SET.has(name)) return false;
    return this.providers.some((provider) => typeof provider[name] === 'function');
  }

  // 副作用型 hook：按注册顺序全部调用，返回值忽略；缺失的 hook / 名单外 hook 自动跳过。
  emit(name, ...args) {
    if (!HOOK_SET.has(name)) return;
    for (const provider of this.providers) {
      const handler = provider[name];
      // 以 provider 为 this 调用：类式 provider 的方法能读自己的状态，普通对象同样成立。
      if (typeof handler === 'function') handler.call(provider, ...args);
    }
  }

  // 值型 hook：按注册顺序依次变换 value；返回 undefined/null（非法值）时保留当前值。
  // 名单外的 hook 视为无人处理，原样返回 value（回退默认）。
  fold(name, value, ...args) {
    if (!HOOK_SET.has(name)) return value;
    let current = value;
    for (const provider of this.providers) {
      const handler = provider[name];
      if (typeof handler !== 'function') continue;
      const next = handler.call(provider, current, ...args);
      if (next !== undefined && next !== null) current = next;
    }
    return current;
  }

  // provider 专属独立随机流：懒创建、按名缓存，种子 `${seed}:hook:${name}`。
  // 与 combatRng（战斗暴击/掉落）和 `${seed}:hex:${id}` 流互不干扰。
  rngFor(name) {
    const key = String(name ?? '');
    let stream = this._streams.get(key);
    if (!stream) {
      const seedKey = `${this.seed}:hook:${key}`;
      stream = this._rngFactory ? this._rngFactory(seedKey) : new RNG(seedKey);
      this._streams.set(key, stream);
    }
    return stream;
  }
}
