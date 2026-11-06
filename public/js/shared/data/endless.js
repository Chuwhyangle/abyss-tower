// 无尽模式 60 波后内容：周期词缀 + 首领循环（纯数据，波次只做 seed 派生选择）。
// 词缀效果乘法叠加在基础曲线之上；sim 只读波次定义，不读本文件之外的任何 RNG。

export const ENDLESS_POST_60 = 60;          // 60 波后开始追加词缀/首领循环
export const ENDLESS_AFFIX_INTERVAL = 10;   // 每 10 波追加一层词缀
export const ENDLESS_AFFIX_MAX_LAYERS = 10; // 词缀层数硬上限（第 151 波起不再追加）

// 无尽词缀池：每层按 seed 派生随机挑选一个，效果乘法叠加在整波（含首领）与清波奖励上。
// hpMul/speedMul/goldMul 直接乘到波次定义；elite 为精英敌人权重加成（仅非首领波生效）。
export const ENDLESS_AFFIXES = [
  { id: 'crushing', name: '碾压', color: '#ff8f5a', desc: '敌人生命 +10%', hpMul: 1.1, speedMul: 1, goldMul: 1, elite: 0 },
  { id: 'haste', name: '疾驰', color: '#5fb6ea', desc: '敌人移速 +10%', hpMul: 1, speedMul: 1.1, goldMul: 1, elite: 0 },
  { id: 'elite', name: '精锐', color: '#e08b3c', desc: '精英敌人权重 +90%', hpMul: 1, speedMul: 1, goldMul: 1, elite: 0.9 },
  { id: 'gilded', name: '镀金', color: '#ffd36b', desc: '清波金币 +12%、敌人生命 +5%', hpMul: 1.05, speedMul: 1, goldMul: 1.12, elite: 0 },
  { id: 'feral', name: '狂野', color: '#ff5533', desc: '敌人生命 +5%、移速 +5%', hpMul: 1.05, speedMul: 1.05, goldMul: 1, elite: 0 },
  { id: 'mending', name: '愈合', color: '#66dbaa', desc: '敌人生命 +8%、清波金币 +6%', hpMul: 1.08, speedMul: 1, goldMul: 1.06, elite: 0 },
];

export const ENDLESS_AFFIX_BY_ID = Object.fromEntries(ENDLESS_AFFIXES.map((a) => [a.id, a]));

// 精英敌人集合：无尽 60 波后按词缀的 elite 加成提升这些类型的权重占比，
// 实现「稀有/精英敌人占比提升」。类型均取自 waves.js 的 POOL，minWave ≤ 28。
export const ENDLESS_ELITE_ENEMIES = new Set([
  'skywing',
  'herald',
  'caster',
  'wraith',
  'golem',
  'bastion',
  'mender',
  'bomber',
  'stalker',
  'riftcaller',
  'shieldbreaker',
]);

// 首领循环：60 波后每 ENDLESS_BOSS_CYCLE_INTERVAL 波循环出首领，强度随循环数递增。
export const ENDLESS_BOSS_CYCLE_INTERVAL = 10;
export const ENDLESS_BOSS_CYCLE_MAX = 10;        // 循环强度封顶（第 150 波后不再递增）
export const ENDLESS_BOSS_CYCLE_HP_GROWTH = 1.12; // 每循环首领血量倍率
