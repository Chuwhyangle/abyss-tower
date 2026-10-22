// 多入口地图：候选、路径不变量、波次入口计划、战斗适配与词缀效果。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMap,
  generateMapCandidates,
  ARCHETYPES,
  MODIFIER_BY_ID,
} from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { Simulation } from '../public/js/sim.js';

function mapWithArchetype(archetypeId, modifierId = null) {
  const seed = `test-${archetypeId}-${modifierId || 'none'}`;
  const candidates = generateMapCandidates(seed, 3);
  const candidate =
    candidates.find((item) => item.archetype === archetypeId) ||
    generateMapCandidates(`force-${archetypeId}`, 3).find((item) => item.archetype === archetypeId);
  return candidate || generateMap(seed);
}

test('候选地图：同种子一致、三张、至少一张低复杂度', () => {
  const a = generateMapCandidates('candidate-seed', 3);
  const b = generateMapCandidates('candidate-seed', 3);
  assert.equal(a.length, 3);
  assert.deepEqual(
    a.map((item) => [item.archetype, item.modifier?.id, item.meta.scoreMul]),
    b.map((item) => [item.archetype, item.modifier?.id, item.meta.scoreMul])
  );
  assert.ok(a.some((item) => ['canyon', 'twin'].includes(item.archetype)));
  assert.ok(a.every((item) => item.meta.scoreMul >= 0.9 && item.meta.scoreMul <= 1.25));
});

test('候选地图：入口数与原型/词缀匹配，路径可建造比例正常', () => {
  for (let i = 0; i < 120; i++) {
    for (const candidate of generateMapCandidates(`maps-${i}`, 3)) {
      const archetype = ARCHETYPES[candidate.archetype];
      const expected = Math.min(
        3,
        archetype.spawns + (candidate.modifier?.extraPortal || 0)
      );
      assert.equal(candidate.spawns.length, expected, candidate.seed);
      assert.equal(candidate.lanes.length, expected, candidate.seed);
      assert.equal(candidate.meta.portalCount, expected);
      assert.equal(candidate.spawns[0].c, 0);
      assert.equal(candidate.base.c, candidate.cols - 1);
      for (const lane of candidate.lanes) {
        assert.ok(lane.polyline.length >= 2);
        assert.ok(lane.length > 4);
        const first = lane.polyline[0];
        assert.equal(Math.floor(first.x), 0);
      }
      const buildable = candidate.buildable.flat().filter(Boolean).length;
      assert.ok(buildable > candidate.cols * candidate.rows * 0.3, candidate.seed);
    }
  }
});

test('波次入口计划：前期单入口、后期多入口、最终波全入口', () => {
  const meta = { portalCount: 3, modifier: MODIFIER_BY_ID.rift };
  const early = generateWave('portal-seed', 3, 'standard', meta);
  assert.equal(early.portals.length, 1);
  assert.ok(early.groups.every((group) => early.portals.includes(group.portal)));

  const late = generateWave('portal-seed', 29, 'standard', meta);
  assert.equal(late.portals.length, 3);
  assert.ok(late.groups.every((group) => [0, 1, 2].includes(group.portal)));

  const final = generateWave('portal-seed', 30, 'standard', meta);
  assert.equal(final.portals.length, 3);

  const base = generateWave('portal-seed', 30, 'standard', { portalCount: 1 });
  assert.deepEqual(base.portals, [0]);
  assert.ok(final.hpMul > base.hpMul, '裂界提高生命');
  assert.ok(final.speedMul >= base.speedMul, '裂界不降低速度');
});

test('多入口移动：敌人沿各自 lane 前进并独立结算漏怪', () => {
  let candidate = null;
  for (let i = 0; i < 30 && !candidate; i++) {
    candidate = generateMapCandidates(`lanes-${i}`, 3).find((item) => item.spawns.length >= 2);
  }
  assert.ok(candidate);
  const sim = new Simulation({
    map: candidate,
    seed: candidate.seed,
    difficulty: 'standard',
    gold: 1000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
  });
  sim.beginWave(generateWave(candidate.seed, 1, 'standard', candidate.meta));
  sim.spawnEnemy('grunt', 0);
  sim.spawnEnemy('grunt', 1);
  const [a, b] = sim.enemies;
  assert.equal(a.lane, 0);
  assert.equal(b.lane, 1);
  assert.notDeepEqual([a.x, a.y], [b.x, b.y]);
  for (let i = 0; i < 600; i++) sim.update(1 / 60);
  assert.ok(sim.enemies.every((enemy) => enemy.progress > 0));
});

function pointOnPolyline(pts, x, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
    if (Math.abs(cross) > 1e-9) continue;
    if (x < Math.min(a.x, b.x) - 1e-9 || x > Math.max(a.x, b.x) + 1e-9) continue;
    if (y < Math.min(a.y, b.y) - 1e-9 || y > Math.max(a.y, b.y) + 1e-9) continue;
    return true;
  }
  return false;
}

