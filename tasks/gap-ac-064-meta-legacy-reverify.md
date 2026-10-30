---
id: gap-ac-064-meta-legacy-reverify
title: AC-064 复验：meta.js legacy 已落地（commit 0226c80），criterion 现 exit 0，台账 fail 为
  BASELINE-MISMATCH 分叉误读
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-064
---
## Finding

AC-064（GOAL-012 退出条件 3：跨局传承与星核/成就/通行证/悬赏分层清晰无重复）criterion 逐字为 `test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js`，expect `exit 0`。台账 last evidence 2026-10-30T14:04:20.952Z 记为 fail，但这不是回归，而是 **BASELINE-MISMATCH 分叉下的误读**：前任实现任务 `gap-ac-064-meta-legacy`（done，`goal_ac: AC-064`）的落地提交 `0226c80`（feat(meta): 跨局传承落地，2026-10-30 19:38:20 +0800）已于 21:35:46 +0800 经 `1274a2a` 并入 develop，但当时 main 分叉落后 develop——main 的 meta.js 只被 `7655b8e`（天赋树，含 `talent` 无 `legacy`）触及，`0226c80` 并非 main 祖先，台账对着缺 `legacy` 的 main 读：`test -s` 过但 `grep -q 'legacy'` 失败 ⇒ exit 1。14:05:21Z `3d3c1a1`（Merge branch 'main' into develop）把 main 合进 develop 后 main 快进拉齐，`0226c80` 自此同时是 main 与 develop 的祖先。

直接测量（本 agent，2026-10-30）：`test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js` exit 0（当前 meta.js 含 `legacy` 5 处）；`goal_gate AC-064` 返回 `verdict: pass`（acceptance passed，exit 0）。`git merge-base --is-ancestor 0226c80 HEAD` 与 `git merge-base --is-ancestor 0226c80 develop` 均 exit 0——落地提交同时在 main 与 develop 祖先链。

因此本任务**不重复实现**：AC-064 判据要求的产物已由前任任务交付且现在仍在树、判据现在为真。本任务只做只读见证——在被评估 HEAD 上逐字重跑 criterion、把 exit 0 与祖先 hash 写入 Notes，供 driver 下一轮独立复算并翻绿台账。

<!-- dedup-ref --> 机制去重：`gap-ac-064-meta-legacy`（done，`goal_ac: AC-064`）是本 AC 的实现任务且已 done，非 in-flight、非重复；本任务是只读见证（Touches 仅自身任务文件），与前任零文件重叠。`gap-ac-063-meta-talent-reverify`（ready，AC-063）、`gap-ac-065-meta-balance-retest`（todo，AC-065）是不同 AC、不同机制，不折叠。

## AC

- [x] 逐字执行 criterion `test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js` exit 0（AC-064 本体判据）
- [x] 在被评估 HEAD 上独立连续 2 次执行上述 criterion，每轮退出码写入 Notes
- [x] `git merge-base --is-ancestor 0226c80 HEAD` exit 0，Notes 写明该 hash 与 `git log --oneline -1 -- public/js/shared/data/meta.js` 输出
- [x] Notes 记录台账误读证据：evidence `at` 2026-10-30T14:04:20.952Z 早于 main 收敛合并 `3d3c1a1`（2026-10-30T14:05:21Z）61 秒，且 `0226c80` 非当时 main 祖先（`git show 25f62b7:public/js/shared/data/meta.js | grep -c legacy` = 0）

## DoD

- [x] 读数可被 driver 独立复算：Notes 给出命令原文、每轮退出码与 `goal_gate AC-064` 的 verdict
- [x] 被评估 HEAD 已提交，`git status --short` 无本任务相关未提交改动
- [x] 零运行时/玩家可见改动、零第三方依赖；本任务 diff 仅 `tasks/gap-ac-064-meta-legacy-reverify.md`
- [x] 门禁语义未被放宽：不改 `public/js/shared/data/meta.js`、不改 criterion，只重读判定

## Touches

- `tasks/gap-ac-064-meta-legacy-reverify.md`

## Notes

立案依据（2026-10-30，本 agent 直接测量，非台账陈旧尾巴）：criterion exit 0、`goal_gate AC-064` verdict=pass。台账 fail 是 BASELINE-MISMATCH 分叉误读：evidence.at 14:04:20.952Z 早于 main 收敛合并 3d3c1a1（14:05:21Z）61 秒，当时 `0226c80` 只在 develop、不在 main（`git show 25f62b7:public/js/shared/data/meta.js | grep -c legacy` = 0）。meta.js 由前任任务（done）的 commit `0226c80` 交付，当前含 `legacy` 5 处。

复验读数（本 agent，2026-10-30T14:11Z，被评估 HEAD = `162137b`，分支 `main`）：

- 第 1 轮：`test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js` → 退出码 0
- 第 2 轮：同上 → 退出码 0
- `goal_gate AC-064` → verdict=pass（acceptance passed, exit 0）
- `git merge-base --is-ancestor 0226c80 HEAD` → 退出码 0（HEAD = 162137b）
- `git merge-base --is-ancestor 0226c80 develop` → 退出码 0
- `git log --oneline -1 -- public/js/shared/data/meta.js` → `1274a2a Merge branch 'develop' into task/gap-ac-064-meta-legacy`
- 当前 meta.js 含 `legacy` 5 处（criterion 只判 `grep -q`，≥1 即过）
