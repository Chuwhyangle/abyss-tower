// 肉鸽 2.0 平衡目标见证：读取 docs/BALANCE_ROGUE2.json（40 种子全解锁机器人口径），
// 断言三档 targets 均「达标」、样本量 ≥40、meta.targets 与 BALANCE_TARGETS 一致。
// 该 JSON 由 `node tests/balance-sim.mjs 40 --report=docs/BALANCE_ROGUE2.json` 生成，同种子可复现。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIFFICULTY_ORDER } from '../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.resolve(__dirname, '..', 'docs', 'BALANCE_ROGUE2.json');

const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));

test('报告元信息口径与 BALANCE_TARGETS 一致', () => {
  assert.ok(report.meta, '缺少 meta');
  assert.deepEqual(report.meta.targets, BALANCE_TARGETS);
  assert.equal(report.meta.method, '真实 Simulation + 固定机器人策略（无渲染）');
});

test('样本量 ≥ 40 种子', () => {
  assert.ok(report.meta.seeds >= 40, `seeds=${report.meta.seeds}`);
});

test('三档全解锁 targets 均「达标」', () => {
  for (const id of DIFFICULTY_ORDER) {
    const row = report.targets.find((item) => item.difficulty === id);
    assert.ok(row, `缺少 ${id}`);
    assert.equal(row.status, '达标', `${id} winRate=${row.winRate}`);
  }
});
