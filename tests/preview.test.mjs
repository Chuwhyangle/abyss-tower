// 下一波情报：客户端预测必须与服务端实际放行的波次完全一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { buildCandidate } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { MAX_WAVE } from '../public/js/shared/data.js';

function makeSim(archetype = 'triple', difficulty = 'abyss') {
  const map = buildCandidate(`preview-${archetype}`, archetype, null, 0);
  return new Simulation({
    map,
    seed: `preview-${archetype}`,
    difficulty,
    gold: 300,
    baseHp: 20,
    maxBaseHp: 20,
  });
}

function totalsOf(def) {
  const totals = {};
  for (const group of def.groups) {
    totals[group.type] = (totals[group.type] || 0) + group.count;
  }
  return totals;
}

test('下一波情报与服务端波次生成一致', () => {
  for (const difficulty of ['roam', 'standard', 'abyss']) {
    const sim = makeSim('triple', difficulty);
    const meta = sim.map.meta || {};
    const options = {
      portalCount: meta.portalCount || 1,
      modifier: meta.modifier || null,
    };
    for (const cleared of [0, 1, 4, 9, 14, 19, 24, 28]) {
      sim.clearedWave = cleared;
      sim.phase = 'prep';
      const preview = sim.nextWavePreview();
      const def = generateWave(sim.seed, cleared + 1, difficulty, options);
      assert.equal(preview.index, def.index, `难度 ${difficulty} 第 ${cleared + 1} 波`);
      assert.equal(preview.totalCount, def.totalCount);
      assert.equal(preview.boss, !!def.boss);
      assert.equal(preview.finalBoss, !!def.finalBoss);
      assert.deepEqual(
        Object.fromEntries(preview.enemies.map((item) => [item.type, item.count])),
        totalsOf(def)
      );
    }
  }
});

test('多入口地图的下一波情报包含入口分配', () => {
  const sim = makeSim('cross');
  const preview = sim.nextWavePreview();
  assert.ok(preview.portals >= 1);
  assert.equal(preview.index, 1);
});

test('波次进行中与最终波之后不提供下一波情报', () => {
  const sim = makeSim('canyon');
  sim.clearedWave = MAX_WAVE;
  sim.phase = 'prep';
  assert.equal(sim.nextWavePreview(), null);

  sim.clearedWave = 3;
  sim.phase = 'wave';
  assert.equal(sim.nextWavePreview(), null);
});
