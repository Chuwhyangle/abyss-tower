// 三分支进化（v1.17）：8 座塔 × 3 条路线 = 24 条，纯数据修正，满级三选一。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWERS, TOWER_ORDER } from '../public/js/shared/data/towers.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SEED = 'tower-evolution-v2-seed';
// 只允许使用已经实现的属性；进化不引入新机制。
const EVOLUTION_MOD_KEYS = [
  'dmg',
  'rate',
  'range',
  'splash',
  'slow',
  'slowDur',
  'chain',
  'dot',
  'dotDur',
  'knockback',
  'buffDmg',
  'buffRate',
];
const CJK = /[一-龥]/;
const MAX_LEVEL = (type) => TOWERS[type].levels.length - 1;

function makeSim({ seed = SEED, towers = [], relics = [] } = {}) {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics,
    towers,
    unlockedTowers: [...TOWER_ORDER],
    onToast: () => {},
    onSave: () => {},
  });
}

function findBuildSpot(sim) {
  const start = sim.posAt(0, 0);
  let best = null;
  let bestDist = Infinity;
  for (let r = 0; r < sim.map.rows; r++) {
    for (let c = 0; c < sim.map.cols; c++) {
      if (!sim.canBuild(c, r)) continue;
      const dist = Math.hypot(c + 0.5 - start.x, r + 0.5 - start.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { c, r };
      }
    }
  }
  assert.ok(best, '地图上找不到可建造格');
  return best;
}

