// 爬塔领域服务：节点图派生、选路校验、战斗波次、事件/首领分流与商人货架。
// 由 run-service.mjs 委托，独立成模块以守住 run-service 的行数预算（PHASE_REFACTOR §5）。
import { generateWave } from '../../public/js/shared/waves.js';
import { generateTowerGraph, isStep, merchantInventory, nodeKey, parseNodeKey, successors } from '../../public/js/shared/tower.js';
import { RELIC_MAX_LEVEL, normalizeRelicStates } from '../../public/js/shared/data.js';
import { setOffers, setRelics, setRuleset, setWavesServed } from '../db/runs.mjs';
import { RunError } from './run-error.mjs';
import { hexFor, isTowerCombatType, isTowerRun, towerNodeFor, towerRouteFor } from './run-rules.mjs';

// 爬塔当前节点对象；旧 run 缺 route 时回退起点（只读）。
function currentTowerNode(run) {
  const graph = generateTowerGraph(run.seed);
  const route = towerRouteFor(run);
  return graph.byKey.get(route.node) ?? graph.byKey.get('1:0');
}

// 回传选路状态与当前节点，客户端据此恢复节点图；旧 run 无该字段，客户端跳过。
export function towerPayload(run) {
  return {
    route: towerRouteFor(run),
    node: towerNodeFor(run),
    difficultyMode: run.ruleset?.tower?.difficultyMode || 'floor-equals-wave',
  };
}

// 爬塔节点图 + 当前位置 + 后继：服务端权威派生，客户端只读渲染（防自造）。
export function towerNodes(run) {
  if (!isTowerRun(run)) throw new RunError(409, '本局不是爬塔模式', 'NOT_TOWER');
  const graph = generateTowerGraph(run.seed);
  const route = towerRouteFor(run);
  const node = graph.byKey.get(route.node) ?? graph.byKey.get('1:0');
  return {
    seed: run.seed,
    layers: graph.layers,
    nodes: graph.nodes,
    route,
    node: node ? { key: node.key, layer: node.layer, column: node.column, type: node.type } : null,
    successors: node ? successors(graph, node) : [],
  };
}

// 选路：只允许当前游标的相邻层后继（±1 列），服务端校验防作弊。
export function chooseTowerNode(run, { node }) {
  if (!isTowerRun(run)) throw new RunError(409, '本局不是爬塔模式', 'NOT_TOWER');
  const graph = generateTowerGraph(run.seed);
  const route = towerRouteFor(run);
  // 战斗节点必须先清波才能推进，否则可跳过战斗白嫖路径（难度追击红线）。
  const current = graph.byKey.get(route.node) ?? graph.byKey.get('1:0');
  if (isTowerCombatType(current.type) && run.clearedWaves < current.layer) {
    throw new RunError(409, '请先结算当前战斗节点', 'NODE_NOT_CLEARED');
  }
  const key =
    typeof node === 'string'
      ? node
      : Array.isArray(node) && node.length === 2
        ? nodeKey(node[0], node[1])
        : null;
  const target = parseNodeKey(key) ? graph.byKey.get(key) : null;
  if (!target) throw new RunError(400, '目标节点不存在', 'INVALID_NODE');
  if (!isStep(graph, route.node, target.key)) {
    throw new RunError(400, '只能选择相邻层的后继节点', 'INVALID_NODE');
  }
  const nextRoute = { path: [...route.path, target.key], node: target.key };
  const ruleset = {
    ...(run.ruleset || {}),
    tower: { ...(run.ruleset?.tower || {}), route: nextRoute },
  };
  setRuleset(run.id, JSON.stringify(ruleset));
  run.ruleset = ruleset;
  return { route: nextRoute, node: { ...target }, successors: successors(graph, target) };
}

