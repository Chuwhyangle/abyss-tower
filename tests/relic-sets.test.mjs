// 遗物套装：定义完整性、2/4 件阈值、不重复计件与固定种子可复现。
// 全遗物配置的结算哈希（tests/effects-registry.test.mjs）不需要更新：相关修正
// 已触顶全局上限，套装加成不会改变最终 mods；本文件只验证同配置逐字复现。
// tests/data-split.test.mjs 的内容快照因 RELICS 新增 set 字段而更新。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { GLOBAL_MOD_CAPS, RELICS, relicModsAtLevel } from '../public/js/shared/data.js';
import {
  EFFECT_REGISTRY,
  RELIC_SET_BONUSES,
  relicSetBonusText,
  relicSetTierBonuses,
} from '../public/js/shared/effects.js';

const SEED = 'relic-sets-seed';

function makeSim(relics = [], opts = {}) {
  const map = opts.map || generateMap(SEED);
  return new Simulation({
    map,
    seed: SEED,
    difficulty: 'standard',
    gold: 5000,
    baseHp: 40,
    maxBaseHp: 40,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'sniper', 'banner'],
    onToast: () => {},
    onSave: () => {},
    ...opts,
  });
}

function buildableTiles(map, count) {
  const tiles = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) if (map.buildable[r][c]) tiles.push({ c, r });
    if (tiles.length >= count) break;
  }
  return tiles.slice(0, count);
}

test('3 套套装，每套 4–6 件，所有 set 标签都已注册', () => {
  const setIds = Object.keys(RELIC_SET_BONUSES);
  assert.ok(setIds.length >= 3, '至少需要 3 套套装');
  for (const [setId, set] of Object.entries(RELIC_SET_BONUSES)) {
    assert.ok(set.name && set.name.length > 0, `${setId} 缺少名称`);
    const pieces = RELICS.filter((relic) => relic.set === setId);
    assert.ok(pieces.length >= 4 && pieces.length <= 6, `${setId} 有 ${pieces.length} 件，应在 4–6 之间`);
    assert.deepEqual(set.tiers.map((tier) => tier.pieces), [2, 4], `${setId} 缺少 2/4 件阈值`);
  }
  for (const relic of RELICS) {
    if (!relic.set) continue;
    assert.ok(RELIC_SET_BONUSES[relic.set], `遗物 ${relic.id} 引用了未注册的套装 ${relic.set}`);
  }
});

test('套装加成的每个 mod 键都已注册，并沿用其文案与上限', () => {
  for (const [setId, set] of Object.entries(RELIC_SET_BONUSES)) {
    for (const tier of set.tiers) {
      assert.ok(Object.keys(tier.mods).length > 0, `${setId} 档位为空`);
      for (const [key, value] of Object.entries(tier.mods)) {
        const entry = EFFECT_REGISTRY[key];
        assert.ok(entry, `${setId} 使用了未注册的 mod 键 ${key}`);
        assert.equal(typeof entry.cap, 'number');
        assert.equal(typeof entry.globalCap, 'number');
        assert.equal(typeof entry.text, 'function');
        assert.ok(
          entry.capMode === 'max' ? value >= entry.cap : value <= entry.cap,
          `${setId}.${key} 的档位数值 ${value} 超出单件上限 ${entry.cap}`
        );
        assert.ok(
          entry.capMode === 'max' ? value >= entry.globalCap : value <= entry.globalCap,
          `${setId}.${key} 的档位数值 ${value} 超出全局上限 ${entry.globalCap}`
        );
      }
    }
  }
});

test('阈值：1 件不触发，2–3 件一档，4 件及以上两档', () => {
  assert.deepEqual(relicSetTierBonuses('hunter', 0), []);
  assert.deepEqual(relicSetTierBonuses('hunter', 1), []);
  assert.deepEqual(relicSetTierBonuses('hunter', 2).map((tier) => tier.pieces), [2]);
  assert.deepEqual(relicSetTierBonuses('hunter', 3).map((tier) => tier.pieces), [2]);
  assert.deepEqual(relicSetTierBonuses('hunter', 4).map((tier) => tier.pieces), [2, 4]);
  assert.deepEqual(relicSetTierBonuses('hunter', 6).map((tier) => tier.pieces), [2, 4]);
});

test('未注册的套装明确报错', () => {
  assert.throws(() => relicSetTierBonuses('ghost-set', 4), /未注册的遗物套装: ghost-set/);
  assert.throws(() => relicSetBonusText('ghost-set', 4), /未注册的遗物套装: ghost-set/);
});

