// 首领核心（§4）：确定性候选生成与即时效果结算的纯函数验收（gap-ac-057）。
// 断言口径与 docs/PHASE_ROGUE2.md §4.2 / §4.3 的冻结约束逐条对齐。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_WAVES,
  CORE_KINDS,
  DOCTRINE_IDS,
  BOSS_CORES,
  SUPPLY_OPTIONS,
  isBossCoreWave,
  bossCoreSeed,
  bossCoreSearchSeed,
  rollBossCoreOffers,
  rollCoreOffers,
  applyBossCore,
  applyCore,
} from '../public/js/shared/boss-core.js';
import { RELIC_BY_ID, RELIC_MAX_LEVEL } from '../public/js/shared/data/relics.js';

const SEEDS = ['s1', 's2', 's3', 'run-abc', 'seed-42'];
const NON_NEUTRAL = new Set(['fire', 'frost', 'venom', 'storm', 'warden']);

function kindsOf(offers) {
  return offers.map((offer) => offer.kind);
}

test('常量与冻结表一致', () => {
  assert.deepEqual(CORE_WAVES, [5, 10, 15, 20, 25]);
  assert.deepEqual(CORE_KINDS, ['upgrade', 'search', 'awakening', 'doctrine', 'supply']);
  assert.deepEqual(DOCTRINE_IDS, ['arc', 'bolt', 'cannon', 'frost', 'poison']);
  assert.equal(BOSS_CORES.doctrine.maxPerRun, 2);
  assert.equal(BOSS_CORES.awakening.minWave, 10);
  assert.equal(BOSS_CORES.doctrine.minWave, 10);
  assert.equal(BOSS_CORES.supply.waveOnly, 5);
  assert.deepEqual(
    SUPPLY_OPTIONS.map((option) => option.type),
    ['maxHp', 'gold', 'reroll']
  );
  for (const wave of CORE_WAVES) assert.equal(isBossCoreWave(wave), true);
  assert.equal(isBossCoreWave(4), false);
  assert.equal(isBossCoreWave(6), false);
  assert.equal(isBossCoreWave(30), false);
});

test('种子流独立且不触碰战斗 RNG（§9）', () => {
  assert.equal(bossCoreSeed('run-x', 5), 'run-x:core:5');
  assert.equal(bossCoreSearchSeed('run-x', 5), 'run-x:core:5:search');
});

test('同一输入完全可复现（约束 6）', () => {
  const states = [{ id: 'sharp', level: 2 }];
  for (const seed of SEEDS) {
    const a = rollBossCoreOffers(seed, 10, states, { doctrineTaken: 0 });
    const b = rollBossCoreOffers(seed, 10, states, { doctrineTaken: 0 });
    assert.deepEqual(a, b);
  }
});

test('恰好 3 个选项、kind 互不重复、每次都含 upgrade（约束 1/2）', () => {
  const states = [{ id: 'sharp', level: 1 }, { id: 'frostglint', level: 2 }];
  for (const seed of SEEDS) {
    for (const wave of CORE_WAVES) {
      const offers = rollBossCoreOffers(seed, wave, states);
      assert.equal(offers.length, 3, `波 ${wave} 应恰好 3 选 1`);
      assert.equal(new Set(kindsOf(offers)).size, 3, `波 ${wave} kind 互不重复`);
      assert.ok(kindsOf(offers).includes('upgrade'), `波 ${wave} 必须含 upgrade`);
    }
  }
});

test('wave < 10 不出现觉醒/教义（约束 3）', () => {
  const states = [{ id: 'sharp', level: RELIC_MAX_LEVEL }];
  for (const seed of SEEDS) {
    for (const wave of [5]) {
      const kinds = kindsOf(rollBossCoreOffers(seed, wave, states));
      assert.ok(!kinds.includes('awakening'), `波 ${wave} 不得出现 awakening`);
      assert.ok(!kinds.includes('doctrine'), `波 ${wave} 不得出现 doctrine`);
    }
  }
});

test('supply 只在第 5 波出现（约束 4）', () => {
  const states = [{ id: 'sharp', level: 1 }];
  for (const seed of SEEDS) {
    for (const wave of [10, 15, 20, 25]) {
      const kinds = kindsOf(rollBossCoreOffers(seed, wave, states));
      assert.ok(!kinds.includes('supply'), `波 ${wave} 不得出现 supply`);
    }
    // 第 5 波允许出现 supply（多次种子覆盖下至少出现一次）。
    const five = SEEDS.map((s) => kindsOf(rollBossCoreOffers(s, 5, states)).includes('supply'));
    assert.ok(five.some(Boolean), '波 5 的候选应能出现 supply');
  }
});

