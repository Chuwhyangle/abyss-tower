// 爬塔模式 · 阶段 0 共享契约（docs/PHASE_TOWER.md §3/§4）：节点图、节点类型、后继、
// 商人库存与选路状态契约。全纯函数、seed 派生、确定性；随机流一律走 `${seed}:tower:*`
// 命名空间，不触碰 sim.js / events.js 既有 RNG 调用顺序（§6.2 红线 4）。
import { RNG } from './rng.js';
import { RELICS, rarityWeightForMode } from './data/relics.js';
import { towerEliteModifier } from './data/tower-elite.js';

// 30 层 DAG（覆盖既有 1..30 波难度阶梯）。
export const TOWER_LAYERS = 30;
// 首领漏斗层：单列汇合（§3 冻结）。
export const TOWER_FUNNEL_LAYERS = Object.freeze([5, 10, 15, 20, 25, 30]);
// 首领节点层：3 次首领（§6.3 把 CORE_WAVES 从 5 次重排为 10/20/30）。
export const TOWER_BOSS_LAYERS = Object.freeze([10, 20, 30]);
// 节点类型（§3 冻结）。
export const TOWER_NODE_TYPES = Object.freeze([
  'fight',
  'event',
  'merchant',
  'elite',
  'boss',
  'treasure',
]);
// 非固定层的节点类型权重：起始层 / 漏斗层 / 首领层由层规则决定，不参与加权。
export const TOWER_TYPE_WEIGHTS = Object.freeze({
  fight: 40,
  event: 20,
  merchant: 14,
  elite: 14,
  treasure: 12,
});

// 商人价目（§4.3 冻结）：普通 80 / 稀有 160 / 史诗 300，按层上浮；红线 3 单件 ≥60。
export const MERCHANT_RELIC_BASE_PRICE = Object.freeze({ common: 80, rare: 160, epic: 300 });
// 每层上浮 10%（§2.2 平衡终值可重调，阶段 0 只定符号与下限）。
export const MERCHANT_PRICE_GROWTH_PER_LAYER = 0.1;
// 商人货架遗物数量。
export const MERCHANT_OFFER_COUNT = 3;

export function nodeKey(layer, column) {
  return `${layer}:${column}`;
}

const NODE_KEY_RE = /^(\d+):(\d+)$/;

// 节点键 "<layer>:<column>" → { layer, column }；非法返回 null。
export function parseNodeKey(key) {
  const match = NODE_KEY_RE.exec(String(key ?? ''));
  if (!match) return null;
  const layer = Number(match[1]);
  const column = Number(match[2]);
  if (!Number.isInteger(layer) || !Number.isInteger(column)) return null;
  return { layer, column };
}

export function isFunnelLayer(layer) {
  return TOWER_FUNNEL_LAYERS.includes(Number(layer));
}

export function isBossLayer(layer) {
  return TOWER_BOSS_LAYERS.includes(Number(layer));
}

// 每层列数（确定性）：漏斗层 1 列，其余 2~3 列且相邻层列数差 ≤1（±1 扇出）。
// 独立随机流 `${seed}:tower:graph`，与节点类型、商人库存互不干扰。
export function towerColumnCounts(seed) {
  const rng = new RNG(`${seed}:tower:graph`);
  const counts = [];
  let prev = 2;
  for (let layer = 1; layer <= TOWER_LAYERS; layer++) {
    let count;
    if (isFunnelLayer(layer)) {
      count = 1;
    } else if (isFunnelLayer(layer + 1)) {
      // 漏斗层前一层压到 2 列，保证落到单列漏斗时列数差 ≤1（±1 扇出）。
      count = 2;
    } else {
      // 漏斗层之后从 2 列重新张开；2 与 3 之间随机，保持相邻层列数差 ≤1。
      count = prev >= 2 ? (rng.int(2) === 0 ? 2 : 3) : 2;
    }
    counts.push(count);
    prev = count;
  }
  return counts;
}

// 节点类型：层规则优先，其余按独立流 `${seed}:tower:type:<key>` 加权。
export function nodeTypeFor(seed, layer, column) {
  if (isBossLayer(layer)) return 'boss';
  if (layer === 1) return 'fight';
  if (isFunnelLayer(layer)) return 'elite';
  const rng = new RNG(`${seed}:tower:type:${nodeKey(layer, column)}`);
  const pool = TOWER_NODE_TYPES.filter((type) => type !== 'boss');
  return rng.weighted(pool, (type) => TOWER_TYPE_WEIGHTS[type]);
}

// 生成完整节点图：节点按层/列升序，节点对象只落 key/layer/column/type。
export function generateTowerGraph(seed) {
  const counts = towerColumnCounts(seed);
  const nodes = [];
  const byKey = new Map();
  for (let layer = 1; layer <= TOWER_LAYERS; layer++) {
    const columns = counts[layer - 1];
    for (let column = 0; column < columns; column++) {
      const key = nodeKey(layer, column);
      const node = { key, layer, column, type: nodeTypeFor(seed, layer, column) };
      // 精英节点装饰词缀展示条目（只露 id/名称/描述/配色，不携带数值倍率）；
      // 数值（hpMul/speedMul/goldMul）由服务端从 towerEliteModifier 重新派生，不落进节点 JSON。
      if (node.type === 'elite') node.affixes = towerEliteModifier(seed, key).affixes;
      nodes.push(node);
      byKey.set(key, node);
    }
  }
  return { seed, layers: TOWER_LAYERS, nodes, byKey };
}

