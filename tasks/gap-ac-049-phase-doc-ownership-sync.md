---
id: gap-ac-049-phase-doc-ownership-sync
title: 阶段文档与文档所有权一致：AC-049 判据单一入口 + §7 映射漂移钉子（AC-049）
status: todo
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/phase-refactor-sync.test.mjs && npm run check:doc-ownership
depends_on:
  - gap-ac-044-full-suite-green
goal_ac: AC-049
---
## Proposal

GOAL-009 的 AC-049（`node scripts/check-doc-ownership.mjs && node scripts/docs-consistency.mjs`，expect exit 0）
没有任何任务用 `goal_ac` 认领，判据本身在仓库里也没有单一出口。2026-10-28 实测：

- `node scripts/check-doc-ownership.mjs` → exit 0（已扫描 85 个任务，0 个 open 任务声明总文档）；
- `node scripts/docs-consistency.mjs` → exit 1，14 处「代码路径不存在」，全部来自 `docs/PHASE_REFACTOR.md`
  的 §6 计划态产物（R0 的 `scripts/structure-budget.mjs` / `visual-parity.mjs` / `check-sim-determinism.mjs`
  与 R5 的 `tests/lib/visual/`）。红的那一半根因（计划态产物的判定口径）已由 `gap-ac-044-full-suite-green` 认领，
  产物本身由 `refactor-baseline-and-structure-gate` 创建，**本任务不重做这两件事**。

本任务要收的是目前完全无主的那一半：**§7 这张「AC ↔ 判据 ↔ 命令」表没有任何机械见证**。

- 它是 GOAL-009 全部七个门禁（AC-043…AC-049）的唯一定义处，却只由人手维护；命令单元格写的是
  `node scripts/xxx.mjs` 这样的**计划态路径**，而 AC-044 一旦给 §6/§7 加 planned 块，这些路径就**不再受存在性
  校验**——最需要被盯住的那张表反而成为全文档最不受保护的部分（改名、删脚本、换命令都不会有东西变红）。
- `tests/docs-phase-sync.test.mjs` 只覆盖 GOAL-005/006 的 AC 映射（AC-011…AC-031，goal_ac 解耦口径），
  GOAL-009 没有对应契约。缺了它，下一轮 gap-filing 会再次把 AC-049 报成无主缺口，而任务库里已有的归属关系
  不会被任何东西拦下。
- AC-049 的判据字面量只存在于 `docs/PHASE_REFACTOR.md` §7 与 goal 记录里，`package.json` 没有对应入口；
  AC-045 的同款缺口正是靠 `check:static` 收口的，本任务对 AC-049 做同一件事。

<!-- dedup-ref -->
机制去重与粒度决策：`gap-ac-044-full-suite-green`（AC-044）的机制是 `docs-consistency` 的**判定口径**（planned 块，
只豁免代码路径存在性）；`gap-ac-045-static-checks-green`（AC-045）的机制是**静态四命令**的单点定义与 CI 接线；
`refactor-baseline-and-structure-gate`（AC-043）是**创建 R0 产物**。本任务的机制是「AC-049 判据单一入口 + §7 表的
漂移钉子」，三者互不替代，故**不合并**：折叠进任一任务都会让 AC-049 重新变成无主缺口（与 AC-045 对 AC-044/AC-043
的划界一致）。它与三者共享 `package.json` / `docs/PHASE_REFACTOR.md` 两个文件，调度按 Touches 串行即可；
本任务新增文件只有 `tests/phase-refactor-sync.test.mjs`，不改 `scripts/docs-consistency.mjs`。

## Plan

1. `package.json`：新增
   `"check:doc-ownership": "node scripts/check-doc-ownership.mjs && node scripts/docs-consistency.mjs"`，
   逐字等于 AC-049 判据（顺序、`&&`、`node` 前缀都不改写），作为该判据在仓库里的唯一字面定义。
2. `docs/PHASE_REFACTOR.md` §7：AC-049 行的「命令」单元格改为 `npm run check:doc-ownership`（表格仍留在文档里，
   但不再手抄两条命令）；§7 末尾补一行「本表由 `tests/phase-refactor-sync.test.mjs` 钉住」的说明。
   不改 §6 的分期内容与任何预算值——那是 AC-043 / AC-044 的 lane。
