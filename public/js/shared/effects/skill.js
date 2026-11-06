// 技能系词缀片段（skillCd/skillPower：天赋技能节点接线，skill-system.js 消费）。
// skillCd 为负值缩减（capMode 'max' 同 costMul）；skillPower 为正值放大，二者只读不进遗物池。
export default function makeSkillEffects({ pct }) {
  return {
    skillCd: {
      cap: -0.1,
      globalCap: -0.1,
      capMode: 'max',
      text: (value) => `主动技能冷却 ${value < 0 ? '-' : '+'}${pct(Math.abs(value))}`,
      balanceWeight: 8,
    },
    skillPower: {
      cap: 0.5,
      globalCap: 0.6,
      text: (value) => `主动技能效果 +${pct(value)}`,
      balanceWeight: 8,
    },
  };
}
