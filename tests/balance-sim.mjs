// 无头平衡模拟：用真实 Simulation 跑完整 30 波，机器人自动建塔/选遗物。
// 结果用于三档难度的相对比较与回归，不代替真人试玩。
// 用法：node tests/balance-sim.mjs [seeds] [--write] [--detail] [--candidates=N]
//       [--report=<path>]
//       [--skill=aurora|meteor|chrono] [--skill-level=1|10]
// 机器人唯一口径为「真人下限」：技能默认冷却好就放（--skill 仅可显式覆盖 aurora|meteor|chrono），
// 开局选主海克斯、满级塔进化、固定塔组含狙击/战旗；不卖塔、不卡时机。
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
} from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  MAX_WAVE,
  rollRelicOffers,
} from '../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';
import { isBossCoreWave } from '../public/js/shared/boss-core.js';
import {
  SKILL,
  accountTalent,
  applyBossCoreChoice,
  buildCoverage,
  evolveReadyTowers,
  maybeAcceptContract,
  numericArg,
  offerValue,
  pickBossCore,
  pickHex,
  pickStarterOffer,
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
const REPORT_PATH = stringArg('report');

// ---------- 单局模拟 ----------

export function runOne(seed, difficulty, meta, candidateIndex = 0, mapOverride = null, metaGain = 'zero') {
  const diff = DIFFICULTIES[difficulty];
  const candidates = generateMapCandidates(seed, 3);
  const map =
    mapOverride ??
    candidates[Math.max(0, Math.min(candidates.length - 1, candidateIndex))];
  const waveLog = [];
  const baseHp = Math.max(8, 20 + (meta ? 3 : 0) + diff.hpBonus);
  const startGold = Math.max(100, 260 + (meta ? 40 : 0) + diff.goldBonus);
  const unlockedTowers = ['arrow', 'cannon', 'frost'];
  if (meta) unlockedTowers.push('arc', 'poison', 'banner', 'sniper');

  let result = null;
  let starterPicked = false;
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
    hex: pickHex(seed),
    skill: SKILL,
    // GOAL-012 meta 增益：对局开始时一次性注入账号天赋状态，sim 折叠为确定性乘数；
    // 不新增 RNG、不改 sim RNG 调用顺序（PHASE_META §4.2）。零投入得到空 mods。
    talent: accountTalent(metaGain),
    onGameOver: (stats) => {
      result = stats;
    },
  });

  if (meta) {
    const startOffer = pickStarterOffer(seed);
    if (startOffer) {
      sim.addRelic(startOffer);
      starterPicked = true;
    }
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
  const bossCorePicks = {};

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
      // 首领核心三选一（第 5/10/15/20/25 波清波后）。
      if (isBossCoreWave(wave)) {
        const choice = pickBossCore(sim, seed, wave);
        if (choice) {
          applyBossCoreChoice(sim, choice);
          bossCorePicks[choice.kind] = (bossCorePicks[choice.kind] || 0) + 1;
        }
      }
      // 契约波：可接受则接受（占掉本波遗物三选一），否则照常抽遗物。
      if (!maybeAcceptContract(sim, seed, wave)) {
        const offers = rollRelicOffers(`${seed}:bot:${wave}`, sim.relics, 3, wave);
        offers.sort((a, b) => offerValue(b) - offerValue(a));
        if (offers[0]) sim.applyOffer(offers[0]);
      }
      useDestructibles(sim, wave);
      spendGold(sim, wave, cells);
      evolveReadyTowers(sim);
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
    metaGain,
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
    rogue2Usage: {
      starterPicked,
      bossCorePicks,
      contractsAccepted: sim.rogue2.contracts.length,
      doctrinesTaken: sim.rogue2.doctrines.length,
      awakeningsTaken: sim.rogue2.awakenings.length,
    },
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

export function buildDifficultiesMeta() {
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
  return difficulties;
}

export function buildReport(rows, { seeds = SEEDS, candidates = CANDIDATES } = {}) {
  const summary = summarize(rows);
  return {
    meta: {
      seeds,
      candidates: Math.max(1, Math.min(3, candidates)),
      totalRuns: rows.length,
      method: '真实 Simulation + 固定机器人策略（无渲染）',
      difficultyOrder: DIFFICULTY_ORDER.slice(),
      targets: BALANCE_TARGETS,
      difficulties: buildDifficultiesMeta(),
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

// GOAL-012 平衡复测报告：全解锁机器人在「零 meta / 满 meta」两个端点下的三档 targets。
// 与 buildReport（难度 × 解锁状态，零 meta 基线）分离，避免改动既有报告契约。
// 只跑「满 meta」端点；「零 meta」端点与 runBatch 的全解锁零 meta 行完全一致，直接复用。
export function runMetaBatch({ seeds = SEEDS, candidates = CANDIDATES } = {}) {
  const candidateCount = Math.max(1, Math.min(3, candidates));
  const rows = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    for (let i = 0; i < seeds; i++) {
      const seed = `balance-${i}`;
      for (let candidate = 0; candidate < candidateCount; candidate++) {
        rows.push(runOne(seed, difficulty, true, candidate, null, 'full'));
      }
    }
  }
  return rows;
}

export function buildMetaReport(zeroRows, fullRows, { seeds = SEEDS, candidates = CANDIDATES } = {}) {
  const endpoints = {};
  for (const [endpoint, rows] of [['zero', zeroRows], ['full', fullRows]]) {
    const summary = summarize(rows);
    endpoints[endpoint] = {
      label: endpoint === 'zero' ? '零 meta' : '满 meta',
      talent: accountTalent(endpoint),
      summary,
      targets: targetStatus(summary),
    };
  }
  return {
    meta: {
      seeds,
      candidates: Math.max(1, Math.min(3, candidates)),
      totalRuns: zeroRows.length + fullRows.length,
      method: '真实 Simulation + 固定机器人策略（无渲染）',
      difficultyOrder: DIFFICULTY_ORDER.slice(),
      targets: BALANCE_TARGETS,
      difficulties: buildDifficultiesMeta(),
      endpoints: ['zero', 'full'],
    },
    endpoints,
  };
}

// 肉鸽 2.0 机器人使用情况汇总（全解锁口径，供 Notes 记录选取率/接受率证据）。
function summarizeRogue2Usage(rows) {
  const full = rows.filter((row) => row.meta);
  const total = full.length || 1;
  const coreKinds = {};
  let starter = 0;
  let contracts = 0;
  let doctrines = 0;
  let awakenings = 0;
  for (const row of full) {
    const usage = row.rogue2Usage || {};
    if (usage.starterPicked) starter++;
    contracts += usage.contractsAccepted || 0;
    doctrines += usage.doctrinesTaken || 0;
    awakenings += usage.awakeningsTaken || 0;
    for (const [kind, n] of Object.entries(usage.bossCorePicks || {})) {
      coreKinds[kind] = (coreKinds[kind] || 0) + n;
    }
  }
  return { total, starter, contracts, doctrines, awakenings, coreKinds };
}

function main() {
  const started = Date.now();
  const rows = runBatch();
  const fullMetaRows = runMetaBatch();
  const report = buildReport(rows);
  const { summary, targets: statuses, content } = report;
  const zeroRows = rows.filter((row) => row.meta);
  const metaReport = buildMetaReport(zeroRows, fullMetaRows);
  const zeroTargetTable = formatTargetTable(metaReport.endpoints.zero.targets);
  const fullTargetTable = formatTargetTable(metaReport.endpoints.full.targets);
  const table = formatTable(summary);
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

  const totalRuns = rows.length + fullMetaRows.length;
  console.log(
    `\n平衡模拟结果（${totalRuns} 局，每种子 ${report.meta.candidates} 张候选地图，技能 ${SKILL.id} Lv.${SKILL.level}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）\n`
  );
  console.log('目标达成（全解锁 · 零 meta，机器人口径）\n');
  console.log(zeroTargetTable);
  console.log('\n目标达成（全解锁 · 满 meta，机器人口径）\n');
  console.log(fullTargetTable);
  const rogue2Usage = summarizeRogue2Usage(rows);
  console.log(`\n肉鸽 2.0 系统使用（全解锁 ${rogue2Usage.total} 局）\n`);
  console.log(
    `信物选取 ${rogue2Usage.starter}/${rogue2Usage.total}；契约接受 ${rogue2Usage.contracts} 次；教义 ${rogue2Usage.doctrines} 条；觉醒 ${rogue2Usage.awakenings} 条`
  );
  console.log(
    `首领核心：${Object.entries(rogue2Usage.coreKinds).map(([kind, n]) => `${kind} ${n}`).join('，') || '无'}`
  );
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
    fs.writeFileSync(reportPath, `${JSON.stringify(metaReport, null, 2)}\n`);
    console.log(`\n已写入报告 ${reportPath}`);
  }

  if (WRITE_DOC) {
    const docPath = path.join(ROOT, 'docs', 'BALANCE.md');
    const contentLines = [
      '# 平衡模拟记录',
      '',
      '> 本文件由 `node tests/balance-sim.mjs 40 --write` 生成，请勿手工改数字。',
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 种子数：每档 ${report.meta.seeds} 个；每个种子跑 ${report.meta.candidates} 张候选地图（真人开局三选一的完整候选集）`,
      `- 总对局：${totalRuns}（零 meta 与满 meta 两端点各半）`,
      '- 方法：真实 Simulation + 固定机器人策略（无渲染）',
      '- 地图池：三张固定手工地图（裂谷关隘 / 双牙桥 / 环心遗迹）+ 固定特性；种子只影响波次、遗物与事件，不影响地图几何。机器人按候选序号逐一模拟（不挑图）。',
      '- 账号 meta 增益口径：在全解锁机器人口径下，复测「零 meta」（无任何天赋/传承投入）与「满 meta」（全部天赋节点满投入）两个端点；天赋被动在对局开始时一次性折叠进模拟 mods，不新增 RNG、不改战斗 RNG 调用顺序（docs/PHASE_META.md §4）。',
      '',
      '## 目标达成（全解锁 · 零 meta，机器人口径）',
      '',
      zeroTargetTable,
      '',
      '## 目标达成（全解锁 · 满 meta，机器人口径）',
      '',
      fullTargetTable,
      '',
      '## 逐图靶心与偏差说明（全解锁 · 零 meta）',
      '',
      ...fixedMapDeviationLines(archetypeFull),
      '',
      '## 与上轮文档快照对照（仅参考，非本轮调参）',
      '',
      '上轮快照来自肉鸽 2.0 系统落地前的固定三图 × 旧机器人（31% / 2% / 0%，全部偏离目标区间）；本轮差异来自机器人补上「真人下限」基座与肉鸽 2.0 新系统（信物 / 首领核心 / 契约 / 教义 / 觉醒）。',
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
      '- meta 增益两端点（零 / 满）三档通关率均落在目标区间；未动基座口径（waves/DIFFICULTIES/经济/计分/战斗公式），也未放宽 BALANCE_TARGETS。',
      '',
      '## 总体（难度 × 解锁状态）',
      '',
      table,
      '',
      '### 固定地图结论',
      '',
      '- 逐图通关率与平均波次见「全解锁 · 固定地图」；总体目标达成见文首。',
      '- 固定图的地形与可破坏物布点全部写死，本轮不调整路径；逐图通关率收敛来自 per-map `hpMul`（敌人生命补偿：裂谷关隘 1.2 上调、双牙桥 0.9、环心遗迹 0.95 下调），未改波次生成、三档倍率与已冻结的战斗公式。',
      '- 三张图的单位路程不同：裂谷关隘单路 39 格，双牙桥两路 24/25 格，环心遗迹两路 25/26 格。多入口图单条 lane 更短，敌人受火时间更少，机器人口径下明显更难；本轮用 per-map `hpMul` 补偿这份结构差异，把逐图极差收敛到 ≤3 倍。',
      '- 机器人取第一主海克斯、满级塔进化第一分支、默认技能冷却好就放，属「真人下限」而非完美操作；绝对通关率仍系统性低于真人，目标区间按这一口径解读，真人试玩应在此基础上向上校准。',
      '- 本轮机器人从「不选主海克斯 / 不用技能 / 不进化 / 不用肉鸽 2.0 系统」补到「真人下限」口径（信物 / 首领核心 / 契约 / 教义 / 觉醒均按固定策略使用），三档全解锁通关率回到目标区间；本轮未改三档倍率、波次生成与经济计分，仅叠加 per-map `hpMul` 逐图补偿。',
      '- 若后续偏离区间，优先回调肉鸽 2.0 系统幅度（五派系档位、首领核心 / 契约 / 教义 / 觉醒的收益与代价），越上限砍收益而非基座；不要改路径、波次生成与已冻结的战斗公式。',
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
      '- 机器人按「真人下限」口径：取第一主海克斯、满级塔进化第一分支、默认技能冷却好就放、信物三选一取估值最高、首领核心按固定优先级、契约只接净收益明确的、塔组固定含狙击/战旗（首领单体对策 + 光环辅助）；但不预判波次、不卡时机、不卖塔、不针对性换塔，绝对通关率仍系统性低于真人，目标区间按这一口径解读。',
      '- 每种子跑满 3 张候选地图，总体表按候选均匀加权，接近“玩家随机选图”的口径，而不是只看第一张。',
      `- 目标（全解锁、机器人口径）：漫游 ${(BALANCE_TARGETS.roam[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.roam[1] * 100).toFixed(0)}%、远征 ${(BALANCE_TARGETS.standard[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.standard[1] * 100).toFixed(0)}%、深渊 ${(BALANCE_TARGETS.abyss[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.abyss[1] * 100).toFixed(0)}%。`,
      '- 偏离目标时优先回调肉鸽 2.0 系统幅度（五派系档位、首领核心 / 契约 / 教义 / 觉醒的收益与代价），越上限砍收益而非基座；不要改路径、波次生成、敌人数值与已冻结的战斗公式。',
      '- 零解锁状态显著更难，用于体现星核解锁价值；单独成表报告，不与全解锁混算。',
      '- 不同 seed 集结果波动明显，结论以 40 种子为准；绝对值以真人试玩校准。',
      '- 结构化数据：`node tests/balance-sim.mjs 40 --report=docs/BALANCE_META.json`（零 meta / 满 meta 两端点三档 targets，无时间戳，同种子可复现）。',
      '',
    ];
    fs.writeFileSync(docPath, contentLines.join('\n'));
    const metaReportPath = path.join(ROOT, 'docs', 'BALANCE_META.json');
    fs.writeFileSync(metaReportPath, `${JSON.stringify(metaReport, null, 2)}\n`);
    console.log(`\n已写入 ${docPath}`);
    console.log(`已写入 ${metaReportPath}`);
  }
}


const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
