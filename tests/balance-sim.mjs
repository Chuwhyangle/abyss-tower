// 无头平衡模拟：用真实 Simulation 跑完整 30 波，机器人自动建塔/选遗物。
// 结果用于三档难度的相对比较与回归，不代替真人试玩。
// 用法：node tests/balance-sim.mjs [seeds] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  MAX_WAVE,
  relicModsAtLevel,
  rollRelicOffers,
} from '../public/js/shared/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STEP = 1 / 60;
const MAX_WAVE_SECONDS = 180;
const MAX_SIM_STEPS_PER_WAVE = Math.ceil(MAX_WAVE_SECONDS / STEP);

const SEEDS = Math.max(1, Number(process.argv[2]) || 6);
const WRITE_DOC = process.argv.includes('--write');
const DETAIL = process.argv.includes('--detail');

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

function buildCoverage(map, sim) {
  const samples = [];
  for (let d = 0; d < sim.pathLen; d += 0.5) samples.push(sim.posAt(d));

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

function runOne(seed, difficulty, meta) {
  const diff = DIFFICULTIES[difficulty];
  const map = generateMap(seed);
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
    const waveDef = generateWave(seed, wave, difficulty);
    lastWave = wave;
    sim.beginWave(waveDef);

    let steps = 0;
    while (sim.phase === 'wave' && steps < MAX_SIM_STEPS_PER_WAVE) {
      sim.update(STEP);
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

function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.difficulty}:${row.meta ? 'full' : 'base'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const output = [];
  for (const [key, list] of groups) {
    const [difficulty, meta] = key.split(':');
    const wins = list.filter((row) => row.victory).length;
    const waves = list.map((row) => row.cleared).sort((a, b) => a - b);
    output.push({
      difficulty,
      meta,
      runs: list.length,
      wins,
      winRate: wins / list.length,
      avgWave: waves.reduce((sum, n) => sum + n, 0) / waves.length,
      medianWave: waves[Math.floor(waves.length / 2)],
      maxWave: waves[waves.length - 1],
      avgScore: Math.round(list.reduce((sum, row) => sum + row.score, 0) / list.length),
      avgTowers: (list.reduce((sum, row) => sum + row.towers, 0) / list.length).toFixed(1),
      avgHp: (list.reduce((sum, row) => sum + row.hp, 0) / list.length).toFixed(1),
      avgGold: Math.round(list.reduce((sum, row) => sum + row.gold, 0) / list.length),
      avgSeconds: Math.round(list.reduce((sum, row) => sum + row.simSeconds, 0) / list.length),
      stuck: list.filter((row) => row.stuck).length,
    });
  }
  const order = { roam: 0, standard: 1, abyss: 2 };
  output.sort((a, b) => order[a.difficulty] - order[b.difficulty] || a.meta.localeCompare(b.meta));
  return output;
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

function main() {
  const started = Date.now();
  const rows = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const meta of [false, true]) {
      for (let i = 0; i < SEEDS; i++) {
        // 同一地图/波次/遗物种子贯穿三档与两种解锁状态，保证配对比较。
        const seed = `balance-${i}`;
        rows.push(runOne(seed, difficulty, meta));
      }
    }
  }
  const summary = summarize(rows);
  const table = formatTable(summary);

  console.log(`\n平衡模拟结果（${rows.length} 局，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）\n`);
  console.log(table);
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
        `\n明细 · ${DIFFICULTIES[difficulty].name} · ${row.seed} · ${
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
      `- 种子数：每档 ${SEEDS} 个`,
      `- 总对局：${rows.length}`,
      '- 方法：真实 Simulation + 固定机器人策略（无渲染）',
      '',
      '## 汇总',
      '',
      table,
      '',
      '## 明细',
      '',
      '| 难度 | 解锁 | 种子 | 结果 | 波次 | 生命 | 金币 | 击杀 | 塔数 | 分数 | 模拟时长 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map((row) =>
        [
          DIFFICULTIES[row.difficulty].name,
          row.meta ? '全解锁' : '零解锁',
          row.seed,
          row.victory ? '通关' : '失败',
          row.wave,
          row.hp,
          row.gold,
          row.kills,
          row.towers,
          row.score,
          `${row.simSeconds}s`,
        ].join(' | ')
      ).map((line) => `| ${line} |`),
      '',
      '## 说明',
      '',
      '- 机器人不等同真人：它不会针对性换塔，也不会手动卖塔，通关率仅用于相对比较。',
      '- 若某档通关率明显偏离目标，先调 `DIFFICULTIES` 倍率，再调波次/经济。',
      '- 目标（全解锁、机器人口径）：漫游 80–90%、远征 25–35%、深渊 5–15%。',
      '- 机器人在第 1 波前完成开局整备，固定 18 塔上限、固定建塔顺序、不会卖塔/针对性换塔；不同 seed 集差异明显，结论以 40 种子为准。',
      '- 机器人策略固定，绝对通关率以真人试玩为准；零解锁状态显著更难，用于体现星核解锁价值。',
      '',
    ].join('\n');
    fs.writeFileSync(docPath, content);
    console.log(`\n已写入 ${docPath}`);
  }
}

export { runOne, summarize, formatTable };

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