function approx(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: 期望 ${expected}，实际 ${actual}`
  );
}

const ROUTES = TOWER_ORDER.flatMap((type) =>
  (TOWERS[type].evolutions || []).map((evolution) => ({ type, evolution }))
);

test('8 座塔各 3 条路线，共 24 条且 id 全局唯一', () => {
  assert.equal(TOWER_ORDER.length, 8);
  assert.equal(ROUTES.length, 24);

  const allIds = new Set();
  for (const type of TOWER_ORDER) {
    const def = TOWERS[type];
    assert.ok(Array.isArray(def.evolutions), `${type} 缺少 evolutions`);
    assert.equal(def.evolutions.length, 3, `${type} 应有 3 条路线`);
    const localIds = new Set(def.evolutions.map((entry) => entry.id));
    assert.equal(localIds.size, 3, `${type} 的路线 id 重复`);
    for (const id of localIds) allIds.add(id);
  }
  assert.equal(allIds.size, 24, '24 条路线 id 必须全局唯一');
});

test('每条路线都有中文名与定位说明', () => {
  for (const { evolution } of ROUTES) {
    assert.equal(typeof evolution.name, 'string', `${evolution.id} 缺少 name`);
    assert.ok(CJK.test(evolution.name), `${evolution.id} 的 name 不含中文`);
    assert.equal(typeof evolution.desc, 'string', `${evolution.id} 缺少 desc`);
    assert.ok(CJK.test(evolution.desc), `${evolution.id} 的 desc 不含中文定位说明`);
    assert.ok(evolution.desc.length >= 8, `${evolution.id} 的定位说明过短`);
  }
});

test('路线修正只使用已实现属性，且非空、合法', () => {
  for (const { type, evolution } of ROUTES) {
    const mods = evolution.mods;
    assert.ok(mods && typeof mods === 'object', `${evolution.id} 缺少 mods`);
    const keys = Object.keys(mods);
    assert.ok(keys.length > 0, `${evolution.id} 没有任何属性修正`);
    const level = TOWERS[type].levels[MAX_LEVEL(type)];
    for (const key of keys) {
      assert.ok(EVOLUTION_MOD_KEYS.includes(key), `${evolution.id} 使用了未实现的属性 ${key}`);
      assert.ok(key in level, `${type} 的等级数据里没有属性 ${key}`);
      assert.ok(Number.isFinite(mods[key]) && mods[key] > 0, `${evolution.id}.${key} 系数非法`);
      assert.notEqual(mods[key], 1, `${evolution.id}.${key} 是空修正`);
    }
    assert.ok(typeof evolution.color === 'string' && evolution.color.startsWith('#'));
  }
});

test('24 条路线在模拟中都能生效，属性按系数修正', () => {
  for (const { type, evolution } of ROUTES) {
    const sim = makeSim({ towers: [{ type, c: 2, r: 3, level: MAX_LEVEL(type) }] });
    const tower = sim.towers[0];
    const before = { ...sim.statsFor(tower) };

    assert.equal(sim.evolveTower(tower, evolution.id), true, `${evolution.id} 应用失败`);
    assert.equal(sim.towerEvolution(tower)?.id, evolution.id);

    const after = sim.statsFor(tower);
    for (const [key, mul] of Object.entries(evolution.mods)) {
      const expected = key === 'chain' ? Math.round(before.chain * mul) : before[key] * mul;
      approx(after[key], expected, `${evolution.id}.${key}`);
    }
  }
});

test('满级三选一：未选择不可继续升级，选择后锁定', () => {
  const sim = makeSim({ towers: [{ type: 'arrow', c: 2, r: 3, level: 0 }] });
  const tower = sim.towers[0];
  assert.deepEqual(sim.evolutionOptions(tower), []);
  assert.equal(sim.evolveTower(tower, 'arrow-ranger'), false);

  tower.level = MAX_LEVEL('arrow');
  const options = sim.evolutionOptions(tower);
  assert.equal(options.length, 3);
  // 满级后没有普通升级入口：不选分支就停在原地。
  assert.equal(sim.upgradeCost(tower), null);
  assert.equal(sim.upgradeTower(tower), false);
  assert.equal(tower.level, MAX_LEVEL('arrow'));

  assert.equal(sim.evolveTower(tower, options[2].id), true);
  assert.equal(tower.evolution, options[2].id);
  assert.equal(sim.canEvolve(tower), false);
  assert.deepEqual(sim.evolutionOptions(tower), []);
  assert.equal(sim.evolveTower(tower, options[0].id), false);
  assert.equal(tower.evolution, options[2].id);
});

test('旧存档（未进化）可继续，且可补选任一新分支', () => {
  const sim = makeSim({
    towers: [{ type: 'sniper', c: 2, r: 3, level: MAX_LEVEL('sniper'), invested: 400 }],
  });
  const tower = sim.towers[0];
  assert.equal(tower.evolution, null);
  assert.equal(sim.towerEvolution(tower), null);
  approx(sim.statsFor(tower).dmg, sim.previewStats('sniper', MAX_LEVEL('sniper')).dmg, '旧档伤害');
  assert.equal(sim.canEvolve(tower), true);
  assert.equal(sim.evolveTower(tower, 'sniper-overwatch'), true);
});

test('进化不消耗 RNG：同种子战斗序列不受影响', () => {
  const options = TOWERS.cannon.evolutions;
  const plain = makeSim({ towers: [{ type: 'cannon', c: 2, r: 3, level: MAX_LEVEL('cannon') }] });
  const evolved = makeSim({ towers: [{ type: 'cannon', c: 2, r: 3, level: MAX_LEVEL('cannon') }] });
  assert.equal(evolved.evolveTower(evolved.towers[0], options[2].id), true);

  for (let i = 0; i < 16; i++) {
    assert.equal(evolved.combatRng.float(), plain.combatRng.float(), `第 ${i + 1} 次抽取不一致`);
  }
});

function combatHash(sim) {
  const round = (value) => Math.round(value * 1e6) / 1e6;
  return JSON.stringify({
    time: round(sim.time),
    gold: round(sim.gold),
    kills: sim.kills,
    enemies: sim.enemies.map((enemy) => ({
      id: enemy.id,
      hp: round(enemy.hp),
      progress: round(enemy.progress),
    })),
    towers: sim.towers.map((tower) => ({
      evolution: tower.evolution,
      level: tower.level,
      dmg: round(tower.stats.dmg),
      rate: round(tower.stats.rate),
    })),
  });
}

function runCombat(seed, towerType, evolutionId) {
  const probe = makeSim({ seed });
  const spot = findBuildSpot(probe);
  const sim = makeSim({
    seed,
    towers: [{ type: towerType, c: spot.c, r: spot.r, level: MAX_LEVEL(towerType) }],
  });
  const tower = sim.towers[0];
  assert.equal(sim.evolveTower(tower, evolutionId), true);
  assert.equal(sim.beginWave(generateWave(seed, 1, 'standard', sim.map.meta || {})), true);
  for (let i = 0; i < 900; i++) sim.update(1 / 60);
  return combatHash(sim);
}

test('同一新路线同种子可复现，与新路线之间结果可区分', () => {
  const rangerA = runCombat('evo-v2-repro', 'arrow', 'arrow-ranger');
  const rangerB = runCombat('evo-v2-repro', 'arrow', 'arrow-ranger');
  assert.equal(rangerA, rangerB, '同种子同路线必须完全一致');

  const longbow = runCombat('evo-v2-repro', 'arrow', 'arrow-longbow');
  const rapid = runCombat('evo-v2-repro', 'arrow', 'arrow-rapid');
  assert.notEqual(rangerA, longbow, '新路线与旧路线结果应不同');
  assert.notEqual(rangerA, rapid, '新路线与旧路线结果应不同');
});
