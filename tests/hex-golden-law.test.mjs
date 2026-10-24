// 主海克斯「黄金律法」：开局 +250 金、击杀金币 ×1.45、波末征税 15%（至少 10）、
// 卖塔返还 35% 与遗物刷新半价；无海克斯时行为必须与现状完全一致。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { MAX_WAVE, TOWERS } from '../public/js/shared/data.js';
import { BALANCE } from '../public/js/shared/config.js';
import { HexRuntime } from '../public/js/shared/hexes/runtime.js';
import goldenLaw from '../public/js/shared/hexes/golden-law.js';

const SEED = 'hex-golden-law-seed';
const UNLOCKED = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];

function makeSim(opts = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: UNLOCKED,
    hex: 'golden_law',
    onToast: () => {},
    ...opts,
  });
}

// 空波定义：只用来走真实的 beginWave/completeWave 路径（奖励可注入）。
function waveDef(index = 1, reward = 0) {
  return { index, groups: [], reward, hpMul: 1, speedMul: 1, totalCount: 0, boss: false };
}

// 生成一只一碰就死的敌人，返回击杀前后的金币差。
function killForGold(sim, gold) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, { hp: 10, maxHp: 10, armor: 0, boss: false, dead: false, gold });
  const before = sim.gold;
  sim.dealDamage(enemy, 9999, 'arrow');
  return sim.gold - before;
}

function buildableCell(sim) {
  for (let r = 0; r < sim.map.rows; r++) {
    for (let c = 0; c < sim.map.cols; c++) {
      if (sim.canBuild(c, r)) return { c, r };
    }
  }
  throw new Error('地图没有可建造格');
}

test('定义：id / scoreMul / implemented 与设计一致，钩子齐全', () => {
  assert.equal(goldenLaw.id, 'golden_law');
  assert.equal(goldenLaw.scoreMul, 1.1);
  assert.equal(goldenLaw.implemented, true);
  for (const hook of ['onRunInit', 'onEnemyKilled', 'onWaveEnd', 'sellRatio', 'relicRerollCost']) {
    assert.equal(typeof goldenLaw.hooks[hook], 'function', `${hook} 钩子缺失`);
  }
});

test('开局 +250 金；读档不重复发放', () => {
  const sim = makeSim({ gold: 100 });
  assert.equal(sim.gold, 350);

  const restored = makeSim({ gold: 350, hexState: {}, restored: true });
  assert.equal(restored.gold, 350, 'restored 不再重放 onRunInit');
});

test('击杀金币 ×1.45（第 0 波基线）', () => {
  const sim = makeSim({ gold: 1000 });
  assert.equal(sim.wave, 0);
  // 基础入账 = round(20 × 1) = 20；额外 45% = 9；合计 29 = 20 × 1.45。
  assert.equal(killForGold(sim, 20), 29);
  assert.equal(killForGold(sim, 20), 29, '重复击杀保持同一倍率');
});

test('击杀金币 ×1.45 与波次成长、现有 gold mod 都是单次乘算', () => {
  const sim = makeSim({ gold: 1000 });
  sim.wave = 20;
  // 波次成长 1 + 20 × 0.005 = 1.1；入账 round(20 × 1.1) = 22；再 ×1.45 ≈ 32（差额 round(9.9)=10）。
  const expected = Math.round(20 * (1 + 20 * BALANCE.killGoldWaveRate));
  assert.equal(killForGold(sim, 20), expected + Math.round(expected * 0.45));

  // 遗物 goldMul 已在基础入账中生效，黄金律法只补差额，不会把 gold mod 再乘一次。
  const withMod = makeSim({ gold: 1000 });
  withMod.mods = { ...withMod.mods, goldMul: 0.2 };
  const awarded = Math.round(20 * 1.2);
  assert.equal(killForGold(withMod, 20), awarded + Math.round(awarded * 0.45));
});

