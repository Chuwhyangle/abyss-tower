// 性能预算门禁的纯函数与 CLI 退出码：通过 / 超限 / 无基线时 NOT-EVALUATED。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASELINE_PATH,
  VERDICT,
  baselineScenarioNames,
  collectResults,
  evaluateBudget,
  exitCodeFor,
  formatBudgetReport,
  readJson,
} from '../scripts/perf-budget.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/perf-budget.mjs', import.meta.url));

function fixtureBaseline() {
  return {
    tolerance: { maxAvgRenderMsFactor: 1.5, maxAvgRenderMsSlack: 0.5, minRenderFpsFactor: 0.7 },
    scenarios: {
      'normal-1x-low': {
        baseline: { renderFps: 30, avgRenderMs: 1, p95FrameMs: 16.7 },
        budget: { minRenderFps: 20, maxAvgRenderMs: 2.5, maxP95FrameMs: 25 },
      },
    },
  };
}

function run(name, metrics) {
  return { results: [{ name, metrics }] };
}

const OK_METRICS = { renderFps: 29.5, avgRenderMs: 1.1, p95FrameMs: 16.8 };

test('达标时判定 PASS', () => {
  const result = evaluateBudget(fixtureBaseline(), run('normal-1x-low', OK_METRICS));
  assert.equal(result.verdict, VERDICT.PASS);
  assert.equal(result.failures.length, 0);
  assert.ok(result.rows[0].checks.every((item) => item.ok));
});

test('渲染 FPS 低于预算下限时判定 FAIL', () => {
  const result = evaluateBudget(
    fixtureBaseline(),
    run('normal-1x-low', { ...OK_METRICS, renderFps: 10 })
  );
  assert.equal(result.verdict, VERDICT.FAIL);
  const failed = result.failures[0].checks.filter((item) => !item.ok);
  assert.ok(failed.some((item) => item.metric === 'renderFps' && item.compare === 'min'));
});

test('渲染耗时超过绝对预算时判定 FAIL', () => {
  const result = evaluateBudget(
    fixtureBaseline(),
    run('normal-1x-low', { ...OK_METRICS, avgRenderMs: 9 })
  );
  assert.equal(result.verdict, VERDICT.FAIL);
  assert.ok(
    result.failures[0].checks.some(
      (item) => item.metric === 'avgRenderMs' && item.limit === 2.5 && !item.ok
    )
  );
});

test('P95 帧间隔超预算时判定 FAIL', () => {
  const result = evaluateBudget(
    fixtureBaseline(),
    run('normal-1x-low', { ...OK_METRICS, p95FrameMs: 40 })
  );
  assert.equal(result.verdict, VERDICT.FAIL);
});

test('相对基线的耗时回归超容差时判定 FAIL', () => {
  const baseline = fixtureBaseline();
  // 1 * 1.5 + 0.5 = 2.0；给 2.1 应超限，同时仍低于绝对预算 2.5。
  const result = evaluateBudget(
    baseline,
    run('normal-1x-low', { ...OK_METRICS, avgRenderMs: 2.1 })
  );
  assert.equal(result.verdict, VERDICT.FAIL);
  assert.ok(
    result.failures[0].checks.some(
      (item) => item.metric === 'avgRenderMs' && item.limit === 2 && !item.ok
    )
  );
});

test('无基线时明确 NOT-EVALUATED，不伪装成通过', () => {
  for (const baseline of [null, {}, { scenarios: {} }]) {
    const result = evaluateBudget(baseline, run('normal-1x-low', OK_METRICS));
    assert.equal(result.verdict, VERDICT.NOT_EVALUATED);
    assert.match(result.reason, /无基线/);
    assert.equal(exitCodeFor(result.verdict), 2);
  }
});

test('无本次结果时 NOT-EVALUATED', () => {
  for (const results of [null, {}, { results: [] }]) {
    const result = evaluateBudget(fixtureBaseline(), results);
    assert.equal(result.verdict, VERDICT.NOT_EVALUATED);
  }
});

