---
id: gap-ac-002-full-suite-3x-reverify-planned-blocks
title: AC-002 复验：planned 块修复落地后全量测试连续 3 次 0 失败（计划态文档产物红由 AC-044 拥有）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo
    "CAUSE=full suite failed on run $i" >&2; exit 1; }; done
depends_on:
  - gap-ac-044-full-suite-green
goal_ac: AC-002
---
## Proposal

AC-002（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo "CAUSE=full suite failed on run $i" >&2; exit 1; }; done`，expect `exit 0`。2026-10-28 在 HEAD `4c91312` 上按原命令直接复跑，run 1 即非零退出：`# tests 1679 / # pass 1678 / # fail 1`。唯一失败点为 `not ok 322 - 真实仓库文档一致：check:docs 的判定为通过`（`tests/docs-consistency.test.mjs:133`），失败文本是 14 条「代码路径不存在」，全部指向 `docs/PHASE_REFACTOR.md`：`scripts/structure-budget.mjs`（行 5/40/75/110）、`scripts/structure-budget.allow.d/`（行 68/75）、`tests/structure-budget.test.mjs`（行 75）、`scripts/visual-parity.mjs`（行 76/114）、`docs/reviews/refactor-baseline.json`（行 76）、`scripts/check-sim-determinism.mjs`（行 77/113）、`docs/reviews/sim-determinism.json`（行 77）、`tests/lib/visual/`（行 99）。

确定性已实测：`node --test tests/docs-consistency.test.mjs` 连跑两次均 exit 1，同为 `not ok 6`，读数同为 `# tests 6 / # pass 5 / # fail 1` —— 这不是并发/时序偶发，而是套件里的一处确定性断言坏了。

**根因（本任务不重复修复）**：`git log -- docs/PHASE_REFACTOR.md` 只有一笔 `d7448a8 docs(refactor): 结构性重构阶段决策（GOAL-009 计划正本）`。`scripts/docs-consistency.mjs` 把文档里每段反引号代码路径都判为「现在必须存在」，而阶段计划正本的 §6 职责恰恰是按任务 id 指派**尚未创建**的产物。判定口径与文档角色天然冲突。

**为什么此前三次 AC-002 修复都没有守住**：声明 `goal_ac: AC-002` 的四个任务全部 `done` —— TEST-001/TEST-002 修的是端口/临时库/启动校验导致的并发串扰并新增 `scripts/check-stability.mjs`；`gap-ac-002-full-suite-3x-green` 修的是 revert 残留的 `TEST_MAP` 失效映射；`gap-ac-002-full-suite-3x-reverify` 见证的是活任务库耦合的解耦。三者都只保证「某个具体机制不再把套件打红」，都不构成不变量：AC-002 于 2026-10-26T03:34Z 转 achieved 之后，又分别被 `14fec37`（删脚本未删映射）与 `d7448a8`（docs lane 提交计划态路径）重新打成假。本轮是**新的红类**：既不是并发隔离，也不是 TEST_MAP，而是文档 lane 的提交把一个按设计只描述未来产物的计划正本带进 main；此前任何一次修复都不覆盖这一类。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：同一处红已有在飞归属 —— `gap-ac-044-full-suite-green`（ready，`goal_ac: AC-044`）给 `scripts/docs-consistency.mjs` 加 `planned-start` / `planned-end` 块级口径（块内只豁免代码路径存在性，未闭合/嵌套/孤立标记 fail-closed）并给 `docs/PHASE_REFACTOR.md` 打块标记；`gap-ac-007-stability-gate-deterministic-vs-flaky`（todo，AC-007）是跨轮失败集的确定性/偶发分类，其 criterion 是 `node scripts/check-stability.mjs`（3 轮、`--test-concurrency=2`）；`gap-ac-049-phase-doc-ownership-sync`（AC-049）是 doc-ownership 判据单一入口 + §7 漂移钉子；`gap-ac-045-static-checks-green`（AC-045）是静态四命令单点定义 + CI 接线。本任务不重复上述任何一处编辑，只承担 AC-002 自己的见证面：**不带并发参数**的裸命令 `node --test tests/*.test.mjs`（默认并发 = `availableParallelism()-1`）连续 3 次 exit 0，与四者的验收命令都不同，读数不可互相替代；`goal_ac` 是单值标量，折叠进任一任务都会让 AC-002 失去独立、可被 driver 逐字复算的归属。本任务 Touches 只有自身任务文件，与四者零文件重叠。`task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-002-full-suite-3x-reverify-planned-blocks.md --json` 返回 `peers: []`、`mentions: []`，无合并候选。

## Plan

