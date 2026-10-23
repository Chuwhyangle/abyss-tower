// 塔的分支进化：16 条路线、纯数据修正、满级二选一、确定性与旧档兼容。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWERS, TOWER_ORDER } from '../public/js/shared/data/towers.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SEED = 'tower-evolution-seed';
// 既有属性键：进化只能修正这些值，不允许引入未实现的新机制。
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

// 离出生点最近的可建造格，保证塔能把伤害打出去。
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

const EVOLUTION_CASES = TOWER_ORDER.flatMap((type) =>
  (TOWERS[type].evolutions || []).map((evolution) => ({ type, evolution }))
);

test('8 座塔各 2 条进化路线，共 16 条且 id 唯一', () => {
  assert.equal(TOWER_ORDER.length, 8);
  assert.equal(EVOLUTION_CASES.length, 16);

  const allIds = new Set();
  for (const type of TOWER_ORDER) {
    const def = TOWERS[type];
    assert.ok(Array.isArray(def.evolutions), `${type} 缺少 evolutions`);
    assert.equal(def.evolutions.length, 2, `${type} 应有 2 条路线`);
    const localIds = new Set();
    for (const evolution of def.evolutions) {
      assert.ok(typeof evolution.id === 'string' && evolution.id.trim(), `${type} 进化缺少 id`);
      assert.ok(typeof evolution.name === 'string' && evolution.name.trim(), `${type} 进化缺少 name`);
      assert.ok(typeof evolution.desc === 'string' && evolution.desc.trim(), `${type} 进化缺少 desc`);
      localIds.add(evolution.id);
      allIds.add(evolution.id);
    }
    assert.equal(localIds.size, 2, `${type} 的进化 id 重复`);
  }
  assert.equal(allIds.size, 16, '16 条路线的 id 必须全局唯一');
});

test('进化修正只使用现有属性键，且系数合法', () => {
  for (const { type, evolution } of EVOLUTION_CASES) {
    const mods = evolution.mods;
    assert.ok(mods && typeof mods === 'object', `${evolution.id} 缺少 mods`);
    const keys = Object.keys(mods);
    assert.ok(keys.length > 0, `${evolution.id} 没有任何属性修正`);
    for (const key of keys) {
      assert.ok(EVOLUTION_MOD_KEYS.includes(key), `${evolution.id} 使用了未实现的属性 ${key}`);
      assert.ok(Number.isFinite(mods[key]) && mods[key] > 0, `${evolution.id}.${key} 系数非法`);
      assert.notEqual(mods[key], 1, `${evolution.id}.${key} 是空修正`);
    }
    // 修正键必须真的出现在该塔的等级数据里（或属于支援塔的光环键）。
    const level = TOWERS[type].levels[MAX_LEVEL(type)];
    for (const key of keys) {
      assert.ok(key in level, `${type} 的等级数据里没有属性 ${key}`);
    }
    assert.ok(typeof evolution.color === 'string' && evolution.color.startsWith('#'));
  }
});

test('满级才进入待进化，未选择时没有继续升级的路径', () => {
  const sim = makeSim({ towers: [{ type: 'arrow', c: 2, r: 3, level: 0 }] });
  const tower = sim.towers[0];

  assert.equal(tower.evolution, null);
  assert.equal(sim.canEvolve(tower), false);
  assert.deepEqual(sim.evolutionOptions(tower), []);
  assert.equal(sim.evolveTower(tower, 'arrow-longbow'), false);

  tower.level = MAX_LEVEL('arrow');
  assert.equal(sim.canEvolve(tower), true);
  assert.equal(sim.evolutionOptions(tower).length, 2);
  // 满级即没有普通升级入口：想继续变强只能二选一。
  assert.equal(sim.upgradeCost(tower), null);
  assert.equal(sim.upgradeTower(tower), false);
  assert.equal(tower.level, MAX_LEVEL('arrow'));
});

test('16 条路线在模拟中都能生效，且属性按系数修正', () => {
  for (const { type, evolution } of EVOLUTION_CASES) {
    const sim = makeSim({ towers: [{ type, c: 2, r: 3, level: MAX_LEVEL(type) }] });
    const tower = sim.towers[0];
    const before = { ...sim.statsFor(tower) };

    assert.equal(sim.evolveTower(tower, evolution.id), true, `${evolution.id} 应用失败`);
    assert.equal(tower.evolution, evolution.id);
    assert.equal(sim.towerEvolution(tower)?.id, evolution.id);

    const after = sim.statsFor(tower);
    for (const [key, mul] of Object.entries(evolution.mods)) {
      const expected = key === 'chain' ? Math.round(before.chain * mul) : before[key] * mul;
      approx(after[key], expected, `${evolution.id}.${key}`);
    }
    const changed = Object.keys(evolution.mods).some((key) => after[key] !== before[key]);
    assert.ok(changed, `${evolution.id} 没有改变任何属性`);
  }
});

