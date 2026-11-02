// 固定地图 2/3 · 双牙桥（twin）
// 两入口在中段汇流后共赴基地，汇流点是黄金火力点。
// 固定 trait：商路（击杀金币 +10%，敌人生命 +8%），计分倍率 1.00，敌人生命倍率 0.9（难图降难度补偿）。
const TRADE_TRAIT = {
  id: 'trade',
  name: '商路',
  color: '#ffd36b',
  desc: '击杀金币 +10%，敌人生命 +8%',
  hpMul: 1.08,
  speedMul: 1,
  goldMul: 1.1,
  rangeMul: 1,
  scoreMul: 1,
  extraPortal: 0,
};

export const TWIN_SPEC = {
  id: 'twin',
  name: '双牙桥',
  archetype: 'twin',
  archetypeName: '双径汇流',
  desc: '两枚牙桥自南北两道入口咬合，于东侧汇流；守好汇流点即可双线兼顾。',
  cols: 22,
  rows: 12,
  scoreMul: 1,
  hpMul: 0.9,
  trait: TRADE_TRAIT,
  lanes: [
    {
      waypoints: [
        [0, 2],
        [7, 2],
        [7, 5],
        [13, 5],
        [18, 5],
        [20, 5],
      ],
    },
    {
      waypoints: [
        [0, 9],
        [7, 9],
        [7, 6],
        [13, 6],
        [18, 6],
        [18, 5],
        [20, 5],
      ],
    },
  ],
  base: [20, 5],
  merge: [18, 5],
  // 固定装饰岩石：位置/尺寸/朝向全部写死，不使用 RNG；均避开路径及其相邻塔位。
  rocks: [
    { c: 10, r: 1, size: 0.32, rot: 0.7 },
    { c: 16, r: 1, size: 0.28, rot: 2.4 },
    { c: 12, r: 2, size: 0.35, rot: 1.5 },
    { c: 11, r: 3, size: 0.29, rot: 3.3 },
    { c: 2, r: 4, size: 0.31, rot: 5.0 },
    { c: 4, r: 6, size: 0.27, rot: 0.9 },
    { c: 2, r: 7, size: 0.34, rot: 4.1 },
    { c: 14, r: 8, size: 0.3, rot: 2.0 },
    { c: 18, r: 10, size: 0.33, rot: 1.1 },
  ],
  // 固定可破坏物：位置写死，全部落在可建造格，且距出生点/基地 ≥2 格（切比雪夫）。
  // 2 金脉、2 石碑、1 补给箱（免费）、1 虫巢（免费）、1 诅咒图腾。
  destructibles: [
    { id: 'twin-vein-1', type: 'vein', c: 9, r: 2 },
    { id: 'twin-vein-2', type: 'vein', c: 10, r: 9 },
    { id: 'twin-obelisk-1', type: 'obelisk', c: 13, r: 3 },
    { id: 'twin-obelisk-2', type: 'obelisk', c: 12, r: 7 },
    { id: 'twin-cache-1', type: 'cache', c: 16, r: 3 },
    { id: 'twin-nest-1', type: 'nest', c: 9, r: 4 },
    { id: 'twin-totem-1', type: 'totem', c: 17, r: 4 },
  ],
  blockers: [],
};
