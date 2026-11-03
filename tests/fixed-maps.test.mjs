// 固定地图：三张手工地图的数据契约、确定性、栅格化校验，以及 sim/render 的直接消费。
// 对应 MAP-001 的验收标准：node --test tests/fixed-maps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHETYPES,
  MODIFIER_BY_ID,
  generateMap,
  generateMapCandidates,
  legacyGenerateMap,
} from '../public/js/shared/mapgen.js';
import {
  FIXED_MAPS,
  FIXED_MAP_BY_ID,
  FIXED_TRAITS,
  fixedMapCandidates,
} from '../public/js/shared/maps/index.js';
import {
  MapSpecError,
  buildFixedMap,
  rasterizeLane,
} from '../public/js/shared/maps/rasterize.js';
import { generateWave } from '../public/js/shared/waves.js';
import { Simulation } from '../public/js/sim.js';
import {
  RESOURCE_VEIN_TYPE,
  resourceVeinGold,
  validateDestructibles,
} from '../public/js/shared/destructibles.js';
import { biomeScene, decorExclusion } from '../public/js/render/background-data.js';
import { modifierIdOf, weatherFor } from '../public/js/render/background-renderer.js';

const EXPECTED_IDS = ['canyon', 'twin', 'ring'];
const CONTRACT_FIELDS = [
  'lanes',
  'spawns',
  'base',
  'pathCells',
  'polyline',
  'spawn',
  'blocked',
  'buildable',
  'rocks',
  'meta',
];

// 任务书里的 waypoints：数据必须逐字落地，不能靠 RNG 复原。
const EXPECTED_WAYPOINTS = {
  canyon: [[[0, 3], [5, 3], [5, 8], [11, 8], [11, 2], [16, 2], [16, 9], [20, 9]]],
  twin: [
    [[0, 2], [7, 2], [7, 5], [13, 5], [18, 5], [20, 5]],
    [[0, 9], [7, 9], [7, 6], [13, 6], [18, 6], [18, 5], [20, 5]],
  ],
  ring: [
    [[0, 1], [16, 1], [16, 4], [18, 4], [18, 5], [20, 5]],
    [[0, 10], [16, 10], [16, 7], [18, 7], [18, 5], [20, 5]],
  ],
};

const EXPECTED_BASE = {
  canyon: { c: 20, r: 9 },
  twin: { c: 20, r: 5 },
  ring: { c: 20, r: 5 },
};

const EXPECTED_SCORE_MUL = { canyon: 0.95, twin: 1, ring: 1.08 };

// 贴路判定：格子的 4 邻接内是否存在路径格。
function isPathAdjacent(map, cell) {
  const pathKeys = new Set(map.pathCells.map((p) => `${p.c},${p.r}`));
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (pathKeys.has(`${cell.c + dc},${cell.r + dr}`)) return true;
  }
  return false;
}

function specErrorReason(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof MapSpecError, `应抛 MapSpecError，实际 ${error?.name}`);
    return error.reason;
  }
  return null;
}

function baseSpec(overrides = {}) {
  return {
    id: 'probe',
    name: '探针地图',
    archetype: 'canyon',
    archetypeName: '单径峡谷',
    cols: 10,
    rows: 6,
    scoreMul: 1,
    trait: null,
    lanes: [{ waypoints: [[0, 1], [9, 1]] }],
    base: [9, 1],
    rocks: [],
    blockers: [],
    ...overrides,
  };
}

test('固定地图：三张、顺序 canyon→twin→ring、22×12、id 与原型一致', () => {
  assert.deepEqual(FIXED_MAPS.map((map) => map.id), EXPECTED_IDS);
  assert.deepEqual(Object.keys(FIXED_MAP_BY_ID), EXPECTED_IDS);
  for (const map of FIXED_MAPS) {
    assert.equal(map.cols, 22);
    assert.equal(map.rows, 12);
    assert.equal(map.archetype, map.id);
    assert.ok(ARCHETYPES[map.archetype], `原型 ${map.archetype} 必须存在于 ARCHETYPES`);
    assert.equal(map.meta.archetype, map.archetype);
    assert.equal(map.meta.portalCount, map.lanes.length);
    assert.equal(map.meta.scoreMul, EXPECTED_SCORE_MUL[map.id]);
    assert.equal(map.name.length > 0, true);
  }
});

