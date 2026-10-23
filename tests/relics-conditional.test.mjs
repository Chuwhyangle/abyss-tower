// V41-004：遗物扩到 60 件，新增低血 / 满金币 / 空塔位三系条件型遗物。
// 覆盖数量与旧 id 兼容、条件判定纯函数、条件边界（不满足时无效果）、套装与文案。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { RELICS, RELIC_BY_ID, relicEffectText } from '../public/js/shared/data.js';
import {
  CONDITION_THRESHOLDS,
  EFFECT_REGISTRY,
  RELIC_SET_BONUSES,
  conditionSnapshot,
  countEmptyBuildableSlots,
  hasEmptySlots,
  isLowHpState,
  isRichState,
  relicSetBonusText,
  relicSetTierBonuses,
} from '../public/js/shared/effects.js';

const SEED = 'relics-conditional-seed';

// 扩容前的 50 件遗物：id 必须原样保留。
const OLD_IDS = [
  'sharp', 'quickdraw', 'eagle', 'bounty', 'thrifty', 'crystal', 'velocity',
  'frostglint', 'venomfang', 'sparkplug', 'steadyaim', 'coinpurse', 'sandbag',
  'frostedge', 'venomvial', 'spareparts', 'scouthorn', 'bloodpact', 'bloodstake',
  'highroller', 'moonwell', 'embertrace', 'powder', 'frostheart', 'static', 'toxin',
  'usury', 'pierce', 'crit', 'bosslayer', 'alchemy', 'siege', 'cartel', 'auroraveil',
  'skyfall', 'gamblerscoin', 'adrenaline', 'martyr', 'cometcore', 'warlord',
  'warhorn', 'frostbite', 'laststand', 'greed', 'bastion', 'eclipsehour',
  'bloodtide', 'doomclock', 'stasislens', 'starforge',
];

const NEW_IDS = [
  'desperado', 'goldencoffer', 'openfield', 'warchest', 'lastbreath',
  'bloodybanner', 'lightsentry', 'bloodmoney', 'midasthrone', 'palaceguard',
];

const TRIGGER_TEXT = /(低于 40%|金币 ≥ 400|空位 ≥ 8)/;

function makeSim(relics = [], opts = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100,
    baseHp: 20,
    maxBaseHp: 20,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'sniper', 'banner'],
    onToast: () => {},
    onSave: () => {},
    ...opts,
  });
}

function buildableCells(map) {
  const cells = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) if (map.buildable[r][c]) cells.push({ c, r });
  }
  return cells;
}

function hit(sim, base = 100) {
  return sim.computeHit(base, 'arrow', { boss: false, armor: 0 }, { noCrit: true }).dmg;
}

test('遗物至少 60 件，旧 50 件 id 全部保留', () => {
  assert.ok(RELICS.length >= 60, `当前只有 ${RELICS.length} 件遗物`);
  assert.equal(new Set(RELICS.map((relic) => relic.id)).size, RELICS.length, '遗物 id 必须唯一');
  for (const id of OLD_IDS) {
    assert.ok(RELIC_BY_ID[id], `旧遗物 ${id} 丢失`);
  }
});

test('新增 10 件条件型遗物均已注册，mod 键合法', () => {
  for (const id of NEW_IDS) {
    const relic = RELIC_BY_ID[id];
    assert.ok(relic, `新增遗物 ${id} 丢失`);
    assert.ok(TRIGGER_TEXT.test(relic.desc), `${id} 的描述未写出触发条件`);
    for (const key of Object.keys(relic.mods)) {
      assert.ok(EFFECT_REGISTRY[key], `${id} 使用了未注册的 mod 键 ${key}`);
    }
  }
});

test('条件判定是纯函数：阈值边界确定', () => {
  assert.equal(CONDITION_THRESHOLDS.lowHpRatio, 0.4);
  assert.equal(CONDITION_THRESHOLDS.richGold, 400);
  assert.equal(CONDITION_THRESHOLDS.emptySlots, 8);

  assert.equal(isLowHpState({ hpRatio: 0.39 }), true);
  assert.equal(isLowHpState({ hpRatio: 0.4 }), false);
  assert.equal(isLowHpState({ hpRatio: 1 }), false);

  assert.equal(isRichState({ gold: 399 }), false);
  assert.equal(isRichState({ gold: 400 }), true);
  assert.equal(isRichState({ gold: 400.5 }), true);

  assert.equal(hasEmptySlots({ emptySlots: 7 }), false);
  assert.equal(hasEmptySlots({ emptySlots: 8 }), true);
});

