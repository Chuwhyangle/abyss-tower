// 爬塔模式 · 阶段 0 共享契约：节点图确定性、节点类型/后继、商人库存、选路归一化，
// 以及爬塔事件谓词（normal 模式调用序/RNG 不变）。
import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_WAVE } from '../public/js/shared/data.js';
import {
  MERCHANT_RELIC_BASE_PRICE,
  TOWER_BOSS_LAYERS,
  TOWER_FUNNEL_LAYERS,
  TOWER_LAYERS,
  TOWER_NODE_TYPES,
  generateTowerGraph,
  isBossLayer,
  isFunnelLayer,
  isRouteOnGraph,
  isStep,
  merchantInventory,
  merchantRarityPrice,
  merchantRefreshFee,
  nodeKey,
  nodeTypeFor,
  normalizeTowerRoute,
  parseNodeKey,
  successors,
  towerColumnCounts,
} from '../public/js/shared/tower.js';
import {
  EVENT_WAVES,
  isEventWave,
  normalizeEventHistory,
  rollEvent,
} from '../public/js/shared/events.js';

test('节点键解析与层规则', () => {
  assert.deepEqual(parseNodeKey('3:1'), { layer: 3, column: 1 });
  assert.equal(parseNodeKey('x:1'), null);
  assert.equal(parseNodeKey('3:1:2'), null);
  assert.equal(nodeKey(3, 1), '3:1');
  assert.equal(isFunnelLayer(5), true);
  assert.equal(isFunnelLayer(4), false);
  assert.equal(isBossLayer(10), true);
  assert.equal(isBossLayer(5), false);
  assert.deepEqual(TOWER_BOSS_LAYERS, [10, 20, 30]);
  assert.deepEqual(TOWER_FUNNEL_LAYERS, [5, 10, 15, 20, 25, 30]);
  assert.ok(TOWER_NODE_TYPES.includes('fight'));
  assert.ok(TOWER_NODE_TYPES.includes('merchant'));
});

test('节点图 seed 派生确定性：同 seed 同图，层/列/类型契约成立', () => {
  const seed = 'tower-determinism-seed';
  const a = generateTowerGraph(seed);
  const b = generateTowerGraph(seed);
  assert.deepEqual(a.nodes, b.nodes);
  assert.equal(a.layers, TOWER_LAYERS);
  assert.equal(a.nodes.length, b.nodes.length);

  const counts = towerColumnCounts(seed);
  assert.equal(counts.length, TOWER_LAYERS);
  for (let layer = 1; layer <= TOWER_LAYERS; layer++) {
    const columns = counts[layer - 1];
    const nodes = a.nodes.filter((node) => node.layer === layer);
    assert.equal(nodes.length, columns);
    // 漏斗层单列，其余 2~3 列；相邻层列数差 ≤1。
    assert.ok(columns >= 1 && columns <= 3, `第 ${layer} 层列数 ${columns}`);
    if (isFunnelLayer(layer)) assert.equal(columns, 1);
    if (layer > 1) assert.ok(Math.abs(columns - counts[layer - 2]) <= 1);
  }
  // 首领层只有 boss 节点；起始层必为战斗。
  for (const node of a.nodes) {
    if (isBossLayer(node.layer)) assert.equal(node.type, 'boss');
    if (node.layer === 1) assert.equal(node.type, 'fight');
    assert.ok(TOWER_NODE_TYPES.includes(node.type));
  }
  assert.equal(a.byKey.get('10:0').type, 'boss');
  assert.equal(a.byKey.get('20:0').type, 'boss');
  assert.equal(a.byKey.get('30:0').type, 'boss');
});

test('后继与步进：±1 扇出、列边界钳制、末层无后继', () => {
  const graph = generateTowerGraph('tower-successors-seed');
  for (const node of graph.nodes) {
    const next = successors(graph, node);
    if (node.layer === TOWER_LAYERS) {
      assert.deepEqual(next, []);
      continue;
    }
    assert.ok(next.length >= 1 && next.length <= 3);
    for (const target of next) {
      assert.equal(target.layer, node.layer + 1);
      assert.ok(Math.abs(target.column - node.column) <= 1);
      assert.equal(isStep(graph, node, target), true);
    }
  }
  // 列差 >1 或跳层都不是合法步进。
  assert.equal(isStep(graph, '1:0', '2:2'), false);
  assert.equal(isStep(graph, '1:0', '3:0'), false);
});

test('节点类型层规则优先：首领/漏斗精英/起始战斗', () => {
  assert.equal(nodeTypeFor('tower-type-seed', 10, 0), 'boss');
  assert.equal(nodeTypeFor('tower-type-seed', 20, 0), 'boss');
  assert.equal(nodeTypeFor('tower-type-seed', 30, 0), 'boss');
  assert.equal(nodeTypeFor('tower-type-seed', 5, 0), 'elite');
  assert.equal(nodeTypeFor('tower-type-seed', 15, 0), 'elite');
  assert.equal(nodeTypeFor('tower-type-seed', 25, 0), 'elite');
  assert.equal(nodeTypeFor('tower-type-seed', 1, 1), 'fight');
  // 同一 seed + 节点稳定，不同 seed 可能不同。
  assert.equal(
    nodeTypeFor('tower-type-seed', 2, 0),
    nodeTypeFor('tower-type-seed', 2, 0)
  );
});

