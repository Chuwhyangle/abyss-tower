// 无头平衡模拟：用真实 Simulation 跑完整 30 波，机器人自动建塔/选遗物。
// 结果用于三档难度的相对比较与回归，不代替真人试玩。
// 用法：node tests/balance-sim.mjs [seeds] [--write] [--detail] [--candidates=N]
//       [--report=<path>]
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
  MODIFIER_BY_ID,
  generateMapCandidates,
} from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  ENEMIES,
  MAX_WAVE,
  RELIC_BY_ID,
  SKILLS,
  TOWERS,
  relicModsAtLevel,
  rollRelicOffers,
} from '../public/js/shared/data.js';
import { effectBalanceWeight, getEffect } from '../public/js/shared/effects.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STEP = 1 / 60;
const MAX_WAVE_SECONDS = 180;
const MAX_SIM_STEPS_PER_WAVE = Math.ceil(MAX_WAVE_SECONDS / STEP);

function numericArg(flag, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${flag}=`));
  const value = Number(raw ? raw.slice(flag.length + 3) : NaN);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// 同时支持 `--flag=value` 与 `--flag value`。
function stringArg(flag, fallback = null) {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${flag}` && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      return argv[i + 1];
    }
    if (argv[i].startsWith(`--${flag}=`)) return argv[i].slice(flag.length + 3);
  }
  return fallback;
}

const SEEDS = Math.max(1, Number(process.argv[2]) || 6);
const CANDIDATES = Math.min(3, numericArg('candidates', 3));
const WRITE_DOC = process.argv.includes('--write');
const DETAIL = process.argv.includes('--detail');
const REPORT_PATH = stringArg('report');
const SKILL_ID = stringArg('skill', 'none');
const SKILL_LEVEL = Math.max(1, Math.min(10, numericArg('skill-level', 1)));
if (SKILL_ID !== 'none' && !SKILLS[SKILL_ID]) {
  console.error(`未知技能：${SKILL_ID}（可选 none / ${Object.keys(SKILLS).join(' / ')}）`);
  process.exit(1);
}
const SKILL = SKILL_ID === 'none' ? null : { id: SKILL_ID, level: SKILL_LEVEL };

// ---------- 机器人策略 ----------

// 权重来自效果注册表；未注册的键直接报错，避免机器人静默忽略新效果。
function modsValue(mods = {}) {
  let value = 0;
  for (const [key, raw] of Object.entries(mods)) {
    getEffect(key);
    const weight = effectBalanceWeight(key);
    if (key === 'dmg') {
      for (const amount of Object.values(raw)) value += amount * weight;
    } else if (typeof raw === 'number') {
      value += raw * weight;
    }
  }
  return value;
}

function offerValue(offer) {
  if (offer.kind === 'relic') {
    const after = relicModsAtLevel(offer.id, offer.toLevel);
    const before = offer.fromLevel ? relicModsAtLevel(offer.id, offer.fromLevel) : {};
    return modsValue(after) - modsValue(before);
  }
  if (offer.kind === 'gold') return offer.amount * 0.06;
  if (offer.kind === 'repair') return offer.amount * 12;
  return 0;
}

// 按 lane 采样路径点：每条 lane 都从入口采到基地（含终点），保证多入口地图的
// 覆盖评分不会漏掉任何一路。返回的 lane 字段用于校验/调试。
export function sampleLanePoints(sim, step = 0.5) {
  const samples = [];
  sim.lanes.forEach((lane, laneIndex) => {
    const count = Math.max(1, Math.ceil(lane.len / step));
    for (let i = 0; i <= count; i++) {
      const d = Math.min(lane.len, i * step);
      const pos = sim.posAt(d, laneIndex);
      samples.push({ x: pos.x, y: pos.y, lane: laneIndex });
    }
  });
  return samples;
}

