---
id: gap-ac-061-rogue2-balance-retest
title: 肉鸽 2.0 平衡复测：五派系/信物/核心/契约/教义/觉醒落地后三档通关率回到目标区间（AC-061）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-052-balance-retest
  - gap-ac-055-factions-points
  - gap-ac-056-starter-relic-upgrade-guarantee
  - gap-ac-057-boss-core-choice
  - gap-ac-058-contract-card
  - gap-ac-059-doctrines
  - gap-ac-060-awakenings-p0
goal_ac: AC-061
---
## Proposal

AC-061（GOAL-011 退出条件 5）已由 goal-driver 激活，criterion `! grep -qE '低于目标|高于目标' docs/BALANCE.md` 当前 exit 1：docs/BALANCE.md（2026-10-26，固定三图 × 40 种子，全解锁机器人）三档通关率为漫游 29% / 远征 1% / 深渊 0%，全部标「低于目标」（目标 70–85 / 25–40 / 5–12）。本任务在五派系/开局信物/首领核心/契约卡/教义/觉醒（AC-055..060）落地后，重跑全解锁机器人平衡模拟，让机器人真实使用新系统，把三档通关率逐档回到目标区间，并重写 docs/BALANCE.md 使 criterion exit 0。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-061` 认领（task_list + grep 已核）。同机制前任 `gap-rogue2-balance`（superseded，`goal_ac: AC-039`）是 GOAL-007 的平衡复测，已于 2026-10-27 被人在 Notes 撤销（「上得太快，先停」），本任务把它重基到 GOAL-011 的 AC-061。`gap-ac-052-balance-retest`（todo，`goal_ac: AC-052`）是 GOAL-010 的基座校准（14 敌人 + 固定三图，不含肉鸽 2.0 系统），与本任务机制实例不同（肉鸽 2.0 系统 vs 敌人扩充），故独立立案不折叠；但本任务只能回调肉鸽 2.0 系统数值、不得动波次生成/经济计分既有口径（GOAL-011 非目标红线），基座必须先由 AC-052 校准达标——该真前置走顶层 `depends_on` 字段，不在本段声明。与 AC-055..060 的边界：各系统的数据与行为由各自任务落地，本任务只消费其产物并回调幅度；Touches 在 relics.js 与五个新模块文件重叠，调度器按 Touches 串行，保持独立（各自 goal_ac 与独立验收，不合并）。

## Plan

1. 等 AC-052（基座校准）与 AC-055..060（五派系/信物/核心/契约/教义/觉醒）落地后，先跑 `node tests/balance-sim.mjs 40 --report=docs/BALANCE_ROGUE2.json` 拿结构化基线（meta.targets / summary / targets / difficulties / content）。
2. 扩展 `tests/lib/balance-bot.mjs`：让机器人真实使用新系统——按派系选遗物、开局信物三选一、首领核心选择（升阶/搜寻/补给/觉醒/教义）、契约接受、教义选择、觉醒；不改变真人操作上限，只让机器人不再「不会用新系统」；选取率/接受率写入 Notes 作为「代表真人下限而非完美操作/作弊」的证据。
3. 按 GOAL-011 非目标红线（不改战斗数值、波次生成、经济与计分的既有口径、敌人 HP/速度/入口生成红线；不新增第二货币），只回调肉鸽 2.0 系统幅度（五派系 4/8/12 档效果、首领核心/契约/教义/觉醒的收益与代价），不靠关闭新系统凑数；若新系统把某档推过上限（「高于目标」），砍肉鸽 2.0 收益而非基座。
4. 复跑 40 种子，直到三档 full-unlock 通关率逐档落在 `BALANCE_TARGETS`（0.70–0.85 / 0.25–0.40 / 0.05–0.12）；若某档无法同时达标，任务保持打开并写明取舍与原因，目标调整需人拍板、不得自行放宽。
5. `npm run balance:write` 重写 `docs/BALANCE.md`；新增 `tests/rogue2-balance-targets.test.mjs` 读取 `docs/BALANCE_ROGUE2.json`，断言三档 `targets` 均 `status === '达标'`、样本量 ≥40、`meta.targets` 与当前 `BALANCE_TARGETS` 一致；并把该新测试登记进 `scripts/test-changed.mjs` 的 TEST_MAP。

## AC

- [ ] `! grep -qE '低于目标|高于目标' docs/BALANCE.md` exit 0（AC-061 本体判据）
- [ ] `node tests/balance-sim.mjs 40 --report=docs/BALANCE_ROGUE2.json` exit 0
- [ ] `node --test tests/rogue2-balance-targets.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] `docs/BALANCE_ROGUE2.json` 与 `docs/BALANCE.md` 来自同一轮 40 种子复跑，三档 full-unlock 通关率逐档真实落在 `BALANCE_TARGETS`（不是删标记、改 `BALANCE_TARGETS` 或关系统凑数）
- [ ] 机器人确实使用信物/核心/契约/教义/觉醒（Notes 给出选取率/接受率），不是靠改测量仪器把数字抬上去
- [ ] 未改战斗数值、波次生成、经济与计分既有口径、敌人 HP/速度/入口红线；`docs/BALANCE.md` 由 `npm run balance:write` 重新生成、无手工改数字
- [ ] 若某档仍不达标，任务保持打开并写明取舍与原因，不把未达标写成通过

## Touches

- `tests/lib/balance-bot.mjs`
- `tests/balance-sim.mjs`
- `tests/rogue2-balance-targets.test.mjs` (new)
- `scripts/test-changed.mjs`
- `docs/BALANCE.md`
- `docs/BALANCE_ROGUE2.json` (new)
- `public/js/shared/data/relics.js`
- `public/js/shared/factions.js`
- `public/js/shared/boss-core.js`
- `public/js/shared/contracts.js`
- `public/js/shared/doctrines.js`
- `public/js/shared/awakenings.js`
- `tasks/gap-ac-061-rogue2-balance-retest.md`

## Notes

平衡改动只碰肉鸽 2.0 系统数值与机器人策略，不碰波次生成、经济计分、敌人入口与战斗 RNG 调用顺序（`public/js/sim.js` 的确定性不得回归）。目标值来自 `BALANCE_TARGETS`（config.js），不得自行放宽；目标若需调整必须由人拍板并在 Notes 记录。肉鸽 2.0 系统只会推高通关率，故复测重点在「是否越上限（高于目标）」，越限时砍新系统收益而非基座。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。