test('固定地图：waypoints 与任务书一致，栅格化为 4 邻接 cell 且收束到基地', () => {
  for (const map of FIXED_MAPS) {
    const expected = EXPECTED_WAYPOINTS[map.id];
    assert.equal(map.lanes.length, expected.length, `${map.id} lane 数`);
    map.lanes.forEach((lane, index) => {
      const cells = rasterizeLane(expected[index], map.cols, map.rows);
      assert.deepEqual(lane.cells, cells, `${map.id} lane ${index} 栅格化结果`);
      for (let i = 1; i < lane.cells.length; i++) {
        const prev = lane.cells[i - 1];
        const cur = lane.cells[i];
        assert.equal(
          Math.abs(cur.c - prev.c) + Math.abs(cur.r - prev.r),
          1,
          `${map.id} lane ${index} 第 ${i} 步不是 4 邻接`
        );
      }
      const last = lane.cells[lane.cells.length - 1];
      assert.deepEqual(
        { c: last.c, r: last.r },
        EXPECTED_BASE[map.id],
        `${map.id} lane ${index} 必须收束到基地`
      );
      assert.deepEqual(
        { c: lane.polyline[lane.polyline.length - 1].x, r: 0 },
        { c: map.base.x, r: 0 },
        `${map.id} lane ${index} 折线终点`
      );
      assert.equal(lane.length > 4, true);
    });
    assert.deepEqual({ c: map.base.c, r: map.base.r }, EXPECTED_BASE[map.id]);
    assert.equal(map.spawns.length, map.lanes.length);
    assert.deepEqual(map.spawn, map.spawns[0]);
    assert.deepEqual(map.polyline, map.lanes[0].polyline);
  }
});

test('固定地图：汇流点与多入口契约', () => {
  assert.equal(FIXED_MAP_BY_ID.canyon.meta.merge, null);
  assert.equal(FIXED_MAP_BY_ID.canyon.lanes.length, 1);
  for (const id of ['twin', 'ring']) {
    const map = FIXED_MAP_BY_ID[id];
    assert.equal(map.lanes.length, 2);
    assert.deepEqual(map.meta.merge, { c: 18, r: 5 });
    for (const lane of map.lanes) {
      assert.ok(
        lane.cells.some((cell) => cell.c === 18 && cell.r === 5),
        `${id} lane ${lane.id} 必须经过汇流点`
      );
    }
  }
});

test('固定地图：旧 map 契约字段齐全、形状正确', () => {
  for (const map of FIXED_MAPS) {
    for (const field of CONTRACT_FIELDS) {
      assert.ok(field in map, `${map.id} 缺少字段 ${field}`);
    }
    assert.equal(map.blocked.length, map.rows);
    assert.equal(map.buildable.length, map.rows);
    for (let r = 0; r < map.rows; r++) {
      assert.equal(map.blocked[r].length, map.cols);
      assert.equal(map.buildable[r].length, map.cols);
    }
    for (const spawn of map.spawns) {
      assert.equal(spawn.c, 0, `${map.id} 入口必须在左边缘`);
      assert.equal(spawn.x, spawn.c + 0.5);
      assert.equal(spawn.y, spawn.r + 0.5);
      assert.equal(spawn.laneId, spawn.id);
    }
    assert.equal(map.base.x, map.base.c + 0.5);
    assert.equal(map.base.y, map.base.r + 0.5);
  }
});

