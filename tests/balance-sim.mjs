// 无头平衡模拟：用真实 Simulation 跑完整 30 波，机器人自动建塔/选遗物。
// 结果用于三档难度的相对比较与回归，不代替真人试玩。
// 用法：node tests/balance-sim.mjs [seeds] [--write] [--detail] [--candidates=N]
//       [--report=<path>]
//       [--baseline]（额外跑 v1.31 随机 carve 对照，不进入固定图汇总）
//       [--skill=none|aurora|meteor|chrono] [--skill-level=1|10]
// 机器人技能策略固定为“冷却好就用”，默认 --skill=none 保持旧基线。
//
// 每个种子默认跑 3 张候选地图（与真人开局三选一一致），并按地图原型/词缀/候选序号
// 分别统计，避免只看 candidate 0 造成的抽样偏差。另按塔 / 遗物 / 敌人类型分解
// 出现率与胜率贡献；--report 输出结构化 JSON（无时间戳，同种子可复现）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import {
  ARCHETYPES,
  generateMapCandidates,
  legacyGenerateMap,
} from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  MAX_WAVE,
  rollRelicOffers,
} from '../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';
import {
  SKILL,
  buildCoverage,
  numericArg,
  offerValue,
  resolveBotEvent,
  spendGold,
  stringArg,
  useDestructibles,
} from './lib/balance-bot.mjs';
import {
  compactRun,
  detailLines,
  enemiesBreakdown,
  fixedMapDeviationLines,
  formatArchetypeTable,
  formatBaselineTable,
  formatCandidateTable,
  formatChangeTable,
  formatEnemyContentTable,
  formatModifierTable,
  formatMultiplierTable,
  formatRelicContentTable,
  formatTable,
  formatTargetTable,
  formatTowerContentTable,
  relicsBreakdown,
  summarize,
  summarizeBy,
  targetStatus,
  towersBreakdown,
  tradeoffLines,
} from './lib/balance-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STEP = 1 / 60;
const MAX_WAVE_SECONDS = 180;
const MAX_SIM_STEPS_PER_WAVE = Math.ceil(MAX_WAVE_SECONDS / STEP);

const SEEDS = Math.max(1, Number(process.argv[2]) || 6);
const CANDIDATES = Math.min(3, numericArg('candidates', 3));
const WRITE_DOC = process.argv.includes('--write');
const DETAIL = process.argv.includes('--detail');
// --baseline：额外跑一遍 v1.31 随机 carve 地图（同机器人），用于固定图对照。
const BASELINE = process.argv.includes('--baseline');
const REPORT_PATH = stringArg('report');

// ---------- 单局模拟 ----------

