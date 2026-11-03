// 爬塔节点地图视图控制器（阶段 1）：读取/同步服务端权威节点图与选路游标，
// 渲染节点地图并处理选路推进；到达后按节点类型分流交给 controller 装配的回调。
// 只做「读图 / 选路 / 展示」，节点类型的后续动作（战斗/事件/商人/宝藏）不在此处落地。
import { generateTowerGraph, normalizeTowerRoute } from '../shared/tower.js';

export class TowerNodeController {
  constructor({ state, api, ui, onChooseNode }) {
    this.state = state;
    this.api = api;
    this.ui = ui;
    this.onChooseNode = onChooseNode;
    this.choosing = false;
  }

  // 节点图：懒生成并缓存到 state，服务端与客户端同一 seed 派生完全一致。
  graph() {
    const { state } = this;
    if (!state.towerGraph) state.towerGraph = generateTowerGraph(state.run?.seed);
    return state.towerGraph;
  }

  // 当前节点对象：由选路游标从节点图取；游标缺失返回 null（只读派生）。
  currentNode() {
    const graph = this.graph();
    const key = this.state.run?.tower?.route?.node ?? this.state.run?.tower?.node ?? null;
    return key ? (graph.byKey.get(key) ?? null) : null;
  }

  // 用服务端回传的选路同步本地状态与 sim 游标；返回当前节点对象（供分流）。
  // 兼容 nodes 与 choose 两种响应（两者都带 route / node）。
  sync(data) {
    const { state } = this;
    const route = normalizeTowerRoute(data?.route);
    if (!route) return null;
    state.run.tower = { route, node: route.node };
    state.sim?.setTowerRoute(route);
    const node = this.graph().byKey.get(route.node) ?? null;
    state.run.towerNode = node ? { ...node } : null;
    return node;
  }

  // 从服务端拉取节点图并展示（续玩 / 手动打开时调用）。
  async loadNodes() {
    const { state } = this;
    if (state.run?.mode !== 'tower') return;
    try {
      const data = await this.api.getNodes(state.run.id);
      this.sync(data);
      this.openNodeMap();
    } catch (error) {
      this.ui.toast(error.message, 2800);
    }
  }

  // 渲染节点地图：逐层 DAG + 当前游标 + 可达后继；点击后继触发选路。
  openNodeMap() {
    const { state } = this;
    const current = this.currentNode();
    this.ui.showNodeMap({
      graph: this.graph(),
      currentNode: current?.key ?? null,
      path: state.run?.tower?.route?.path ?? [],
      onChoose: (key) => this.choose(key),
    });
  }

  // 选路推进：服务端校验相邻层后继，回传 route 后同步并交给 controller 分流。
  async choose(key) {
    const { state } = this;
    if (this.choosing || !state.run?.id) return;
    this.choosing = true;
    try {
      const data = await this.api.chooseNode(state.run.id, key);
      const node = this.sync(data);
      if (node) this.onChooseNode?.(node);
    } catch (error) {
      this.ui.toast(error.message, 2800);
    } finally {
      this.choosing = false;
    }
  }
}
