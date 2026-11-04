// 敌人扩容：21 种敌人、机制行为（护盾/分裂/光环/远程/闪烁 + 再生/反伤/治疗光环/自爆/潜行/召唤/穿透）、波次接入、渲染分派与模拟确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { ENEMIES, MAX_WAVE } from '../public/js/shared/data.js';
import { EnemyRenderer } from '../public/js/render/enemy-renderer.js';

const STEP = 1 / 60;
const REQUIRED_FIELDS = ['hp', 'speed', 'armor', 'gold', 'dmg'];
const NEW_TYPES = ['shielder', 'splitter', 'splitling', 'herald', 'caster', 'wraith', 'golem'];
const MECHANIC_TYPES = ['skywing', 'bastion', 'mender', 'bomber', 'stalker', 'riftcaller', 'shieldbreaker'];
const WAVE_TYPES = [
  'shielder', 'splitter', 'herald', 'caster', 'wraith', 'golem',
  'skywing', 'bastion', 'mender', 'bomber', 'stalker', 'riftcaller', 'shieldbreaker',
];

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

test('敌人种类 ≥14，id 唯一且必需字段合法', () => {
  const ids = Object.keys(ENEMIES);
  assert.ok(ids.length >= 14, `敌人种类只有 ${ids.length} 种`);
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

test('新敌人各有机制说明，五种机制齐备', () => {
  for (const type of NEW_TYPES) {
    assert.ok(ENEMIES[type], `缺少敌人 ${type}`);
    assert.ok(ENEMIES[type].desc && ENEMIES[type].desc.trim(), `${type} 缺少机制说明`);
  }
  assert.ok(Object.values(ENEMIES).some((e) => e.shield > 0), '缺少护盾型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.splits), '缺少分裂型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.aura), '缺少光环型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.ranged), '缺少远程型敌人');
  assert.ok(Object.values(ENEMIES).some((e) => e.blink), '缺少闪烁型敌人');
});

test('七种新型敌人各有独特机制字段与说明', () => {
  const mechanicFields = {
    skywing: 'shieldRegen',
    bastion: 'thorns',
    mender: 'healAura',
    bomber: 'fuse',
    stalker: 'lurk',
    riftcaller: 'summon',
    shieldbreaker: 'pierce',
  };
  for (const [type, field] of Object.entries(mechanicFields)) {
    assert.ok(ENEMIES[type], `缺少敌人 ${type}`);
    assert.ok(ENEMIES[type][field] != null, `${type} 缺少机制字段 ${field}`);
    assert.ok(ENEMIES[type].desc && ENEMIES[type].desc.trim(), `${type} 缺少机制说明`);
  }
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

test('岩石魔像死亡裂成 2 只裂生虫，且可复现', () => {
  const run = () => {
    const sim = makeWaveSim('golem-seed');
    sim.spawnEnemy('golem', 0);
    const enemy = lastEnemy(sim);
    enemy.hp = 1;
    sim.damage(enemy, 100, { ignoreArmor: true, silent: true });
    assert.equal(enemy.dead, true, '魔像应死亡');
    sim.flushSplits();
    return sim.enemies
      .filter((e) => e.type === 'splitling' && !e.dead)
      .map((e) => [e.lane, round6(e.progress)]);
  };

  const children = run();
  assert.equal(children.length, ENEMIES.golem.splits.count, '魔像死亡应裂成 2 只裂生虫');
  for (const [lane, progress] of children) {
    assert.equal(lane, 0, '子怪应继承魔像车道');
    assert.ok(progress >= 0);
  }
  assert.deepEqual(run(), children, '同种子魔像分裂必须可复现');
});

test('相位幽魂周期性闪烁：单帧位移突增，且不消耗战斗 RNG', () => {
  const run = () => {
    const sim = makeWaveSim('wraith-seed');
    sim.spawnEnemy('wraith', 0);
    const enemy = lastEnemy(sim);
    let maxDelta = 0;
    for (let i = 0; i < 300; i++) {
      const before = enemy.progress;
      sim.update(STEP);
      maxDelta = Math.max(maxDelta, enemy.progress - before);
    }
    return maxDelta;
  };

  // 正常移动每帧只有 speed*dt ≈ 0.025，闪烁一帧额外推进 distance 0.55。
  const first = run();
  assert.ok(first >= 0.4, `闪烁单帧位移突增不足：${first}`);
  assert.equal(run(), first, '同种子闪烁轨迹必须可复现');
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

test('穹翼精英护盾持续再生', () => {
  const sim = makeWaveSim('skywing-seed');
  sim.spawnEnemy('skywing', 0);
  const enemy = lastEnemy(sim);
  enemy.hp = enemy.maxHp = 1000;
  enemy.shield = 10;
  for (let i = 0; i < 60; i++) sim.update(STEP);
  assert.ok(enemy.shield > 10, `护盾应再生：${enemy.shield}`);
  assert.ok(enemy.shield <= enemy.maxShield, '再生不应超过护盾上限');
});

test('反伤壁垒破盾前周期性停摆近身塔，破盾后失效', () => {
  const run = (breakShield) => {
    const sim = makeWaveSim('bastion-seed');
    sim.spawnEnemy('bastion', 0);
    const enemy = lastEnemy(sim);
    const tower = sim.makeTower('arrow', Math.max(0, Math.floor(enemy.x)), Math.max(0, Math.floor(enemy.y)), 0, 0);
    sim.towers.push(tower);
    sim.recomputeTowerStats();
    // 拉高护盾上限，保证非破盾分支在测试窗口内始终有盾（塔的火力打不破）。
    enemy.shield = enemy.maxShield = 100000;
    if (breakShield) enemy.shield = 0;
    let sawDisable = false;
    for (let i = 0; i < 200; i++) {
      sim.update(STEP);
      if (tower.disabledUntil > sim.time) sawDisable = true;
    }
    return sawDisable;
  };
  assert.equal(run(false), true, '破盾前反伤脉冲应停摆近身塔');
  assert.equal(run(true), false, '破盾后不应再释放反伤脉冲');
});

test('回春图腾治疗光环内友军', () => {
  const run = (withMender) => {
    const sim = makeWaveSim('mender-seed');
    if (withMender) sim.spawnEnemy('mender', 0);
    sim.spawnEnemy('grunt', 0);
    const grunt = sim.enemies.find((e) => e.type === 'grunt');
    grunt.hp = grunt.maxHp = 100;
    grunt.hp = 20;
    for (let i = 0; i < 120; i++) sim.update(STEP);
    return grunt.hp;
  };
  const plain = run(false);
  const healed = run(true);
  assert.ok(healed > plain, '光环内友军应被治疗');
});

test('自爆虫逼近基地即自爆伤害基地', () => {
  const sim = makeWaveSim('bomber-seed');
  sim.spawnEnemy('bomber', 0);
  const enemy = lastEnemy(sim);
  const lane = sim.lanes[enemy.lane];
  enemy.progress = lane.len * 0.9;
  const baseHp = sim.baseHp;
  sim.update(STEP);
  assert.ok(sim.baseHp < baseHp, '基地应受到自爆伤害');
  assert.equal(enemy.dead, true, '自爆虫应自爆死亡');
});

test('潜行者周期性冲刺：单帧位移突增，且不耗 RNG', () => {
  const run = () => {
    const sim = makeWaveSim('stalker-seed');
    sim.spawnEnemy('stalker', 0);
    const enemy = lastEnemy(sim);
    let maxDelta = 0;
    for (let i = 0; i < 300; i++) {
      const before = enemy.progress;
      sim.update(STEP);
      maxDelta = Math.max(maxDelta, enemy.progress - before);
    }
    return maxDelta;
  };
  const first = run();
  assert.ok(first >= 0.045, `冲刺单帧位移突增不足：${first}`);
  assert.equal(run(), first, '同种子冲刺轨迹必须可复现');
});

test('裂隙召唤师周期性召唤噬虫', () => {
  const sim = makeWaveSim('summoner-seed');
  sim.spawnEnemy('riftcaller', 0);
  const enemy = lastEnemy(sim);
  for (let i = 0; i < 300; i++) sim.update(STEP);
  const children = sim.enemies.filter((e) => e.type === 'swarm' && !e.dead);
  assert.ok(children.length > 0, '应召唤噬虫小弟');
  assert.equal(enemy.summoned, children.length, '召唤数与计数器一致');
});

test('破盾者漏怪无视守护套装减伤', () => {
  const sim = makeWaveSim('pierce-seed');
  sim.factions.setMods.leakDamageReduction = 3;
  sim.spawnEnemy('tank', 0);
  const tank = lastEnemy(sim);
  const hpBeforeTank = sim.baseHp;
  sim.leak(tank);
  assert.equal(sim.baseHp, hpBeforeTank - 1, '普通敌人漏怪应被减伤到 1');

  sim.spawnEnemy('shieldbreaker', 0);
  const breaker = lastEnemy(sim);
  const hpBeforeBreaker = sim.baseHp;
  sim.leak(breaker);
  assert.equal(sim.baseHp, hpBeforeBreaker - 2, '破盾者漏怪应无视减伤');
});

test('新敌人可通过类型分派渲染', () => {
  const sim = makeWaveSim();
  for (const type of [...NEW_TYPES, ...MECHANIC_TYPES]) sim.spawnEnemy(type);
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
    // 直接补入机制型敌人，确保护盾/分裂/闪烁/再生/反伤/自爆/潜行/召唤也进入确定性轨迹。
    sim.spawnEnemy('splitter', 0);
    sim.spawnEnemy('shielder', 0);
    sim.spawnEnemy('wraith', 0);
    sim.spawnEnemy('golem', 0);
    sim.spawnEnemy('skywing', 0);
    sim.spawnEnemy('bastion', 0);
    sim.spawnEnemy('mender', 0);
    sim.spawnEnemy('bomber', 0);
    sim.spawnEnemy('stalker', 0);
    sim.spawnEnemy('riftcaller', 0);
    sim.spawnEnemy('shieldbreaker', 0);
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
