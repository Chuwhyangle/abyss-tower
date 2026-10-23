// 塔扩容深度：数量、字段完整性、TOWER_ORDER 一致性、新塔战斗行为与确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWERS, TOWER_ORDER, UNLOCK_BY_ID } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SEED = 'towers-depth-seed';
const NEW_TOWERS = ['banner', 'shock', 'sniper'];

function makeSim({ seed = SEED, towers = [] } = {}) {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers,
    unlockedTowers: [...TOWER_ORDER],
    onToast: () => {},
  });
}

function buildableCells(sim, count = 2) {
  const cells = [];
  for (let r = 0; r < sim.map.rows && cells.length < count; r++) {
    for (let c = 0; c < sim.map.cols && cells.length < count; c++) {
      if (sim.canBuild(c, r)) cells.push({ c, r });
    }
  }
  return cells;
}

function stateHash(sim) {
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
      slowAmt: round(enemy.slowAmt),
      slowUntil: round(enemy.slowUntil),
      poisonDps: round(enemy.poisonDps),
      poisonUntil: round(enemy.poisonUntil),
    })),
    projectiles: sim.projectiles.map((proj) => ({
      id: proj.id,
      kind: proj.kind,
      towerType: proj.towerType,
      x: round(proj.x),
      y: round(proj.y),
      ttl: round(proj.ttl),
    })),
    towers: sim.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      level: tower.level,
      cd: round(tower.cd),
      angle: round(tower.angle),
      target: tower.target ? tower.target.id : null,
    })),
  });
}

test('至少 8 种塔，id 唯一且与键名一致', () => {
  const ids = Object.keys(TOWERS);
  assert.ok(ids.length >= 8, `当前只有 ${ids.length} 种塔`);
  assert.equal(new Set(ids).size, ids.length, '塔 id 必须唯一');
  for (const [key, def] of Object.entries(TOWERS)) {
    assert.equal(def.id, key, `${key} 的 id 字段与键名不一致`);
  }
});

test('必需字段齐全，等级数值合法，解锁项存在', () => {
  for (const [id, def] of Object.entries(TOWERS)) {
    for (const field of ['name', 'glyph', 'color', 'desc']) {
      assert.ok(typeof def[field] === 'string' && def[field].trim(), `${id} 缺少 ${field}`);
    }
    assert.ok(Number.isFinite(def.cost) && def.cost > 0, `${id} 造价非法`);
    assert.ok(Array.isArray(def.levels) && def.levels.length >= 3, `${id} 至少需要 3 级`);
    for (const level of def.levels) {
      assert.ok(Number.isFinite(level.cost) && level.cost >= 0, `${id} 等级造价非法`);
      assert.ok(Number.isFinite(level.range) && level.range > 0, `${id} 射程非法`);
      if (def.support) {
        assert.ok(Number.isFinite(level.buffDmg) && level.buffDmg > 0, `${id} 缺少光环增伤`);
        assert.ok(Number.isFinite(level.buffRate) && level.buffRate > 0, `${id} 缺少光环攻速`);
        assert.equal(def.proj, undefined, `${id} 是支援塔，不应有投射物`);
      } else {
        assert.ok(Number.isFinite(level.dmg) && level.dmg > 0, `${id} 伤害非法`);
        assert.ok(Number.isFinite(level.rate) && level.rate > 0, `${id} 攻速非法`);
        assert.ok(def.proj && def.proj.kind, `${id} 缺少投射物定义`);
      }
    }
    if (def.unlock) {
      assert.ok(UNLOCK_BY_ID[def.unlock], `${id} 的解锁项 ${def.unlock} 不存在`);
    }
  }
});

test('TOWER_ORDER 与 TOWERS 键集合一致且无重复', () => {
  assert.equal(new Set(TOWER_ORDER).size, TOWER_ORDER.length, 'TOWER_ORDER 有重复项');
  assert.deepEqual([...TOWER_ORDER].sort(), Object.keys(TOWERS).sort());
  for (const id of NEW_TOWERS) assert.ok(TOWER_ORDER.includes(id), `${id} 未加入 TOWER_ORDER`);
});

