// 账号级 meta 增益平衡目标见证（GOAL-012 / AC-065）：
// 读取 docs/BALANCE_META.json（40 种子全解锁机器人口径），断言「零 meta / 满 meta」
// 两个端点三档 targets 均「达标」、样本量 ≥40、meta.targets 与 BALANCE_TARGETS 一致。
// 该 JSON 由 `node tests/balance-sim.mjs 40 --report=docs/BALANCE_META.json` 生成，同种子可复现。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIFFICULTY_ORDER } from '../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';
import { TALENT_NODES } from '../public/js/shared/data/meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.resolve(__dirname, '..', 'docs', 'BALANCE_META.json');

const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));

test('报告元信息口径与 BALANCE_TARGETS 一致', () => {
  assert.ok(report.meta, '缺少 meta');
  assert.deepEqual(report.meta.targets, BALANCE_TARGETS);
  assert.deepEqual(report.meta.difficultyOrder, DIFFICULTY_ORDER);
  assert.deepEqual(report.meta.endpoints, ['zero', 'full']);
  assert.equal(report.meta.method, '真实 Simulation + 固定机器人策略（无渲染）');
});

test('样本量 ≥ 40 种子', () => {
  assert.ok(report.meta.seeds >= 40, `seeds=${report.meta.seeds}`);
});

test('两个端点都覆盖三档 targets 且均「达标」', () => {
  for (const endpoint of ['zero', 'full']) {
    const section = report.endpoints[endpoint];
    assert.ok(section, `缺少 endpoints.${endpoint}`);
    assert.equal(section.targets.length, DIFFICULTY_ORDER.length, `${endpoint} targets 数量`);
    for (const id of DIFFICULTY_ORDER) {
      const row = section.targets.find((item) => item.difficulty === id);
      assert.ok(row, `${endpoint} 缺少 ${id}`);
      const [low, high] = BALANCE_TARGETS[id];
      assert.equal(row.low, low);
      assert.equal(row.high, high);
      assert.equal(row.status, '达标', `${endpoint}.${id} winRate=${row.winRate}`);
      assert.ok(row.winRate >= low && row.winRate <= high, `${endpoint}.${id} 越界`);
    }
  }
});

test('端点天赋状态符合定义：零 meta 无投入、满 meta 全部节点满级', () => {
  const zero = report.endpoints.zero.talent;
  const full = report.endpoints.full.talent;
  assert.equal(zero.points, 0);
  assert.deepEqual(zero.nodes, {});
  const maxRankSum = TALENT_NODES.reduce((sum, node) => sum + node.maxRank, 0);
  assert.equal(full.points, maxRankSum);
  for (const node of TALENT_NODES) {
    assert.equal(full.nodes[node.id], node.maxRank, `满 meta 节点 ${node.id}`);
  }
});
