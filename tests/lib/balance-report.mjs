// 平衡模拟的汇总与报告格式化：难度×解锁汇总、逐塔/遗物/敌人分解、Markdown 表格生成。
// 由 tests/balance-sim.mjs 引入；字段与文案是 --report JSON 与 docs/BALANCE.md 的契约。
import { ARCHETYPES, MODIFIER_BY_ID } from '../../public/js/shared/mapgen.js';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  ENEMIES,
  RELIC_BY_ID,
  TOWERS,
} from '../../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../../public/js/shared/config.js';

// ---------- 汇总 ----------

function statsOf(list) {
  const wins = list.filter((row) => row.victory).length;
  const waves = list.map((row) => row.cleared).sort((a, b) => a - b);
  const sum = (pick) => list.reduce((total, row) => total + pick(row), 0);
  return {
    runs: list.length,
    wins,
    winRate: wins / list.length,
    avgWave: sum((row) => row.cleared) / list.length,
    medianWave: waves[Math.floor(waves.length / 2)],
    maxWave: waves[waves.length - 1],
    avgScore: Math.round(sum((row) => row.score) / list.length),
    avgTowers: (sum((row) => row.towers) / list.length).toFixed(1),
    avgHp: (sum((row) => row.hp) / list.length).toFixed(1),
    avgGold: Math.round(sum((row) => row.gold) / list.length),
    avgSeconds: Math.round(sum((row) => row.simSeconds) / list.length),
    avgPortals: (sum((row) => row.portalCount) / list.length).toFixed(2),
    stuck: list.filter((row) => row.stuck).length,
  };
}

const DIFF_ORDER = { roam: 0, standard: 1, abyss: 2 };

function aggregate(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, ...statsOf(list) }));
}

// 保留旧导出：按 难度 × 解锁状态 汇总。
function summarize(rows) {
  const output = aggregate(rows, (row) => `${row.difficulty}:${row.meta ? 'full' : 'base'}`).map(
    (group) => {
      const [difficulty, meta] = group.key.split(':');
      const { key, ...rest } = group;
      return { difficulty, meta, ...rest };
    }
  );
  output.sort((a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] || a.meta.localeCompare(b.meta));
  return output;
}

function summarizeBy(rows, dimension) {
  const keyOf = {
    archetype: (row) => row.archetype,
    modifier: (row) => row.modifier,
    candidate: (row) => row.candidateIndex,
  }[dimension];
  return aggregate(rows, (row) => `${row.difficulty}:${keyOf(row)}`)
    .map((group) => {
      const split = group.key.indexOf(':');
      const difficulty = group.key.slice(0, split);
      let label = group.key.slice(split + 1);
      if (dimension === 'archetype') label = ARCHETYPES[label]?.name || label;
      if (dimension === 'modifier') label = label === 'none' ? '无' : MODIFIER_BY_ID[label]?.name || label;
      if (dimension === 'candidate') label = `候选 ${Number(label) + 1}`;
      const { key, ...rest } = group;
      return { difficulty, label, ...rest };
    })
    .sort((a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] || a.label.localeCompare(b.label));
}

// ---------- 逐内容分解 ----------

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(wins, runs) {
  return runs ? round(wins / runs) : null;
}

