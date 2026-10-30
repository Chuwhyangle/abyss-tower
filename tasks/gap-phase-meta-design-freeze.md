---
id: gap-phase-meta-design-freeze
title: 设计定稿：产出 PHASE_META 冻结表（机制/数值/字段契约/AC 映射）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-062
---
## Proposal

AC-062（GOAL-012 退出条件 1，已 active）的判据要求产出设计正本 `docs/PHASE_META.md`：非空文件、含「字段契约」「AC 映射」两节、正文含 `GOAL-012` 字样。当前该文件 MISSING（`ls docs/PHASE_META.md` → No such file or directory），AC-062 判据 exit 1。本任务把这份冻结表写出来，作为后续 AC-063（`talent`）、AC-064（`legacy`）实现任务与 AC-065 平衡复测的唯一设计基准。

<!-- dedup-ref --> 先导任务 `gap-goal-012-meta-design-ac`（needs-human）是「提案新增可执行 AC」的提案任务，其机制是把 AC-062 的 criterion 从引用已删脚本改为纯 shell 读取；人已采纳并写入目标库（AC-062 现为 active）。本任务机制不同：执行该提案 Plan 第 2 步的「设计定稿实现」，直接产出冻结表，不重复提案。

冻结表四节（本文档 = 本阶段冻结表、字段契约与 AC 映射的唯一定义处，遵循 CLAUDE.md 第 5 条）：

- 机制：账号级天赋树（技能点投入塔/技能/经济的永久被动）、塔/技能永久强化（数值克制：可感知但不碾压）、跨局传承（每局结算按表现产出「传承材料」，与星核「以解锁为主」区分）。
- 数值：克制口径（增益幅度与难度倍率、平衡模拟兼容），不改战斗数值口径与 sim 确定性。
- 字段契约：定义 `public/js/shared/data/meta.js` 的字段契约（至少含 `talent` 与 `legacy` 两个键族，供 AC-063/064 的 grep 判据落点），以及快照/UI/旧档兼容字段。
- AC 映射：逐条映射 GOAL-012 退出条件 1–4 → AC-062（本文档自身）、AC-063（talent 一致生效）、AC-064（legacy 分层清晰）、AC-065（平衡复测不回归）。

⛔ 计划态路径（如 `public/js/shared/data/meta.js` 尚不存在）必须用 `docs-consistency:planned-start` / `docs-consistency:planned-end` 块包裹，否则 `npm test` 里 `docs-consistency.test.mjs` 的「真实仓库文档一致」会因缺失代码路径转红（与 `docs/PHASE_REFACTOR.md` 同款纪律）。

边界：不实现 `public/js/shared/data/meta.js`（属 AC-063/064）；不写 `goals/*.md`；不改 `docs/PRD.md`/`docs/TECH_DESIGN.md`（总文档只由 DOCS lane 更新）。

## AC

- [x] `test -s docs/PHASE_META.md && grep -q '字段契约' docs/PHASE_META.md && grep -q 'AC 映射' docs/PHASE_META.md && grep -q 'GOAL-012' docs/PHASE_META.md` exit 0
- [x] `node scripts/check-doc-ownership.mjs` exit 0
- [x] `npm test` exit 0

## DoD

- [x] `docs/PHASE_META.md` 是唯一冻结表：机制/数值/字段契约/AC 映射四节齐全，AC 映射含 `GOAL-012` 并逐条映射 AC-062..AC-065
- [x] `git diff --name-only` 仅含本任务 Touches 声明的文件（不含 `goals/`、`docs/PRD.md`、`docs/TECH_DESIGN.md`）
- [x] AC-062 criterion exit 0

## Touches

- `docs/PHASE_META.md` (new)
- `tasks/gap-phase-meta-design-freeze.md`