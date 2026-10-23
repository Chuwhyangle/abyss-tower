#!/usr/bin/env node
// 内存泄漏检测：隔离服务 + 无头浏览器重复「开局→开波→结算→回大厅」，
// 每轮强制 GC 后采样堆大小并做线性趋势判定。无法可靠测量时输出「未评估」，绝不伪装成通过。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
} from '../tests/harness.mjs';

// 阈值集中定义：每轮线性增长与整段总增长同时约束；等于阈值视为通过。
export const MEMORY_THRESHOLDS = Object.freeze({
  minRounds: 4,
  maxGrowthPerRoundMB: 2,
  maxTotalGrowthMB: 16,
  bytesPerMB: 1024 * 1024,
});

export const DEFAULT_ROUNDS = 6;
export const DEFAULT_WARMUP_ROUNDS = 1;
export const DEFAULT_COMBAT_MS = 1200;

const HELP = `用法：npm run check:memory [-- --rounds 6 --warmup 1 --combat-ms 1200]

  --rounds     计入趋势的轮数（默认 ${DEFAULT_ROUNDS}）
  --warmup     正式采样前的预热轮数（默认 ${DEFAULT_WARMUP_ROUNDS}，不计入趋势）
  --combat-ms  每轮开波后实际战斗的毫秒数（默认 ${DEFAULT_COMBAT_MS}）
  --help       显示本帮助

每轮流程：开局 → 开波 → 结算 → 回大厅；随后强制 GC 并记录 usedSize。
退出码：0 通过 / 1 疑似泄漏 / 2 未评估。`;

// 最小二乘线性回归：x 为轮次序号 0..n-1，y 为样本值。
export function linearTrend(values) {
  const samples = Array.isArray(values) ? values : [];
  const n = samples.length;
  if (n < 2) return { ok: false, n, slope: null, intercept: null };
  const meanX = (n - 1) / 2;
  const meanY = samples.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let variance = 0;
  samples.forEach((value, index) => {
    const dx = index - meanX;
    covariance += dx * (value - meanY);
    variance += dx * dx;
  });
  const slope = covariance / variance;
  return { ok: true, n, slope, intercept: meanY - slope * meanX };
}

// samples 为字节数。有效样本不足或阈值被突破时如实返回对应状态。
export function evaluateMemoryTrend(samples, thresholds = MEMORY_THRESHOLDS) {
  const values = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const base = {
    n: values.length,
    minRounds: thresholds.minRounds,
    slopeMBPerRound: null,
    totalGrowthMB: null,
    maxGrowthPerRoundMB: thresholds.maxGrowthPerRoundMB,
    maxTotalGrowthMB: thresholds.maxTotalGrowthMB,
    reasons: [],
  };

  if (values.length < thresholds.minRounds) {
    return {
      ...base,
      status: 'not-evaluated',
      reasons: [`有效样本不足：${values.length}/${thresholds.minRounds} 轮`],
    };
  }

  const trend = linearTrend(values);
  const slopeMBPerRound = trend.slope / thresholds.bytesPerMB;
  const totalGrowthMB = (values[values.length - 1] - values[0]) / thresholds.bytesPerMB;
  const reasons = [];
  if (slopeMBPerRound > thresholds.maxGrowthPerRoundMB) {
    reasons.push(
      `每轮增长 ${slopeMBPerRound.toFixed(2)} MB > 阈值 ${thresholds.maxGrowthPerRoundMB.toFixed(2)} MB`
    );
  }
  if (totalGrowthMB > thresholds.maxTotalGrowthMB) {
    reasons.push(
      `总增长 ${totalGrowthMB.toFixed(2)} MB > 阈值 ${thresholds.maxTotalGrowthMB.toFixed(2)} MB`
    );
  }

  return {
    ...base,
    status: reasons.length ? 'fail' : 'pass',
    slopeMBPerRound,
    totalGrowthMB,
    reasons,
  };
}

const signedMB = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