test('新塔可建造，含新塔的局可跑 100 步不报错', () => {
  const sim = makeSim();
  const cells = buildableCells(sim, 3);
  assert.equal(cells.length, 3, '地图上找不到可建造格');
  assert.ok(sim.placeTower('banner', cells[0].c, cells[0].r), '战旗塔无法建造');
  assert.ok(sim.placeTower('shock', cells[1].c, cells[1].r), '震荡塔无法建造');
  assert.ok(sim.placeTower('sniper', cells[2].c, cells[2].r), '狙击塔无法建造');

  sim.beginWave(generateWave(sim.seed, 1, 'standard', {}));
  for (let i = 0; i < 100; i++) sim.update(1 / 60);

  assert.ok(sim.time > 0, '模拟未推进');
  const banner = sim.towers.find((tower) => tower.type === 'banner');
  assert.equal(banner.target, null, '战旗塔不应索敌');
  assert.equal(
    sim.projectiles.some((proj) => proj.towerType === 'banner'),
    false,
    '战旗塔不应产生投射物',
  );
});

test('战旗塔光环提升范围内塔的伤害与攻速，范围外不受影响', () => {
  const sim = makeSim({
    towers: [
      { type: 'banner', c: 5, r: 5 },
      { type: 'arrow', c: 6, r: 5 },
      { type: 'arrow', c: 15, r: 5 },
    ],
  });
  const banner = sim.towers[0];
  const near = sim.towers[1];
  const far = sim.towers[2];

  assert.equal(banner.stats.dmg, 0, '战旗塔本身不造成伤害');
  assert.equal(far.stats.dmg, 13, '光环外的弩塔保持基础伤害');
  assert.equal(far.stats.rate, 1.15, '光环外的弩塔保持基础攻速');
  assert.ok(near.stats.dmg > far.stats.dmg, '光环内的弩塔伤害应提升');
  assert.ok(near.stats.rate > far.stats.rate, '光环内的弩塔攻速应提升');
  assert.ok(Math.abs(near.stats.dmg - 13 * (1 + 0.12)) < 1e-9, '一级光环增伤应为 12%');
  assert.deepEqual(near.aura, { dmg: 0.12, rate: 0.08 });

  // 移除战旗塔后光环立即失效。
  sim.sellTower(banner);
  assert.ok(Math.abs(near.stats.dmg - 13) < 1e-9, '战旗塔出售后应移除光环');
  assert.equal(near.aura, null);
});

test('震荡塔命中施加减速与击退', () => {
  const sim = makeSim();
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  enemy.progress = 5;
  const payload = {
    dmg: 0,
    towerType: 'shock',
    slow: 0.3,
    slowDur: 1,
    knockback: 0.4,
    ignoreArmor: true,
  };

  sim.hitEnemy(enemy, payload);

  assert.ok(Math.abs(enemy.progress - 4.6) < 1e-9, `击退后进度应为 4.6，实际 ${enemy.progress}`);
  assert.ok(enemy.slowAmt >= 0.3, '目标应被减速');
  assert.ok(enemy.slowUntil > sim.time, '减速应持续到未来时刻');
});

test('含新塔的模拟在相同种子下两次运行得到相同状态哈希', () => {
  const run = (seed) => {
    const sim = makeSim({
      seed,
      towers: [
        { type: 'banner', c: 5, r: 5 },
        { type: 'shock', c: 6, r: 5 },
        { type: 'arrow', c: 7, r: 5 },
        { type: 'cannon', c: 8, r: 5 },
      ],
    });
    sim.beginWave(generateWave(seed, 3, 'standard', {}));
    for (let i = 0; i < 100; i++) sim.update(1 / 60);
    return stateHash(sim);
  };

  assert.equal(run('determinism-a'), run('determinism-a'));
  assert.notEqual(run('determinism-a'), run('determinism-b'));
});
