---
id: gap-docs-todo-planned-block-missing
title: docs/TODO.md TODO-13 计划路径缺 planned 块标记，check:docs 判红（AC-005 全量测试 exit 1）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-005
---
## Proposal

AC-005 的 criterion 是 `node --test --test-concurrency=2 tests/*.test.mjs`、expect `exit 0`。2026-11-04 按原命令重跑：`# tests 1962 / # pass 1961 / # fail 1`，exit 1 —— 该条件当前为假。

**失败点（唯一稳定复现）**

- `tests/docs-consistency.test.mjs:345`「真实仓库文档一致：check:docs 的判定为通过」→ `not ok 395`
- 断言消息列出 6 条「代码路径不存在」，全部落在 `docs/TODO.md:224-226`：`tests/lib/scenario.mjs`、`tests/lib/assertions.mjs`（224 行）、`tests/lib/axes.mjs`、`tests/lib/seams.mjs`、`scripts/test-matrix.mjs`（225 行）、`docs/TESTING.md`（226 行）。

**根因**

1. commit `6affb1c`（chore: 立案测试体系 TODO-13 + 地基任务）在 `docs/TODO.md` 新增 TODO-13 章节，用反引号写出 6 个「将要在后续三连任务里创建」的路径，但这些产物当前并不存在。
2. `scripts/docs-consistency.mjs`（`npm run check:docs`）第 2 类判定要求反引号里的仓库路径真实存在，于是全量 suite 的 docs-consistency 用例变红。
3. 仓库已有既定豁免机制：`<!-- docs-consistency:planned-start -->` … `<!-- docs-consistency:planned-end -->` 块只豁免「代码路径存在性」（块内相对链接与 npm 脚本照旧校验），`docs/TODO.md:135-137` 已有一处先例。TODO-13 章节漏打了这个标记。

**为什么上一轮没有守住**

上一轮 AC-005 的 `gap-ac-005-full-suite-reverify*` 是只读见证任务，验收是「在当时的 HEAD 上全量 suite exit 0」这一时点测量，不含对未来文档回归的防护；`6affb1c`（2026-11-04）在之后把 TODO-13 计划路径写进 `docs/TODO.md` 却未加 planned 标记，打破了该不变量。所以「曾经绿过」不再蕴含「现在绿」，必须新立一条任务把条件重新变真。

**修复方案**

把 `docs/TODO.md` TODO-13「方案（三连任务，串行）」三条（224-226 行）包进 `<!-- docs-consistency:planned-start -->` … `<!-- docs-consistency:planned-end -->` 块（与 135-137 行先例一致）。块内只豁免代码路径存在性；这些路径确属计划态产物，随地基/分类法/迁移示范任务逐个落地。不整篇 `ignore-file`、不逐行 `ignore`，也不删计划路径。

<!-- dedup-ref --> 关联但不同机制：`test-scenario-harness`（ready）会在落地时创建其中 `tests/lib/scenario.mjs`、`tests/lib/assertions.mjs`，但它在 Touches 只声明 3 个新测试文件、不声明 `docs/TODO.md`；且 `axes.mjs`/`seams.mjs`/`test-matrix.mjs`/`docs/TESTING.md` 要到后续两连任务才落地，靠它无法让 check:docs 立即转绿。合并候选检查：`docs/TODO.md` 无任何 open 任务声明进 Touches（`test-scenario-harness` 仅在 Notes 里提及），故单独立案、不合并。

## Touches

- `docs/TODO.md`
- `tasks/gap-docs-todo-planned-block-missing.md`

## Acceptance Criteria

- [ ] `grep -n "docs-consistency:planned-start" docs/TODO.md` 命中新增起始标记，且 TODO-13「方案」三条（含 6 个计划路径）落在该块与 `docs-consistency:planned-end` 之间
- [ ] `npm run check:docs` exit 0（`scripts/docs-consistency.mjs` 判定通过）
- [ ] `node --test tests/docs-consistency.test.mjs` exit 0（「真实仓库文档一致」用例绿）
- [ ] `node --test --test-concurrency=2 tests/*.test.mjs` exit 0（即 AC-005 的 criterion 本身）

## Definition of Done

- [ ] `docs/TODO.md` 用 `docs-consistency:planned-start/end` 块标记 TODO-13 计划路径（块内只豁免代码路径存在性，链接与 npm 脚本照旧校验，不整篇 ignore、不逐行 ignore）
- [ ] 在改动所在 HEAD 上连续两次 `node --test --test-concurrency=2 tests/*.test.mjs` 均为 exit 0（不靠重跑掩盖偶发失败）
- [ ] `git diff --name-only <base>..HEAD` 只含 `docs/TODO.md` + `tasks/gap-docs-todo-planned-block-missing.md`（self-touch）

## Notes

- 复现与判定命令均以仓库根为 cwd；AC-005 的 criterion 与 `package.json` 的 `scripts.test` 逐字一致。
- 方向是「补 planned 块标记」而不是「删掉计划路径」或「提前创建产物」：这些路径是 TODO-13 三连任务（地基 → 分类法 → 迁移示范）的既定交付物，属于计划态，planned 块正是为「计划正本写出将要在 X 创建 Y」而设。
- 若 worker 实际 Touches 有出入（例如需要同时微调 `tests/docs-consistency.test.mjs` 加固），须 task_write 修正 Touches 再 fan-in。