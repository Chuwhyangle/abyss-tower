---
id: gap-goal-002-exit-condition-stability-gate-coverage
title: GOAL-002 退出条件「稳定性门禁可运行且通过」的目标级 AC 覆盖裁定（AC-007 已被越权写入目标库）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-002（测试稳定性与并发隔离）的退出条件原文逐字为：

> 连续 3 次全量测试 0 失败，稳定性门禁可运行且通过。

这是一个合取式，**第二个合取项「稳定性门禁可运行且通过」在判定时没有任何在域 AC 见证**。

判定时（2026-10-26T03:34:41Z 起记入 `.quay/goal-sufficiency-followup.json` 的 insufficient 实例）GOAL-002 的在域 AC 只有 AC-002「全量测试连续 3 次 0 失败」，criterion 为 `for i in 1 2 3; do node --test tests/*.test.mjs …`、expect `exit 0`。AC-002 见证第一个合取项，但它的 criterion 从头到尾不调用任何稳定性门禁脚本：即使 AC-002 achieved，也不能证明「稳定性门禁可运行且通过」。覆盖缺口就是第二个合取项。

insufficient 的**形式原因**另有一层：生成本次 follow-up prompt 的时刻（≈2026-10-26T03:38:17Z，由台账 `since=03:34:41.264Z` + `elapsed=215485ms` 推得）goal body 里的退出条件是压平的行内 `退出条件：…` 形态，而机械层 `hasExitConditions()` 只认逐字 `## 退出条件` 标题 ⇒ 走「退出条件从未写下」短路，语义判官根本没有被调用。body 在 2026-10-26T03:38:26Z 已被补回 `## 退出条件` 标题（见 goal.updatedAt），形式原因已消除；实质原因（缺第二条 AC）仍是上面这条。

**提案：为 GOAL-002 新增一条 AC，覆盖第二个合取项**

- title：稳定性门禁可运行且通过
- criterion：`node scripts/check-stability.mjs`
- expect：`exit 0`
- timeoutMs：180000（脚本默认连跑 3 轮全量测试，60s 默认超时实测不够，见下）
- origin：GOAL-002 退出条件：稳定性门禁可运行且通过

覆盖理由：`scripts/check-stability.mjs` 就是本仓的稳定性门禁，默认 `--rounds=3` 连跑全量测试，任一轮失败即经 `causeLine()` 向 stderr 输出 `CAUSE=…` 并以非 0 退出；exit 0 ⇔ 门禁可运行且通过。它与 AC-002 互补：AC-002 见证「连续 3 次全量测试 0 失败」，这条见证「稳定性门禁可运行且通过」，两者合起来与退出条件的两个合取项一一对应。

**⚠️ 审计发现：这条 AC 已经以 AC-007 的形态存在于目标库，且该写入发生在任务 ABI 之外。**

- `goals/AC-007-稳定性门禁可运行且通过.md`：goal=GOAL-002、criterion=`node scripts/check-stability.mjs`、expect=`exit 0`、timeoutMs=180000、activatedAt=2026-10-26T03:39:03.306Z、origin「GOAL-002 退出条件：稳定性门禁可运行且通过」。
- 同批次还写入了 AC-005/AC-006/AC-008/AC-009/AC-010（03:38:50–03:39:03Z），并把相关 GOAL 的 body 补回 `## 退出条件` 标题。
- 旁证：任务库中没有任何引用 GOAL-002 的任务（本立案前 `grep -rl GOAL-002 tasks/` 只命中 GOAL-001 的那条裁定任务，它仅正文提到 AC-002）；`.quay/goal-sufficiency-followup.json` 里 GOAL-002 的 `filedAt` 仍为 `null`；`.quay/goal-round.jsonl` 最后一轮是 03:37:25Z，早于 03:38:26Z 的 body 写入。`goals/` 已被 `.gitignore` 忽略，这些改动不在 git 里，没有来源记录。
- AC-007 的 gate 证据（`.quay/gate-events.jsonl`）：03:40:09Z 首次 `not-evaluated (timeout)`（默认 60s 被杀）；补上 `timeoutMs: 180000` 后 03:41:34Z `pass`（exit 0）。当前 status=active，gate 已 pass，待 goal-driver 下一轮 I2 flip。

**因此人的决策不是「新增第二条 AC」，而是就 AC-007 三选一（不要再加第二条）：**

1. **认可 AC-007（推荐）**——不改目标库。GOAL-002 的在域 AC = AC-002（achieved）+ AC-007，两个合取项各有见证；机械层不再走「无退出条件」短路，充分性键从台账里的 `fc5d31a6…` 变为 `c5fbfa96…`，stall 计时按新实例重置。
2. **调整 AC-007 的 criterion**——例如显式写死 `--rounds=3`；但它与 AC-002 的机制本来就重叠，除非有明确理由，不建议。
3. **supersede AC-007**——须同时说明为什么「稳定性门禁可运行且通过」这个退出条件不应有目标级 AC（例如只在任务级 TEST-002 验收）。

补充：若下一轮 goal-driver 已把 AC-007 flip 成 achieved，则按 `goalAchievedFromRecords()` 的口径 GOAL-002 会自动达成；此时人的裁定退化为「是否追认这次 ABI 之外的写入」——仍然需要，因为来源记录只存在于被 gitignore 的 `goals/` 里。

<!-- dedup-ref --> 关联但不同机制：`gap-goal-001-exit-condition-test-coverage`（needs-human）处理 GOAL-001 的同形态问题（AC-005 越权写入 + 退出条件压平），目标与 AC 都不同，故单独立案、不合并。

## Touches

- `goals/GOAL-002-测试稳定性与并发隔离.md`
- `goals/AC-007-稳定性门禁可运行且通过.md`
- `tasks/gap-goal-002-exit-condition-stability-gate-coverage.md`

## Acceptance Criteria

- [ ] 复核目标库现状：`goal_list goal=GOAL-002` 的在域 AC 同时含 AC-002 与 AC-007，且 `grep -q '^## 退出条件' goals/GOAL-002-*.md` 为真
- [ ] 记录 AC-007 最近一次 gate 结果（`.quay/gate-events.jsonl` 中 item_id=AC-007 最新一条 verdict=pass；若没有则跑 `quay goal gate AC-007 --json` 补一条）
- [ ] 人在 Notes 记录裁定：认可 AC-007 / 调整 criterion / supersede（待外部）
- [ ] 若裁定为「调整」或「supersede」，目标库的相应改动已落地并写下出处（待外部）

## Definition of Done

- [ ] GOAL-002 的目标级 AC 集合与退出条件的两个合取项一一对应，AC-007 的去留已在目标库体现（待外部）
- [ ] 下一轮 `goal-round` 中 GOAL-002 不再因「无 `## 退出条件`」短路，且充分性键已随 AC 集合变化而重置（待外部）
- [ ] 若确认需要再改目标库，改动经任务 ABI 或人工 `goal_write` 完成并记录在 Notes（待外部）