1. 确认 `gap-ac-044-full-suite-green` 的修复提交已在被评估 HEAD 的祖先链中：`git merge-base --is-ancestor <fix-commit> HEAD` exit 0，并记下该提交 hash；不要只凭它在本任务 worktree 里绿就当作已生效。
2. 在该 HEAD 上逐字执行 AC-002 criterion 一轮，随后连续再执行两轮，共 3 轮；每轮记录 `# tests / # pass / # fail / # duration_ms`、`not ok` 条数与退出码。
3. 任一轮非零：立即抓取 `not ok` 用例名与失败文本，不得以「重跑绿了」收尾。若残留失败仍是 planned 块/计划态文档机制，登记证据并回写 `gap-ac-044-full-suite-green` 的 Notes，不要在本任务并发编辑其 Touches 文件；若是不同机制（端口/时序/并发偶发），先把对应文件加入本任务 `## Touches`，再动手修。
4. 不改产品行为、玩法与数值；不改 `scripts/docs-consistency.mjs` / `tests/docs-consistency.test.mjs` / `docs/PHASE_REFACTOR.md`（AC-044 lane）、`scripts/check-stability.mjs`（AC-007 lane）、`package.json` / `.github/workflows/ci.yml`（AC-045/AC-049 lane）；不传 `--rounds` / `--concurrency`。

## AC

- [x] 逐字执行 AC-002 criterion（含 `for i in 1 2 3` 循环）exit 0，stderr 无 `CAUSE=`
- [x] 在被评估 HEAD 上独立连续 3 轮 `node --test tests/*.test.mjs` 均 exit 0，每轮 `# tests / # pass / # fail` 已写入 Notes
- [x] `git merge-base --is-ancestor <AC-044 修复提交> HEAD` exit 0，Notes 写明该提交 hash
- [x] Notes 记录本轮失败面证据：`not ok 322` 用例名与 14 条「代码路径不存在」原文，并说明确定性（同一命令复跑两次同为 `not ok 6`）
- [x] 若出现非 planned 块机制的残留失败，对应源文件已出现在本任务 `## Touches`，且 Notes 记录失败文本与根因（未触发：3 轮 + `npm test` 均 0 fail，无残留失败，Touches 无需扩容）

## DoD

- [x] 三轮读数可被 driver 独立复算：Notes 同时给出命令原文、每轮 stdout 尾部（`# tests / # pass / # fail / # duration_ms`）与退出码
- [x] 被评估 HEAD 已提交，`git status --short` 无本任务相关未提交改动
- [x] 同一 HEAD 上 `npm test` 全量绿（≥1679 项，0 fail）
- [x] 门禁语义未被放宽：`scripts/check-stability.mjs` / `scripts/test-stability.mjs` 不在本任务 diff 中，未调 `--rounds` / `--concurrency`
- [x] 零运行时/玩家可见改动、零第三方依赖；本任务 diff 不含 AC-044 / AC-007 / AC-045 / AC-049 任一 lane 的文件
- [x] Notes 写清取舍：为什么 AC-002 的见证不折叠进 AC-044 / AC-007 任务（criterion 命令与并发参数不同；`goal_ac` 单值标量）

## Touches

- `tasks/gap-ac-002-full-suite-3x-reverify-planned-blocks.md`

## Notes

复用约定：AC-002 的见证任务是**只读复验**形态（与 `gap-ac-002-full-suite-3x-green`、`gap-ac-002-full-suite-3x-reverify` 一致）——Touches 只含自身任务文件，机制修复由在飞任务拥有，本任务只负责在依赖落地后的 HEAD 上逐字跑 criterion 三轮并把读数写进 Notes。此后每次 AC-002 复验先确认在飞根因任务已落地，再只读见证，不要重复其编辑；若残留失败换成了新机制，则按 Plan 第 3 条先登记证据再扩 Touches。

### 本轮复验（2026-10-28，被评估 HEAD `15fca2a`）

**依赖落地确认**：`git merge-base --is-ancestor 6103528 HEAD` exit 0。AC-044 修复提交 `6103528 feat(docs): docs-consistency 支持计划态产物的块级豁免（AC-044）` 已在被评估 HEAD `15fca2a29b114a18acdb6d18eec54cd94d8f38d8` 的祖先链中（同一 hash 也在 `main` / `develop` 上）。不是「在我 worktree 里绿」就算数，是先验过祖先关系再跑。

**判据逐字执行**（criterion 原文，cwd = 本任务 worktree）：
```
for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo "CAUSE=full suite failed on run $i" >&2; exit 1; }; done
```
exit 0，stderr 无 `CAUSE=`；三轮合计 `real 0m9.223s`。

**独立三轮读数**（同一 HEAD，命令原文 `node --test tests/*.test.mjs`，默认并发 = `availableParallelism()-1`，**未**传 `--rounds` / `--concurrency`）：

| 轮 | 退出码 | # tests | # pass | # fail | # duration_ms | `not ok` 条数 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 1684 | 1684 | 0 | 2774.117736 | 0 |
| 2 | 0 | 1684 | 1684 | 0 | 2708.89656 | 0 |
| 3 | 0 | 1684 | 1684 | 0 | 2689.970883 | 0 |

每轮 stdout 尾部原文（三轮同形，仅 `# duration_ms` 如上表）：`1..1684` / `# tests 1684` / `# suites 0` / `# pass 1684` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# todo 0` / `# duration_ms <上表>`。

