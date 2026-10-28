---
id: gap-ac-005-full-suite-reverify
title: AC-005 复验：全量测试（--test-concurrency=2）exit 0（根因修复由在飞任务拥有）
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
  - gap-phase-ac-mapping-decouple-live-task-store
goal_ac: AC-005
---
## Proposal

AC-005（GOAL-001「上游基线合并与开发基线确认」→「全量测试通过（基线确认）」）的 criterion 逐字为 `node --test --test-concurrency=2 tests/*.test.mjs`，expect `exit 0`。该 AC 曾于 2026-10-26T03:52:35Z 转 achieved；2026-10-28 在被评估 HEAD `6ffdf0acb1aeb3c3e60d9011e63343aca00a2acb` 上按原命令逐字复跑，**exit 1**，且同一命令复跑即复现——是确定性失败，不是偶发：

```
$ node --test --test-concurrency=2 tests/*.test.mjs
not ok 330 - AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务
  failureType: 'testCodeFailure'
  error: 'AC 映射缺少 open 任务 gap-feel-capture-scenarios（AC-020）'
# tests 1643
# pass 1642
# fail 1
# duration_ms 26109.33536
```

**根因（本任务不重复修复）**：`tests/docs-phase-sync.test.mjs:86` 的「AC 映射」用例枚举 `tasks/*.md` 里所有 open 且 `goal_ac` 落在 AC-011…AC-031 的任务，要求每个**任务 id** 逐字出现在 `docs/PHASE_FEEL_ART.md` §5 的静态映射表里。任务库经 `task_write`（自动提交）持续增长，而这张表只在阶段文档 lane 里手工维护，两者没有同步机制——于是每新立案一个 open 的 GOAL-005/006 任务，全量套件就红一次，与产品代码无关。同文件 `:104` 的 `openPhaseTasks.length > 0` 还把「阶段进行中」这一瞬态事实写成了永久不变量。本轮触发面是 `gap-feel-capture-scenarios`（`goal_ac: AC-020`）的立案与晋升。

解耦修复（抽出 `checkAcMapping`、把断言改为「open 任务的 `goal_ac` 必须已被 §5 映射」、删除瞬态断言）已由 `gap-phase-ac-mapping-decouple-live-task-store`（status=ready）在其 worktree 提交 `402707b` 完成，但该提交尚不在被评估 HEAD 的祖先链中：`main` 与 `develop` 都停在 `6ffdf0a`，`tests/docs-phase-sync.test.mjs` 里没有 `checkAcMapping`。本任务因此以 `depends_on` 声明该任务，不重复实现那处编辑——`tests/docs-phase-sync.test.mjs` 不在本任务 Touches。

<!-- dedup-ref --> **为什么上一轮 AC-005 的修复没有守住**：`gap-test-changed-stale-map-entries`（done）修的是另一条机制——revert 遗留的 `scripts/test-changed.mjs` TEST_MAP 失效映射，并把「映射目标测试必须存在」加固为断言。它让当时的套件重新转绿，但没有建立对「新立案任务即改红套件」这一机制的不变量；AC-005 转 achieved 后随 GOAL-001 离开 reverify scope，期间每一次 GOAL-005/006 立案或晋升都能把它重新变成假。另一起 `gap-goal-001-exit-condition-test-coverage`（superseded）只裁定目标库 AC 集合，验收是 grep `goals/`，不落在仓库代码上。

<!-- dedup-ref --> **去重与分工（机制去重，非重复立案）**：任务库中声明 `goal_ac: AC-005` 的两条前序任务分别为 `superseded` 与 `done`，没有任何在飞任务（todo/ready/needs-human）声明 AC-005，故本次是新立案而非重复。同根因的三条在飞任务读的是三条不同命令：`gap-phase-ac-mapping-decouple-live-task-store`（AC-007，`node scripts/check-stability.mjs`）拥有根因修复；`gap-ac-002-full-suite-3x-reverify`（AC-002，裸命令连续 3 次）拥有无并发参数的读数面；本任务只承担 AC-005 的 `--test-concurrency=2` 单次读数面。`goal_ac` 是单值标量，三者无法折叠进同一任务。

## Plan

