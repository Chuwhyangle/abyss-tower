// 地图深度：原型 ≥6、词缀 ≥8、固定种子可复现、原型 × 词缀全组合连通。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHETYPES,
  MAP_MODIFIERS,
  buildCandidate,
  generateMapCandidates,
} from '../public/js/shared/mapgen.js';

const ARCHETYPE_IDS = Object.keys(ARCHETYPES);
const IMPLEMENTED_MODIFIER_PARAMS = new Set([
  'id',
  'name',
  'color',
  'desc',
  'hpMul',
  'speedMul',
  'goldMul',
  'rangeMul',
  'scoreMul',
  'extraPortal',
]);

function assertLegalCandidate(candidate, archetype, modifier, label) {
  const { cols, rows } = candidate;
  const expectedPortals = Math.min(
    3,
    archetype.spawns + (modifier?.extraPortal || 0)
  );

  assert.equal(candidate.lanes.length, expectedPortals, `${label} lanes`);
  assert.equal(candidate.spawns.length, expectedPortals, `${label} spawns`);
  assert.equal(candidate.meta.portalCount, expectedPortals, `${label} portalCount`);
  assert.equal(candidate.base.c, cols - 1, `${label} 基地在右边缘`);

  for (const [index, lane] of candidate.lanes.entries()) {
    assert.ok(lane.cells.length >= 8, `${label} lane ${index} 太短`);
    assert.equal(lane.cells[0].c, 0, `${label} lane ${index} 入口在左边缘`);
    assert.equal(lane.polyline[0].x, lane.cells[0].c + 0.5, `${label} lane ${index} 折线起点`);

    for (let i = 1; i < lane.cells.length; i++) {
      const prev = lane.cells[i - 1];
      const cur = lane.cells[i];
      const step = Math.abs(cur.c - prev.c) + Math.abs(cur.r - prev.r);
      assert.equal(step, 1, `${label} lane ${index} 第 ${i} 步不连通`);
      assert.ok(cur.c >= 0 && cur.c < cols && cur.r >= 0 && cur.r < rows);
    }

    const last = lane.cells[lane.cells.length - 1];
    assert.equal(last.c, candidate.base.c, `${label} lane ${index} 终点 x`);
    assert.equal(last.r, candidate.base.r, `${label} lane ${index} 终点 y`);
    const polylineEnd = lane.polyline[lane.polyline.length - 1];
    assert.equal(polylineEnd.x, candidate.base.x, `${label} lane ${index} 折线终点 x`);
    assert.equal(polylineEnd.y, candidate.base.y, `${label} lane ${index} 折线终点 y`);
  }
}

test('地图原型 ≥6，每个原型有中文名与玩法描述', () => {
  assert.ok(ARCHETYPE_IDS.length >= 6, `原型数量 ${ARCHETYPE_IDS.length} < 6`);
  for (const id of ARCHETYPE_IDS) {
    const archetype = ARCHETYPES[id];
    assert.equal(archetype.id, id);
    assert.ok(archetype.name.length > 0, `${id} 缺少名称`);
    assert.ok(archetype.desc.length > 0, `${id} 缺少描述`);
    assert.ok(archetype.spawns >= 1 && archetype.spawns <= 3, `${id} 入口数非法`);
    assert.ok(archetype.scoreMul >= 0.9 && archetype.scoreMul <= 1.25, `${id} scoreMul 越界`);
  }
});

test('地图词缀 ≥8，只使用已实现的 mapMeta 参数，且都有可读名称/说明', () => {
  assert.ok(MAP_MODIFIERS.length >= 8, `词缀数量 ${MAP_MODIFIERS.length} < 8`);
  const ids = new Set();
  for (const modifier of MAP_MODIFIERS) {
    assert.ok(!ids.has(modifier.id), `词缀 id 重复：${modifier.id}`);
    ids.add(modifier.id);
    assert.ok(modifier.name.length > 0, `${modifier.id} 缺少名称`);
    assert.ok(modifier.desc.length > 0, `${modifier.id} 缺少说明`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(modifier.color), `${modifier.id} 缺少可读配色`);
    for (const key of Object.keys(modifier)) {
      assert.ok(
        IMPLEMENTED_MODIFIER_PARAMS.has(key),
        `${modifier.id} 使用了未实现的参数：${key}`
      );
    }
    for (const key of ['hpMul', 'speedMul', 'goldMul', 'rangeMul', 'scoreMul']) {
      assert.ok(
        Number.isFinite(modifier[key]) && modifier[key] > 0,
        `${modifier.id}.${key} 非法`
      );
    }
    assert.ok(Number.isInteger(modifier.extraPortal), `${modifier.id}.extraPortal 非法`);
  }
});

test('固定种子生成结果可复现', () => {
  const first = generateMapCandidates('depth-fixed-seed', 3);
  const second = generateMapCandidates('depth-fixed-seed', 3);
  assert.deepEqual(first, second);

  const candidate = buildCandidate('depth-build-seed', 'switchback', MAP_MODIFIERS[0], 0);
  const again = buildCandidate('depth-build-seed', 'switchback', MAP_MODIFIERS[0], 0);
  assert.deepEqual(candidate, again);

  const signatures = new Set(
    first.map((item) => `${item.archetype}|${item.modifier?.id}|${item.meta.scoreMul}`)
  );
  assert.equal(signatures.size, first.length, '同局候选不应重复');
});

test('所有原型 × 词缀组合都能生成入口→基地的连通路径', () => {
  for (const seed of ['depth-a', 'depth-b']) {
    for (const archetypeId of ARCHETYPE_IDS) {
      const archetype = ARCHETYPES[archetypeId];
      for (const modifier of MAP_MODIFIERS) {
        const label = `${seed}/${archetypeId}/${modifier.id}`;
        const candidate = buildCandidate(seed, archetypeId, modifier, 0);
        assert.equal(candidate.archetype, archetypeId, `${label} 原型`);
        assert.equal(candidate.modifier?.id, modifier.id, `${label} 词缀`);
        assert.ok(
          candidate.meta.scoreMul >= 0.9 && candidate.meta.scoreMul <= 1.25,
          `${label} scoreMul 越界`
        );
        assertLegalCandidate(candidate, archetype, modifier, label);
      }
    }
  }
});

test('每个原型都能进入候选池', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    for (const candidate of generateMapCandidates(`depth-pool-${i}`, 3)) {
      seen.add(candidate.archetype);
    }
  }
  for (const id of ARCHETYPE_IDS) {
    assert.ok(seen.has(id), `原型 ${id} 从未进入候选池`);
  }
});

test('每个词缀都能进入候选池', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    for (const candidate of generateMapCandidates(`depth-mod-pool-${i}`, 3)) {
      if (candidate.modifier) seen.add(candidate.modifier.id);
    }
  }
  for (const modifier of MAP_MODIFIERS) {
    assert.ok(seen.has(modifier.id), `词缀 ${modifier.id} 从未进入候选池`);
  }
});
