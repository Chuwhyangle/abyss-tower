---
id: gap-ac-056-starter-relic-upgrade-guarantee
title: 开局信物三选一与第 3 波起保底升级卡在五模式确定性可复现（AC-056）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-054-rogue2-design-rebase
  - gap-ac-055-factions-points
goal_ac: AC-056
---
## Proposal

AC-056（开局信物三选一与第 3 波起保底升级卡）已由 goal-driver 激活，criterion 为 `grep -q 'starter' public/js/shared/data/relics.js`（expect exit 0），当前 exit 1：`relics.js` 无 `starter` 字样，`rollRelicOffers` 是完全随机抽取、升级卡没有保底；开局只有 `start_relic` 解锁时随机送 1 件（`server/services/run-rules.mjs`），没有信物三选一流程。origin（GOAL-011 退出条件 3）要求开局信物与第 3 波起保底升级卡在普通/每日/本周/无尽/变异全部可用且确定性可复现。本任务只做开局信物三选一与升级保底，不碰派系阈值/首领核心/契约/教义/觉醒（AC-055 与 AC-057..AC-061 各自认领）。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-056` 认领（task_list + grep 已核）。同机制前任 `gap-starter-relic-upgrade-guarantee`（goal_ac AC-034）已于 2026-10-27 被人在 Notes 撤销（superseded，等待重新设计），本任务把它重基到 GOAL-011 的 AC-056。与 `gap-ac-055-factions-points`（todo，AC-055）的边界：派系 `faction` 字段、点数与阈值由该任务提供，本任务只消费 `faction` 并发放 1 点；两者 Touches 在 relics.js/modals.js/i18n 重叠，调度器按 Touches 串行，保持独立（各自 goal_ac 与独立验收，不合并）。冻结表由 `gap-ac-054-rogue2-design-rebase`（todo，AC-054）产出；真前置走顶层 `depends_on` 字段，不在本段声明。

## Plan

1. `public/js/shared/data/relics.js` 新增 `rollStarterOffers(seedKey, mode)`：确定性返回 3 件不同派系的 Ⅰ 级信物（函数名与候选结构带 `starter`，满足 AC-056 判据）；同一 seed 在普通/每日/本周/无尽/变异下可复现，每日同组玩家候选一致。
2. `rollRelicOffers` 增加保底：`wave >= 3` 且存在已拥有且未满级遗物时，第一个 offer 必须是其中一件的升级卡（`fromLevel >= 1`）；其余仍按权重随机，池空时保持既有金币/修复补位。
3. `server/services/run-service.mjs` 创建 run 时生成并持久化 starter 候选，新增选择动作；`server/routes/runs.mjs` 暴露读取/选择端点；`server/services/run-rules.mjs` 里 `start_relic` 随机送 1 件与信物三选一的取舍按冻结表收敛。服务端权威，客户端不得自造候选。
4. `public/js/app/run.js` 在选图/海克斯之前插入信物三选一；`public/js/ui/modals.js` 复用既有三选一弹窗样式；选择成功写入 run 后进入原有流程，失败停留在同一组候选不重复消耗。
5. 快照与旧档：旧 run 无 starter 字段时跳过信物流程；快照恢复后候选与已选状态幂等。
6. 新增 `tests/starter-relic.test.mjs`：候选确定性、三派系不重复、选择后点数为 1、第 3 波起必含升级卡、旧档兼容、每日同组一致。

## AC

- [ ] `grep -q 'starter' public/js/shared/data/relics.js` exit 0（AC-056 本体判据）
- [ ] `node --test tests/starter-relic.test.mjs` exit 0
- [ ] `node --test tests/relics-depth.test.mjs tests/daily-challenge.test.mjs` exit 0
- [ ] `node --test tests/snapshot.test.mjs tests/api.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 真实创建一局：开局出现三张不同派系信物，选中后遗物入包、对应派系 +1 点，随后正常进入选图
- [ ] 同一 seed 重复创建得到同一组信物；每日挑战同组玩家候选一致
- [ ] 第 3 波起，只要存在已拥有且未满级遗物，三选一必含一张升级卡；没有可升级遗物时行为与今天一致
- [ ] 刷新、快照恢复、旧档续玩都不重复发信物、不换候选；五模式（普通/每日/本周/无尽/变异）都可用且确定性可复现

## Touches

- `public/js/shared/data/relics.js`
- `server/services/run-service.mjs`
- `server/services/run-rules.mjs`
- `server/routes/runs.mjs`
- `public/js/app/run.js`
- `public/js/ui/modals.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/starter-relic.test.mjs` (new)
- `tasks/gap-ac-056-starter-relic-upgrade-guarantee.md`

## Notes

开局信物是服务端权威选择，客户端不得自造候选。升级保底只在 `rollRelicOffers` 内实现，沿用既有 `${run.seed}:relic:...` 抽取流、不触碰 `public/js/sim.js` 的战斗 RNG 调用顺序。`start_relic` 解锁（run-rules.mjs 现有随机送 1 件）与信物三选一的取舍以 `docs/PHASE_ROGUE2.md` 冻结表为准。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。