test('基线场景本次未运行时该场景记为 SKIPPED 且整体 NOT-EVALUATED', () => {
  const result = evaluateBudget(fixtureBaseline(), run('other-scene', OK_METRICS));
  assert.equal(result.verdict, VERDICT.NOT_EVALUATED);
  assert.equal(result.rows[0].status, 'SKIPPED');
});

test('collectResults 容忍完整 report 与裸数组，缺失指标保持 null', () => {
  const parsed = collectResults([
    { name: 'a', metrics: { renderFps: 30, avgRenderMs: 1 } },
    { name: 'b', renderFps: 20 },
    { metrics: {} },
  ]);
  assert.deepEqual(parsed.get('a'), { renderFps: 30, avgRenderMs: 1, p95FrameMs: null });
  assert.deepEqual(parsed.get('b'), { renderFps: 20, avgRenderMs: null, p95FrameMs: null });
  assert.equal(parsed.size, 2);
});

test('对比表包含基线→本次与超限项', () => {
  const result = evaluateBudget(
    fixtureBaseline(),
    run('normal-1x-low', { renderFps: 10, avgRenderMs: 1.1, p95FrameMs: 16.8 })
  );
  const text = formatBudgetReport(result);
  assert.match(text, /normal-1x-low/);
  assert.match(text, /30\.00→10\.00/);
  assert.match(text, /超限项/);
  assert.match(text, /渲染FPS/);
});

test('仓库内的预算文件存在且预算值齐全', () => {
  const baseline = readJson(DEFAULT_BASELINE_PATH);
  assert.ok(baseline, 'docs/perf-budget.json 必须存在且可解析');
  const names = baselineScenarioNames(baseline);
  assert.deepEqual(
    names.sort(),
    ['late-3x-high', 'normal-1x-low', 'skills-1x-high']
  );
  for (const key of ['maxAvgRenderMsFactor', 'maxAvgRenderMsSlack', 'minRenderFpsFactor']) {
    assert.equal(typeof baseline.tolerance[key], 'number', `tolerance.${key} 必须是数字`);
  }
  for (const name of names) {
    const entry = baseline.scenarios[name];
    for (const key of ['renderFps', 'avgRenderMs', 'p95FrameMs']) {
      assert.equal(typeof entry.baseline[key], 'number', `${name}.baseline.${key}`);
    }
    for (const key of ['minRenderFps', 'maxAvgRenderMs', 'maxP95FrameMs']) {
      assert.equal(typeof entry.budget[key], 'number', `${name}.budget.${key}`);
    }
  }
});

function writeTemp(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function runCli(resultsFile, baselineFile = DEFAULT_BASELINE_PATH) {
  return spawnSync(process.execPath, [SCRIPT, '--results', resultsFile, '--baseline', baselineFile], {
    encoding: 'utf8',
  });
}

test('CLI：达标退出 0，超限退出 1，无基线退出 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-budget-'));
  try {
    const baseline = readJson(DEFAULT_BASELINE_PATH);
    const baselineResults = Object.entries(baseline.scenarios).map(([name, entry]) => ({
      name,
      metrics: { ...entry.baseline },
    }));

    const passFile = writeTemp(dir, 'pass.json', { results: baselineResults });
    const pass = runCli(passFile);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /性能预算门禁：PASS/);

    const failResults = baselineResults.map((row) =>
      row.name === 'normal-1x-low'
        ? { ...row, metrics: { ...row.metrics, renderFps: 1 } }
        : row
    );
    const failFile = writeTemp(dir, 'fail.json', { results: failResults });
    const fail = runCli(failFile);
    assert.equal(fail.status, 1, fail.stdout + fail.stderr);
    assert.match(fail.stdout, /性能预算门禁：FAIL/);
    assert.match(fail.stdout, /超限项/);

    const emptyFile = writeTemp(dir, 'empty.json', { results: [] });
    const unevaluated = runCli(emptyFile);
    assert.equal(unevaluated.status, 2, unevaluated.stdout + unevaluated.stderr);
    assert.match(unevaluated.stdout, /NOT-EVALUATED/);

    const missingBaseline = runCli(passFile, path.join(dir, 'missing.json'));
    assert.equal(missingBaseline.status, 2, missingBaseline.stdout + missingBaseline.stderr);
    assert.match(missingBaseline.stdout, /未评估|无基线/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
