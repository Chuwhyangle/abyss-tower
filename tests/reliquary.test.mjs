// 遗物升级：等级数值、抽取/升级/补位、即时生命增量、属性缓存与旧存档兼容。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import {
  RELICS,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  relicModsAtLevel,
  relicEffectText,
  rollRelicOffers,
  normalizeRelicStates,
  GLOBAL_MOD_CAPS,
} from '../public/js/shared/data.js';
import { normalizeSnapshot } from '../public/js/shared/save.js';

function makeSim(relics = []) {
  return new Simulation({
    map: generateMap('relic-test-seed'),
    seed: 'relic-test-seed',
    difficulty: 'standard',
    gold: 1000,
    baseHp: 20,
    maxBaseHp: 20,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onToast: () => {},
  });
}

test('遗物等级数值：+25% → +40% → +55%', () => {
  assert.equal(relicModsAtLevel('sharp', 1).dmg.arrow, 0.25);
  assert.equal(relicModsAtLevel('sharp', 2).dmg.arrow, 0.4);
  assert.equal(relicModsAtLevel('sharp', 3).dmg.arrow, 0.55);
  assert.match(relicEffectText('sharp', 2), /40%/);
});

test('抽取：新遗物不重复，满级退出，池尽时补位', () => {
  const fresh = rollRelicOffers('offers-fresh', [], 3, 5);
  assert.equal(fresh.length, 3);
  assert.ok(fresh.every((offer) => offer.kind === 'relic'));
  assert.equal(new Set(fresh.map((offer) => offer.id)).size, 3);
  assert.ok(fresh.every((offer) => offer.fromLevel === 0 && offer.toLevel === 1));

  const almostFull = RELICS.map((relic) => ({
    id: relic.id,
    level: relic.id === 'sharp' ? 1 : RELIC_MAX_LEVEL,
  }));
  const upgradeOffers = rollRelicOffers('offers-upgrade', almostFull, 3, 12);
  const relicOffers = upgradeOffers.filter((offer) => offer.kind === 'relic');
  assert.equal(relicOffers.length, 1);
  assert.equal(relicOffers[0].id, 'sharp');
  assert.equal(relicOffers[0].fromLevel, 1);
  assert.equal(relicOffers[0].toLevel, 2);
  assert.equal(upgradeOffers.length, 3);
  assert.ok(upgradeOffers.some((offer) => offer.kind === 'gold' || offer.kind === 'repair'));

  const full = RELICS.map((relic) => ({ id: relic.id, level: RELIC_MAX_LEVEL }));
  const fallbackOnly = rollRelicOffers('offers-full', full, 3, 30);
  assert.equal(fallbackOnly.length, 3);
  assert.ok(fallbackOnly.every((offer) => offer.kind !== 'relic'));
  assert.ok(fallbackOnly.every((offer) => offer.amount > 0));
});

test('升级：重复获得提升等级，满级拒绝，属性与缓存同步', () => {
  const sim = makeSim();
  const tower = sim.makeTower('arrow', 1, 1, 0, 0);
  sim.towers.push(tower);
  sim.refreshTowerStats(tower);
  assert.equal(sim.statsFor(tower).dmg, 13);

  assert.equal(sim.addRelic('sharp').toLevel, 1);
  const level1Stats = sim.statsFor(tower);
  assert.equal(level1Stats.dmg, 16.25);

  assert.equal(sim.addRelic({ kind: 'relic', id: 'sharp', toLevel: 2 }).toLevel, 2);
  const level2Stats = sim.statsFor(tower);
  assert.notEqual(level2Stats, level1Stats, '遗物变化后应刷新缓存');
  assert.equal(level2Stats.dmg, 13 * 1.4);

  assert.equal(sim.addRelic('sharp').toLevel, 3);
  assert.equal(sim.getRelicLevel('sharp'), 3);
  assert.equal(sim.relics.length, 1, '同一遗物不重复占位');
  assert.equal(sim.addRelic('sharp').applied, false);

  const cached = tower.stats;
  sim.updateTowers(1 / 60);
  assert.equal(tower.stats, cached, '模拟步内不应重建塔属性');
});

test('即时生命：升级只补发新增部分', () => {
  const sim = makeSim();
  sim.addRelic('crystal');
  assert.equal(sim.maxBaseHp, 25);
  assert.equal(sim.baseHp, 25);

  sim.addRelic({ kind: 'relic', id: 'crystal', toLevel: 2 });
  assert.equal(sim.maxBaseHp, 28);
  assert.equal(sim.baseHp, 28);

  sim.addRelic({ kind: 'relic', id: 'crystal', toLevel: 3 });
  assert.equal(sim.maxBaseHp, 31);
  assert.equal(sim.baseHp, 31);
});

test('补位奖励：金币与修复可应用且修复不超上限', () => {
  const sim = makeSim();
  sim.applyOffer({ kind: 'gold', amount: 120 });
  assert.equal(sim.gold, 1120);

  sim.baseHp = 18;
  const repaired = sim.applyOffer({ kind: 'repair', amount: 10 });
  assert.equal(sim.baseHp, 20);
  assert.equal(repaired.amount, 2);
});

test('全局上限：攻速与连锁不会无限叠加', () => {
  const sim = makeSim([
    { id: 'warhorn', level: 3 },
    { id: 'quickdraw', level: 3 },
    { id: 'static', level: 3 },
  ]);
  assert.ok(sim.mods.fireRate <= GLOBAL_MOD_CAPS.fireRate + 1e-9);
  assert.ok(sim.mods.chain <= GLOBAL_MOD_CAPS.chain + 1e-9);
  const tower = sim.makeTower('arc', 1, 1, 0, 0);
  const stats = sim.computeTowerStats(tower);
  assert.ok(stats.chain <= 3 + GLOBAL_MOD_CAPS.chain + 1e-9);
});

test('存档：v3 状态保存，v2 旧档按 Ⅰ 级恢复', () => {
  const sim = makeSim([{ id: 'sharp', level: 2 }, 'eagle']);
  assert.deepEqual(sim.relics, [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 1 },
  ]);
  const snapshot = sim.toSnapshot();
  assert.equal(snapshot.version, 3);
  assert.deepEqual(snapshot.relics, [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 1 },
  ]);

  const legacy = normalizeSnapshot({
    version: 2,
    wave: 4,
    relics: ['sharp', 'eagle'],
    gold: 100,
    towers: [],
  });
  assert.equal(legacy.clearedWave, 4);
  assert.deepEqual(legacy.relics, [
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: 1 },
  ]);
  assert.equal(legacy.pendingDraft, false);
  assert.equal(normalizeSnapshot({ version: 2, relics: [{ id: 'sharp', level: 9 }] }).relics[0].level, 3);
});

test('清波未确认时不覆盖波前快照', () => {
  const saves = [];
  const sim = new Simulation({
    map: generateMap('save-guard-seed'),
    seed: 'save-guard-seed',
    difficulty: 'standard',
    gold: 500,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    onSave: (snapshot) => saves.push(snapshot),
  });
  sim.save();
  assert.equal(saves.length, 1);
  sim.clearPending = true;
  sim.save();
  sim.savePreWave();
  assert.equal(saves.length, 1, '清波未确认时不应写入新快照');
  sim.clearPending = false;
  sim.save();
  assert.equal(saves.length, 2);
});

test('旧遗物数据（完整定义）归一化为状态', () => {
  const states = normalizeRelicStates([
    RELIC_BY_ID.sharp,
    { id: 'eagle', level: 2 },
    { id: 'missing', level: 1 },
  ]);
  assert.deepEqual(states, [
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: 2 },
  ]);
});
