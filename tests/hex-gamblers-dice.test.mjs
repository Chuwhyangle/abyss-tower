// 主海克斯「赌徒之骰」：每波确定性抽 1 运势 + 1 代价并整波生效、波末清理；
// 遗物完全随机（取消稀有度权重）、刷新次数 +1；无海克斯时行为与现状完全一致。
// 抽签只依赖 seed + 波次，所以测试用 rollGamblerWave 反查「抽到某一项」的波次，
// 再走真实的 beginWave/completeWave 路径，不直接调用钩子伪造状态。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { BALANCE } from '../public/js/shared/config.js';
import { MAX_WAVE, TOWERS } from '../public/js/shared/data.js';
import { rollRelicOffers } from '../public/js/shared/data.js';
import { rarityWeightForMode, MODE_RARITY_WEIGHTS } from '../public/js/shared/data/relics.js';
import { offerHexes } from '../public/js/shared/hexes.js';
import { HexRuntime } from '../public/js/shared/hexes/runtime.js';
import { hexScoreMul } from '../public/js/shared/scoring.js';
import { startServer } from './test-server.mjs';
import gamblersDice, {
  GAMBLER_COSTS,
  GAMBLER_FORTUNES,
  rollGamblerWave,
} from '../public/js/shared/hexes/gamblers-dice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 该 seed 在前 MAX_WAVE 波内覆盖两个池子的全部 12 项，且击杀金币的两项各有一个「单独出现」的波次。
const SEED = 'gambler-seed-1';
const UNLOCKED = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];
// generateWave 会把波次钳到 MAX_WAVE，抽签用的是钳后的 waveDef.index，所以只扫有效波次。
const WAVE_SCAN_LIMIT = MAX_WAVE;

function makeSim(opts = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: UNLOCKED,
    onToast: () => {},
    ...opts,
  });
}

// 找抽到指定项的波次；avoid 用于避开「另一池同时改同一数值」的波次（如击杀金币的两个池）。
function waveFor(field, id, avoid = null) {
  for (let wave = 1; wave <= WAVE_SCAN_LIMIT; wave += 1) {
    const roll = rollGamblerWave(SEED, wave);
    if (roll[field] !== id) continue;
    if (avoid && roll[avoid.field] === avoid.id) continue;
    return wave;
  }
  throw new Error(`seed ${SEED} 的前 ${WAVE_SCAN_LIMIT} 波里没有 ${field}=${id}`);
}

function beginWave(sim, wave) {
  const def = generateWave(SEED, wave);
  assert.equal(sim.beginWave(def), true, `第 ${wave} 波未能开始`);
  return def;
}

function buildableCell(sim) {
  for (let r = 0; r < sim.map.rows; r += 1) {
    for (let c = 0; c < sim.map.cols; c += 1) {
      if (sim.canBuild(c, r)) return { c, r };
    }
  }
  throw new Error('地图没有可建造格');
}

// 在指定格建一座塔并返回它；调用方保证金币充足。
function buildTower(sim, type = 'arrow') {
  const { c, r } = buildableCell(sim);
  assert.equal(sim.placeTower(type, c, r), true, '建塔失败');
  return sim.towerAt(c, r);
}

// 生成一只可控敌人并击杀，返回金币入账（与黄金律法测试同一手法）。
function killForGold(sim, gold = 20) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, { hp: 10, maxHp: 10, armor: 0, boss: false, dead: false, gold });
  const before = sim.gold;
  sim.dealDamage(enemy, 9999, 'arrow');
  return sim.gold - before;
}

// 生成队列里第一只敌人的 hp / baseSpeed（同一 seed 同一波，基线与海克斯只差本波代价）。
function firstSpawn(sim, wave) {
  beginWave(sim, wave);
  sim.waveTime = 999;
  sim.spawnDue();
  const enemy = sim.enemies[0];
  assert.ok(enemy, '波次没有生成敌人');
  return enemy;
}

// ---------- 定义与确定性 ----------

