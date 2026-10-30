// 派系点数层（docs/PHASE_ROGUE2.md §2/§3/§8）：五派系归属、4/8/12 阈值、setMods 独立乘区。
// setMods 绝不走 clampMods / GLOBAL_MOD_CAPS（§3.4 红线）；0 点时为空对象，战斗与无 2.0 逐字一致。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { RELICS, RELIC_BY_ID } from '../public/js/shared/data.js';
import {
  FACTION_ORDER,
  FACTION_NAMES,
  FACTION_TIERS,
  factionPoints,
  factionTiers,
  factionSetMods,
  relicFaction,
} from '../public/js/shared/factions.js';

const SEED = 'factions-test-seed';
const EPS = 1e-9;
const ALMOST = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPS, `${message || ''} 期望 ${expected}，实际 ${actual}`);

function makeSim(relics = [], opts = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onToast: () => {},
    onSave: () => {},
    ...opts,
  });
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 1, 1, level, 0);
  sim.towers.push(tower);
  return tower;
}

function addEnemy(sim, overrides = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, {
    hp: 100000,
    maxHp: 100000,
    armor: 0,
    boss: false,
    dead: false,
    slowUntil: 0,
    poisonUntil: 0,
  }, overrides);
  return enemy;
}

function hit(sim, enemy, tower) {
  const stats = sim.statsFor(tower);
  const before = enemy.hp;
  sim.dealDamage(enemy, stats.dmg, tower.type, {});
  return { before, after: enemy.hp, damage: before - enemy.hp, stats };
}

// ---------- 模块导出契约（§8.1） ----------

test('factions.js 导出面与冻结表逐符号一致', () => {
  assert.deepEqual(FACTION_ORDER, ['fire', 'frost', 'venom', 'storm', 'warden']);
  assert.deepEqual(FACTION_TIERS, [4, 8, 12]);
  assert.deepEqual(Object.keys(FACTION_NAMES).sort(), ['fire', 'frost', 'neutral', 'storm', 'venom', 'warden']);
  assert.equal(typeof factionPoints, 'function');
  assert.equal(typeof factionTiers, 'function');
  assert.equal(typeof factionSetMods, 'function');
  assert.equal(typeof relicFaction, 'function');
});

// ---------- 70 件遗物逐件归属（§2.3） ----------

test('70 件遗物全部带合法 faction，分布与冻结表一致', () => {
  assert.equal(RELICS.length, 70);
  const valid = ['fire', 'frost', 'venom', 'storm', 'warden', 'neutral'];
  const count = {};
  for (const relic of RELICS) {
    assert.ok(valid.includes(relic.faction), `遗物 ${relic.id} 的 faction 非法: ${relic.faction}`);
    count[relic.faction] = (count[relic.faction] || 0) + 1;
  }
  assert.deepEqual(count, { fire: 11, frost: 8, venom: 7, storm: 8, warden: 19, neutral: 17 });
});

test('relicFaction：未知 id 与缺失 faction 都回退 neutral', () => {
  assert.equal(relicFaction('sharp'), 'fire');
  assert.equal(relicFaction('coinpurse'), 'neutral');
  assert.equal(relicFaction('not-a-relic'), 'neutral');
});

// ---------- 点数与阈值（§2.2） ----------

test('factionPoints：点数 = 该派系遗物等级之和（1..3 封顶），中立不计', () => {
  // 两件火 2 级 + 一件火 3 级 = 7 点；一件中立 3 级不计；未知 id 不计。
  const states = [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 2 },
    { id: 'steadyaim', level: 3 },
    { id: 'coinpurse', level: 3 },
    { id: 'not-a-relic', level: 3 },
  ];
  const points = factionPoints(states);
  assert.equal(points.fire, 7);
  assert.equal(points.frost, 0);
  assert.equal(points.venom, 0);
  assert.equal(points.storm, 0);
  assert.equal(points.warden, 0);
  assert.equal('neutral' in points, false);
});

test('factionPoints：等级按 clamp(1..3) 计，字符串状态也归一', () => {
  const points = factionPoints(['sharp', { id: 'sharp', level: 9 }, { id: 'sharp', level: 0 }]);
  assert.equal(points.fire, 5); // 1 + 3 + 1
});

test('factionTiers：4/8/12 阈值下界，超过 12 不再有第四档', () => {
  assert.deepEqual(factionTiers([{ id: 'sharp', level: 3 }, { id: 'eagle', level: 1 }]).fire, 1); // 4
  assert.deepEqual(factionTiers([
    { id: 'sharp', level: 3 }, { id: 'eagle', level: 3 }, { id: 'steadyaim', level: 2 },
  ]).fire, 2); // 8
  assert.deepEqual(factionTiers([
    { id: 'sharp', level: 3 }, { id: 'eagle', level: 3 }, { id: 'steadyaim', level: 3 }, { id: 'velocity', level: 3 },
  ]).fire, 3); // 12
  // 19 件守护全满级 = 57 点，仍是 T3
  const wardenStates = RELICS.filter((r) => r.faction === 'warden').map((r) => ({ id: r.id, level: 3 }));
  assert.equal(factionTiers(wardenStates).warden, 3);
});

