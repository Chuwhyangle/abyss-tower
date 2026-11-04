#!/usr/bin/env node
// 真人游玩分析 CLI：report / check 双模式。零第三方依赖。
// report —— 只读直连 runs/replays 表聚合，输出 5 段 markdown；全程按 content_version 分桶。
// check <insight-id> —— 单条洞察求值 exit 0/1；MVP 只做 human-vs-bot。
// 红线：不 import server/db/index.mjs（import 即执行清理写副作用），用 DatabaseSync(..., { readOnly: true })。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { RELIC_BY_ID } from '../public/js/shared/data/relics.js';
import { HEX_BY_ID } from '../public/js/shared/hexes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = process.env.DB_PATH || path.join(ROOT, 'server', 'data', 'game.db');
const DEFAULT_BALANCE = path.join(ROOT, 'docs', 'BALANCE.md');
const DEFAULT_FLOOR = 30;
// 真人通关率偏离机器人目标区间的容忍阈值（百分点）。
const THRESHOLD_PP = 10;

// 三档难度：code 与中文文案的固定映射（balance 表与 i18n 共用这组名字）。
const DIFFICULTY_BANDS = Object.freeze([
  { code: 'roam', label: '漫游' },
  { code: 'standard', label: '远征' },
  { code: 'abyss', label: '深渊' },
]);
const LABEL_BY_CODE = Object.fromEntries(DIFFICULTY_BANDS.map((band) => [band.code, band.label]));
const CODE_BY_LABEL = Object.fromEntries(DIFFICULTY_BANDS.map((band) => [band.label, band.code]));
const DIFFICULTY_ORDER = DIFFICULTY_BANDS.map((band) => band.code);

const USAGE = `真人游玩分析 CLI

用法：
  node scripts/play-analytics.mjs report [--db <path>] [--json]
      只读聚合 runs 表，输出 5 段 markdown（总体难度×mode / 主海克斯 / 遗物 / 失败波次 / mode 使用量）
  node scripts/play-analytics.mjs check <insight-id> [--db <path>] [--balance <path>] [--floor N] [--json]
      单条洞察求值，exit 0/1；MVP 洞察：human-vs-bot

通用选项：
  --db <path>      操作的数据库（默认 $DB_PATH 或 server/data/game.db）
  --balance <path> human-vs-bot 读取的机器人目标区间文件（默认 docs/BALANCE.md）
  --floor N        每档真人最低样本数，低于该数视为样本不足（默认 ${DEFAULT_FLOOR}）
  --json           以 JSON 输出
  -h, --help       显示帮助
`;

class AnalyticsError extends Error {}

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      balance: { type: 'string' },
      floor: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { command: positionals[0] || null, args: positionals.slice(1), opts: values };
}

function requireDbFile(file) {
  if (!fs.existsSync(file)) throw new AnalyticsError(`数据库不存在：${file}`);
  return file;
}

function openDb(file) {
  return new DatabaseSync(file, { readOnly: true });
}

function parseFloor(raw) {
  if (raw == null) return DEFAULT_FLOOR;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new AnalyticsError(`--floor 必须是正整数：${raw}`);
  }
  return value;
}

// ---------- 数据读取 ----------

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  // DB 列是 JSON 字符串；调用方（测试）可能直接喂已解析的对象/数组，直接放行。
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// 已结算局：结果指标（通关/波次/时长/余金/剩血）只对 status='finished' 有定义。
function loadFinishedRuns(db) {
  return db
    .prepare(
      `SELECT mode, difficulty, content_version, ruleset_json, relics, offers,
              wave_reached, duration_ms, result_json, victory
         FROM runs
        WHERE status = 'finished'`
    )
    .all();
}

// 全部局：mode 使用量按所有状态的 run 计数（建局即算使用）。
function loadAllRuns(db) {
  return db.prepare('SELECT mode, content_version FROM runs').all();
}

function tupleKey(...parts) {
  return JSON.stringify(parts);
}

