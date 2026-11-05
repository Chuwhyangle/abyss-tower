---
id: feat-daily-weekly-rules
title: 每日/每周挑战加新规则：每日轮换 + 每周复合规则
status: ready
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

- [x] 每日挑战每日轮换 1 条规则；每周挑战固定 1 组复合规则
- [x] 规则 seed 派生（day/week key），确定性，服务端权威
- [x] `npm test` 全绿；规则生效有测试覆盖

## DoD

- [x] 落地于 `run-rules.mjs`/`scoring.js`/`daily-weekly` 规则数据，零第三方依赖
- [x] 不碰正常模式、爬塔
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `server/services/run-rules.mjs`
- `public/js/shared/scoring.js`
- `public/js/shared/data/daily-weekly-rules.js` (每日/每周规则数据，new)
- `tests/daily-weekly-rules.test.mjs` (每日/每周规则测试)
- `scripts/test-changed.mjs`
- `tasks/feat-daily-weekly-rules.md`

## Notes

立案 2026-11-06，源自 P1-7「每日/每周挑战加新规则」。与 `feat-map-variety` 都改 `run-rules.mjs`，Touches 冲突需串行。规则设计细节需在实现中补 Notes。

实现 Notes（2026-11-06）：

- 规则数据落地 `public/js/shared/data/daily-weekly-rules.js`：5 条每日规则（enemy_might/swift_foes/austerity/short_leash/hardened）+ 5 组每周复合规则（onslaught/siege/gauntlet/blitz/fortress），复用地图词缀 schema（hpMul/speedMul/goldMul/rangeMul，1 = 不变）。
- 派生为纯函数：`dailyRule(day)` / `weeklyRuleGroup(week)` 用独立随机流 `RNG('daily-rule:<day>')` / `RNG('weekly-rule:<week>')`，服务端与浏览器同一共享模块、同一结果，确定性且服务端权威（落库到 `ruleset.daily.rules` / `ruleset.weekly.rules`）。
- 生效路径：`run-rules.mjs` 的 `mapCandidatesFor` 把规则叠加到固定地图候选（在「trait × 随机词缀」之后再乘一层），只改战斗数值（hpMul/speedMul/goldMul/rangeMul），不改开局参数（startingGold/baseHp/maxRerolls/towersUnlocked 不变），因此不破坏 weekly-challenge.test.mjs 的开局参数钉。
- 为什么不走 mutation：mutation 会改开局参数且只支持少量效果，会污染结算并破坏开局参数钉；改走 map-modifier 叠加更干净。
- 不碰正常/爬塔：规则仅在 `ruleset.daily/weekly.rules` 存在时叠加；正常/爬塔无该字段，`dailyWeeklyModifierFor` 返回 null，行为不变（`tests/daily-weekly-rules.test.mjs` 有「普通模式不写入规则」反例）。
- `scripts/test-changed.mjs` 无需改动：新数据文件位于 `public/js/shared/`，已被 SHARED_RULES 覆盖（回退全量），审计覆盖全绿。
