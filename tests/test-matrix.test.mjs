// 测试分类法（TODO-13 第 2 步）自证 + 示范：
//   - 轴测试：每条轴一条 node:test，遍历整根轴的变体（buildScenario 最小场景 + 断言）。
//   - 缝测试：每条缝一条 node:test，遍历「声明了该缝的轴」的变体。
//   - 覆盖矩阵：scripts/test-matrix.mjs 的纯函数交叉轴/缝，识别未覆盖接缝与「某轴未声明某缝」。
// 纪律：新维度只登记 1 轴（+1 测试）+ 声明 k 缝（+k 缝覆盖），测试数加法级增长，不 ×N。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { AXES, AXIS_BY_ID, axesForSeam } from './lib/axes.mjs';
import { SEAMS, SEAM_BY_ID } from './lib/seams.mjs';
import { buildScenario } from './lib/scenario.mjs';
import { computeMatrix, formatReport } from '../scripts/test-matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'test-matrix.mjs');

// ---------- 轴测试：一条 node:test 遍历整根轴 ----------

for (const axis of AXES) {
  test(`轴·${axis.name}（${axis.variants.length} 变体）`, () => {
    assert.ok(axis.variants.length > 0, `轴 ${axis.id} 至少应有一个变体`);
    for (const variant of axis.variants) {
      const sc = buildScenario(axis.specFor(variant));
      axis.run(sc, variant);
    }
  });
}

// ---------- 缝测试：一条 node:test 遍历声明了该缝的轴 ----------

for (const seam of SEAMS) {
  const declaring = axesForSeam(seam.id);
  test(`缝·${seam.name}（${declaring.length} 轴）`, () => {
    assert.ok(declaring.length > 0, `缝 ${seam.id} 应至少被一个轴声明`);
    for (const axis of declaring) {
      for (const variant of axis.variants) {
        const sc = buildScenario(axis.specFor(variant));
        seam.assert(sc, axis, variant);
      }
    }
  });
}

// ---------- 注册表：轴/缝 id 唯一，引用一致 ----------

test('注册表：轴/缝 id 唯一，轴声明的缝均真实存在', () => {
  assert.equal(AXES.length, new Set(AXES.map((a) => a.id)).size, '轴 id 应唯一');
  assert.equal(SEAMS.length, new Set(SEAMS.map((s) => s.id)).size, '缝 id 应唯一');
  for (const axis of AXES) {
    for (const seamId of axis.seams) {
      assert.ok(SEAM_BY_ID[seamId], `轴 ${axis.id} 声明了不存在的缝 ${seamId}`);
    }
  }
});

test('注册表：至少覆盖 塔/海克斯/遗物/技能/地图/难度 六轴与五缝', () => {
  for (const id of ['tower', 'hex', 'relic', 'skill', 'map', 'difficulty']) {
    assert.ok(AXIS_BY_ID[id], `缺轴 ${id}`);
  }
  for (const id of ['mods', 'hooks', 'snapshot', 'replay', 'mode']) {
    assert.ok(SEAM_BY_ID[id], `缺缝 ${id}`);
  }
});

// ---------- 覆盖矩阵：交叉 + 洞识别 ----------

test('覆盖矩阵：无未覆盖接缝，能识别「某轴未声明某缝」', () => {
  const matrix = computeMatrix();
  assert.equal(matrix.axes.length, AXES.length);
  assert.equal(matrix.seams.length, SEAMS.length);
  assert.deepEqual(matrix.uncoveredSeams, [], '每条缝都应被至少一个轴声明');
  assert.deepEqual(matrix.unknownSeams, [], '轴不得声明未知缝');

  // 具体识别一条「某轴未声明某缝」的空缺格。
  const pair = matrix.undeclared.find((u) => u.axis === 'skill' && u.seam === 'mods');
  assert.ok(pair, '应识别出 skill 轴未声明 mods 缝');

  const report = formatReport(matrix);
  assert.match(report.join('\n'), /覆盖矩阵/);
  assert.match(report.join('\n'), /未覆盖接缝/);
  assert.match(report.join('\n'), /某轴未声明某缝/);
});

test('覆盖矩阵报告脚本：可执行并输出矩阵', () => {
  const result = spawnSync(process.execPath, ['--no-warnings', SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, `脚本应退出 0：${result.stderr || ''}`);
  assert.match(result.stdout, /覆盖矩阵（\d+ 轴 × \d+ 缝/);
  assert.match(result.stdout, /未覆盖接缝（无任何轴声明）：无/);
});
