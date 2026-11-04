// 关卡节点化 · 阶段 0：6 节点章节表 + 纯函数反查。
// 字段契约与六节点数值的唯一出处是 docs/PHASE_CHAPTERS.md §3（同一数值不得两处各写一遍）。
// 纯数据 + 纯函数：无 RNG、无 IO，服务端与浏览器共用；本文件不 import 任何本地模块（自包含，避免循环）。

// 基线敌人：所有节点继续做填充（PHASE_CHAPTERS §3.2 注），不重复列进各节点 enemyPool。
export const BASELINE_ENEMIES = ['grunt', 'runner', 'swarm'];

// 6 节点章节表（按 §3.2 表顺序）：
//   id / name / waves:[start,end]（闭区间，覆盖 1..30 无重叠）
//   theme:{hpMul,speedMul}（节点级倍率，乘在难度曲线之上，不替代曲线）
//   enemyPool（主题主打敌人 id，与 BASELINE_ENEMIES 并集构成该节点可用敌人池）
//   bossVariant（对齐 selectBossVariant 每 5 波轮换 armored→summoner→berserk）
export const CHAPTERS = [
  {
    id: 'ch1',
    name: '石肤荒野',
    waves: [1, 5],
    theme: { hpMul: 1.0, speedMul: 1.0 },
    enemyPool: ['grunt', 'runner', 'swarm', 'tank'],
    bossVariant: 'armored',
  },
  {
    id: 'ch2',
    name: '天穹裂痕',
    waves: [6, 10],
    theme: { hpMul: 0.95, speedMul: 1.05 },
    enemyPool: ['flyer', 'shielder', 'healer', 'splitter'],
    bossVariant: 'summoner',
  },
  {
    id: 'ch3',
    name: '重甲壁垒',
    waves: [11, 15],
    theme: { hpMul: 1.15, speedMul: 0.95 },
    enemyPool: ['herald', 'caster', 'golem', 'tank', 'shielder'],
    bossVariant: 'berserk',
  },
  {
    id: 'ch4',
    name: '裂潮涌动',
    waves: [16, 20],
    theme: { hpMul: 0.9, speedMul: 1.05 },
    enemyPool: ['splitter', 'swarm', 'wraith', 'runner'],
    bossVariant: 'armored',
  },
  {
    id: 'ch5',
    name: '相位风暴',
    waves: [21, 25],
    theme: { hpMul: 1.1, speedMul: 1.0 },
    enemyPool: ['wraith', 'caster', 'herald', 'flyer'],
    bossVariant: 'summoner',
  },
  {
    id: 'ch6',
    name: '深渊终章',
    waves: [26, 30],
    theme: { hpMul: 1.2, speedMul: 1.0 },
    enemyPool: ['golem', 'herald', 'caster', 'wraith', 'tank', 'shielder', 'flyer'],
    bossVariant: 'berserk',
  },
];

// 区间反查：给定波次返回所属章节对象；纯函数、无 RNG、无 IO，同输入必同输出。
// 不在 1..30 覆盖区间返回 null。
export function chapterForWave(wave) {
  const w = Number(wave);
  return CHAPTERS.find((chapter) => w >= chapter.waves[0] && w <= chapter.waves[1]) || null;
}

// theme 归一化：缺省字段回落 1.0，调用方无需做空值判断。
export function normalizeTheme(theme) {
  return { hpMul: theme?.hpMul ?? 1, speedMul: theme?.speedMul ?? 1 };
}