// 爬塔战斗波次：难度映射「楼层=波次」，直接复用 generateWave(seed, 层)；战斗类节点才可放行。
export function serveTowerWaveFor(run) {
  const node = currentTowerNode(run);
  if (!isTowerCombatType(node.type)) {
    throw new RunError(409, '当前节点不是战斗节点', 'NOT_COMBAT_NODE');
  }
  const hex = hexFor(run);
  // 有未结算波次时重放当前波，不推进、不重复发奖。
  if (run.clearedWaves < run.wavesServed) {
    return {
      wave: generateWave(run.seed, run.wavesServed, run.difficulty, {}, { endless: false }),
      replay: true,
      clearedWaves: run.clearedWaves,
      wavesServed: run.wavesServed,
      hex,
    };
  }
  if (run.clearedWaves >= node.layer) {
    throw new RunError(409, '当前节点已经结算，请先选择下一节点', 'NODE_ALREADY_CLEARED');
  }
  setWavesServed(run.id, node.layer);
  return {
    wave: generateWave(run.seed, node.layer, run.difficulty, {}, { endless: false }),
    replay: false,
    clearedWaves: run.clearedWaves,
    wavesServed: node.layer,
    hex,
  };
}

// 只有 fight 节点清波后给免费遗物；event/merchant 无战斗无遗物，抵达即完成。
export function ensureTowerFightRelicNode(run) {
  if (currentTowerNode(run).type !== 'fight') {
    throw new RunError(409, '只有战斗节点给遗物', 'NO_RELIC_NODE');
  }
}

// 事件波次：爬塔取当前事件节点层，非事件节点拒绝。
export function towerEventWave(run) {
  const node = currentTowerNode(run);
  if (node.type !== 'event') throw new RunError(409, '当前节点不是事件节点', 'NOT_EVENT_NODE');
  return node.layer;
}

// 首领核心波次：爬塔取当前首领节点层，非首领节点拒绝。
export function towerBossCoreWave(run) {
  const node = currentTowerNode(run);
  if (node.type !== 'boss') throw new RunError(409, '当前节点没有首领核心', 'NOT_BOSS_NODE');
  return node.layer;
}

// 商人节点：确定性货架（seed:shop:<node>），picked 状态寄存在 offers JSON 的 merchant:<node> 槽位。
export function towerMerchantNode(run) {
  if (!isTowerRun(run)) throw new RunError(409, '本局不是爬塔模式', 'NOT_TOWER');
  const node = currentTowerNode(run);
  if (node.type !== 'merchant') throw new RunError(409, '当前节点不是商人节点', 'NOT_MERCHANT_NODE');
  const inventory = merchantInventory(run.seed, node.key);
  const slot = (run.offers || {})[`merchant:${node.key}`];
  return {
    node: node.key,
    wave: node.layer,
    key: inventory.key,
    offers: inventory.offers,
    refreshFee: inventory.refreshFee,
    picked: !!slot?.picked,
    choice: slot?.picked ? { offerIndex: slot.offerIndex } : null,
  };
}

// 买一件遗物：镜像遗物三选一的落库（遗物服务端权威）；金币由客户端本地结算。
// 同节点幂等，已购买后换选/重买一律 409。
export function pickTowerMerchant(run, { index } = {}) {
  if (!isTowerRun(run)) throw new RunError(409, '本局不是爬塔模式', 'NOT_TOWER');
  const node = currentTowerNode(run);
  if (node.type !== 'merchant') throw new RunError(409, '当前节点不是商人节点', 'NOT_MERCHANT_NODE');
  const inventory = merchantInventory(run.seed, node.key);
  const offers = run.offers || {};
  const key = `merchant:${node.key}`;
  if (offers[key]?.picked) throw new RunError(409, '本节点已购买，不能重复购买', 'MERCHANT_LOCKED');
  const offerIndex = Math.floor(Number(index));
  if (!Number.isInteger(offerIndex) || offerIndex < 0 || offerIndex >= inventory.offers.length) {
    throw new RunError(400, '选择不在本次货架中', 'INVALID_MERCHANT_OFFER');
  }
  const offer = inventory.offers[offerIndex];
  const states = normalizeRelicStates(run.relics);
  const existing = states.find((state) => state.id === offer.id);
  const targetLevel = Math.min(RELIC_MAX_LEVEL, (existing?.level || 0) + 1);
  if (existing) existing.level = targetLevel;
  else states.push({ id: offer.id, level: targetLevel });
  setRelics(run.id, JSON.stringify(states));
  offers[key] = { picked: true, offerIndex };
  setOffers(run.id, JSON.stringify(offers));
  return { node: node.key, wave: node.layer, applied: offer, relics: states, picked: true };
}
