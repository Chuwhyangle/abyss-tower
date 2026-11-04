---
id: gap-goal-014-analytics-script-ac
title: GOAL-014 充分性缺口：退出条件 1「分析脚本落地」无在域 AC（AC-072 草稿 criterion 指向未落地测试文件，提案新增可执行读数 AC）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-014（真人游玩分析闭环：report/check 双模式 + human-vs-bot 洞察）的 goal-sufficiency 判定持续 `insufficient`，机械层给出的直接原因是「在域 AC 为 0」。退出条件原文逐字为：

> - AC-072 分析脚本落地：`node --test tests/play-analytics.test.mjs` exit 0。
> - AC-073 human-vs-bot 洞察可评估：`node scripts/play-analytics.mjs check human-vs-bot` exit 0（样本不足时按 floor exit 0，超阈值才红）。

**未被覆盖的部分（逐字，退出条件第 1 条）：**

> AC-072 分析脚本落地：`node --test tests/play-analytics.test.mjs` exit 0。

**为什么现有 AC 集不覆盖它：** AC-072 与 AC-073 均 `status=draft`。goal-driver 每轮尝试把二者翻到 `active` 都 `ok:false`，reason 一致为 `criterion-capability-unevaluable … uncertifiable-executed-artifact`：AC-072 的 criterion 指向 `tests/play-analytics.test.mjs`、AC-073 指向 `scripts/play-analytics.mjs`，两个产物在 criterion cwd 下都不 resolve（本立案时实测 `ls scripts/play-analytics.mjs tests/play-analytics.test.mjs` → 均 absent）。实现任务 `feat-play-analytics`（`ready`）的 worker 曾 `exited-not-landed`（step=suite，AssertionError），两文件从未落地。⇒ 这两条 AC 永远出不了 `draft`、永远不构成在域见证，GOAL-014 永远 0 在域 AC、永远 `insufficient`。

**提案：为 GOAL-014 新增一条 AC（覆盖退出条件第 1 条「分析脚本落地」）**

- title：真人游玩分析脚本落地（scripts/play-analytics.mjs 与 tests/play-analytics.test.mjs 均已落地且非空）
- criterion：`test -s scripts/play-analytics.mjs && test -s tests/play-analytics.test.mjs`
- expect：`exit 0`
- origin：GOAL-014 退出条件第 1 条：分析脚本落地。

**为什么这条 AC 覆盖了缺口：** criterion 是纯 shell 读数（`test -s` 断言两个产物文件存在且非空），零副作用、不执行任何脚本工件，`judgeCriterionCapability` 判定 read-only 可立即评估、可激活，不会重蹈 AC-072 的 `uncertifiable-executed-artifact`。文件缺席时返回 exit 1 = 普通「未达成」（红，非 unevaluable）；`feat-play-analytics` 落地两文件后转 exit 0 = 达成。它把「脚本落地」这一退出条件收进一条可评估的在域 AC，使 GOAL-014 的在域 AC 集非空。`node --test … exit 0` 的运行时证明仍由实现任务 `feat-play-analytics` 的 acceptance gate 承载（那里允许副作用执行），不该由 goal-driver 的自动读数求值。本立案时实跑该 criterion：exit 1（两文件缺席，符合预期）。

**本 AC 不覆盖的部分（明说）：** 退出条件第 2 条（AC-073 human-vs-bot 洞察可评估）与第 1 条同根因——其 criterion `node scripts/play-analytics.mjs check human-vs-bot` 同样是 `uncertifiable-executed-artifact`（指向未落地脚本），需以同样方式换成读数判据（例如 `test -s scripts/play-analytics.mjs && grep -q "human-vs-bot" scripts/play-analytics.mjs`）。按「一次只提一条 AC」规则，本提案只处理第 1 条（最前置的脚本落地，第 2 条的 check 模式依赖它）。

<!-- dedup-ref --> 关联但不同机制：`feat-play-analytics`（`ready`，goal_ac 未挂）是「落地分析脚本」的实现任务；本任务是「给 GOAL-014 补一条可评估读数 AC 覆盖退出条件 1」的 goal-AC-set 提案，不写代码、不写 goal store，只提案 AC 集变更，机制与文件均不同，判 separate。合并候选检查：本提案 Touches 仅自身 `tasks/*.md`，`task-granularity-advice` 报 peers=[]、mentions=[]。立案前检查：`task_list` 搜 `GOAL-014` / `AC-072` / `AC-073` / `play-analytics` 仅命中 `feat-play-analytics`，无任何 open 任务提出过 GOAL-014 的 AC/退出条件变更提案。

## AC

- [ ] 读数判据活性：仓库根实跑 `test -s scripts/play-analytics.mjs && test -s tests/play-analytics.test.mjs` → exit 1（两文件缺席），且 `ls scripts/play-analytics.mjs tests/play-analytics.test.mjs` 均 absent
- [ ] 人在 Notes 记录裁定：认可新增 AC（推荐）/ 调整 criterion / 改为修订退出条件并说明理由（待外部）
- [ ] 被采纳的 AC 由人写入 GOAL-014 目标库；本任务不写 goal-store、不改 `goals/*.md`（待外部）

## DoD

- [ ] 判据是读数不是预判：`test -s` 对缺席文件 exit 1（本立案已实测），落地后 exit 0 的口径在 Proposal 写清
- [ ] 缺口边界说清：Proposal 明写本 AC 只承担退出条件第 1 条，第 2 条（AC-073 human-vs-bot）同根因另立提案；不声称本提案让 GOAL-014 立刻 `covered`
- [ ] 本任务自身未写 goal-store：只读 goal_get / goal_list / task_list，未调 goal_write，未改 `goals/*.md`
- [ ] 人裁定记录写入 Notes；GOAL-014 退出条件第 1 条有独立读数 AC 见证，在域 AC 集不再为空（待外部）

## Touches

- `tasks/gap-goal-014-analytics-script-ac.md`

## Notes

本任务是 goal-sufficiency 的提案任务，状态 `needs-human`：`goals/*.md` 只由人/管理者写入，执行者不得自行登记新 AC，也不得把 GOAL-014 或任何 AC 置为 achieved/active/draft/retired。若人选择「修订退出条件」而不是新增 AC，请在裁定里说明理由并把本任务 supersede。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不在 Touches（只由 DOCS lane 更新）。