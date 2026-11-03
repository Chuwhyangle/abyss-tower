// 可破坏物数据模型：类型数值、三张固定地图的布点分布、布点校验与拆除幂等。
// 对应 MAP-003 的验收标准：node --test tests/destructibles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESTRUCTIBLE_BY_ID,
  DESTRUCTIBLE_TYPES,
  MIN_SPAWN_DISTANCE,
  destructibleTypeOf,
  isFreeDestructible,
  markDestroyed,
  validateDestructible,
  validateDestructibles,
} from '../public/js/shared/destructibles.js';
import { FIXED_MAPS, FIXED_MAP_BY_ID, fixedMapCandidates } from '../public/js/shared/maps/index.js';
import { generateMap, generateMapCandidates } from '../public/js/shared/mapgen.js';

const EXPECTED_IDS = ['vein', 'obelisk', 'cache', 'nest', 'totem'];

// 任务书里的每张图数量与类型分布。resourceVein（可攻击资源矿脉）不进五类注册表，单独计数。
const EXPECTED_DISTRIBUTION = {
  canyon: { total: 9, vein: 2, obelisk: 1, cache: 1, nest: 1, totem: 1, resourceVein: 3 },
  twin: { total: 10, vein: 2, obelisk: 2, cache: 1, nest: 1, totem: 1, resourceVein: 3 },
  ring: { total: 12, vein: 3, obelisk: 2, cache: 2, nest: 1, totem: 1, resourceVein: 3 },
};

const TYPE_FIELDS = ['id', 'name', 'glyph', 'color', 'desc', 'cost', 'effect'];

function chebyshev(a, b) {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}

// 合成小地图：一行路径 (0,3)→(8,3)，基地 (8,3)，(3,1) 是岩石，其余可建造。
// 负例测试用它精确定位每一种违规原因，不依赖三张真实地图的具体格子。
function syntheticMap(destructibles = []) {
  const cols = 9;
  const rows = 6;
  const pathCells = [];
  for (let c = 0; c < cols; c++) pathCells.push({ c, r: 3 });
  const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
  blocked[1][3] = true;
  const pathKeys = new Set(pathCells.map((cell) => `${cell.c},${cell.r}`));
  const buildable = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => !pathKeys.has(`${c},${r}`) && !blocked[r][c])
  );
  return {
    id: 'synthetic',
    cols,
    rows,
    pathCells,
    blocked,
    buildable,
    base: { c: cols - 1, r: 3 },
    spawns: [{ id: 0, c: 0, r: 3 }],
    destructibles,
  };
}

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

