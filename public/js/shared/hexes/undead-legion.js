// 主海克斯：亡者军团。击杀敌人有 20% 概率转化为友方骷髅：继承该敌人 35% 最大生命，
// 存活 12 秒、最多 12 个；骷髅每秒攻击 1 次，对 1.2 格内最近敌人造成目标最大生命 4% 的
// 伤害（首领 1%）。代价是击杀金币 ×0.45。
// 骷髅走 HEX-002 的盟友框架（ctx.spawnAlly）：不阻挡敌人、不被攻击、不吸引仇恨。
// 随机数只用 ctx.rng（sim 以 `<seed>:hex:undead_legion` 派生的独立随机流），
// 同种子 + 同击杀序列的生成结果完全一致，也不扰动战斗 RNG 的固定顺序。
import { BALANCE } from '../config.js';

const SPAWN_CHANCE = 0.2;
const MAX_SKULLS = 12;
const SKULL_TTL = 12;
const SKULL_MAX_HP_RATIO = 0.35;
const SKULL_RANGE = 1.2;
const SKULL_RATE = 1;
const SKULL_DMG_PCT = 0.04;
const SKULL_BOSS_DMG_PCT = 0.01;
const SKULL_COLOR = '#22d3ee';
const KILL_GOLD_RATIO = 0.45;

function aliveAllies(sim) {
  const allies = Array.isArray(sim?.allies) ? sim.allies : [];
  return allies.filter((ally) => ally && !ally.dead).length;
}

// 与 Simulation.killEnemy 的入账算式保持一致（钩子在金币入账之后触发，拿不到入账金额）。
// 先复算实际入账（含遗物 goldMul / 波次成长 / 地图 goldMul），再把超出 45% 的部分收回，
// 这样总倍率恒为 ×0.45，且不会把现有 gold mod 重复乘一遍。
function killGoldAwarded(enemy, sim) {
  const multiplier =
    (1 + (sim.mods?.goldMul || 0)) *
    (1 + (sim.wave || 0) * BALANCE.killGoldWaveRate) *
    (sim.modifier?.goldMul || 1);
  const gold = Number(enemy?.gold);
  const base = Number.isFinite(gold) && gold > 0 ? gold : 0;
  return Math.round(base * multiplier) + (sim.mods?.killGold || 0);
}

const hooks = Object.freeze({
  // 击杀结算：收回击杀金币并（在未达上限时）按 20% 概率召唤骷髅。
  onEnemyKilled(enemy, ctx) {
    const sim = ctx?.sim;
    if (!sim || !enemy) return;

    // 击杀金币 ×0.45：首领击杀同样生效。
    const awarded = killGoldAwarded(enemy, sim);
    const keep = Math.round(awarded * KILL_GOLD_RATIO);
    const clawback = awarded - keep;
    if (clawback > 0) sim.gold = Math.max(0, sim.gold - clawback);

    // 达到上限后不再生成；不消耗随机数，序列仍由击杀顺序唯一确定。
    if (aliveAllies(sim) >= MAX_SKULLS) return;
    if (!(ctx.rng.float() < SPAWN_CHANCE)) return;

    const maxHp = Math.max(1, (Number(enemy.maxHp) || 0) * SKULL_MAX_HP_RATIO);
    ctx.spawnAlly({
      kind: 'skeleton',
      x: enemy.x,
      y: enemy.y,
      r: 0.22,
      color: SKULL_COLOR,
      ttl: SKULL_TTL,
      range: SKULL_RANGE,
      rate: SKULL_RATE,
      dmg: 0,
      pct: SKULL_DMG_PCT,
      pctBoss: SKULL_BOSS_DMG_PCT,
      maxHp,
    });
  },
});

export default Object.freeze({
  id: 'undead_legion',
  name: '亡者军团',
  glyph: '💀',
  color: '#22d3ee',
  tags: Object.freeze(['召唤', '滚雪球']),
  pitch: '击杀有 20% 概率召唤骷髅',
  desc: '击杀有 20% 概率召唤骷髅，但击杀金币 -55%。',
  downside: '击杀金币 -55%',
  scoreMul: 1.15,
  hooks,
  implemented: true,
});