1. 确认解耦修复提交已进入被评估 HEAD 的祖先链（`git merge-base --is-ancestor 402707b HEAD` exit 0）；若依赖任务最终产出的提交 hash 不同，以任务库中实际记录的 hash 为准。不要在修复未进入祖先链时开工——否则读数必然复现本轮失败，只是浪费一轮。
2. 在被评估 HEAD 上逐字执行 AC-005 criterion `node --test --test-concurrency=2 tests/*.test.mjs`，记录退出码与 `# tests / # pass / # fail / # duration_ms`。
3. 同一 HEAD 上连续再执行一次同一命令，确认不是「重跑才绿」；两次读数都写入 Notes。
4. 若仍有失败：先抓 `not ok` 用例名与完整失败文本，判断是否仍属 AC 映射/活任务库机制。属同一机制就回写依赖任务的 Notes（不并发编辑 `tests/docs-phase-sync.test.mjs`）；属不同机制（端口/时序/并发偶发）则先把对应源文件加入本任务 `## Touches` 再动手修，并在 Notes 记录失败文本与根因。
5. 不修改产品行为、玩法与数值；不改 `scripts/check-stability.mjs` / `scripts/test-stability.mjs`；判定参数只用 criterion 原文里的 `--test-concurrency=2`。

## AC

- [x] `node --test --test-concurrency=2 tests/*.test.mjs` 在被评估 HEAD 上 exit 0 且输出 `# fail 0`；Notes 记录 `# tests / # pass / # fail / # duration_ms` 与退出码
- [x] 同一 HEAD 上连续第二次执行同一命令同样 exit 0；Notes 给出第二次的完整读数，证明不是偶然绿
- [x] `git merge-base --is-ancestor 402707b HEAD`（或依赖任务实际记录的修复提交 hash）exit 0；Notes 写明该 hash 与其来源任务
- [x] Notes 收录本轮失败面证据：`not ok 330`、断言消息 `AC 映射缺少 open 任务 gap-feel-capture-scenarios（AC-020）`、`# tests 1643 / # pass 1642 / # fail 1`，并说明它在 HEAD `6ffdf0a` 上可确定性复现
- [x] 若出现非 AC 映射机制的残留失败，对应源文件已出现在本任务 `## Touches`，且 Notes 记录失败文本与根因（本轮无残留失败：两次读数均 `# fail 0`、`not ok` 计数 0，故 Touches 未扩张）

## DoD

- [x] 读数可被 driver 独立复算：Notes 同时给出命令原文、每次 stdout 尾部与退出码，且被评估 HEAD 已提交、`git status --short` 无本任务相关未提交改动
- [x] 判定未被放宽：`scripts/check-stability.mjs` / `scripts/test-stability.mjs` 不在本任务 diff 中，未引入 criterion 原文以外的并发或轮次参数
- [x] 不重复实现解耦修复：`tests/docs-phase-sync.test.mjs` 不在本任务 Touches，本任务 diff 不含该文件；解耦效果只作读数见证
- [x] Notes 写清取舍：为什么 AC-005 的见证不能折叠进 AC-002 / AC-007 的任务（criterion 命令不同；`goal_ac` 是单值标量）

## Touches

- `tasks/gap-ac-005-full-suite-reverify.md`

## Notes

本轮是只读见证任务：不修根因、不改产品代码、不改门禁脚本，Touches 只含自身任务文件（与先例 `gap-ac-002-full-suite-3x-reverify` 一致）。失败与产品代码无关，是套件读取可变任务库这一耦合的又一次显形。

2026-10-28 立案读数（HEAD `6ffdf0a`，逐字执行 AC-005 criterion）：`# tests 1643 / # pass 1642 / # fail 1`，exit 1，唯一失败为 `tests/docs-phase-sync.test.mjs:86` 的「AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务」。

### 复验读数（2026-10-28，worktree `task/gap-ac-005-full-suite-reverify`，被评估 HEAD `3b6f46c71a623e7c6f049d3478624830c8df496b`）

命令原文（两次逐字相同）：`node --test --test-concurrency=2 tests/*.test.mjs`

- **第 1 次**：exit **0**，stdout 尾部 `1..1658` / `# tests 1658` / `# suites 0` / `# pass 1658` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# todo 0` / `# duration_ms 24148.417727`；`grep -c '^not ok'` = 0
- **第 2 次**（同一 HEAD、同一 worktree，紧接执行）：exit **0**，stdout 尾部 `1..1658` / `# tests 1658` / `# pass 1658` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# todo 0` / `# duration_ms 24399.544298`；`grep -c '^not ok'` = 0
- 两次之间 HEAD 未变（`git rev-parse HEAD` 前后均为 `3b6f46c`），`git status --short` 为空。