test('固定地图：路径格不与 blocked/buildable 冲突，塔位掩码偏少且贴路', () => {
  for (const map of FIXED_MAPS) {
    const pathKeys = new Set(map.pathCells.map((cell) => `${cell.c},${cell.r}`));
    assert.equal(pathKeys.size, map.pathCells.length, `${map.id} pathCells 有重复`);
    for (const cell of map.pathCells) {
      assert.equal(map.blocked[cell.r][cell.c], false, `${map.id} 路径格被标为 blocked`);
      assert.equal(map.buildable[cell.r][cell.c], false, `${map.id} 路径格被标为可建造`);
    }
    for (const rock of map.rocks) {
      assert.equal(map.blocked[rock.r][rock.c], true, `${map.id} 岩石格必须 blocked`);
      assert.equal(map.buildable[rock.r][rock.c], false, `${map.id} 岩石格不可建造`);
      assert.ok(!pathKeys.has(`${rock.c},${rock.r}`), `${map.id} 岩石不能压路径`);
    }
    // 塔位掩码：可建造格 = 手写塔位 ∪ 可破坏物占格。纯塔位 15~25 且以贴路为主。
    const destructibleKeys = new Set(map.destructibles.map((item) => `${item.c},${item.r}`));
    const spots = [];
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (map.buildable[r][c] && !destructibleKeys.has(`${c},${r}`)) spots.push({ c, r });
      }
    }
    assert.ok(spots.length >= 15 && spots.length <= 25, `${map.id} 纯塔位 ${spots.length} 不在 15~25`);
    const adjacent = spots.filter((spot) => isPathAdjacent(map, spot)).length;
    assert.ok(adjacent >= spots.length * 0.8, `${map.id} 贴路塔位 ${adjacent}/${spots.length} 不足 80%`);
    // 可破坏物仍落在可建造格（拆除后由模拟层恢复该格可建）。
    for (const item of map.destructibles) {
      assert.equal(map.buildable[item.r][item.c], true, `${map.id} ${item.id} 必须落在可建造格`);
    }
  }
});

test('固定地图：资源矿脉落图——每图 2~4 个，不落路径/不占塔位/不撞可破坏物，掉落确定性', () => {
  for (const map of FIXED_MAPS) {
    const veins = map.destructibles.filter((item) => item.type === 'resourceVein');
    assert.ok(veins.length >= 2 && veins.length <= 4, `${map.id} 矿脉数 ${veins.length} 不在 2~4`);

    const pathKeys = new Set(map.pathCells.map((cell) => `${cell.c},${cell.r}`));
    const destructibleKeys = new Set(map.destructibles.map((item) => `${item.c},${item.r}`));
    // 纯塔位 = 可建造格去掉可破坏物占格（即手写 buildableMask）。
    const towerSpots = new Set();
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (map.buildable[r][c] && !destructibleKeys.has(`${c},${r}`)) towerSpots.add(`${c},${r}`);
      }
    }
    const spawnKeys = new Set(map.spawns.map((spawn) => `${spawn.c},${spawn.r}`));
    const dist = (a, b) => Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));

    const veinIds = new Set();
    const veinKeys = new Set();
    for (const vein of veins) {
      const key = `${vein.c},${vein.r}`;
      assert.equal(veinIds.has(vein.id), false, `${map.id} 矿脉 id 重复 ${vein.id}`);
      assert.equal(veinKeys.has(key), false, `${map.id} 矿脉格子重复 ${key}`);
      veinIds.add(vein.id);
      veinKeys.add(key);
      assert.ok(!pathKeys.has(key), `${map.id} ${vein.id} 落在路径`);
      assert.equal(map.blocked[vein.r][vein.c], false, `${map.id} ${vein.id} 压在岩石/阻挡`);
      assert.ok(!towerSpots.has(key), `${map.id} ${vein.id} 占用贴路塔位`);
      assert.equal(
        map.destructibles.some(
          (item) => item.type !== 'resourceVein' && item.c === vein.c && item.r === vein.r
        ),
        false,
        `${map.id} ${vein.id} 与既有可破坏物撞格`
      );
      assert.ok(!spawnKeys.has(key), `${map.id} ${vein.id} 落在出生点`);
      assert.notEqual(key, `${map.base.c},${map.base.r}`, `${map.id} ${vein.id} 落在基地`);
      for (const spawn of map.spawns) {
        assert.ok(dist(vein, spawn) >= 2, `${map.id} ${vein.id} 距出生点不足 2 格`);
      }
      assert.ok(dist(vein, map.base) >= 2, `${map.id} ${vein.id} 距基地不足 2 格`);
      assert.equal(map.buildable[vein.r][vein.c], true, `${map.id} ${vein.id} 未落可建造格`);
      // 掉落复用 feat-attackable-tiles 的 seed+波次派生，落在声明区间内。
      const gold = resourceVeinGold(map.seed, 1, vein.id);
      assert.ok(
        gold >= RESOURCE_VEIN_TYPE.goldMin && gold <= RESOURCE_VEIN_TYPE.goldMax,
        `${map.id} ${vein.id} 掉落 ${gold} 不在区间`
      );
    }

    // 确定性：候选副本里的矿脉逐字一致。
    const copy = fixedMapCandidates('x').find((candidate) => candidate.id === map.id);
    const copyVeins = copy.destructibles.filter((item) => item.type === 'resourceVein');
    assert.deepEqual(copyVeins, veins, `${map.id} 矿脉必须逐字一致`);

    // 整图自洽（含矿脉）。
    assert.equal(validateDestructibles(map).ok, true, `${map.id} 可破坏物自洽校验失败`);
  }
});

