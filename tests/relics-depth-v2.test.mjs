// 遗物扩容至 40 件：数量、id/描述、mods 键注册校验与旧 30 件兼容。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELICS,
  RELIC_BY_ID,
  RARITY,
  TOWERS,
  relicModsAtLevel,
} from '../public/js/shared/data.js';
import { EFFECT_REGISTRY } from '../public/js/shared/effects.js';

// V26-001 之前的全部 30 件遗物：id、稀有度与基础数值必须原样保留。
const BASELINE = {
  sharp: { rarity: 'common', mods: { dmg: { arrow: 0.25 } } },
  quickdraw: { rarity: 'common', mods: { fireRate: 0.12 } },
  eagle: { rarity: 'common', mods: { range: 1 } },
  bounty: { rarity: 'common', mods: { killGold: 2 } },
  thrifty: { rarity: 'common', mods: { costMul: -0.08 } },
  crystal: { rarity: 'common', mods: { baseHp: 5 } },
  velocity: { rarity: 'common', mods: { projSpeed: 0.5, dmgAll: 0.06 } },
  frostglint: { rarity: 'common', mods: { dmg: { frost: 0.18 } } },
  venomfang: { rarity: 'common', mods: { dmg: { poison: 0.18 } } },
  sparkplug: { rarity: 'common', mods: { dmg: { arc: 0.15 } } },
  steadyaim: { rarity: 'common', mods: { range: 0.6 } },
  coinpurse: { rarity: 'common', mods: { killGold: 1 } },
  sandbag: { rarity: 'common', mods: { baseHp: 3 } },
  powder: { rarity: 'rare', mods: { dmg: { cannon: 0.2 }, splash: 0.35 } },
  frostheart: { rarity: 'rare', mods: { slow: 0.15, slowDur: 0.3 } },
  static: { rarity: 'rare', mods: { dmg: { arc: 0.25 }, chain: 1 } },
  toxin: { rarity: 'rare', mods: { dot: 0.45 } },
  usury: { rarity: 'rare', mods: { interest: 0.05 } },
  pierce: { rarity: 'rare', mods: { armorPierce: 0.5 } },
  crit: { rarity: 'rare', mods: { crit: 0.2 } },
  bosslayer: { rarity: 'rare', mods: { bossDmg: 0.5 } },
  alchemy: { rarity: 'rare', mods: { dmg: { poison: 0.25 }, dot: 0.3 } },
  siege: { rarity: 'rare', mods: { dmg: { cannon: 0.3 }, range: 0.6 } },
  cartel: { rarity: 'rare', mods: { goldMul: 0.15, costMul: -0.05 } },
  warlord: { rarity: 'epic', mods: { dmgAll: 0.18 } },
  warhorn: { rarity: 'epic', mods: { fireRate: 0.25 } },
  frostbite: { rarity: 'epic', mods: { frostDmgBonus: 0.2 } },
  laststand: { rarity: 'epic', mods: { lowHpDmg: 0.35 } },
  greed: { rarity: 'epic', mods: { goldMul: 0.3 } },
  bastion: { rarity: 'epic', mods: { baseHp: 10 } },
};

const NEW_IDS = [
  'frostedge', 'venomvial', 'spareparts', 'scouthorn', 'bloodpact',
  'auroraveil', 'skyfall', 'gamblerscoin', 'eclipsehour', 'bloodtide',
];

const TOWER_IDS = new Set(Object.keys(TOWERS));
const RARITY_IDS = new Set(Object.keys(RARITY));
const CJK = /[一-鿿]/;

test('遗物池至少 40 件', () => {
  assert.ok(RELICS.length >= 40, `当前只有 ${RELICS.length} 件遗物`);
});

test('id 唯一，稀有度合法，名称与描述为中文且非空', () => {
  const ids = RELICS.map((relic) => relic.id);
  assert.equal(new Set(ids).size, ids.length, '遗物 id 必须唯一');
  for (const relic of RELICS) {
    assert.ok(RARITY_IDS.has(relic.rarity), `${relic.id} 的稀有度非法：${relic.rarity}`);
    assert.ok(CJK.test(relic.name || ''), `${relic.id} 缺少中文名称`);
    assert.ok(CJK.test(relic.desc || ''), `${relic.id} 缺少中文描述`);
    assert.ok(RELIC_BY_ID[relic.id] === relic, `${relic.id} 无法通过 RELIC_BY_ID 解析`);
  }
});

test('所有 mod 键都已在效果注册表中登记，dmg 子键是真实塔 id', () => {
  for (const relic of RELICS) {
    const mods = relic.mods || {};
    assert.ok(Object.keys(mods).length > 0, `${relic.id} 没有任何 mods`);
    for (const [key, value] of Object.entries(mods)) {
      assert.ok(EFFECT_REGISTRY[key], `${relic.id} 使用了未注册的 mod 键：${key}`);
      if (key === 'dmg') {
        const types = Object.keys(value);
        assert.ok(types.length > 0, `${relic.id} 的 dmg 为空`);
        for (const [type, amount] of Object.entries(value)) {
          assert.ok(TOWER_IDS.has(type), `${relic.id} 指向不存在的塔：${type}`);
          assert.ok(Number.isFinite(amount) && amount !== 0, `${relic.id}.dmg.${type} 数值非法`);
        }
      } else {
        assert.ok(Number.isFinite(value) && value !== 0, `${relic.id}.${key} 数值非法`);
      }
    }
  }
});

test('旧 30 件遗物 id 全部保留，稀有度与基础数值未改', () => {
  for (const [id, expected] of Object.entries(BASELINE)) {
    const relic = RELIC_BY_ID[id];
    assert.ok(relic, `旧遗物 ${id} 丢失`);
    assert.equal(relic.rarity, expected.rarity, `${id} 稀有度被改动`);
    assert.deepEqual(relic.mods, expected.mods, `${id} 基础数值被改动`);
  }
});

test('新增的 10 件遗物均已就位', () => {
  for (const id of NEW_IDS) {
    assert.ok(RELIC_BY_ID[id], `新增遗物 ${id} 丢失`);
  }
});

test('每件遗物的 Ⅰ 级数值未被单件上限静默截断', () => {
  for (const relic of RELICS) {
    assert.deepEqual(
      relicModsAtLevel(relic, 1),
      relic.mods,
      `${relic.id} 的 Ⅰ 级 mods 与声明不一致`,
    );
  }
});
