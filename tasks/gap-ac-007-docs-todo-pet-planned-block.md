---
id: gap-ac-007-docs-todo-pet-planned-block
title: docs/TODO.md 萌宠化转型 计划态路径缺 planned 块标记，check:docs 判红（AC-007 稳定性门禁 exit 1）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-docs-todo-pet-planned-block-missing
goal_ac: AC-007
---
## Proposal

AC-007（GOAL-002「测试稳定性与并发隔离」退出条件：稳定性门禁可运行且通过）criterion 逐字为 `node scripts/check-stability.mjs`、expect `exit 0`。2026-11-05 按原命令直接重跑：3 轮全部 fail，失败面恒定——唯一失败用例 `tests/docs-consistency.test.mjs:367`「真实仓库文档一致：check:docs 的判定为通过」→ `not ok 396`。该条件当前为假（本轮为直接测量，非陈旧台账尾巴）。

**失败点（唯一稳定复现）**

- 断言列出 3 条「代码路径不存在」，全部落在 `docs/TODO.md` 的「萌宠化转型」章节（工作树未提交 `M docs/TODO.md`，2026-11-05 用户拍板）：
  - `docs/TODO.md:337: 代码路径不存在 -> docs/PHASE_萌宠.md`
  - `docs/TODO.md:345: 代码路径不存在 -> public/js/shared/data/pets.js`
  - `docs/TODO.md:346: 代码路径不存在 -> docs/PHASE_萌宠.md`

**根因**

1. 2026-11-05 写入 `docs/TODO.md` 的「萌宠化转型」章节用反引号写出 3 处「将要在后续阶段创建」的计划态路径，却未包进 planned 块。
2. `scripts/docs-consistency.mjs`（`npm run check:docs`）第 2 类判定要求反引号里的仓库路径真实存在，于是 docs-consistency 用例变红 → 全量 suite 红 → check-stability 三轮全 fail。
3. 仓库已有既定豁免机制：`<!-- docs-consistency:planned-start -->` … `<!-- docs-consistency:planned-end -->` 块只豁免「代码路径存在性」，`docs/TODO.md:135-137`（爬塔草案）与 TODO-13 均如此修复。萌宠化转型章节漏打了这个标记。

**为什么上一轮没守住**

同一「计划态路径漏 planned 标记」机制此前已修绿过两次（爬塔草案 `docs/TODO.md:135-137`、非 ASCII 截断 + planned 块——见 AC-007 前序 done 任务 `gap-ac-007-docs-consistency-nonascii-planned-path`）。但那些修复针对的是「当时已存在的」计划态路径；2026-11-05 萌宠化转型章节是**新写入的新实例**，再次把「计划态产物」用反引号写成「已存在路径」且漏加标记，重新打破「反引号路径必须存在」的不变量。故「曾经绿过」不蕴含「现在绿」，必须新立任务把条件重新变真。

**修复机制（已由 peer 认领，本任务只读见证）**

把 `docs/TODO.md` 萌宠化转型章节内含计划态路径的区段包进 planned 块：在 `### 平衡红线草案（供 docs/PHASE_萌宠.md 冻结）`（L337）之前插入 `<!-- docs-consistency:planned-start -->`，在 `- **状态**：… 转 docs/PHASE_萌宠.md 冻结表 …`（L346）之后插入 `<!-- docs-consistency:planned-end -->`，使 L337/L345/L346 三处计划态路径全部落在块内。该编辑已由 in-flight peer `gap-docs-todo-pet-planned-block-missing`（ready，认领 AC-053）认领；本任务按 AC-007 归属立为**只读见证**，不重复编辑 `docs/TODO.md`（Touches 只含自身），只负责复验 criterion 变真。

<!-- dedup-ref --> 关联但不同：`gap-docs-todo-pet-planned-block-missing`（ready，认领 AC-053，做同一 docs/TODO.md planned 标记修复）；`gap-ac-005-docs-todo-pet-planned-block`（todo，认领 AC-005，同机制另立案）；`gap-ac-007-docs-consistency-nonascii-planned-path`（done，AC-007 上一实例：非 ASCII 截断 + planned 块）。本轮是同一「planned 路径漏标记」机制在萌宠化转型章节再现，属缺陷回归，按 AC-007 归属单独立案。

## Touches

- `tasks/gap-ac-007-docs-todo-pet-planned-block.md`

## AC

- [x] `node scripts/check-stability.mjs` exit 0（AC-007 criterion 本身）
- [x] `npm run check:docs` exit 0（`scripts/docs-consistency.mjs` 判定通过，零 problem）

## DoD

- [x] 真实仓库 `node scripts/check-stability.mjs` exit 0（214 测试文件三轮全绿，docs-consistency 用例不再报 docs/TODO.md 萌宠化转型三处路径缺失）
- [x] `docs/TODO.md` 萌宠化转型章节的三处计划态路径（`docs/PHASE_萌宠.md` ×2、`public/js/shared/data/pets.js` ×1）已位于 `docs-consistency:planned-start/end` 块内
- [x] 本任务 Touches 只含自身文件（只读见证，不重复编辑 `docs/TODO.md`）

## Notes

- 复现与判定命令均以仓库根为 cwd；AC-007 的 criterion 与 `scripts/check-stability.mjs` 逐字一致。
- 本任务是 AC-007 的只读见证：修复动作归 peer `gap-docs-todo-pet-planned-block-missing`（认领 AC-053），本任务只负责把 AC-007 的 gap 归属挂到 `goal_ac: AC-007`，并在修复合入后复验 criterion。
- 复验（2026-11-05）：peer 修复已随 commit `82aea41d`（fix(docs): docs/TODO.md 萌宠化转型计划态路径补 planned 块标记）fan-in 落 develop；本任务只读见证零 delta，直接量 `node scripts/check-stability.mjs` exit 0（3 轮 × 2027 项全绿）、`npm run check:docs` exit 0（27 文件），AC-007 criterion 已变真。
