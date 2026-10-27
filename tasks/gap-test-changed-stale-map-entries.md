---
id: gap-test-changed-stale-map-entries
title: 清理 revert 残留的 test-changed TEST_MAP 失效映射（全量测试 exit 1，AC-005 复验红）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-005
---
## Proposal

AC-005 的 criterion 是 `node --test --test-concurrency=2 tests/*.test.mjs`、expect `exit 0`。2026-10-27 按原命令重跑：`# tests 1627 / # pass 1626 / # fail 1`，exit 1 —— 该条件当前为假。

**失败点（唯一稳定复现）**

- `tests/test-changed.test.mjs:94`「映射集中在一处且目标测试真实存在」→ `not ok 1432`
- 断言消息：`scripts/playtest-check.mjs 映射到不存在的测试 tests/playtest-record.test.mjs`

**根因**

1. commit `14fec37` 撤销了 `d7923b0`（「肉鸽 2.0 与发布收口的验收读数器（AC-032..042）」），删除了 `scripts/deploy-smoke.mjs`、`scripts/playtest-check.mjs`、`scripts/release-check.mjs`、`scripts/rogue2-accept.mjs` 与 `tests/playtest-record.test.mjs`。
2. 但 commit `699c246`（「补齐 v2.0 验收/发布脚本的 test-changed 映射」）为这 4 个脚本新增的 `TEST_MAP` 条目（`scripts/test-changed.mjs:227-231`，含那句“v2.0 验收/发布读数器…”注释）没有被一并撤销。
3. 于是主干上留下 4 条指向已不存在脚本的失效映射；其中 `playtest-check.mjs` 的映射目标测试也随 revert 被删，直接触发「目标测试真实存在」断言。

实测（重跑前）：`grep -oP "(?<=match: ')[^']+" scripts/test-changed.mjs` 中仅这 4 条 match 在磁盘上不存在；其余 97 条 match（文件或目录）均存在。

**为什么上一轮没有守住**

`gap-goal-001-exit-condition-test-coverage`（superseded）是目标库 AC 集合的裁定任务，验收是 `grep` goals 文件，不落在仓库代码上。AC-005 于 2026-10-26T03:52:35Z 在当时的 HEAD 上实测通过并转 `achieved`；`14fec37`（2026-10-27T18:28+08:00）在之后打破了这个不变量。AC-005 随 GOAL-001 离开 reverify scope 后，没有任何机制在后续提交上复验，所以「曾经绿过」不再蕴含「现在绿」——这就是本轮必须新立一条任务把条件重新变真的原因。

**修复方案**

1. 删除 `scripts/test-changed.mjs` 中 4 条失效映射及那句已失效的注释。
2. 加固 `tests/test-changed.test.mjs` 的「映射集中在一处且目标测试真实存在」用例：现有断言只校验映射的**目标测试**存在，不校验 `rule.match` 本身存在，所以 revert 删掉脚本时无人报警。补一条 `assert.ok(fs.existsSync(path.join(ROOT, rule.match)), ...)`，让「映射项指向不存在的文件/目录」在 CI 里立即变红（该断言同时覆盖目录型 match，如 `public/js/render/`）。
3. 重跑全量 suite 确认 exit 0，并连续两次都以 0 退出（本轮三次重跑中首次出现 2 条失败、其后两次为同 1 条失败，说明可能还有偶发用例；若修复后仍偶发非零退出，需在本任务内定位，不能用重跑掩盖）。

<!-- dedup-ref --> 关联但不同机制：`gap-goal-001-exit-condition-test-coverage`（superseded）裁定的是目标库 AC 集合，不触碰仓库文件；本任务修的是 revert 遗留的 `TEST_MAP` 失效映射这一具体机制。合并候选检查：`task-granularity-advice --root . --touches scripts/test-changed.mjs --touches tests/test-changed.test.mjs` 返回 `peers: []`（`gap-art-review-record` 仅在正文提到该文件，未声明进 Touches），故单独立案、不合并。

## Touches

- `scripts/test-changed.mjs`
- `tests/test-changed.test.mjs`
- `tasks/gap-test-changed-stale-map-entries.md`

## Acceptance Criteria

- [ ] `node --test tests/test-changed.test.mjs` exit 0
- [ ] `node --test --test-concurrency=2 tests/*.test.mjs` exit 0（即 AC-005 的 criterion 本身）
- [ ] `grep -cE "scripts/(deploy-smoke|playtest-check|release-check|rogue2-accept)\.mjs" scripts/test-changed.mjs` 输出 `0`
- [ ] `grep -oP "(?<=match: ')[^']+" scripts/test-changed.mjs | while read -r m; do [ -e "$m" ] || echo "MISSING: $m"; done` 无输出
- [ ] `grep -qE 'existsSync\(path\.join\(ROOT, rule\.match\)\)' tests/test-changed.test.mjs` exit 0（匹配项存在性断言已加入）

## Definition of Done

- [ ] 在本次改动所在的 HEAD 上连续两次 `node --test --test-concurrency=2 tests/*.test.mjs` 均为 exit 0（不只看单次绿，也不靠重跑掩盖偶发失败）
- [ ] `TEST_MAP` 与仓库实际文件一致：每条 `match` 与每个映射目标测试都真实存在；新增的 `match` 存在性断言会让任何一次「只删脚本、不删映射」的 revert 在 CI 里立刻变红，而不是像 `14fec37` 这样静默留在主干上
- [ ] `git log --oneline -- scripts/test-changed.mjs` 中可见本次修复提交（是已提交的改动，而不是只存在于工作区的绿）

## Notes

- 复现与判定命令均以仓库根为 cwd；AC-005 的 criterion 与 `package.json` 的 `scripts.test` 逐字一致。
- 本轮三次重跑读数：第一次 `pass 1625 / fail 2`（第二条失败未能留存名称，未复现），第二、三次均为 `pass 1626 / fail 1`（同一条）。修复后若仍出现非零退出，先取 `not ok` 行定位，不要以「重跑绿了」收尾。
- 该 revert 是有意为之（人工撤销 v2.0 读数器），因此正确方向是删除映射，而不是把 4 个脚本恢复回来。