test('定义：id / scoreMul / implemented / 遗物声明与钩子齐全', () => {
  assert.equal(gamblersDice.id, 'gamblers_dice');
  assert.equal(gamblersDice.scoreMul, 1.1);
  assert.equal(gamblersDice.implemented, true);
  assert.equal(gamblersDice.gamblerRelicMode, true, '服务端据此取消稀有度权重');
  assert.equal(hexScoreMul('gamblers_dice'), 1.1);
  for (const hook of [
    'onWaveStart',
    'onWaveEnd',
    'modifyTowerStats',
    'buildCost',
    'upgradeCost',
    'onLeak',
    'relicRerollBonus',
  ]) {
    assert.equal(typeof gamblersDice.hooks[hook], 'function', `${hook} 钩子缺失`);
  }
  assert.equal(gamblersDice.hooks.relicRerollBonus(1), 2, '刷新次数 +1');
  // 运势与代价是两个互不重叠的池子，各抽 1 项自然不会有同池重复。
  const fortunes = new Set(GAMBLER_FORTUNES.map((item) => item.id));
  const costs = new Set(GAMBLER_COSTS.map((item) => item.id));
  assert.equal(fortunes.size, 6);
  assert.equal(costs.size, 6);
  for (const id of costs) assert.ok(!fortunes.has(id), `${id} 不应同时出现在两池`);
});

test('同一 seed 同一波次结果一致；不同波次可以不同', () => {
  const a = makeSim({ hex: 'gamblers_dice' });
  const b = makeSim({ hex: 'gamblers_dice' });
  beginWave(a, 3);
  beginWave(b, 3);
  assert.deepEqual(a.hexState.gambler.fortune, b.hexState.gambler.fortune);
  assert.deepEqual(a.hexState.gambler.cost, b.hexState.gambler.cost);

  // 刷新/重开同一波：新开一局（等同读档重开）抽签不变。
  const restart = makeSim({ hex: 'gamblers_dice' });
  beginWave(restart, 3);
  assert.deepEqual(restart.hexState.gambler, a.hexState.gambler);

  const combos = new Set();
  for (let wave = 1; wave <= 24; wave += 1) {
    const roll = rollGamblerWave(SEED, wave);
    combos.add(`${roll.fortune}/${roll.cost}`);
  }
  assert.ok(combos.size > 1, '不同波次应能抽到不同组合');
});

// ---------- 运势 ----------

test('运势：伤害 / 攻速 / 射程各自生效，波末清理', () => {
  const cases = [
    ['dmg', 'dmg', 1.25],
    ['rate', 'rate', 1.25],
    ['range', 'range', 1.2],
  ];
  const baselineStats = buildTower(makeSim()).stats;
  for (const [fortuneId, statKey, mul] of cases) {
    const wave = waveFor('fortune', fortuneId);
    const sim = makeSim({ hex: 'gamblers_dice' });
    const tower = buildTower(sim);
    beginWave(sim, wave);
    const boosted = tower.stats[statKey];
    assert.ok(
      Math.abs(boosted - baselineStats[statKey] * mul) < 1e-9,
      `${fortuneId}: ${boosted} != ${baselineStats[statKey]} × ${mul}`
    );
    // 同一运势只改一项，其余两项保持基线。
    for (const other of ['dmg', 'rate', 'range']) {
      if (other === statKey) continue;
      assert.ok(Math.abs(tower.stats[other] - baselineStats[other]) < 1e-9, `${fortuneId} 误改 ${other}`);
    }
    sim.completeWave();
    assert.ok(Math.abs(tower.stats[statKey] - baselineStats[statKey]) < 1e-9, `${fortuneId} 波末未清理`);
  }
});

