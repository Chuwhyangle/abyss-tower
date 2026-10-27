---
id: gap-playtest-v2-record
title: v2.0.0 真人试玩记录：三档样本量与失败原因（待外部）
status: needs-human
labels:
  - qa
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/playtest-check.mjs
depends_on:
  - gap-release-deploy-smoke
goal_ac: AC-042
---
## Proposal

`docs/PLAYTEST.md` 目前是空表（0 条记录），而 GOAL-008 的退出条件要求 v2.0.0 的三档真人样本与 `docs/BALANCE.md` 的机器人同口径对照。真人试玩只能由人完成：执行者不能代替人操作、不能虚构样本，也不得把不存在的局写成通关。本任务在部署冒烟通过后打开，等待人按 `docs/PLAYTEST.md` 的字段口径填表，然后用 `scripts/playtest-check.mjs` 机械校验。

## Plan

1. 等待 `gap-release-deploy-smoke` 完成，确认 18787 已运行 v2.0.0。
2. 人按 `docs/PLAYTEST.md` 口径试玩：每档至少 5 局，且每档同时包含「全解锁」与「零解锁」两种口径（各至少 3 局）；完整对局才记录，败局写清失败波次与主因。
3. 人把每局一行填进对应难度的小节；样本不足时追加，不改表头与字段口径。
4. 跑 `node scripts/playtest-check.mjs`；检查器拒绝空表、缺字段、样本量不足与非法失败原因。
5. 汇总三档通关率，与 `docs/BALANCE.md` 的机器人同口径数据对照；差异持续 >10 个百分点时，在表格后的说明里写排查结论（真人操作上限 vs 数值问题）。

## AC

- [ ] `node scripts/playtest-check.mjs` exit 0（需人填表后；待外部）

## DoD

- [ ] 三档每档至少 5 局完整对局，且「全解锁 / 零解锁」两种口径各至少 3 局
- [ ] 每行字段完整：日期、内容版本、难度、解锁状态、地图原型、词缀、结果、剩余基地生命、剩余金币、塔数与关键塔、关键遗物、失败原因
- [ ] 汇总通关率与 `docs/BALANCE.md` 机器人同口径对照，差异 >10pp 时有书面排查结论
- [ ] 没有任何一行是为了让检查器通过而虚构的；样本不足时保持任务打开（待外部）

## Touches

- `docs/PLAYTEST.md`
- `tasks/gap-playtest-v2-record.md`

## Notes

本任务状态是 `needs-human`：执行者不得代玩、不得代填、不得把不通过写成通过。检查器由 `DOCS-003` 落地；若检查器尚未存在，先等 `DOCS-003` 完成。内容版本填 v2.0.0 或对应提交短哈希。