test('固定地图：资源矿脉在 sim 中占格（存活挡建塔，破坏后恢复），且带正确血量', () => {
  for (const map of FIXED_MAPS) {
    const veins = map.destructibles.filter((item) => item.type === 'resourceVein');
    const sim = new Simulation({
      map,
      seed: map.seed,
      difficulty: 'standard',
      gold: 500,
      baseHp: 20,
      maxBaseHp: 20,
      relics: [],
      towers: [],
    });
    const entries = sim.destructibles.filter((item) => item.type === 'resourceVein');
    assert.equal(entries.length, veins.length, `${map.id} 运行时矿脉条目数`);
    for (const entry of entries) {
      assert.equal(entry.hp, RESOURCE_VEIN_TYPE.hp, `${map.id} ${entry.id} 血量`);
      assert.equal(sim.canBuild(entry.c, entry.r), false, `${map.id} ${entry.id} 存活时挡建塔`);
    }
  }
});

test('固定地图：每张 8–12 个写死岩石，位置不使用 RNG', () => {
  for (const map of FIXED_MAPS) {
    assert.ok(map.rocks.length >= 8 && map.rocks.length <= 12, `${map.id} 岩石数`);
    const keys = new Set(map.rocks.map((rock) => `${rock.c},${rock.r}`));
    assert.equal(keys.size, map.rocks.length, `${map.id} 岩石位置重复`);
    for (const rock of map.rocks) {
      assert.ok(Number.isFinite(rock.size) && rock.size > 0);
      assert.ok(Number.isFinite(rock.rot));
      assert.ok(rock.c >= 0 && rock.c < map.cols && rock.r >= 0 && rock.r < map.rows);
    }
    const again = fixedMapCandidates(undefined).find((candidate) => candidate.id === map.id);
    assert.deepEqual(again.rocks, map.rocks, `${map.id} 岩石必须逐字一致`);
  }
});

