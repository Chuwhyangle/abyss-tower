---
id: feat-tower-elite-nodes
title: 爬塔 elite 节点补内容：词缀强化 + 高稀有奖励
status: todo
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

爬塔 elite 节点补内容（P0-6）。现状：爬塔模式的 elite 节点是空壳（比 fight 节点还少遗物）。补「词缀强化 + 高稀有」：

- elite 节点 = fight 节点 + 随机 1~2 条精英词缀（复用 MAP_MODIFIERS/事件词缀风格，如敌人加速/护甲增强/塔减伤），结算奖励比 fight 多（金币×1.5 或高稀有遗物概率提升）。
- 词缀 seed 派生（`${seed}:tower:elite:*` 命名空间，不进 sim.js 既有 RNG 流），服务端权威。
- 节点内容隐藏逻辑对齐现有「只露类型+词缀」，elite 显示为高风险高收益节点。

## AC

- [ ] elite 节点比 fight 多词缀 + 高奖励，不再是空壳
- [ ] elite 词缀 seed 派生，确定性保持，不进 sim.js 既有 RNG 顺序
- [ ] `npm test` 全绿；爬塔测试覆盖 elite 词缀/奖励
- [ ] 服务端权威，客户端只渲染（防作弊）

## DoD

- [ ] 落地于 `tower.js`（节点）+ 词缀/奖励数据 + `run-service` 服务端，零第三方依赖
- [ ] 不碰 fight/事件/商人/首领节点既有逻辑
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/tower.js`
- `public/js/shared/data/tower-elite.js` (elite 词缀/奖励数据，new)
- `server/services/run-service.mjs`
- `tests/tower-elite.test.mjs` (爬塔 elite 测试，new)
- `scripts/test-changed.mjs`
- `tasks/feat-tower-elite-nodes.md`

## Notes

立案 2026-11-06，源自 P0-6「爬塔 elite 节点补内容」。爬塔节点图/路由契约见 `docs/PHASE_爬塔.md` 与 `tower.js`。elite 词缀复用既有词缀系统，不新增 RNG 流。