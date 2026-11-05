---
id: gap-docs-todo-pet-planned-block-missing
title: docs/TODO.md 萌宠化转型 计划态路径缺 planned 块标记，check:docs 判红（AC-053 全量测试 exit 1）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-053
---
## Proposal

AC-053（GOAL-010 退出条件 4）criterion 逐字为 `npm test`、expect `exit 0`。2026-11-05 按原命令直接重跑：`# tests 2027 / # pass 2026 / # fail 1`，exit 1——该条件当前为假（本轮为直接测量，非陈旧台账尾巴）。

**失败点（唯一稳定复现）**

- `tests/docs-consistency.test.mjs:367`「真实仓库文档一致：check:docs 的判定为通过」→ `not ok 396`
- 断言列出 3 条「代码路径不存在」，全部落在 `docs/TODO.md`：
  - `docs/TODO.md:337: 代码路径不存在 -> docs/PHASE_萌宠.md`
  - `docs/TODO.md:345: 代码路径不存在 -> public/js/shared/data/pets.js`
  - `docs/TODO.md:346: 代码路径不存在 -> docs/PHASE_萌宠.md`

**根因**

1. 工作树未提交改动（`git status` 显示 `M docs/TODO.md`）在 `docs/TODO.md` 新增「萌宠化转型（design，2026-11-05 用户拍板）」章节，用反引号写出 3 处「将要在后续阶段创建」的路径：`docs/PHASE_萌宠.md`（L337「供 … 冻结」、L346「转 … 冻结表」）与 `public/js/shared/data/pets.js`（L345「新建 …」）。
2. `scripts/docs-consistency.mjs`（`npm run check:docs`）第 2 类判定要求反引号里的仓库路径真实存在，于是全量 suite 的 docs-consistency 用例变红。
3. 仓库已有既定豁免机制：`<!-- docs-consistency:planned-start -->` … `<!-- docs-consistency:planned-end -->` 块只豁免「代码路径存在性」（块内相对链接与 npm 脚本照旧校验），`docs/TODO.md:135-137` 已有先例（爬塔草案、TODO-13 均如此修复）。萌宠化转型章节漏打了这个标记。

**为什么上一轮没有守住**

AC-053 上一轮达成（2026-10-30）后，萌宠化转型设计章节于 2026-11-05 写入 `docs/TODO.md` 却未加 planned 标记，把「计划态产物」写成「已存在路径」，打破「反引号路径必须存在」的不变量。所以「曾经绿过」不再蕴含「现在绿」，必须新立一条任务把条件重新变真。

**修复方案**

把 `docs/TODO.md` 萌宠化转型章节内含计划态路径的区段包进 planned 块（与既有先例一致）：在 `### 平衡红线草案（供 docs/PHASE_萌宠.md 冻结）`（L337）之前插入 `<!-- docs-consistency:planned-start -->`，在 `- **状态**：… 转 docs/PHASE_萌宠.md 冻结表 …`（L346）之后插入 `<!-- docs-consistency:planned-end -->`，使 L337/L345/L346 三处计划态路径全部落在块内。块内只豁免代码路径存在性；这些路径确属计划态产物，随后续萌宠阶段冻结表/数据契约任务落地。不整篇 ignore-file、不逐行 ignore、不删计划路径、不提前创建 `docs/PHASE_萌宠.md` 或 `pets.js` 空壳。

<!-- dedup-ref --> 关联但不同机制：`gap-docs-todo-planned-block-missing`（done，TODO-13 计划路径漏 planned 标记）、`gap-ac-007-docs-consistency-nonascii-planned-path`（done，非 ASCII 截断 + planned 块）、`gap-ac-007-docs-consistency-angle-bracket-placeholder`（done，尖括号占位符截断，修 REPO_PATH_RE）。本轮是同一「planned 路径漏标记」机制在萌宠化转型章节再现，属缺陷回归，单独立案。合并候选检查：`task-granularity-advice --root /data/home/wenhao/abyss-tower --touches docs/TODO.md --json` → `peers: []`、`mentions: []`（无 open 任务声明该文件）。

## Touches

- `docs/TODO.md`
- `tasks/gap-docs-todo-pet-planned-block-missing.md`

## AC

- [x] `grep -n "docs-consistency:planned-start" docs/TODO.md` 命中本任务新增的起始标记，且三个计划态路径（`docs/PHASE_萌宠.md` 在 L337/L346、`public/js/shared/data/pets.js` 在 L345）全部位于该起始标记与紧邻其后的 `docs-consistency:planned-end` 之间
- [x] `npm run check:docs` exit 0（`scripts/docs-consistency.mjs` 判定通过，零 problem）
- [x] `node --test tests/docs-consistency.test.mjs` exit 0（「真实仓库文档一致：check:docs 的判定为通过」用例绿）
- [x] `npm test` exit 0（即 AC-053 的 criterion 本身）

## DoD

- [x] `docs/TODO.md` 用 `docs-consistency:planned-start/end` 块标记萌宠化转型章节的计划态路径（块内只豁免代码路径存在性，链接与 npm 脚本照旧校验；不删路径、不提前创建空壳产物、不整篇 ignore、不逐行 ignore）
- [x] 在改动所在 HEAD 上连续两次 `npm test` 均为 exit 0（不靠重跑掩盖偶发失败）
- [x] `git diff --name-only <base>..HEAD` 只含 `docs/TODO.md` + `tasks/gap-docs-todo-pet-planned-block-missing.md`（self-touch）

## Notes

- 复现与判定命令均以仓库根为 cwd；AC-053 的 criterion 与 `package.json` 的 `scripts.test` 逐字一致。
- 方向是「补 planned 块标记」而不是「删掉计划路径」或「提前创建产物」：这些路径是萌宠化转型的既定交付物（冻结表 + 数据契约），属于计划态，planned 块正是为「计划正文写出将要在 X 创建 Y」而设。
- 该章节本身是工作树未提交改动；本任务落地时随修复一并提交，不额外带回其他无关脏文件。
- 落地复验（2026-11-05）：AC-1 grep 命中 L337/L348 标记且三处计划态路径均落块内；AC-2 `npm run check:docs` exit 0（27 文件）；AC-3 `node --test tests/docs-consistency.test.mjs` exit 0（13/13）；AC-4 `npm test` 连续两次 exit 0（各 2027/2027 pass）。