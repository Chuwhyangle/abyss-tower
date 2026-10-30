---
id: gap-ac-057-boss-core-choice
title: 首领核心：第 5/10/15/20/25 波清波后五类核心三选一在五模式确定性可复现（AC-057）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-054-rogue2-design-rebase
goal_ac: AC-057
---
## Proposal

AC-057（首领核心：五个首领波清波后的五类核心选择）已由 goal-driver 激活，criterion 为 `grep -q 'bossCore' public/js/shared/data/relics.js`（expect exit 0），当前 exit 1：`relics.js` 无任何 `bossCore` 字样，也没有首领波后的核心选择流程。origin（GOAL-011 退出条件 4）要求第 5/10/15/20/25 波清波后三选一，五类核心为升阶/搜寻/觉醒/教义/补给，且都能通过快照恢复、旧档兼容。本任务只做首领核心选择机制与升阶/搜寻/补给三类即时效果；觉醒（AC-060）与教义（AC-059）的内容由各自任务实现，本任务在核心表里提供可选的「觉醒/教义」条目并按冻结表字段契约持久化所选引用。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-057` 认领（task_list + grep 已核）。与 `gap-ac-055-factions-points`（todo，AC-055）、`gap-ac-056-starter-relic-upgrade-guarantee`（todo，AC-056）的边界：派系点数与开局信物由那两个任务各自认领，本任务只消费其产物（`faction` 字段、三选一弹窗样式）；三者 Touches 在 relics.js/modals.js/i18n 重叠，调度器按 Touches 串行，保持独立（各自 goal_ac 与独立验收，不合并）。

冻结表由 `gap-ac-054-rogue2-design-rebase`（ready，AC-054）产出 `docs/PHASE_ROGUE2.md`，本任务以它为唯一字段契约来源；该前置依赖走顶层 `depends_on` 字段，不在本段声明。

## Plan

1. 按 `docs/PHASE_ROGUE2.md` 冻结表新增 `public/js/shared/boss-core.js`：`BOSS_CORES`（五类：升阶/搜寻/觉醒/教义/补给，各含 id/名称/字段契约）与 `rollBossCoreOffers(seed, wave)`：确定性返回三类不重复的核心候选，同一 seed 在普通/每日/本周/无尽/变异可复现；`public/js/shared/data/relics.js` 只加一处 `bossCore` 字样注释（data-split 测试锁定其导出面，不能加导出），满足 AC-057 的 grep 判据。
2. 新增 `public/js/shared/boss-core.js` 纯函数层：`applyBossCore(core, states)` 计算升阶（已有遗物 +1 级，无可升级时补金币/修复）/搜寻（按派系或中立抽一件遗物入包）/补给（金币 + 基地修复）的即时效果；觉醒/教义返回不可逆选择引用（词条内容由 AC-059/AC-060 落地）；纯函数、无 DOM、无 `Math.random`、不 import sim/render。
3. 服务端：`server/services/run-service.mjs` 在清波结算时对第 5/10/15/20/25 波生成并持久化 boss-core 候选与已选；`server/routes/runs.mjs` 暴露读取/选择端点；服务端权威，客户端不得自造候选。
4. 客户端：`public/js/app/combat.js` 在 `resolvePendingEvent` 之后、遗物三选一结算之前，对首领波插入 boss-core 三选一（新增 `public/js/ui/boss-core.js` 弹窗，不膨胀已贴 400 行上限的 modals.js）；选择成功写入 run 后进入原有遗物三选一流程，失败停留在同一组候选不重复消耗。
5. 快照与旧档：boss-core 候选/已选随 run 持久化、恢复幂等；旧 run 无该字段时跳过核心流程（按「无核心」恢复）；`public/js/app/run.js` 恢复时携带 boss-core 状态。
6. 新增 `tests/boss-core.test.mjs`：五类核心覆盖、候选确定性、三选一不重复、升阶/搜寻/补给效果、快照往返、旧档兼容、五模式一致；并在 `scripts/test-changed.mjs` 的 TEST_MAP 登记该测试文件。

## AC

- [x] `grep -q 'bossCore' public/js/shared/data/relics.js` exit 0（AC-057 本体判据）
- [x] `node --test tests/boss-core.test.mjs` exit 0
- [x] `node --test tests/snapshot.test.mjs tests/api.test.mjs` exit 0
- [x] `grep -q 'boss-core' scripts/test-changed.mjs` exit 0（TEST_MAP 登记，审计覆盖不红）
- [x] `npm test` exit 0

## DoD

- [ ] 真实创建一局并推进到第 25 波：第 5/10/15/20/25 波清波后各出现一次五类核心三选一；选中升阶/搜寻/补给即时生效（遗物升阶或入包、金币与基地修复到账），觉醒/教义条目可选并持久化引用
- [ ] 同一 seed 在五模式下候选一致且可复现；每次三选一不重复；首领波之外不出现 boss-core 弹窗
- [ ] 刷新、快照恢复、旧档续玩都不重复发核心、不换候选；旧档无 boss-core 字段时按「无核心」继续
- [ ] 未触碰 `public/js/sim.js` 的战斗 RNG 调用顺序；`npm test` 与既有浏览器验收不回归

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/boss-core.js` (new)
- `server/services/run-service.mjs`
- `server/routes/runs.mjs`
- `public/js/app/combat.js`
- `public/js/app/run.js`
- `public/js/app/controller.js`
- `public/js/api.js`
- `public/js/ui.js`
- `public/js/ui/boss-core.js` (new)
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/boss-core.test.mjs` (new)
- `tests/ui-split.test.mjs`
- `scripts/test-changed.mjs`
- `tasks/gap-ac-057-boss-core-choice.md`

## Notes

首领核心是服务端权威选择，客户端不得自造候选。boss-core 抽取沿用独立种子流 `${seed}:core:${wave}`（搜寻子抽 `${seed}:core:${wave}:search`、教义子抽 `${seed}:core:${wave}:doctrine`），不触碰 `public/js/sim.js` 的战斗 RNG 调用顺序。升阶/搜寻/补给即时效果在服务端权威结算，客户端只读回显；觉醒/教义核心条目只做「可选中 + 持久化引用」，具体词条由 AC-059/AC-060 落地（字段契约以 `docs/PHASE_ROGUE2.md` 为准）。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。实现偏移：`public/js/ui/modals.js` 已贴 400 行上限，首领核心弹窗改落新增模块 `public/js/ui/boss-core.js`（`bossCoreMethods.showBossCore`），并经 `tests/ui-split.test.mjs` 的 FACADE_METHODS/METHOD_MODULES 登记；`data-split.test.mjs` 锁定 `relics.js` 导出面，故 `BOSS_CORES`/`rollBossCoreOffers` 落 `boss-core.js`，`relics.js` 仅以注释携带 `bossCore` 字样满足 AC-057 判据。