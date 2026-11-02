---
id: gap-goal-012-meta-restraint-ac
title: GOAL-012 充分性缺口：退出条件 2『数值克制（可感知但不碾压）』无在域 AC（提案新增可执行 AC）
status: superseded
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-012（局外深度成长：天赋树与跨局传承）的 goal-sufficiency 判定在 AC-062 已 achieved、AC-063/064/065 已 active 之后仍为 `insufficient`（`.quay/goal-round.jsonl` 第 14 轮 `goal-sufficiency` fact：`sufficiency=insufficient（在域 AC 4 条）`）。4 条在域 AC 与 4 条退出条件名义上 1:1，但退出条件第 2 条的一个子句没有任何 AC title/criterion 见证：

> 天赋树/永久强化/传承在模拟、快照、UI 一致生效，数值克制（可感知但不碾压）。

**未被覆盖的部分（逐字，退出条件第 2 条末尾子句）：**

> 数值克制（可感知但不碾压）

**为什么现有 AC 集不覆盖它：** AC-063（天赋树与永久强化在模拟、快照与 UI 一致生效）只覆盖「一致生效」半句，其 criterion `test -s public/js/shared/data/meta.js && grep -q 'talent' public/js/shared/data/meta.js` 只断言 `talent` 键族存在，不含任何上限/克制 grep；AC-065（平衡复测、全量测试与确定性不回归）覆盖的是退出条件第 4 条（三档通关率 + npm test + 确定性），不是 meta 增益自身的克制幅度。设计正本 `docs/PHASE_META.md` §4.1 已冻结克制口径（单项 ≤ +8%、累计 ≤ +24%、难度倍率斜率 0.85/1.10/1.34），§5.2 已冻结 `TALENT_NODES` 节点的 `maxRank`（投入上限）字段——但这些冻结值没有任何 AC title 或 criterion 见证；§6 的 AC 映射甚至把退出条件 2 写成「…一致生效，数值克制」（去掉了「（可感知但不碾压）」）并只映射到 AC-063，而 AC-063 的判据不含克制。⇒ sufficiency judge（按 AC title 对退出条件子句）看不到「数值克制」被覆盖，故持续 `insufficient`。

**提案：为 GOAL-012 新增一条 AC（覆盖退出条件第 2 条的「数值克制（可感知但不碾压）」子句）**

- title：meta 增益数值克制：可感知但不碾压（单项 ≤ +8%、累计 ≤ +24%）
- criterion：`test -s public/js/shared/data/meta.js && grep -q 'maxRank' public/js/shared/data/meta.js`
- expect：`exit 0`
- origin：GOAL-012 退出条件 2：数值克制（可感知但不碾压）

**为什么这条 AC 覆盖了缺口：** criterion 是纯 shell 读取（`test -s` + `grep -q`，不引用任何需先存在的脚本/测试文件），在 meta.js 落盘前干净 FAIL（合法的「未完成」态），落盘后 exit 0；`maxRank` 是 §5.2 冻结的节点投入上限字段，是「克制」在实现里的机械编码。title 逐字回声「数值克制（可感知但不碾压）」并带上 §4.1 冻结的幅度，sufficiency judge 据此就能看到该子句有独立见证。若人希望把幅度常量也编码进判据，可把 grep 追加为 `grep -qE '0\.08|0\.24'`——本提案不代写目标库，留给裁定人定夺。

<!-- dedup-ref --> 关联但不同机制的已有任务：`gap-goal-012-meta-design-ac`（needs-human）是「退出条件 1 无在域 AC、4 条草稿 AC 引用已删脚本」的提案，其修口（AC-062）已落地为 achieved；`gap-ac-063-meta-talent-tree` / `gap-ac-064-meta-legacy`（均 ready，goal_ac=AC-063/AC-064）是执行 AC-063/064 的实现任务，不新增 goal-store AC。本任务机制不同：只提案新增一条 AC，覆盖退出条件 2 的「数值克制」子句，与上述均不同 AC、不同机制，故分开立案；本提案 Touches 仅自身，无实质源文件重叠。

**本提案不覆盖的部分（明说）：** 退出条件 2 的「传承…一致生效」与范围节第 5 条「UI/快照/i18n/旧档兼容接入」里的 i18n/旧档兼容同样没有独立 AC title 见证；本提案只处理「数值克制（可感知但不碾压）」这一子句（按一次一个缺口纪律），其余留给后续 sufficiency 判定或另案。

## AC

- [ ] `test -s public/js/shared/data/meta.js && grep -q 'maxRank' public/js/shared/data/meta.js` exit 0（meta.js 落盘后；立案时 meta.js MISSING，属预期）
- [ ] 人在 Notes 记录裁定：认可新增 AC（推荐）/ 调整 criterion / 改为修订退出条件并说明理由（待外部）
- [ ] 被采纳的 AC 由人写入 GOAL-012 目标库；本任务不写 goal-store、不改 `goals/*.md`（待外部）

## DoD

- [ ] 本任务自身未写 goal-store：只读 goal_get / goal_list / task_list，未调 goal_write，未改 `goals/*.md`
- [ ] 人裁定记录写入 Notes；GOAL-012 退出条件 2 的「数值克制（可感知但不碾压）」有独立 AC 见证（待外部）

## Touches

- `tasks/gap-goal-012-meta-restraint-ac.md`

## Notes

本任务是 goal-sufficiency 的提案任务，状态 `needs-human`：`goals/*.md` 只由人/管理者写入，执行者不得自行登记新 AC，也不得把 GOAL-012 或任何 AC 置为 achieved/active/draft/retired。若人选择「修订退出条件」而不是新增 AC，请在裁定里说明理由并把本任务 supersede。