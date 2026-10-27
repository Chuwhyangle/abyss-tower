---
id: gap-ac-007-stability-gate-reverify
title: AC-007 复验：TEST_MAP 失效映射修复落地后稳定性门禁连续 3 轮 exit 0
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/check-stability.mjs
depends_on:
  - gap-test-changed-stale-map-entries
goal_ac: AC-007
---
## Proposal

AC-007（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `node scripts/check-stability.mjs`，expect `exit 0`。2026-10-27 该门禁在 treeSha `ccac0246` 上连跑 3 轮全部 fail（`.quay/gate-events.jsonl` 中 item_id=AC-007 的两条最新记录，11:15:54Z 与 11:22:52Z，verdict=fail）：3 轮失败原因逐轮一致，都是 `CAUSE=full suite failed on run N（1 项失败：映射集中在一处且目标测试真实存在）；failureType=testCodeFailure`。证据文件 `.quay/stability/round-2-2026-10-27T11-22-26-686Z.tap` 与 `round-3-2026-10-27T11-22-52-475Z.tap` 均为 `# tests 1627 / # pass 1626 / # fail 1`，失败用例 `not ok 1432 - 映射集中在一处且目标测试真实存在`。

立案前直接复跑：`node --no-warnings --test tests/test-changed.test.mjs` → `not ok 9 - 映射集中在一处且目标测试真实存在`，exit 1；`ls tests/playtest-record.test.mjs scripts/playtest-check.mjs` 两者均不存在。该条件当前为假，且是确定性红，不是偶发。

**根因（同一机制已由在飞任务拥有，本任务不重复编辑）**

commit `14fec37`（2026-10-27 18:28:36 +0800，Revert "chore(scripts): 肉鸽 2.0 与发布收口的验收读数器（AC-032..042）"）删除了 `scripts/deploy-smoke.mjs`、`scripts/playtest-check.mjs`、`scripts/release-check.mjs`、`scripts/rogue2-accept.mjs` 与 `tests/playtest-record.test.mjs`，但 commit `699c246` 为这 4 个脚本新增的 `TEST_MAP` 条目（`scripts/test-changed.mjs:227-231`，含“v2.0 验收/发布读数器…”注释）未随 revert 删除。`scripts/test-changed.mjs:229` 的 `{ match: 'scripts/playtest-check.mjs', tests: ['tests/playtest-record.test.mjs'] }` 两侧目标都已不存在，直接触发 `tests/test-changed.test.mjs` 的「映射集中在一处且目标测试真实存在」断言。

**为什么上一轮的 AC-007 修复没有守住**

上一轮声明 `goal_ac: AC-007` 的任务 `gap-stability-gate-evidence-and-startup-retry`（done）修的是另一个机制：失败证据落盘（`failureTypes` / `.tap`）+ 30 个直接自起服务测试文件的启动换端口重试，针对的是 `hookFailed` / `EADDRINUSE` 型偶发失败。它没有、也不应触碰 `TEST_MAP`。AC-007 于 2026-10-26T04:05:42Z 转 achieved；`14fec37` 在 2026-10-27T10:28:36Z 之后才落地，属于 AC 离开 reverify scope 后由无关 revert 打破的不变量——“曾经绿过”不蕴含“现在绿”。上一轮修复的直接价值在本轮可见：`failureType=testCodeFailure` 与 `.tap` 证据让根因在 1 次失败内即被定位，而不是再猜端口。

<!-- dedup-ref --> **去重与分工（机制去重，非重复立案）**：同一机制已由在飞任务 `gap-test-changed-stale-map-entries`（status=ready，`goal_ac: AC-005`，Touches `scripts/test-changed.mjs` + `tests/test-changed.test.mjs`）拥有并修复——删除 4 条失效映射、并给 `tests/test-changed.test.mjs` 补 `match` 存在性断言；本任务不重复做那处编辑，只承担 AC-007 自己的见证，前置关系由 frontmatter 的 `depends_on` 表达。与 `gap-ac-002-full-suite-3x-green`（goal_ac: AC-002）不合并：AC-002 的 criterion 是裸 `for i in 1 2 3; do node --test tests/*.test.mjs …`（默认并发 = availableParallelism()-1），AC-007 的 criterion 是 `node scripts/check-stability.mjs`（脚本内部 `--rounds=3 --concurrency=2`，失败时产 `CAUSE=` 与 `.tap`），两者是不同的验收读数面；本任务只声明 AC-007。`gap-stability-gate-evidence-and-startup-retry`（done，goal_ac: AC-007）不是重复而是证据：它修的机制未失效，失效的是另一个文件。

## 要求

- 等 `gap-test-changed-stale-map-entries` 的修复**已提交**落到将被评估的 HEAD（`git log --oneline -1` 与 `git log --oneline -- scripts/test-changed.mjs` 确认），而不是只在 worktree 里绿。
- 在该 HEAD 上逐字执行 AC-007 的 criterion：`node scripts/check-stability.mjs`（不带参数，默认 3 轮并发 2），记录退出码与每轮读数。
- 为区分“修复有效”与“侥幸绿”，同一 HEAD 上再执行一次同一 criterion（两次调用共 6 轮），两次调用均须 exit 0。
- 任一轮非零：立即从 `.quay/stability/*.tap` 取 `not ok` 用例名与 `failureType`，不得以“重跑绿了”收尾。若残留失败仍是 TEST_MAP 机制，登记证据并回写依赖任务；若是**不同机制**（端口 / 时序 / SQLITE_BUSY 等），先在本任务 Notes 记录证据并把对应文件加入 `## Touches`，再动手修。
- 若依赖任务在本任务落地前被 superseded 或关闭而**未带修复提交**，本任务接管该修复：先把 `scripts/test-changed.mjs` 与 `tests/test-changed.test.mjs` 加入 `## Touches` 再编辑，不并发改同一文件。
- 不修改产品行为、玩法与数值。