test('套装文案由效果注册表生成，未达阈值时为空', () => {
  assert.equal(relicSetBonusText('hunter', 1), '');
  assert.equal(relicSetBonusText('hunter', 2), '猎手同盟 2 件：攻击速度 +6%');
  assert.equal(
    relicSetBonusText('hunter', 4),
    '猎手同盟 2 件：攻击速度 +6%；猎手同盟 4 件：暴击率 +8%'
  );
  assert.equal(relicSetBonusText('frost', 2), '霜寒契约 2 件：减速强度 +5%');
  assert.equal(relicSetBonusText('guild', 4), '商道同盟 2 件：击杀金币 +1；商道同盟 4 件：金币收入 +10%');
});

test('sim：2 件触发第一档，4 件叠加第二档', () => {
  const two = makeSim([
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: 1 },
  ]);
  assert.equal(two.mods.fireRate, 0.06);
  assert.equal(two.mods.crit, 0);

  const four = makeSim([
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: 1 },
    { id: 'crit', level: 1 },
    { id: 'bounty', level: 1 },
  ]);
  assert.equal(four.mods.fireRate, 0.06, '第一档仍然生效');
  assert.equal(four.mods.crit, 0.2 + 0.08, '单件暴击 + 第二档套装暴击');
});

test('单件遗物数值与未成套时行为不变', () => {
  const solo = makeSim([{ id: 'sharp', level: 1 }]);
  assert.equal(solo.mods.dmg.arrow, 0.25);
  assert.equal(solo.mods.fireRate, 0);
  assert.equal(relicModsAtLevel('sharp', 1).dmg.arrow, 0.25);

  const nonSet = makeSim([{ id: 'powder', level: 1 }]);
  assert.equal(nonSet.mods.dmg.cannon, 0.2);
  assert.equal(nonSet.mods.fireRate, 0);
  assert.equal(nonSet.mods.crit, 0);
});

test('无重复计入：等级提升与重复状态都不增加套装件数', () => {
  const upgraded = makeSim([
    { id: 'sharp', level: 3 },
    { id: 'eagle', level: 3 },
  ]);
  assert.equal(upgraded.mods.fireRate, 0.06, '两件满级仍只算 2 件');

  const duplicated = makeSim([
    { id: 'sharp', level: 1 },
    { id: 'sharp', level: 3 },
    { id: 'eagle', level: 1 },
  ]);
  assert.equal(duplicated.relics.length, 2, '同一遗物只保留一个状态');
  assert.equal(duplicated.mods.fireRate, 0.06, '重复状态不重复计件');
  assert.equal(duplicated.mods.dmg.arrow, 0.55, '等级取最高值而不是叠加');
});

test('全遗物时套装加成仍受全局上限约束', () => {
  const sim = makeSim(RELICS.map((relic) => ({ id: relic.id, level: 3 })));
  assert.ok(sim.mods.fireRate <= GLOBAL_MOD_CAPS.fireRate + 1e-9);
  assert.ok(sim.mods.crit <= GLOBAL_MOD_CAPS.crit + 1e-9);
  assert.ok(sim.mods.slow <= GLOBAL_MOD_CAPS.slow + 1e-9);
  assert.ok(sim.mods.goldMul <= GLOBAL_MOD_CAPS.goldMul + 1e-9);
});

test('固定种子下套装效果可复现，且不改变 RNG 调用顺序', () => {
  const relics = [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 1 },
    { id: 'crit', level: 1 },
    { id: 'bounty', level: 1 },
    { id: 'frostglint', level: 1 },
    { id: 'frostedge', level: 1 },
  ];

  const run = () => {
    const map = generateMap(SEED);
    const tiles = buildableTiles(map, 2);
    const sim = makeSim(relics, {
      map,
      towers: [
        { ...tiles[0], type: 'arrow', level: 2 },
        { ...tiles[1], type: 'frost', level: 2 },
      ],
    });
    const parts = [];
    for (let wave = 1; wave <= 2; wave++) {
      sim.beginWave(generateWave(SEED, wave, 'standard', map.meta || {}));
      let steps = 0;
      while (sim.phase === 'wave' && steps < 60 * 120) {
        sim.update(1 / 60);
        steps++;
      }
      parts.push({
        wave,
        steps,
        gold: round(sim.gold),
        baseHp: round(sim.baseHp),
        kills: sim.kills,
        phase: sim.phase,
        mods: sim.mods,
        towers: sim.towers.map((tower) => ({ type: tower.type, level: tower.level, stats: tower.stats })),
      });
    }
    return createHash('sha256').update(JSON.stringify(canonicalize(parts))).digest('hex');
  };

  const first = run();
  const second = run();
  assert.equal(first, second, '同种子同配置必须逐字复现');

  const twoPieces = makeSim([{ id: 'sharp', level: 1 }, { id: 'eagle', level: 1 }]);
  assert.equal(twoPieces.mods.fireRate, 0.06);
});

function round(value) {
  return typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}