// 后继：下一层与当前列差 ≤1（±1 扇出）且存在的节点；末层无后继。
export function successors(graph, nodeOrKey) {
  const node = typeof nodeOrKey === 'string' ? graph.byKey.get(nodeOrKey) : nodeOrKey;
  if (!node) return [];
  const out = [];
  for (let delta = -1; delta <= 1; delta++) {
    const next = graph.byKey.get(nodeKey(node.layer + 1, node.column + delta));
    if (next) out.push(next);
  }
  return out;
}

// 两节点是否构成一步合法推进（下一层、列差 ≤1、节点均存在）。
export function isStep(graph, fromOrKey, toOrKey) {
  const a = typeof fromOrKey === 'string' ? graph.byKey.get(fromOrKey) : fromOrKey;
  const b = typeof toOrKey === 'string' ? graph.byKey.get(toOrKey) : toOrKey;
  if (!a || !b) return false;
  return b.layer === a.layer + 1 && Math.abs(b.column - a.column) <= 1;
}

// 选路状态契约（§1.2）：两样状态——选路决策 path（升序、逐层相邻、列差 ≤1 的节点键）
// 与当前游标 node（缺省取 path 末位）。空 / 结构非法返回 null（快照据此 presence-gate）。
// 接受 { path, node }、{ path } 或裸数组；节点键可为 "layer:column" 或 [layer, column]。
export function normalizeTowerRoute(raw) {
  const source = Array.isArray(raw) ? { path: raw } : raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const rawPath = Array.isArray(source.path) ? source.path : [];
  const keys = [];
  for (const entry of rawPath) {
    const key =
      typeof entry === 'string'
        ? entry
        : Array.isArray(entry) && entry.length === 2
          ? nodeKey(entry[0], entry[1])
          : null;
    const parsed = parseNodeKey(key);
    if (!parsed) return null;
    if (parsed.layer < 1 || parsed.layer > TOWER_LAYERS || parsed.column < 0) return null;
    const maxColumn = isFunnelLayer(parsed.layer) ? 0 : 2;
    if (parsed.column > maxColumn) return null;
    if (keys.length > 0) {
      const prev = parseNodeKey(keys[keys.length - 1]);
      if (parsed.layer !== prev.layer + 1 || Math.abs(parsed.column - prev.column) > 1) return null;
    }
    keys.push(key);
  }
  if (keys.length === 0) return null;
  const node = keys[keys.length - 1];
  // 显式游标必须等于 path 末位，避免两样状态不一致。
  if (source.node != null) {
    const cursorKey =
      typeof source.node === 'string'
        ? source.node
        : Array.isArray(source.node) && source.node.length === 2
          ? nodeKey(source.node[0], source.node[1])
          : null;
    if (!cursorKey || cursorKey !== node) return null;
  }
  return { path: keys, node };
}

// 校验选路是否贴合 seed 派生的节点图（列存在性 + 逐层相邻），是结构归一化之外的最强校验。
export function isRouteOnGraph(route, seed) {
  if (!route || !Array.isArray(route.path) || route.path.length === 0) return false;
  const graph = generateTowerGraph(seed);
  for (let i = 0; i < route.path.length; i++) {
    if (!graph.byKey.has(route.path[i])) return false;
    if (i > 0 && !isStep(graph, route.path[i - 1], route.path[i])) return false;
  }
  return true;
}

// 爬塔存档块（§1.2 零 DB 迁移）：只落 ruleset.tower.route；无爬塔状态时返回 null。
export function normalizeTowerState(state) {
  const raw = state?.tower?.route ?? state?.towerRoute;
  if (raw == null) return null;
  const route = normalizeTowerRoute(raw);
  return route ? { route } : null;
}

// 商人刷新费：25 + 6×波（§4.3 冻结）。
export function merchantRefreshFee(wave) {
  const target = Math.max(1, Math.floor(Number(wave) || 1));
  return 25 + 6 * target;
}

// 商人单件遗物价：基础价按层上浮，且不低于 60（§4.4 红线 3）。
export function merchantRarityPrice(rarity, layer) {
  const base = MERCHANT_RELIC_BASE_PRICE[rarity] ?? MERCHANT_RELIC_BASE_PRICE.common;
  const target = Math.max(1, Math.floor(Number(layer) || 1));
  const growth = (target - 1) * MERCHANT_PRICE_GROWTH_PER_LAYER;
  return Math.max(60, Math.round(base * (1 + growth)));
}

// 商人库存（§4.1 金币黑洞 / §4.3 价目）：遗物货架 + 刷新费。
// 随机流 `${seed}:shop:<node>`，同一 seed + 节点永远得到同一货架。
export function merchantInventory(seed, nodeOrKey) {
  const key = typeof nodeOrKey === 'string' ? nodeOrKey : nodeKey(nodeOrKey.layer, nodeOrKey.column);
  const layer = parseNodeKey(key)?.layer ?? 1;
  const rng = new RNG(`${seed}:shop:${key}`);
  const pool = RELICS.slice();
  const offers = [];
  while (offers.length < MERCHANT_OFFER_COUNT && pool.length) {
    const relic = rng.weighted(pool, (item) => rarityWeightForMode(item.rarity));
    offers.push({
      kind: 'relic',
      id: relic.id,
      rarity: relic.rarity,
      price: merchantRarityPrice(relic.rarity, layer),
    });
    pool.splice(pool.indexOf(relic), 1);
  }
  return { key, offers, refreshFee: merchantRefreshFee(layer) };
}
