---
id: gap-goal-012-meta-design-ac
title: GOAL-012 充分性缺口：退出条件 1（设计定稿）无在域 AC，4 条草稿 AC 因引用已删脚本无法激活（提案新增可执行 AC）
status: superseded
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: test -s docs/PHASE_META.md && grep -q '字段契约' docs/PHASE_META.md &&
    grep -q 'AC 映射' docs/PHASE_META.md && grep -q 'GOAL-012' docs/PHASE_META.md
---
## Proposal

GOAL-012（局外深度成长：天赋树与跨局传承）的退出条件是合取式，共 4 条。goal-sufficiency 机械层判定 `insufficient` 的直接原因是「在域（active/achieved/needs-human）AC 为 0」——但这不是没人写 AC，而是 4 条草稿 AC 全部卡死在 `draft` 无法激活：

- AC-062..AC-065 的 criterion 全是 `node scripts/meta-accept.mjs <sub>`，而 `scripts/meta-accept.mjs` 在当前树中不存在（`ls scripts/meta-accept.mjs` → No such file or directory）。
- 证据：`.quay/goal-round.jsonl` 第 5 轮（2026-10-30T07:05:29Z）`flips` 里 goal-driver 逐条尝试把 AC-062..AC-065 翻到 `active`，4 条全部 `ok:false`，reason 一致为 `criterion-capability-unevaluable … uncertifiable-executed-artifact: scripts/meta-accept.mjs`。这与 GOAL-009 的 AC-047 同一失败模式：criterion 是「不可评估」而非「fail」，目标库拒绝对其激活。⇒ 这 4 条 AC 永远出不了 `draft`，GOAL-012 永远 0 在域 AC、永远 `insufficient`。

**未被覆盖的部分（逐字，退出条件第 1 条）：**

> `docs/PHASE_META.md` 定稿，字段契约与 AC 映射完整。

**为什么现有 AC 集不覆盖它：** 名义上 AC-062 负责这条，但其 criterion `node scripts/meta-accept.mjs design` 引用的是不存在的脚本，属 `criterion-capability-unevaluable`、无法激活，构不成在域见证；且该退出条件要求的产物 `docs/PHASE_META.md` 当前 MISSING（`ls docs/PHASE_META.md` → No such file or directory）。

**提案：为 GOAL-012 新增一条 AC（覆盖退出条件第 1 条）**

- title：设计定稿：PHASE_META 机制/数值/字段契约/AC 映射
- criterion：`test -s docs/PHASE_META.md && grep -q '字段契约' docs/PHASE_META.md && grep -q 'AC 映射' docs/PHASE_META.md && grep -q 'GOAL-012' docs/PHASE_META.md`
- expect：`exit 0`
- origin：GOAL-012 退出条件 1：先文档后开发，设计定稿成唯一冻结表。

**为什么这条 AC 覆盖了缺口：** criterion 是纯 shell「读取」判据（`test -s` / `grep -q`，不经过解释器执行任何脚本工件），实测 `judgeCriterionCapability` 返回 `read-only`（可立即评估、可激活），不像 `node scripts/meta-accept.mjs` 那样命中 `uncertifiable-executed-artifact`。它断言设计正本已定稿（非空文件）且含字段契约、AC 映射、GOAL-012 关联三要素——正是退出条件第 1 条逐字要求的产物。因为不引用任何需先存在的脚本/测试文件，它在 `docs/PHASE_META.md` 落盘前干净地 FAIL（合法的「未完成」态，而非「不可评估」），落盘后 exit 0。若人希望把范围节的「机制/数值」两柱也编码进判据，可把 grep 追加为 `grep -q '机制' && grep -q '数值'`（本提案不代写目标库，留给裁定人定夺）。

<!-- dedup-ref --> 关联但不同机制的兄弟任务：`gap-goal-011-rogue2-design-rebase-ac`（needs-human）是同一缺陷形态（8 条草稿 AC 引用已删 `scripts/rogue2-accept.mjs`）在 GOAL-011 上的实例；两者目标不同、AC 不同、机制实例不同，故分开立案。合并候选检查：`task-granularity-advice --root /data/home/wenhao/abyss-tower --touches docs/PHASE_META.md --touches tasks/gap-goal-012-meta-design-ac.md --json` 返回 peers=[]、mentions=[]。

**本 AC 不覆盖的部分（明说）：** 退出条件第 2–4 条（天赋树/永久强化/传承在模拟快照 UI 一致生效、与星核/成就/通行证/悬赏分层清晰无重复结算、平衡复测+全量测试确定性不回归）仍由 AC-063..AC-065 草稿覆盖，但它们的 criterion 同样指向不存在的 `scripts/meta-accept.mjs`，需以同样方式各自换成可执行的读取判据。本提案只处理第 1 条（最前置的冻结表，后续实现任务都以它为准）。

## Plan

1. 人先裁定本提案（见 DoD 最后一项）；执行者不得自行写目标库、不得把 GOAL-012 或任何 AC 置为 active/achieved/draft/retired。
2. 设计定稿实现（本提案被采纳后执行；本任务不代写 `docs/PRD.md`/`docs/TECH_DESIGN.md`，只产出冻结表，遵循 CLAUDE.md「先文档后开发」与文档所有权）：
   - 产出 `docs/PHASE_META.md` 作为唯一冻结表：天赋树/永久强化/跨局传承的机制、数值、字段契约、AC 映射；
   - AC 映射节逐条映射 GOAL-012 退出条件 1–4 与对应 AC id（含 `GOAL-012` 字样，满足 criterion 的 grep）。
3. 人把本提案的 criterion 写入 GOAL-012 的目标库（或由 goal-driver 下一轮按新 criterion 激活）；上述 shell 判据在 `docs/PHASE_META.md` 落盘后 exit 0。

## AC

- [ ] `test -s docs/PHASE_META.md && grep -q '字段契约' docs/PHASE_META.md && grep -q 'AC 映射' docs/PHASE_META.md && grep -q 'GOAL-012' docs/PHASE_META.md` exit 0（设计定稿落地后；立案时 `docs/PHASE_META.md` MISSING，属预期）
- [ ] `npm test` exit 0
- [ ] 人在 Notes 记录裁定：认可新增 AC（推荐）/ 调整 criterion / 改为修订退出条件并说明理由（待外部）
- [ ] 被采纳的 AC 由人写入 GOAL-012 目标库；本任务不写 goal-store、不改 `goals/*.md`（待外部）

## DoD

- [ ] `docs/PHASE_META.md` 是唯一冻结表：机制/数值/字段契约/AC 映射齐全，AC 映射含 GOAL-012 关联
- [ ] 本任务自身未写 goal-store：只读 goal_get / goal_list / task_list，未调 goal_write，未改 `goals/*.md`
- [ ] 人裁定记录写入 Notes，GOAL-012 的在域 AC 集不再为空（待外部）

## Touches

- `docs/PHASE_META.md` (new)
- `tasks/gap-goal-012-meta-design-ac.md`

## Notes

本任务是 goal-sufficiency 的提案任务，状态 `needs-human`：`goals/*.md` 只由人/管理者写入，执行者不得自行登记新 AC，也不得把 GOAL-012 或任何 AC 置为 achieved/active/draft/retired。遵循 CLAUDE.md：`docs/PRD.md`/`docs/TECH_DESIGN.md` 不在 Touches（只由 DOCS lane 更新）。若人选择「修订退出条件」而不是新增 AC，请在裁定里说明理由并把本任务 supersede。