export function runOne(seed, difficulty, meta, candidateIndex = 0, mapOverride = null) {
  const diff = DIFFICULTIES[difficulty];
  const candidates = generateMapCandidates(seed, 3);
  const map =
    mapOverride ??
    candidates[Math.max(0, Math.min(candidates.length - 1, candidateIndex))];
  const waveLog = [];
  const baseHp = Math.max(8, 20 + (meta ? 3 : 0) + diff.hpBonus);
  const startGold = Math.max(100, 260 + (meta ? 40 : 0) + diff.goldBonus);
  const unlockedTowers = ['arrow', 'cannon', 'frost'];
  if (meta) unlockedTowers.push('arc', 'poison');

  let result = null;
  const sim = new Simulation({
    map,
    seed,
    difficulty,
    mode: 'normal',
    gold: startGold,
    baseHp,
    maxBaseHp: baseHp,
    relics: [],
    towers: [],
    unlockedTowers,
    skill: SKILL,
    onGameOver: (stats) => {
      result = stats;
    },
  });

  if (meta) {
    const startOffer = rollRelicOffers(`${seed}:start:bot`, [], 1, 1)
      .find((offer) => offer.kind === 'relic');
    if (startOffer) sim.addRelic(startOffer);
  }

  const cells = buildCoverage(map, sim);
  // 逐内容追踪：每个敌人类型的出场数量/首现波次（来自波次定义，确定性）。
  const enemyCounts = {};
  const enemyFirstWave = {};
  // 机器人必须先完成开局整备，再进入第 1 波；否则把"空手接第一波"误当成游戏难度。
  // 固定图有可破坏物：开局先按策略拆一遍，再花钱建塔（与真人“先清场再布防”一致）。
  useDestructibles(sim, 1);
  spendGold(sim, 1, cells);
  let stuck = false;
  let lastWave = 0;

  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const waveDef = generateWave(seed, wave, difficulty, map.meta);
    lastWave = wave;
    for (const group of waveDef.groups || []) {
      const type = group.type;
      if (!type) continue;
      enemyCounts[type] = (enemyCounts[type] || 0) + (group.count || 0);
      if (enemyFirstWave[type] == null) enemyFirstWave[type] = wave;
    }
    sim.beginWave(waveDef);

    let steps = 0;
    while (sim.phase === 'wave' && steps < MAX_SIM_STEPS_PER_WAVE) {
      sim.update(STEP);
      // 固定策略：冷却好且场上有敌人就释放（先 update 保证首帧已刷怪）。
      if (sim.skill && sim.skill.cooldown <= 0 && sim.enemies.length > 0) sim.castSkill();
      steps++;
    }

    // 第 5/10/15/20/25 波清完进入事件阶段：先结算事件，再按 prep 继续抽遗物/花钱。
    if (sim.phase === 'event') {
      const resolved = resolveBotEvent(sim);
      if (!resolved.ok) {
        stuck = true;
        waveLog.push({
          wave,
          hp: Math.max(0, Math.ceil(sim.baseHp)),
          gold: Math.floor(sim.gold),
          towers: sim.towers.length,
          count: waveDef.totalCount,
          seconds: Math.round(sim.time),
          stuck: true,
        });
        break;
      }
    }

    if (sim.phase === 'over') {
      waveLog.push({
        wave,
        hp: Math.max(0, Math.ceil(sim.baseHp)),
        gold: Math.floor(sim.gold),
        towers: sim.towers.length,
        count: waveDef.totalCount,
        seconds: Math.round(sim.time),
      });
      break;
    }

    if (sim.phase === 'prep') {
      const offers = rollRelicOffers(`${seed}:bot:${wave}`, sim.relics, 3, wave);
      offers.sort((a, b) => offerValue(b) - offerValue(a));
      if (offers[0]) sim.applyOffer(offers[0]);
      useDestructibles(sim, wave);
      spendGold(sim, wave, cells);
      waveLog.push({
        wave,
        hp: Math.max(0, Math.ceil(sim.baseHp)),
        gold: Math.floor(sim.gold),
        towers: sim.towers.length,
        count: waveDef.totalCount,
        seconds: Math.round(sim.time),
      });
      continue;
    }

    // 超时未清波：首领或高血量单位卡住，视为本局失败。
    stuck = true;
    waveLog.push({
      wave,
      hp: Math.max(0, Math.ceil(sim.baseHp)),
      gold: Math.floor(sim.gold),
      towers: sim.towers.length,
      count: waveDef.totalCount,
      seconds: Math.round(sim.time),
      stuck: true,
    });
    break;
  }

  const stats = result || {
    wave: lastWave,
    victory: false,
    score: 0,
  };

  return {
    seed,
    candidateIndex: map.index ?? candidateIndex,
    archetype: map.archetype,
    archetypeName: map.archetypeName || ARCHETYPES[map.archetype]?.name || map.archetype,
    modifier: map.modifier?.id || 'none',
    modifierName: map.modifier?.name || '无',
    portalCount: map.meta?.portalCount || map.lanes?.length || 1,
    scoreMul: map.meta?.scoreMul || 1,
    difficulty,
    meta,
    victory: !!stats.victory,
    stuck,
    wave: stats.wave,
    cleared: stats.victory ? MAX_WAVE : Math.max(0, lastWave - 1),
    hp: Math.max(0, Math.ceil(sim.baseHp)),
    gold: Math.floor(sim.gold),
    kills: sim.kills,
    towers: sim.towers.length,
    score: stats.score || 0,
    simSeconds: Math.round(sim.time),
    // 逐内容口径：最终持有的塔类型 / 遗物 ID / 面对过的敌人数量与首现波次。
    towerTypes: [...new Set(sim.towers.map((tower) => tower.type))].sort(),
    towerCounts: sim.towers.reduce((counts, tower) => {
      counts[tower.type] = (counts[tower.type] || 0) + 1;
      return counts;
    }, {}),
    relicStates: sim.relics
      .map((relic) => ({ id: relic.id, level: relic.level }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    enemyCounts,
    enemyFirstWave,
    waveLog,
  };
}

// 固定口径：40 种子 × 3 候选 × 3 难度 × 2 解锁状态；种子跨难度配对。
export function runBatch({ seeds = SEEDS, candidates = CANDIDATES } = {}) {
  const candidateCount = Math.max(1, Math.min(3, candidates));
  const rows = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const meta of [false, true]) {
      for (let i = 0; i < seeds; i++) {
        const seed = `balance-${i}`;
        for (let candidate = 0; candidate < candidateCount; candidate++) {
          rows.push(runOne(seed, difficulty, meta, candidate));
        }
      }
    }
  }
  return rows;
}

