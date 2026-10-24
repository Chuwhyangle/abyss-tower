// 主海克斯：黄金律法。钱必须立刻花掉——给得多，但囤积会被持续征税。
// 数值：开局 +250 金；击杀金币 ×1.45；每波结束（含最后一波）烧掉当前金币 15%（至少 10，余额不足扣到 0）；
// 卖塔返还 35%（基础 70% × 0.5）；遗物刷新费 ×0.50（最低 1 金）。
// 波末征税由 Simulation.completeWave 在波次奖励与周期遗物结算之后调用 onWaveEnd，
// 因此计税基数是「本波奖励入账后」的金币；最后一波也在 gameOver 之前结算。
import { BALANCE } from '../config.js';

const START_GOLD_BONUS = 250;
// 击杀金币倍率：模拟层已按现有遗物/地图 goldMul 入账，这里只补差额 45%，不另乘一次倍率。
const KILL_GOLD_BONUS = 0.45;
const BURN_PCT = 15;
const BURN_MIN = 10;
const SELL_RATIO_MUL = 0.5;
const REROLL_COST_MUL = 0.5;
const REROLL_COST_MIN = 1;

function toGold(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// 与 Simulation.killEnemy 的击杀金币算式保持一致（钩子在入账之后触发，拿不到入账金额）。
// 先复算实际入账（含遗物 goldMul / 波次成长 / 地图 goldMul），再取其中的 45% 作为差额补上，
// 这样总倍率恒为 ×1.45，且不会把现有 gold mod 重复乘一遍。
function killGoldAwarded(enemy, sim) {
  const multiplier =
    (1 + (sim.mods?.goldMul || 0)) *
    (1 + (sim.wave || 0) * BALANCE.killGoldWaveRate) *
    (sim.modifier?.goldMul || 1);
  return Math.round(toGold(enemy?.gold) * multiplier) + (sim.mods?.killGold || 0);
}

const hooks = Object.freeze({
  // 开局：直接加金（读档时 Simulation 不重放 onRunInit，不会重复发放）。
  onRunInit(ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    sim.gold = toGold(sim.gold) + START_GOLD_BONUS;
  },
  // 击杀：补发 45% 差额金币，使总击杀金币为 ×1.45。
  onEnemyKilled(enemy, ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    const extra = Math.round(killGoldAwarded(enemy, sim) * KILL_GOLD_BONUS);
    if (extra > 0) sim.gold += extra;
  },
  // 波末：按当前金币征税 15%，至少 10 金；余额不足时扣到 0，0 金不再扣。
  onWaveEnd(wave, ctx) {
    const sim = ctx?.sim;
    if (!sim) return;
    const gold = toGold(sim.gold);
    if (gold <= 0) return;
    // 用整数百分比换成 round(gold * 15 / 100)，避免 0.15 的二进制误差影响进位。
    const burn = Math.min(gold, Math.max(BURN_MIN, Math.round((gold * BURN_PCT) / 100)));
    sim.gold = gold - burn;
  },
  // 卖塔返还 35% = 基础 70% × 0.5。
  sellRatio(base) {
    return toGold(base) * SELL_RATIO_MUL;
  },
  // 遗物刷新半价，最低 1 金。
  relicRerollCost(base) {
    return Math.max(REROLL_COST_MIN, Math.round(toGold(base) * REROLL_COST_MUL));
  },
});

export default Object.freeze({
  id: 'golden_law',
  name: '黄金律法',
  glyph: '⚖',
  color: '#facc15',
  tags: Object.freeze(['经济', '运营']),
  pitch: '开局 +250 金、击杀金币 +45%',
  desc: '开局 +250 金、击杀金币 +45%，但每波结束烧掉 15% 金币，卖塔只返 35%。',
  downside: '每波结束烧掉 15% 金币，卖塔只返 35%',
  scoreMul: 1.10,
  hooks,
  implemented: true,
});
