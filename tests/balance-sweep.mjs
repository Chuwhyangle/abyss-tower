// 参数扫描：对多组难度/经济参数跑模拟，比较三档通关率。
// 用法：node tests/balance-sweep.mjs [seeds]
import { runOne, summarize } from './balance-sim.mjs';
import { BALANCE } from '../public/js/shared/config.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, ENEMIES, MAX_WAVE } from '../public/js/shared/data.js';

const SEEDS = Math.max(1, Number(process.argv[2]) || 5);

const BASELINE_BALANCE = {
  hpGrowth: 1.155, budgetBase: 4.5, budgetPerWave: 1.05,
  budgetLateStart: 10, budgetLateBoost: 1.2,
  waveRewardBase: 15, waveRewardPerWave: 2, killGoldWaveRate: 0.004,
  finalBossMul: 1.0, bossHp: 900, bossDmg: 3, bossArmor: 5,
};
const BASELINE_DIFF = {
  roam: [0.93, 0.93, 0.98],
  standard: [1.0, 1.0, 1.0],
  abyss: [1.22, 1.1, 1.04],
};

const BASE = { hpGrowth: 1.16, budgetLateBoost: 0.6, waveRewardBase: 20, waveRewardPerWave: 3, killGoldWaveRate: 0.005 };
const DIFF = { roam: [0.9, 0.9, 0.97], abyss: [1.18, 1.07, 1.03] };
const FD_BASE = { hpGrowth: 1.165, budgetLateBoost: 0.6, waveRewardBase: 20, waveRewardPerWave: 3, killGoldWaveRate: 0.005 };
const SCENARIOS = [
  { name: 'FG', balance: FD_BASE, diff: { roam: [0.85, 0.87, 0.96], standard: [1.02, 1.01, 1.0], abyss: [1.18, 1.07, 1.03] } },
  { name: 'FH', balance: FD_BASE, diff: { roam: [0.87, 0.88, 0.97], standard: [1.02, 1.01, 1.0], abyss: [1.18, 1.07, 1.03] } },
  { name: 'FI', balance: FD_BASE, diff: { roam: [0.85, 0.87, 0.96], standard: [1.04, 1.02, 1.0], abyss: [1.18, 1.07, 1.03] } },
  { name: 'FJ', balance: FD_BASE, diff: { roam: [0.85, 0.87, 0.96], standard: [1.03, 1.01, 1.0], abyss: [1.18, 1.07, 1.03] } },
  { name: 'FK', balance: FD_BASE, diff: { roam: [0.85, 0.87, 0.96], standard: [1.02, 1.01, 1.0], abyss: [1.2, 1.08, 1.03] } },
  { name: 'FL', balance: FD_BASE, diff: { roam: [0.88, 0.89, 0.97], standard: [1.02, 1.01, 1.0], abyss: [1.19, 1.075, 1.03] } },
];

function applyScenario(scenario) {
  Object.assign(BALANCE, BASELINE_BALANCE, scenario.balance);
  ENEMIES.boss.hp = BALANCE.bossHp;
  ENEMIES.boss.dmg = BALANCE.bossDmg;
  ENEMIES.boss.armor = BALANCE.bossArmor;
  for (const id of DIFFICULTY_ORDER) {
    const [hpMul, countMul, speedMul] = scenario.diff?.[id] || BASELINE_DIFF[id];
    DIFFICULTIES[id].hpMul = hpMul;
    DIFFICULTIES[id].countMul = countMul;
    DIFFICULTIES[id].speedMul = speedMul;
  }
}

function runScenario(scenario) {
  applyScenario(scenario);
  const rows = [];
  for (const meta of [false, true]) {
    for (const difficulty of DIFFICULTY_ORDER) {
      for (let i = 0; i < SEEDS; i++) {
        // 同一张地图跨难度/解锁状态复用，避免地图差异淹没参数差异。
        const seed = `sweep-${i}`;
        rows.push(runOne(seed, difficulty, meta));
      }
    }
  }
  return summarize(rows);
}

console.log(`参数扫描：${SCENARIOS.length} 组 × ${SEEDS} 种子 × 3 难度 × 2 解锁状态\n`);
console.log('方案 | 难度 | 零解锁通关率 | 零解锁均波 | 全解锁通关率 | 全解锁均波 | 全解锁均生命');

for (const scenario of SCENARIOS) {
  const summary = runScenario(scenario);
  for (const difficulty of DIFFICULTY_ORDER) {
    const base = summary.find((row) => row.difficulty === difficulty && row.meta === 'base');
    const full = summary.find((row) => row.difficulty === difficulty && row.meta === 'full');
    console.log(
      [
        scenario.name,
        DIFFICULTIES[difficulty].name,
        `${(base.winRate * 100).toFixed(0)}%`,
        base.avgWave.toFixed(1),
        `${(full.winRate * 100).toFixed(0)}%`,
        full.avgWave.toFixed(1),
        full.avgHp,
      ].join(' | ')
    );
  }
  console.log('-'.repeat(72));
}

console.log('\n目标（全解锁、机器人口径）：漫游 80–90%、远征 25–35%、深渊 5–15%。');
console.log('扫描请使用 ≥20 个种子；不同 seed 集波动较大，定版以 40 种子为准。');
console.log(`最高波次：${MAX_WAVE}`);
