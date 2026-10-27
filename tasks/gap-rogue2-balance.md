---
id: gap-rogue2-balance
title: 肉鸽养成 2.0 平衡复测：三档通关率回到目标区间
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/rogue2-balance-targets.test.mjs
depends_on:
  - gap-factions-points
  - gap-starter-relic-upgrade-guarantee
  - gap-boss-cores
  - gap-contracts
  - gap-doctrines
  - gap-awakenings-p0
goal_ac: AC-039
---
## Proposal

最新 `docs/BALANCE.md`（2026-10-26 生成，固定三图口径）显示三档机器人通关率为漫游 29% / 远征 1% / 深渊 0%，全部低于目标区间（70–85 / 25–40 / 5–12）。这不是新系统造成的，而是固定地图上线后尚未回调。GOAL-007 落地五派系、信物、核心、契约、教义与觉醒后，通关率只会被进一步推高，必须在同一轮里完成平衡复测与回调。本任务只调数值与机器人策略，不改机制、不改敌人 HP/速度/入口的生成红线，也不靠关闭新系统凑数字。

## Plan

1. 用 `node tests/balance-sim.mjs 40 --report=docs/BALANCE_ROGUE2.json` 产出结构化报告；记录每档、每图、每词缀的通关率与失败波次分布。
2. 让机器人策略覆盖新系统：信物选择、核心选择（升阶/搜寻/补给）、契约接受、教义选择、觉醒；不改变真人操作上限，只让机器人不再「不会用新系统」。
3. 按报告回调 `public/js/shared/config.js` 的 `BALANCE_TARGETS` 之外的经济/成长参数与 `public/js/shared/data/difficulties.js` 的难度倍率；优先动 `hpGrowth` / `budgetPerWave` / 初始金币，不直接砍新系统效果。
4. 复跑 40 种子，直到三档落回目标区间；若某档无法同时达标，记录取舍与原因，并说明是否调整目标（目标调整需人拍板，不得自行放宽）。
5. 新增 `tests/rogue2-balance-targets.test.mjs`：读取 `docs/BALANCE_ROGUE2.json`，断言三档在 `BALANCE_TARGETS` 内、样本量 ≥40、内容版本与当前一致；报告缺失或字段不全时 fail-closed。
6. `npm run balance:write` 重写 `docs/BALANCE.md`，并在文档里注明本轮新增系统与机器人策略变化。

## AC

- [ ] `node --test tests/rogue2-balance-targets.test.mjs` exit 0
- [ ] `node tests/balance-sim.mjs 40 --report=docs/BALANCE_ROGUE2.json` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 结构化报告 `docs/BALANCE_ROGUE2.json` 与 `docs/BALANCE.md` 都来自同一轮 40 种子复跑，三档均落在目标区间
- [ ] 机器人策略确实会使用信物/核心/契约/教义/觉醒（报告或任务 Notes 给出使用率），不是靠关掉新系统达标
- [ ] 没有改动敌人 HP/速度/入口的生成红线；没有为了达标删除机制
- [ ] 若某档仍不达标，任务保持打开并写明取舍，不把未达标写成通过

## Touches

- `tests/balance-sim.mjs`
- `tests/balance-sweep.mjs`
- `public/js/shared/config.js`
- `public/js/shared/data/difficulties.js`
- `docs/BALANCE.md`
- `docs/BALANCE_ROGUE2.json` (new)
- `tests/rogue2-balance-targets.test.mjs` (new)
- `tasks/gap-rogue2-balance.md`

## Notes

当前基线（2026-10-26，固定三图）：漫游 29% / 远征 1% / 深渊 0%，三档全部低于目标。目标值来自 `BALANCE_TARGETS`（0.70–0.85 / 0.25–0.40 / 0.05–0.12），不得自行放宽；目标若需调整必须由人拍板并在 Notes 记录。平衡改动只碰数值与机器人策略，不碰波次生成与敌人入口。
