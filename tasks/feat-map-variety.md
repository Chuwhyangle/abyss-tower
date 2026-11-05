---
id: feat-map-variety
title: 单局地图变化：复用 12 条词缀池 + 布局变体
status: ready
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

单局地图变化（P1-10）。现状：3 张固定图零随机、12 条地图词缀池成死代码。补布局变体/词缀复用：

- 复用现有 12 条地图词缀池（`MAP_MODIFIERS`），每局开局随机附加 1 条词缀（seed 派生，服务端权威），让同一张图不同 seed 有差异。
- 布局变体（可选后置）：3 张固定图的建塔位/可破坏物做 2~3 个 seed 派生变体（不改路径，只挪塔位/可破坏物）。

## AC

- [ ] 每局开局附 1 条随机地图词缀（seed 派生，确定性），词缀池不再是死代码
- [ ] 服务端权威，客户端只渲染；不进 sim.js 既有 RNG 顺序
- [ ] `npm test` 全绿；词缀生效有测试覆盖
- [ ] balance 复测不漂移（词缀若影响 hpMul/goldMul）

## DoD

- [ ] 落地于 `mapgen`/`run-rules` + 词缀复用，零第三方依赖
- [ ] 不碰存档版本（presence-gate 隔离）或明确 bump
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/mapgen.js`
- `server/services/run-rules.mjs`
- `server/services/run-service.mjs`
- `tests/map-variety.test.mjs` (new)
- `scripts/test-changed.mjs`
- `tasks/feat-map-variety.md`

## Notes

立案 2026-11-06，源自 P1-10「单局地图变化：3 图零随机、12 条词缀池成死代码」。与 `feat-tower-elite-nodes` 都改 `run-service.mjs`，Touches 会冲突，需串行或本任务后置。