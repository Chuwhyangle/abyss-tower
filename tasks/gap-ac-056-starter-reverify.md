---
id: gap-ac-056-starter-reverify
title: AC-056 复验：开局信物三选一修复已 fan-in 落地，criterion 现 exit 0（台账红是 fan-in 前 24s 陈旧读数）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-056
---
## Finding

AC-056（开局信物三选一与第 3 波起保底升级卡）criterion 为 `grep -q 'starter' public/js/shared/data/relics.js`（expect exit 0）。台账 evidence 停在 2026-10-30T13:09:28.152Z 的 fail，但本 agent 在被评估 HEAD 上直接复跑该 criterion exit 0：修复已通过 fan-in 落地，台账红是陈旧读数，不是回归。

时间线（直接测量，非台账推断）：
- 修复提交 `21ae9a9`（feat(rogue2): 开局信物三选一与第 3 波起保底升级卡（AC-056））author/committer 均为 2026-10-30 20:59:53 +0800（12:59:53 UTC），落在任务分支 task/gap-ac-056-starter-relic-upgrade-guarantee；
- driver 机械 fan-in 提交 `54d820e`（翻 gap-ac-056-starter-relic-upgrade-guarantee done）committer 2026-10-30 21:09:52 +0800（13:09:52 UTC），此时修复才并入 develop/main；
- AC-056 evidence.at = 13:09:28.152Z（21:09:28 +0800）比 fan-in 早 24 秒——读数发生在修复并入 merge target 之前，故当时 grep 找不到 `starter` 而 exit 1。

现状核验：`git merge-base --is-ancestor 21ae9a9 HEAD` exit 0；`git merge-base --is-ancestor 54d820e HEAD` exit 0（main=develop=d531cc9 均含修复）；`grep -q 'starter' public/js/shared/data/relics.js` exit 0（relics.js:248/250/252 分别含 `starter`/`STARTER_FACTIONS`/`rollStarterOffers`）。前任 done 任务 `gap-ac-056-starter-relic-upgrade-guarantee` 的修复确实守住了，本任务只做只读复验，不改任何代码。

## AC

- [ ] `grep -q 'starter' public/js/shared/data/relics.js` exit 0（AC-056 本体判据）
- [ ] `git merge-base --is-ancestor 21ae9a9 HEAD` exit 0（修复提交在被评估 HEAD 祖先链中）
- [ ] `git merge-base --is-ancestor 54d820e HEAD` exit 0（fan-in 提交在被评估 HEAD 祖先链中）

## DoD

- [ ] Notes 记录逐字 criterion 命令与 exit 0 读数，供 driver 独立复算
- [ ] 本任务 diff 只含自身任务文件，不改 `public/js/**` / `server/**` / `docs/**` / 任何测试文件
- [ ] Notes 写清陈旧读数根因：evidence.at 13:09:28 比 fan-in 54d820e 13:09:52 早 24 秒，读数发生在修复并入 merge target 之前

## Touches

- `tasks/gap-ac-056-starter-reverify.md`

## Notes

立案依据（2026-10-30，本 agent 直接测量）：criterion `grep -q 'starter' public/js/shared/data/relics.js` 在被评估 HEAD（main=develop=d531cc9）上 exit 0，不是 fail。台账 fail 是陈旧读数——evidence.at 13:09:28.152Z 早于 fan-in 提交 54d820e（13:09:52Z）24 秒，当时修复提交 21ae9a9 尚未并入 merge target。前任 done 任务 `gap-ac-056-starter-relic-upgrade-guarantee` 的修复已守住，本任务只读见证、Touches 只含自身；goal_ac 是单值标量，AC-056 需要一条在飞归属让 driver 下一轮独立复算并翻绿。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新）。