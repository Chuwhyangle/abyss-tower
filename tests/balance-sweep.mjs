// 参数扫描：围绕当前三档倍率做小范围扫描，比较通关率变化。
// 用法：
//   node tests/balance-sweep.mjs [seeds] [--diff=roam] [--axis=hpMul] \
//     [--values=0.85,0.9,0.95] [--candidates=1]
//   node tests/balance-sweep.mjs [seeds] --set=roam:0.9,0.9,0.97 [--set=abyss:1.3,1.1,1.04]
//
// 默认扫描 anchor 难度（远征）的 hpMul，取值以当前倍率为中心上下浮动。
// 只修改 DIFFICULTIES 的 hpMul/countMul/speedMul，跑完恢复基准值。
import { runOne, summarize } from './balance-sim.mjs';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, MAX_WAVE } from '../public/js/shared/data.js';

const SEEDS = Math.max(1, Number(process.argv[2]) || 5);
const AXES = ['hpMul', 'countMul', 'speedMul'];

function argValue(name) {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      return argv[i + 1];
    }
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return null;
}

function argValues(name) {
  const out = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out.push(argv[i + 1]);
    } else if (argv[i].startsWith(`--${name}=`)) {
      out.push(argv[i].slice(name.length + 3));
    }
  }
  return out;
}

const CANDIDATES = Math.max(1, Math.min(3, Number(argValue('candidates')) || 1));
const DIFF = argValue('diff') || 'standard';
const AXIS = argValue('axis') || 'hpMul';

function snapshot() {
  const copy = {};
  for (const id of DIFFICULTY_ORDER) {
    const diff = DIFFICULTIES[id];
    copy[id] = { hpMul: diff.hpMul, countMul: diff.countMul, speedMul: diff.speedMul };
  }
  return copy;
}

const BASELINE = snapshot();

function restore() {
  for (const id of DIFFICULTY_ORDER) {
    Object.assign(DIFFICULTIES[id], BASELINE[id]);
  }
}

function parseSet(raw) {
  const [id, tuple] = raw.split(':');
  if (!DIFFICULTY_ORDER.includes(id)) {
    throw new Error(`未知难度：${raw}`);
  }
  const values = tuple.split(',').map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`--set 需要三档倍率：${raw}`);
  }
  return { id, values };
}

function buildScenarios() {
  const sets = argValues('set');
  if (sets.length) {
    const parsed = sets.map(parseSet);
    return [
      {
        label: parsed.map((item) => `${item.id}:${item.values.join('/')}`).join(' '),
        apply: () => {
          for (const item of parsed) {
            const [hpMul, countMul, speedMul] = item.values;
            Object.assign(DIFFICULTIES[item.id], { hpMul, countMul, speedMul });
          }
        },
      },
    ];
  }

  if (!DIFFICULTY_ORDER.includes(DIFF)) throw new Error(`未知难度：${DIFF}`);
  if (!AXES.includes(AXIS)) throw new Error(`未知倍率轴：${AXIS}，可选 ${AXES.join('/')}`);

  const rawValues = argValue('values');
  const center = BASELINE[DIFF][AXIS];
  const values = rawValues
    ? rawValues.split(',').map(Number).filter(Number.isFinite)
    : [-0.08, -0.04, 0, 0.04, 0.08].map((offset) => Number((center + offset).toFixed(2)));

  return values.map((value) => ({
    label: String(value),
    apply: () => {
      DIFFICULTIES[DIFF][AXIS] = value;
    },
  }));
}

function runScenario(scenario) {
  restore();
  scenario.apply();
  const rows = [];
  for (const meta of [false, true]) {
    for (const difficulty of DIFFICULTY_ORDER) {
      for (let i = 0; i < SEEDS; i++) {
        // 同一张地图跨难度/解锁状态复用，避免地图差异淹没参数差异。
        const seed = `sweep-${i}`;
        for (let candidate = 0; candidate < CANDIDATES; candidate++) {
          rows.push(runOne(seed, difficulty, meta, candidate));
        }
      }
    }
  }
  return summarize(rows);
}

function targetLabel(difficulty, winRate) {
  const [low, high] = BALANCE_TARGETS[difficulty];
  if (winRate < low) return '低于目标';
  if (winRate > high) return '高于目标';
  return '达标';
}

const scenarios = buildScenarios();
const mode = argValues('set').length
  ? '--set 显式倍率'
  : `${DIFF} · ${AXIS}（基准 ${BASELINE[DIFF][AXIS]}）`;

console.log(
  `参数扫描：${mode}，${scenarios.length} 档 × ${SEEDS} 种子 × ${CANDIDATES} 候选 × 3 难度 × 2 解锁状态\n`
);
console.log('扫描值 | 难度 | 零解锁通关率 | 零解锁均波 | 全解锁通关率 | 全解锁均波 | 全解锁均生命 | 状态');

for (const scenario of scenarios) {
  const summary = runScenario(scenario);
  for (const difficulty of DIFFICULTY_ORDER) {
    const base = summary.find((row) => row.difficulty === difficulty && row.meta === 'base');
    const full = summary.find((row) => row.difficulty === difficulty && row.meta === 'full');
    console.log(
      [
        scenario.label,
        DIFFICULTIES[difficulty].name,
        `${(base.winRate * 100).toFixed(0)}%`,
        base.avgWave.toFixed(1),
        `${(full.winRate * 100).toFixed(0)}%`,
        full.avgWave.toFixed(1),
        full.avgHp,
        targetLabel(difficulty, full.winRate),
      ].join(' | ')
    );
  }
  console.log('-'.repeat(88));
}

restore();

const targetText = DIFFICULTY_ORDER.map((id) => {
  const [low, high] = BALANCE_TARGETS[id];
  return `${DIFFICULTIES[id].name} ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%`;
}).join('、');
console.log(`\n目标（全解锁、机器人口径）：${targetText}。`);
console.log('扫描请使用 ≥20 个种子；不同 seed 集波动较大，定版以 40 种子 × 3 候选为准。');
console.log(`最高波次：${MAX_WAVE}`);
