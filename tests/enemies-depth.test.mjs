// 敌人扩容：12 种敌人、机制行为（护盾/分裂/光环/远程）、波次接入、渲染分派与模拟确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { ENEMIES, MAX_WAVE } from '../public/js/shared/data.js';
import { EnemyRenderer } from '../public/js/render/enemy-renderer.js';

const STEP = 1 / 60;
const REQUIRED_FIELDS = ['hp', 'speed', 'armor', 'gold', 'dmg'];
const NEW_TYPES = ['shielder', 'splitter', 'splitling', 'herald', 'caster'];
const WAVE_TYPES = ['shielder', 'splitter', 'herald', 'caster'];

function makeSim(seed = 'enemies-depth-seed') {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onToast: () => {},
  });
}

// 让 sim 进入可推进的战斗状态，但不依赖真实波次内容。
function makeWaveSim(seed = 'enemies-depth-seed') {
  const sim = makeSim(seed);
  sim.waveDef = { index: 1, hpMul: 1, speedMul: 1, groups: [], reward: 0 };
  sim.wave = 1;
  sim.phase = 'wave';
  return sim;
}

function lastEnemy(sim) {
  return sim.enemies[sim.enemies.length - 1];
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function stateOf(sim) {
  return JSON.stringify({
    time: round6(sim.time),
    gold: sim.gold,
    baseHp: sim.baseHp,
    kills: sim.kills,
    enemies: sim.enemies.map((e) => [
      e.id, e.type, round6(e.hp), round6(e.progress), round6(e.shield), e.lane,
    ]),
    towers: sim.towers.map((t) => [t.type, t.c, t.r, round6(t.cd), t.disabledUntil]),
    projectiles: sim.projectiles.map((p) => [p.id, round6(p.x), round6(p.y)]),
  });
}

test('敌人种类 ≥12，id 唯一且必需字段合法', () => {
  const ids = Object.keys(ENEMIES);
  assert.ok(ids.length >= 12, `敌人种类只有 ${ids.length} 种`);
  const names = new Set();
  for (const [key, def] of Object.entries(ENEMIES)) {
    assert.equal(def.id, key, `${key} 的 id 与键不一致`);
    assert.ok(typeof def.name === 'string' && def.name.trim(), `${key} 缺少中文名`);
    assert.ok(!names.has(def.name), `敌人中文名重复：${def.name}`);
    names.add(def.name);
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Number.isFinite(def[field]), `${key}.${field} 必须是有限数字`);
    }
    assert.ok(def.hp > 0 && def.speed > 0 && def.gold >= 0 && def.dmg > 0);
    assert.ok(typeof def.color === 'string' && /^#[0-9a-f]{6}$/i.test(def.color), `${key} 颜色非法`);
    assert.ok(typeof def.shape === 'string' && def.shape, `${key} 缺少造型`);
  }
});

test('新敌人各有机制说明，四种机制齐备', () => {
  for (const type of NEW_TYPES) {
    assert.ok(ENEMIES[type], `缺少敌人 ${type}`);
    assert.ok(ENEMIES[type].desc && ENEMIES[type].desc.trim(), `${type} 缺少机制说明`);
  }
  assert.ok(Object.values(ENEMIES).some((e) => e.shield > 0), '缺少护盾型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.splits), '缺少分裂型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.aura), '缺少光环型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.ranged), '缺少远程型敌人');
});

test('新敌人接入波次生成', () => {
  const seen = new Set();
  for (const seed of ['w19-a', 'w19-b', 'w19-c', 'w19-d', 'w19-e', 'w19-f']) {
    for (let wave = 1; wave <= MAX_WAVE; wave++) {
      for (const group of generateWave(seed, wave, 'standard').groups) seen.add(group.type);
    }
  }
  for (const type of WAVE_TYPES) {
    assert.ok(seen.has(type), `${type} 未在波次生成中出现`);
  }
});

test('护盾优先吸收伤害，破盾后本体才掉血', () => {
  const sim = makeWaveSim();
  sim.spawnEnemy('shielder');
  const enemy = lastEnemy(sim);
  enemy.hp = enemy.maxHp = 1000;
  enemy.shield = enemy.maxShield = 90;
  enemy.armor = 0;

  sim.damage(enemy, 50, { ignoreArmor: true, silent: true });
  assert.equal(enemy.shield, 40, '护盾应吸收 50 点伤害');
  assert.equal(enemy.hp, 1000, '护盾未破时本体不掉血');

  sim.damage(enemy, 60, { ignoreArmor: true, silent: true });
  assert.equal(enemy.shield, 0, '护盾被击破');
  assert.equal(enemy.hp, 980, '溢出伤害才落到本体');
});