// ---------- setMods（§3.2/§3.3） ----------

test('factionSetMods：三档数值与冻结表 §3.3 逐字一致（不被旧 caps 裁剪）', () => {
  assert.deepEqual(factionSetMods({}), {});
  assert.deepEqual(factionSetMods({ fire: 1 }), { allDamage: 0.06 });
  assert.deepEqual(factionSetMods({ fire: 2 }), { allDamage: 0.06, critDamage: 0.4 });
  assert.deepEqual(factionSetMods({ fire: 3 }), {
    allDamage: 0.06,
    critDamage: 0.4,
    killExplosion: { ratio: 0.5, radius: 0.9 },
  });
  assert.deepEqual(factionSetMods({ frost: 3 }), {
    slowDuration: 0.15,
    frostFreeze: { hits: 10, duration: 0.6 },
    freezeVulnerable: { mult: 0.25, duration: 2 },
  });
  assert.deepEqual(factionSetMods({ venom: 3 }), {
    poisonSlow: 0.08,
    poisonVulnerable: 0.12,
    poisonSpread: { radius: 1.5, targets: 2, layers: 1 },
  });
  assert.deepEqual(factionSetMods({ storm: 3 }), {
    chainExtra: 1,
    chainRange: 0.4,
    chainCrit: true,
  });
  assert.deepEqual(factionSetMods({ warden: 3 }), {
    leakIgnoreChance: 0.2,
    leakDamageReduction: 1,
    setWaveHeal: { every: 3, amount: 1, capPerRun: 5 },
  });
});

test('setMods 键不进入遗物 mods 上限层（§3.4 红线）', () => {
  const setMods = factionSetMods({ fire: 3, storm: 3 });
  // 派系层是独立对象，不写回 sim.mods；重算后 sim.mods 不含任何 setMods 键。
  const sim = makeSim([
    { id: 'sharp', level: 3 }, { id: 'eagle', level: 3 }, { id: 'steadyaim', level: 3 }, { id: 'velocity', level: 3 },
  ]);
  assert.equal(sim.factions.setMods.allDamage, 0.06);
  assert.equal(sim.mods.allDamage, undefined);
  assert.equal(sim.mods.critDamage, undefined);
  assert.deepEqual(setMods.killExplosion, { ratio: 0.5, radius: 0.9 });
});

// ---------- sim 派系层重算（§8.2） ----------

test('recomputeFactions：0 点时 setMods 为空对象、tiers 全 0', () => {
  const sim = makeSim([{ id: 'coinpurse', level: 3 }]); // 中立 → 0 点
  assert.deepEqual(sim.factions.points, { fire: 0, frost: 0, venom: 0, storm: 0, warden: 0 });
  assert.deepEqual(sim.factions.tiers, { fire: 0, frost: 0, venom: 0, storm: 0, warden: 0 });
  assert.deepEqual(sim.factions.setMods, {});
});

test('recomputeFactions：遗物升级后派系层同步刷新', () => {
  const sim = makeSim([{ id: 'sharp', level: 1 }, { id: 'eagle', level: 1 }]); // 2 点，未到 T1
  assert.equal(sim.factions.tiers.fire, 0);
  sim.addRelic('sharp'); // → 3 点
  assert.equal(sim.factions.points.fire, 3);
  sim.addRelic('eagle'); // → 4 点，T1
  assert.equal(sim.factions.tiers.fire, 1);
  assert.equal(sim.factions.setMods.allDamage, 0.06);
});

// ---------- 战斗结算点接线（§3.2） ----------

test('火力 T1 allDamage：伤害入口独立乘区 +6%', () => {
  const sim = makeSim([{ id: 'eagle', level: 2 }, { id: 'steadyaim', level: 2 }]); // 4 点火（射程，不碰箭伤）
  assert.equal(sim.factions.setMods.allDamage, 0.06);
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim);
  ALMOST(hit(sim, enemy, tower).damage, 13 * 1.06, '火力 T1 伤害');

  const control = makeSim([]);
  const cTower = addTower(control, 'arrow');
  const cEnemy = addEnemy(control);
  ALMOST(hit(control, cEnemy, cTower).damage, 13, '无派系点对照');
});