test('选择分支后不可重复选择', () => {
  const sim = makeSim({ towers: [{ type: 'arc', c: 2, r: 3, level: MAX_LEVEL('arc') }] });
  const tower = sim.towers[0];
  const [first, second] = sim.evolutionOptions(tower);

  assert.equal(sim.evolveTower(tower, 'not-a-real-evolution'), false);
  assert.equal(tower.evolution, null);
  assert.equal(sim.evolveTower(tower, first.id), true);
  assert.equal(sim.evolveTower(tower, second.id), false);
  assert.equal(tower.evolution, first.id);
  assert.equal(sim.canEvolve(tower), false);
  assert.deepEqual(sim.evolutionOptions(tower), []);
});

test('战旗塔进化后光环即时作用于相邻塔', () => {
  const sim = makeSim({
    towers: [
      { type: 'banner', c: 2, r: 3, level: MAX_LEVEL('banner') },
      { type: 'arrow', c: 2, r: 4, level: MAX_LEVEL('arrow') },
    ],
  });
  const [banner, arrow] = sim.towers;
  const before = { ...sim.statsFor(arrow) };

  assert.equal(sim.evolveTower(banner, 'banner-horn'), true);
  const after = sim.statsFor(arrow);
  assert.ok(after.dmg > before.dmg, '光环增伤没有生效');
  assert.ok(after.rate > before.rate, '光环攻速没有生效');
});

test('旧存档没有 evolution 字段时按未进化处理', () => {
  const legacy = makeSim({
    towers: [{ type: 'sniper', c: 2, r: 3, level: MAX_LEVEL('sniper'), invested: 400 }],
  });
  const tower = legacy.towers[0];
  assert.equal(tower.evolution, null);
  assert.equal(legacy.towerEvolution(tower), null);

  const stats = legacy.statsFor(tower);
  const fresh = legacy.previewStats('sniper', MAX_LEVEL('sniper'));
  approx(stats.dmg, fresh.dmg, '旧档伤害');
  approx(stats.rate, fresh.rate, '旧档攻速');
  approx(stats.range, fresh.range, '旧档射程');
  // 旧档塔仍然可以在本局补选分支。
  assert.equal(legacy.canEvolve(tower), true);
  assert.equal(legacy.evolveTower(tower, 'sniper-piercer'), true);
});

test('进化不消耗 RNG：同种子的战斗随机序列不受影响', () => {
  const options = TOWERS.cannon.evolutions;
  const plain = makeSim({ towers: [{ type: 'cannon', c: 2, r: 3, level: MAX_LEVEL('cannon') }] });
  const evolved = makeSim({ towers: [{ type: 'cannon', c: 2, r: 3, level: MAX_LEVEL('cannon') }] });
  assert.equal(evolved.evolveTower(evolved.towers[0], options[0].id), true);

  for (let i = 0; i < 16; i++) {
    assert.equal(evolved.combatRng.float(), plain.combatRng.float(), `第 ${i + 1} 次抽取不一致`);
  }
});

function combatHash(sim) {
  const round = (value) => Math.round(value * 1e6) / 1e6;
  return JSON.stringify({
    time: round(sim.time),
    gold: round(sim.gold),
    baseHp: round(sim.baseHp),
    kills: sim.kills,
    enemies: sim.enemies.map((enemy) => ({
      id: enemy.id,
      type: enemy.type,
      hp: round(enemy.hp),
      progress: round(enemy.progress),
    })),
    towers: sim.towers.map((tower) => ({
      type: tower.type,
      evolution: tower.evolution,
      level: tower.level,
      cd: round(tower.cd),
      stats: {
        dmg: round(tower.stats.dmg),
        rate: round(tower.stats.rate),
        range: round(tower.stats.range),
      },
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

test('同一进化路线同种子可复现，不同路线结果不同', () => {
  const longbowA = runCombat('evo-repro', 'arrow', 'arrow-longbow');
  const longbowB = runCombat('evo-repro', 'arrow', 'arrow-longbow');
  assert.equal(longbowA, longbowB, '同种子同路线必须完全一致');

  const rapid = runCombat('evo-repro', 'arrow', 'arrow-rapid');
  assert.notEqual(longbowA, rapid, '不同路线应产生不同的战况');
});