// ---------- 聚合（纯函数，供测试直接调用） ----------

// 总体：难度 × mode × content_version。
export function aggregateOverall(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = tupleKey(row.content_version, row.difficulty, row.mode);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        contentVersion: row.content_version,
        difficulty: row.difficulty,
        mode: row.mode,
        count: 0,
        wins: 0,
        waveSum: 0,
        durSum: 0,
        goldSum: 0,
        goldN: 0,
        hpSum: 0,
        hpN: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (row.victory) bucket.wins += 1;
    bucket.waveSum += Number(row.wave_reached) || 0;
    bucket.durSum += Number(row.duration_ms) || 0;
    const result = parseJson(row.result_json, {});
    if (typeof result.goldLeft === 'number') {
      bucket.goldSum += result.goldLeft;
      bucket.goldN += 1;
    }
    if (typeof result.baseHp === 'number') {
      bucket.hpSum += result.baseHp;
      bucket.hpN += 1;
    }
  }
  return [...buckets.values()].map((bucket) => ({
    contentVersion: bucket.contentVersion,
    difficulty: bucket.difficulty,
    mode: bucket.mode,
    count: bucket.count,
    winRate: bucket.count ? bucket.wins / bucket.count : 0,
    avgWave: bucket.count ? bucket.waveSum / bucket.count : 0,
    avgDurationMs: bucket.count ? bucket.durSum / bucket.count : 0,
    avgGold: bucket.goldN ? bucket.goldSum / bucket.goldN : null,
    avgBaseHp: bucket.hpN ? bucket.hpSum / bucket.hpN : null,
  }));
}

// 主海克斯：选取率 = 选中局数 / 出现在三选一中的局数；胜率只算选中且已结算的局。
export function aggregateHexes(rows) {
  const versions = new Map();
  for (const row of rows) {
    const ruleset = parseJson(row.ruleset_json, {});
    const hex = ruleset && typeof ruleset === 'object' ? ruleset.hex : null;
    let version = versions.get(row.content_version);
    if (!version) {
      version = { offered: new Map(), picked: new Map(), wins: new Map() };
      versions.set(row.content_version, version);
    }
    const offers = hex && Array.isArray(hex.offers) ? hex.offers : [];
    for (const id of offers) {
      if (typeof id === 'string') version.offered.set(id, (version.offered.get(id) || 0) + 1);
    }
    if (hex && typeof hex.id === 'string') {
      version.picked.set(hex.id, (version.picked.get(hex.id) || 0) + 1);
      if (row.victory) version.wins.set(hex.id, (version.wins.get(hex.id) || 0) + 1);
    }
  }
  const out = [];
  for (const [contentVersion, version] of versions) {
    const ids = new Set([...version.offered.keys(), ...version.picked.keys()]);
    for (const id of [...ids].sort()) {
      const offered = version.offered.get(id) || 0;
      const picked = version.picked.get(id) || 0;
      const wins = version.wins.get(id) || 0;
      out.push({
        contentVersion,
        hex: id,
        name: HEX_BY_ID[id]?.name ?? id,
        offered,
        picked,
        pickRate: offered ? picked / offered : null,
        winRate: picked ? wins / picked : 0,
      });
    }
  }
  return out;
}

