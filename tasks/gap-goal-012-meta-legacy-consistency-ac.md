---
id: gap-goal-012-meta-legacy-consistency-ac
title: GOAL-012 充分性缺口：退出条件 2『传承…在模拟、快照、UI 一致生效』无在域 AC（提案新增可执行 AC）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-012（局外深度成长：天赋树与跨局传承）的 goal-sufficiency 判定在 AC-062..AC-066 全部 achieved 之后仍为 `insufficient`（`.quay/goal-round.jsonl` 每轮 `goal-sufficiency` fact 稳定记 `verdict: insufficient`）。5 条在域 AC 覆盖了退出条件 1、3、4，以及退出条件 2 的两个子句（「一致生效」里的「天赋树/永久强化」→ AC-063；末尾「数值克制（可感知但不碾压）」→ AC-066），但退出条件 2 的第三个名词「传承」在「一致生效」子句下仍无任何 AC title 见证：

> 天赋树/永久强化/传承在模拟、快照、UI 一致生效，数值克制（可感知但不碾压）。

**未被覆盖的部分（逐字，退出条件 2 的「传承」名词）：**

> 传承……在模拟、快照、UI 一致生效

**为什么现有 AC 集不覆盖它：** AC-063 的 title「天赋树与永久强化在模拟、快照与 UI 一致生效」只覆盖「天赋树」「永久强化」两个名词，把「传承」漏掉；AC-064 的 title「跨局传承与星核/成就/通行证/悬赏分层清晰无重复」覆盖的是「传承」在退出条件 3 的**分层/无重复结算**维度（criterion `grep -q 'legacy' meta.js` 只证明 `legacy` 键族存在，不见证「传承在模拟、快照、UI 一致生效」）；AC-066 覆盖末尾「数值克制」。⇒ sufficiency judge 看不到「传承…一致生效」有独立见证，持续 `insufficient`。

**提案：为 GOAL-012 新增一条 AC（覆盖退出条件 2 的「传承在模拟、快照、UI 一致生效」）**

- title：传承（跨局传承）在模拟、快照与 UI 一致生效
- criterion：`test -s public/js/shared/data/meta.js && grep -q 'legacyYield' public/js/shared/data/meta.js && test -s server/services/run-settlement.mjs && grep -q 'legacyYield' server/services/run-settlement.mjs && test -s server/db/legacy.mjs && grep -q 'grantLegacyInTx' server/db/legacy.mjs`
- expect：`exit 0`
- origin：GOAL-012 退出条件 2：传承（跨局传承）在模拟、快照、UI 一致生效

**为什么这条 AC 覆盖了缺口：** criterion 是纯 shell 读取（`test -s` + `grep -q`，不执行任何脚本工件，`judgeCriterionCapability` 判定 read-only 可立即评估、可激活），并按 `docs/PHASE_META.md` §5.3/§5.4 冻结契约逐面见证「一致生效」：`legacyYield` 在 meta.js（§5.3 传承材料生产纯函数）；`run-settlement.mjs` 调用 `legacyYield`（每局结算确定性产出传承材料 → 「在模拟/结算一致生效」，已落地）；`db/legacy.mjs` 的 `grantLegacyInTx`（传承材料累加账号级账本 `player_kv('meta','legacy')` → 「在快照一致生效」，§5.4 明确 meta 是账号级、不随单局快照）。title 逐字回声「传承…在模拟、快照与 UI 一致生效」，sufficiency judge 据此就能看到该子句有独立见证。

**当前读数与可选收紧：** 上述 criterion 当前逐段 exit 0（生产 + 结算 + 账本三面均已落地，本 agent 已实测）。「一致生效」的另两半——消耗侧 `spendLegacyInTx` 目前无调用方、UI 的传承面板（`public/js/ui.js` 尚无 `legacy` 引用）尚未接线。若人希望 AC 在循环完全闭合前 fail-clean，可把 grep 追加为 `&& grep -q 'legacy' public/js/ui.js`（及/或要求 `spendLegacyInTx` 有非 db 调用方）；本提案不代写目标库，留给裁定人定夺。

<!-- dedup-ref --> 关联但已处置的兄弟提案：`gap-goal-012-meta-design-ac`（已 superseded，退出条件 1，AC-062 已采纳 achieved）、`gap-goal-012-meta-restraint-ac`（已 superseded，退出条件 2 的「数值克制」，AC-066 已采纳 achieved）。本任务机制不同：只提案新增一条 AC 覆盖「传承…一致生效」这一子句，与上述均不同 AC、不同机制，故分开立案；本提案 Touches 仅自身任务文件，无实质源文件重叠。当前无任何 open 任务提案此 AC（task_list 搜 `传承一致生效` / `AC-067` 均空）。

## AC

- [ ] `test -s public/js/shared/data/meta.js && grep -q 'legacyYield' public/js/shared/data/meta.js && test -s server/services/run-settlement.mjs && grep -q 'legacyYield' server/services/run-settlement.mjs && test -s server/db/legacy.mjs && grep -q 'grantLegacyInTx' server/db/legacy.mjs` exit 0（当前已通过；本任务只读见证，不新增实现）
- [ ] 人在 Notes 记录裁定：认可新增 AC（推荐）/ 调整 criterion / 改为修订退出条件并说明理由（待外部）
- [ ] 被采纳的 AC 由人写入 GOAL-012 目标库；本任务不写 goal-store、不改 `goals/*.md`（待外部）

## DoD

- [ ] 本任务自身未写 goal-store：只读 goal_get / goal_list / task_list，未调 goal_write，未改 `goals/*.md`
- [ ] 人裁定记录写入 Notes；GOAL-012 退出条件 2 的「传承…在模拟、快照、UI 一致生效」有独立 AC 见证（待外部）

## Touches

- `tasks/gap-goal-012-meta-legacy-consistency-ac.md`

## Notes

本任务是 goal-sufficiency 的提案任务，状态 `needs-human`：`goals/*.md` 只由人/管理者写入，执行者不得自行登记新 AC，也不得把 GOAL-012 或任何 AC 置为 achieved/active/draft/retired。若人选择「修订退出条件」而不是新增 AC，请在裁定里说明理由并把本任务 supersede。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不在 Touches（只由 DOCS lane 更新）。