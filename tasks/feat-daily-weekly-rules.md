---
id: feat-daily-weekly-rules
title: 每日/每周挑战加新规则：每日轮换 + 每周复合规则
status: todo
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

每日/每周挑战加新规则（P1-7）。现状：每日/每周挑战只是固定 seed 普通局，无差异。补规则变化：

- 每日挑战：每日轮换 1 条特殊规则（如「塔价格 +50%」「敌人加速」「遗物 -1 次」等，复用变异/词缀风格）。
- 每周挑战：每周固定 1 组复合规则（多词缀组合），规则随周轮换。
- 规则 seed 派生（`weekKey`/`dayKey` 派生，服务端权威），确定性。

## AC

- [ ] 每日挑战每日轮换 1 条规则；每周挑战固定 1 组复合规则
- [ ] 规则 seed 派生（day/week key），确定性，服务端权威
- [ ] `npm test` 全绿；规则生效有测试覆盖

## DoD

- [ ] 落地于 `run-rules.mjs`/`scoring.js`/`daily-weekly` 规则数据，零第三方依赖
- [ ] 不碰正常模式、爬塔
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `server/services/run-rules.mjs`
- `public/js/shared/scoring.js`
- `public/js/shared/data/daily-weekly-rules.js` (每日/每周规则数据，new)
- `tests/daily-weekly-rules.test.mjs` (每日/每周规则测试)
- `scripts/test-changed.mjs`
- `tasks/feat-daily-weekly-rules.md`

## Notes

立案 2026-11-06，源自 P1-7「每日/每周挑战加新规则」。与 `feat-map-variety` 都改 `run-rules.mjs`，Touches 冲突需串行。规则设计细节需在实现中补 Notes。