// 遗物：选取率 = 持有局数 / 出现在任一遗物三选一中的局数；胜率差 = 持有胜率 − 未持有胜率。
export function aggregateRelics(rows) {
  const versions = new Map();
  const totals = new Map();
  for (const row of rows) {
    let total = totals.get(row.content_version);
    if (!total) {
      total = { count: 0, wins: 0 };
      totals.set(row.content_version, total);
    }
    total.count += 1;
    if (row.victory) total.wins += 1;

    let version = versions.get(row.content_version);
    if (!version) {
      version = { offered: new Map(), owned: new Map(), wins: new Map() };
      versions.set(row.content_version, version);
    }
    const offers = parseJson(row.offers, {});
    if (offers && typeof offers === 'object') {
      for (const slot of Object.values(offers)) {
        if (!slot || !Array.isArray(slot.offers)) continue;
        for (const item of slot.offers) {
          if (item && item.kind === 'relic' && typeof item.id === 'string') {
            version.offered.set(item.id, (version.offered.get(item.id) || 0) + 1);
          }
        }
      }
    }
    const relics = parseJson(row.relics, []);
    const owned = new Set();
    for (const state of Array.isArray(relics) ? relics : []) {
      const id = typeof state === 'string' ? state : state && state.id;
      if (typeof id === 'string') owned.add(id);
    }
    for (const id of owned) {
      version.owned.set(id, (version.owned.get(id) || 0) + 1);
      if (row.victory) version.wins.set(id, (version.wins.get(id) || 0) + 1);
    }
  }
  const out = [];
  for (const [contentVersion, version] of versions) {
    const total = totals.get(contentVersion);
    const ids = new Set([...version.offered.keys(), ...version.owned.keys()]);
    for (const id of [...ids].sort()) {
      const offered = version.offered.get(id) || 0;
      const owned = version.owned.get(id) || 0;
      const winsWith = version.wins.get(id) || 0;
      const notOwned = total.count - owned;
      const winRateWith = owned ? winsWith / owned : 0;
      const winRateWithout = notOwned ? (total.wins - winsWith) / notOwned : null;
      out.push({
        contentVersion,
        relic: id,
        name: RELIC_BY_ID[id]?.name ?? id,
        offered,
        owned,
        pickRate: offered ? owned / offered : null,
        winRateWith,
        winRateWithout,
        winRateDelta: winRateWithout == null ? null : winRateWith - winRateWithout,
      });
    }
  }
  return out;
}

// 失败波次分布：只统计已结算且未通关的局，按最终到达波次聚合。
export function aggregateFailures(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (row.victory) continue;
    const key = tupleKey(row.content_version, row.wave_reached);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].map(([key, failCount]) => {
    const [contentVersion, wave] = JSON.parse(key);
    return { contentVersion, wave: Number(wave), failCount };
  });
}

// mode 使用量：所有状态的局按 mode 计数。
export function aggregateModeUsage(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = tupleKey(row.content_version, row.mode);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].map(([key, runCount]) => {
    const [contentVersion, mode] = JSON.parse(key);
    return { contentVersion, mode, runCount };
  });
}

// ---------- human-vs-bot 洞察 ----------

// 解析 BALANCE.md 的「目标达成（全解锁 · 零 meta）」表：漫游/远征/深渊 → [lo, hi]（百分点）。
export function parseBalanceTargets(text) {
  const targets = new Map();
  const lines = String(text).split('\n');
  let inZeroMeta = false;
  for (const line of lines) {
    if (line.includes('目标达成（全解锁 · 零 meta')) {
      inZeroMeta = true;
      continue;
    }
    if (!inZeroMeta) continue;
    // 离开零 meta 表：进入下一个二级标题即停，避免读到满 meta 表。
    if (line.startsWith('## ')) break;
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const label = cells[1];
    const range = cells[2];
    const code = CODE_BY_LABEL[label];
    if (!code || !range) continue;
    const match = range.match(/(\d+(?:\.\d+)?)\s*[–\-—~]\s*(\d+(?:\.\d+)?)/);
    if (!match) continue;
    targets.set(code, { lo: Number(match[1]), hi: Number(match[2]) });
  }
  return targets;
}

// 胜率（0-1）→ 百分点（1 位小数）。
function toPp(rate) {
  return Math.round(rate * 1000) / 10;
}

// 已按百分点计的值保留 1 位小数。
function round1(value) {
  return Math.round(value * 10) / 10;
}

