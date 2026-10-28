---
id: gap-ac-044-full-suite-green
title: 重构行为不变：全量测试绿——计划态产物引用的块级豁免（AC-044）
status: ready
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: npm run check:docs && node --test tests/docs-consistency.test.mjs
goal_ac: AC-044
---
## Proposal

GOAL-009 的 AC-044（重构不改变行为：`npm test` exit 0）目前没有任何任务认领，且实测已经红：
1679 例中 1 例失败，`tests/docs-consistency.test.mjs:133`「真实仓库文档一致」——`npm run check:docs`
在 `docs/PHASE_REFACTOR.md` 上报出 14 处「代码路径不存在」：

    docs/PHASE_REFACTOR.md:5   -> scripts/structure-budget.mjs
    docs/PHASE_REFACTOR.md:40  -> scripts/structure-budget.mjs
    docs/PHASE_REFACTOR.md:67  -> scripts/structure-budget.allow.json
    docs/PHASE_REFACTOR.md:74  -> scripts/structure-budget.mjs / structure-budget.allow.json / tests/structure-budget.test.mjs
    docs/PHASE_REFACTOR.md:75  -> scripts/visual-parity.mjs / docs/reviews/refactor-baseline.json
    docs/PHASE_REFACTOR.md:76  -> scripts/check-sim-determinism.mjs / docs/reviews/sim-determinism.json
    docs/PHASE_REFACTOR.md:98  -> tests/lib/visual/
    docs/PHASE_REFACTOR.md:109/112/113 -> scripts/structure-budget.mjs / check-sim-determinism.mjs / visual-parity.mjs

根因不是代码缺陷，而是**判定口径与文档角色不匹配**：`scripts/docs-consistency.mjs` 把文档里每段反引号
代码路径都判为「现在必须存在」，而 `docs/PHASE_REFACTOR.md` 是 GOAL-009 的**计划正本**，§6 的职责就是按
任务 id 指派尚未创建的产物。计划文档写不出「将要在 X 创建 Y」，只能写路径——两者天然冲突。

这条红不是一次性的：R0 落地时能让自己那批产物变实，但 `tests/lib/visual/` 属于 R5，R0 合入时仍红；
而 R0 的 AC 要求 `npm test` 全绿 ⇒ 重构链在第一个任务上就卡死。每个 `docs/PHASE_<主题>.md`（CLAUDE.md
规定每阶段一份）都会重演同一冲突，所以需要的是**可复用的判定口径**，不是针对这一个文件的一次性补丁。

现成的 `docs-consistency:ignore` 是逐行豁免，粒度太细：§5/§6 会被 R0、R6 反复重写，写标记的人与改文本的人
不是同一次提交，漏写一行就再次全量转红，且它连真实链接/`npm run` 脚本一起豁免——把门禁削弱得超出了需要。
本任务实现**块级、只豁免代码路径存在性**的机制：块内的计划产物不判存在，块外的路径、块内的相对链接与
`npm run` 脚本照旧校验；未闭合/嵌套/孤 `planned-end` 一律 fail-closed。

<!-- dedup-ref -->
机制去重与粒度决策：本任务只改 `check:docs` 对计划态产物的判定口径并给计划正本打块标记；`refactor-baseline-and-structure-gate`（goal_ac AC-043）负责创建这些产物本身与结构预算/视觉/确定性门禁，两者机制不同、互不替代。它与本任务仅共享 `docs/PHASE_REFACTOR.md` 一个文件，调度按 Touches 串行即可，因此**不合并**：AC-044 必须有独立的 `goal_ac` 归属，折叠进 AC-043 任务会让本 AC 重新变成无主缺口。

## Plan

