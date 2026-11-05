// 爬塔精英节点（P0-6）：词缀 seed 派生确定性、词缀/奖励数据契约、节点装饰与高稀有档位。
// 纯函数验收，不启动服务器；服务端权威（词缀 baked 进波次、奖励 ×1.5、elite 遗物）见 tower-server.test.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOWER_ELITE_AFFIXES,
  TOWER_ELITE_GOLD_MUL,
  rollTowerEliteAffixes,
  towerEliteModifier,
} from '../public/js/shared/data/tower-elite.js';
import { generateTowerGraph } from '../public/js/shared/tower.js';
import {
  MODE_RARITY_WEIGHTS,
  rarityWeightForMode,
  rollRelicOffers,
} from '../public/js/shared/data/relics.js';

const DISPLAY_KEYS = ['color', 'desc', 'id', 'name'];

test('精英词缀池：每条至少一项敌人强化，字段齐全', () => {
  assert.ok(TOWER_ELITE_AFFIXES.length >= 3);
  for (const affix of TOWER_ELITE_AFFIXES) {
    assert.ok(affix.id && affix.name && affix.desc && affix.color, `${affix.id} 字段缺失`);
    assert.ok(
      (affix.hpMul ?? 1) > 1 || (affix.speedMul ?? 1) > 1,
      `${affix.id} 未强化敌人`
    );
  }
});

test('精英词缀 seed 派生确定性：1~2 条、互异、稳定', () => {
  const key = '5:0';
  const a = rollTowerEliteAffixes('elite-seed', key);
  const b = rollTowerEliteAffixes('elite-seed', key);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 1 && a.length <= 2);
  const ids = a.map((affix) => affix.id);
  assert.equal(new Set(ids).size, ids.length, '词缀应互异');
  for (const affix of a) {
    assert.ok(TOWER_ELITE_AFFIXES.some((entry) => entry.id === affix.id), `${affix.id} 不在词缀池`);
  }
});

test('精英波次修饰符：词缀乘法合成、金币 ×1.5、展示条目不携带倍率', () => {
  const mod = towerEliteModifier('elite-mod-seed', '15:0');
  assert.equal(mod.goldMul, TOWER_ELITE_GOLD_MUL);
  assert.ok(mod.hpMul > 1 || mod.speedMul > 1, '词缀应使敌人更强');
  assert.ok(mod.affixes.length >= 1 && mod.affixes.length <= 2);
  // 展示条目只露 id/名称/描述/配色，不露具体倍率与奖励（「只露词缀，不露具体收益」）。
  for (const view of mod.affixes) {
    assert.deepEqual(Object.keys(view).sort(), DISPLAY_KEYS);
  }
  // 合成值等于词缀倍率连乘（round3 精度内，同 seed 复现同一组词缀）。
  const full = rollTowerEliteAffixes('elite-mod-seed', '15:0');
  const hp = full.reduce((acc, affix) => acc * (affix.hpMul ?? 1), 1);
  const speed = full.reduce((acc, affix) => acc * (affix.speedMul ?? 1), 1);
  assert.ok(Math.abs(mod.hpMul - Math.round(hp * 1000) / 1000) < 1e-9);
  assert.ok(Math.abs(mod.speedMul - Math.round(speed * 1000) / 1000) < 1e-9);
});

test('精英节点装饰：精英节点带词缀，非精英节点不带', () => {
  const graph = generateTowerGraph('elite-graph-seed');
  const eliteNodes = graph.nodes.filter((node) => node.type === 'elite');
  // 漏斗层 5/15/25 强制精英；其余非首领层可随机出精英（nodeTypeFor 加权池含 elite）。
  assert.ok(eliteNodes.length >= 3, '至少漏斗层 5/15/25 三个精英节点');
  for (const node of graph.nodes) {
    if (node.type === 'elite') {
      assert.ok(Array.isArray(node.affixes) && node.affixes.length >= 1, `第 ${node.layer} 层 elite 应有词缀`);
      assert.ok(node.affixes.length <= 2);
      for (const view of node.affixes) {
        assert.deepEqual(Object.keys(view).sort(), DISPLAY_KEYS);
      }
    } else {
      assert.equal(node.affixes, undefined, `${node.type} 节点不应带词缀`);
    }
  }
});

test('高稀有档位：elite 权重比 normal 更偏稀有/史诗', () => {
  const normal = MODE_RARITY_WEIGHTS.normal;
  const elite = MODE_RARITY_WEIGHTS.elite;
  assert.ok(elite, 'elite 档位缺失');
  assert.ok(elite.rare > normal.rare, '稀有权重应抬升');
  assert.ok(elite.epic > normal.epic, '史诗权重应抬升');
  assert.ok(elite.common < normal.common, '普通权重应降低');
  assert.equal(rarityWeightForMode('epic', 'elite'), elite.epic);
  assert.equal(rarityWeightForMode('rare', 'elite'), elite.rare);
});

test('精英抽取走 elite 档位且候选可复现', () => {
  const a = rollRelicOffers('elite-relic-seed', [], 3, 5, 'elite');
  const b = rollRelicOffers('elite-relic-seed', [], 3, 5, 'elite');
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
});
