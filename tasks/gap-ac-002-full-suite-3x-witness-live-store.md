---
id: gap-ac-002-full-suite-3x-witness-live-store
title: AC-002 复验：全量套件唯一红点来自 phase-refactor-sync 的反空转见证耦合活任务库，改为 fixture 正对照
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo
    "CAUSE=full suite failed on run $i" >&2; exit 1; }; done
goal_ac: AC-002
---
## Proposal

AC-002（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo "CAUSE=full suite failed on run $i" >&2; exit 1; }; done`，expect `exit 0`。2026-10-29 在 HEAD `6c7cfb2`（`main` == `develop`，`git rev-list --count main...develop` = 0）上按原命令直接复跑，run 1 即非零退出；独立连跑 3 轮读数完全一致，**不是并发/时序偶发**：

| 轮 | 退出码 | # tests | # pass | # fail | `not ok` |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1747 | 1746 | 1 | 1 |
| 2 | 1 | 1747 | 1746 | 1 | 1 |
| 3 | 1 | 1747 | 1746 | 1 | 1 |

三轮唯一失败点同一：`not ok 975 - §7 覆盖 AC-043…AC-049、open 任务 goal_ac 都落在表内、判据有单一入口（真实仓库）`（`tests/phase-refactor-sync.test.mjs:131`），断言消息 `真实任务库里应至少有一个 open 的 AC-043…AC-049 任务`（`tests/phase-refactor-sync.test.mjs:137`）。

**根因：反空转见证把「阶段进行中」的瞬态事实写成了永久不变量**

`tests/phase-refactor-sync.test.mjs:135-140` 的见证块是：

```js
const openGoalTasks = repo.tasks.filter((task) => task.goalAc && PHASE_AC_SET.has(task.goalAc) && isOpen(task.status));
assert.ok(openGoalTasks.length > 0, '真实任务库里应至少有一个 open 的 AC-043…AC-049 任务');
```

它要求**活任务库**里此刻存在至少一个未关闭、且 `goal_ac` 落在 AC-043…AC-049 的任务。实测（按同一套 `parseStatus` / `parseGoalAc` / `isOpen` 口径扫描 `tasks/*.md` 98 个文件）：`goal_ac` 落在 AC-043…AC-049 的任务共 **11 个，全部 `done`，open 计数 = 0** —— `gap-ac-044-full-suite-green`、`gap-ac-044-full-suite-reverify-landed-fix`、`gap-ac-045-static-checks-green`、`gap-ac-049-phase-doc-ownership-sync`，以及 7 个 `goal_ac: AC-043` 的 `refactor-*`。于是 `openGoalTasks.length > 0` 打红，`checkPhaseRefactorSync(realRepo())` 之前的契约断言（`:133` 的 `deepEqual(problems, [])`）其实是**通过**的——§7 表本身没有漂移，红的只有这条「必须还有 GOAL-009 任务在飞」的存量断言。

**为什么它此刻才红、并且不会再自己变绿**：见证由 `a88f702 feat(docs): AC-049 判据收成 check:doc-ownership 单一入口 + §7 映射漂移钉子（AC-049）`（2026-10-28 22:36:31）引入，写进去时 GOAL-009 仍在进行，故当时为真；`6c7cfb2 tasks: 翻 refactor-closeout done（driver 机械 fan-in）`（2026-10-29 01:56:06）把最后一个 `goal_ac: AC-043` 的任务翻成 `done`，见证计数归零。GOAL-009 已完成，此后不会再有 open 的 AC-043…AC-049 任务——**这是一条永远无法再满足的断言，不存在任何正常任务状态下让它变绿的路径**，除非刻意长期保留一个只为哄断言而存在的 open 任务（那会把任务库变成测试夹具，且下次它被做完又会红）。

**为什么此前的修复都没有守住**

声明 `goal_ac: AC-002` 的三个任务全部 `done`：`TEST-001` / `TEST-002` 修的是端口冲突、临时库与启动校验造成的并发串扰；`gap-ac-002-full-suite-3x-green` 修的是 revert 残留的 `TEST_MAP` 失效映射；`gap-ac-002-full-suite-3x-reverify` 与 `gap-ac-002-full-suite-3x-reverify-planned-blocks` 是只读复验（Touches 只含自身），见证的是别人落地后那一刻的绿。四者都只保证「某个具体机制不再把套件打红」，都不构成不变量。

更关键的是机制复用：`gap-phase-ac-mapping-decouple-live-task-store`（done，`goal_ac: AC-007`）已经把**同一个反模式**修过一次——它在 `tests/docs-phase-sync.test.mjs` 里删掉了 `openPhaseTasks.length > 0` 这类「阶段进行中」存量断言，改由 fixture 正/反例证明判定不空转。但那次修复只落在 `docs-phase-sync.test.mjs` 一个文件上，没有扫同类文件；随后 `a88f702` 在**另一个文件** `tests/phase-refactor-sync.test.mjs` 里原样写回了第二份，而这个文件当时不在任何在飞任务的修口内。本轮红点就是这份新副本到期——这正是「活任务库耦合」类红点会周期性复发的构造原因：修一处、新写一处，就再红一次。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：`gap-phase-ac-mapping-decouple-live-task-store`（done，AC-007）修的是 `tests/docs-phase-sync.test.mjs` 里同一反模式的**另一份副本**，其机制、文件与判据均不同（它的 acceptance 是 `node --test tests/docs-phase-sync.test.mjs`，本任务是 `for i in 1 2 3; do node --test tests/*.test.mjs …`），且它已关闭、无法再承接本文件；`gap-ac-049-phase-doc-ownership-sync`（done，AC-049）是这份见证的**引入者**，不是承接者，不能回填；`gap-goal-009-debt-clear-ac`（needs-human，提案新增 AC-051）虽在 Touches 里也列了 `tests/phase-refactor-sync.test.mjs`，但它的机制是「给 §7 补一行 AC-051 + package.json 加判据」，与本任务的见证解耦没有任何重叠，且它停在 needs-human 未派发；`gap-ac-007-stability-gate-deterministic-vs-flaky`（done）是跨轮失败集的确定性/偶发分类，判据是 `scripts/check-stability.mjs`。本任务不重复上述任何一处编辑。`task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tests/phase-refactor-sync.test.mjs --touches tasks/gap-ac-002-full-suite-3x-witness-live-store.md --json` 返回 `peers: []`、`mentions: []`、`substantiveInputs: []`，无合并候选。`goal_ac` 是单值标量，折叠进 AC-007 / AC-049 任一任务都会让 AC-002 失去独立、可被 driver 逐字复算的归属。

## Plan

1. 先在被评估 HEAD 上逐字执行 criterion 一轮，确认红点仍是 `tests/phase-refactor-sync.test.mjs:137` 这一条；若已变成别的机制，停止本 Plan 并先登记证据、扩 Touches 后再动手（不得把新机制混进本次修复）。
2. 在 `tests/phase-refactor-sync.test.mjs` 里删掉 `:135-137` 的活任务库存量见证（`openGoalTasks.length > 0`），**不要**用「留一个 open 任务哄断言」或「把 `isOpen` 放宽成含 done」的方式让它变绿——后者会让 (b) 判定对 done 任务也生效，是语义变更，不是修 bug。
3. 用 fixture 正对照补上不空转证明（照 `tests/docs-phase-sync.test.mjs` 的既有做法：真实仓库用例与 fixture 正/反例共用同一个 `checkPhaseRefactorSync` 纯函数）：新增一条正对照用例，输入为「完整真实 §7 + 一个 `{ id: 'fixture-open', status: 'ready', goalAc: 'AC-048' }` 的 open fixture 任务」，断言 `checkPhaseRefactorSync` 返回 `[]`；既有的负对照（删 §7 的 AC-048 行 + 同一 open fixture → 指名该任务）与 done 不报用例保持不动，三者合起来即证明 (b) 既会打红也不会空跑，且完全不依赖活任务库存量。
4. 保留 `:138-140` 的 `for (const ac of PHASE_ACS) assert phaseMarkdown.includes(ac)` 与 `:133` 的真实仓库 `deepEqual(problems, [])`——真实仓库契约判定必须继续生效，不能被顺手删掉或放宽。
5. 只改 `tests/phase-refactor-sync.test.mjs`：不新增测试文件（因此无需登记 `scripts/test-changed.mjs` 的 `TEST_MAP`）；不碰 `docs/PHASE_REFACTOR.md`、`package.json`、`scripts/check-doc-ownership.mjs`（分别是 AC-049 / AC-051 的 lane）。
6. 在修复后的 HEAD 上逐字执行 criterion 三轮 + `npm test`，把每轮读数写进 Notes。
7. 归因说明写进 Notes：本条断言的引入提交（`a88f702`）、归零提交（`6c7cfb2`），以及它与 AC-007 那份同型修复的关系（同反模式、不同文件、未扫描）。

## AC

- [ ] `node --test tests/phase-refactor-sync.test.mjs` exit 0，且 `# tests` ≥ 11（现有 10 条 + 新增 fixture 正对照，证明是补见证而非删测试）
- [ ] `grep -n 'openGoalTasks' tests/phase-refactor-sync.test.mjs` exit 1（无命中），即活任务库存量见证已移除
- [ ] 新增的 fixture 正对照用例在修复后 HEAD 上绿：完整真实 §7 + `{ id: 'fixture-open', status: 'ready', goalAc: 'AC-048' }` → `checkPhaseRefactorSync` 返回 `[]`
- [ ] 既有负对照仍绿且未被削弱：删 §7 的 AC-048 行 + 同一 open fixture → problems 含 `open 任务 fixture-open 的 goal_ac AC-048 未出现在 §7`；同一任务改 `done` 后不报（`node --test tests/phase-refactor-sync.test.mjs` 中这两条 `ok`）
- [ ] 真实仓库契约未被放宽：`checkPhaseRefactorSync` 对真实 §7 仍返回 `[]`，`npm run check:doc-ownership` exit 0（`node scripts/check-doc-ownership.mjs && node scripts/docs-consistency.mjs`）
- [ ] 在修复后 HEAD 上逐字执行 criterion（`for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || …`）exit 0，stderr 无 `CAUSE=`
- [ ] 本任务 diff 只含 `tests/phase-refactor-sync.test.mjs` 与 `tasks/gap-ac-002-full-suite-3x-witness-live-store.md`（`git diff --name-only <base>..HEAD` 逐字核对）

## DoD

- [ ] 三轮读数可被 driver 独立复算：Notes 给出命令原文、每轮 `# tests / # pass / # fail / # duration_ms` 与退出码；同 HEAD 另跑 `npm test` exit 0
- [ ] 红→绿因果可独立复现：Notes 同时记录修复前在 `6c7cfb2` 上的读数（`# fail 1`，`not ok 975`，断言消息原文）与修复后读数，并给出修复前后 `node --test tests/phase-refactor-sync.test.mjs` 的用例数对比
- [ ] 不靠删检查达标：Notes 附三条对照用例（open fixture 正对照 / 删行负对照 / done 不报）在修复后 HEAD 上的 `ok` 行，说明 (b) 判定的不空转证明从「活任务库存量」搬到了「fixture」，覆盖面不降
- [ ] 反例实测：Notes 记录一次「把 §7 里 AC-048 那行临时删掉 + 保留 fixture」仍打红的实测（可临时改 fixture 输入，不提交），证明正对照不是恒真断言
- [ ] Notes 写清为何此前修复没守住（AC-007 那份同型修复只落一个文件、`a88f702` 在另一文件写回第二份、`6c7cfb2` 使其到期），以及为何不能靠保留一个 open 的 AC-043 任务哄断言
- [ ] 无产品行为、玩法、数值改动；无第三方依赖；`git status --short` 无本任务相关未提交改动

## Touches

- `tests/phase-refactor-sync.test.mjs`
- `tasks/gap-ac-002-full-suite-3x-witness-live-store.md`

## Notes

立案依据（2026-10-29，本 agent 在被评估 HEAD 上直接测量，非台账陈旧尾巴）：`main` == `develop` == `6c7cfb2`。三轮 `node --test tests/*.test.mjs` 均为 `# tests 1747 / # pass 1746 / # fail 1`、退出码 1、唯一 `not ok 975`，失败文本 `真实任务库里应至少有一个 open 的 AC-043…AC-049 任务`。按 `scripts/check-doc-ownership.mjs` 的 `CLOSED_STATUSES = ['done','superseded','retired','rejected']` 口径扫描，AC-043…AC-049 的 11 个任务全部 done、open 计数 0。

修复形态参照 `gap-phase-ac-mapping-decouple-live-task-store`（AC-007，done）在 `tests/docs-phase-sync.test.mjs` 里做过的同一动作：删掉「open 任务存量 > 0」的瞬态见证，用 fixture 正/反例证明判定会打红且不空跑。本任务是把同一动作补到尚未被覆盖的第二个文件上。
