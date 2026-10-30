---
id: gap-ac-058-contract-card
title: 契约卡：第 9/14/19/24 波替换一张遗物卡每局最多两次在五模式确定性可复现（AC-058）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-054-rogue2-design-rebase
  - gap-ac-055-factions-points
goal_ac: AC-058
---
## Proposal

AC-058（契约卡：第 9/14/19/24 波替换一张遗物卡，每局最多两次）已由 goal-driver 激活，criterion 为 `grep -q 'contract' public/js/shared/data/relics.js`（expect exit 0），当前 exit 1：`relics.js` 无 `contract` 字样，三选一只有 relic/gold/repair，没有契约卡。origin（GOAL-011 退出条件 4）要求第 9/14/19/24 波用 1 张契约卡替换三选一里的 1 张遗物卡，同一弹窗、仍是 3 张，每局最多接受 2 次；红线是只改客户端可模拟资源，绝不改敌人 HP/速度/入口。本任务只做契约卡，不碰派系阈值/首领核心/教义/觉醒（AC-055..057 与 AC-059..061 各自认领）。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-058` 认领（task_list + grep 已核）。同机制前任 `gap-contracts`（goal_ac AC-036）已于 2026-10-27 被人在 Notes 撤销（superseded，等待重新设计），本任务把它重基到 GOAL-011 的 AC-058。与 `gap-ac-055-factions-points`（ready，AC-055）、`gap-ac-057-boss-core-choice`（ready，AC-057）的边界：派系 `bonusPoints` 覆盖层与 `recomputeFactions()` 由 AC-055 提供，本任务只写入 `bonusPoints`（单派系 ≤ +3）并触发重算；契约只替换普通三选一，不进入首领核心槽位；三者 Touches 在 relics.js/modals.js/i18n 重叠，调度器按 Touches 串行，保持独立（各自 goal_ac 与独立验收，不合并）。合并候选已跑 task-granularity-advice：peers 即同族 gap-ac-055/056/057 与 i18n-only 的 AC-050/051/063/064，均为独立机制、独立验收，不合并。冻结表由 `gap-ac-054-rogue2-design-rebase`（done，AC-054）产出 `docs/PHASE_ROGUE2.md`；真前置（bonusPoints 覆盖层）走顶层 `depends_on` 字段，不在本段声明。

## Plan

1. 按 `docs/PHASE_ROGUE2.md` §5 在 `public/js/shared/data/relics.js` 新增契约卡数据：`CONTRACT_IDS = ['blood','debt','poverty','sloth','burn']` 与五条契约定义（id/nameKey/cost/benefit/chip.scope，§5.2）；函数名与数据结构带 `contract`，满足 AC-058 判据。
2. 新增 `public/js/shared/contracts.js`：`rollContractOffer(seedKey, wave, state)`（仅 `wave % 5 === 4 && wave >= 9` 返回非 null，达到每局 2 次上限返回 null）与 `applyContract(state, contractId)`（返回 `{ state, event }`，代价先于收益结算，代价不成立时整卡不可用）；纯函数、无 DOM、无 `Math.random`、不 import sim/render；§8.1 的 `CONTRACT_IDS`/`rollContractOffer`/`applyContract` 导出名逐符号对齐。
3. 服务端 `server/services/run-service.mjs`：第 9/14/19/24 波把 1 张遗物卡替换为契约卡写入既有 offers 槽位，已接受契约数持久化并粗校验 ≤ 2；`server/routes/runs.mjs` 暴露选择端点；服务端权威，客户端不得自造候选。
4. 客户端 `public/js/app/combat.js` 应用代价/收益（最大生命与当前生命、当前金币、刷新次数、下一波卡数、下一波塔攻速、`bonusPoints`、焚毁 1 件未满级遗物），全部走客户端可模拟资源；写入 `sim.rogue2.contracts` 并触发 `recomputeFactions()`；`public/js/sim.js` / `public/js/sim/relic-system.js` 落焚毁与塔攻速副作用，不触碰战斗 RNG 调用顺序。
5. UI：`public/js/ui/modals.js` 契约卡样式与「本波/本局」标注；`public/js/ui/hud.js` 常驻 chip（scope wave/run）；i18n 中英成对新增键；选择后不可撤销。
6. 快照 v5（`public/js/app/run.js` 恢复）：`rogue2.contracts` 与 `bonusPoints` 入快照；旧档无契约字段按空处理、恢复幂等。
7. 新增 `tests/contracts.test.mjs`：四个波次、替换规则、刷新整组丢弃、每局上限 2、五条代价/收益、绝不改敌人 HP/速度/入口（同 seed 对比）、快照往返、五模式一致；并在 `scripts/test-changed.mjs` 的 TEST_MAP 登记该测试文件。

## AC

- [x] `grep -q 'contract' public/js/shared/data/relics.js` exit 0（AC-058 本体判据）
- [x] `node --test tests/contracts.test.mjs` exit 0
- [x] `node --test tests/relics-depth.test.mjs tests/run-lifecycle.test.mjs` exit 0
- [x] `node --test tests/snapshot.test.mjs tests/api.test.mjs` exit 0
- [x] `grep -q 'contracts' scripts/test-changed.mjs` exit 0（TEST_MAP 登记，审计覆盖不红）
- [x] `npm test` exit 0

## DoD

- [ ] 真实跑到第 9/14/19/24 波：三选一里恰有一张契约卡、同一弹窗仍 3 张，刷新后契约卡随整组消失
- [ ] 接受一条契约后代价与收益立即生效，并在 HUD 留下标注「本波/本局」的 chip
- [ ] 每局最多接受 2 次；达到上限后 `rollContractOffer` 返回 null、不再出现契约卡
- [ ] 契约只改客户端可模拟资源，同一 seed 下敌人 HP/速度/入口与不接受契约时完全一致
- [ ] 快照恢复、旧档续玩都不重复发契约、不重置已接受次数；五模式（普通/每日/本周/无尽/变异）可用且确定性可复现

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/contracts.js` (new)
- `public/js/shared/snapshot.js`
- `server/services/run-service.mjs`
- `server/routes/runs.mjs`
- `public/js/sim.js`
- `public/js/sim/relic-system.js`
- `public/js/app/combat.js`
- `public/js/app/run.js`
- `public/js/ui/modals.js`
- `public/js/ui/hud.js`
- `public/js/ui/shared.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/contracts.test.mjs` (new)
- `tests/sim-systems.test.mjs`
- `tests/ui-split.test.mjs`
- `scripts/test-changed.mjs`
- `scripts/structure-budget.allow.d/gap-ac-058-contract-card.json` (new)
- `tasks/gap-ac-058-contract-card.md`

## Notes

契约卡是服务端权威选择，客户端不得自造候选。契约抽取沿用独立种子流 `${seed}:contract:${wave}`，不触碰 `public/js/sim.js` 的战斗 RNG 调用顺序。`bonusPoints` 单派系上限 +3、只由契约卡写入，UI 与遗物点数分色显示（以 `docs/PHASE_ROGUE2.md` §2.2 为准）；`bonusPoints` 变更必须触发 `recomputeFactions()`。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。

实现补充：契约卡结算主体落在 `public/js/sim/relic-system.js`（`applyContract` 方法），`sim.js` 只保留一行委派，避免 sim.js 越 650 行债务上限。`server/services/run-service.mjs` 因契约分支超 600 行预算，按结构预算门禁登记债务 `scripts/structure-budget.allow.d/gap-ac-058-contract-card.json`（maxLines 680）。契约卡 UI 文案渲染抽到 `public/js/ui/shared.js` 的 `contractCardHtml`，`modals.js` 保持 < 400 行。`tests/sim-systems.test.mjs` / `tests/ui-split.test.mjs` 因新增导出面（`Simulation.prototype.applyContract` / `shared.js` 的 `contractCardHtml`）同步更新基线。