// v1.31 随机 carve 基线：每个种子抽一张 legacy 随机图，机器人与固定图完全同策略。
// 只用于「固定图 vs 随机图」对照，不进入固定图汇总（避免污染逐图/逐词缀统计）。
export function runLegacyBaseline({ seeds = SEEDS } = {}) {
  const rows = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const meta of [false, true]) {
      for (let i = 0; i < seeds; i++) {
        const seed = `balance-${i}`;
        rows.push(runOne(seed, difficulty, meta, 0, legacyGenerateMap(seed)));
      }
    }
  }
  return rows;
}

export function buildReport(rows, { seeds = SEEDS, candidates = CANDIDATES } = {}) {
  const summary = summarize(rows);
  const difficulties = {};
  for (const id of DIFFICULTY_ORDER) {
    const diff = DIFFICULTIES[id];
    difficulties[id] = {
      name: diff.name,
      hpMul: diff.hpMul,
      countMul: diff.countMul,
      speedMul: diff.speedMul,
      goldBonus: diff.goldBonus,
      hpBonus: diff.hpBonus,
    };
  }
  return {
    meta: {
      seeds,
      candidates: Math.max(1, Math.min(3, candidates)),
      totalRuns: rows.length,
      method: '真实 Simulation + 固定机器人策略（无渲染）',
      difficultyOrder: DIFFICULTY_ORDER.slice(),
      targets: BALANCE_TARGETS,
      difficulties,
    },
    summary,
    targets: targetStatus(summary),
    content: {
      towers: towersBreakdown(rows),
      relics: relicsBreakdown(rows),
      enemies: enemiesBreakdown(rows),
    },
    runs: rows.map(compactRun),
  };
}

