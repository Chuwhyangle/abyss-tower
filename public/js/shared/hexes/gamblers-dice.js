// 主海克斯：赌徒之骰。每波开始抽 1 个运势 + 1 个代价，整波生效、波末清理；
// 遗物稀有度权重取消（完全随机），刷新次数 +1。
// 只用 HEX-002 暴露的接口：
//   onWaveStart/onWaveEnd  抽签与清理；状态写入可序列化的 ctx.state（随快照恢复）
//   modifyTowerStats       运势里的伤害/攻速/射程倍率（乘在最终属性上，不受遗物封顶影响）
//   buildCost/upgradeCost  运势的造价折扣与代价的「本波不可升级」
//   onLeak                 代价的漏怪额外伤害
// 击杀金币的增减走 ctx.addTempMod('goldMul', ...)，与遗物同源聚合后被模拟层统一读取。
import { RNG } from '../rng.js';

// 运势池（纯增益）与代价池（纯减益）各自独立：每波各抽一项，不会从同一池抽到两个。
export const GAMBLER_FORTUNES = Object.freeze([
  Object.freeze({ id: 'dmg', stat: 'dmg', label: '全塔伤害 +25%', mul: 1.25 }),
  Object.freeze({ id: 'rate', stat: 'rate', label: '攻速 +25%', mul: 1.25 }),
  Object.freeze({ id: 'range', stat: 'range', label: '射程 +20%', mul: 1.2 }),
  Object.freeze({ id: 'killGold', label: '击杀金币 +50%', goldMul: 0.5 }),
  Object.freeze({ id: 'buildCost', label: '塔造价 -30%', costMul: 0.7 }),
  Object.freeze({ id: 'skillCd', label: '技能冷却 -50%', cdMul: 0.5 }),
]);

export const GAMBLER_COSTS = Object.freeze([
  Object.freeze({ id: 'enemyHp', label: '敌人生命 +15%', hpMul: 1.15 }),
  Object.freeze({ id: 'enemySpeed', label: '敌人移速 +10%', speedMul: 1.1 }),
  Object.freeze({ id: 'killGoldDown', label: '本波击杀金币 -30%', goldMul: -0.3 }),
  Object.freeze({ id: 'skillLock', label: '本波技能不可用' }),
  Object.freeze({ id: 'upgradeLock', label: '本波塔不可升级' }),
  Object.freeze({ id: 'leakDamage', label: '本波漏怪伤害 +1', leakBonus: 1 }),
]);

const FORTUNE_BY_ID = new Map(GAMBLER_FORTUNES.map((item) => [item.id, item]));
const COST_BY_ID = new Map(GAMBLER_COSTS.map((item) => [item.id, item]));

// 抽签种子只含 seed + 波次：刷新/重开同一波必然抽到同一组，且不影响战斗 RNG 的调用顺序。
const ROLL_SALT = 'gamblers-dice-v1';
// 「本波技能不可用」用一个远超任何一波的哨兵冷却挡住 castSkill，波末原样还原；
// 取有限值是为了让 HUD 的冷却读数仍在正常范围（不是天文数字）。
const SKILL_LOCKED_COOLDOWN = 600;

export function rollGamblerWave(seed, wave) {
  const rng = new RNG(`${ROLL_SALT}:${seed ?? ''}:${wave}`);
  return {
    wave,
    fortune: GAMBLER_FORTUNES[rng.int(GAMBLER_FORTUNES.length)].id,
    cost: GAMBLER_COSTS[rng.int(GAMBLER_COSTS.length)].id,
  };
}

function fortuneOf(ctx) {
  const id = ctx?.state?.gambler?.fortune;
  return FORTUNE_BY_ID.get(id) || null;
}

function costOf(ctx) {
  const id = ctx?.state?.gambler?.cost;
  return COST_BY_ID.get(id) || null;
}

// 运势「塔造价 -30%」：钩子拿到的是数据表原价，模拟层随后统一套遗物 costMul 与下限。
function applyBuildDiscount(ctx, base) {
  const fortune = fortuneOf(ctx);
  if (fortune?.costMul == null) return base;
  const value = Number(base);
  return Number.isFinite(value) ? value * fortune.costMul : base;
}

// 代价「敌人生命 +15%」：本波生成队列里已带 per-group 血量倍率，
// 首领召唤/分裂等走 waveDef.hpMul 兜底的路径也同步抬高，两条生成路径都吃到加成。
function boostEnemyHp(sim, mul) {
  const waveDef = sim?.waveDef;
  if (!waveDef) return;
  for (const item of sim.spawnQueue || []) {
    if (Number.isFinite(item?.hpMul)) item.hpMul *= mul;
  }
  waveDef.hpMul = (Number(waveDef.hpMul) || 1) * mul;
}

function boostEnemySpeed(sim, mul) {
  const waveDef = sim?.waveDef;
  if (!waveDef) return;
  waveDef.speedMul = (Number(waveDef.speedMul) || 1) * mul;
}

// 代价「本波技能不可用」：记下原冷却再抬高，isSkillReady/castSkill 自然挡下（UI 按钮置灰）。
function lockSkill(sim, state) {
  if (!sim?.skill) return;
  state.skillLock = Number(sim.skill.cooldown) || 0;
  sim.skill.cooldown = Math.max(state.skillLock, SKILL_LOCKED_COOLDOWN);
}

