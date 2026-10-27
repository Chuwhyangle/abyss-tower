---
id: gap-ac-002-full-suite-3x-green
title: AC-002 复验：TEST_MAP 修复落地后连续 3 次全量测试 0 失败
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-test-changed-stale-map-entries
goal_ac: AC-002
---
## Proposal

AC-002（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo "CAUSE=full suite failed on run $i" >&2; exit 1; }; done`，expect `exit 0`。2026-10-27 按原命令直接重跑：`# tests 1627 / # pass 1626 / # fail 1`，exit 1 —— 该条件当前为假。这是确定性失败，不是偶发：唯一失败点是 `tests/test-changed.test.mjs:94`「映射集中在一处且目标测试真实存在」（`not ok 1432`），断言消息 `scripts/playtest-check.mjs 映射到不存在的测试 tests/playtest-record.test.mjs`。

**根因（不在本任务修复，已由在飞任务拥有）**

commit `14fec37`（2026-10-27 18:28:36 +0800）撤销了 `d7923b0`，删除 `scripts/playtest-check.mjs`、`scripts/deploy-smoke.mjs`、`scripts/release-check.mjs`、`scripts/rogue2-accept.mjs` 与 `tests/playtest-record.test.mjs`；但 commit `699c246` 为这 4 个脚本新增的 `TEST_MAP` 条目（`scripts/test-changed.mjs:227-231`）未随 revert 删除，留下 4 条指向已不存在脚本的失效映射，其中 `playtest-check.mjs` 的目标测试也已被删，直接触发上述断言。

**为什么上一轮的 AC-002 修复没有守住**

TEST-001/TEST-002（均 `done`，均声明 `goal_ac: AC-002`）修的是端口隔离与启动校验，并新增 `scripts/check-stability.mjs`；AC-002 于 2026-10-26T03:34Z 转 achieved。但那次修复只保证「当时代码可重复绿」，不构成对后续提交的不变量。台账时间线逐条印证：AC-002 在 tree `493c1928`（commit `a246670`，18:06 +0800，该 tree 仍含 `scripts/playtest-check.mjs`）上于 10:14:19Z 判 pass；随后 `14fec37` 在 18:28:36 +0800 删除脚本而未删映射；HEAD tree `ccac0246`（commit `563efb2`）已不含该文件，AC-002 于 11:19:47Z / 11:21:14Z 判 fail。即：隔离修复本身没有失效，是 suite 里另一处确定性断言在 AC 离开 reverify scope 后被 revert 打破。

<!-- dedup-ref --> **去重与分工（机制去重，非重复立案）**：同一机制已由在飞任务 `gap-test-changed-stale-map-entries`（status=ready，`goal_ac: AC-005`，Touches `scripts/test-changed.mjs` + `tests/test-changed.test.mjs`）拥有并修复。本任务**不重复做那处编辑**，而是依赖它，只承担 AC-002 自己的见证：其 DoD 要求的是 `--test-concurrency=2` 命令连续 2 次 exit 0，而 AC-002 的 criterion 是**不带并发参数**的裸命令连续 3 次 exit 0，两者是不同的验收读数面（默认并发 = availableParallelism()-1，本机 127）。因此本任务单独立案、不合并、不并发改同一文件。

## 要求

- 等 `gap-test-changed-stale-map-entries` 修复提交落到将被评估的 HEAD 后再开始，先 `git log --oneline -1` 确认修复提交在 HEAD 上，而不是只在 worktree 里绿。
- 在该 HEAD 上逐字执行 AC-002 的 criterion 一轮，并连续执行 3 轮（每轮均须 exit 0）；每轮记录 `# tests / # pass / # fail / # duration_ms` 与退出码到 Notes。
- 任一轮非零：立即抓取 `not ok` 用例名与失败文本，不得以「重跑绿了」收尾。若残留失败仍是同一 TEST_MAP 机制，登记证据并回写依赖任务，不要在本任务并发编辑其 Touches 文件；若是不同机制（如端口/时序偶发），先在本任务 Notes 记录证据并把对应文件加入 `## Touches`，再动手修。
- 不修改产品行为、玩法与数值。

## Touches

- `tasks/gap-ac-002-full-suite-3x-green.md`

默认只做只读复验；若发现不同机制的残留失败，按 `## 要求` 先登记再扩 Touches。

## Acceptance Criteria

- [ ] 逐字执行 AC-002 criterion（含 `for i in 1 2 3` 循环）exit 0
- [ ] 在该 HEAD 上独立连续 3 轮 `node --test tests/*.test.mjs` 均 exit 0，且每轮的 `# tests / # pass / # fail` 已写入 Notes
- [ ] Notes 记录修复提交 hash 与 `git log --oneline -1` 输出，证明被测 HEAD 含 `gap-test-changed-stale-map-entries` 的修复提交
- [ ] Notes 含三轮读数；若任一轮非零，Notes 另含该轮 `not ok` 用例名、失败文本与后续处理（不得只写「重跑通过」）

## Definition of Done

- [ ] 被测 HEAD 是已提交状态（`git status --short` 无与本任务相关的未提交改动），且 AC-002 的 criterion 在该 HEAD 上 exit 0
- [ ] 连续 3 轮裸命令读数在 Notes 中可被 driver 下一轮独立复算并复现
- [ ] 未与 `gap-test-changed-stale-map-entries` 并发编辑同一文件（本任务 commit 不含 `scripts/test-changed.mjs` / `tests/test-changed.test.mjs` 的改动）

## Notes

- 本轮直测命令：`node --test tests/*.test.mjs`（cwd = 仓库根），读数 `# tests 1627 / # pass 1626 / # fail 1`，exit 1；失败点 `tests/test-changed.test.mjs:94`，error `scripts/playtest-check.mjs 映射到不存在的测试 tests/playtest-record.test.mjs`。
- 台账旁证：AC-002 最近三次 pass（08:11:53Z / 09:13:39Z / 10:14:19Z）的 treeSha 均含 `scripts/playtest-check.mjs`；失败（11:19:47Z、11:21:14Z）的 treeSha `ccac0246` 已不含该文件（`git ls-tree` 实测）。
- 本任务不改仓库代码，属于 AC-002 的复验/见证任务；机制修复的正主是 `gap-test-changed-stale-map-entries`。