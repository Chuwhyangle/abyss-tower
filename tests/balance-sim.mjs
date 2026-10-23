// 无头平衡模拟：用真实 Simulation 跑完整 30 波，机器人自动建塔/选遗物。
// 结果用于三档难度的相对比较与回归，不代替真人试玩。
// 用法：node tests/balance-sim.mjs [seeds] [--write] [--detail] [--candidates=N]
//       [--skill=none|aurora|meteor|chrono] [--skill-level=1|10]
// 机器人技能策略固定为“冷却好就用”，默认 --skill=none 保持旧基线。
//
// 每个种子默认跑 3 张候选地图（与真人开局三选一一致），并按地图原型/词缀/候选序号
// 分别统计，避免只看 candidate 0 造成的抽样偏差。
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
  MAX_WAVE,
  SKILLS,
  relicModsAtLevel,
  rollRelicOffers,
} from '../public/js/shared/data.js';

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

function stringArg(flag, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${flag}=`));
  return raw ? raw.slice(flag.length + 3) : fallback;
}

const SEEDS = Math.max(1, Number(process.argv[2]) || 6);
const CANDIDATES = Math.min(3, numericArg('candidates', 3));
const WRITE_DOC = process.argv.includes('--write');
const DETAIL = process.argv.includes('--detail');
const SKILL_ID = stringArg('skill', 'none');
const SKILL_LEVEL = Math.max(1, Math.min(10, numericArg('skill-level', 1)));
if (SKILL_ID !== 'none' && !SKILLS[SKILL_ID]) {
  console.error(`未知技能：${SKILL_ID}（可选 none / ${Object.keys(SKILLS).join(' / ')}）`);
  process.exit(1);
}
const SKILL = SKILL_ID === 'none' ? null : { id: SKILL_ID, level: SKILL_LEVEL };

// ---------- 机器人策略 ----------

function modsValue(mods = {}) {
  let value = 0;
  for (const [key, raw] of Object.entries(mods)) {
    if (key === 'dmg') {
      for (const amount of Object.values(raw)) value += amount * 10;
    } else if (key === 'dmgAll') value += raw * 14;
    else if (key === 'fireRate') value += raw * 13;
    else if (key === 'range') value += raw * 1.5;
    else if (key === 'crit') value += raw * 10;
    else if (key === 'armorPierce') value += raw * 6;
    else if (key === 'interest') value += raw * 22;
    else if (key === 'goldMul') value += raw * 7;
    else if (key === 'killGold') value += raw * 1.2;
    else if (key === 'baseHp') value += raw * 0.4;
    else if (key === 'bossDmg') value += raw * 3;
    else if (key === 'dot') value += raw * 9;
    else if (key === 'splash') value += raw * 6;
    else if (key === 'chain') value += raw * 3;
    else if (key === 'slow' || key === 'slowDur') value += raw * 4;
    else if (typeof raw === 'number') value += raw * 2;
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
  // 机器人必须先完成开局整备，再进入第 1 波；否则把"空手接第一波"误当成游戏难度。
  spendGold(sim, 1, cells);
  let stuck = false;
  let lastWave = 0;

  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const waveDef = generateWave(seed, wave, difficulty, map.meta);
    lastWave = wave;
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

function compareToTarget(summary) {
  const targets = {
    roam: [0.8, 0.9],
    standard: [0.25, 0.35],
    abyss: [0.05, 0.15],
  };
  return DIFFICULTY_ORDER.map((difficulty) => {
    const row = summary.find((item) => item.difficulty === difficulty && item.meta === 'full');
    const [low, high] = targets[difficulty];
    const rate = row?.winRate ?? 0;
    const status = rate < low ? '低于目标' : rate > high ? '高于目标' : '达标';
    return `| ${DIFFICULTIES[difficulty].name} | ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}% | ${(rate * 100).toFixed(0)}% | ${status} |`;
  }).join('\n');
}

function main() {
  const started = Date.now();
  const rows = [];
  const candidateCount = Math.max(1, Math.min(3, CANDIDATES));
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const meta of [false, true]) {
      for (let i = 0; i < SEEDS; i++) {
        // 同一地图/波次/遗物种子贯穿三档与两种解锁状态，保证配对比较。
        const seed = `balance-${i}`;
        for (let candidate = 0; candidate < candidateCount; candidate++) {
          rows.push(runOne(seed, difficulty, meta, candidate));
        }
      }
    }
  }
  const summary = summarize(rows);
  const table = formatTable(summary);

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
    `\n平衡模拟结果（${rows.length} 局，每种子 ${candidateCount} 张候选地图，技能 ${
      SKILL ? `${SKILL.id} Lv.${SKILL.level}` : '无'
    }，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）\n`
  );
  console.log(table);
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

  if (WRITE_DOC) {
    const docPath = path.join(ROOT, 'docs', 'BALANCE.md');
    const content = [
      '# 平衡模拟记录',
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 种子数：每档 ${SEEDS} 个；每个种子跑 ${candidateCount} 张候选地图（真人开局三选一的完整候选集）`,
      `- 总对局：${rows.length}`,
      '- 方法：真实 Simulation + 固定机器人策略（无渲染）',
      '- 地图原型/词缀由种子生成；候选地图与真人三选一使用同一生成器，机器人按候选序号逐一模拟（不挑图）。',
      '',
      '## 目标达成（全解锁、机器人口径）',
      '',
      '| 难度 | 目标区间 | 本轮 | 状态 |',
      '| --- | --- | --- | --- |',
      compareToTarget(summary),
      '',
      '## 总体（难度 × 解锁状态）',
      '',
      table,
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
      '- 目标（全解锁、机器人口径）：漫游 80–90%、远征 25–35%、深渊 5–15%。',
      '- 偏离目标时先调 `DIFFICULTIES` 倍率（`shared/data.js`），其次调 `shared/config.js` 的波次/经济与 `mapgen.js` 的原型 `scoreMul`/词缀数值。',
      '- 零解锁状态显著更难，用于体现星核解锁价值；单独成表报告，不与全解锁混算。',
      '- 不同 seed 集结果波动明显，结论以 40 种子为准；绝对值以真人试玩校准。',
      '',
    ].join('\n');
    fs.writeFileSync(docPath, content);
    console.log(`\n已写入 ${docPath}`);
  }
}

export { runOne, summarize, summarizeBy, formatTable, buildCoverage };

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