function buildCoverage(map, sim) {
  const samples = sampleLanePoints(sim);

  const cells = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (!map.buildable[r][c]) continue;
      let coverage = 0;
      for (const sample of samples) {
        const dx = sample.x - (c + 0.5);
        const dy = sample.y - (r + 0.5);
        if (dx * dx + dy * dy <= 3.1 * 3.1) coverage++;
      }
      if (coverage > 3) cells.push({ c, r, coverage });
    }
  }
  cells.sort((a, b) => b.coverage - a.coverage);
  return cells;
}

function desiredType(sim, wave) {
  const counts = {};
  for (const tower of sim.towers) counts[tower.type] = (counts[tower.type] || 0) + 1;
  const total = sim.towers.length;
  const unlocked = sim.unlockedTowers;

  if (total < 2) return 'arrow';
  if (wave >= 2 && (counts.cannon || 0) < Math.ceil(total * 0.3)) return 'cannon';
  if (wave >= 3 && (counts.frost || 0) < Math.ceil(total * 0.18)) return 'frost';
  if (wave >= 8 && unlocked.includes('poison') && (counts.poison || 0) < Math.ceil(total * 0.2)) {
    return 'poison';
  }
  if (wave >= 6 && unlocked.includes('arc') && (counts.arc || 0) < Math.ceil(total * 0.2)) {
    return 'arc';
  }
  return 'arrow';
}

function spendGold(sim, wave, cells) {
  const targetTowers = Math.min(18, 4 + wave);

  for (let guard = 0; guard < 24 && sim.towers.length < targetTowers; guard++) {
    let type = desiredType(sim, wave);
    if (!sim.unlockedTowers.includes(type)) type = 'arrow';
    const cost = sim.towerCost(type);
    if (sim.gold < cost + 15) break;
    const cell = cells.find((entry) => sim.canBuild(entry.c, entry.r));
    if (!cell) break;
    if (!sim.placeTower(type, cell.c, cell.r)) break;
  }

  for (let guard = 0; guard < 40; guard++) {
    const options = sim.towers
      .filter((tower) => sim.upgradeCost(tower) != null)
      .map((tower) => ({ tower, cost: sim.upgradeCost(tower), level: tower.level }))
      .filter((option) => sim.gold >= option.cost + 40)
      .sort((a, b) => a.level - b.level || a.cost - b.cost);
    if (!options.length) break;
    // 塔数量不足时优先铺塔，金币富余再升级
    if (sim.towers.length < targetTowers && sim.gold < 240) break;
    sim.upgradeTower(options[0].tower);
  }
}

// ---------- 单局模拟 ----------

