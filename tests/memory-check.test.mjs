import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_THRESHOLDS,
  evaluateMemoryTrend,
  formatMemoryTrend,
  linearTrend,
  parseArgs,
} from '../scripts/memory-check.mjs';

const MB = MEMORY_THRESHOLDS.bytesPerMB;
const toBytes = (values) => values.map((value) => value * MB);

test('阈值集中定义且不可被运行期篡改', () => {
  assert.ok(Object.isFrozen(MEMORY_THRESHOLDS));
  assert.equal(typeof MEMORY_THRESHOLDS.minRounds, 'number');
  assert.equal(typeof MEMORY_THRESHOLDS.maxGrowthPerRoundMB, 'number');
  assert.equal(typeof MEMORY_THRESHOLDS.maxTotalGrowthMB, 'number');
  assert.equal(MEMORY_THRESHOLDS.bytesPerMB, 1024 * 1024);
});

test('线性回归还原已知直线的斜率与截距', () => {
  const trend = linearTrend([0, 10, 20, 30]);
  assert.equal(trend.ok, true);
  assert.equal(trend.n, 4);
  assert.equal(trend.slope, 10);
  assert.equal(trend.intercept, 0);
});

test('线性回归在样本不足时不给出斜率', () => {
  assert.equal(linearTrend([]).ok, false);
  assert.equal(linearTrend([5]).ok, false);
  assert.equal(linearTrend([5]).slope, null);
});

test('样本恰好达到最少轮数时参与判定', () => {
  const result = evaluateMemoryTrend(toBytes([100, 100, 100, 100]));
  assert.equal(result.n, MEMORY_THRESHOLDS.minRounds);
  assert.equal(result.status, 'pass');
  assert.equal(result.slopeMBPerRound, 0);
  assert.equal(result.totalGrowthMB, 0);
});

test('每轮增长等于阈值时通过，超过则判为疑似泄漏', () => {
  const atLimit = evaluateMemoryTrend(toBytes([100, 102, 104, 106]));
  assert.equal(atLimit.status, 'pass');
  assert.equal(atLimit.slopeMBPerRound, MEMORY_THRESHOLDS.maxGrowthPerRoundMB);

  const overLimit = evaluateMemoryTrend(toBytes([100, 102.1, 104.2, 106.3]));
  assert.equal(overLimit.status, 'fail');
  assert.ok(overLimit.slopeMBPerRound > MEMORY_THRESHOLDS.maxGrowthPerRoundMB);
  assert.match(overLimit.reasons.join(' '), /每轮增长/);
});

test('总增长等于阈值时通过，超过则判为疑似泄漏', () => {
  const thresholds = { ...MEMORY_THRESHOLDS, maxGrowthPerRoundMB: 100 };
  const atLimit = evaluateMemoryTrend(toBytes([100, 105, 110, 116]), thresholds);
  assert.equal(atLimit.totalGrowthMB, MEMORY_THRESHOLDS.maxTotalGrowthMB);
  assert.equal(atLimit.status, 'pass');

  const overLimit = evaluateMemoryTrend(toBytes([100, 105, 110, 116.5]), thresholds);
  assert.equal(overLimit.status, 'fail');
  assert.match(overLimit.reasons.join(' '), /总增长/);
});

test('样本不足时输出未评估，而不是伪装成通过', () => {
  const result = evaluateMemoryTrend(toBytes([100, 101]));
  assert.equal(result.status, 'not-evaluated');
  assert.equal(result.slopeMBPerRound, null);
  assert.match(result.reasons.join(' '), /有效样本不足/);

  const lines = formatMemoryTrend(result).join('\n');
  assert.match(lines, /未评估/);
  assert.doesNotMatch(lines, /结论：通过/);
});

test('无效样本被剔除，全部无效时仍是未评估', () => {
  const mixed = evaluateMemoryTrend([NaN, undefined, -1, 0, null, Infinity]);
  assert.equal(mixed.n, 0);
  assert.equal(mixed.status, 'not-evaluated');

  const partial = evaluateMemoryTrend([...toBytes([100, 101]), null, 'x']);
  assert.equal(partial.n, 2);
  assert.equal(partial.status, 'not-evaluated');
});

test('通过结论带趋势与阈值，失败结论点名超标项', () => {
  const pass = formatMemoryTrend(evaluateMemoryTrend(toBytes([100, 100.5, 101, 101.5]))).join('\n');
  assert.match(pass, /线性趋势：\+0\.50 MB\/轮/);
  assert.match(pass, /总增长 \+1\.50 MB/);
  assert.match(pass, /结论：通过/);

  const fail = formatMemoryTrend(evaluateMemoryTrend(toBytes([100, 103, 106, 109]))).join('\n');
  assert.match(fail, /结论：疑似泄漏/);
  assert.match(fail, /每轮增长/);
});

test('CLI 参数解析：默认值、等号写法与非法输入', () => {
  assert.deepEqual(parseArgs([]), { rounds: 6, warmup: 1, combatMs: 1200, help: false });
  assert.deepEqual(parseArgs(['--rounds', '3', '--warmup=0', '--combat-ms', '500']), {
    rounds: 3,
    warmup: 0,
    combatMs: 500,
    help: false,
  });
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--rounds', 'abc']), /非负整数/);
  assert.throws(() => parseArgs(['--rounds', '-1']), /非负整数/);
  assert.throws(() => parseArgs(['--unknown']), /未知参数/);
});