1. `scripts/docs-consistency.mjs`：新增两个导出的块标记常量 `PLANNED_START = 'docs-consistency:planned-start'`、
   `PLANNED_END = 'docs-consistency:planned-end'`，语义写进文件头注释（与现有 `ignore` / `ignore-file` 并列）。
   `analyzeDoc` 在围栏状态之外维护一个 planned 深度，按行结算：
   - 块内：`scanLine` 仍做相对链接与 `npm run` 校验，只跳过 `checkCodePath`（代码路径存在性）；
   - `planned-start` 再次出现（嵌套）→ problem：`计划块嵌套`；
   - `planned-end` 未在块内出现（孤立）→ problem：`计划块缺少起始标记`；
   - 文档结束时仍在块内（未闭合）→ problem：`计划块未闭合`；
   - 标记行本身不被当作正文扫描；围栏代码块内的标记按字面文本处理，不改变状态。
   判定必须 fail-closed：上述三种结构错误都让 `check:docs` exit 1，绝不静默通过。
2. `tests/docs-consistency.test.mjs`：在现有 fixture 风格上补正/负对照——(a) 块内缺失路径不报、块外同一
   路径必报；(b) 未闭合、嵌套、孤 `planned-end` 三种结构错误各返回一条 problem；(c) 块内相对链接目标缺失
   仍报（证明只豁免路径存在性）；(d) 块内 `npm run <不存在>` 仍报。真实仓库用例（现 133 行那条）原样保留，
   它必须随计划正本一起转绿。
3. `docs/PHASE_REFACTOR.md`：用 `<!-- docs-consistency:planned-start -->` / `<!-- docs-consistency:planned-end -->`
   包住 §1 变更纪律行、§2 目标 3、§5 债务登记行、§6 全部计划产物行、§7 判据命令行；块外的真实引用
   （`CLAUDE.md` 等）不包。§6 的 R6 条目补一句：R6 收口时删除全部 planned 块与标记，回归 100% 校验。
   注意该文件当前在主检出里是**未跟踪文件**（`git status` 显示 `?? docs/PHASE_REFACTOR.md`）：worktree 中若不存在，
   从主检出复制后再加标记，不要重写正文口径。
4. 验证：`npm run check:docs` exit 0；`node --test tests/docs-consistency.test.mjs` 全绿；`npm test` exit 0。

## AC

- [x] `npm test` exit 0（改动前 1678/1679，改动后全绿）
- [x] `npm run check:docs` exit 0，且输出里不再出现 `docs/PHASE_REFACTOR.md` 的「代码路径不存在」
- [x] `node --test tests/docs-consistency.test.mjs` 全绿，新增用例覆盖：块内未落地产物不报、块外同一路径必报、未闭合/嵌套/孤 `planned-end` 各 exit 1
- [x] 负对照证明门禁没被整体削弱：块内相对链接目标缺失、块内 `npm run <不存在脚本>` 仍然返回 problem
- [x] `docs/PHASE_REFACTOR.md` 的 14 处计划产物引用全部位于 planned 块内，块外无缺失路径；块标记外的真实引用仍受校验
- [x] `git diff` 只涉及 Touches 的四个文件，无运行时/玩家可见代码改动

## DoD

- [x] 标记语义只在 `scripts/docs-consistency.mjs` 定义一处（常量 + 文件头注释），`tests/docs-phase-sync.test.mjs` 复用的 `analyzeDoc(root, doc, scripts)` 签名不变
- [x] 三种结构错误 fail-closed（不是 warning、不是静默通过），每条都有 fixture 用例落盘
- [x] `npm test` 在同一棵树上连续两次 exit 0，用例数只增不减
- [x] 计划块带日落：`docs/PHASE_REFACTOR.md` §6 的 R6 条目写明收口时删除全部 planned 块并回归全量校验；本任务 Notes 记下同一约定，供未来 `docs/PHASE_<主题>.md` 复用
- [x] 零第三方依赖、Node ≥ 22.5 原生实现；只动文档与文档检查脚本，不改任何运行时行为

## Touches

- `scripts/docs-consistency.mjs`
- `tests/docs-consistency.test.mjs`
- `docs/PHASE_REFACTOR.md`
- `tasks/gap-ac-044-full-suite-green.md`

## Notes

### 实现要点

