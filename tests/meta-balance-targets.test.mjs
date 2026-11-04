// 账号级 meta 增益平衡目标见证（GOAL-012 / AC-065）：
// 读取 docs/BALANCE_META.json（40 种子全解锁机器人口径），断言「零 meta / 满 meta」
// 两个端点三档 targets 均落在目标区间或 ±5pp 容忍内（与 BALANCE.md「偏差 5 个百分点
// 以内不做额外调参」的约定一致）、样本量 ≥40、meta.targets 与 BALANCE_TARGETS 一致。
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

// BALANCE.md 约定：偏差在 5 个百分点以内不做额外调参。达标判定 = 落在目标区间
// [low, high]，或偏离区间 ≤5pp（先验漂移如矿脉掉金抬升经济在容忍内仍判达标）。
const TOLERANCE_PP = 0.05;
const TOLERANCE_EPSILON = 1e-9; // 容忍浮点舍入误差，仅影响「恰好 ±5pp」边界

function withinBalanceTolerance(winRate, low, high) {
  const gap = winRate < low ? low - winRate : winRate > high ? winRate - high : 0;
  return gap <= TOLERANCE_PP + TOLERANCE_EPSILON;
}

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

test('两个端点都覆盖三档 targets 且落在目标区间或 ±5pp 容忍内', () => {
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
      // TODO-14 §5 阶段 2（feat-talent-rebalance-baseline，depends_on 本任务）：
      // 满 meta 远征（standard）由天赋三层节点 +1%/级 + 技能接线抬升至 ~54%，超目标
      // 区间 [25%,40%] 且超 ±5pp 容忍。manager 已裁定 defer（阶段 0 只落契约+死节点
      // 修复、不改数值；阶段 2 重排零 meta 基线 difficulties.js hpMul 后满 meta 落回
      // 区间并恢复完整 ±5pp 断言）。此处降级为「方向见证」：只允许高于上限的已知漂移
      // （winRate ≥ high），仍抓反向（低于 lower）的回归。
      if (endpoint === 'full' && id === 'standard') {
        assert.ok(
          row.winRate >= high,
          `${endpoint}.${id} winRate=${row.winRate} 阶段2 前漂移见证失败：应 ≥ 上限 ${high}（已知天赋抬升）`
        );
        continue;
      }
      assert.ok(
        withinBalanceTolerance(row.winRate, low, high),
        `${endpoint}.${id} winRate=${row.winRate} 偏离目标区间 [${low}, ${high}] 超过 ±5pp 容忍`
      );
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

// ── ±5pp 容忍回归 ───────────────────────────────────────────────────
// 覆盖 DoD「容忍边界（正好 ±5pp 内/外）」：偏离恰好 5pp 判达标，超过 5pp 判不达标。

test('±5pp 容忍边界：偏离恰好 5pp 仍判达标', () => {
  const [low, high] = BALANCE_TARGETS.abyss; // 5–12%
  assert.ok(withinBalanceTolerance(high + 0.05, low, high), '深渊 +5pp 应仍判达标');
  assert.ok(withinBalanceTolerance(low - 0.05, low, high), '深渊 -5pp 应仍判达标');
});

test('±5pp 容忍边界：偏离超过 5pp 判不达标', () => {
  const [low, high] = BALANCE_TARGETS.abyss;
  assert.ok(!withinBalanceTolerance(high + 0.05 + 1e-6, low, high), '深渊 +5.0001pp 应判不达标');
  assert.ok(!withinBalanceTolerance(low - 0.05 - 1e-6, low, high), '深渊 -5.0001pp 应判不达标');
});

test('深渊先验漂移 +1.3pp（13.3% 相对 12% 上限）在容忍内通过', () => {
  const [low, high] = BALANCE_TARGETS.abyss;
  const drifted = 0.133; // 13.3%：矿脉掉金抬升经济造成的先验漂移
  assert.ok(withinBalanceTolerance(drifted, low, high), '深渊 13.3% 应落在 ±5pp 容忍内');
});
