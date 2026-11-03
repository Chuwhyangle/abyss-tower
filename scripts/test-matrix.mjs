#!/usr/bin/env node
// 覆盖矩阵报告：把「轴 × 缝」注册表（tests/lib/axes.mjs + tests/lib/seams.mjs）交叉成矩阵，
// 识别两类覆盖洞：① 某缝无任何轴声明（未覆盖接缝）；② 某轴未声明某缝（轴 × 缝空缺格）。
// 零第三方依赖；供人/CI 查看测试分类法的覆盖形状，也供 tests/test-matrix.test.mjs 复用纯函数。
import { fileURLToPath } from 'node:url';

import { AXES } from '../tests/lib/axes.mjs';
import { SEAMS } from '../tests/lib/seams.mjs';

// 交叉矩阵：每轴一行，逐缝记录是否声明；顺带挑出未覆盖接缝、未声明格与未知缝引用。
export function computeMatrix(axes = AXES, seams = SEAMS) {
  const seamIds = seams.map((seam) => seam.id);
  const seamSet = new Set(seamIds);
  const rows = axes.map((axis) => ({
    axis: axis.id,
    // 声明到的有效缝；axis.seams 里不在 SEAMS 的 id 是注册表笔误，单独挑出来。
    declared: axis.seams.filter((id) => seamSet.has(id)),
    unknown: axis.seams.filter((id) => !seamSet.has(id)),
    coverage: Object.fromEntries(seamIds.map((id) => [id, axis.seams.includes(id)])),
  }));
  const uncoveredSeams = seamIds.filter((id) => !axes.some((axis) => axis.seams.includes(id)));
  const undeclared = [];
  for (const axis of axes) {
    for (const seam of seams) {
      if (!axis.seams.includes(seam.id)) undeclared.push({ axis: axis.id, seam: seam.id });
    }
  }
  const unknownSeams = rows.flatMap((row) => row.unknown.map((id) => ({ axis: row.axis, seam: id })));
  return { axes: rows, seams: seamIds, uncoveredSeams, undeclared, unknownSeams };
}

// 中文文本报告；`checked` 由调用方据 uncoveredSeams/unknownSeams 决定退出码。
export function formatReport(matrix) {
  const lines = [];
  const pad = Math.max(...matrix.axes.map((row) => row.axis.length), 'seam'.length);
  const cols = matrix.seams.map((id) => ({ id, width: Math.max(id.length, 2) }));
  lines.push(`test-matrix: 覆盖矩阵（${matrix.axes.length} 轴 × ${matrix.seams.length} 缝，✓=已声明 ·=未声明）`);
  lines.push(`${' '.repeat(pad)}  ${cols.map((c) => c.id.padEnd(c.width)).join('  ')}`);
  for (const row of matrix.axes) {
    const marks = cols.map((c) => (row.coverage[c.id] ? '✓' : '·').padEnd(c.width));
    lines.push(`${row.axis.padEnd(pad)}  ${marks.join('  ')}`);
  }
  const uncovered = matrix.uncoveredSeams;
  lines.push(`test-matrix: 未覆盖接缝（无任何轴声明）：${uncovered.length ? uncovered.join(', ') : '无'}`);
  const unknown = matrix.unknownSeams.map(({ axis, seam }) => `${axis} 声明了未知缝 ${seam}`);
  lines.push(`test-matrix: 未知缝引用：${unknown.length ? unknown.join('；') : '无'}`);
  lines.push(`test-matrix: 某轴未声明某缝（共 ${matrix.undeclared.length} 个空缺格）：`);
  const byAxis = new Map(matrix.axes.map((row) => [row.axis, []]));
  for (const { axis, seam } of matrix.undeclared) byAxis.get(axis).push(seam);
  for (const [axis, missing] of byAxis) {
    lines.push(`  ${axis}：${missing.join('、')}`);
  }
  return lines;
}

function main() {
  const matrix = computeMatrix();
  console.log(formatReport(matrix).join('\n'));
  if (matrix.uncoveredSeams.length > 0 || matrix.unknownSeams.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
