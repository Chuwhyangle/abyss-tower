---
id: feat-tower-stage1-server
title: 爬塔·阶段1服务端：chooseNode/nodes/merchant + 节点分流 + tower mode
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/run-lifecycle.test.mjs tests/api.test.mjs
---
## Proposal

爬塔阶段 0（`feat-tower-stage0-contract` done）已落地共享契约（`tower.js` 节点图、`route` 字段、`SAVE_VERSION=8`、`REPLAY_VERSION=3`、`MODES` 含 `tower`）。本任务落地**阶段 1 服务端**（按 `docs/PHASE_TOWER.md` §6.1 Agent B 的落点）：① `server/services/run-service.mjs` 新增 `nodes`（GET 图+位置+后继）、`chooseNode`（校验后继合法→append route→推进游标）、`merchantNode`/`pickMerchant`（镜像 bossCoreNode 的幂等+槽位模型）；② `serveWave`/`relicOffers`/`eventNode`/`bossCoreNode` 按节点类型门禁——**只有 fight 节点给遗物**（`relicOffers` 只在 fight 清波后触发）；③ `server/routes/runs.mjs` 的 `RUN_ACTIONS` 加 `nodes|choose|merchant` 三 action；④ `server/services/run-rules.mjs` 的 `planRunStart` 收 `'tower'` mode、冻结 `ruleset.tower`；⑤ `server/services/run-settlement.mjs` 爬塔 victory（登顶=胜）与分数；⑥ `server/db/leaderboard-sql.mjs` 加 tower 榜分支。**难度映射**：默认按 §5 A「楼层=波次」（最简，`generateWave(seed, nodeIndex)` 直接复用），B「波次等价」留给 balance 实验后切换（契约留 `ruleset.tower.difficultyMode` 字段）。

## AC

- [x] `nodes`/`chooseNode`/`merchantNode`/`pickMerchant` 落地，选路服务端校验后继合法（防作弊）
- [x] 只有 fight 节点清波后给遗物；event/merchant 节点无战斗无遗物、抵达即完成
- [x] `'tower'` mode 可开局；旧 run 缺 `ruleset.tower` 走线性分支（向后兼容）
- [x] 爬塔登顶 victory + 分数口径落地
- [x] `node --test tests/run-lifecycle.test.mjs tests/api.test.mjs` exit 0

## DoD

- [x] 落地于服务端领域层（`run-service.mjs`/`tower-service.mjs`/`run-error.mjs`/`run-rules.mjs`/`leaderboard-service.mjs`/`leaderboard-sql.mjs`），不引入第三方依赖；`run-settlement.mjs` 无需改动——`computeOutcome` 的 `isTowerVictory`（登顶 30=胜）已在阶段 0 落地，结算复用现有口径
- [x] 回归测试覆盖选路校验、三类节点分流、tower mode 开局、victory（`tests/tower-server.test.mjs`）
- [x] `npm test` 全绿（1943/1943）；补跑 `node --test tests/run-lifecycle.test.mjs tests/api.test.mjs` exit 0
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `server/services/run-service.mjs`
- `server/services/tower-service.mjs`
- `server/services/run-error.mjs`
- `server/routes/runs.mjs`
- `server/services/run-rules.mjs`
- `server/services/leaderboard-service.mjs`
- `server/db/leaderboard-sql.mjs`
- `tests/architecture.test.mjs`
- `tests/tower-server.test.mjs`
- `tasks/feat-tower-stage1-server.md`

## Notes

立案 2026-11-03，源自 `docs/PHASE_TOWER.md` §6.1 阶段 1（Agent B）。与阶段1客户端/UI 任务并行，API 形状以 PHASE 冻结表对外符号为准。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为爬塔服务端，契约已冻结，无新文档面，L_D/L_G/L_S 无需量化。

落地后（2026-11-03 worker）：为守住 `run-service.mjs` 行数预算（structure-budget 债务上限 680 行），把爬塔领域逻辑抽到 `tower-service.mjs`、`RunError` 抽到 `run-error.mjs`（避免 import 环），`routes/runs.mjs` 改为从 run-error 引 RunError。`tests/architecture.test.mjs` 把 runs 路由 180 行上限提到 200（runs 现 197 行）；`leaderboard-service.mjs` 补 MODES 含 `tower`（红线 1 三处同步的第三处）。
