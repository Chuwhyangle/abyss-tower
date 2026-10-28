---
id: refactor-server-run-leaderboard
title: 重构 R3：拆分 run-service 与 leaderboard
status: ready
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: npm test
depends_on:
  - refactor-baseline-and-structure-gate
goal_ac: AC-043
---
## Proposal

`server/services/run-service.mjs`（1017 行）与 `server/db/leaderboard.mjs`（893 行）把规则、SQL 构造、校验、序列化与编排混在一起。服务端是最需要「改一处不影响别处」的区域，且这两个文件是每日/周常规则的唯一实现处。本任务按「规则 / 持久化 / 序列化 / 编排」拆分，API 与行为零变化。

## Plan

1. `run-service.mjs` 拆为：`run-rules.mjs`（每日/周常/固定图规则、次数、连胜、ruleset 常量）、
   `run-settlement.mjs`（结算：成就/通知/排行榜写入的调用编排）、`run-service.mjs`（对外类与错误，保留现有方法签名）。
2. `leaderboard.mjs` 拆为：`leaderboard-sql.mjs`（boardKey/orderBy/betterCondition/参数构造）、
   `leaderboard-validate.mjs`（validateLeaderboardEntry、防作弊阈值）、`leaderboard.mjs`（对外函数 + 赛季）。
3. 保持所有 export 名称与签名不变；路由与测试的 import 路径同步更新；每步跑 `npm test`。
4. 删除 `scripts/structure-budget.allow.d/refactor-server-run-leaderboard.json`。

## AC

- [ ] 两个入口文件与所有新模块均 ≤ 600 行
- [ ] 公共导出名与签名不变（`RunService`、`RunError`、`finishedDailyToday`、`validateLeaderboardEntry`、`boardKeyFor` 等）
- [ ] `npm test` 全绿；静态检查通过
- [ ] `node scripts/check-sim-determinism.mjs --check` exit 0（服务端拆分不得触碰模拟路径）
- [ ] `node scripts/structure-budget.mjs --check` exit 0，且本任务债务文件已删除
- [ ] `npm run perf:budget` 通过

## DoD

- [ ] SQL 文本逐字节不变（拆分只移动拼接逻辑，不改语句）
- [ ] 无兼容重导出壳；测试与路由 import 同步更新
- [ ] 边界与 `docs/PHASE_REFACTOR.md` §6 R3 一致

## Touches

- `server/services/run-service.mjs`
- `server/services/run-rules.mjs` (new)
- `server/services/run-settlement.mjs` (new)
- `server/db/leaderboard.mjs`
- `server/db/leaderboard-sql.mjs` (new)
- `server/db/leaderboard-validate.mjs` (new)
- `scripts/structure-budget.allow.d/refactor-server-run-leaderboard.json`
- `tests/leaderboard.test.mjs`
- `tasks/refactor-server-run-leaderboard.md`
