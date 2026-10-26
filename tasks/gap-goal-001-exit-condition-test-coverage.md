---
id: gap-goal-001-exit-condition-test-coverage
title: GOAL-001 退出条件「全量测试通过」的目标级 AC 覆盖裁定（AC-005 已被越权写入目标库）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: "grep -q '^## 退出条件' goals/GOAL-001-*.md && grep -q '^goal: GOAL-001'
    goals/AC-005-*.md"
goal_ac: AC-005
---
## Proposal

GOAL-001（上游基线合并与开发基线确认）的退出条件是一个合取式，原文逐字为：

> `git merge-base --is-ancestor abe054a HEAD` 成立，且全量测试通过。

**当前未被覆盖的部分：第二个合取项「全量测试通过」。**

判定时（2026-10-26T03:34Z 起的四轮 `goal-round`）GOAL-001 的在域 AC 只有 AC-001「本地 HEAD 包含上游 v1.31.0 基线提交 abe054a」，criterion 为 `git merge-base --is-ancestor abe054a HEAD`、expect `exit 0`。这条命令只做祖先关系判定，不运行也不涉及任何测试文件；对「全量测试通过」这一合取项它既不能证明成立也不能证伪。因此 AC-001 单独存在时，即使它 achieved，退出条件的合取式仍没有任何在域 AC 见证——覆盖缺口就是「全量测试通过」。

**提案：为 GOAL-001 新增一条 AC**

- title：全量测试通过（基线确认）
- criterion：`node --test --test-concurrency=2 tests/*.test.mjs`
- expect：`exit 0`
- origin：GOAL-001 退出条件：全量测试通过

覆盖理由：`package.json` 的 `scripts.test` 逐字就是 `node --test --test-concurrency=2 tests/*.test.mjs`，即本仓「全量测试」的唯一命令，exit 0 就是「全量测试通过」。它与 AC-001 互补：AC-001 见证第一个合取项，这条见证第二个，两者合起来与退出条件一一对应。

**⚠️ 审计发现：这条 AC 已经以 AC-005 的形态存在于目标库，且该写入发生在任务 ABI 之外。**

- `goals/AC-005-全量测试通过-基线确认.md`：goal=GOAL-001、criterion 与本提案逐字相同、activatedAt=2026-10-26T03:38:50.002Z、origin「GOAL-001 退出条件：全量测试通过」。
- 同一时段 GOAL-001 的 body 也补上了 `## 退出条件` 标题。此前存储体把标题压平为行内「退出条件：」（本次会话开始时 `goal_get` 读到的正是压平版），而机械层 `hasExitConditions()` 要求逐字 `## 退出条件` 标题，于是判定走的是「退出条件从未写下」短路——语义判官根本没有被调用。这是 insufficient 的**形式原因**；「全量测试通过」缺 AC 是**实质原因**。目前两者都已被修好。
- 旁证：任务库中没有任何引用 GOAL-001 的任务（`task_list search=GOAL-001` → 0 条）；`.quay/goal-sufficiency-followup.json` 里 GOAL-001 的 `filedAt` 仍为 `null`；`.quay/goal-round.jsonl` 最后一轮是 03:37:25Z，早于 03:38:24Z 的那次 body 写入。`goals/` 已被 `.gitignore` 忽略，这些改动不在 git 里，没有来源记录。
- GOAL-001 当前在域 AC：AC-001（achieved）、AC-005（active）、AC-006（active，覆盖范围项「提交 quay 运行时忽略项」，criterion 逐字验证 `HEAD:.gitignore` 含 `^\.quay/\*`，本地实测 PASS）。

**因此人的决策不是「新增 AC」，而是就 AC-005 三选一（不要再加第二条）：**

1. **认可 AC-005（推荐）**——不改目标库；下一轮 goal-driver 的 `hasExitConditions` 通过、进入语义判官，充分性键变化后 stall 计时归零。
2. **调整 AC-005 的 criterion**——例如改成连跑 3 次；但那是 GOAL-002 的 AC-002 的同机制条目，除非有明确理由，不建议。
3. **supersede AC-005**——须同时说明为什么「全量测试通过」这个退出条件不应有目标级 AC（例如只在任务级 BASE-001 验收）。

<!-- dedup-ref --> 关联但不同机制：BASE-001（status done，任务级基线确认，goal_ac=AC-001，acceptance=`git merge-base --is-ancestor abe054a HEAD && npm test`）已在任务级覆盖这两个合取项；本任务处理的是**目标级 AC 集合**的覆盖，以及一次越权写入的去留裁定，机制不同，故单独立案、不合并。合并候选检查：对两个 goals 文件的 Touches 跑 `task-granularity-advice --root .` 返回 peers=[]。

## Touches

- `goals/GOAL-001-上游基线合并与开发基线确认.md`
- `goals/AC-005-全量测试通过-基线确认.md`
- `tasks/gap-goal-001-exit-condition-test-coverage.md`

## Acceptance Criteria

- [ ] 复核目标库现状：`goal_list goal=GOAL-001` 的在域 AC 至少含 AC-001 与 AC-005，且 `grep -q '^## 退出条件' goals/GOAL-001-*.md` 为真
- [ ] 记录 AC-005 的最近一次 gate 结果（`.quay/gate-events.jsonl` 中 `item_id=AC-005` 的最新一条 verdict；若无则跑 `quay goal gate AC-005 --json` 补一条）
- [ ] 人在 Notes 记录裁定：认可 AC-005 / 调整 criterion / supersede（待外部）
- [ ] 若裁定为「调整」或「supersede」，目标库的相应改动已落地并写下出处（待外部）

## Definition of Done

- [ ] GOAL-001 的目标级 AC 集合与退出条件的两个合取项一一对应，AC-005 的去留已在目标库体现（待外部）
- [ ] 下一轮 `goal-round` 中 GOAL-001 不再因「无 `## 退出条件`」短路，且充分性键已随 AC 集合变化而重置（待外部）
- [ ] 若确认需要再改目标库，改动经任务 ABI 或人工 `goal_write` 完成并记录在 Notes（待外部）