// 运势「技能冷却 -50%」：skill.stats 是共享数据表行，不能原地改；本波换成一份副本，
// 波末按记下的原值覆盖回去，全局技能表不受影响。
function halveSkillCooldown(sim, state) {
  const stats = sim?.skill?.stats;
  if (!stats || !Number.isFinite(stats.cd)) return;
  state.skillCd = stats.cd;
  sim.skill.stats = { ...stats, cd: stats.cd * 0.5 };
}

function restoreSkill(ctx, state) {
  const sim = ctx?.sim;
  if (!sim?.skill || !state) return;
  // 冷却只在「本波不可用」时被抬高过；减半换掉的 stats 副本也在这里还原成原值。
  if (state.skillLock != null) sim.skill.cooldown = state.skillLock;
  if (state.skillCd != null && sim.skill.stats) {
    sim.skill.stats = { ...sim.skill.stats, cd: state.skillCd };
  }
}

const hooks = Object.freeze({
  // 波次开始：确定性抽签 → 写可序列化状态 → 立即生效 → 通知 UI。
  onWaveStart(wave, ctx) {
    if (!ctx?.state) return;
    // 防御重复开局：上一次的残留先还原，避免技能状态被两次锁定/减半叠加。
    if (ctx.state.gambler) restoreSkill(ctx, ctx.state.gambler);
    const roll = rollGamblerWave(ctx.seed, wave);
    const state = { wave: roll.wave, fortune: roll.fortune, cost: roll.cost, skillCd: null, skillLock: null };
    ctx.state.gambler = state;

    const fortune = FORTUNE_BY_ID.get(roll.fortune);
    const cost = COST_BY_ID.get(roll.cost);
    const sim = ctx.sim;
    if (fortune?.goldMul != null) ctx.addTempMod?.('goldMul', fortune.goldMul);
    if (cost?.goldMul != null) ctx.addTempMod?.('goldMul', cost.goldMul);
    if (cost?.hpMul != null) boostEnemyHp(sim, cost.hpMul);
    if (cost?.speedMul != null) boostEnemySpeed(sim, cost.speedMul);
    if (fortune?.cdMul != null) halveSkillCooldown(sim, state);
    if (cost?.id === 'skillLock') lockSkill(sim, state);
    // 运势可能在开局时就改塔属性（没有临时 mod 的路径不会自动重算），这里统一刷新一次。
    sim?.recomputeTowerStats?.();
    ctx.toast?.(`🎲 运势：${fortune?.label ?? roll.fortune}；代价：${cost?.label ?? roll.cost}`);
  },
  // 波次结束：还原技能状态、清掉本波抽签并刷新塔属性（临时 mod 由模拟层统一清理）。
  onWaveEnd(wave, ctx) {
    if (!ctx?.state?.gambler) return;
    restoreSkill(ctx, ctx.state.gambler);
    delete ctx.state.gambler;
    ctx.sim?.recomputeTowerStats?.();
  },
  // 塔属性重算末尾：按本波运势乘伤害/攻速/射程；入参形状不全时原样返回。
  modifyTowerStats(tower, stats, ctx) {
    const fortune = fortuneOf(ctx);
    if (!fortune || fortune.mul == null) return stats;
    const key = fortune.stat;
    const value = Number(stats?.[key]);
    if (!Number.isFinite(value)) return stats;
    return { ...stats, [key]: value * fortune.mul };
  },
  // 建造费：运势「塔造价 -30%」（模拟层随后统一套遗物 costMul 与 Math.max(20, ...) 下限）。
  buildCost(type, base, ctx) {
    return applyBuildDiscount(ctx, base);
  },
  // 升级费：代价「本波塔不可升级」返回 null（模拟层的「不能继续升级」语义）。
  upgradeCost(tower, base, ctx) {
    return costOf(ctx)?.id === 'upgradeLock' ? null : base;
  },
  // 遗物刷新次数 +1（服务端在开局与每次遗物 draft 时读取）。
  relicRerollBonus(base) {
    return base + 1;
  },
  // 漏怪：代价「本波漏怪伤害 +1」在基础伤害之外再扣 1 点基地生命。
  onLeak(enemy, ctx) {
    const bonus = costOf(ctx)?.leakBonus;
    if (bonus == null) return;
    const sim = ctx?.sim;
    if (!sim || !Number.isFinite(sim.baseHp)) return;
    sim.baseHp -= bonus;
    sim.addFloater?.(enemy?.x ?? 0, (enemy?.y ?? 0) - 0.4, `-${bonus}`, '#ff6b6b', true, {
      key: true,
    });
  },
});

export default Object.freeze({
  id: 'gamblers_dice',
  name: '赌徒之骰',
  glyph: '🎲',
  color: '#f472b6',
  tags: Object.freeze(['随机', '变数']),
  pitch: '每波随机运势 + 代价，遗物完全随机、刷新 +1',
  desc: '每波随机运势与代价，遗物完全随机、刷新 +1。',
  downside: '每波承受一组随机代价',
  // 服务端读到该声明即取消遗物稀有度权重；刷新 +1 走 relicRerollBonus 钩子。
  gamblerRelicMode: true,
  scoreMul: 1.10,
  hooks,
  implemented: true,
});
