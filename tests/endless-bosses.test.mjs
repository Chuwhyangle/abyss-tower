// 无尽模式深渊首领：每 10 波叠加一层轮换词条（渊盾/裂变/狂暴），层数有硬上限。
// 覆盖点：轮换与封顶、纯数据契约、波次下发、模拟生效、同种子稳定、普通模式不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave, selectBossAffixes } from '../public/js/shared/waves.js';
import {
  BOSS_VARIANTS,
  ENDLESS_BOSS_AFFIXES,
  ENDLESS_BOSS_AFFIX_INTERVAL,
  ENDLESS_BOSS_AFFIX_ROTATION,
} from '../public/js/shared/data/enemies.js';
import { ENEMIES } from '../public/js/shared/data.js';

const SEED = 'endless-boss-seed';
const STEP = 1 / 60;

function makeSim(waveDef) {
  const map = generateMap(SEED);
  const sim = new Simulation({
    map,
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
  });
  sim.waveDef = waveDef;
  sim.wave = waveDef.index;
  sim.phase = 'wave';
  sim.spawnQueue = [];
  return sim;
}

function endlessBossWave(index) {
  return generateWave(SEED, index, 'standard', {}, { endless: true });
}

function spawnBoss(sim) {
  const group = sim.waveDef.groups.find((entry) => entry.type === 'boss');
  sim.spawnEnemy('boss', 0, group?.hpMul ?? sim.waveDef.hpMul);
  return sim.enemies[sim.enemies.length - 1];
}

test('词条每 10 波按轮换顺序叠加，层数硬上限', () => {
  assert.equal(selectBossAffixes(5), null, '第 5 波还没到首个词条节点');
  assert.equal(selectBossAffixes(9), null, '非首领波不携带词条');
  assert.equal(selectBossAffixes(11), null, '非首领波不携带词条');
  assert.deepEqual(selectBossAffixes(10), { shield: 1 });
  assert.deepEqual(selectBossAffixes(20), { shield: 1, split: 1 });
  assert.deepEqual(selectBossAffixes(30), { shield: 1, split: 1, frenzy: 1 });
  assert.deepEqual(selectBossAffixes(40), { shield: 2, split: 1, frenzy: 1 });
  assert.deepEqual(selectBossAffixes(50), { shield: 2, split: 2, frenzy: 1 });
  assert.deepEqual(selectBossAffixes(60), { shield: 2, split: 2, frenzy: 2 });

  // 超过封顶波次后层数不再增长，且每个词条都不超过自身 maxStacks。
  const capped = selectBossAffixes(60);
  for (const wave of [70, 120, 600, 1000]) {
    assert.deepEqual(selectBossAffixes(wave), capped, `第 ${wave} 波词条层数超过硬上限`);
  }
  for (const [id, stacks] of Object.entries(capped)) {
    assert.ok(stacks <= ENDLESS_BOSS_AFFIXES[id].maxStacks, `${id} 超过单类上限`);
  }
  assert.equal(ENDLESS_BOSS_AFFIX_INTERVAL, 10);
});

test('词条是带中文名与机制说明的纯数据', () => {
  for (const id of ENDLESS_BOSS_AFFIX_ROTATION) {
    const def = ENDLESS_BOSS_AFFIXES[id];
    assert.ok(def, `缺少词条 ${id}`);
    assert.equal(def.id, id);
    assert.match(def.name, /[一-龥]/, `${id} 缺少中文名`);
    assert.ok(def.desc && def.desc.trim(), `${id} 缺少机制说明`);
    assert.ok(def.color, `${id} 缺少配色`);
    assert.ok(Number.isInteger(def.maxStacks) && def.maxStacks >= 1, `${id} 层数上限非法`);
  }
  assert.deepEqual(ENDLESS_BOSS_AFFIX_ROTATION, ['shield', 'split', 'frenzy']);
});

test('仅无尽模式首领波下发词条，普通模式完全不变', () => {
  const endless20 = endlessBossWave(20);
  assert.equal(endless20.boss, true);
  assert.deepEqual(endless20.bossAffixes, { shield: 1, split: 1 });
  assert.match(endless20.bossAffixText, /渊盾×1/);
  assert.match(endless20.bossAffixText, /裂变×1/);
  assert.match(endless20.label, /深渊首领/);

  const normal20 = generateWave(SEED, 20, 'standard');
  assert.equal(normal20.bossVariant, endless20.bossVariant, '词条不改变变体轮换');
  assert.equal(normal20.bossAffixes, undefined, '普通模式不下发词条');
  assert.equal(normal20.bossAffixText, undefined);
  assert.equal(normal20.label, '首领波次');

  const endless41 = endlessBossWave(41);
  assert.equal(endless41.boss, false);
  assert.equal(endless41.bossAffixes, undefined, '非首领波不下发词条');
});

