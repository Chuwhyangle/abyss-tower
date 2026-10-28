---
id: gap-ac-005-full-suite-reverify-planned-blocks
title: AC-005 复验：planned 块修复落地后全量测试（--test-concurrency=2）exit 0（根因由 AC-044 任务拥有）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test --test-concurrency=2 tests/*.test.mjs
depends_on:
  - gap-ac-044-full-suite-green
goal_ac: AC-005
---
## Proposal

AC-005（GOAL-001「上游基线合并与开发基线确认」）的 criterion 逐字为 `node --test --test-concurrency=2 tests/*.test.mjs`，expect `exit 0`。2026-10-28 在 HEAD `07e9131` 上按原命令直接重跑：`# tests 1679 / # pass 1678 / # fail 1`，exit 1 —— 该条件当前为假。这是确定性失败，不是偶发。

唯一失败点是 `not ok 322 - 真实仓库文档一致：check:docs 的判定为通过`（`tests/docs-consistency.test.mjs:133`），失败文本是 14 条「代码路径不存在」，全部指向 `docs/PHASE_REFACTOR.md`：

- `scripts/structure-budget.mjs`（行 5 / 40 / 75 / 110）
- `scripts/structure-budget.allow.d/`（行 68 / 75）
- `tests/structure-budget.test.mjs`（行 75）
- `scripts/visual-parity.mjs`（行 76 / 114）
- `docs/reviews/refactor-baseline.json`（行 76）
- `scripts/check-sim-determinism.mjs`（行 77 / 113）
- `docs/reviews/sim-determinism.json`（行 77）
- `tests/lib/visual/`（行 99）

确定性已实测：单独复跑 `node --test tests/docs-consistency.test.mjs` 两次，均 exit 1，同为 `not ok 6`，读数同为 `# tests 6 / # pass 5 / # fail 1`。

**根因（本任务不重复修复）**：`scripts/docs-consistency.mjs` 把文档里每段反引号代码路径都判为「现在必须存在」，而 `docs/PHASE_REFACTOR.md` 是 GOAL-009 的结构性重构计划正本，§6 的职责恰恰是按任务 id 指派**尚未创建**的产物。判定口径与文档角色天然冲突。该机制由 `gap-ac-044-full-suite-green`（status=ready，`goal_ac: AC-044`）拥有：它给文档检查加 `planned-start` / `planned-end` 块级豁免（块内只跳过代码路径存在性，未闭合 / 嵌套 / 孤立标记一律 fail-closed），并给计划正本打块标记。

**为什么此前 AC-005 的修复没有守住**：声明 `goal_ac: AC-005` 的任务全部为 done / superseded —— `gap-test-changed-stale-map-entries`（done）清掉的是 revert 残留的 `TEST_MAP` 失效映射；`gap-ac-005-full-suite-reverify`（done）见证的是那批映射修复的落地；`gap-goal-001-exit-condition-test-coverage`（superseded）只做目标级覆盖裁定。三者覆盖的都是「脚本删了映射没删」这一类红，都不构成不变量。本轮是**新的红类**：文档 lane 的 `d7448a8` 把一份按设计只描述未来产物的计划正本提交进 main，此前任何一次修复都不覆盖这一类。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：本任务不重复 `gap-ac-044-full-suite-green` 的任何编辑（`scripts/docs-consistency.mjs` / `tests/docs-consistency.test.mjs` / `docs/PHASE_REFACTOR.md` 全部归它），只承担 AC-005 自己的见证面。三者的读数面互不替代：AC-005 的 criterion 是**带 `--test-concurrency=2`** 的 `node --test` 命令；AC-044 的是 `npm test`；AC-002 的是**不带并发参数**的裸命令连续 3 次。`goal_ac` 是单值标量，折叠进任一任务都会让 AC-005 重新变成没有独立、可被 driver 逐字复算归属的缺口。本任务 Touches 只有自身任务文件，与三者零文件重叠；`node <plugin>/scripts/dist/task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-005-full-suite-reverify-planned-blocks.md --json` 返回 `peers: []`、`mentions: []`。结论：**独立立案**，不合并。

## Plan

1. 确认 `gap-ac-044-full-suite-green` 的修复提交已在被评估 HEAD 的祖先链中：`git merge-base --is-ancestor <fix-commit> HEAD` exit 0，并在 Notes 记下该提交 hash；不要只凭它在本任务 worktree 里绿就当作已生效。
2. 在该 HEAD 上逐字执行 AC-005 criterion `node --test --test-concurrency=2 tests/*.test.mjs`，记录 `# tests / # pass / # fail / # duration_ms`、`not ok` 条数与退出码。
3. 不是 exit 0 时：立刻抓 `not ok` 用例名与失败文本，逐条判归属。若残留仍是 planned 块 / 计划态文档机制，登记证据并回写 `gap-ac-044-full-suite-green` 的 Notes，不在本任务并发编辑其 Touches 文件；若是不同机制（端口 / 时序 / 并发偶发 / TEST_MAP），先把对应源文件加入本任务 `## Touches`，再动手修。
4. 为证明不是单次偶发，在**同一个** HEAD 上再复跑一次该命令，共两次，两次读数都写进 Notes。
5. 不改产品行为、玩法与数值；不改 AC-044 / AC-002 / AC-007 / AC-045 / AC-049 任一 lane 的文件；criterion 原文的 `--test-concurrency=2` 必须保留，不得换成默认并发或 `npm test` 读数。

## AC

- [ ] 逐字执行 AC-005 criterion `node --test --test-concurrency=2 tests/*.test.mjs` exit 0
- [ ] 在被评估 HEAD 上独立复跑两次该命令均 exit 0，两次 `# tests / # pass / # fail` 已写入 Notes
- [ ] `git merge-base --is-ancestor <AC-044 修复提交> HEAD` exit 0，Notes 写明该提交 hash
- [ ] Notes 记录本轮失败面证据：`not ok 322` 用例名、14 条「代码路径不存在」原文，以及确定性（单独复跑两次同为 `not ok 6` / `5 pass / 1 fail`）
- [ ] 若出现非 planned 块机制的残留失败，对应源文件已出现在本任务 `## Touches`，且 Notes 记录失败文本与根因

## DoD

- [ ] 两次读数可被 driver 独立复算：Notes 同时给出命令原文、每次 stdout 尾部（`# tests / # pass / # fail / # duration_ms`）与退出码
- [ ] 被评估 HEAD 已提交，`git status --short` 无本任务相关未提交改动
- [ ] 同一 HEAD 上全量用例数未减少（≥1679 项），0 fail
- [ ] 门禁语义未被放宽：本任务 diff 不含 `scripts/docs-consistency.mjs` / `tests/docs-consistency.test.mjs` / `docs/PHASE_REFACTOR.md`，也没有新增任何 ignore / planned 标记
- [ ] 零运行时 / 玩家可见改动、零第三方依赖；本任务 diff 不含 AC-044 / AC-002 / AC-007 / AC-045 / AC-049 任一 lane 的文件
- [ ] Notes 写清取舍：为什么 AC-005 的见证不折叠进 AC-044 / AC-002 任务（criterion 命令与并发参数不同；`goal_ac` 单值标量）

## Touches

- `tasks/gap-ac-005-full-suite-reverify-planned-blocks.md`