test('可破坏物：五种类型齐全，字段与任务书一致', () => {
  assert.deepEqual(
    DESTRUCTIBLE_TYPES.map((type) => type.id),
    EXPECTED_IDS
  );
  assert.deepEqual(Object.keys(DESTRUCTIBLE_BY_ID), EXPECTED_IDS);
  for (const type of DESTRUCTIBLE_TYPES) {
    for (const field of TYPE_FIELDS) {
      assert.ok(field in type, `${type.id} 缺少字段 ${field}`);
    }
    assert.equal(typeof type.name, 'string');
    assert.ok(type.name.length > 0);
    assert.equal(typeof type.desc, 'string');
    assert.ok(type.desc.length > 0);
    assert.equal(typeof type.glyph, 'string');
    assert.ok(type.glyph.length > 0);
    assert.match(type.color, /^#[0-9a-f]{6}$/i);
    assert.equal(DESTRUCTIBLE_BY_ID[type.id], type);
    assert.ok(Object.isFrozen(type), `${type.id} 类型定义必须冻结`);
    assert.ok(Object.isFrozen(type.effect), `${type.id} 效果数据必须冻结`);
  }
});

test('可破坏物：数值与效果是可直接被 sim 读取的纯数据', () => {
  const costs = Object.fromEntries(DESTRUCTIBLE_TYPES.map((type) => [type.id, type.cost]));
  assert.deepEqual(costs, { vein: 50, obelisk: 70, cache: 0, nest: 0, totem: 80 });

  assert.deepEqual(DESTRUCTIBLE_BY_ID.vein.effect, { gold: 110 });
  assert.deepEqual(DESTRUCTIBLE_BY_ID.obelisk.effect, { towerDamageMul: 0.05, maxStacks: 3 });
  assert.deepEqual(DESTRUCTIBLE_BY_ID.cache.effect, { gold: 25, baseHp: 1 });
  assert.deepEqual(DESTRUCTIBLE_BY_ID.nest.effect, { spawn: { enemy: 'swarm', count: 6 } });
  assert.deepEqual(DESTRUCTIBLE_BY_ID.totem.effect, {
    aura: { enemySpeedMul: 1.08, enemyHpMul: 1.1 },
  });

  // 纯数据：无函数、可 JSON round-trip。
  for (const type of DESTRUCTIBLE_TYPES) {
    assert.equal(typeof type.effect, 'object');
    for (const value of Object.values(type.effect)) {
      assert.notEqual(typeof value, 'function');
    }
    assert.deepEqual(JSON.parse(JSON.stringify(type.effect)), type.effect);
  }

  // 免费拆除的是补给箱与虫巢。
  assert.equal(isFreeDestructible({ type: 'cache' }), true);
  assert.equal(isFreeDestructible({ type: 'nest' }), true);
  assert.equal(isFreeDestructible({ type: 'vein' }), false);
  assert.equal(isFreeDestructible({ type: 'unknown' }), false);
  assert.equal(destructibleTypeOf({ type: 'totem' }), DESTRUCTIBLE_BY_ID.totem);
});

test('可破坏物：三张固定地图的布点数量与类型分布符合要求', () => {
  assert.deepEqual(
    FIXED_MAPS.map((map) => map.id),
    Object.keys(EXPECTED_DISTRIBUTION)
  );
  for (const map of FIXED_MAPS) {
    const expected = EXPECTED_DISTRIBUTION[map.id];
    assert.ok(Array.isArray(map.destructibles), `${map.id} 必须有 destructibles 数组`);
    assert.equal(map.destructibles.length, expected.total, `${map.id} 布点总数`);
    for (const typeId of EXPECTED_IDS) {
      const count = map.destructibles.filter((item) => item.type === typeId).length;
      assert.equal(count, expected[typeId], `${map.id} ${typeId} 数量`);
    }
    // 可攻击资源矿脉单独计数（不进 DESTRUCTIBLE_TYPES 五类注册表）。
    assert.equal(
      map.destructibles.filter((item) => item.type === 'resourceVein').length,
      expected.resourceVein,
      `${map.id} resourceVein 数量`
    );
    for (const item of map.destructibles) {
      assert.deepEqual(Object.keys(item).sort(), ['c', 'id', 'r', 'type'], `${item.id} 字段`);
      assert.ok(destructibleTypeOf(item), `${item.id} 类型未知`);
    }
  }
});

test('可破坏物：全部布点通过 validateDestructible', () => {
  for (const map of FIXED_MAPS) {
    const whole = validateDestructibles(map);
    assert.deepEqual(whole.errors, [], `${map.id} 整图校验`);
    for (const item of map.destructibles) {
      const result = validateDestructible(item, map);
      assert.deepEqual(result.errors, [], `${item.id} 单件校验`);
      assert.equal(result.ok, true);
    }
  }
});

test('可破坏物：不压路径/岩石/基地/出生点，距出生点与基地至少 2 格', () => {
  for (const map of FIXED_MAPS) {
    const pathKeys = new Set(map.pathCells.map((cell) => `${cell.c},${cell.r}`));
    for (const item of map.destructibles) {
      assert.ok(!pathKeys.has(`${item.c},${item.r}`), `${item.id} 压在路径上`);
      assert.equal(map.blocked[item.r][item.c], false, `${item.id} 压在岩石/阻挡上`);
      assert.equal(map.buildable[item.r][item.c], true, `${item.id} 必须落在可建造格`);
      assert.ok(
        !(map.base.c === item.c && map.base.r === item.r),
        `${item.id} 压在基地上`
      );
      for (const spawn of map.spawns) {
        assert.ok(!(spawn.c === item.c && spawn.r === item.r), `${item.id} 压在出生点上`);
        assert.ok(
          chebyshev(item, spawn) >= MIN_SPAWN_DISTANCE,
          `${item.id} 距出生点 ${chebyshev(item, spawn)} 格`
        );
      }
      assert.ok(
        chebyshev(item, map.base) >= MIN_SPAWN_DISTANCE,
        `${item.id} 距基地 ${chebyshev(item, map.base)} 格`
      );
    }
  }
});

test('可破坏物：每张图至少一个可免费拆除的物件，id 全局唯一', () => {
  const seen = new Map();
  for (const map of FIXED_MAPS) {
    assert.ok(
      map.destructibles.some(isFreeDestructible),
      `${map.id} 至少需要一个免费物件`
    );
    const cells = new Set();
    for (const item of map.destructibles) {
      assert.ok(!seen.has(item.id), `${item.id} 与 ${seen.get(item.id)} 重复`);
      seen.set(item.id, map.id);
      const key = `${item.c},${item.r}`;
      assert.ok(!cells.has(key), `${map.id} 格子 ${key} 重复`);
      cells.add(key);
    }
  }
  assert.equal(seen.size, FIXED_MAPS.reduce((sum, map) => sum + map.destructibles.length, 0));
});

test('可破坏物：地图构建产物与候选人选都携带同一份布点，且不共享可变引用', () => {
  const candidates = fixedMapCandidates('any-seed');
  assert.deepEqual(
    candidates.map((map) => map.id),
    ['canyon', 'twin', 'ring']
  );
  for (const candidate of candidates) {
    const source = FIXED_MAP_BY_ID[candidate.id];
    assert.deepEqual(candidate.destructibles, source.destructibles, `${candidate.id} 布点必须逐字一致`);
    // 深冻结的源数据：候选副本可改，不影响下一次候选。
    assert.ok(Object.isFrozen(source.destructibles));
  }
  candidates[0].destructibles[0].type = 'tampered';
  candidates[0].destructibles.push({ id: 'injected', type: 'vein', c: 0, r: 0 });
  const again = fixedMapCandidates('any-seed');
  assert.deepEqual(again[0].destructibles, FIXED_MAP_BY_ID.canyon.destructibles);
});

test('可破坏物：generated map（mapgen 默认路径）同样携带布点且确定性一致', () => {
  const map = generateMap('destructible-seed');
  assert.equal(map.id, 'canyon');
  assert.deepEqual(map.destructibles, FIXED_MAP_BY_ID.canyon.destructibles);
  const first = generateMapCandidates('seed-a');
  const second = generateMapCandidates('seed-b');
  assert.deepEqual(
    first.map((candidate) => candidate.destructibles),
    second.map((candidate) => candidate.destructibles)
  );
});

test('可破坏物：非法布点逐项被 validateDestructible 拒绝', () => {
  const cases = [
    ['未知类型', { id: 'a', type: 'dragon', c: 4, r: 0 }, 'type-unknown'],
    ['越界', { id: 'a', type: 'vein', c: 9, r: 0 }, 'out-of-bounds'],
    ['压路径', { id: 'a', type: 'vein', c: 4, r: 3 }, 'on-path'],
    ['压岩石', { id: 'a', type: 'vein', c: 3, r: 1 }, 'on-blocker'],
    ['压基地', { id: 'a', type: 'vein', c: 8, r: 3 }, 'on-base'],
    ['压出生点', { id: 'a', type: 'vein', c: 0, r: 3 }, 'on-spawn'],
    ['距出生点过近', { id: 'a', type: 'vein', c: 1, r: 2 }, 'too-close-to-spawn'],
    ['距基地过近', { id: 'a', type: 'vein', c: 7, r: 2 }, 'too-close-to-base'],
    ['坐标非整数', { id: 'a', type: 'vein', c: 1.5, r: 0 }, 'cell-invalid'],
    ['缺少 id', { type: 'vein', c: 4, r: 0 }, 'id-invalid'],
  ];
  for (const [label, item, expectedCode] of cases) {
    const map = syntheticMap([item]);
    const result = validateDestructible(item, map);
    assert.equal(result.ok, false, `${label} 应被拒绝`);
    assert.ok(errorCodes(result).includes(expectedCode), `${label} 应报告 ${expectedCode}，实际 ${errorCodes(result)}`);
  }
  // 合法对照：同一张合成图上的正常布点应当通过。
  const valid = { id: 'ok', type: 'cache', c: 4, r: 0 };
  assert.deepEqual(validateDestructible(valid, syntheticMap([valid])).errors, []);
});

test('可破坏物：同图重复 id / 重复格子 / 无免费物件被整图校验拒绝', () => {
  const dupId = [
    { id: 'same', type: 'vein', c: 4, r: 0 },
    { id: 'same', type: 'cache', c: 5, r: 0 },
  ];
  assert.ok(errorCodes(validateDestructible(dupId[0], syntheticMap(dupId))).includes('duplicate-id'));

  const dupCell = [
    { id: 'a', type: 'vein', c: 4, r: 0 },
    { id: 'b', type: 'cache', c: 4, r: 0 },
  ];
  assert.ok(errorCodes(validateDestructible(dupCell[1], syntheticMap(dupCell))).includes('duplicate-cell'));

  const noFree = [{ id: 'paid', type: 'vein', c: 4, r: 0 }];
  const whole = validateDestructibles(syntheticMap(noFree));
  assert.equal(whole.ok, false);
  assert.ok(errorCodes(whole).includes('no-free-destructible'));

  assert.deepEqual(validateDestructibles(syntheticMap([])).errors, []);
});

test('可破坏物：拆除状态按 id 幂等，同一 id 只生效一次', () => {
  const first = markDestroyed([], 'canyon-vein-1');
  assert.equal(first.ok, true);
  assert.deepEqual(first.destroyed, ['canyon-vein-1']);

  const second = markDestroyed(first.destroyed, 'canyon-vein-1');
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already-destroyed');
  assert.deepEqual(second.destroyed, ['canyon-vein-1']);

  const third = markDestroyed(second.destroyed, 'ring-cache-2');
  assert.equal(third.ok, true);
  assert.deepEqual(third.destroyed, ['canyon-vein-1', 'ring-cache-2']);

  // 输入数组不被原地修改。
  const input = ['a'];
  markDestroyed(input, 'b');
  assert.deepEqual(input, ['a']);

  assert.equal(markDestroyed([], '').ok, false);
  assert.equal(markDestroyed(undefined, 'a').ok, true);
});
