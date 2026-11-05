// 回合型效果片段（waveGold*/waveHeal*）：声明触发周期（波）与波末结算时机。
// periodic 声明触发周期与结算时机；数值仍走等级缩放与全局封顶。
// applyPeriodic 只在对应波次结束时调用一次，不消耗随机数，因此不影响固定种子结算顺序。
export default function makePeriodicEffects({ pct, healBase }) {
  return {
    waveGold2: {
      cap: 24,
      globalCap: 36,
      text: (value) => `每 2 波结束时获得 ${value} 金币`,
      balanceWeight: 5,
      integer: true,
      periodic: { period: 2, timing: 'waveEnd' },
      applyPeriodic(sim, value) {
        sim.gold += value;
      },
    },
    waveGold3: {
      cap: 48,
      globalCap: 72,
      text: (value) => `每 3 波结束时获得 ${value} 金币`,
      balanceWeight: 6,
      integer: true,
      periodic: { period: 3, timing: 'waveEnd' },
      applyPeriodic(sim, value) {
        sim.gold += value;
      },
    },
    waveGold5: {
      cap: 96,
      globalCap: 160,
      text: (value) => `每 5 波结束时获得 ${value} 金币`,
      balanceWeight: 8,
      integer: true,
      periodic: { period: 5, timing: 'waveEnd' },
      applyPeriodic(sim, value) {
        sim.gold += value;
      },
    },
    waveHeal3: {
      cap: 5,
      globalCap: 8,
      text: (value) => `每 3 波结束时恢复 ${value} 点基地生命`,
      balanceWeight: 3,
      integer: true,
      periodic: { period: 3, timing: 'waveEnd' },
      applyPeriodic(sim, value) {
        healBase(sim, value);
      },
    },
    waveHeal4: {
      cap: 6,
      globalCap: 10,
      text: (value) => `每 4 波结束时恢复 ${value} 点基地生命`,
      balanceWeight: 3,
      integer: true,
      periodic: { period: 4, timing: 'waveEnd' },
      applyPeriodic(sim, value) {
        healBase(sim, value);
      },
    },
    waveHeal5: {
      cap: 10,
      globalCap: 16,
      text: (value) => `每 5 波结束时恢复 ${value} 点基地生命`,
      balanceWeight: 4,
      integer: true,
      periodic: { period: 5, timing: 'waveEnd' },
      applyPeriodic(sim, value) {
        healBase(sim, value);
      },
    },
  };
}
