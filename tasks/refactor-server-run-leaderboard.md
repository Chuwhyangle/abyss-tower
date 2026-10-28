---
id: refactor-server-run-leaderboard
title: 重构 R3：拆分 run-service 与 leaderboard
status: done
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

- [x] 两个入口文件与所有新模块均 ≤ 600 行
- [x] 公共导出名与签名不变（`RunService`、`RunError`、`finishedDailyToday`、`validateLeaderboardEntry`、`boardKeyFor` 等）
- [x] `npm test` 全绿；静态检查通过
- [x] `node scripts/check-sim-determinism.mjs --check` exit 0（服务端拆分不得触碰模拟路径）
- [x] `node scripts/structure-budget.mjs --check` exit 0，且本任务债务文件已删除
- [x] `npm run perf:budget` 通过

## DoD

- [x] SQL 文本逐字节不变（拆分只移动拼接逻辑，不改语句）
- [x] 无兼容重导出壳；测试与路由 import 同步更新
- [x] 边界与 `docs/PHASE_REFACTOR.md` §6 R3 一致

## Notes

### 落地边界（R3）

- `server/services/run-rules.mjs`（392）：规则常量、次数/连胜、地图候选与海克斯派生，以及
  `planRunStart()`（建局前全部规则推导：模式/难度/技能/开局资源/ruleset/固定图/变异与开局响应字段）。
  领域错误以 `{ error: { status, message, code } }` 返回，由服务层转成 `RunError` —— 规则层不认识
  错误类型，从而不与 `run-service.mjs` 互相 import 成环（`structure-budget` 判环会红）。
- `server/services/run-settlement.mjs`（222）：`settleRunOutcome()` 承接整段结算编排（事务、回放归档、
  首通授予、入榜校验、战绩、成就、名次与返回值组装），回放摘要由服务类注入。
- `server/services/run-service.mjs`（458）：`RunError` + `RunService`，方法签名全部保持；`create()` 只剩
  「错误转换 + 落库编排」，`settle()` 委托结算模块。
- `server/db/leaderboard-sql.mjs`（255）：赛季键/区间、`boardKeyFor`、排序口径、better 条件、
  榜单筛选范围、游标编解码与 keyset 条件，另含三段语句文本构造器；纯构造、不碰数据库。
  赛季日历放这里是因为 `boardKeyFor` 的无尽榜默认赛季要用它，而 cyc​le 检查禁止 sql ↔ leaderboard 互相依赖。
- `server/db/leaderboard-validate.mjs`（89）：`LEADERBOARD_GUARD` 与 `validateLeaderboardEntry`，纯函数。
- `server/db/leaderboard.mjs`（569）：查询执行、分页缓存、对外序列化与赛季结算/奖励。

### 行为保真的两处细节

- 每日「连续参与天数」由 runs 记录派生，必须在开局落库**之后**读；首版把 `dailyStreakFor` 放进
  `planRunStart` 导致 streak 恒为 0（`daily-challenge` 用例抓到），已改为服务层插入后补齐。
- 拆分后用脚本捕获旧/新实现的 `db.prepare` SQL 文本（读路径 + 赛季结算 dry-run，含普通/无尽/每日/
  变异榜与分页游标），`diff` 为空 —— SQL 文本逐字节一致的证据。

### 验证

- `npm test`：1727/1727 通过（25s）
- `npm run check:syntax && check:imports && check:style && check:docs`：全绿
- `node scripts/structure-budget.mjs --check`：OK（437 源文件，无环，本任务债务条目已删）
- `node scripts/check-sim-determinism.mjs --check`：OK（3 seed 三份哈希与基线一致）
- `npm run perf:budget`：PASS

## Touches

- `server/services/run-service.mjs`
- `server/services/run-rules.mjs` (new)
- `server/services/run-settlement.mjs` (new)
- `server/db/leaderboard.mjs`
- `server/db/leaderboard-sql.mjs` (new)
- `server/db/leaderboard-validate.mjs` (new)
- `server/db/season_pass.mjs`
- `server/db/achievements.mjs`
- `server/services/leaderboard-service.mjs`
- `server/services/season-pass-service.mjs`
- `server/routes/runs.mjs`
- `server/routes/support.mjs`
- `scripts/ops.mjs`
- `scripts/settle-seasons.mjs`
- `scripts/structure-budget.allow.d/refactor-server-run-leaderboard.json`
- `tests/acceptance-map-hex.test.mjs`
- `tests/achievements-depth-v2.test.mjs`
- `tests/audit-log.test.mjs`
- `tests/endless-leaderboard.test.mjs`
- `tests/leaderboard-guard.test.mjs`
- `tests/leaderboard-paging.test.mjs`
- `tests/leaderboard-season.test.mjs`
- `tests/leaderboard-suspect-ui.test.mjs`
- `tests/leaderboard-titles.test.mjs`
- `tests/season-pass-claim-all.test.mjs`
- `tests/season-pass-closed.test.mjs`
- `tests/season-pass-sources.test.mjs`
- `tests/season-pass.test.mjs`
- `tests/season-reward-notification.test.mjs`
- `tests/season-rewards.test.mjs`
- `tests/seasonal-achievement-ui.test.mjs`
- `tests/seasonal-achievements.test.mjs`
- `tests/settle-seasons.test.mjs`
- `tasks/refactor-server-run-leaderboard.md`
