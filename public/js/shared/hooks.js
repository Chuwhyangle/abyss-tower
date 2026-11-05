// 战斗行为 hook 总线：把「行为类内容」从共享 sim 核心剥离到各来源模块。
// 海克斯 / 遗物 /（未来）天赋各自注册 provider，总线按注册顺序调度；
// 缺失的 hook 安全跳过；值型 hook 返回非法值（undefined/null）回退到上一手值。
// 复用 HexRuntime「缺失跳过 / 非法回退」的思路，但面向所有行为来源而非单一海克斯。

// hook 名单：固定数组顺序即调度顺序（确定性红线：绝不 Object.keys 序）。
export const HOOK_NAMES = Object.freeze([
  'onHit',           // dealDamage 尾部：塔/盟友/技能命中（海克斯里程碑命中）
  'onProjectileHit', // hitEnemy 尾部：投射物命中结算（遗物命中词条统一消费点）
  'onEnemyKilled',   // killEnemy 头部：里程碑击杀钩子（海克斯）
  'onKillSettle',    // killEnemy 尾部：击杀派生结算（遗物击杀词条统一消费点）
  'onLeak',          // leak 尾部：漏怪结算（海克斯）
  'onRelicGained',   // addRelic 尾部：获得/升级遗物（海克斯）
]);

export class HookBus {
  constructor() {
    // 有序注册表：同序即同次调度；顺序变化会改变行为，确定性依赖它。
    this.providers = [];
  }

  // 注册一个 provider（形如 { name, onHit, onKillSettle, ... }，值型钩子可用 fold 链）。
  register(provider) {
    if (!provider || typeof provider !== 'object') return false;
    this.providers.push(provider);
    return true;
  }

  // 是否有任一 provider 处理该 hook（调用点判空用，通常可省）。
  has(name) {
    return this.providers.some((provider) => typeof provider[name] === 'function');
  }

  // 副作用型 hook：按注册顺序全部调用，返回值忽略；缺失的 hook 自动跳过。
  emit(name, ...args) {
    for (const provider of this.providers) {
      const handler = provider[name];
      if (typeof handler === 'function') handler(...args);
    }
  }

  // 值型 hook：按注册顺序依次变换 value；返回 undefined/null（非法值）时保留当前值。
  fold(name, value, ...args) {
    let current = value;
    for (const provider of this.providers) {
      const handler = provider[name];
      if (typeof handler !== 'function') continue;
      const next = handler(current, ...args);
      if (next !== undefined && next !== null) current = next;
    }
    return current;
  }
}
