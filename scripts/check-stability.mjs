#!/usr/bin/env node
// 稳定性门禁：连续 N 轮（默认 3）运行全量测试，任一轮失败就向 stderr 输出 CAUSE= 并以非 0 退出。
// 与 test-stability.mjs 共用轮次执行与统计，本脚本只负责「门禁判定 + 失败原因」。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listTestFiles } from './test-changed.mjs';
import {
  detectTestConcurrency,
  formatReport,
  parseArgs,
  runRound,
  summarizeRounds,
} from './test-stability.mjs';

const MAX_CAUSE_TESTS = 5;

export function causeLine(round) {
  if (round.status === 'timeout') {
    return `CAUSE=full suite timed out on run ${round.round}（${round.detail || '超过时限'}）`;
  }
  if (round.status === 'error') {
    return `CAUSE=full suite errored on run ${round.round}（${round.detail || '未产出 TAP 汇总'}）`;
  }
  const names = (round.failedTests ?? []).slice(0, MAX_CAUSE_TESTS).map((name) => String(name));
  const suffix = names.length > 0 ? `：${names.join('、')}` : '';
  return `CAUSE=full suite failed on run ${round.round}（${round.fail} 项失败${suffix}）`;
}

function usage() {
  return [
    '用法：node scripts/check-stability.mjs [选项]',
    '',
    '  --rounds=<n>            连续跑 n 轮（默认 3）',
    '  --concurrency=<n>       覆盖并发档位（默认沿用 npm test 的固定档位；default 表示不传）',
    '  --files=a.test.mjs,...  只跑指定测试文件（默认 tests/*.test.mjs 全量）',
    '  --root=<dir>            仓库根目录（默认脚本所在仓库）',
    '  --timeout-ms=<ms>       单轮超时（默认 900000）',
    '  --json                  以 JSON 输出结果（进度仍走 stderr）',
    '  --help                  显示本帮助',
    '',
    '任一轮失败时向 stderr 输出 CAUSE=...，退出码 1；全部通过退出码 0；参数错误退出码 2。',
  ].join('\n');
}

export function runCheck(options) {
  const files = options.files ?? listTestFiles(options.root);
  if (files.length === 0) throw new Error('未找到测试文件');
  const concurrency = options.concurrency === undefined
    ? detectTestConcurrency(options.root)
    : options.concurrency;

  console.error(`check-stability: ${files.length} 个测试文件，${options.rounds} 轮，并发 ${concurrency ?? '默认'}`);
  const rounds = [];
  for (let index = 1; index <= options.rounds; index += 1) {
    process.stderr.write(`check-stability: 第 ${index}/${options.rounds} 轮 … `);
    const round = runRound(index, {
      root: options.root,
      files,
      concurrency,
      timeoutMs: options.timeoutMs,
    });
    rounds.push(round);
    process.stderr.write(`${(round.durationMs / 1000).toFixed(2)}s（${round.status}）\n`);
    if (round.status !== 'ok') console.error(causeLine(round));
  }

  const report = summarizeRounds(rounds);
  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      concurrency,
      files: files.length,
      ...report,
    }, null, 2));
  } else {
    for (const line of formatReport(report, { concurrency, testFiles: files.length })) {
      console.log(line);
    }
  }
  return report;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-stability: ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  let report;
  try {
    report = runCheck(options);
  } catch (error) {
    console.error(`check-stability: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