function runOne(seed, difficulty, meta, candidateIndex = 0) {
  const diff = DIFFICULTIES[difficulty];
  const candidates = generateMapCandidates(seed, 3);
  const map = candidates[Math.max(0, Math.min(candidates.length - 1, candidateIndex))];
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
  generatedAt: '2026-10-23T06:06:20.997Z',
  targets: { roam: [0.8, 0.9], standard: [0.25, 0.35], abyss: [0.05, 0.15] },
  rates: { roam: 0.94, standard: 0.48, abyss: 0.15 },
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

function tradeoffLines(statuses) {
  const missed = statuses.filter((row) => row.status !== '达标');
  if (!missed.length) {
    return [
      '- 三档均落入目标区间（全解锁、机器人口径），本轮无需进一步取舍。',
      '- 调参只改三档 `hpMul` / `countMul` / `speedMul`，未改战斗规则、内容定义与机器人策略。',
    ];
  }
  return [
    `- 未达标：${missed
      .map((row) => `${DIFFICULTIES[row.difficulty].name} ${formatPercent(row.winRate)}（目标 ${(row.low * 100).toFixed(0)}–${(row.high * 100).toFixed(0)}%，${row.status}）`)
      .join('；')}。`,
    '- 取舍：三档共用同一条 30 波曲线，压低整体难度会让深渊同步变简单；本轮优先保证漫游/远征落入区间，深渊允许落在区间边缘并记录偏差，留待真人试玩与下一轮单独调首领/后期预算。',
    '- 调参只改三档 `hpMul` / `countMul` / `speedMul`，未改战斗规则、内容定义与机器人策略。',
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

  console.log(
    `\n平衡模拟结果（${rows.length} 局，每种子 ${report.meta.candidates} 张候选地图，技能 ${
      SKILL ? `${SKILL.id} Lv.${SKILL.level}` : '无'
    }，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）\n`
  );
  console.log('目标达成（全解锁、机器人口径）\n');
  console.log(targetTable);
  console.log('');
  console.log(table);
  console.log('\n逐塔（选取率 / 胜率贡献）\n');
  console.log(towerTable);
  console.log('\n逐遗物（全解锁，选取率 / 胜率贡献）\n');
  console.log(relicTable);
  console.log('\n逐敌人（遭遇率 / 胜败局分布）\n');
  console.log(enemyTable);
  console.log('\n全解锁 · 地图原型\n');
  console.log(archetypeTable);
  console.log('\n全解锁 · 地图词缀\n');
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
      '> 本文件由 `node tests/balance-sim.mjs 40 --write` 生成，请勿手工改数字。',
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 种子数：每档 ${report.meta.seeds} 个；每个种子跑 ${report.meta.candidates} 张候选地图（真人开局三选一的完整候选集）`,
      `- 总对局：${rows.length}`,
      '- 方法：真实 Simulation + 固定机器人策略（无渲染）',
      '- 地图原型/词缀由种子生成；候选地图与真人三选一使用同一生成器，机器人按候选序号逐一模拟（不挑图）。',
      '',
      '## 目标达成（全解锁、机器人口径）',
      '',
      targetTable,
      '',
      '## 调参记录（本轮 vs 上轮）',
      '',
      formatChangeTable(statuses),
      '',
      '本轮三档倍率：',
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
      '## 全解锁 · 地图原型',
      '',
      archetypeTable,
      '',
      '## 全解锁 · 地图词缀',
      '',
      modifierTable,
      '',
      '## 全解锁 · 候选序号',
      '',
      '同名种子下三张候选的难度差异；用于确认“只看 candidate 0”是否会带来抽样偏差。',
      '',
      candidateTable,
      '',
      '## 零解锁 · 地图原型',
      '',
      archetypeBaseTable,
      '',
      '## 零解锁 · 地图词缀',
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
      '- 每种子跑满 3 张候选地图，总体表按候选均匀加权，接近“玩家随机选图”的口径，而不是只看第一张。',
      `- 目标（全解锁、机器人口径）：漫游 ${(BALANCE_TARGETS.roam[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.roam[1] * 100).toFixed(0)}%、远征 ${(BALANCE_TARGETS.standard[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.standard[1] * 100).toFixed(0)}%、深渊 ${(BALANCE_TARGETS.abyss[0] * 100).toFixed(0)}–${(BALANCE_TARGETS.abyss[1] * 100).toFixed(0)}%。`,
      '- 偏离目标时先调 `DIFFICULTIES` 倍率（`shared/data/difficulties.js`），其次调 `shared/config.js` 的波次/经济与 `mapgen.js` 的原型 `scoreMul`/词缀数值。',
      '- 零解锁状态显著更难，用于体现星核解锁价值；单独成表报告，不与全解锁混算。',
      '- 不同 seed 集结果波动明显，结论以 40 种子为准；绝对值以真人试玩校准。',
      '- 结构化数据：`node tests/balance-sim.mjs 40 --report=reports/balance.json`（无时间戳，同种子可复现）。',
      '',
    ];
    fs.writeFileSync(docPath, contentLines.join('\n'));
    console.log(`\n已写入 ${docPath}`);
  }
}

export {
  runOne,
  summarize,
  summarizeBy,
  formatTable,
  buildCoverage,
  towersBreakdown,
  relicsBreakdown,
  enemiesBreakdown,
  targetStatus,
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
