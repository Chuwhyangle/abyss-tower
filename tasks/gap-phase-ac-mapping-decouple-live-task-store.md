---
id: gap-phase-ac-mapping-decouple-live-task-store
title: AC-007 复验：解除全量套件对活任务库的耦合，稳定性门禁连续 3 轮 exit 0
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/docs-phase-sync.test.mjs
goal_ac: AC-007
---
## Proposal

AC-007（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `node scripts/check-stability.mjs`，expect `exit 0`。2026-10-28 该门禁当前为假，且是确定性红：

- 逐字复跑（默认 3 轮、并发 2，192 个测试文件）三轮均 fail；`.quay/gate-events.jsonl` 中 AC-007 最新记录 `verdict=fail`（2026-10-28T02:07:22.811Z，`failureType=testCodeFailure`，轮次证据 `.quay/stability/round-1-2026-10-28T02-06-35-212Z.tap`）。
- 直接量到失败面：`node --no-warnings --test --test-concurrency=2 tests/*.test.mjs` → `# tests 1643 / # pass 1642 / # fail 1`，唯一失败为 `tests/docs-phase-sync.test.mjs:86` 的「AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务」，断言消息 `AC 映射缺少 open 任务 gap-feel-evidence-and-regressions（AC-020）`。

**根因：全量套件耦合了可变的活任务库**

`tests/docs-phase-sync.test.mjs:103-107` 枚举 `tasks/*.md` 中所有未关闭、`goal_ac` 落在 AC-011…AC-031 的任务，要求每个**任务 id** 逐字出现在 `docs/PHASE_FEEL_ART.md` §5 的 AC 映射表里。该表是文档 lane 在 DOCS-001（`0a41d9b`）一次性写定的静态表，而任务库通过 `task_write`（自动提交）持续增长，没有任何机制让「立案」同时更新这张表。于是每新立一个 open 的 GOAL-005/006 任务，全量套件就红一次，直到有人手改阶段文档——本次的顺序是：`66b42f5` 立案 `gap-feel-evidence-and-regressions`（`goal_ac: AC-020`）、`ad8291b` 将其晋升 `ready`，产品代码一行未改，稳定性门禁即红。

同一测试还有第二处时间炸弹：`tests/docs-phase-sync.test.mjs:104` 断言 `openPhaseTasks.length > 0`——这是把「阶段进行中」这一瞬态事实写成永久不变量；当 AC-011…AC-031 全部完成后，全量套件会永久变红，且没有代码层面的修复路径。

**为什么上一轮的 AC-007 修复没有守住**

`goal_ac: AC-007` 的两个前序任务均 `done`：`gap-stability-gate-evidence-and-startup-retry` 修的是失败证据落盘（`failureType` / `.tap`）与直接自起服务测试的启动换端口重试（`hookFailed` / `EADDRINUSE` 型偶发）；`gap-ac-007-stability-gate-reverify` 是只读复验，2026-10-27 在 HEAD `0ee3ee8` 上两次调用共 6/6 轮 exit 0。两者都没有、也不该触碰「套件读活任务库」这一耦合，因此复验只能证明「那一刻是绿的」：下一条无关任务的立案就把门禁打红。**AC-007 要的是「门禁可运行且通过」这一持续成立的性质；一个绿不绿取决于可变任务库的门禁，按构造就不稳定。**

<!-- dedup-ref --> **去重与分工（机制去重，非重复立案）**：任务库中 `goal_ac: AC-007` 的 `gap-stability-gate-evidence-and-startup-retry`、`gap-ac-007-stability-gate-reverify` 均为 `done`，没有在飞任务声明 AC-007，故本次立案不是重复而是「上一轮修复未守住」的新任务。同时检索 `tests/docs-phase-sync.test.mjs` 的 Touches：当前 0 个 open（todo/ready）任务声明该文件（曾声明的 `gap-background-atmosphere-gate`、`gap-sprite-pipeline`、`gap-mobile-visual-font-floor` 均已 done），`task-granularity-advice.js --touches tests/docs-phase-sync.test.mjs` 的 `peers[]` 为空，无合并候选；本任务独立立案。

## Plan

1. 把 `tests/docs-phase-sync.test.mjs` 的 AC 映射断言抽成纯函数 `checkAcMapping({ phaseMarkdown, tasks })`（返回 problems 数组），真实仓库用例与 fixture 用例共用同一实现，避免在测试里再抄一份判定。
2. 新契约（与表自身的标题「AC 映射」一致，且不空转）：
   - (a) AC-011…AC-031 每个 AC id 都必须出现在 §5（保持原样）；
   - (b) 每个 open 的 GOAL-005/006 任务，其 `goal_ac` 必须是被 §5 映射到的 AC——新立案任务由它自己的 AC 行自动覆盖，不再要求逐字列出任务 id；
   - (c) §5 表中引用的每个任务 id 必须有对应的 `tasks/<id>.md`——保留对改名/删任务产生的悬空引用的拦截，这是原断言里真正可维护、也真正有价值的一半；
   - (d) 删除 `openPhaseTasks.length > 0` 这一瞬态断言。
