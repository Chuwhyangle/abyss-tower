---
id: gap-ac-002-full-suite-3x-reverify
title: AC-002 复验：验证全量测试连续 3 次 0 失败（活任务库耦合修复由在飞任务拥有）
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
depends_on:
  - gap-phase-ac-mapping-decouple-live-task-store
goal_ac: AC-002
---
## Proposal

AC-002（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo "CAUSE=full suite failed on run $i" >&2; exit 1; }; done`，expect `exit 0`。2026-10-28 在 HEAD `6cb6e17` 上按原命令直接复跑，run 1 即非零退出：`# tests 1643 / # pass 1642 / # fail 1`。该条件当前为假，且是确定性失败而非偶发——唯一失败点为 `tests/docs-phase-sync.test.mjs:86`「AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务」，断言消息 `AC 映射缺少 open 任务 gap-feel-capture-scenarios（AC-020）`。

**根因（本任务不重复修复）**：`tests/docs-phase-sync.test.mjs:103-107` 枚举 `tasks/*.md` 中所有 open 且 `goal_ac` 落在 AC-011…AC-031 的任务，要求每个**任务 id** 逐字出现在 `docs/PHASE_FEEL_ART.md` §5 的静态映射表里。任务库通过 `task_write`（自动提交）持续增长，而这张表只在阶段文档 lane 里手工维护——每新立案并晋升一个 open 的 GOAL-005/006 任务，全量套件就红一次，与产品代码无关。同一测试第 104 行的 `openPhaseTasks.length > 0` 是把「阶段进行中」的瞬态事实写成永久不变量。

**为什么上一轮的 AC-002 修复没有守住**：`goal_ac: AC-002` 的三个前序任务均已 `done`——TEST-001 复现并定位端口/临时库/启动校验导致的并发串扰，TEST-002 修复隔离并新增 `scripts/check-stability.mjs`，`gap-ac-002-full-suite-3x-green` 是 TEST_MAP 失效映射被 revert 打破后的一次复验。三者都只保证「当时代码可重复绿」，没有建立对「新增任务即改红套件」这一新机制的不变量：AC-002 于 2026-10-26T03:34Z 转 achieved，之后每一次 GOAL-005/006 的立案/晋升都把它重新变成假。本次失败与隔离无关，是套件读取可变任务库。

<!-- dedup-ref --> **去重与分工（机制去重，非重复立案）**：任务库中声明 `goal_ac: AC-002` 的 `TEST-001`、`TEST-002`、`gap-ac-002-full-suite-3x-green` 均为 `done`，没有在飞任务声明 AC-002，故本次是新任务而非重复。根因修复由在飞任务 `gap-phase-ac-mapping-decouple-live-task-store`（status=ready，`goal_ac: AC-007`，Touches `tests/docs-phase-sync.test.mjs`）拥有，本任务以 `depends_on` 引用并**不重复那处编辑**：它承担 AC-007 的 `node scripts/check-stability.mjs`（3 轮、并发 2）读数面，本任务承担 AC-002 的**不带并发参数**裸命令连续 3 次 exit 0 读数面，两者是不同的验收命令，且 `goal_ac` 是单值标量，无法让同一任务同时声明两个 AC。本任务 Touches 仅自身任务文件，与依赖任务无文件重叠，不构成并发改同一文件；`task-granularity-advice.js --touches tasks/gap-ac-002-full-suite-3x-reverify.md --root .` 的 `peers[]` 为空，无合并候选。

## Plan

1. 确认依赖任务 `gap-phase-ac-mapping-decouple-live-task-store` 的修复提交出现在被评估 HEAD 的祖先链中（`git merge-base --is-ancestor <fix-commit> HEAD` exit 0）再开工；不要只凭它在本任务 worktree 里绿就当成已生效。
2. 在该 HEAD 上逐字执行 AC-002 criterion 一轮，随后连续再执行两轮，共 3 轮；每轮记录 `# tests / # pass / # fail / # duration_ms` 与退出码。
3. 任一轮非零：立即抓取 `not ok` 用例名与失败文本，不得以「重跑绿了」收尾。若残留失败仍是 AC 映射/活任务库机制，登记证据并回写依赖任务的 Notes，不要在本任务并发编辑其 Touches 文件；若是不同机制（端口/时序/并发偶发），先把对应文件加入本任务 `## Touches`，再动手修。
4. 不修改产品行为、玩法与数值；不改 `scripts/check-stability.mjs` / `scripts/test-stability.mjs`，不传 `--rounds` / `--concurrency`。

## AC

- [ ] 在被评估 HEAD 上逐字执行 AC-002 criterion，run 1 exit 0 且输出 `# fail 0`
- [ ] run 2、run 3 同样 exit 0；Notes 逐轮记录 `# tests / # pass / # fail / # duration_ms` 与退出码（共 3 条）
- [ ] `git merge-base --is-ancestor <依赖任务修复提交> HEAD` exit 0，Notes 写明该提交 hash
- [ ] Notes 记录本次失败面证据：`tests/docs-phase-sync.test.mjs:86` 的 `not ok`、断言消息与 `# tests 1643 / # pass 1642 / # fail 1`，并说明它是确定性失败（同一命令复跑即复现）
- [ ] 若出现非 AC 映射机制的残留失败，对应源文件已出现在本任务 `## Touches`，且 Notes 记录失败文本与根因

## DoD

- [ ] 三轮读数可被 driver 独立复算：Notes 同时给出命令原文、每轮 stdout 尾部（`# tests / # pass / # fail / # duration_ms`）与退出码
- [ ] 被评估 HEAD 已提交，`git status --short` 无本任务相关未提交改动
- [ ] 同一 HEAD 上 `npm test` 全量绿（≥1643 项，0 fail）
- [ ] 门禁语义未被放宽：`scripts/check-stability.mjs` / `scripts/test-stability.mjs` 不在本任务 diff 中，未调 `--rounds` / `--concurrency`
- [ ] Notes 写清取舍：为什么 AC-002 的见证不折叠进 AC-007 任务（criterion 命令与并发参数不同；`goal_ac` 单值标量无法同时声明两个 AC）

## Touches

- `tasks/gap-ac-002-full-suite-3x-reverify.md`

## Notes

- 证据（2026-10-28，HEAD `6cb6e17e7f63e2ac041ca2776d22b1f1c69704e2`）：`node --test tests/*.test.mjs` → `# tests 1643 / # pass 1642 / # fail 1`；唯一失败 `not ok 330 - AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务`，`failureType: 'testCodeFailure'`，`error: 'AC 映射缺少 open 任务 gap-feel-capture-scenarios（AC-020）'`。
- 本任务不改代码，因此 Touches 只含自身任务文件——与先例 `gap-ac-002-full-suite-3x-green` 一致（同样是只读见证任务，Touches 只有自己的任务文件）。
- 本任务与依赖任务的读数面不同：依赖任务验 `node scripts/check-stability.mjs`（3 轮、`--test-concurrency=2`），本任务验 AC-002 criterion 的裸命令连续 3 次 exit 0。
