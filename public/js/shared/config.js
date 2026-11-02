// 集中可调数值：平衡模拟器会临时修改这里的字段，再跑完整对局。
export const BALANCE = {
  // 波次难度曲线（v1：平衡模拟定版，目标见 docs/BALANCE.md）
  hpGrowth: 1.17,         // 每波基础血量倍率
  speedGrowth: 0.006,      // 每波移速加成
  budgetBase: 4.5,         // 第一波敌人数量预算
  budgetPerWave: 1.05,     // 每波预算增量
  budgetLateStart: 10,     // 从第几波开始追加数量
  budgetLateBoost: 0.6,    // 后期每波额外数量
  finalBossMul: 1.0,       // 第 30 波额外血量倍率（普通敌人用）

  // 首领：独立血量曲线 + 走走停停 + 技能
  bossHpGrowth: 1.11,      // 首领每波血量倍率（不再沿用 hpGrowth）
  bossFinalMul: 2.0,       // 最终首领额外血量
  bossStopInterval: 3.4,   // 行进多久后停顿
  bossStopDuration: 1.25,  // 停顿/破绽持续时间
  bossCastWindup: 0.85,    // 技能蓄力时间（预警圈）
  bossVulnMul: 1.35,       // 停顿期间受到伤害倍率
  bossVulnAfter: 1.6,      // 停顿结束后破绽延续
  bossRoarCd: 9,           // 深渊咆哮冷却
  bossRoarRadius: 3.0,
  bossRoarSpeed: 0.3,      // 周围敌人移速加成
  bossRoarDur: 4,
  bossSummonCd: 13,
  bossSummonBase: 3,
  bossSummonPerWave: 0.1,
  bossSummonMax: 8,
  bossSlamCd: 15,
  bossSlamRadius: 2.5,
  bossSlamDisable: 2.2,    // 防御塔停摆秒数

  // 经济
  waveRewardBase: 20,      // 清波基础金币
  waveRewardPerWave: 3,    // 每波奖励增量
  killGoldWaveRate: 0.005, // 击杀金币随波次增长比例

  // 容量
  maxCount: 80,            // 单波敌人数量上限
};

// 三档目标通关率（全解锁、机器人 40 种子 × 3 候选口径）。
// 平衡报告据此判定达标；调整目标时同步 docs/BALANCE.md 的结论。
export const BALANCE_TARGETS = {
  roam: [0.70, 0.85],
  standard: [0.25, 0.40],
  abyss: [0.05, 0.12],
};
