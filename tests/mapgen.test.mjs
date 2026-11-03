import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, legacyGenerateMap } from '../public/js/shared/mapgen.js';

test('地图生成：起点/终点、连续性、唯一性与可建造比例', () => {
  for (let i = 0; i < 60; i++) {
    const map = generateMap(`map-seed-${i}`);
    const { cols, rows, pathCells, polyline, buildable } = map;

    assert.equal(cols, 22);
    assert.equal(rows, 12);
    assert.ok(pathCells.length >= 3);
    assert.equal(pathCells[0].c, 0, '起点必须在左边缘');
    assert.deepEqual(
      { c: pathCells[pathCells.length - 1].c, r: pathCells[pathCells.length - 1].r },
      { c: map.base.c, r: map.base.r },
      '路径终点必须落在基地'
    );

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
    // 固定地图改为贴路塔位掩码后不再全图可建：可建造格偏少但仍存在，且不压路径。
    assert.ok(
      buildableCount > 0 && buildableCount < freeCells,
      `可建造格数异常：${buildableCount}/${freeCells}`
    );
  }
});

test('地图生成：固定 map 与种子无关；legacy 入口仍保留随机变化', () => {
  const a = generateMap('determinism-seed');
  const b = generateMap('determinism-seed');
  assert.deepEqual(a.polyline, b.polyline);
  assert.deepEqual(a.buildable, b.buildable);

  // 新开局：同一张固定 canyon，换种子不改变几何。
  const fixedSignatures = new Set();
  for (let i = 0; i < 20; i++) {
    const map = generateMap(`variety-${i}`);
    fixedSignatures.add(map.polyline.map((p) => `${p.x},${p.y}`).join('|'));
  }
  assert.equal(fixedSignatures.size, 1, '固定地图不应随种子变化');

  // 旧存档回退：legacyGenerateMap 仍按种子随机 carve。
  const legacySignatures = new Set();
  for (let i = 0; i < 20; i++) {
    const map = legacyGenerateMap(`variety-${i}`);
    legacySignatures.add(map.polyline.map((p) => `${p.x},${p.y}`).join('|'));
  }
  assert.ok(legacySignatures.size > 5, 'legacy 地图变化不足');
});