function main() {
  const started = Date.now();
  const rows = runBatch();
  const report = buildReport(rows);
  const { summary, targets: statuses, content } = report;
  const table = formatTable(summary);
  const targetTable = formatTargetTable(statuses);
  const towerTable = formatTowerContentTable(content.towers);
  const relicTable = formatRelicContentTable(content.relics);
  const enemyTable = formatEnemyContentTable(content.enemies);

  const fullRows = rows.filter((row) => row.meta);
  const baseRows = rows.filter((row) => !row.meta);
  const archetypeFull = summarizeBy(fullRows, 'archetype');
  const modifierFull = summarizeBy(fullRows, 'modifier');
  const candidateFull = summarizeBy(fullRows, 'candidate');
  const archetypeBase = summarizeBy(baseRows, 'archetype');
  const modifierBase = summarizeBy(baseRows, 'modifier');
  const archetypeTable = formatArchetypeTable(archetypeFull);
  const modifierTable = formatModifierTable(modifierFull);
  const candidateTable = formatCandidateTable(candidateFull);
  const archetypeBaseTable = formatArchetypeTable(archetypeBase);
  const modifierBaseTable = formatModifierTable(modifierBase);

  // v1.31 随机 carve 对照（可选）：同一机器人、同一 seed 集，每 seed 一张 legacy 随机图。
  const baselineRows = BASELINE ? runLegacyBaseline({ seeds: report.meta.seeds }) : null;
  const baselineTable = baselineRows
    ? formatBaselineTable(summary, summarize(baselineRows))
    : null;

  console.log(
    `\n平衡模拟结果（${rows.length} 局，每种子 ${report.meta.candidates} 张候选地图，技能 ${
      SKILL ? `${SKILL.id} Lv.${SKILL.level}` : '无'
    }，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）\n`
  );
  console.log('目标达成（全解锁、机器人口径）\n');
  console.log(targetTable);
  if (baselineTable) {
    console.log('\n固定三图 vs v1.31 随机 carve 基线（全解锁、同一机器人）\n');
    console.log(baselineTable);
  }
  console.log('');
  console.log(table);
  console.log('\n逐塔（选取率 / 胜率贡献）\n');
  console.log(towerTable);
  console.log('\n逐遗物（全解锁，选取率 / 胜率贡献）\n');
  console.log(relicTable);
  console.log('\n逐敌人（遭遇率 / 胜败局分布）\n');
  console.log(enemyTable);
  console.log('\n全解锁 · 固定地图\n');
  console.log(archetypeTable);
  console.log('\n全解锁 · 固定特性\n');
  console.log(modifierTable);
  console.log('\n全解锁 · 候选序号\n');
  console.log(candidateTable);
  console.log('\n提示：机器人只用于相对比较；绝对通关率以真人试玩为准。');

  // 分难度明细（便于观察哪一波开始崩）
  for (const difficulty of DIFFICULTY_ORDER) {
    const list = rows.filter((row) => row.difficulty === difficulty && row.meta);
    const waves = list.map((row) => row.wave);
    console.log(
      `${DIFFICULTIES[difficulty].name}（全解锁）波次分布：${waves.join(', ')}`
    );
  }

  if (DETAIL) {
    for (const difficulty of ['standard', 'abyss']) {
      const row = rows.find((item) => item.difficulty === difficulty && item.meta);
      if (!row) continue;
      console.log(
        `\n明细 · ${DIFFICULTIES[difficulty].name} · ${row.seed} · 候选 ${row.candidateIndex + 1} · ${row.archetypeName} / ${row.modifierName} · ${
          row.victory ? '通关' : row.stuck ? '卡死/超时' : '失败'
        }`
      );
      console.log('波次 | 生命 | 金币 | 塔数 | 敌人 | 累计秒');
      for (const log of row.waveLog) {
        console.log(
          `${log.wave} | ${log.hp} | ${log.gold} | ${log.towers} | ${log.count} | ${log.seconds}${
            log.stuck ? ' | 超时' : ''
          }`
        );
      }
    }
  }

  if (REPORT_PATH) {
    const reportPath = path.resolve(ROOT, REPORT_PATH);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n已写入报告 ${reportPath}`);
  }

  if (WRITE_DOC) {
    const docPath = path.join(ROOT, 'docs', 'BALANCE.md');
    const contentLines = [
      '# 平衡模拟记录',
      '',
      '> 本文件由 `node tests/balance-sim.mjs 40 --write --baseline` 生成，请勿手工改数字。',
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 种子数：每档 ${report.meta.seeds} 个；每个种子跑 ${report.meta.candidates} 张候选地图（真人开局三选一的完整候选集）`,
      `- 总对局：${rows.length}`,
      '- 方法：真实 Simulation + 固定机器人策略（无渲染）',
      '- 地图池：三张固定手工地图（裂谷关隘 / 双牙桥 / 环心遗迹）+ 固定特性；种子只影响波次、遗物与事件，不影响地图几何。机器人按候选序号逐一模拟（不挑图）。',
      '',
      '## 目标达成（全解锁、机器人口径）',
      '',
      targetTable,
      '',
      ...(baselineTable
        ? [
            '## 固定三图 vs v1.31 随机 carve 基线',
            '',
            '同一机器人、同一种子集：v1.31 基线每个种子抽一张 `legacyGenerateMap` 随机图，固定图固定跑三张候选。',
            '',
            baselineTable,
            '',
          ]
        : []),
      '## 逐图靶心与偏差说明（全解锁）',
      '',
      ...fixedMapDeviationLines(archetypeFull),
      '',
      '## 与上轮文档快照对照（仅参考，非本轮调参）',
      '',
      '上轮快照来自 v1.8 文档（随机 carve + 未结算事件的旧机器人）；本轮差异主要来自地图池切换与机器人修正。',
      '',
      formatChangeTable(statuses),
      '',
      '本轮三档倍率（未调整）：',
      '',
      formatMultiplierTable(),
      '',
      '### 结论与取舍',
      '',
      ...tradeoffLines(statuses),
      '',
      '## 总体（难度 × 解锁状态）',
      '',
      table,
      '',
      '### 固定地图结论',
      '',
      '- 逐图通关率与平均波次见「全解锁 · 固定地图」；总体目标达成见文首。',
      '- 固定图的地形与可破坏物布点全部写死，本轮不调整路径；偏差优先用敌人数量/金币解释，未改任何战斗公式。',
      '- 三张图的单位路程不同：裂谷关隘单路 39 格，双牙桥两路 24/25 格，环心遗迹两路 25/26 格。多入口图单条 lane 更短，敌人受火时间更少，机器人口径下明显更难；这是地图结构差异，不是数值回归。',
      '- 机器人不选主海克斯、不做分支进化、不主动用技能，绝对通关率系统性低于真人；目标区间按这一口径解读，真人试玩应在此基础上向上校准。',
      '- 调参评估（机器人口径、20 种子抽样）：单径峡谷漫游已接近区间；双牙桥/环心遗迹要把敌人数量乘到约 0.55 才能让漫游回到 70% 附近，但远征仍只有 10%/0%；乘 0.4 并追加开局金币 +200 后，远征仍只有 20%/20%、深渊 20%/0%。继续压低会让漫游图失去防守压力，因此本轮不落地数值改动，按任务约定记录偏差。',
      '- 若后续要把某张图单独拉回区间，优先调该图固定特性或敌人数量/开局金币；不要改路径，也不要改已冻结的战斗公式。',
      '',
      '## 逐塔（选取率 / 胜率贡献）',
      '',
      '选取率 = 建过该塔的局数占比；胜率差 = 有该塔局胜率 - 无该塔局胜率（相关性，不是因果）。',
      '',
      towerTable,
      '',
      '## 逐遗物（全解锁，选取率 / 胜率贡献）',
      '',
      '零解锁没有遗物抽取，因此只统计全解锁局。机器人按固定策略选遗物，选取率接近“该遗物被机器人选中的频率”。',
      '',
      relicTable,
      '',
      '## 逐敌人（遭遇率 / 胜败局分布）',
      '',
      '遭遇率 = 本局波次定义中出现该敌人的比例；胜率差受“活得越久见到越多”影响，只作相关性参考。',
      '',
      enemyTable,
      '',
      '## 全解锁 · 固定地图（每张图三档难度）',
      '',
      archetypeTable,
      '',
      '## 全解锁 · 固定特性',
      '',
      modifierTable,
      '',
      '## 全解锁 · 候选序号',
      '',
      '同名种子下三张候选的难度差异；用于确认“只看 candidate 0”是否会带来抽样偏差。',
      '',
      candidateTable,
      '',
      '## 零解锁 · 固定地图',
      '',
      archetypeBaseTable,
      '',
      '## 零解锁 · 固定特性',
      '',
      modifierBaseTable,
      '',
      '## 明细',
      '',
      detailLines(rows),
      '',
      '## 说明',
      '',
      '- 机器人不等同真人：它不会针对性换塔，也不会手动卖塔，通关率仅用于相对比较。',
      '- 机器人固定策略：第 1 波前完成开局整备、18 塔上限、固定建塔顺序、不卖塔/不针对性换塔；因此不能把机器人通关率当真人通关率。',
      '- 机器人会结算事件波（按期望收益选可负担的最高价值选项），并按固定策略拆除固定图上的可破坏物：补给箱必拆、金脉/图腾留出缓冲后拆、石碑中后期拆、虫巢不拆（会刷 6 只噬虫）。',
      '- 机器人不选主海克斯、不做分支进化、不主动使用技能，因此绝对通关率系统性低于真人；历史目标区间也是在这一口径下校准的。',
      '- 每种子跑满 3 张候选地图，总体表按候选均匀加权，接近“玩家随机选图”的口径，而不是只看第一张。',
      `- 目标（全解锁、机器人口径）：漫游 ${(BALANCE_TARGETS.roam[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.roam[1] * 100).toFixed(0)}%、远征 ${(BALANCE_TARGETS.standard[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.standard[1] * 100).toFixed(0)}%、深渊 ${(BALANCE_TARGETS.abyss[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.abyss[1] * 100).toFixed(0)}%。`,
      '- 偏离目标时优先调敌人数量/金币（`DIFFICULTIES` 倍率或固定图特性数值），其次调 `shared/config.js` 的波次/经济；不要改路径与已冻结的战斗公式。',
      '- 零解锁状态显著更难，用于体现星核解锁价值；单独成表报告，不与全解锁混算。',
      '- 不同 seed 集结果波动明显，结论以 40 种子为准；绝对值以真人试玩校准。',
      '- 结构化数据：`node tests/balance-sim.mjs 40 --report=reports/balance.json`（无时间戳，同种子可复现）。',
      '- 固定图 vs 随机图对照：`node tests/balance-sim.mjs 40 --baseline`（额外跑 v1.31 `legacyGenerateMap` 随机图，不写入固定图汇总）。',
      '',
    ];
    fs.writeFileSync(docPath, contentLines.join('\n'));
    console.log(`\n已写入 ${docPath}`);
  }
}


const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
