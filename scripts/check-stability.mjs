#!/usr/bin/env node
// 稳定性门禁：连续 N 轮（默认 3）运行全量测试，任一轮失败就向 stderr 输出 CAUSE= 并以非 0 退出。
// 与 test-stability.mjs 共用轮次执行与统计，本脚本只负责「门禁判定 + 失败原因 + 红类归属」。
// 红类归属（all-pass / deterministic / flaky）只解释失败的性质，不改变门禁的通过标准：
// 任一轮失败仍 exit 1，绝不因「判成确定性红」而放行。
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

// failureType 是分辨「用例断言坏了」和「整文件 hookFailed（如 EADDRINUSE）」的唯一线索；
// 证据路径保证失败轮可以离线复查原始 TAP，不用重跑。
function evidenceSuffix(round) {
  const types = (round.failureTypes ?? []).filter(Boolean);
  const typed = types.length > 0 ? `；failureType=${types.join('、')}` : '';
  const path = round.evidencePath ? `；证据 ${round.evidencePath}` : '';
  return `${typed}${path}`;
}

export function causeLine(round) {
  if (round.status === 'timeout') {
    return `CAUSE=full suite timed out on run ${round.round}（${round.detail || '超过时限'}）${evidenceSuffix(round)}`;
  }
  if (round.status === 'error') {
    return `CAUSE=full suite errored on run ${round.round}（${round.detail || '未产出 TAP 汇总'}）${evidenceSuffix(round)}`;
  }
  const names = (round.failedTests ?? []).slice(0, MAX_CAUSE_TESTS).map((name) => String(name));
  const suffix = names.length > 0 ? `：${names.join('、')}` : '';
  return `CAUSE=full suite failed on run ${round.round}（${round.fail} 项失败${suffix}）${evidenceSuffix(round)}`;
}

function sortedNames(round) {
  return (round.failedTests ?? []).map((name) => String(name)).sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unionNames(rounds) {
  const names = new Set();
  for (const round of rounds) for (const name of round.failedTests ?? []) names.add(String(name));
  return [...names].sort();
}

// 红类归属把「跨轮失败集恒定」（套件本身有确定性坏点）与「跨轮不同」（真正的稳定性/并发缺陷）
// 分成两类可机读的事实，免去每轮复验都靠人翻 .tap 原文归因。
// 判据偏保守：只要有任何线索指向「跨轮不同」，就归 flaky，不误报确定性。
export function classifyRounds(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const failed = list.filter((round) => round.status !== 'ok');
  if (failed.length === 0) return { kind: 'all-pass', tests: [] };
  // 有轮通过、有轮失败 ⇒ 失败只在部分轮出现，天然是偶发。
  if (failed.length !== list.length) return { kind: 'flaky', tests: unionNames(failed) };

  const timedOut = failed.filter((round) => round.status === 'timeout' || round.status === 'error');
  const asserted = failed.filter((round) => round.status === 'fail');
  // 超时/异常与断言失败混类：更可能指向并发/时序，宁可归 flaky。
  if (timedOut.length > 0 && asserted.length > 0) return { kind: 'flaky', tests: unionNames(failed) };

  if (asserted.length > 0) {
    const sets = asserted.map(sortedNames);
    const first = sets[0];
    return sets.every((set) => sameList(set, first))
      ? { kind: 'deterministic', tests: first }
      : { kind: 'flaky', tests: unionNames(failed) };
  }

  // 全部是 timeout / error：没有用例名可用，按 (status, detail) 判断跨轮是否同构。
  const keys = timedOut.map((round) => JSON.stringify([round.status, round.detail ?? '']));
  return keys.every((key) => key === keys[0])
    ? { kind: 'deterministic', tests: sortedNames(timedOut[0]) }
    : { kind: 'flaky', tests: unionNames(failed) };
}

// 通过轮次不输出红类行，保持既有 stdout 逐字不变。
export function classificationLine(classification) {
  if (!classification || classification.kind === 'all-pass') return null;
  if (classification.kind === 'flaky') {
    return '红类：偶发红（跨轮失败集不同 ⇒ 稳定性/并发隔离缺陷）';
  }
  const tests = (classification.tests ?? []).map(String);
  const names = tests.slice(0, MAX_CAUSE_TESTS);
  if (names.length === 0) return '红类：确定性红（跨轮失败集恒定，套件本身坏了，非稳定性缺陷）';
  const truncated = tests.length > names.length ? `…（共 ${tests.length} 项）` : '';
  return `红类：确定性红（跨轮失败集恒定，套件本身坏了，非稳定性缺陷）：${names.join('、')}${truncated}`;
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
  // 红类只挂在报告上供归因（--json 随之输出），不改 report.ok 与退出码。
  report.classification = classifyRounds(rounds);
  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      concurrency,
      files: files.length,
      ...report,
    }, null, 2));
  } else {
    const lines = formatReport(report, { concurrency, testFiles: files.length });
    const banner = classificationLine(report.classification);
    if (banner) {
      // 紧贴失败清单之上：先看红类，再看用例名。
      const index = lines.indexOf('失败用例：');
      if (index >= 0) lines.splice(index, 0, banner);
      else lines.push(banner);
    }
    for (const line of lines) {
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