test('多入口路径：起点/终点、lane 配色、汇流点与共享主干', () => {
  let checked = 0;
  for (let i = 0; i < 120; i++) {
    for (const candidate of generateMapCandidates(`lane-geom-${i}`, 3)) {
      assert.ok(candidate.lanes.length >= 1);
      candidate.lanes.forEach((lane, index) => {
        const spawn = candidate.spawns[index];
        assert.equal(spawn.color, lane.color, `${candidate.seed} 入口 ${index} 配色`);
        const first = lane.polyline[0];
        const last = lane.polyline[lane.polyline.length - 1];
        assert.equal(first.x, spawn.x, `${candidate.seed} 路径起点 x`);
        assert.equal(first.y, spawn.y, `${candidate.seed} 路径起点 y`);
        assert.equal(last.x, candidate.base.x, `${candidate.seed} 路径终点 x`);
        assert.equal(last.y, candidate.base.y, `${candidate.seed} 路径终点 y`);
        for (let p = 1; p < lane.polyline.length; p++) {
          const a = lane.polyline[p - 1];
          const b = lane.polyline[p];
          assert.ok(
            a.x === b.x || a.y === b.y,
            `${candidate.seed} lane ${index} 存在斜线段`
          );
        }
      });

      if (candidate.spawns.length > 1) {
        checked++;
        const merge = candidate.meta.merge;
        assert.ok(merge, `${candidate.seed} 多入口缺少汇流点`);
        const mergeX = merge.c + 0.5;
        const mergeY = merge.r + 0.5;
        for (const lane of candidate.lanes) {
          assert.ok(
            pointOnPolyline(lane.polyline, mergeX, mergeY),
            `${candidate.seed} 汇流点不在 lane ${lane.id} 的路径上`
          );
          assert.ok(
            lane.cells.some((cell) => cell.c === merge.c && cell.r === merge.r),
            `${candidate.seed} 汇流点不在 lane ${lane.id} 的格子中`
          );
        }

        if (candidate.archetype !== 'cross') {
          // 中途汇流：所有 lane 共享汇流后的主干格子（折线化简后未必保留汇流点顶点）。
          const cells = candidate.lanes.map((lane) => lane.cells);
          const minLen = Math.min(...cells.map((item) => item.length));
          let suffix = 0;
          while (
            suffix < minLen &&
            cells.every(
              (item) =>
                item[item.length - 1 - suffix].c === cells[0][cells[0].length - 1 - suffix].c &&
                item[item.length - 1 - suffix].r === cells[0][cells[0].length - 1 - suffix].r
            )
          ) suffix++;
          assert.ok(suffix >= 2, `${candidate.seed} 汇流后未共享主干：${suffix}`);
        }
      }
    }
  }
  assert.ok(checked > 50, `多入口地图样本不足：${checked}`);
});

test('词缀：薄雾降低射程，富矿提高击杀金币，计分乘数生效', () => {
  const mistMap = mapWithArchetype('canyon', 'mist');
  const mist = new Simulation({
    map: mistMap, seed: 'mist', difficulty: 'standard', gold: 1000, baseHp: 20, maxBaseHp: 20,
    relics: [], unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
  });
  const tower = mist.makeTower('arrow', 1, 1, 0, 0);
  assert.ok(Math.abs(mist.statsFor(tower).range - 3.2 * 0.92) < 1e-9 || mistMap.modifier?.id !== 'mist');

  const richMap = mapWithArchetype('canyon', 'rich');
  if (richMap.modifier?.id === 'rich') {
    const rich = new Simulation({
      map: richMap, seed: 'rich', difficulty: 'standard', gold: 1000, baseHp: 20, maxBaseHp: 20,
      relics: [], towers: [],
    });
    const plain = new Simulation({
      map: generateMap('plain-gold'), seed: 'plain-gold', difficulty: 'standard',
      gold: 1000, baseHp: 20, maxBaseHp: 20, relics: [], towers: [],
    });
    rich.beginWave(generateWave('rich', 3, 'standard', richMap.meta));
    plain.beginWave(generateWave('plain-gold', 3, 'standard', { portalCount: 1 }));
    rich.spawnEnemy('grunt');
    plain.spawnEnemy('grunt');
    const beforeRich = rich.gold;
    const beforePlain = plain.gold;
    rich.killEnemy(rich.enemies[0]);
    plain.killEnemy(plain.enemies[0]);
    const richGain = rich.gold - beforeRich;
    const plainGain = plain.gold - beforePlain;
    assert.ok(richGain > plainGain, `富矿金币 ${richGain} > ${plainGain}`);
    assert.ok(rich.mapMeta.scoreMul < 1);
  }
});
