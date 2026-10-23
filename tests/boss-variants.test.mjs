// 首领变体回归：波次→变体映射、技能权重、属性修正、同种子复现与最终波固定狂暴。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave, selectBossVariant } from '../public/js/shared/waves.js';
import { BOSS_VARIANTS, BOSS_VARIANT_ROTATION } from '../public/js/shared/data/enemies.js';
import { ENEMIES, MAX_WAVE } from '../public/js/shared/data.js';
import { BALANCE } from '../public/js/shared/config.js';

const STEP = 1 / 60;
const SEED = 'boss-variants-seed';

function makeSim(waveIndex = 20, variant = null) {
  const map = generateMap(SEED);
  const sim = new Simulation({
    map,
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
  });
  sim.waveDef = {
    index: waveIndex,
    hpMul: BALANCE.bossHpGrowth ** (waveIndex - 1),
    speedMul: 1,
    reward: 0,
    groups: [],
    boss: true,
    bossVariant: variant,
    finalBoss: false,
  };
  sim.wave = waveIndex;
  sim.phase = 'wave';
  sim.spawnQueue = [];
  return sim;
}

function spawnBoss(sim) {
  sim.spawnEnemy('boss', 0, sim.waveDef.hpMul);
  return sim.enemies[sim.enemies.length - 1];
}

test('首领波每 5 波轮换变体，最终波固定狂暴型', () => {
  const expected = {
    5: 'armored',
    10: 'summoner',
    15: 'berserk',
    20: 'armored',
    25: 'summoner',
    30: 'berserk',
  };
  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const def = generateWave(SEED, wave, 'standard');
    if (wave % 5 !== 0) {
      assert.equal(def.bossVariant, null, `第 ${wave} 波不是首领波`);
      continue;
    }
    assert.equal(def.bossVariant, expected[wave], `第 ${wave} 波变体错误`);
    assert.equal(def.bossVariant, selectBossVariant(wave));
  }
  const final = generateWave(SEED, MAX_WAVE, 'standard');
  assert.equal(final.finalBoss, true);
  assert.equal(final.bossVariant, 'berserk', '最终波必须固定狂暴型');
});

test('变体定义是带中文名与机制说明的纯数据', () => {
  for (const id of BOSS_VARIANT_ROTATION) {
    const variant = BOSS_VARIANTS[id];
    assert.ok(variant, `缺少变体 ${id}`);
    assert.equal(variant.id, id);
    assert.match(variant.name, /[一-龥]/, `${id} 缺少中文名`);
    assert.ok(variant.desc && variant.desc.trim(), `${id} 缺少机制说明`);
    assert.ok(variant.color && variant.shape, `${id} 缺少外观定义`);
    const weights = Object.values(variant.skillWeights);
    assert.ok(weights.every((weight) => Number.isInteger(weight) && weight >= 0), `${id} 技能权重非法`);
    assert.ok(weights.reduce((sum, weight) => sum + weight, 0) > 0, `${id} 技能权重全为 0`);
  }
});

test('技能选择按变体权重轮转', () => {
  const counts = (variant, picks) => {
    const sim = makeSim(30, variant);
    const boss = spawnBoss(sim);
    const result = { roar: 0, summon: 0, slam: 0 };
    for (let i = 0; i < picks; i++) {
      // 全部技能保持可用，单独观察权重序列。
      boss.cooldowns = { roar: 0, summon: 0, slam: 0 };
      const kind = sim.pickBossSkill(boss);
      result[kind] += 1;
    }
    return result;
  };

  // 每种变体一轮 6 次：权重 4 的技能出现 4 次，其余各 1 次。
  assert.deepEqual(counts('armored', 6), { roar: 1, summon: 1, slam: 4 });
  assert.deepEqual(counts('summoner', 6), { roar: 1, summon: 4, slam: 1 });
  assert.deepEqual(counts('berserk', 6), { roar: 4, summon: 1, slam: 1 });
  assert.deepEqual(counts('armored', 12), { roar: 2, summon: 2, slam: 8 });
});

test('变体属性修正在生成时生效', () => {
  for (const id of BOSS_VARIANT_ROTATION) {
    const sim = makeSim(20, id);
    const boss = spawnBoss(sim);
    const variant = BOSS_VARIANTS[id];
    assert.equal(boss.variant, id);
    assert.equal(boss.maxHp, Math.round(ENEMIES.boss.hp * sim.waveDef.hpMul * variant.hpMul));
    assert.equal(boss.hp, boss.maxHp);
    assert.equal(boss.armor, ENEMIES.boss.armor + variant.armorBonus);
    assert.ok(Math.abs(boss.baseSpeed - ENEMIES.boss.speed * variant.speedMul) < 1e-9);
  }
});

test('无变体的旧首领定义保持原有技能轮转', () => {
  const sim = makeSim(30, null);
  const boss = spawnBoss(sim);
  assert.equal(boss.variant, null);
  const picks = [];
  for (let i = 0; i < 6; i++) {
    boss.cooldowns = { roar: 0, summon: 0, slam: 0 };
    picks.push(sim.pickBossSkill(boss));
  }
  assert.deepEqual(picks, ['roar', 'summon', 'slam', 'roar', 'summon', 'slam']);
});

test('同种子两次生成与两次模拟逐字一致', () => {
  for (const wave of [5, 10, 30]) {
    assert.deepEqual(
      generateWave(SEED, wave, 'standard'),
      generateWave(SEED, wave, 'standard'),
      `第 ${wave} 波生成不稳定`
    );
  }

  const run = () => {
    const map = generateMap(SEED);
    const sim = new Simulation({
      map,
      seed: SEED,
      difficulty: 'standard',
      gold: 0,
      baseHp: 20,
      maxBaseHp: 20,
    });
    sim.beginWave(generateWave(SEED, 10, 'standard', map.meta || {}));
    for (let i = 0; i < 600; i++) sim.update(STEP);
    return JSON.stringify({
      time: sim.time,
      baseHp: sim.baseHp,
      gold: sim.gold,
      phase: sim.phase,
      enemies: sim.enemies.map((enemy) => [
        enemy.id,
        enemy.type,
        enemy.variant,
        enemy.hp,
        enemy.progress,
        enemy.bossPhase,
        enemy.cast ? enemy.cast.kind : null,
      ]),
    });
  };
  assert.equal(run(), run(), '同种子模拟轨迹必须一致');
});
