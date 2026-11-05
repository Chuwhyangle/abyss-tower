---
id: gap-ac-005-docs-todo-pet-planned-block
title: docs/TODO.md 萌宠化转型 计划态路径缺 planned 块标记，check:docs 判红（AC-005 全量测试 exit 1）
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

AC-005（GOAL-001「上游基线合并与开发基线确认」退出条件：全量测试通过）criterion 逐字为 `node --test --test-concurrency=2 tests/*.test.mjs`、expect `exit 0`。2026-11-05 按原命令直接重跑：`# tests 2027 / # pass 2026 / # fail 1`，exit 1——该条件当前为假（本轮为直接测量，非陈旧台账尾巴）。

**失败点（唯一稳定复现）**
- `tests/docs-consistency.test.mjs:367`「真实仓库文档一致：check:docs 的判定为通过」→ `not ok 396`
- 断言列出 3 条「代码路径不存在」，全部落在 `docs/TODO.md` 的「萌宠化转型」章节：
  - `docs/TODO.md:337: 代码路径不存在 -> docs/PHASE_萌宠.md`
  - `docs/TODO.md:345: 代码路径不存在 -> public/js/shared/data/pets.js`
  - `docs/TODO.md:346: 代码路径不存在 -> docs/PHASE_萌宠.md`

**根因**
1. `docs/TODO.md` 新增「萌宠化转型（design，2026-11-05 用户拍板）」章节（当前工作树未提交的 `M docs/TODO.md`，+66 行），用反引号写出 3 处「将要在后续阶段创建」的路径：`docs/PHASE_萌宠.md`（L337「供 … 冻结」、L346「转 … 冻结表」）与 `public/js/shared/data/pets.js`（L345「新建 …」）。
2. `scripts/docs-consistency.mjs`（`npm run check:docs`）第 2 类判定要求反引号里的仓库路径真实存在，于是全量 suite 的 docs-consistency 用例变红。
3. 仓库已有既定豁免机制：`<!-- docs-consistency:planned-start -->` … `<!-- docs-consistency:planned-end -->` 块只豁免「代码路径存在性」（块内相对链接与 npm 脚本照旧校验），`docs/TODO.md:135-137` 已有先例。萌宠化转型章节漏打了这个标记。

**为什么上一轮没守住**
早前爬塔章节同机制问题已用 planned 块修绿（现 `docs/TODO.md:135-137` 即那次修复留下的标记）。萌宠化转型设计章节 2026-11-05 写入 `docs/TODO.md` 时，又把「计划态产物」用反引号写成「已存在路径」且漏加标记，重新打破「反引号路径必须存在」的不变量。所以「曾经绿过」不再蕴含「现在绿」，必须新立任务把条件重新变真。

**修复方案**
把 `docs/TODO.md` 萌宠化转型章节内含计划态路径的区段包进 planned 块（与 L135-137 既有先例一致）：在 `### 平衡红线草案（供 docs/PHASE_萌宠.md 冻结）`（L337）之前插入 `<!-- docs-consistency:planned-start -->`，在 `- **状态**：… 转 docs/PHASE_萌宠.md 冻结表 …`（L346）之后插入 `<!-- docs-consistency:planned-end -->`，使 L337/L345/L346 三处计划态路径全部落在块内。块内只豁免代码路径存在性；这些路径确属计划态产物，随后续萌宠阶段冻结表/数据契约任务落地。不整篇 ignore-file、不逐行 ignore、不删计划路径、不提前创建 `docs/PHASE_萌宠.md` 或 `pets.js` 空壳。

<!-- dedup-ref --> 关联但不同：`gap-docs-todo-planned-block-missing`（done，AC-005，爬塔章节同机制先例，早前修绿）、`gap-ac-005-full-suite-reverify*`（done，AC-005 见证任务）。在飞 peer `gap-docs-todo-pet-planned-block-missing`（ready）认领 AC-053（GOAL-010 退出条件 4）而非 AC-005，且其 docs/TODO.md 修复未随 task_write 提交（末次提交仅任务文件，工作树仍 `M docs/TODO.md`、测试仍红）；本任务按 AC-005 归属单独立案，验收独立（AC-005 criterion 本身），不能并入 peer（不同 AC）。

## Touches

- `docs/TODO.md`
- `tasks/gap-ac-005-docs-todo-pet-planned-block.md`

## AC

- [ ] `grep -n "docs-consistency:planned-start" docs/TODO.md` 命中本任务新增的起始标记（行号 < 337），`grep -n "docs-consistency:planned-end" docs/TODO.md` 命中紧邻其后的结束标记（行号 ≥ 346），且 L337/L345/L346 三处计划态路径（`docs/PHASE_萌宠.md` ×2、`public/js/shared/data/pets.js` ×1）全部位于这对标记之间
- [ ] `npm run check:docs` exit 0（`scripts/docs-consistency.mjs` 判定通过，零 problem）
- [ ] `node --test tests/docs-consistency.test.mjs` exit 0（「真实仓库文档一致：check:docs 的判定为通过」用例绿）
- [ ] `node --test --test-concurrency=2 tests/*.test.mjs` exit 0（即 AC-005 的 criterion 本身）

## DoD

- [ ] `docs/TODO.md` 用 `docs-consistency:planned-start/end` 块标记萌宠化转型章节的计划态路径（块内只豁免代码路径存在性，链接与 npm 脚本照旧校验；不删路径、不提前创建空壳产物、不整篇 ignore、不逐行 ignore）
- [ ] 在改动所在 HEAD 上连续两次 `node --test --test-concurrency=2 tests/*.test.mjs` 均为 exit 0（不靠重跑掩盖偶发失败）
- [ ] `git diff --name-only <base>..HEAD` 只含 `docs/TODO.md` + `tasks/gap-ac-005-docs-todo-pet-planned-block.md`（self-touch）

## Notes

- 复现与判定命令均以仓库根为 cwd；AC-005 的 criterion 与 `package.json` 的 `scripts.test` 逐字一致。
- 方向是「补 planned 块标记」而不是「删掉计划路径」或「提前创建产物」：这些路径是萌宠化转型的既定交付物（冻结表 + 数据契约），属于计划态，planned 块正是为「计划正文写出将要在 X 创建 Y」而设。
- 本任务不改动 `scripts/docs-consistency.mjs` 与 `tests/docs-consistency.test.mjs` 的判定逻辑，仅补文档标记。