test('商人库存 seed 派生确定性，价目与刷新费符合冻结口径', () => {
  const seed = 'tower-shop-seed';
  const a = merchantInventory(seed, nodeKey(4, 1));
  const b = merchantInventory(seed, nodeKey(4, 1));
  assert.deepEqual(a, b);
  assert.equal(a.key, '4:1');
  assert.equal(a.offers.length, 3);
  for (const offer of a.offers) {
    assert.equal(offer.kind, 'relic');
    assert.ok(offer.price >= 60, '红线 3：商人单件买入价 ≥60');
    assert.equal(offer.price, merchantRarityPrice(offer.rarity, 4));
  }
  // 基础价冻结：普通 80 / 稀有 160 / 史诗 300。
  assert.equal(MERCHANT_RELIC_BASE_PRICE.common, 80);
  assert.equal(MERCHANT_RELIC_BASE_PRICE.rare, 160);
  assert.equal(MERCHANT_RELIC_BASE_PRICE.epic, 300);
  assert.equal(merchantRefreshFee(4), 25 + 6 * 4);
  // 按层上浮，越深越贵。
  assert.ok(merchantRarityPrice('common', 30) > merchantRarityPrice('common', 1));
});

test('选路归一化：合法路径升序相邻，游标取末位，非法/空返回 null', () => {
  assert.deepEqual(normalizeTowerRoute({ path: ['1:0', '2:1', '3:1'] }), {
    path: ['1:0', '2:1', '3:1'],
    node: '3:1',
  });
  // 裸数组与 [layer, column] 均接受；显式游标须等于末位。
  assert.deepEqual(normalizeTowerRoute(['1:0', '2:0']), { path: ['1:0', '2:0'], node: '2:0' });
  assert.deepEqual(normalizeTowerRoute({ path: [[1, 0], [2, 1]], node: '2:1' }), {
    path: ['1:0', '2:1'],
    node: '2:1',
  });
  // 空 / 跳层 / 列差过大 / 显式游标不一致 / 超界层 一律 null。
  assert.equal(normalizeTowerRoute(null), null);
  assert.equal(normalizeTowerRoute({ path: [] }), null);
  assert.equal(normalizeTowerRoute({ path: ['1:0', '3:0'] }), null);
  assert.equal(normalizeTowerRoute({ path: ['1:0', '2:2'] }), null);
  assert.equal(normalizeTowerRoute({ path: ['1:0', '2:1'], node: '2:0' }), null);
  assert.equal(normalizeTowerRoute({ path: ['0:0'] }), null);
  assert.equal(normalizeTowerRoute({ path: ['31:0'] }), null);
});

test('选路贴合 seed 图校验：结构合法但列不存在则拒', () => {
  const seed = 'tower-route-on-graph-seed';
  const graph = generateTowerGraph(seed);
  const route = normalizeTowerRoute({ path: ['1:0', '2:1', '3:1'] });
  assert.equal(isRouteOnGraph(route, seed), true);

  // 找一个“2 列层且前一层有 1/2 列节点”的位置：尾节点取该层第 2 列（结构合法、图上不存在）。
  const counts = towerColumnCounts(seed);
  let offGraph = null;
  outer: for (let layer = 2; layer <= TOWER_LAYERS; layer++) {
    if (isFunnelLayer(layer) || counts[layer - 1] !== 2) continue;
    for (const prevCol of [1, 2]) {
      const prev = graph.byKey.get(nodeKey(layer - 1, prevCol));
      if (!prev) continue;
      const path = [prev.key, nodeKey(layer, 2)];
      if (normalizeTowerRoute({ path })) {
        offGraph = path;
        break outer;
      }
    }
  }
  assert.ok(offGraph, '应能找到结构合法但脱离图的列');
  assert.equal(isRouteOnGraph({ path: offGraph, node: offGraph[offGraph.length - 1] }, seed), false);
});

test('爬塔事件谓词：任意节点层可解析，normal 模式 RNG/调用序不变', () => {
  // normal 模式仍只认固定事件波。
  for (const wave of EVENT_WAVES) assert.equal(isEventWave(wave), true);
  for (const wave of [0, 1, 4, 6, 9, 30]) assert.equal(isEventWave(wave), false);
  // 爬塔模式：任意 1..MAX_WAVE 层都可解析事件。
  for (const wave of [1, 3, 7, 12, 30]) assert.equal(isEventWave(wave, 'tower'), true);
  assert.equal(isEventWave(0, 'tower'), false);
  assert.equal(isEventWave(MAX_WAVE + 1, 'tower'), false);
  // 爬塔事件归一化不再吞记录。
  const history = normalizeEventHistory(
    [
      { wave: 3, eventId: 'altar', optionId: 'leave' },
      { wave: 7, eventId: 'gamble', optionId: 'small' },
      { wave: 6, eventId: 'altar', optionId: 'leave' },
    ],
    'tower'
  );
  assert.deepEqual(history, [
    { wave: 3, eventId: 'altar', optionId: 'leave' },
    { wave: 6, eventId: 'altar', optionId: 'leave' },
    { wave: 7, eventId: 'gamble', optionId: 'small' },
  ]);
  // 爬塔事件掷骰稳定；normal 模式 rollEvent 对非事件波仍返回 null。
  const towerRoll = rollEvent('tower-event-seed', 3, 'tower');
  assert.ok(towerRoll, '爬塔任意层可掷事件');
  assert.equal(rollEvent('tower-event-seed', 3), null);
});
