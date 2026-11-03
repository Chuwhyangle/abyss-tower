// 固定地图 1/3 · 裂谷关隘（canyon）
// 单入口、长折返：一条主路切过裂谷，塔位沿路分布，是新手与稳健构筑的基线图。
// 无固定 trait，计分倍率 0.95，敌人生命倍率 1.2（易图上调难度以收敛逐图通关率）。
export const CANYON_SPEC = {
  id: 'canyon',
  name: '裂谷关隘',
  archetype: 'canyon',
  archetypeName: '单径峡谷',
  desc: '一条主路自西向东折返穿过裂谷，塔位充足、节奏平稳，适合稳定构筑。',
  cols: 22,
  rows: 12,
  scoreMul: 0.95,
  hpMul: 1.2,
  trait: null,
  lanes: [
    {
      waypoints: [
        [0, 3],
        [5, 3],
        [5, 8],
        [11, 8],
        [11, 2],
        [16, 2],
        [16, 9],
        [20, 9],
      ],
    },
  ],
  base: [20, 9],
  // 固定装饰岩石：位置/尺寸/朝向全部写死，不使用 RNG；均避开路径及其相邻塔位。
  rocks: [
    { c: 2, r: 1, size: 0.3, rot: 0.4 },
    { c: 9, r: 2, size: 0.34, rot: 1.2 },
    { c: 7, r: 4, size: 0.28, rot: 2.1 },
    { c: 14, r: 5, size: 0.36, rot: 0.9 },
    { c: 2, r: 6, size: 0.31, rot: 3.0 },
    { c: 9, r: 6, size: 0.27, rot: 4.2 },
    { c: 14, r: 7, size: 0.33, rot: 5.1 },
    { c: 2, r: 9, size: 0.29, rot: 1.7 },
    { c: 13, r: 9, size: 0.35, rot: 2.6 },
    { c: 7, r: 10, size: 0.3, rot: 0.2 },
  ],
  // 固定可破坏物：位置写死，全部落在可建造格，且距出生点/基地 ≥2 格（切比雪夫）。
  // 2 金脉、1 石碑、1 补给箱（免费）、1 虫巢（免费）、1 诅咒图腾。
  destructibles: [
    { id: 'canyon-vein-1', type: 'vein', c: 2, r: 2 },
    { id: 'canyon-vein-2', type: 'vein', c: 9, r: 3 },
    { id: 'canyon-obelisk-1', type: 'obelisk', c: 12, r: 4 },
    { id: 'canyon-cache-1', type: 'cache', c: 12, r: 8 },
    { id: 'canyon-nest-1', type: 'nest', c: 12, r: 6 },
    { id: 'canyon-totem-1', type: 'totem', c: 18, r: 4 },
    // 可攻击资源矿脉（feat-attackable-tiles）：塔在无敌人时自动攻击，破坏后按 seed+波次掉落金币。
    // 3 个固定矿脉，避开路径/岩石/贴路塔位/既有可破坏物，均距出生点/基地 ≥2 格。
    { id: 'canyon-resource-vein-1', type: 'resourceVein', c: 3, r: 2 },
    { id: 'canyon-resource-vein-2', type: 'resourceVein', c: 12, r: 5 },
    { id: 'canyon-resource-vein-3', type: 'resourceVein', c: 15, r: 8 },
  ],
  // 手写塔位掩码：25 格固定贴路塔位，取代「全图可建」。
  // 全部为路径 1 格邻接，且避开岩石与可破坏物占格；按 (r,c) 升序。
  buildableMask: [
    [13, 1], [15, 1],
    [1, 2], [4, 2],
    [6, 3], [10, 3], [12, 3], [13, 3], [14, 3],
    [3, 4], [15, 4],
    [4, 5], [6, 5], [10, 5], [17, 5],
    [7, 7], [8, 7], [9, 7], [10, 7], [12, 7], [15, 7],
    [17, 8], [18, 8],
    [6, 9], [9, 9],
  ],
  blockers: [],
};