### 依赖修复的祖先链（AC 3）

`git merge-base --is-ancestor 402707b HEAD` → exit **0**（同时 `--is-ancestor 402707b develop` → exit 0）。该 hash 的来源任务是 `gap-phase-ac-mapping-decouple-live-task-store`（`goal_ac: AC-007`，现 status=done），其 Notes 记录最终分支 HEAD 即 `402707b`（含 `checkAcMapping` 解耦与 5 条 fixture 正/反例）。Proposal 里「该提交尚不在被评估 HEAD 的祖先链中：`main` 与 `develop` 都停在 `6ffdf0a`」是**立案当时的快照，现已过期**：本任务开工时 main/develop/HEAD 均为 `3b6f46c`，已经含有该修复。

### 失败面证据与确定性复现（AC 4）

立案读数（HEAD `6ffdf0a`）：`not ok 330 - AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务`，`failureType: 'testCodeFailure'`，`error: 'AC 映射缺少 open 任务 gap-feel-capture-scenarios（AC-020）'`，`# tests 1643 / # pass 1642 / # fail 1`，exit 1。

本轮不是只抄立案结论：用 **该 HEAD 的 detached worktree**（`git worktree add --detach /tmp/ac005-oldwt 6ffdf0a` + `worktree-include.sh`，测完 `git worktree remove --force`）逐字重跑同一命令，得到**逐字一致的失败**——exit **1**，`not ok 330` 同名同消息，`# tests 1643 / # pass 1642 / # fail 1`，`# duration_ms 24223.907372`，失败位置 `tests/docs-phase-sync.test.mjs:86:1`。⇒ 确定性失败，不是偶发。

静态面同样一致（三处都是已提交事实，不含运行时随机性）：`git show 6ffdf0a:tasks/gap-feel-capture-scenarios.md` 为 `status: ready` + `goal_ac: AC-020`；`git show 6ffdf0a:docs/PHASE_FEEL_ART.md | grep -c gap-feel-capture-scenarios` = **0**（§5 未列该 id）；`git show 6ffdf0a:tests/docs-phase-sync.test.mjs` 第 104-107 行仍是旧的逐任务 id 断言 `assert.ok(mapping.includes(task.id), …)`。三者相乘即必红。

转绿机制也对得上：`3b6f46c` 的 `tests/docs-phase-sync.test.mjs` 已是 `checkAcMapping` 契约（open 任务只要求其 `goal_ac` 已被 §5 映射，不再要求任务 id 逐字进表）；用例数 1643 → 1648（解耦任务新增 5 条 fixture）→ 1658（此后其他已落地任务新增用例）。

### 非 AC 映射机制的残留失败（AC 5）

无。两次读数均 `# fail 0`、`not ok` 计数 0，故未向 Touches 新增任何源文件。

### 取舍：AC-005 的见证为什么不折叠进 AC-002 / AC-007 任务（DoD 4）

- criterion 是**三条不同命令**：AC-005 = `node --test --test-concurrency=2 tests/*.test.mjs`（单次、并发 2）；AC-002 = 裸 `node --test tests/*.test.mjs` 连续 3 次（无并发参数）；AC-007 = `node scripts/check-stability.mjs`（3 轮门禁脚本）。一个任务的 `extra.acceptance` 只放得下一条命令，混装会让门禁只验其中一条。
- `goal_ac` 是**单值标量**（Provider 契约），一个任务只能声明一个 AC，无法同时承载 AC-005 与 AC-002/AC-007 的判定权。
- 分工：根因修复在 `gap-phase-ac-mapping-decouple-live-task-store`（AC-007，done）；本任务只做 AC-005 的读数见证，`tests/docs-phase-sync.test.mjs` 不在 Touches、diff 不含该文件（DoD 3）。

### 未放宽判定 / 不重复实现解耦修复（DoD 2、DoD 3）

本任务 diff 只有 `tasks/gap-ac-005-full-suite-reverify.md`；`scripts/check-stability.mjs`、`scripts/test-stability.mjs`、`tests/docs-phase-sync.test.mjs` 均不在 diff 中。判定参数只用 criterion 原文的 `--test-concurrency=2`，未引入 `--rounds` 或其他并发值。