test('火力 T2 critDamage：暴击总倍率 2.0 → 2.4', () => {
  const sim = makeSim([
    { id: 'sharp', level: 2 }, { id: 'eagle', level: 2 }, { id: 'steadyaim', level: 2 }, { id: 'crit', level: 2 },
  ]); // 8 点火 + crit 遗物
  assert.equal(sim.factions.setMods.critDamage, 0.4);
  sim.combatRng = { float: () => 0 }; // 必定暴击
  const hitResult = sim.computeHit(100, 'arrow', {}, {});
  assert.equal(hitResult.crit, true);
  ALMOST(hitResult.dmg, 100 * 2.4, '暴击含 critDamage');
});

test('蚀毒 T2 poisonVulnerable：中毒目标受到的伤害 +12%', () => {
  const sim = makeSim([
    { id: 'venomfang', level: 2 }, { id: 'venomvial', level: 2 }, { id: 'toxin', level: 2 }, { id: 'alchemy', level: 2 },
  ]); // 8 点毒
  assert.equal(sim.factions.setMods.poisonVulnerable, 0.12);
  const tower = addTower(sim, 'arrow');
  const enemy = addEnemy(sim, { poisonDps: 5, poisonUntil: 1000 });
  ALMOST(hit(sim, enemy, tower).damage, 13 * 1.12, '中毒易伤');
});

test('守护 T1/T2 漏怪结算：免伤概率与伤害 −1（下限 1）', () => {
  // T2：8 点守护 → leakDamageReduction 1 + leakIgnoreChance 0.2（掷骰置 1 免触发免伤）
  const sim = makeSim([
    { id: 'crystal', level: 2 }, { id: 'sandbag', level: 2 }, { id: 'emberclock', level: 2 }, { id: 'metronome', level: 2 },
  ]);
  assert.equal(sim.factions.setMods.leakDamageReduction, 1);
  sim.combatRng = { float: () => 1 };
  const enemy = addEnemy(sim, { dmg: 10 });
  const before = sim.baseHp;
  sim.leak(enemy);
  ALMOST(sim.baseHp, before - Math.max(1, 10 - 1), '漏怪伤害 −1');

  // T1：4 点守护 → 20% 免伤（掷骰 0 命中免伤 → 伤害 0）
  const sim2 = makeSim([{ id: 'crystal', level: 2 }, { id: 'sandbag', level: 2 }]);
  assert.equal(sim2.factions.setMods.leakIgnoreChance, 0.2);
  assert.equal(sim2.factions.setMods.leakDamageReduction, undefined);
  const enemy2 = addEnemy(sim2, { dmg: 10 });
  sim2.combatRng = { float: () => 0 };
  const before2 = sim2.baseHp;
  sim2.leak(enemy2);
  assert.equal(sim2.baseHp, before2, '免伤后基地生命不变');

  // T1 掷骰未命中 → 全额伤害
  const sim3 = makeSim([{ id: 'crystal', level: 2 }, { id: 'sandbag', level: 2 }]);
  const enemy3 = addEnemy(sim3, { dmg: 10 });
  sim3.combatRng = { float: () => 1 };
  const before3 = sim3.baseHp;
  sim3.leak(enemy3);
  ALMOST(sim3.baseHp, before3 - 10, '未免伤则全额');
});

// ---------- 0 点不变式（§8.2 不变式 3） ----------

test('0 点时派系层不消耗战斗 RNG，漏怪行为逐字不变', () => {
  const sim = makeSim([{ id: 'coinpurse', level: 1 }]); // 中立 → 0 点
  assert.deepEqual(sim.factions.setMods, {});
  const enemy = addEnemy(sim);
  let rolls = 0;
  sim.combatRng = { float: () => { rolls += 1; return 0; } };
  const before = sim.baseHp;
  sim.leak(enemy);
  assert.equal(rolls, 0, '0 点不应触发免伤掷骰');
  assert.equal(sim.baseHp, before - enemy.dmg, '0 点漏怪伤害不变');
});

// ---------- 快照（§8.4） ----------

test('快照不存派系层，读档后由遗物重算', () => {
  const sim = makeSim([
    { id: 'sharp', level: 3 }, { id: 'eagle', level: 3 }, { id: 'steadyaim', level: 3 }, { id: 'velocity', level: 3 },
  ]); // 12 点火 T3
  assert.equal(sim.factions.tiers.fire, 3);
  const snap = sim.toSnapshot();
  assert.equal('factions' in snap, false);
  assert.equal('tiers' in snap, false);
  assert.equal('setMods' in snap, false);

  const rebuilt = makeSim(snap.relics);
  assert.deepEqual(rebuilt.factions.points, sim.factions.points);
  assert.deepEqual(rebuilt.factions.tiers, sim.factions.tiers);
  assert.deepEqual(rebuilt.factions.setMods, sim.factions.setMods);
});