test('渊盾词条：首领开局带盾，破盾前本体不掉血', () => {
  const sim = makeSim(endlessBossWave(40));
  const boss = spawnBoss(sim);
  const expected = Math.round(
    boss.maxHp * ENDLESS_BOSS_AFFIXES.shield.shieldPct * boss.affixes.shield
  );
  assert.equal(boss.affixes.shield, 2);
  assert.equal(boss.shield, expected);
  assert.equal(boss.maxShield, expected);

  sim.damage(boss, 10, { ignoreArmor: true });
  assert.equal(boss.hp, boss.maxHp, '护盾未破时本体不掉血');
  assert.equal(boss.shield, expected - 10);

  sim.damage(boss, expected - 10, { ignoreArmor: true });
  assert.equal(boss.shield, 0, '护盾恰好耗尽');
  assert.equal(boss.hp, boss.maxHp);

  sim.damage(boss, 5, { ignoreArmor: true });
  assert.equal(boss.hp, boss.maxHp - 5, '破盾后伤害才落到本体');
});

test('裂变词条：首领死亡时按层数裂出裂生虫', () => {
  const sim = makeSim(endlessBossWave(50));
  const boss = spawnBoss(sim);
  assert.equal(boss.affixes.split, 2);
  assert.equal(boss.splits.type, ENDLESS_BOSS_AFFIXES.split.splitType);
  assert.equal(boss.splits.count, 2);

  sim.killEnemy(boss);
  sim.flushSplits();
  const splitlings = sim.enemies.filter((enemy) => enemy.type === 'splitling' && !enemy.dead);
  assert.equal(splitlings.length, 2, '两层裂变应裂出 2 只裂生虫');
});

test('狂暴词条：按层数提升移速，且只影响无尽首领', () => {
  const def = endlessBossWave(60);
  assert.equal(def.bossAffixes.frenzy, 2);

  const withAffix = spawnBoss(makeSim(def));
  const withoutAffix = spawnBoss(makeSim({ ...def, bossAffixes: null }));
  assert.equal(withAffix.affixes.frenzy, 2);
  assert.equal(withoutAffix.affixes, null);

  const expected = withoutAffix.baseSpeed * (1 + 2 * ENDLESS_BOSS_AFFIXES.frenzy.speedPerStack);
  assert.ok(Math.abs(withAffix.baseSpeed - expected) < 1e-9, '狂暴层数未正确折算移速');
});

test('普通模式首领属性与旧公式一致', () => {
  const def = generateWave(SEED, 20, 'standard');
  const sim = makeSim(def);
  const boss = spawnBoss(sim);
  const variant = BOSS_VARIANTS[def.bossVariant];
  const group = def.groups.find((entry) => entry.type === 'boss');

  assert.equal(boss.affixes, null);
  assert.equal(boss.shield, 0);
  assert.equal(boss.maxShield, 0);
  assert.equal(boss.splits, null);
  assert.equal(boss.maxHp, Math.round(ENEMIES.boss.hp * group.hpMul * variant.hpMul));
  assert.ok(
    Math.abs(boss.baseSpeed - ENEMIES.boss.speed * def.speedMul * variant.speedMul) < 1e-9
  );
});

test('同种子下深渊首领的生成与模拟逐字一致', () => {
  assert.deepEqual(endlessBossWave(60), endlessBossWave(60));

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
    sim.beginWave(generateWave(SEED, 60, 'standard', map.meta || {}, { endless: true }));
    for (let i = 0; i < 900; i++) sim.update(STEP);
    return JSON.stringify({
      time: sim.time,
      baseHp: sim.baseHp,
      gold: sim.gold,
      kills: sim.kills,
      enemies: sim.enemies.map((enemy) => [
        enemy.id,
        enemy.type,
        enemy.hp,
        enemy.maxHp,
        enemy.shield,
        enemy.progress,
        enemy.bossPhase,
        enemy.cast ? enemy.cast.kind : null,
      ]),
    });
  };
  assert.equal(run(), run(), '同种子模拟轨迹必须一致');
});
