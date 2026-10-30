// 平衡目标门禁：读取 docs/BALANCE.json（由 `node tests/balance-sim.mjs 40 --report=docs/BALANCE.json` 生成），
// 断言三档 full-unlock 通关率真实落在 BALANCE_TARGETS，且报告口径与当前目标一致、样本量充足。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIFFICULTY_ORDER } from '../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.resolve(__dirname, '..', 'docs', 'BALANCE.json');

function loadReport() {
  assert.ok(
    fs.existsSync(REPORT_PATH),
    `缺少 ${REPORT_PATH}（先跑 node tests/balance-sim.mjs 40 --report=docs/BALANCE.json）`
  );
  return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
}

test('docs/BALANCE.json 三档目标均达标且样本量充足', () => {
  const report = loadReport();
  assert.ok(report.meta.seeds >= 40, `种子数 ${report.meta.seeds} < 40`);
  assert.deepEqual(report.meta.targets, BALANCE_TARGETS, '报告目标与 BALANCE_TARGETS 不一致');
  assert.equal(report.targets.length, DIFFICULTY_ORDER.length);
  for (const row of report.targets) {
    const [low, high] = BALANCE_TARGETS[row.difficulty];
    assert.equal(row.low, low, `${row.difficulty} 目标下限`);
    assert.equal(row.high, high, `${row.difficulty} 目标上限`);
    assert.equal(row.status, '达标', `${row.difficulty} 应为达标，实际 ${row.status}（${row.winRate}）`);
    assert.ok(row.winRate >= low && row.winRate <= high, `${row.difficulty} 通关率 ${row.winRate} 越界`);
  }
});

test('docs/BALANCE.json 全解锁每档样本量 ≥ 40', () => {
  const report = loadReport();
  for (const id of DIFFICULTY_ORDER) {
    const row = report.summary.find((item) => item.difficulty === id && item.meta === 'full');
    assert.ok(row, `缺少 ${id} 全解锁汇总`);
    assert.ok(row.runs >= 40, `${id} 全解锁样本量 ${row.runs} < 40`);
    assert.ok(row.winRate >= 0 && row.winRate <= 1, `${id} 通关率非法`);
  }
});