test('波末征税 15%，计税基数是本波奖励入账之后的金币', () => {
  const sim = makeSim({ gold: 750 }); // onRunInit 后 1000
  assert.equal(sim.gold, 1000);
  assert.equal(sim.beginWave(waveDef(1, 100)), true);
  sim.completeWave();
  // 1000 + 奖励 100 = 1100；税 = round(1100 × 15 / 100) = 165。
  assert.equal(sim.gold, 935);
});

test('征税至少 10 金；不足时扣到 0；0 金不再扣', () => {
  const sim = makeSim();
  sim.gold = 50;
  sim.beginWave(waveDef(1));
  sim.completeWave();
  assert.equal(sim.gold, 40, '50 × 15% = 7.5 → 至少 10');

  const broke = makeSim();
  broke.gold = 5;
  broke.beginWave(waveDef(1));
  broke.completeWave();
  assert.equal(broke.gold, 0, '余额不足 10 时扣到 0');

  const zero = makeSim();
  zero.gold = 0;
  zero.beginWave(waveDef(1));
  zero.completeWave();
  assert.equal(zero.gold, 0, '0 金不扣，也不出现负数');

  const rounding = makeSim();
  rounding.gold = 110;
  rounding.beginWave(waveDef(1));
  rounding.completeWave();
  assert.equal(rounding.gold, 93, '110 × 15% = 16.5 → 四舍五入 17');
});

test('最后一波同样征税，且在通关结算之前执行', () => {
  const sim = makeSim({ gold: 750 }); // 1000
  assert.equal(sim.beginWave(waveDef(MAX_WAVE)), true);
  sim.completeWave();
  assert.equal(sim.gold, 850);
  assert.equal(sim.phase, 'over', '最后一波结束后进入结算');
});

test('卖塔返还 35%（基础 70% × 0.5）', () => {
  const sim = makeSim({ gold: 1000 });
  const cell = buildableCell(sim);
  assert.equal(sim.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim.towerAt(cell.c, cell.r);
  assert.equal(sim.sellValue(tower), Math.floor(tower.invested * 0.35));
  assert.ok(sim.sellValue(tower) < Math.floor(tower.invested * 0.7), '明显低于基础返还');
});

test('遗物刷新半价，最低 1 金', () => {
  const runtime = new HexRuntime('golden_law');
  assert.equal(runtime.relicRerollCost(25, 0), 13, '25 × 0.5 = 12.5 → 13');
  assert.equal(runtime.relicRerollCost(25, 3), 13, '费用与已用次数无关');
  assert.equal(runtime.relicRerollCost(3, 0), 2);
  assert.equal(runtime.relicRerollCost(0, 0), 1, '最低 1 金');
});

test('无海克斯时行为不变：不加金、不征税、卖塔 70%、刷新原价', () => {
  const sim = makeSim({ hex: null, gold: 1000 });
  assert.equal(sim.hex, null);
  assert.equal(sim.gold, 1000, '开局不加金');

  assert.equal(killForGold(sim, 20), 20, '击杀金币不变');

  const cell = buildableCell(sim);
  assert.equal(sim.placeTower('arrow', cell.c, cell.r), true);
  const tower = sim.towerAt(cell.c, cell.r);
  assert.equal(sim.sellValue(tower), Math.floor(tower.invested * 0.7), '基础返还 70%');
  assert.equal(sim.canBuild(cell.c, cell.r), false, '塔位已被占用');

  const before = sim.gold;
  sim.beginWave(waveDef(1, 100));
  sim.completeWave();
  assert.equal(sim.gold, before + 100, '波末只有奖励，没有税');

  const plain = new HexRuntime(null);
  assert.equal(plain.relicRerollCost(25, 0), 25, '刷新费原价');
  assert.equal(plain.sellRatio(0.7), 0.7, '返还比例原样');
  assert.equal(TOWERS.arrow.cost > 0, true, '数据表可读');
});