test('wave >= 10 觉醒/教义能进入候选（约束 5）', () => {
  const withTier3 = [{ id: 'sharp', level: RELIC_MAX_LEVEL }];
  const across = new Set();
  for (const seed of [...SEEDS, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    for (const wave of [10, 15, 20, 25]) {
      for (const kind of kindsOf(rollBossCoreOffers(seed, wave, withTier3))) across.add(kind);
    }
  }
  assert.ok(across.has('awakening'), '跨种子至少出现一次 awakening');
  assert.ok(across.has('doctrine'), '跨种子至少出现一次 doctrine');
});

test('教义候选给出 3 条未选教义（§4.2）', () => {
  const states = [{ id: 'sharp', level: RELIC_MAX_LEVEL }];
  for (const seed of SEEDS) {
    for (const wave of [10, 15, 20, 25]) {
      const doctrine = rollBossCoreOffers(seed, wave, states, { doctrineTaken: 0 }).find(
        (offer) => offer.kind === 'doctrine'
      );
      if (!doctrine) continue;
      assert.equal(doctrine.options.length, 3, '教义候选应恰好 3 条');
      assert.equal(new Set(doctrine.options.map((o) => o.doctrineId)).size, 3, '3 条教义互不重复');
      for (const option of doctrine.options) {
        assert.ok(DOCTRINE_IDS.includes(option.doctrineId), '教义 id 必须来自五条教义清单');
      }
    }
  }
});

test('搜寻候选来自非中立派系、三选一、15 波前无史诗（§4.2）', () => {
  const states = [{ id: 'sharp', level: 1 }];
  for (const seed of SEEDS) {
    for (const wave of [5, 10, 15]) {
      const search = rollBossCoreOffers(seed, wave, states).find((offer) => offer.kind === 'search');
      if (!search) continue;
      assert.ok(NON_NEUTRAL.has(search.faction), '搜寻派系必须是非中立派系');
      assert.equal(search.options.length, 3, '搜寻候选应恰好 3 件');
      for (const option of search.options) {
        const relic = RELIC_BY_ID[option.id];
        assert.ok(relic, '搜寻候选必须是真实遗物');
        assert.equal(relic.faction, search.faction, '搜寻候选必须与所选派系一致');
        if (wave < 15) assert.notEqual(relic.rarity, 'epic', '15 波前不得出现史诗');
      }
    }
  }
});

test('升阶候选只列未满级遗物（§4.2）', () => {
  const states = [
    { id: 'sharp', level: 1 },
    { id: 'frostglint', level: RELIC_MAX_LEVEL },
  ];
  const upgrade = rollBossCoreOffers('s1', 5, states).find((offer) => offer.kind === 'upgrade');
  assert.ok(upgrade.options.every((option) => option.toLevel === option.fromLevel + 1));
  const ids = upgrade.options.map((option) => option.id);
  assert.ok(ids.includes('sharp'), '未满级遗物应出现在升阶候选');
  assert.ok(!ids.includes('frostglint'), '满级遗物不得出现在升阶候选');
});

test('applyBossCore：升阶使遗物 +1 级（§4.3）', () => {
  const before = [{ id: 'sharp', level: 1 }];
  const upgrade = rollBossCoreOffers('s1', 5, before).find((offer) => offer.kind === 'upgrade');
  const option = upgrade.options.find((item) => item.id === 'sharp');
  const delta = applyBossCore({ kind: 'upgrade', option }, before);
  const sharp = delta.relics.find((state) => state.id === 'sharp');
  assert.equal(sharp.level, 2);
  assert.equal(delta.gold, 0);
  assert.equal(delta.baseHp, 0);
  assert.deepEqual(delta.coreTaken, [{ kind: 'upgrade', choice: { relicId: 'sharp' } }]);
});

test('applyBossCore：搜寻获得一件遗物（§4.3）', () => {
  const before = [{ id: 'sharp', level: 1 }];
  const search = rollBossCoreOffers('s1', 15, before).find((offer) => offer.kind === 'search');
  if (!search || !search.options.length) return;
  const option = search.options[0];
  const delta = applyBossCore({ kind: 'search', option }, before);
  const gained = delta.relics.find((state) => state.id === option.id);
  assert.ok(gained, '搜寻应获得所选遗物');
  assert.equal(gained.level, option.toLevel);
});

test('applyBossCore：补给三类资源即时生效（§4.3）', () => {
  const before = [{ id: 'sharp', level: 1 }];
  const gold = applyBossCore({ kind: 'supply', option: { type: 'gold', amount: 80 } }, before);
  assert.equal(gold.gold, 80);
  assert.equal(gold.relics.length, 1);

  const hp = applyBossCore({ kind: 'supply', option: { type: 'maxHp', amount: 2 } }, before);
  assert.equal(hp.maxBaseHp, 2);
  assert.equal(hp.baseHp, 2);

  const reroll = applyBossCore({ kind: 'supply', option: { type: 'reroll', amount: 1 } }, before);
  assert.equal(reroll.rerolls, 1);
});

test('applyBossCore：教义/觉醒只记录不可逆引用（§4.3）', () => {
  const before = [{ id: 'sharp', level: RELIC_MAX_LEVEL }];
  const doctrine = applyBossCore({ kind: 'doctrine', option: { doctrineId: 'arc' } }, before);
  assert.deepEqual(doctrine.doctrines, ['arc']);
  assert.deepEqual(doctrine.awakenings, []);
  assert.equal(doctrine.gold, 0);

  const awakening = applyBossCore(
    { kind: 'awakening', option: { relicId: 'sharp', awakeningId: null } },
    before
  );
  assert.deepEqual(awakening.awakenings, [{ relicId: 'sharp', awakeningId: null }]);
  assert.deepEqual(awakening.doctrines, []);
});

test('applyBossCore：无选项时返回空增量且不抛错', () => {
  const delta = applyBossCore(null, []);
  assert.equal(delta.gold, 0);
  assert.deepEqual(delta.relics, []);
  assert.deepEqual(delta.coreTaken, []);
});

test('与冻结表 §8.1 的导出名对齐（rollCoreOffers / applyCore）', () => {
  assert.equal(rollCoreOffers, rollBossCoreOffers);
  assert.equal(applyCore, applyBossCore);
});

test('升阶无可用遗物时走补给兜底（§4.3）', () => {
  const delta = applyBossCore({ kind: 'upgrade', option: null }, []);
  assert.equal(delta.gold, 60);
  assert.equal(delta.baseHp, 2);
  assert.deepEqual(delta.coreTaken, [{ kind: 'upgrade', choice: { fallback: 'supply' } }]);
});