test('运势：击杀金币 +50%', () => {
  const wave = waveFor('fortune', 'killGold', { field: 'cost', id: 'killGoldDown' });
  const baseline = makeSim({ gold: 1000 });
  beginWave(baseline, wave);
  const baseGain = killForGold(baseline);
  const expected = Math.round(
    20 * 1.5 * (1 + wave * BALANCE.killGoldWaveRate)
  );

  const sim = makeSim({ hex: 'gamblers_dice', gold: 1000 });
  beginWave(sim, wave);
  assert.equal(killForGold(sim), expected);
  assert.ok(killForGold(sim) > baseGain, '应高于基线入账');

  sim.completeWave();
  assert.equal(sim.mods.goldMul, 0, '波末临时 mod 应被清理');
});

test('运势：塔造价 -30%（升级价不变）', () => {
  const wave = waveFor('fortune', 'buildCost');
  const baseCost = makeSim().towerCost('arrow');
  const sim = makeSim({ hex: 'gamblers_dice' });
  assert.equal(sim.towerCost('arrow'), baseCost, '波前造价应与基线一致');
  beginWave(sim, wave);
  assert.equal(sim.towerCost('arrow'), Math.max(20, Math.round(TOWERS.arrow.cost * 0.7)));
  sim.completeWave();
  assert.equal(sim.towerCost('arrow'), baseCost, '波末造价应恢复');
});

test('运势：技能冷却 -50%，波末还原且不污染共享技能表', () => {
  const wave = waveFor('fortune', 'skillCd');
  const sim = makeSim({
    hex: 'gamblers_dice',
    skill: { id: 'aurora', level: 5 },
    gold: 1000,
  });
  const original = sim.skill.stats.cd;
  beginWave(sim, wave);
  assert.equal(sim.skill.stats.cd, original * 0.5);
  sim.completeWave();
  assert.equal(sim.skill.stats.cd, original, '波末应还原冷却');

  // 另一局的技能表不受影响（共享数据表行没有被原地修改）。
  const other = makeSim({ hex: 'gamblers_dice', skill: { id: 'aurora', level: 5 } });
  assert.equal(other.skill.stats.cd, original);
});

// ---------- 代价 ----------

test('代价：敌人生命 +15% / 移速 +10%', () => {
  const hpWave = waveFor('cost', 'enemyHp');
  const hpBase = firstSpawn(makeSim(), hpWave);
  const hpHex = firstSpawn(makeSim({ hex: 'gamblers_dice' }), hpWave);
  assert.ok(
    Math.abs(hpHex.hp - Math.round(hpBase.hp * 1.15)) <= 1,
    `敌人生命 ${hpHex.hp} 应约为基线的 1.15 倍`
  );
  // 首领召唤/分裂走的 waveDef.hpMul 兜底路径也同步抬高。
  const hpSim = makeSim({ hex: 'gamblers_dice' });
  const def = generateWave(SEED, hpWave);
  const rawHpMul = def.hpMul;
  hpSim.beginWave(def);
  assert.ok(Math.abs(hpSim.waveDef.hpMul - rawHpMul * 1.15) < 1e-9);

  const speedWave = waveFor('cost', 'enemySpeed');
  const speedBase = firstSpawn(makeSim(), speedWave);
  const speedHex = firstSpawn(makeSim({ hex: 'gamblers_dice' }), speedWave);
  assert.ok(Math.abs(speedHex.baseSpeed - speedBase.baseSpeed * 1.1) < 1e-9);
});

test('代价：本波击杀金币 -30%', () => {
  const wave = waveFor('cost', 'killGoldDown', { field: 'fortune', id: 'killGold' });
  const sim = makeSim({ hex: 'gamblers_dice', gold: 1000 });
  beginWave(sim, wave);
  const expected = Math.round(20 * 0.7 * (1 + wave * BALANCE.killGoldWaveRate));
  assert.equal(killForGold(sim), expected);
  sim.completeWave();
  assert.equal(sim.mods.goldMul, 0, '波末临时 mod 应被清理');
});