3. `tests/phase-refactor-sync.test.mjs`（新增，纯读取 + 纯函数，不跑扫描、不联网、不读 goal store）：
   契约抽成纯函数 `checkPhaseRefactorSync({ phaseMarkdown, tasks, pkg })`，正例（真实仓库）与反例 fixture 共用：
   - (a) §7 表覆盖 `AC-043…AC-049` 各一次，且每行「命令」单元格非空；
   - (b) 每个 open（todo / ready / needs-human）任务若 `goal_ac ∈ AC-043…AC-049`，该 AC 必须出现在 §7 ——
     沿用 AC-007 已解耦的口径：**只要求 goal_ac 命中 AC 行，不要求任务 id 逐字进表**（否则活任务库会让全量
     套件周期性转红）；
   - (c) `pkg.scripts['check:doc-ownership']` 逐字等于 AC-049 判据常量，且 §7 的 AC-049 行引用它。
   负对照（改文本再断言，不是「断言某字符串存在」的弱检查）：删 §7 的 AC-046 行 → (a) 红；删 §7 的 AC-048 行
   且存在 `goal_ac: AC-048` 的 open 任务 → (b) 红；同一任务改成 done 后再跑 → 不报（证明只看 open）；
   `check:doc-ownership` 丢掉 `&& node scripts/docs-consistency.mjs` 一段 → (c) 红。
4. 验证：`node --test tests/phase-refactor-sync.test.mjs` 全绿；`npm run check:doc-ownership` exit 0；
   `npm test` exit 0，且同一棵树上连续两次结果一致。

## AC

- [ ] `node --test tests/phase-refactor-sync.test.mjs` exit 0（正例读真实的 `docs/PHASE_REFACTOR.md` + `tasks/` + `package.json`）
- [ ] `node -e "const s=require('./package.json').scripts['check:doc-ownership'];process.exit(s==='node scripts/check-doc-ownership.mjs && node scripts/docs-consistency.mjs'?0:1)"` exit 0
- [ ] `npm run check:doc-ownership` exit 0，其中 `node scripts/check-doc-ownership.mjs` 单独跑也是 exit 0
- [ ] `npm test` exit 0，用例数只增不减
- [ ] 四条负对照（删 AC-046 行 / 删 AC-048 行且存在 open 的 `goal_ac: AC-048` 任务 / 同一任务改 done 后不报 / 判据掉一段）各自使对应用例转红
- [ ] `git diff` 只涉及 Touches 的四个文件；`scripts/docs-consistency.mjs` 与任何 `public/`、`server/` 文件 0 改动

## DoD

- [ ] AC-049 判据在仓库里只有一处字面定义（`package.json` 的 `check:doc-ownership`），`docs/PHASE_REFACTOR.md` §7 只引用它、不再手抄两条命令
- [ ] §7 的「AC ↔ 判据 ↔ 命令」表由测试机械钉住：删任一 AC 行、或让某个 open 任务的 `goal_ac` 脱离 §7，测试立即转红（负对照实跑，不是预言）
- [ ] 归属契约沿用 AC-007 的解耦口径：只判 goal_ac 命中 AC 行，不要求任务 id 逐字进表；此后立案/晋升任意 GOAL-009 任务都不会让全量套件转红
- [ ] `npm run check:doc-ownership` 在同一棵树上连续两次 exit 0，`npm test` exit 0
- [ ] 不改 `scripts/docs-consistency.mjs` 的判定语义（AC-044 的 lane）、不创建 R0 产物（AC-043 的 lane）、不改任何运行时/玩家可见行为
- [ ] 零第三方依赖、Node ≥ 22.5 原生实现；只新增一个测试文件，不动 `scripts/test-changed.mjs` 的 TEST_MAP（`tests/` 不在审计源根内）
- [ ] Notes 记下复用约定：未来 `docs/PHASE_<主题>.md` 的 AC 映射同样只按 goal_ac 建立契约，并给判据一个 `npm run` 入口

## Touches

- `package.json`
- `docs/PHASE_REFACTOR.md`
- `tests/phase-refactor-sync.test.mjs` (new)
- `tasks/gap-ac-049-phase-doc-ownership-sync.md`

## Notes

本任务不重做 AC-044（planned 块判定口径）与 AC-043（R0 产物创建）的机制，只负责把 AC-049 判据收成一个可执行的
单一入口，并给 §7 的 AC 映射加一道漂移钉子。`depends_on: gap-ac-044-full-suite-green` 是硬前置：`check:doc-ownership`
的第二段（`docs-consistency`）在 planned 块落地前仍会因 14 处计划态路径 exit 1，本任务的 AC 要求它 exit 0，
因此必须在那之后 dispatch，否则会白烧一轮。

执行提示（2026-10-28 实测的坑）：`docs/PHASE_REFACTOR.md` 在主检出里当前是**未跟踪文件**（`git status` 显示
`?? docs/PHASE_REFACTOR.md`）。worker 的 worktree 里若不存在该文件，从主检出复制后再改 §7，不要重写正文口径；
§7 很可能已被 AC-044 包进 `docs-consistency:planned-start/end` 块内，改行时要保持在块内，别把标记删掉。
