// 基础战斗词缀注册表片段（伤害/攻速/射程/经济/条件增伤等 22 键）。
// 导出工厂 makeBaseEffects：依赖（pct、条件阈值与判定、快照）由 effects.js 注入，
// 返回有序片段对象；effects.js 按 base → skill → periodic 顺序合并进 EFFECT_REGISTRY。
// 键序不得重排：globalModCaps 与 hitBonuses 都按注册表顺序派生。
export default function makeBaseEffects({ pct, CONDITION_THRESHOLDS, isLowHpState, isRichState, hasEmptySlots, conditionSnapshot }) {
  return {
    dmg: {
      cap: 2.0,
      globalCap: 2.5,
      text: (value, { towerName }) => `${towerName}伤害 +${pct(value)}`,
      balanceWeight: 10,
      nested: true,
      apply(mods, value) {
        for (const [type, amount] of Object.entries(value)) {
          mods.dmg[type] = (mods.dmg[type] || 0) + amount;
        }
      },
    },
    dmgAll: {
      cap: 1.0,
      globalCap: 1.5,
      text: (value) => `全体伤害 +${pct(value)}`,
      balanceWeight: 14,
    },
    fireRate: {
      cap: 0.6,
      globalCap: 0.6,
      text: (value) => `攻击速度 +${pct(value)}`,
      balanceWeight: 13,
    },
    range: {
      cap: 2.0,
      globalCap: 2.2,
      text: (value) => `射程 +${Number(value.toFixed(1))} 格`,
      balanceWeight: 1.5,
    },
    splash: {
      cap: 0.8,
      globalCap: 0.9,
      text: (value) => `溅射范围 +${pct(value)}`,
      balanceWeight: 6,
    },
    slow: {
      cap: 0.35,
      globalCap: 0.35,
      text: (value) => `减速强度 +${pct(value)}`,
      balanceWeight: 4,
    },
    slowDur: {
      cap: 0.8,
      globalCap: 0.9,
      text: (value) => `减速持续 +${pct(value)}`,
      balanceWeight: 4,
    },
    chain: {
      cap: 2,
      globalCap: 2,
      text: (value) => `连锁 +${value} 个目标`,
      balanceWeight: 3,
      integer: true,
    },
    dot: {
      cap: 1.0,
      globalCap: 1.2,
      text: (value) => `毒伤 +${pct(value)}`,
      balanceWeight: 9,
    },
    goldMul: {
      cap: 0.6,
      globalCap: 0.7,
      text: (value) => `金币收入 +${pct(value)}`,
      balanceWeight: 7,
    },
    killGold: {
      cap: 6,
      globalCap: 8,
      text: (value) => `击杀金币 +${value}`,
      balanceWeight: 1.2,
      integer: true,
    },
    interest: {
      cap: 0.12,
      globalCap: 0.15,
      text: (value) => `波末利息 +${pct(value)}`,
      balanceWeight: 22,
    },
    crit: {
      cap: 0.4,
      globalCap: 0.45,
      text: (value) => `暴击率 +${pct(value)}`,
      balanceWeight: 10,
    },
    armorPierce: {
      cap: 0.8,
      globalCap: 0.85,
      text: (value) => `无视护甲 +${pct(value)}`,
      balanceWeight: 6,
    },
    costMul: {
      cap: -0.2,
      globalCap: -0.2,
      capMode: 'max',
      text: (value) => `建造/升级费用 ${value < 0 ? '-' : '+'}${pct(Math.abs(value))}`,
      balanceWeight: 2,
    },
    frostDmgBonus: {
      cap: 0.4,
      globalCap: 0.45,
      text: (value) => `减速目标受伤 +${pct(value)}`,
      balanceWeight: 2,
    },
    lowHpDmg: {
      cap: 0.7,
      globalCap: 0.8,
      text: (value) => `基地低血时伤害 +${pct(value)}`,
      balanceWeight: 2,
      hitCondition: (sim, enemy, context) => isLowHpState(context || conditionSnapshot(sim)),
    },
    richDmg: {
      cap: 0.6,
      globalCap: 0.7,
      text: (value) => `金币 ≥ ${CONDITION_THRESHOLDS.richGold} 时伤害 +${pct(value)}`,
      balanceWeight: 3,
      hitCondition: (sim, enemy, context) => isRichState(context || conditionSnapshot(sim)),
    },
    emptySlotDmg: {
      cap: 0.6,
      globalCap: 0.7,
      text: (value) => `空置塔位 ≥ ${CONDITION_THRESHOLDS.emptySlots} 时伤害 +${pct(value)}`,
      balanceWeight: 3,
      hitCondition: (sim, enemy, context) => hasEmptySlots(context || conditionSnapshot(sim)),
    },
    projSpeed: {
      cap: 1.0,
      globalCap: 1.2,
      text: (value) => `投射物速度 +${pct(value)}`,
      balanceWeight: 2,
    },
    bossDmg: {
      cap: 1.0,
      globalCap: 1.2,
      text: (value) => `对首领伤害 +${pct(value)}`,
      balanceWeight: 3,
      hitCondition: (sim, enemy) => enemy.boss,
    },
    baseHp: {
      cap: 20,
      globalCap: 30,
      text: (value) => `基地生命 +${value}（立即）`,
      balanceWeight: 0.4,
      integer: true,
    },
  };
}
