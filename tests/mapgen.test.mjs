import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../public/js/shared/mapgen.js';

test('地图生成：起点/终点、连续性、唯一性与可建造比例', () => {
  for (let i = 0; i < 60; i++) {
    const map = generateMap(`map-seed-${i}`);
    const { cols, rows, pathCells, polyline, buildable } = map;

    assert.equal(cols, 22);
    assert.equal(rows, 12);
    assert.ok(pathCells.length >= 3);
    assert.equal(pathCells[0].c, 0, '起点必须在左边缘');
    assert.equal(pathCells[pathCells.length - 1].c, cols - 1, '终点必须在右边缘');

    const seen = new Set();
    for (const cell of pathCells) {
      assert.ok(cell.c >= 0 && cell.c < cols);
      assert.ok(cell.r >= 0 && cell.r < rows);
      const key = `${cell.c},${cell.r}`;
      assert.ok(!seen.has(key), `路径重复格 ${key}`);
      seen.add(key);
    }

    for (let j = 1; j < polyline.length; j++) {
      const a = polyline[j - 1];
      const b = polyline[j];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      assert.ok(
        (dx < 1e-9 && dy > 0) || (dy < 1e-9 && dx > 0),
        `路径段不是轴对齐: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`
      );
    }

    let buildableCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (buildable[r][c]) {
          buildableCount++;
          assert.ok(!seen.has(`${c},${r}`), '路径格不可建造');
        }
      }
    }
    const freeCells = rows * cols - pathCells.length;
    assert.ok(
      buildableCount / freeCells > 0.4,
      `可建造比例过低：${buildableCount}/${freeCells}`
    );
  }
});

test('地图生成：同种子一致，不同种子有差异', () => {
  const a = generateMap('determinism-seed');
  const b = generateMap('determinism-seed');
  assert.deepEqual(a.polyline, b.polyline);
  assert.deepEqual(a.buildable, b.buildable);

  const signatures = new Set();
  for (let i = 0; i < 20; i++) {
    const map = generateMap(`variety-${i}`);
    signatures.add(map.polyline.map((p) => `${p.x},${p.y}`).join('|'));
  }
  assert.ok(signatures.size > 5, '地图变化不足');
});