test('固定地图：trait 与 schema 一致，scoreMul 与任务书一致', () => {
  assert.equal(FIXED_MAP_BY_ID.canyon.modifier, null, 'canyon 无固定 trait');
  assert.equal(FIXED_MAP_BY_ID.canyon.trait, null);
  assert.equal(FIXED_MAP_BY_ID.canyon.meta.modifier, null);

  const trade = FIXED_MAP_BY_ID.twin.modifier;
  assert.equal(trade.id, 'trade');
  assert.equal(trade.name, '商路');
  assert.equal(trade.goldMul, 1.1);
  assert.equal(trade.hpMul, 1.08);

  const echo = FIXED_MAP_BY_ID.ring.modifier;
  assert.equal(echo.id, 'echo');
  assert.equal(echo.name, '回响');
  assert.equal(echo.rangeMul, 1.08);
  assert.equal(echo.speedMul, 1.06);

  assert.deepEqual(FIXED_TRAITS.map((trait) => trait.id), ['trade', 'echo']);
  for (const trait of FIXED_TRAITS) {
    for (const key of [
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
    ]) {
      assert.ok(key in trait, `trait ${trait.id} 缺少 ${key}`);
    }
    assert.match(trait.color, /^#[0-9a-f]{6}$/i);
    // 存档/历史面板按 id 反查：固定 trait 必须能解析。
    assert.equal(MODIFIER_BY_ID[trait.id]?.name, trait.name);
  }
  // 固定 trait 与地图上的对象语义一致（modifier 是契约字段，trait 是别名）。
  for (const map of FIXED_MAPS) {
    assert.deepEqual(map.trait, map.modifier);
    assert.deepEqual(map.meta.modifier, map.modifier);
  }
});

test('固定地图：同一 id 连续生成深比较相等，换 seed 几何不变', () => {
  assert.deepEqual(generateMapCandidates('seed-a', 3), generateMapCandidates('seed-a', 3));
  assert.deepEqual(generateMapCandidates('seed-a', 3), generateMapCandidates('seed-b', 3));
  assert.deepEqual(generateMap('seed-a'), generateMap('seed-b'));
  assert.deepEqual(generateMap('seed-a'), generateMapCandidates('whatever', 3)[0]);
  for (const map of FIXED_MAPS) {
    const first = fixedMapCandidates('x').find((item) => item.id === map.id);
    const second = fixedMapCandidates('y').find((item) => item.id === map.id);
    assert.deepEqual(first, second);
    assert.deepEqual(first.pathCells, map.pathCells);
    assert.deepEqual(first.lanes, map.lanes);
  }
});

test('固定地图：候选数量按 count 截断，最多三张', () => {
  assert.equal(generateMapCandidates('s', 1).length, 1);
  assert.deepEqual(generateMapCandidates('s', 1).map((map) => map.id), ['canyon']);
  assert.equal(generateMapCandidates('s', 2).length, 2);
  assert.equal(generateMapCandidates('s', 3).length, 3);
  assert.equal(generateMapCandidates('s', 9).length, 3);
  assert.equal(generateMapCandidates('s', 0).length, 0);
});

test('固定地图：模块常量深冻结，候选是独立副本', () => {
  assert.ok(Object.isFrozen(FIXED_MAPS));
  assert.ok(Object.isFrozen(FIXED_MAPS[0]));
  assert.ok(Object.isFrozen(FIXED_MAPS[0].rocks[0]));
  assert.throws(() => {
    FIXED_MAPS[0].rocks.push({ c: 1, r: 1, size: 0.3, rot: 0 });
  });

  const copy = generateMapCandidates('mutate', 3);
  copy[0].rocks.push({ c: 1, r: 1, size: 0.3, rot: 0 });
  copy[0].buildable[0][0] = false;
  assert.deepEqual(generateMapCandidates('mutate', 3)[0], FIXED_MAPS[0]);
});

test('固定地图：sim 可直接消费（每条 lane 都能推进到基地）', () => {
  for (const map of FIXED_MAPS) {
    const sim = new Simulation({
      map,
      seed: map.seed,
      difficulty: 'standard',
      gold: 500,
      baseHp: 20,
      maxBaseHp: 20,
      relics: [],
      towers: [],
    });
    assert.equal(sim.lanes.length, map.lanes.length);
    sim.beginWave(generateWave(map.seed, 1, 'standard', map.meta));
    for (let lane = 0; lane < map.lanes.length; lane++) sim.spawnEnemy('grunt', lane);
    assert.equal(sim.enemies.length, map.lanes.length);
    for (let i = 0; i < 240; i++) sim.update(1 / 60);
    for (const enemy of sim.enemies) {
      assert.ok(enemy.progress > 0, `${map.id} 敌人未沿 lane 前进`);
      assert.ok(Number.isFinite(enemy.x) && Number.isFinite(enemy.y));
    }
  }
});

test('固定地图：render 纯函数可直接消费', () => {
  for (const map of FIXED_MAPS) {
    assert.ok(biomeScene(map));
    const excluded = decorExclusion(map);
    assert.ok(excluded.size > 0, `${map.id} 装饰排除区为空`);
    // 岩石与路径都在装饰排除或 blocked 之内，渲染层不会把地贴盖到塔位/路径上。
    assert.equal(typeof weatherFor(map.meta, map.seed), 'string');
    assert.equal(modifierIdOf(map.meta), map.modifier?.id || null);
  }
});

test('新开局不再使用随机 carve：只有 legacyGenerateMap 保留随机几何', () => {
  const singleSignatures = new Set();
  const candidateSignatures = new Set();
  const legacySignatures = new Set();
  for (let i = 0; i < 12; i++) {
    singleSignatures.add(JSON.stringify(generateMap(`new-run-${i}`).pathCells));
    candidateSignatures.add(
      JSON.stringify(generateMapCandidates(`new-run-${i}`, 3).map((map) => map.pathCells))
    );
    legacySignatures.add(JSON.stringify(legacyGenerateMap(`legacy-${i}`).pathCells));
  }
  assert.equal(singleSignatures.size, 1, 'generateMap 路径必须与种子无关');
  assert.equal(candidateSignatures.size, 1, 'generateMapCandidates 路径必须与种子无关');
  assert.ok(legacySignatures.size > 5, 'legacyGenerateMap 仍是随机 carve');
  // 旧的单图入口就是固定 canyon，且与候选首图是同一份几何。
  const single = generateMap('anything');
  assert.equal(single.id, 'canyon');
  assert.deepEqual(single.pathCells, generateMapCandidates('anything', 3)[0].pathCells);
});

test('栅格化校验：越界、斜线、重复点、路径长度都会报错', () => {
  const cols = 10;
  const rows = 6;
  assert.equal(
    specErrorReason(() => rasterizeLane([[0, 1], [10, 1]], cols, rows)),
    'waypoint-out-of-bounds'
  );
  assert.equal(
    specErrorReason(() => rasterizeLane([[0, 1], [3, 4]], cols, rows)),
    'non-4-adjacent-waypoint'
  );
  assert.equal(
    specErrorReason(() => rasterizeLane([[0, 1], [0, 1], [9, 1]], cols, rows)),
    'duplicate-waypoint'
  );
  assert.equal(
    specErrorReason(() => rasterizeLane([[0, 1], [4, 1], [4, 3], [0, 3], [0, 1]], cols, rows)),
    'duplicate-cell'
  );
  assert.equal(specErrorReason(() => rasterizeLane([[0, 1], [3, 1]], cols, rows)), 'path-too-short');
  assert.equal(specErrorReason(() => rasterizeLane([[0, 1]], cols, rows)), 'waypoints-invalid');
  // 合法数据不抛错。
  assert.equal(rasterizeLane([[0, 1], [9, 1]], cols, rows).length, 10);
});

test('地图数据校验：基地收束、岩石/阻挡、汇流点都必须合法', () => {
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ base: [8, 1] }))),
    'lane-not-ending-at-base'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ rocks: [{ c: 3, r: 1 }] }))),
    'rocks-on-path'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ rocks: [{ c: 1, r: 3 }, { c: 1, r: 3 }] }))),
    'rocks-duplicate'
  );
  assert.equal(
    specErrorReason(() =>
      buildFixedMap(
        baseSpec({
          rocks: [{ c: 1, r: 3, size: 0.3, rot: 0 }],
          blockers: [{ c: 1, r: 3 }],
        })
      )
    ),
    'blocker-overlaps-rock'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ blockers: [{ c: 2, r: 1 }] }))),
    'blockers-on-path'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ merge: [9, 1] }))),
    'merge-invalid'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ scoreMul: 1.4 }))),
    'scoreMul-out-of-range'
  );

  // 固定阻挡同样是 blocked 且不可建造；岩石与路径无关的校验不误伤。
  const map = buildFixedMap(
    baseSpec({
      rocks: [{ c: 1, r: 3, size: 0.3, rot: 0.5 }],
      blockers: [{ c: 2, r: 3 }],
    })
  );
  assert.equal(map.blocked[3][1], true);
  assert.equal(map.blocked[3][2], true);
  assert.equal(map.buildable[3][1], false);
  assert.equal(map.buildable[3][2], false);
  assert.equal(map.rocks.length, 1);
  assert.deepEqual(map.blockers, [{ c: 2, r: 3 }]);
});

