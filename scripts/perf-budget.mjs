#!/usr/bin/env node
// 性能预算门禁：把本次 perf 结果与 docs/perf-budget.json 的基线/预算对比。
// 判定为 PASS(0) / FAIL(1) / NOT-EVALUATED(2)；所有阈值只来自 json，不写死在代码里。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_EVALUATED: 'NOT-EVALUATED',
});

export const DEFAULT_BASELINE_PATH = fileURLToPath(
  new URL('../docs/perf-budget.json', import.meta.url)
);
export const DEFAULT_RESULTS_PATH = process.env.PERF_RESULTS || '/tmp/rtd-perf.json';

const EXIT_CODE = {
  [VERDICT.PASS]: 0,
  [VERDICT.FAIL]: 1,
  [VERDICT.NOT_EVALUATED]: 2,
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 3) => Number(value.toFixed(digits));

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function loadBaseline(file = process.env.PERF_BUDGET_FILE || DEFAULT_BASELINE_PATH) {
  return readJson(file);
}

export function baselineScenarioNames(baseline) {
  const scenarios = baseline?.scenarios;
  return scenarios && typeof scenarios === 'object' ? Object.keys(scenarios) : [];
}

// 接受完整 report（{ results: [...] }）或裸结果数组；缺失的指标保持 null，不补零。
export function collectResults(input) {
  const rows = Array.isArray(input) ? input : input?.results;
  const byName = new Map();
  if (!Array.isArray(rows)) return byName;
  for (const row of rows) {
    if (!row || typeof row.name !== 'string') continue;
    const metrics = row.metrics || row;
    byName.set(row.name, {
      renderFps: finite(metrics.renderFps) ? metrics.renderFps : null,
      avgRenderMs: finite(metrics.avgRenderMs) ? metrics.avgRenderMs : null,
      p95FrameMs: finite(metrics.p95FrameMs) ? metrics.p95FrameMs : null,
    });
  }
  return byName;
}

function check(metric, actual, limit, compare) {
  const ok = compare === 'min' ? actual >= limit : actual <= limit;
  return { metric, actual, limit, compare, ok };
}

export function evaluateBudget(baseline, results) {
  const names = baselineScenarioNames(baseline);
  const actual = collectResults(results);
  const rows = [];

  if (!names.length) {
    return {
      verdict: VERDICT.NOT_EVALUATED,
      reason: '无基线：docs/perf-budget.json 不存在或没有任何场景基线',
      rows,
    };
  }
  if (!actual.size) {
    return {
      verdict: VERDICT.NOT_EVALUATED,
      reason: '无本次结果：没有可对比的 perf 数据',
      rows,
    };
  }

  const tolerance = baseline.tolerance || {};

  for (const name of names) {
    const entry = baseline.scenarios[name] || {};
    const base = entry.baseline || {};
    const budget = entry.budget || {};
    const current = actual.get(name);

    if (!current) {
      rows.push({ name, status: 'SKIPPED', note: '本次未运行', baseline: base, actual: null, checks: [] });
      continue;
    }

    const checks = [];

    if (finite(budget.minRenderFps) && current.renderFps != null) {
      checks.push(check('renderFps', current.renderFps, budget.minRenderFps, 'min'));
    }
    if (finite(budget.maxAvgRenderMs) && current.avgRenderMs != null) {
      checks.push(check('avgRenderMs', current.avgRenderMs, budget.maxAvgRenderMs, 'max'));
    }
    if (finite(budget.maxP95FrameMs) && current.p95FrameMs != null) {
      checks.push(check('p95FrameMs', current.p95FrameMs, budget.maxP95FrameMs, 'max'));
    }
    if (finite(tolerance.maxAvgRenderMsFactor) && finite(base.avgRenderMs) && current.avgRenderMs != null) {
      const slack = finite(tolerance.maxAvgRenderMsSlack) ? tolerance.maxAvgRenderMsSlack : 0;
      const limit = round(base.avgRenderMs * tolerance.maxAvgRenderMsFactor + slack);
      checks.push(check('avgRenderMs', current.avgRenderMs, limit, 'max'));
    }
    if (finite(tolerance.minRenderFpsFactor) && finite(base.renderFps) && current.renderFps != null) {
      const limit = round(base.renderFps * tolerance.minRenderFpsFactor);
      checks.push(check('renderFps', current.renderFps, limit, 'min'));
    }

    const failed = checks.filter((item) => !item.ok);
    const status = checks.length === 0
      ? VERDICT.NOT_EVALUATED
      : failed.length ? VERDICT.FAIL : VERDICT.PASS;
    rows.push({ name, status, baseline: base, actual: current, checks });
  }

  const evaluated = rows.filter((row) => row.status === VERDICT.PASS || row.status === VERDICT.FAIL);
  if (!evaluated.length) {
    return {
      verdict: VERDICT.NOT_EVALUATED,
      reason: '无基线：本次运行的场景都没有可用的预算/基线数值',
      rows,
    };
  }
  const failures = evaluated.filter((row) => row.status === VERDICT.FAIL);
  return { verdict: failures.length ? VERDICT.FAIL : VERDICT.PASS, rows, failures };
}

const fmt = (value, digits = 2) => (finite(value) ? value.toFixed(digits) : '—');
const delta = (current, base, digits = 3) => {
  if (!finite(current) || !finite(base)) return '—';
  const diff = current - base;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(digits)}`;
};

export function formatBudgetReport(result) {
  const lines = [`性能预算门禁：${result.verdict}`];
  if (result.reason) lines.push(`原因：${result.reason}`);
  if (result.rows?.length) {
    lines.push('');
    lines.push('| 场景 | 渲染FPS（基线→本次 Δ） | 渲染耗时ms（基线→本次 Δ） | P95帧间隔ms | 判定 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of result.rows) {
      const b = row.baseline || {};
      const a = row.actual || {};
      const fps = row.actual
        ? `${fmt(b.renderFps)}→${fmt(a.renderFps)} (${delta(a.renderFps, b.renderFps)})`
        : '—';
      const ms = row.actual
        ? `${fmt(b.avgRenderMs, 3)}→${fmt(a.avgRenderMs, 3)} (${delta(a.avgRenderMs, b.avgRenderMs)})`
        : '—';
      lines.push(`| ${row.name} | ${fps} | ${ms} | ${fmt(a.p95FrameMs, 1)} | ${row.status} |`);
    }
  }
  if (result.failures?.length) {
    lines.push('');
    lines.push('超限项：');
    for (const row of result.failures) {
      for (const item of row.checks.filter((entry) => !entry.ok)) {
        lines.push(
          `- ${row.name} · ${item.metric}: 实际 ${fmt(item.actual, 3)}，限制 ${item.compare === 'min' ? '≥' : '≤'} ${fmt(item.limit, 3)}`
        );
      }
    }
  }
  return lines.join('\n');
}

export function exitCodeFor(verdict) {
  return EXIT_CODE[verdict] ?? EXIT_CODE[VERDICT.NOT_EVALUATED];
}

function parseArgs(argv) {
  const args = { results: DEFAULT_RESULTS_PATH, baseline: DEFAULT_BASELINE_PATH };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--results') args.results = path.resolve(argv[++i]);
    else if (argv[i] === '--baseline') args.baseline = path.resolve(argv[++i]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseline = readJson(args.baseline);
  const results = readJson(args.results);
  const result = evaluateBudget(baseline, results);
  console.log(formatBudgetReport(result));
  console.log(`\n[perf:budget] ${result.verdict}（results: ${args.results}）`);
  process.exitCode = exitCodeFor(result.verdict);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
