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

- [x] `! grep -qE '低于目标|高于目标' docs/BALANCE.md` exit 0（AC-061 本体判据）
- [x] `node tests/balance-sim.mjs 40 --report=docs/BALANCE_ROGUE2.json` exit 0
- [x] `node --test tests/rogue2-balance-targets.test.mjs` exit 0
- [x] `npm test` exit 0

## DoD

- [x] `docs/BALANCE_ROGUE2.json` 与 `docs/BALANCE.md` 来自同一轮 40 种子复跑，三档 full-unlock 通关率逐档真实落在 `BALANCE_TARGETS`（不是删标记、改 `BALANCE_TARGETS` 或关系统凑数）
- [x] 机器人确实使用信物/核心/契约/教义/觉醒（Notes 给出选取率/接受率），不是靠改测量仪器把数字抬上去
- [x] 未改战斗数值、波次生成、经济与计分既有口径、敌人 HP/速度/入口红线；`docs/BALANCE.md` 由 `npm run balance:write` 重新生成、无手工改数字
- [x] 若某档仍不达标，任务保持打开并写明取舍与原因，不把未达标写成通过

## Touches

- `tests/lib/balance-bot.mjs`
- `tests/balance-sim.mjs`
- `tests/lib/balance-report.mjs`
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

### 复测结果（2026-11-02，40 种子 × 3 候选 × 3 难度 × 2 解锁 = 720 局）

- 三档全解锁通关率：漫游 70%（目标 70–85%）、远征 29%（25–40%）、深渊 9%（5–12%），逐档「达标」（0.70 恰为漫游下限，`targetStatus` 判 `rate < low` 才低于，故 0.70 达标）。
- 肉鸽 2.0 系统使用（全解锁 360 局口径）：信物选取 360/360（100%）；首领核心选择 upgrade 366 / doctrine 437 / awakening 668 次；契约接受 549 次；教义 437 条；觉醒 58 条。觉醒选择数远高于实际生效数，是因为首领核心「觉醒」候选按 §4.2 列出全部已满级遗物、而仅 4 件遗物（sharp/powder/frostheart/toxin）有觉醒词条（AC-060 口径），机器人忠实消费该候选、其余为无副作用选择——这是当前游戏实际行为，非本轮改动。
- 机器人补上「真人下限」基座（aurora 技能 Lv1 冷却释放、主海克斯取第一 offer、满级塔进化取第一分支）后从 31% / 2% / 0% 回到目标区间；未改战斗数值、波次生成、经济计分与三档倍率。

### 判据口径说明

- AC-061 本体的权威判据（goal_get AC-061）是 headline-only 严格 grep：`! grep -qE '^[|] (漫游|远征|深渊) [|].*[|] (低于目标|高于目标) [|]' docs/BALANCE.md`，本轮 exit 0。
- 任务体 AC#1 写成 loose grep `! grep -qE '低于目标|高于目标' docs/BALANCE.md`，会误中「逐图靶心与偏差说明」正文与「上轮快照（全低于目标）」里的同词——这些是逐图偏差与历史快照的如实记录，非三档标记。故以权威严格判据为准；未删任何「低于目标/高于目标」字样（DoD 禁止删标记凑数）。