test('分裂敌人死亡后生成子怪', () => {
  const sim = makeWaveSim();
  sim.spawnEnemy('splitter');
  const enemy = lastEnemy(sim);
  enemy.hp = 1;

  sim.damage(enemy, 100, { ignoreArmor: true, silent: true });
  assert.equal(enemy.dead, true, '分裂敌人应死亡');
  sim.flushSplits();

  const children = sim.enemies.filter((e) => e.type === 'splitling' && !e.dead);
  assert.equal(children.length, ENEMIES.splitter.splits.count, '子怪数量应与定义一致');
  for (const child of children) {
    assert.equal(child.lane, enemy.lane);
    assert.ok(child.progress >= 0);
  }
});

test('光环敌人提升范围内其他敌人的移速', () => {
  const run = (withHerald) => {
    const sim = makeWaveSim('aura-seed');
    if (withHerald) sim.spawnEnemy('herald', 0);
    sim.spawnEnemy('grunt', 0);
    const grunt = sim.enemies.find((e) => e.type === 'grunt');
    for (let i = 0; i < 60; i++) sim.update(STEP);
    return grunt.progress;
  };

  const plain = run(false);
  const boosted = run(true);
  assert.ok(boosted > plain, '光环内敌人应前进更远');
  const ratio = boosted / plain;
  assert.ok(ratio > 1.15 && ratio < 1.45, `光环加速倍率异常：${ratio}`);
});

test('远程敌人攻击防御塔使其停摆', () => {
  const sim = makeWaveSim();
  sim.spawnEnemy('caster', 0);
  const enemy = lastEnemy(sim);
  const tower = sim.makeTower('arrow', Math.max(0, Math.floor(enemy.x)), Math.max(0, Math.floor(enemy.y)), 0, 0);
  sim.towers.push(tower);
  sim.recomputeTowerStats();

  let sawDisable = false;
  for (let i = 0; i < Math.ceil(3 / STEP); i++) {
    sim.update(STEP);
    if (tower.disabledUntil > sim.time) sawDisable = true;
  }
  assert.equal(sawDisable, true, '射程内防御塔应被远程敌人停摆');
  assert.ok(tower.disabledUntil > 0);
});

test('远程敌人逼近基地时直接轰击基地', () => {
  const sim = makeWaveSim();
  sim.spawnEnemy('caster', 0);
  const enemy = lastEnemy(sim);
  const lane = sim.lanes[enemy.lane];
  // 推进到基地射程内并移开所有塔，确保走基地分支。
  enemy.progress = lane.len - (enemy.ranged.baseRange - 0.2);
  const baseHp = sim.baseHp;
  sim.update(STEP);
  assert.ok(sim.baseHp < baseHp, '基地应受到远程伤害');
});

test('新敌人可通过类型分派渲染', () => {
  const sim = makeWaveSim();
  for (const type of NEW_TYPES) sim.spawnEnemy(type);
  const game = { enemies: sim.enemies, time: 0.5 };
  const renderer = new EnemyRenderer(game, { glow: null });
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  assert.doesNotThrow(() => renderer.render(ctx, 0.5, { glow: false, decorations: 'off' }));
});

test('同种子两次模拟状态一致', () => {
  const run = () => {
    const sim = makeSim('determinism-seed');
    sim.beginWave(generateWave('determinism-seed', 12, 'standard', sim.map.meta || {}));
    // 直接补入机制型敌人，确保护盾/分裂也进入确定性轨迹。
    sim.spawnEnemy('splitter', 0);
    sim.spawnEnemy('shielder', 0);
    const anchor = sim.posAt(sim.lanes[0].len * 0.35, 0);
    const tower = sim.makeTower(
      'cannon',
      Math.max(0, Math.floor(anchor.x)),
      Math.max(0, Math.floor(anchor.y)),
      1,
      0
    );
    sim.towers.push(tower);
    sim.recomputeTowerStats();

    const snapshots = [];
    for (let i = 0; i < 900; i++) {
      sim.update(STEP);
      if (i % 60 === 0) snapshots.push(stateOf(sim));
    }
    return snapshots;
  };

  assert.deepEqual(run(), run());
});
