// 赛季自动结算：扫描已结束但未结算的赛季，逐个幂等结算并留痕。
// 供部署 cron 调用；结算规则与奖励数值沿用 server/db/leaderboard.mjs，不在此重复实现。
// 用法：node scripts/settle-seasons.mjs [--db <path>] [--season YYYY-MM] [--dry-run] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = process.env.DB_PATH || path.join(ROOT, 'server', 'data', 'game.db');

const USAGE = `赛季自动结算

用法：
  node scripts/settle-seasons.mjs [options]

选项：
  --db <path>          操作的数据库（默认 $DB_PATH 或 server/data/game.db）
  --season <YYYY-MM>   只处理指定赛季（仍要求赛季已结束）
  --dry-run            只预览，不写结果也不发星核
  --json               以 JSON 输出
  -h, --help           显示帮助

退出码：0 = 全部成功（含无事可做）；1 = 有赛季结算失败或参数错误。
`;

class SettleError extends Error {}

function parseCli(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        db: { type: 'string' },
        season: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
    return {
      db: values.db,
      season: values.season,
      dryRun: values['dry-run'],
      json: values.json,
      help: values.help,
    };
  } catch (error) {
    throw new SettleError(error.message);
  }
}

function dbPathFor(opts) {
  return path.resolve(opts.db || DEFAULT_DB);
}

function requireDbFile(file) {
  if (!fs.existsSync(file)) throw new SettleError(`数据库不存在：${file}`);
  return file;
}

async function loadLeaderboard(file) {
  // 必须在 import 前把连接指向目标库：导入会建立连接并执行迁移。
  process.env.DB_PATH = file;
  return import('../server/db/leaderboard.mjs');
}

function resultStatus(result, dryRun) {
  if (result.alreadySettled) return 'already-settled';
  if (result.settledCount === 0) return 'empty';
  return dryRun ? 'would-settle' : 'settled';
}

function summarize(season, result, status) {
  return {
    season,
    status,
    alreadySettled: Boolean(result.alreadySettled),
    settledCount: result.settledCount,
    totalCores: result.totalCores,
    rewards: result.rewards,
  };
}

async function settleSeasons(opts) {
  const file = requireDbFile(dbPathFor(opts));
  const leaderboard = await loadLeaderboard(file);

  if (opts.season != null && !leaderboard.isSeasonKey(opts.season)) {
    throw new SettleError(`非法赛季：${opts.season}（应为 YYYY-MM）`);
  }

  const candidates = (
    opts.season != null ? [opts.season] : leaderboard.listSeasons()
  )
    .filter((season) => leaderboard.isSeasonKey(season))
    .sort();

  const now = Date.now();
  const results = [];
  const failures = [];

  for (const season of candidates) {
    const bounds = leaderboard.seasonBounds(season);
    if (!bounds || bounds.end > now) {
      results.push({
        season,
        status: 'not-ended',
        reason: '赛季未结束',
        settledCount: 0,
        totalCores: 0,
        rewards: [],
      });
      continue;
    }

    try {
      const result = leaderboard.settleSeason(season, { dryRun: opts.dryRun });
      results.push(summarize(season, result, resultStatus(result, opts.dryRun)));
    } catch (error) {
      failures.push({ season, error: error.message });
    }
  }

  return { dryRun: opts.dryRun, results, failures };
}

function printHuman(report) {
  for (const item of report.results) {
    const cores = `${item.settledCount} 人，共 ${item.totalCores} 星核`;
    if (item.status === 'not-ended') {
      console.log(`跳过赛季 ${item.season}：${item.reason}`);
    } else if (item.status === 'already-settled') {
      console.log(`赛季 ${item.season} 已结算：${cores}`);
    } else if (item.status === 'empty') {
      console.log(`${report.dryRun ? '[dry-run] ' : ''}赛季 ${item.season} 无可结算名次`);
    } else if (item.status === 'would-settle') {
      console.log(`[dry-run] 赛季 ${item.season} 待结算：${cores}`);
    } else {
      console.log(`赛季 ${item.season} 结算完成：${cores}`);
    }
  }

  for (const failure of report.failures) {
    console.error(`赛季 ${failure.season} 结算失败：${failure.error}`);
  }

  if (report.results.length === 0 && report.failures.length === 0) {
    console.log('没有需要结算的赛季');
  }
}

async function main(argv) {
  const opts = parseCli(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const report = await settleSeasons(opts);
  if (opts.json) {
    console.log(JSON.stringify({ ok: report.failures.length === 0, ...report }, null, 2));
  } else {
    printHuman(report);
  }
  return report.failures.length === 0 ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const wantsJson = process.argv.includes('--json');
    if (wantsJson) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`错误：${error.message}`);
    }
    process.exitCode = 1;
  });