// 单条洞察求值：真人通关率 vs 机器人目标区间。样本不足的档不参与判定。
export function evaluateHumanVsBot({ rows, targets, floor = DEFAULT_FLOOR, thresholdPp = THRESHOLD_PP }) {
  const byDifficulty = new Map();
  for (const row of rows) {
    let bucket = byDifficulty.get(row.difficulty);
    if (!bucket) {
      bucket = { count: 0, wins: 0 };
      byDifficulty.set(row.difficulty, bucket);
    }
    bucket.count += 1;
    if (row.victory) bucket.wins += 1;
  }

  const bands = [];
  const insufficient = [];
  const failures = [];
  for (const code of DIFFICULTY_ORDER) {
    const target = targets.get(code);
    if (!target) continue;
    const bucket = byDifficulty.get(code) || { count: 0, wins: 0 };
    const n = bucket.count;
    if (n < floor) {
      insufficient.push({ difficulty: code, label: LABEL_BY_CODE[code], n, floor });
      continue;
    }
    const humanPp = toPp(n ? bucket.wins / n : 0);
    const deviationPp = round1(
      humanPp < target.lo ? target.lo - humanPp : humanPp > target.hi ? humanPp - target.hi : 0
    );
    const band = {
      difficulty: code,
      label: LABEL_BY_CODE[code],
      n,
      humanPp,
      target,
      deviationPp,
      verdict: deviationPp > thresholdPp ? 'fail' : 'ok',
    };
    bands.push(band);
    if (band.verdict === 'fail') failures.push(band);
  }
  return { bands, insufficient, failures, ok: failures.length === 0 };
}

// ---------- markdown 输出 ----------

function pct(rate) {
  return rate == null ? '-' : `${(rate * 100).toFixed(1)}%`;
}

function num(value, digits = 1) {
  return value == null ? '-' : Number(value).toFixed(digits);
}

function diffLabel(label, code) {
  return label === code ? label : `${label}(${code})`;
}