function groupRows(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// 逐塔：选取率 = 建过该塔的局数占比；贡献 = 有塔局胜率 - 无塔局胜率。
function towersBreakdown(rows) {
  const output = [];
  for (const [key, list] of groupRows(rows, (row) => `${row.difficulty}:${row.meta ? 'full' : 'base'}`)) {
    const [difficulty, meta] = key.split(':');
    const runs = list.length;
    for (const id of Object.keys(TOWERS)) {
      const built = list.filter((row) => (row.towerCounts?.[id] || 0) > 0);
      const without = list.filter((row) => !(row.towerCounts?.[id] > 0));
      const winsWith = built.filter((row) => row.victory).length;
      const winsWithout = without.filter((row) => row.victory).length;
      const winRateWith = ratio(winsWith, built.length);
      const winRateWithout = ratio(winsWithout, without.length);
      output.push({
        difficulty,
        meta,
        id,
        name: TOWERS[id].name,
        runs,
        runsWith: built.length,
        pickRate: ratio(built.length, runs),
        avgCount: round(built.reduce((sum, row) => sum + row.towerCounts[id], 0) / runs, 2),
        winsWith,
        winRateWith,
        runsWithout: without.length,
        winRateWithout,
        lift: winRateWith != null && winRateWithout != null ? round(winRateWith - winRateWithout) : null,
      });
    }
  }
  return output.sort(
    (a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] ||
      a.meta.localeCompare(b.meta) ||
      Object.keys(TOWERS).indexOf(a.id) - Object.keys(TOWERS).indexOf(b.id)
  );
}

// 逐遗物：只统计全解锁局（零解锁没有遗物抽取）。贡献 = 持有该遗物局胜率 - 未持有局胜率。
function relicsBreakdown(rows) {
  const fullRows = rows.filter((row) => row.meta);
  const output = [];
  for (const [difficulty, list] of groupRows(fullRows, (row) => row.difficulty)) {
    const runs = list.length;
    for (const relic of Object.values(RELIC_BY_ID)) {
      const held = list.filter((row) => row.relicStates.some((state) => state.id === relic.id));
      const without = list.filter((row) => !row.relicStates.some((state) => state.id === relic.id));
      const winsWith = held.filter((row) => row.victory).length;
      const winsWithout = without.filter((row) => row.victory).length;
      const winRateWith = ratio(winsWith, held.length);
      const winRateWithout = ratio(winsWithout, without.length);
      const levelSum = held.reduce((sum, row) => {
        const state = row.relicStates.find((item) => item.id === relic.id);
        return sum + (state?.level || 0);
      }, 0);
      output.push({
        difficulty,
        id: relic.id,
        name: relic.name,
        rarity: relic.rarity,
        runs,
        runsWith: held.length,
        pickRate: ratio(held.length, runs),
        avgLevel: held.length ? round(levelSum / held.length, 2) : null,
        winsWith,
        winRateWith,
        runsWithout: without.length,
        winRateWithout,
        lift: winRateWith != null && winRateWithout != null ? round(winRateWith - winRateWithout) : null,
      });
    }
  }
  return output.sort(
    (a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] ||
      Object.keys(RELIC_BY_ID).indexOf(a.id) - Object.keys(RELIC_BY_ID).indexOf(b.id)
  );
}

// 逐敌人：遭遇率（该类型是否在本局波次中出现）、场均数量、首现波次，
// 以及胜局/败局中的出现率。胜率差仅作相关性参考（后期敌种只在活得久的局出现）。
function enemiesBreakdown(rows) {
  const output = [];
  for (const [difficulty, list] of groupRows(rows, (row) => row.difficulty)) {
    const runs = list.length;
    const wins = list.filter((row) => row.victory);
    const losses = list.filter((row) => !row.victory);
    for (const enemy of Object.values(ENEMIES)) {
      const encountered = list.filter((row) => (row.enemyCounts?.[enemy.id] || 0) > 0);
      const without = list.filter((row) => !(row.enemyCounts?.[enemy.id] > 0));
      const winsWith = encountered.filter((row) => row.victory).length;
      const winsWithout = without.filter((row) => row.victory).length;
      const winRateWith = ratio(winsWith, encountered.length);
      const winRateWithout = ratio(winsWithout, without.length);
      const firstWaveSum = encountered.reduce(
        (sum, row) => sum + (row.enemyFirstWave?.[enemy.id] || 0),
        0
      );
      output.push({
        difficulty,
        id: enemy.id,
        name: enemy.name,
        runs,
        runsWith: encountered.length,
        encounterRate: ratio(encountered.length, runs),
        avgCount: round(
          list.reduce((sum, row) => sum + (row.enemyCounts?.[enemy.id] || 0), 0) / runs,
          2
        ),
        avgFirstWave: encountered.length ? round(firstWaveSum / encountered.length, 1) : null,
        encounterRateInWins: ratio(
          wins.filter((row) => (row.enemyCounts?.[enemy.id] || 0) > 0).length,
          wins.length
        ),
        encounterRateInLosses: ratio(
          losses.filter((row) => (row.enemyCounts?.[enemy.id] || 0) > 0).length,
          losses.length
        ),
        winsWith,
        winRateWith,
        runsWithout: without.length,
        winRateWithout,
        lift: winRateWith != null && winRateWithout != null ? round(winRateWith - winRateWithout) : null,
      });
    }
  }
  return output.sort(
    (a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] ||
      Object.keys(ENEMIES).indexOf(a.id) - Object.keys(ENEMIES).indexOf(b.id)
  );
}

function targetStatus(summary) {
  return DIFFICULTY_ORDER.map((difficulty) => {
    const row = summary.find((item) => item.difficulty === difficulty && item.meta === 'full');
    const [low, high] = BALANCE_TARGETS[difficulty];
    const rate = row ? row.winRate : null;
    const status = rate == null
      ? '无数据'
      : rate < low
        ? '低于目标'
        : rate > high
          ? '高于目标'
          : '达标';
    return { difficulty, low, high, winRate: rate == null ? null : round(rate), status };
  });
}

function formatTable(rows) {
  const header = [
    '难度', '解锁', '局数', '通关', '通关率', '平均波次', '中位', '最高',
    '平均分', '平均塔数', '平均生命', '平均余金', '平均时长',
  ];
  const lines = [header.join(' | ')];
  lines.push(header.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.meta === 'full' ? '全解锁' : '零解锁',
        row.runs,
        row.wins,
        `${(row.winRate * 100).toFixed(0)}%`,
        row.avgWave.toFixed(1),
        row.medianWave,
        row.maxWave,
        row.avgScore,
        row.avgTowers,
        row.avgHp,
        row.avgGold,
        `${Math.floor(row.avgSeconds / 60)}m${row.avgSeconds % 60}s`,
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

function formatArchetypeTable(rows) {
  const header = ['难度', '原型', '平均入口', '局数', '通关', '通关率', '平均波次', '平均生命', '平均塔数'];
  const lines = [header.join(' | ')];
  lines.push(header.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.label,
        row.avgPortals,
        row.runs,
        row.wins,
        `${(row.winRate * 100).toFixed(0)}%`,
        row.avgWave.toFixed(1),
        row.avgHp,
        row.avgTowers,
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

function formatModifierTable(rows) {
  const header = ['难度', '词缀', '局数', '通关', '通关率', '平均波次', '平均生命', '平均塔数'];
  const lines = [header.join(' | ')];
  lines.push(header.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.label,
        row.runs,
        row.wins,
        `${(row.winRate * 100).toFixed(0)}%`,
        row.avgWave.toFixed(1),
        row.avgHp,
        row.avgTowers,
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

function formatCandidateTable(rows) {
  const header = ['难度', '候选', '局数', '通关', '通关率', '平均波次', '平均生命', '平均塔数'];
  const lines = [header.join(' | ')];
  lines.push(header.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.label,
        row.runs,
        row.wins,
        `${(row.winRate * 100).toFixed(0)}%`,
        row.avgWave.toFixed(1),
        row.avgHp,
        row.avgTowers,
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

function detailLines(rows) {
  const header = '| 难度 | 解锁 | 种子 | 候选 | 原型 | 词缀 | 结果 | 波次 | 生命 | 金币 | 击杀 | 塔数 | 分数 | 模拟时长 |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map((row) =>
    [
      DIFFICULTIES[row.difficulty].name,
      row.meta ? '全解锁' : '零解锁',
      row.seed,
      row.candidateIndex + 1,
      row.archetypeName,
      row.modifierName,
      row.victory ? '通关' : row.stuck ? '超时' : '失败',
      row.wave,
      row.hp,
      row.gold,
      row.kills,
      row.towers,
      row.score,
      `${row.simSeconds}s`,
    ].join(' | ')
  );
  return [header, sep, ...lines.map((line) => `| ${line} |`)].join('\n');
}

// 上轮（V21-003 调参前）的 40 种子快照，仅用于生成前后对比，不参与本轮计算。
const PREVIOUS_RUN = {
  generatedAt: '2026-10-26T00:00:00.000Z',
  targets: { roam: [0.7, 0.85], standard: [0.25, 0.4], abyss: [0.05, 0.12] },
  rates: { roam: 0.31, standard: 0.02, abyss: 0.0 },
  multipliers: {
    roam: [0.85, 0.87, 0.96],
    standard: [1.10, 1.04, 1.01],
    abyss: [1.34, 1.12, 1.05],
  },
};

function formatPercent(value, digits = 0) {
  return value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function formatDelta(value) {
  if (value == null) return '—';
  const points = (value * 100).toFixed(0);
  return `${value >= 0 ? '+' : ''}${points}pp`;
}

function formatTargetTable(statuses) {
  const lines = ['| 难度 | 目标区间 | 本轮 | 状态 |', '| --- | --- | --- | --- |'];
  for (const row of statuses) {
    lines.push(
      `| ${DIFFICULTIES[row.difficulty].name} | ${(row.low * 100).toFixed(0)}–${(row.high * 100).toFixed(0)}% | ${formatPercent(row.winRate)} | ${row.status} |`
    );
  }
  return lines.join('\n');
}

// 固定三图 vs v1.31 随机 carve 基线（同机器人、全解锁）。
function formatBaselineTable(fixedSummary, baselineSummary) {
  const header = ['难度', 'v1.31 随机图（同机器人）', '固定三图', '差值'];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  for (const difficulty of DIFFICULTY_ORDER) {
    const fixed = fixedSummary.find((row) => row.difficulty === difficulty && row.meta === 'full');
    const baseline = baselineSummary.find(
      (row) => row.difficulty === difficulty && row.meta === 'full'
    );
    const delta =
      fixed?.winRate != null && baseline?.winRate != null
        ? fixed.winRate - baseline.winRate
        : null;
    lines.push(
      [
        DIFFICULTIES[difficulty].name,
        formatPercent(baseline?.winRate),
        formatPercent(fixed?.winRate),
        formatDelta(delta),
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

// 逐图偏差说明：目标区间来自 BALANCE_TARGETS（全解锁、机器人口径），
// 超过 5 个百分点的项单独列出，便于判断是否需要调敌人数量/金币。
function fixedMapDeviationLines(archetypeRows) {
  const lines = [];
  const misses = [];
  for (const row of archetypeRows) {
    const [low, high] = BALANCE_TARGETS[row.difficulty];
    const rate = row.winRate;
    if (rate >= low && rate <= high) continue;
    const gap = rate < low ? (low - rate) * 100 : (rate - high) * 100;
    const direction = rate < low ? '低于' : '高于';
    misses.push({
      gap,
      text: `${DIFFICULTIES[row.difficulty].name}·${row.label} ${formatPercent(rate)}（${direction}目标 ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%，${rate < low ? '-' : '+'}${gap.toFixed(0)}pp）`,
    });
  }
  if (!misses.length) {
    lines.push('- 三张固定图在全部难度均落入目标区间（全解锁、机器人口径）。');
    return lines;
  }
  lines.push(`- 未落入目标区间的项：${misses.map((item) => item.text).join('；')}。`);
  const over5 = misses.filter((item) => item.gap > 5);
  lines.push(
    over5.length
      ? `- 其中偏差超过 5 个百分点：${over5.map((item) => item.text).join('；')}。`
      : '- 偏差均在 5 个百分点以内，按任务约定不做额外调参。'
  );
  return lines;
}

function formatTowerContentTable(rows) {
  const header = ['难度', '解锁', '防御塔', '选取率', '使用局数', '平均座数', '有塔胜率', '无塔胜率', '胜率差'];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.meta === 'full' ? '全解锁' : '零解锁',
        row.name,
        formatPercent(row.pickRate),
        `${row.runsWith}/${row.runs}`,
        row.avgCount,
        formatPercent(row.winRateWith),
        formatPercent(row.winRateWithout),
        formatDelta(row.lift),
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

function formatRelicContentTable(rows) {
  const header = ['难度', '遗物', '稀有度', '选取率', '获取局数', '平均等级', '有遗物胜率', '无遗物胜率', '胜率差'];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.name,
        RARITY_NAMES[row.rarity] || row.rarity,
        formatPercent(row.pickRate),
        `${row.runsWith}/${row.runs}`,
        row.avgLevel ?? '—',
        formatPercent(row.winRateWith),
        formatPercent(row.winRateWithout),
        formatDelta(row.lift),
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

function formatEnemyContentTable(rows) {
  const header = [
    '难度', '敌人', '遭遇率', '场均数量', '平均首现波', '胜局出现率', '败局出现率',
    '有该敌胜率', '无该敌胜率', '胜率差',
  ];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  for (const row of rows) {
    lines.push(
      [
        DIFFICULTIES[row.difficulty].name,
        row.name,
        formatPercent(row.encounterRate),
        row.avgCount,
        row.avgFirstWave ?? '—',
        formatPercent(row.encounterRateInWins),
        formatPercent(row.encounterRateInLosses),
        formatPercent(row.winRateWith),
        formatPercent(row.winRateWithout),
        formatDelta(row.lift),
      ].join(' | ')
    );
  }
  return lines.join('\n');
}

const RARITY_NAMES = { common: '普通', rare: '稀有', epic: '史诗' };

function compactRun(row) {
  return {
    seed: row.seed,
    candidateIndex: row.candidateIndex,
    difficulty: row.difficulty,
    meta: row.meta,
    archetype: row.archetype,
    modifier: row.modifier,
    victory: row.victory,
    stuck: row.stuck,
    wave: row.wave,
    cleared: row.cleared,
    hp: row.hp,
    gold: row.gold,
    kills: row.kills,
    towers: row.towers,
    score: row.score,
    simSeconds: row.simSeconds,
    towerTypes: row.towerTypes,
    towerCounts: row.towerCounts,
    relicStates: row.relicStates,
    enemyCounts: row.enemyCounts,
    enemyFirstWave: row.enemyFirstWave,
  };
}

function tradeoffLines(statuses) {
  const missed = statuses.filter((row) => row.status !== '达标');
  if (!missed.length) {
    return [
      '- 三档均落入目标区间（全解锁、机器人口径），本轮无需进一步取舍。',
      '- 三档倍率、波次生成与 `BALANCE_TARGETS` 口径未动；达标来自机器人按「真人下限」使用技能 / 主海克斯 / 塔进化与肉鸽 2.0 新系统、并叠加 per-map `hpMul` 逐图补偿后的真实复测，具体取舍见「固定地图结论」。',
    ];
  }
  return [
    `- 未达标：${missed
      .map((row) => `${DIFFICULTIES[row.difficulty].name} ${formatPercent(row.winRate)}（目标 ${(row.low * 100).toFixed(0)}–${(row.high * 100).toFixed(0)}%，${row.status}）`)
      .join('；')}。`,
    '- 本轮未调整三档倍率，也未改战斗数值、波次生成、经济与计分的既有口径；以上是固定地图池 + 机器人按「真人下限」使用新系统后的真实口径。',
    '- 结构性原因与是否调参的结论见「固定地图结论」；目标区间仍按机器人口径保留，用于衡量差距。',
  ];
}

function formatMultiplierTable() {
  const lines = ['| 难度 | 倍率（生命/数量/速度） |', '| --- | --- |'];
  for (const id of DIFFICULTY_ORDER) {
    const diff = DIFFICULTIES[id];
    lines.push(`| ${diff.name} | ${diff.hpMul} / ${diff.countMul} / ${diff.speedMul} |`);
  }
  return lines.join('\n');
}

function formatChangeTable(statuses) {
  const lines = [
    '| 难度 | 上轮通关率 | 本轮通关率 | 变化 | 上轮倍率（生命/数量/速度） | 本轮倍率（生命/数量/速度） | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of statuses) {
    const id = row.difficulty;
    const previous = PREVIOUS_RUN.rates[id];
    const before = PREVIOUS_RUN.multipliers[id].join(' / ');
    const diff = DIFFICULTIES[id];
    const after = `${diff.hpMul} / ${diff.countMul} / ${diff.speedMul}`;
    lines.push(
      `| ${DIFFICULTIES[id].name} | ${formatPercent(previous)} | ${formatPercent(row.winRate)} | ${formatDelta((row.winRate ?? 0) - previous)} | ${before} | ${after} | ${row.status} |`
    );
  }
  return lines.join('\n');
}

export {
  summarize,
  summarizeBy,
  towersBreakdown,
  relicsBreakdown,
  enemiesBreakdown,
  targetStatus,
  formatTable,
  formatArchetypeTable,
  formatModifierTable,
  formatCandidateTable,
  detailLines,
  formatTargetTable,
  formatBaselineTable,
  fixedMapDeviationLines,
  formatTowerContentTable,
  formatRelicContentTable,
  formatEnemyContentTable,
  compactRun,
  tradeoffLines,
  formatMultiplierTable,
  formatChangeTable,
};
