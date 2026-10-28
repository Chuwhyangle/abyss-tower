---
id: gap-ac-005-full-suite-reverify-witness-live-store
title: AC-005 复验：全量测试（--test-concurrency=2）exit 0 —— 根因（phase-refactor-sync
  反空转见证耦合活任务库）由在飞任务拥有，本任务只做只读见证
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test --test-concurrency=2 tests/*.test.mjs
depends_on:
  - gap-ac-002-full-suite-3x-witness-live-store
goal_ac: AC-005
---
## Proposal

AC-005（GOAL-001「上游基线合并与开发基线确认」→「全量测试通过（基线确认）」）的 criterion 逐字为 `node --test --test-concurrency=2 tests/*.test.mjs`，expect `exit 0`。该 AC 曾于 2026-10-26T03:52:35Z 转 achieved；本轮立案前，本 agent 在被评估 HEAD `93c7601`（`main` == `develop` == `93c7601`，`git rev-list --count main...develop` = 0）上**直接逐字执行**该命令一次，不是抄台账尾巴：

```
$ node --test --test-concurrency=2 tests/*.test.mjs
not ok 975 - §7 覆盖 AC-043…AC-049、open 任务 goal_ac 都落在表内、判据有单一入口（真实仓库）
  failureType: 'testCodeFailure'
  error: '真实任务库里应至少有一个 open 的 AC-043…AC-049 任务'
  location: '/data/home/wenhao/abyss-tower/tests/phase-refactor-sync.test.mjs:131:1'
1..1747
# tests 1747
# pass 1746
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 24771.014445
$ echo $?
1
```

`grep -c '^not ok'` = **1**，唯一失败点即上例。判据此刻为假，且失败与产品代码无关。

**根因（本任务不重复修复，修口属于在飞任务）**：`tests/phase-refactor-sync.test.mjs:135-137` 的「反空转见证」要求**活任务库**里此刻至少存在一个未关闭、且 `goal_ac` 落在 AC-043…AC-049 的任务：

```js
const openGoalTasks = repo.tasks.filter((task) => task.goalAc && PHASE_AC_SET.has(task.goalAc) && isOpen(task.status));
assert.ok(openGoalTasks.length > 0, '真实任务库里应至少有一个 open 的 AC-043…AC-049 任务');
```

它把「GOAL-009 阶段进行中」这一**瞬态事实**写成了永久不变量。实测（按同一套 `parseStatus` / `parseGoalAc` / `isOpen` 口径扫描 `tasks/*.md` 99 个文件）：`goal_ac` 落在 AC-043…AC-049 的任务共 11 个，**全部 `done`，open 计数 = 0**——`gap-ac-044-full-suite-green`、`gap-ac-044-full-suite-reverify-landed-fix`、`gap-ac-045-static-checks-green`、`gap-ac-049-phase-doc-ownership-sync`，以及 7 个 `goal_ac: AC-043` 的 `refactor-*`。`6c7cfb2`（`tasks: 翻 refactor-closeout done（driver 机械 fan-in）`，2026-10-29T01:56:06+08:00）把最后一个翻成 `done` 后计数归零，此后不存在任何正常任务状态能让它变绿。注意 `:133` 的 `deepEqual(checkPhaseRefactorSync(realRepo()), [])` 其实是**通过**的——§7 表没有漂移，红的只有这条「必须还有 GOAL-009 任务在飞」的存量断言。

该根因的修复（删掉瞬态见证、用 fixture 正对照补不空转证明）已由在飞任务 `gap-ac-002-full-suite-3x-witness-live-store`（status=todo，`goal_ac: AC-002`）在其 Plan 第 2-3 步、AC 第 1-4 条完整拥有，并已在 `task-granularity-advice.js` 的 Touches 面上认领 `tests/phase-refactor-sync.test.mjs`。本任务以顶层 `depends_on` 声明该依赖，**不重做、也不碰** `tests/phase-refactor-sync.test.mjs`（CLAUDE.md「禁止多个代理同时改同一文件」）。

**为何此前的 AC-005 修复没有守住**：`goal_ac: AC-005` 的前序任务全部只修一个具体机制，都没有建立不变量——`gap-test-changed-stale-map-entries`（done）清理 revert 残留的 `scripts/test-changed.mjs` TEST_MAP 失效映射；`gap-ac-005-full-suite-reverify`（done）与 `gap-ac-005-full-suite-reverify-planned-blocks`（done）是只读见证，读数只在别人落地那一刻为真；`gap-goal-001-exit-condition-test-coverage`（superseded）只裁定目标库 AC 集合，验收是 grep `goals/`，不落在仓库代码上。更根本的是**同反模式蔓延**：`gap-phase-ac-mapping-decouple-live-task-store`（done，AC-007）已在 `tests/docs-phase-sync.test.mjs` 删过一次「open 任务存量 > 0」见证，但只落一个文件；随后 `a88f702` 在 `tests/phase-refactor-sync.test.mjs` 原样写回第二份，`6c7cfb2` 使其到期。只要「活任务库耦合」还写在新文件里，每一次 AC-005 转绿都只是下一次变红之前的间隙。

<!-- dedup-ref --> 机制去重（mechanism-based，非症状关键词）：任务库中声明 `goal_ac: AC-005` 的任务共四笔，状态为 `done` / `done` / `done` / `superseded`，**没有任何在飞（todo/ready/needs-human）任务声明 AC-005**，故本次是新立案而非重复。同根因的在飞任务 `gap-ac-002-full-suite-3x-witness-live-store`（todo）拥有根因修复但 `goal_ac: AC-002`、criterion 为裸 `node --test tests/*.test.mjs` 连跑 3 次；本任务只承担 AC-005 的 `--test-concurrency=2` 单次读数面——`goal_ac` 是单值标量，`extra.acceptance` 只放得下一条命令，折叠进任一任务都会让 AC-005 重新落成无主缺口。`gap-goal-009-debt-clear-ac`（needs-human）的 Touches 也含 `tests/phase-refactor-sync.test.mjs`，但其机制是「§7 补一行 AC-051 + package.json 加判据」，与本任务的见证解耦零重叠。本任务 Touches 只含自身任务文件，与上述任一任务零文件重叠；`task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-005-full-suite-reverify-witness-live-store.md --json` 返回 `peers: []`、`mentions: []`、`substantiveInputs: []`。结论：独立立案、只读见证、不合并。

## Plan

1. 先确认依赖任务的修复已进入被评估 HEAD 的祖先链（以 `gap-ac-002-full-suite-3x-witness-live-store` 的 Notes 中记录的实际分支 HEAD sha 为准，`git merge-base --is-ancestor <sha> HEAD` exit 0）。不要让它在祖先链外开工——否则读数必然复现本轮失败，只是浪费一轮。
2. 在被评估 HEAD 上逐字执行 AC-005 criterion `node --test --test-concurrency=2 tests/*.test.mjs`，记录退出码与 `# tests / # pass / # fail / # duration_ms`，并把 `not ok` 计数一并记下。
3. 同一 HEAD 上紧接着再执行一次同一命令，确认不是「重跑才绿」；两次读数都写进 Notes。
4. 若仍有失败：先取唯一 `not ok` 用例名与完整失败文本，判断是否仍属「活任务库耦合 / 反空转见证」机制。属同一机制就回写依赖任务的 Notes，不得并发编辑 `tests/phase-refactor-sync.test.mjs`；属**不同**机制（端口/时序/偶发/其他断言）才允许动手，且必须先把对应源文件加进本任务 `## Touches` 再改，并在 Notes 记录失败文本与根因。
5. 不做任何产品行为、玩法、数值改动；不新增 skip / 豁免；不改 `package.json` 的 `test` 脚本、`scripts/check-stability.mjs`、`tests/phase-refactor-sync.test.mjs`。

## AC

- [ ] 在被评估 HEAD 上逐字执行 `node --test --test-concurrency=2 tests/*.test.mjs` exit 0 且 `# fail 0`、`grep -c '^not ok'` = 0；Notes 记录 HEAD sha 与完整 `# tests / # pass / # fail / # duration_ms`
- [ ] 同一 HEAD 上连续第二次执行同一命令同样 exit 0，Notes 给出第二次完整读数，证明不是偶然绿
- [ ] `git merge-base --is-ancestor <依赖任务修复提交> HEAD` exit 0；Notes 写明该 hash 与其来源任务 id `gap-ac-002-full-suite-3x-witness-live-store`
- [ ] 立案读数被复算：`git show 93c7601:tests/phase-refactor-sync.test.mjs | sed -n '135,137p'` 仍含 `openGoalTasks.length > 0`，且 `git show 93c7601:docs/PHASE_REFACTOR.md` 的 §7 不含漂移（`node scripts/check-doc-ownership.mjs` exit 0），说明本轮红点是任务库存量而非文档漂移
- [ ] 若出现非「活任务库耦合」机制的残留失败，对应源文件已先写进本任务 `## Touches`，且 Notes 记录失败文本与根因（本轮若全绿，本条以「无残留失败，Touches 未扩张」勾选）
- [ ] 本任务 diff 只含 `tasks/gap-ac-005-full-suite-reverify-witness-live-store.md`（`git diff --name-only <base>..HEAD` 逐字核对）

## DoD

- [ ] 读数可被 driver 独立复算：Notes 同时给出命令原文、每次 stdout 尾部与退出码；被评估 HEAD 已提交、`git status --short` 无本任务相关未提交改动
- [ ] 判定未被放宽：`tests/phase-refactor-sync.test.mjs`、`scripts/check-stability.mjs`、`package.json` 均不在本任务 diff 中；未新增 skip、忽略或豁免
- [ ] 不重复实现根因修复：`tests/phase-refactor-sync.test.mjs` 不在本任务 Touches，Notes 指明根因编辑的唯一归属者是 `gap-ac-002-full-suite-3x-witness-live-store`
- [ ] Notes 写清为何此前 AC-005 的三笔修复都没守住（各修一个具体机制、未建立不变量；同反模式在第二份副本重现且未扫描同类文件）
- [ ] Notes 写清取舍：为何 AC-005 的见证不折叠进 AC-002 / AC-007 任务（criterion 命令不同、`goal_ac` 单值标量、Touches 文件 lane 不同）

## Touches

- `tasks/gap-ac-005-full-suite-reverify-witness-live-store.md`

## Notes

立案依据（2026-10-29，本 agent 在被评估 HEAD `93c7601` 上直接测量，非台账陈旧尾巴）：`main` == `develop` == `93c7601`。逐字执行 `node --test --test-concurrency=2 tests/*.test.mjs` 一次：exit **1**，`# tests 1747 / # pass 1746 / # fail 1 / # duration_ms 24771.014445`，`grep -c '^not ok'` = **1**，唯一失败为 `not ok 975 - §7 覆盖 AC-043…AC-049、open 任务 goal_ac 都落在表内、判据有单一入口（真实仓库）`，断言消息 `真实任务库里应至少有一个 open 的 AC-043…AC-049 任务`，位置 `tests/phase-refactor-sync.test.mjs:131:1`。

任务库存量扫描（同 `scripts/check-doc-ownership.mjs` 的 `CLOSED_STATUSES = ['done','superseded','retired','rejected']` 口径）：`goal_ac` 落在 AC-043…AC-049 的 `tasks/*.md` 共 11 个，全部 `done`，open 计数 **0**。归零提交 `6c7cfb2`（2026-10-29T01:56:06+08:00）。

本轮是只读见证任务：不修根因、不改产品代码、不改门禁脚本，Touches 只含自身任务文件（与先例 `gap-ac-005-full-suite-reverify`、`gap-ac-044-full-suite-reverify-landed-fix` 一致）。复验读数待执行后补入。