- `scripts/docs-consistency.mjs`：`PLANNED_START` / `PLANNED_END` 两个常量 + 文件头注释是标记语义的唯一
  定义处；`scanLine` 增加 `planned` 入参，块内只跳过 `checkCodePath`，`checkLink` / `checkNpmScript` 照旧；
  `analyzeDoc` 在围栏状态之外按行结算 planned 状态，`analyzeDoc(root, docRel, scripts)` 签名未变
  （`tests/docs-phase-sync.test.mjs` 的调用方零改动）。围栏状态**先**结算，围栏内的标记是字面文本。
  三种结构错误各记一条 problem 并让 `check:docs` exit 1。
- `docs/PHASE_REFACTOR.md`：§1 变更纪律、§2 目标 3、§5 整张预算表、§6 全部分期、§7 整张门禁表共 5 个
  planned 块；R6 新增「计划块日落」条目。

### 复用约定（未来 `docs/PHASE_<主题>.md` 照此办）

1. 语法：`<!-- docs-consistency:planned-start -->` … `<!-- docs-consistency:planned-end -->`。语义只由
   `scripts/docs-consistency.mjs` 定义，别在文档里另行发明第三种豁免。
2. 语义边界：块内**只**豁免「反引号代码路径存在性」。相对链接、`npm run <脚本>`（脚本必须已在
   `package.json`）照旧校验——所以计划块里能写 `npm run check:xxx`（已存在），不能写待创建的脚本名。
3. fail-closed：嵌套 start / 孤 end / 文档结束未闭合，各记一条 problem 并 exit 1。
4. **块内正文不要逐字写出两个标记常量**：字面出现会被状态机当成真的嵌套/提前闭合（实测踩过一次）。
   要提到标记就写「计划块 / planned 块」，或把提及放进围栏代码块。
5. **表格不能只包住某一行**：HTML 注释行会打断 Markdown 表格渲染。要包就包整张表——start/end 放在表格
   上下的独立行（本任务的 §5/§7 就是整表包裹）。
6. 日落：R6 收口时删除全部计划块（含标记行），回归 100% 存在性校验。阶段文档的豁免是临时的，不是常态。

### 验证证据（2026-10-28，worktree `task/gap-ac-044-full-suite-green`，已 merge develop）

- `npm test`：改动前 1678/1679（1 例失败），改动后 **1684/1684 连续两次 exit 0**。
- `npm run check:docs` exit 0（21 个文件），输出中不再出现 `docs/PHASE_REFACTOR.md` 的「代码路径不存在」；
  改动前同命令 exit 1、14 处失效。
- `node --test tests/docs-consistency.test.mjs` 11/11 通过（原 6 例 + 新增 5 例）。
- CLI 级负对照（`--root` 临时 fixture）：未闭合 / 嵌套 / 孤 end 各 exit 1；块内缺失路径不报、块外同一
  路径 exit 1；块内缺失相对链接与不存在的 `npm run` 仍各记一条 problem。
- 变异验证（证明用例有牙）：去掉 `!planned` 守卫（退回旧口径）→ 5 例转红；把 planned 行整行跳过（连链接
  与 npm 一起豁免）→ 1 例转红；删掉三种结构错误的 push → 1 例转红。
- 14 处计划态引用全部位于 5 个 planned 块内，且这 8 个产物在树上确实不存在（`structure-budget.mjs`、
  `structure-budget.allow.d/`、`tests/structure-budget.test.mjs`、`visual-parity.mjs`、
  `docs/reviews/refactor-baseline.json`、`check-sim-determinism.mjs`、`docs/reviews/sim-determinism.json`、
  `tests/lib/visual/`），所以转绿确由块造成；块外仍有 4 个仓库路径 token（`tests/`、`public/js/`、
  `scripts/`、`server/`）实际受校验，证明门禁未被整篇削弱。
- 顺带：`npm run check:syntax`、`npm run check:style`（215 文件）、`node scripts/check-doc-ownership.mjs`
  均 exit 0；anti-drift Touches 检查 OK（3 个实际改动文件全在 Touches 内）。