test('代价：本波技能不可用（按钮态经 isSkillReady 反映）', () => {
  const wave = waveFor('cost', 'skillLock');
  const sim = makeSim({ hex: 'gamblers_dice', skill: { id: 'aurora', level: 5 } });
  const original = sim.skill.cooldown;
  beginWave(sim, wave);
  assert.equal(sim.isSkillReady(), false);
  assert.equal(sim.castSkill(), false, '技能不可用时应拒绝施放');
  sim.completeWave();
  assert.equal(sim.skill.cooldown, original, '波末应还原冷却');
});

test('代价：本波塔不可升级，波末恢复', () => {
  const wave = waveFor('cost', 'upgradeLock');
  const sim = makeSim({ hex: 'gamblers_dice' });
  const tower = buildTower(sim);
  const normalCost = sim.upgradeCost(tower);
  assert.ok(normalCost > 0);
  beginWave(sim, wave);
  assert.equal(sim.upgradeCost(tower), null);
  assert.equal(sim.upgradeTower(tower), false);
  assert.equal(tower.level, 0, '塔不应被升级');
  sim.completeWave();
  assert.equal(sim.upgradeCost(tower), normalCost, '波末应恢复升级');
});

test('代价：本波漏怪伤害 +1', () => {
  const wave = waveFor('cost', 'leakDamage');
  const baseline = makeSim();
  const hexed = makeSim({ hex: 'gamblers_dice' });
  beginWave(baseline, wave);
  beginWave(hexed, wave);
  for (const sim of [baseline, hexed]) {
    sim.spawnEnemy('grunt');
    const enemy = sim.enemies[sim.enemies.length - 1];
    enemy.dmg = 3;
    sim.leak(enemy);
  }
  assert.equal(baseline.baseHp, 20 - 3);
  assert.equal(hexed.baseHp, 20 - 3 - 1);
});

// ---------- 波末清理与无海克斯基线 ----------

test('波末清理：抽签状态清空，临时 mod 与塔属性全部还原', () => {
  const wave = waveFor('fortune', 'dmg');
  const sim = makeSim({ hex: 'gamblers_dice' });
  const baselineStats = buildTower(makeSim()).stats;
  const tower = buildTower(sim);
  beginWave(sim, wave);
  assert.ok(tower.stats.dmg > baselineStats.dmg);
  assert.ok(sim.hexState.gambler);
  sim.completeWave();
  assert.equal(sim.hexState.gambler, undefined, '波末应删除抽签状态');
  assert.equal(sim.mods.goldMul, 0);
  assert.ok(Math.abs(tower.stats.dmg - baselineStats.dmg) < 1e-9);
});

test('无海克斯时行为不变', () => {
  const sim = makeSim();
  assert.equal(sim.hex, null);
  assert.equal(sim.hexState.gambler, undefined);
  const tower = buildTower(sim);
  const stats = { ...tower.stats };
  beginWave(sim, 1);
  // 无海克斯不会写入任何抽签状态，属性/造价/升级价都不变。
  assert.equal(sim.hexState.gambler, undefined);
  assert.deepEqual(tower.stats, stats);
  assert.equal(sim.towerCost('arrow'), makeSim().towerCost('arrow'));
  assert.ok(sim.upgradeCost(tower) > 0);

  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  enemy.dmg = 3;
  sim.leak(enemy);
  assert.equal(sim.baseHp, 20 - 3, '无海克斯漏怪不加伤');
});

// ---------- 遗物：完全随机 + 刷新 +1（运行时契约与服务端实盘） ----------

test('遗物：运行时暴露 gamblerRelicMode 与刷新次数加成', () => {
  const runtime = new HexRuntime('gamblers_dice');
  assert.equal(runtime.gamblerRelicMode, true);
  assert.equal(runtime.relicRerollBonus(1), 2);
  const plain = new HexRuntime('swarm');
  assert.equal(plain.gamblerRelicMode, false);
  assert.equal(plain.relicRerollBonus(1), 1, '无该钩子时原样返回');
});

