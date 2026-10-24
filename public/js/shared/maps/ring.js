// 固定地图 3/3 · 环心遗迹（ring）
// 两入口各自绕行半环后汇流，路径最长、塔位被拉开。
// 固定 trait：回响（塔射程 +8%，敌人移速 +6%），计分倍率 1.08。
const ECHO_TRAIT = {
  id: 'echo',
  name: '回响',
  color: '#8fe0ff',
  desc: '防御塔射程 +8%，敌人移速 +6%',
  hpMul: 1,
  speedMul: 1.06,
  goldMul: 1,
  rangeMul: 1.08,
  scoreMul: 1,
  extraPortal: 0,
};

export const RING_SPEC = {
  id: 'ring',
  name: '环心遗迹',
  archetype: 'ring',
  archetypeName: '环形回廊',
  desc: '两条回廊沿遗迹外环反向绕行，于东侧合流；路径最长，需要双线兼顾。',
  cols: 22,
  rows: 12,
  scoreMul: 1.08,
  trait: ECHO_TRAIT,
  lanes: [
    {
      waypoints: [
        [0, 1],
        [16, 1],
        [16, 4],
        [18, 4],
        [18, 5],
        [20, 5],
      ],
    },
    {
      waypoints: [
        [0, 10],
        [16, 10],
        [16, 7],
        [18, 7],
        [18, 5],
        [20, 5],
      ],
    },
  ],
  base: [20, 5],
  merge: [18, 5],
  // 固定装饰岩石：位置/尺寸/朝向全部写死，不使用 RNG；均避开路径及其相邻塔位。
  rocks: [
    { c: 3, r: 3, size: 0.3, rot: 1.8 },
    { c: 10, r: 3, size: 0.34, rot: 0.5 },
    { c: 5, r: 4, size: 0.27, rot: 2.9 },
    { c: 13, r: 5, size: 0.32, rot: 4.4 },
    { c: 2, r: 6, size: 0.29, rot: 0.1 },
    { c: 9, r: 6, size: 0.35, rot: 3.7 },
    { c: 14, r: 7, size: 0.28, rot: 5.3 },
    { c: 5, r: 8, size: 0.31, rot: 1.3 },
    { c: 20, r: 2, size: 0.33, rot: 2.2 },
  ],
  blockers: [],
};
