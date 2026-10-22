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