export function formatMemoryTrend(result) {
  if (result.status === 'not-evaluated') {
    return [`[memory] 结论：未评估（${result.reasons.join('；') || '无法测量'}）`];
  }
  return [
    `[memory] 线性趋势：${signedMB(result.slopeMBPerRound)} MB/轮，总增长 ${signedMB(result.totalGrowthMB)} MB（${result.n} 轮）`,
    `[memory] 阈值：≤ ${result.maxGrowthPerRoundMB.toFixed(2)} MB/轮 且 ≤ ${result.maxTotalGrowthMB.toFixed(2)} MB 总增长`,
    result.status === 'pass'
      ? '[memory] 结论：通过'
      : `[memory] 结论：疑似泄漏（${result.reasons.join('；')}）`,
  ];
}

async function sampleHeap(browser) {
  try {
    await browser.send('HeapProfiler.collectGarbage');
  } catch {
    return { ok: false, reason: '强制 GC 不可用' };
  }
  try {
    const usage = await browser.heapUsage();
    const usedSize = Number(usage?.usedSize);
    if (!Number.isFinite(usedSize) || usedSize <= 0) {
      return { ok: false, reason: '无法读取堆大小' };
    }
    return { ok: true, usedSize };
  } catch {
    return { ok: false, reason: '无法读取堆大小' };
  }
}

async function playRound(browser, { combatMs }) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="standard"]').click()`);
  await chooseFirstMap(browser);
  await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
  await browser.evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
  await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
  await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
  await sleep(combatMs);
  await browser.evaluate(`
    (() => {
      const sim = window.__rtd.state.sim;
      sim.baseHp = 0;
      sim.update(1 / 60);
    })()
  `);
  await browser.waitFor(`!!document.querySelector('.result-modal')`, '结算弹窗', 20000);
  await browser.evaluate(`document.querySelector('#btn-home').click()`);
  await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '返回大厅');
}

function parseCount(flag, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} 需要非负整数，收到 ${raw}`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    rounds: DEFAULT_ROUNDS,
    warmup: DEFAULT_WARMUP_ROUNDS,
    combatMs: DEFAULT_COMBAT_MS,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    if (flag === '--help') {
      options.help = true;
      continue;
    }
    if (!['--rounds', '--warmup', '--combat-ms'].includes(flag)) {
      throw new Error(`未知参数：${argv[i]}`);
    }
    const raw = inline ?? argv[++i];
    if (raw == null || raw === '') throw new Error(`${flag} 缺少取值`);
    if (flag === '--rounds') options.rounds = parseCount(flag, raw);
    else if (flag === '--warmup') options.warmup = parseCount(flag, raw);
    else options.combatMs = parseCount(flag, raw);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  const samples = [];
  const unmeasured = [];
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-memory',
      cookie: session.rawCookie,
    });

    const mb = (bytes) => (bytes / MEMORY_THRESHOLDS.bytesPerMB).toFixed(2);
    const total = options.warmup + options.rounds;
    for (let index = 0; index < total; index++) {
      const measured = index >= options.warmup;
      const round = index - options.warmup + 1;
      console.log(`[memory] ${measured ? `轮次 ${round}/${options.rounds}` : `预热 ${index + 1}/${options.warmup}`}……`);
      await playRound(browser, options);
      const sample = await sampleHeap(browser);
      if (!measured) {
        console.log(
          sample.ok ? `[memory] 预热完成：${mb(sample.usedSize)} MB（不计入趋势）` : `[memory] 预热无法测量：${sample.reason}`
        );
        continue;
      }
      if (!sample.ok) {
        unmeasured.push(sample.reason);
        console.log(`[memory] 轮次 ${round}/${options.rounds}：未评估（${sample.reason}）`);
        continue;
      }
      samples.push(sample.usedSize);
      console.log(`[memory] 轮次 ${round}/${options.rounds}：${mb(sample.usedSize)} MB`);
    }

    let result = evaluateMemoryTrend(samples);
    if (unmeasured.length > 0) {
      result = {
        ...result,
        status: 'not-evaluated',
        reasons: [`${unmeasured.length} 轮无法测量（${unmeasured[0]}）`, ...result.reasons],
      };
    }
    for (const line of formatMemoryTrend(result)) console.log(line);
    process.exitCode = result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2;
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log('[memory] 结论：未评估（测量过程失败）');
    console.error(`[memory] 无法完成测量：${error.message || error}`);
    process.exitCode = 2;
  });
}
