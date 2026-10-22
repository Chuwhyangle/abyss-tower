// 集中可调数值：平衡模拟器会临时修改这里的字段，再跑完整对局。
export const BALANCE = {
  // 波次难度曲线（v1：平衡模拟定版，目标见 docs/BALANCE.md）
  hpGrowth: 1.165,         // 每波基础血量倍率
  speedGrowth: 0.006,      // 每波移速加成
  budgetBase: 4.5,         // 第一波敌人数量预算
  budgetPerWave: 1.05,     // 每波预算增量
  budgetLateStart: 10,     // 从第几波开始追加数量
  budgetLateBoost: 0.6,    // 后期每波额外数量
  finalBossMul: 1.0,       // 第 30 波额外血量倍率

  // 经济
  waveRewardBase: 20,      // 清波基础金币
  waveRewardPerWave: 3,    // 每波奖励增量
  killGoldWaveRate: 0.005, // 击杀金币随波次增长比例

  // 容量
  maxCount: 80,            // 单波敌人数量上限
};