test('状态快照只读：生命比例、金币与可建造空位', () => {
  const fake = {
    baseHp: 15,
    maxBaseHp: 60,
    gold: 420,
    map: { buildable: [[true, false], [true, true]] },
    towers: [{}, {}],
  };
  assert.equal(countEmptyBuildableSlots(fake), 1);
  assert.deepEqual(conditionSnapshot(fake), { hpRatio: 0.25, gold: 420, emptySlots: 1 });
  assert.equal(Object.isFrozen(conditionSnapshot(fake)), true);

  // 快照不修改源状态。
  assert.equal(fake.baseHp, 15);
  assert.equal(fake.towers.length, 2);

  const missingMap = { baseHp: 20, maxBaseHp: 20, gold: 0 };
  assert.equal(countEmptyBuildableSlots(missingMap), 0);
  assert.deepEqual(conditionSnapshot(missingMap), { hpRatio: 1, gold: 0, emptySlots: 0 });
});

test('低血条件：生命 ≥ 40% 时无效果，低于 40% 时按数值增伤', () => {
  const sim = makeSim([{ id: 'lastbreath', level: 1 }], { maxBaseHp: 100, baseHp: 100 });
  assert.equal(hit(sim), 100, '满血不应有增伤');

  sim.baseHp = 40;
  assert.equal(hit(sim), 100, '恰好 40% 不触发（严格低于）');

  sim.baseHp = 39.9;
  assert.ok(Math.abs(hit(sim) - 116) < 1e-9, '低于 40% 应获得 +16%');
});

test('满金币条件：399 金币无效果，400 金币生效', () => {
  const sim = makeSim([{ id: 'goldencoffer', level: 1 }], { gold: 399 });
  assert.equal(hit(sim), 100, '不足 400 金币不应有增伤');

  sim.gold = 400;
  assert.ok(Math.abs(hit(sim) - 107) < 1e-9, '达到 400 金币应获得 +7%');

  sim.gold = 399.99;
  assert.equal(hit(sim), 100, '不满足阈值时立即恢复无效果');
});

test('空塔位条件：7 个空位无效果，8 个空位生效', () => {
  const sim = makeSim([{ id: 'lightsentry', level: 1 }], { gold: 0 });
  const total = buildableCells(sim.map).length;
  assert.ok(total > 8, `地图可建造格不足：${total}`);

  sim.towers = new Array(total - 7);
  assert.equal(conditionSnapshot(sim).emptySlots, 7);
  assert.equal(hit(sim), 100, '只剩 7 个空位不应有增伤');

  sim.towers = new Array(total - 8);
  assert.equal(conditionSnapshot(sim).emptySlots, 8);
  assert.ok(Math.abs(hit(sim) - 114) < 1e-9, '剩 8 个空位应获得 +14%');
});

test('组合条件遗物：两个条件各自独立生效', () => {
  const sim = makeSim([{ id: 'bloodmoney', level: 1 }], { gold: 100, maxBaseHp: 100, baseHp: 100 });
  assert.equal(hit(sim), 100, '两个条件都不满足时无效果');

  sim.baseHp = 20;
  assert.ok(Math.abs(hit(sim) - 110) < 1e-9, '仅低血时 +10%');

  sim.baseHp = 100;
  sim.gold = 400;
  assert.ok(Math.abs(hit(sim) - 110) < 1e-9, '仅满金币时 +10%');

  sim.baseHp = 20;
  assert.ok(Math.abs(hit(sim) - 121) < 1e-9, '两个条件同时满足时 +21%');
});

test('新套装蓄势同盟：2/4 件档位引用条件键并写出触发条件', () => {
  assert.ok(RELIC_SET_BONUSES.reserve, '套装 reserve 未注册');
  assert.deepEqual(relicSetTierBonuses('reserve', 1), []);
  assert.deepEqual(relicSetTierBonuses('reserve', 2).map((tier) => tier.pieces), [2]);
  assert.deepEqual(relicSetTierBonuses('reserve', 4).map((tier) => tier.pieces), [2, 4]);

  const text = relicSetBonusText('reserve', 4);
  assert.match(text, /金币 ≥ 400/);
  assert.match(text, /空置塔位 ≥ 8/);
});

test('效果文案由注册表生成并明确写出触发条件', () => {
  assert.match(relicEffectText('goldencoffer', 1), /金币 ≥ 400 时伤害 \+7%/);
  assert.match(relicEffectText('openfield', 1), /空置塔位 ≥ 8 时伤害 \+8%/);
  assert.equal(EFFECT_REGISTRY.richDmg.text(0.1), '金币 ≥ 400 时伤害 +10%');
  assert.equal(EFFECT_REGISTRY.emptySlotDmg.text(0.1), '空置塔位 ≥ 8 时伤害 +10%');
});

test('新遗物不改变既有遗物数值', () => {
  assert.deepEqual(RELIC_BY_ID.sharp.mods, { dmg: { arrow: 0.25 } });
  assert.deepEqual(RELIC_BY_ID.laststand.mods, { lowHpDmg: 0.35 });
  assert.deepEqual(RELIC_BY_ID.greed.mods, { goldMul: 0.3 });
  assert.deepEqual(RELIC_BY_ID.starforge.mods, { dmgAll: 0.08, dot: 0.12, slow: 0.03 });
});