test('遗物：gambler 模式忽略稀有度权重，与三档等权抽取一致', () => {
  assert.deepEqual(
    { ...MODE_RARITY_WEIGHTS.gambler },
    { common: 1, rare: 1, epic: 1 }
  );
  for (const rarity of ['common', 'rare', 'epic']) {
    assert.equal(rarityWeightForMode(rarity, 'gambler'), 1);
  }
  // 完全随机 = 在全部可抽遗物上均匀抽取；确定性仍由 seedKey 保证。
  const seedKey = `${SEED}:relic:1:0`;
  const gambler = rollRelicOffers(seedKey, [], 3, 1, 'gambler');
  assert.deepEqual(gambler, rollRelicOffers(seedKey, [], 3, 1, 'gambler'));
  assert.equal(gambler.length, 3);
  assert.ok(gambler.every((offer) => offer.kind === 'relic'));
  // 与普通权重相比，抽取序列会不同（权重真的被跳过了）。
  const normal = rollRelicOffers(seedKey, [], 3, 1, 'normal');
  assert.notDeepEqual(gambler, normal);
});

// ---------- 服务端实盘：create → 选赌徒之骰 → 第 1 波 → 遗物 draft ----------

let PORT = 0;
let BASE = '';
const DB = path.join(os.tmpdir(), `rtd-gamblers-dice-${process.pid}-${Date.now()}.db`);
const TOKEN = 'gamblers-dice-token-0001';

let server = null;

async function api(pathname, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': TOKEN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

// 反查一个让开局三选一包含赌徒之骰的测试种子。
// 服务端把 x-test-seed 拼成 test-<header>，再用 hexOfferSeed 的 `run:<seed>` 派生。
function gamblerSeedHeader() {
  for (let i = 0; i < 500; i += 1) {
    const header = `gamblers-${i}`;
    if (offerHexes(`run:test-${header}`, 3, 'normal').includes('gamblers_dice')) return header;
  }
  throw new Error('找不到包含赌徒之骰的开局种子');
}

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    seedHeader: true,
    env: { AUTH_ENABLED: '0' },
  });
  PORT = server.port;
  BASE = server.base;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('服务端：选了赌徒之骰后遗物 draft 完全随机且刷新次数 +1', async () => {
  const header = gamblerSeedHeader();
  const seed = `test-${header}`;
  const withSeed = { 'x-test-seed': header };

  const created = await api('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'roam' },
    headers: withSeed,
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const runId = created.data.runId;
  assert.ok(created.data.hexOffers.includes('gamblers_dice'), JSON.stringify(created.data.hexOffers));

  const chosen = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: 'gamblers_dice' },
    headers: withSeed,
  });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data));

  // 选完海克斯后 active 序列化就应带上 +1 的刷新次数。
  const active = await api('/api/runs/active', { headers: withSeed });
  assert.equal(active.status, 200, JSON.stringify(active.data));
  assert.equal(active.data.run.maxRerolls, 2);

  const map = await api(`/api/runs/${runId}/map`, {
    method: 'POST',
    body: { index: 0 },
    headers: withSeed,
  });
  assert.equal(map.status, 200, JSON.stringify(map.data));
  const wave = await api(`/api/runs/${runId}/wave`, {
    method: 'POST',
    body: {},
    headers: withSeed,
  });
  assert.equal(wave.status, 200, JSON.stringify(wave.data));
  const cleared = await api(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave: 1 },
    headers: withSeed,
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));

  const relics = await api(`/api/runs/${runId}/relics`, {
    method: 'POST',
    body: {},
    headers: withSeed,
  });
  assert.equal(relics.status, 200, JSON.stringify(relics.data));
  assert.equal(relics.data.maxRerolls, 2, '刷新次数应为基线 1 + 1');
  // 服务端 offer 必须与「gambler 模式（等权、完全随机）」的确定性抽取完全一致。
  assert.deepEqual(
    relics.data.offers,
    rollRelicOffers(`${seed}:relic:1:0`, relics.data.relics, 3, 1, 'gambler')
  );
});
