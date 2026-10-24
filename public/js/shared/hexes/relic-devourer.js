// 主海克斯：遗物吞噬者。用基地生命上限换更多、更便宜的遗物选择，越贪越危险。
// 只用 HEX-002 暴露的接口：
//   onRunInit        基地生命上限 +5、当前生命同增；开局自带的遗物逐件扣 1
//   onRelicGained    每获得一件遗物（含升级与开局遗物）：上限 -1（最低 1），当前生命 clamp
//   relicOfferCount  遗物候选 4 选 1
//   relicRerollCost  刷新免费
//   relicRerollBonus 刷新次数 +2（服务端 relicOffers/serialize 读同一钩子）
const MAX_HP_BONUS = 5;
const HP_PER_RELIC = 1;
const MIN_MAX_HP = 1;
const OFFER_COUNT = 4;
const REROLL_BONUS = 2;

// 基地生命上限只在这里下探：不低于 1，当前生命永远不超过新上限（已归零的生命不会被抬回 1）。
function devourMaxHp(sim) {
  if (!sim) return;
  const maxHp = Number(sim.maxBaseHp);
  const base = Number.isFinite(maxHp) ? Math.floor(maxHp) : MIN_MAX_HP;
  sim.maxBaseHp = Math.max(MIN_MAX_HP, base - HP_PER_RELIC);
  const hp = Number(sim.baseHp);
  if (Number.isFinite(hp)) sim.baseHp = Math.min(hp, sim.maxBaseHp);
}

const hooks = Object.freeze({
  // 开局：上限与当前生命同时 +5。开局遗物（start_relic 解锁）在构造时已就位，
  // 它们同样要付「每件 -1」的代价；随后模拟层再叠加遗物自身的 baseHp 加成。
  // 读档不重放（restored 时不调 onRunInit），上限与生命从快照恢复。
  onRunInit(ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    const startingRelics = Array.isArray(sim.relics) ? sim.relics.length : 0;
    const maxHp = Number(sim.maxBaseHp);
    const base = Number.isFinite(maxHp) ? Math.floor(maxHp) : MIN_MAX_HP;
    sim.maxBaseHp = Math.max(
      MIN_MAX_HP,
      base + MAX_HP_BONUS - startingRelics * HP_PER_RELIC
    );
    const hp = Number(sim.baseHp);
    if (Number.isFinite(hp)) {
      sim.baseHp = Math.min(hp + MAX_HP_BONUS, sim.maxBaseHp);
    }
    if (ctx?.state) ctx.state.devoured = startingRelics;
  },
  // 获得遗物：升级同一件遗物也是一次「拿」，同样 -1。上限已到 1 时不再扣。
  onRelicGained(relic, ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    devourMaxHp(sim);
    if (ctx?.state) {
      const devoured = Number(ctx.state.devoured);
      ctx.state.devoured = (Number.isFinite(devoured) ? devoured : 0) + 1;
    }
  },
  // 遗物候选：四选一（基础三选一）。
  relicOfferCount(base) {
    return Math.max(OFFER_COUNT, Math.floor(Number(base)) || 0);
  },
  // 遗物刷新：免费。
  relicRerollCost() {
    return 0;
  },
  // 遗物刷新次数：基础次数 +2。
  relicRerollBonus(base) {
    const value = Math.floor(Number(base));
    return (Number.isFinite(value) ? Math.max(0, value) : 0) + REROLL_BONUS;
  },
});

export default Object.freeze({
  id: 'relic_devourer',
  name: '遗物吞噬者',
  glyph: '🕳',
  color: '#a855f7',
  tags: Object.freeze(['遗物', '贪婪']),
  pitch: '遗物四选一、刷新免费 +2 次',
  desc: '遗物四选一、刷新免费 +2 次，但每拿一件遗物基地生命上限 -1。',
  downside: '每拿一件遗物基地生命上限 -1',
  scoreMul: 1.10,
  hooks,
  implemented: true,
});