3. 在同一测试文件补 fixture 用例证明未空转：缺 AC id → problem；open 任务 `goal_ac` 不在表 → problem；表中任务 id 无对应文件 → problem；新立案 open 任务与已映射 AC 同 `goal_ac`、且 open 阶段任务为 0 → 无 problem。另加一条「真实文件复演」：把真实 `tasks/` 与真实阶段文档复制到临时根，注入一个 `status: ready`、`goal_ac: AC-020` 的合成任务文件后断言无 problem。
4. 本任务不修改 `docs/PHASE_FEEL_ART.md`（按该文档 §2.3，阶段文档归该阶段文档 lane），设计增量写进本任务 Notes；若文档 lane 想保留「任务 id 级完整清单」，应由文档 lane 在阶段文档里维护并单独成检查，而不是让 3 轮全量门禁承担。
5. 复跑：`node --test tests/docs-phase-sync.test.mjs` exit 0，然后逐字执行 AC-007 criterion `node scripts/check-stability.mjs`（不带参数）exit 0；不修改 `scripts/check-stability.mjs` / `scripts/test-stability.mjs`，不传 `--rounds` / `--concurrency`。

## AC

- [ ] `node --test tests/docs-phase-sync.test.mjs` exit 0，且 `--test-reporter=spec` 输出中能看到新增的 fixture 正/反例与「真实文件复演」用例全部 pass
- [ ] fixture 反例：§5 缺任一 AC-011…AC-031 的 id 时 `checkAcMapping` 返回 problem
- [ ] fixture 反例：open 任务的 `goal_ac` 未出现在 §5 时返回 problem
- [ ] fixture 反例：§5 引用的任务 id 在 `tasks/` 下无对应 `.md` 时返回 problem
- [ ] fixture 正例：注入一个 `status: ready`、`goal_ac: AC-020` 的新任务到临时根后返回空 problems；open 阶段任务为 0 时同样返回空 problems
- [ ] `node scripts/check-stability.mjs` 在本任务分支 HEAD 上 exit 0，stderr 无 `CAUSE=`（3 轮、并发 2，默认参数；Notes 记逐轮读数）
- [ ] `git diff` 未包含 `scripts/check-stability.mjs` / `scripts/test-stability.mjs` / `docs/PHASE_FEEL_ART.md`

## DoD

- [ ] 被测 HEAD 已提交且 `git status --short` 无本任务相关未提交改动；该 HEAD 上 `node scripts/check-stability.mjs` exit 0，Notes 记录每次调用退出码、逐轮耗时、`# tests / # pass / # fail` 与进程总墙钟，driver 下一轮可独立复算
- [ ] 解耦被真实文件复演证明：Notes 记录临时根里「注入一个新立案 open 任务」的复演结果（真实 `tasks/` 拷贝 + 真实阶段文档 + 合成任务文件），而不是只凭断言文字
- [ ] 门禁判定语义未被放宽：`scripts/check-stability.mjs` 仍「任一轮失败 → exit 1」，未调 `--rounds` / `--concurrency`，未删除任一反例用例
- [ ] Notes 写清取舍：任务 id 级清单若要继续强制，应由文档 lane 维护为独立检查，并说明为什么它不能挂在 3 轮全量门禁上
- [ ] `npm test` 全量绿（1643+ 项，0 fail）

## Touches

- `tests/docs-phase-sync.test.mjs`
- `tasks/gap-phase-ac-mapping-decouple-live-task-store.md`

## Notes

- 根因时间线：AC-007 于 2026-10-26T04:05:42Z 由 goal-driver 转 achieved；2026-10-27 的复验任务在 HEAD `0ee3ee8` 上 6/6 轮绿；2026-10-28 `66b42f5` 立案、`ad8291b` 晋升 `gap-feel-evidence-and-regressions`（`goal_ac: AC-020`）后套件转红。失败与产品代码无关。
- 证据：`# tests 1643 / # pass 1642 / # fail 1`；失败断言 `AC 映射缺少 open 任务 gap-feel-evidence-and-regressions（AC-020）`；门禁轮次证据 `.quay/stability/round-1-2026-10-28T02-06-35-212Z.tap`。
- 本任务只动测试文件，不放宽任何门禁参数；若评审认为阶段文档 §5 需要补一行任务 id，属文档 lane 的增量，不在本任务 Touches 内。