function table(headers, rows) {
  const lines = [];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderReport({ overall, hexes, relics, failures, modes, dbPath }) {
  const lines = [];
  lines.push('# 真人游玩分析报告');
  lines.push('');
  lines.push(`> 数据源：\`${dbPath}\`（只读）· 生成时间：${new Date().toISOString()}`);
  lines.push('');

  lines.push('## 总体（难度 × mode）');
  if (overall.length === 0) {
    lines.push('（无已结算对局）');
  } else {
    lines.push(
      table(
        ['content_version', '难度', 'mode', '局数', '通关率', '平均波次', '平均时长(ms)', '平均余金', '平均剩血'],
        overall.map((row) => [
          row.contentVersion,
          diffLabel(LABEL_BY_CODE[row.difficulty] ?? row.difficulty, row.difficulty),
          row.mode,
          String(row.count),
          pct(row.winRate),
          num(row.avgWave),
          num(row.avgDurationMs, 0),
          num(row.avgGold),
          num(row.avgBaseHp),
        ])
      )
    );
  }
  lines.push('');

  lines.push('## 主海克斯选取率 / 胜率');
  if (hexes.length === 0) {
    lines.push('（无已结算对局）');
  } else {
    lines.push(
      table(
        ['content_version', '海克斯', '出现', '选取', '选取率', '胜率'],
        hexes.map((row) => [
          row.contentVersion,
          row.name,
          String(row.offered),
          String(row.picked),
          pct(row.pickRate),
          pct(row.winRate),
        ])
      )
    );
  }
  lines.push('');

  lines.push('## 遗物选取率 / 胜率差');
  if (relics.length === 0) {
    lines.push('（无已结算对局）');
  } else {
    lines.push(
      table(
        ['content_version', '遗物', '出现', '持有', '选取率', '持有胜率', '未持有胜率', '胜率差'],
        relics.map((row) => [
          row.contentVersion,
          row.name,
          String(row.offered),
          String(row.owned),
          pct(row.pickRate),
          pct(row.winRateWith),
          pct(row.winRateWithout),
          num(row.winRateDelta == null ? null : row.winRateDelta * 100),
        ])
      )
    );
  }
  lines.push('');

  lines.push('## 失败波次分布');
  if (failures.length === 0) {
    lines.push('（无失败对局）');
  } else {
    lines.push(
      table(
        ['content_version', '波次', '失败局数'],
        failures.map((row) => [row.contentVersion, String(row.wave), String(row.failCount)])
      )
    );
  }
  lines.push('');

  lines.push('## mode 使用量');
  if (modes.length === 0) {
    lines.push('（无对局）');
  } else {
    lines.push(
      table(
        ['content_version', 'mode', '局数'],
        modes.map((row) => [row.contentVersion, row.mode, String(row.runCount)])
      )
    );
  }
  lines.push('');

  return lines.join('\n');
}

function renderCheck(evaluation, { insight, balancePath, floor }) {
  const lines = [];
  lines.push(`洞察 ${insight}：真人通关率 vs 机器人目标区间`);
  lines.push(`目标区间来源：${balancePath} · 样本 floor=${floor} · 阈值 ${THRESHOLD_PP}pp`);
  for (const band of evaluation.bands) {
    const mark = band.verdict === 'fail' ? '✗' : '✓';
    lines.push(
      `  ${mark} ${band.label} n=${band.n} 真人 ${band.humanPp.toFixed(1)}% vs 目标 ${band.target.lo}–${band.target.hi}%（偏差 ${band.deviationPp.toFixed(1)}pp）`
    );
  }
  for (const skip of evaluation.insufficient) {
    lines.push(`  - ${skip.label} 样本不足（n=${skip.n} < floor=${skip.floor}），跳过判定`);
  }
  return lines.join('\n');
}

// ---------- 命令 ----------

function commandReport(opts) {
  const file = requireDbFile(opts.db || DEFAULT_DB);
  const db = openDb(file);
  try {
    const finished = loadFinishedRuns(db);
    const all = loadAllRuns(db);
    return {
      overall: aggregateOverall(finished),
      hexes: aggregateHexes(finished),
      relics: aggregateRelics(finished),
      failures: aggregateFailures(finished),
      modes: aggregateModeUsage(all),
      dbPath: file,
    };
  } finally {
    db.close();
  }
}

function commandCheck(insight, opts) {
  if (!insight) {
    throw new AnalyticsError('用法：node scripts/play-analytics.mjs check <insight-id>');
  }
  if (insight !== 'human-vs-bot') {
    throw new AnalyticsError(`未知洞察：${insight}（MVP 仅支持 human-vs-bot）`);
  }
  const file = requireDbFile(opts.db || DEFAULT_DB);
  const balancePath = path.resolve(opts.balance || DEFAULT_BALANCE);
  if (!fs.existsSync(balancePath)) throw new AnalyticsError(`平衡文档不存在：${balancePath}`);
  const floor = parseFloor(opts.floor);
  const targets = parseBalanceTargets(fs.readFileSync(balancePath, 'utf8'));

  const db = openDb(file);
  let evaluation;
  try {
    evaluation = evaluateHumanVsBot({ rows: loadFinishedRuns(db), targets, floor });
  } finally {
    db.close();
  }

  const result = { insight, balancePath, floor, ...evaluation };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderCheck(evaluation, { insight, balancePath, floor }));
  }
  return evaluation.ok ? 0 : 1;
}

// ---------- main ----------

function main(argv) {
  const { command, args, opts } = parseCli(argv);
  if (opts.help || !command) {
    if (command && !opts.help) throw new AnalyticsError(`未知命令：${command}`);
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case 'report': {
      const result = commandReport(opts);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderReport(result));
      }
      return 0;
    }
    case 'check':
      return commandCheck(args[0], opts);
    default:
      throw new AnalyticsError(`未知命令：${command}（用 --help 查看用法）`);
  }
}

// 仅直接执行时运行 CLI；被 import（测试）时不触发 main，避免污染测试进程参数。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const wantsJson = process.argv.includes('--json');
    if (wantsJson) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`错误：${error.message}`);
    }
    process.exitCode = 1;
  }
}