**`npm test`（= `node --test --test-concurrency=2 tests/*.test.mjs`）**：exit 0，`# tests 1684 / # pass 1684 / # fail 0`，`# duration_ms 24611.821526` —— 满足 DoD「≥1679 项、0 fail」。

**合入 develop 后同一 HEAD 复核**（worktree `git merge --no-edit develop` 为 fast-forward，`15fca2a..4c2aa23`，delta 仅 `tasks/gap-ac-002-full-suite-3x-reverify-planned-blocks.md` 与 `tasks/gap-ac-044-full-suite-reverify-landed-fix.md` 两个任务文件）：HEAD `4c2aa23` 上再跑三轮 `node --test tests/*.test.mjs`，退出码 0/0/0，三轮均 `# tests 1684 / # pass 1684 / # fail 0`、`not ok` 0 条，`# duration_ms` 依次 `2846.514772` / `2714.915861` / `16050.914237`；同 HEAD `npm test` exit 0，`# tests 1684 / # pass 1684 / # fail 0`，`# duration_ms 24410.32873`。即 fan-in 实际评估的合并后 HEAD 也连续三轮 0 失败。

**本轮失败面证据（复验前基线）**：
- 全量套件唯一失败点：`not ok 322 - 真实仓库文档一致：check:docs 的判定为通过`（`tests/docs-consistency.test.mjs:133`），读数 `# tests 1679 / # pass 1678 / # fail 1`（HEAD `4c91312`，criterion 首轮即非零）。
- 确定性——本 worker 在 `4c91312` 的 detached worktree 上独立复现（`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node --test tests/docs-consistency.test.mjs` 连跑两次）：两次均 exit 1、均 `not ok 6 - 真实仓库文档一致：check:docs 的判定为通过`、读数同为 `# tests 6 / # pass 5 / # fail 1`。文件单跑是 `not ok 6`、全量跑是 `not ok 322`，只是同一用例在各自运行里的序号不同；用例名与失败文本一致，故不是并发/时序偶发。
- 14 条「代码路径不存在」原文（全部指向 `docs/PHASE_REFACTOR.md`；该文件 §6 按设计按任务 id 指派**尚未创建**的产物，这正是与 `docs-consistency.mjs`「反引号路径必须现在存在」口径冲突之处）：
```
docs/PHASE_REFACTOR.md:5: 代码路径不存在 -> scripts/structure-budget.mjs
docs/PHASE_REFACTOR.md:40: 代码路径不存在 -> scripts/structure-budget.mjs
docs/PHASE_REFACTOR.md:68: 代码路径不存在 -> scripts/structure-budget.allow.d/
docs/PHASE_REFACTOR.md:75: 代码路径不存在 -> scripts/structure-budget.mjs
docs/PHASE_REFACTOR.md:75: 代码路径不存在 -> scripts/structure-budget.allow.d/
docs/PHASE_REFACTOR.md:75: 代码路径不存在 -> tests/structure-budget.test.mjs
docs/PHASE_REFACTOR.md:76: 代码路径不存在 -> scripts/visual-parity.mjs
docs/PHASE_REFACTOR.md:76: 代码路径不存在 -> docs/reviews/refactor-baseline.json
docs/PHASE_REFACTOR.md:77: 代码路径不存在 -> scripts/check-sim-determinism.mjs
docs/PHASE_REFACTOR.md:77: 代码路径不存在 -> docs/reviews/sim-determinism.json
docs/PHASE_REFACTOR.md:99: 代码路径不存在 -> tests/lib/visual/
docs/PHASE_REFACTOR.md:110: 代码路径不存在 -> scripts/structure-budget.mjs
docs/PHASE_REFACTOR.md:113: 代码路径不存在 -> scripts/check-sim-determinism.mjs
docs/PHASE_REFACTOR.md:114: 代码路径不存在 -> scripts/visual-parity.mjs
```
- 修复后同一断言在本 HEAD 转绿：`node --test tests/docs-consistency.test.mjs` → `# tests 11 / # pass 11 / # fail 0`，原失败用例现为 `ok 11 - 真实仓库文档一致：check:docs 的判定为通过`（用例总数由 6 增至 11，是 AC-044 提交给该测试文件新增了 planned 块口径的用例，不是本任务改的）。

**残留失败**：无。3 轮独立读数 + `npm test` 全部 0 fail，未出现「非 planned 块机制」的新失败，故 Touches 不扩容（对应 AC 以「未触发」满足）。

**取舍：为什么 AC-002 的见证不折叠进 AC-044 / AC-007**：三者判据命令与并发参数都不同——AC-002 是裸 `node --test tests/*.test.mjs`（默认并发）连跑 3 次；AC-007 是 `node scripts/check-stability.mjs`（3 轮、`--test-concurrency=2`，产出跨轮失败集的确定性/偶发分类）；AC-044 的判据是 planned 块口径本身（`scripts/docs-consistency.mjs` 的块标记语义）。读数不可互相替代，且 `goal_ac` 是单值标量，折叠会让 AC-002 失去独立、可被 driver 逐字复算的归属。本任务除自身任务文件外零代码 diff，不与任一 lane 重叠。
