// 三档难度：只调整参数，不改变 30 波结构。数值为 v0 假设，M2/M4 用模拟与试玩校准。
export const DIFFICULTIES = {
  roam: {
    id: 'roam',
    name: '漫游',
    color: '#6fe0b0',
    desc: '熟悉机制与尝试流派，压力较小。',
    hpMul: 0.85,
    countMul: 0.87,
    speedMul: 0.96,
    goldBonus: 60,
    hpBonus: 5,
    scoreMul: 0.8,
    coresMul: 0.65,
  },
  standard: {
    id: 'standard',
    name: '远征',
    color: '#ffd36b',
    desc: '标准远征，设计基准。',
    hpMul: 1.10,
    countMul: 1.04,
    speedMul: 1.01,
    goldBonus: 0,
    hpBonus: 0,
    scoreMul: 1.0,
    coresMul: 1.0,
  },
  abyss: {
    id: 'abyss',
    name: '深渊',
    color: '#ff6b8a',
    desc: '高压挑战，需要成熟构筑与取舍。',
    hpMul: 1.34,
    countMul: 1.12,
    speedMul: 1.05,
    goldBonus: -20,
    hpBonus: -3,
    scoreMul: 1.5,
    coresMul: 1.5,
  },
};

export const DIFFICULTY_ORDER = ['roam', 'standard', 'abyss'];

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.standard;
}