test('塔位掩码：声明掩码时取代全图可建，未声明时回退非路径非阻挡', () => {
  // 未声明 buildableMask → 回退旧行为（非路径且非阻挡即可建）。
  const fallback = buildFixedMap(baseSpec());
  assert.equal(fallback.buildable[0][0], true, '非路径非阻挡格可建');
  assert.equal(fallback.buildable[1][0], false, '路径格不可建');
  // 声明掩码 → 只开放掩码格（可破坏物占格另计）。
  const masked = buildFixedMap(baseSpec({ buildableMask: [[0, 2], [2, 2]] }));
  assert.equal(masked.buildable[2][0], true, '(0,2) 在掩码中');
  assert.equal(masked.buildable[2][2], true, '(2,2) 在掩码中');
  assert.equal(masked.buildable[0][0], false, '未在掩码中的格不可建');
  assert.equal(masked.buildable[1][0], false, '路径格仍不可建');
});

test('塔位掩码：越界/压路径/压阻挡/压可破坏物/重复/空数组都会报错', () => {
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ buildableMask: [[10, 1]] }))),
    'buildableMask-out-of-bounds'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ buildableMask: [[1, 1]] }))),
    'buildableMask-on-path'
  );
  assert.equal(
    specErrorReason(() =>
      buildFixedMap(baseSpec({ buildableMask: [[1, 3]], rocks: [{ c: 1, r: 3, size: 0.3, rot: 0 }] }))
    ),
    'buildableMask-on-blocked'
  );
  assert.equal(
    specErrorReason(() =>
      buildFixedMap(
        baseSpec({ destructibles: [{ id: 'd', type: 'vein', c: 1, r: 3 }], buildableMask: [[1, 3]] })
      )
    ),
    'buildableMask-on-destructible'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ buildableMask: [[0, 2], [0, 2]] }))),
    'buildableMask-duplicate'
  );
  assert.equal(
    specErrorReason(() => buildFixedMap(baseSpec({ buildableMask: [] }))),
    'buildableMask-invalid'
  );
});

test('多入口地图：汇流点必须在每条 lane 上', () => {
  const twoLane = baseSpec({
    lanes: [
      { waypoints: [[0, 1], [5, 1], [9, 1]] },
      { waypoints: [[0, 3], [5, 3], [5, 1], [9, 1]] },
    ],
    merge: [4, 2],
  });
  assert.equal(
    specErrorReason(() => buildFixedMap(twoLane)),
    'merge-not-on-path'
  );
  // 汇流点在路径上但不在某条 lane 上同样非法。
  assert.equal(
    specErrorReason(() => buildFixedMap({ ...twoLane, merge: [4, 1] })),
    'merge-not-on-lane'
  );
  const ok = buildFixedMap({ ...twoLane, merge: [5, 1] });
  assert.deepEqual(ok.meta.merge, { c: 5, r: 1 });
  assert.equal(ok.meta.portalCount, 2);
});