## Touches

- `tasks/gap-ac-007-stability-gate-reverify.md`

默认只做只读复验；若发现不同机制的残留失败，按 `## 要求` 先登记再扩 Touches。

## Acceptance Criteria

- [x] 依赖任务的修复提交已在被测 HEAD 上（Notes 记 `git log --oneline -1` 与该提交 hash）
- [x] `node scripts/check-stability.mjs` 在该 HEAD 上 exit 0（AC-007 criterion 逐字执行，记 3 轮读数）
- [x] 同一 HEAD 上第二次 `node scripts/check-stability.mjs` 亦 exit 0（共 6 轮，stderr 无 `CAUSE=`）
- [x] Notes 含每次调用的退出码、逐轮耗时与 `# tests / # pass / # fail`；若出现非零轮，另含 `.tap` 路径、`not ok` 用例名与处理结果
- [x] 未与 `gap-test-changed-stale-map-entries` 并发编辑同一文件（本任务 commit 不含 `scripts/test-changed.mjs` / `tests/test-changed.test.mjs` 的改动）

## Definition of Done

- [x] 被测 HEAD 是已提交状态（`git status --short` 无与本任务相关的未提交改动），且 AC-007 的 criterion 在该 HEAD 上两次调用均 exit 0
- [x] 连续 6 轮读数在 Notes 中可被 driver 下一轮独立复算并复现
- [x] 门禁判定语义未被放宽：仍然“任一轮失败 → exit 1”，没有为了绿而调 `--rounds` / `--concurrency`

## Notes

- 立案前直测：treeSha `ccac0246`，`node scripts/check-stability.mjs` 3/3 轮 fail；`.quay/stability/round-2-2026-10-27T11-22-26-686Z.tap` 与 `round-3-2026-10-27T11-22-52-475Z.tap` 均 `# tests 1627 / # pass 1626 / # fail 1`，失败用例 `not ok 1432 - 映射集中在一处且目标测试真实存在`。
- 直测复现：`node --no-warnings --test tests/test-changed.test.mjs` → `not ok 9 - 映射集中在一处且目标测试真实存在`，exit 1；`ls tests/playtest-record.test.mjs scripts/playtest-check.mjs` 两者均不存在。
- 本任务不改仓库代码，属于 AC-007 的复验/见证任务；机制修复的正主是 `gap-test-changed-stale-map-entries`。

### 复验执行记录（2026-10-27，worktree `.worktrees/gap-ac-007-stability-gate-reverify`，分支 `task/gap-ac-007-stability-gate-reverify`）

- **被测 HEAD**：`0ee3ee8 tasks: gap-art-review-record task_write by cli:1768903`（worktree 从 `develop` 创建；`develop` 与 `main` 同为 `0ee3ee8`；`git status --short` 为空）。
- **依赖修复提交在 HEAD 上**：`8d0651a fix(test-changed): 移除 revert 残留的 4 条 TEST_MAP 失效映射`，为 `git log --oneline -5 -- scripts/test-changed.mjs` 首条；`git merge-base --is-ancestor 8d0651a HEAD` → YES（`main` / `develop` 均包含）。依赖任务 `gap-test-changed-stale-map-entries` 已 done（fan-in 提交 `ef4c04e`）。
- **映射断言直测**：`node --no-warnings --test tests/test-changed.test.mjs` → exit 0，`# tests 15 / # pass 15 / # fail 0 / # skipped 0`。
- **调用 A（逐字 criterion，无参数）**：`node scripts/check-stability.mjs` → **exit 0**；3 轮 / 并发 2 / 192 个测试文件；轮次 1 `23.83s（1643 项）`、轮次 2 `24.38s（1643 项）`、轮次 3 `25.20s（1643 项）`；每轮 `# tests 1643 / # pass 1643 / # fail 0`；stderr 无 `CAUSE=`；进程总墙钟 73.44s。
- **调用 B（同一 HEAD 再跑一次）**：`node scripts/check-stability.mjs` → **exit 0**；轮次 1 `24.06s`、轮次 2 `23.81s`、轮次 3 `23.95s`（各 1643 项，`# tests 1643 / # pass 1643 / # fail 0`）；stderr 无 `CAUSE=`；进程总墙钟 71.86s。两次调用合计 **6/6 轮通过**，0 个失败轮，用例失败率 0.0%（0/4929 项）。
- **补充读数（同一 HEAD，直接 TAP，供复算）**：`node --no-warnings --test --test-concurrency=2 --test-reporter=tap tests/*.test.mjs` → exit 0，`# tests 1643 / # pass 1643 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`，`# duration_ms 23832.87`。
- **门禁语义未放宽**：未改动 `scripts/check-stability.mjs` / `scripts/test-stability.mjs`，两次调用均未传 `--rounds` / `--concurrency`（默认 3 轮、沿用 `npm test` 的并发档位 2）。
- **未触碰依赖任务文件**：本分支相对 `develop` 无 `scripts/test-changed.mjs` / `tests/test-changed.test.mjs` 的改动（Touches 仅本任务文件）。
- 本次复验未出现非零轮，故无新增 `.tap` 证据文件，也无需登记 / 回写任何新机制。