---
id: gap-perf-budget-normal-scenario-no-enemies
title: perf:budget 门禁 normal-1x-low 空场误红：波 12 滴灌出生被 8 塔守入口清空（AC-028）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-028
---
## Proposal

AC-028（GOAL-006 退出条件「`npm run perf:budget` 通过，60fps 目标不回归」）本轮 FAIL，criterion `npm run perf:budget` exit 1，读数 `[perf] FAIL: normal-1x-low 没有存活敌人，压力场景无效`。该错误由 `tests/dynamic-perf.mjs:617` 的基本断言 `if (m.entities.enemies < 1) throw ...` 抛出，其中 `m.entities.enemies = sim.enemies.length`（`public/js/game-app.js:345`）是测量窗口（预算模式 `MEASURE_MS = 1200ms`）结束时的单次快照。

根因是 perf 场景的「站场」保证失效，不是游戏平衡回归：

- `normal-1x-low` / `normal-1x-high` 场景为 wave 12 / 8 座 Lv.1 塔 / RELICS_MID / `extraEnemies: 0`（`tests/dynamic-perf.mjs:61-62`）。`__perfSetup` 用 100 万金币把 8 座塔铺在 `pathCells` 最靠入口的可建格（`tests/dynamic-perf.mjs:245-260`），入口成为绞肉区。
- wave 12 是滴灌出生：`generateWave` 首个群组 delay ≈ 0.3s、群组间错峰 1.6–2.8s（`public/js/shared/waves.js:124-147`）。到 1.2s 快照点只有首个群组的最初几个敌人出生，8 塔近乎瞬时清掉，场上瞬间为 0。
- 平衡本身未变：`public/js/shared/config.js` 的 `BALANCE` 曲线自 v1.17.0 后未改；AC-052 平衡复测已把三档通关率拉回目标区间。回归触发源是敌人扩充 commit `72759d4`（wraith 进波 12 池）改了波 12 组成，把原本就边缘的场景推过空场线。

修复：给 normal 场景补「站场敌人」保证——沿用 harness 既有 `extraEnemies` 注入通道（`tests/dynamic-perf.mjs:264-270`），让整个 1200ms 测量窗口内场上始终 ≥1 敌人；不把 normal 改造成 stress、不碰 sim/waves/enemies/config。若场景负载特征因此改变导致预算越线，同步重跑并更新 `docs/perf-budget.json` 基线（并在 Touches 补登记）。

<!-- dedup-ref -->
机制去重与边界：`gap-perf-budget-p95-30fps-limit`（done，`goal_ac: AC-028`）是本 AC 上一轮失败时的修复，但处理的是另一症状（`normal-1x-low` 的 p95FrameMs 阈值 25→40，改 `docs/perf-budget.json` + `tests/perf-budget.test.mjs`），未触碰「存活敌人」断言；本轮是新症状（空场），不是该修复未落地。`gap-ac-050-enemies-expand`（done，commit `72759d4`）是回归触发源，已落地、非本任务前置。本任务只修 perf 场景空场，与二者机制不同、独立立案。

## AC

- [ ] `npm run perf:budget` exit 0（AC-028 本体判据）
- [ ] `npm run perf:budget` 连续两次 exit 0，两次 `normal-1x-low` 均未报「没有存活敌人」（排除共享宿主偶发）
- [ ] `node --test tests/perf-budget.test.mjs` exit 0（含新增守卫：normal 场景携带站场敌人保证，防再次空场）
- [ ] `npm test` exit 0

## DoD

- [ ] 真实跑通 `npm run perf:budget`（Chrome headless 软件渲染，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）exit 0，输出里 `normal-1x-low` / `normal-1x-high` 不再报「没有存活敌人」
- [ ] 连续两次复跑 exit 0，两次 `normal-1x-low` 都在测量窗口内保持 `sim.enemies.length ≥ 1`（确定性，非偶发）
- [ ] 未触碰 `public/js/sim.js` / `public/js/shared/waves.js` / `public/js/shared/data/enemies.js` / `public/js/shared/config.js`；战斗数值、波次、敌人、RNG 调用顺序不变
- [ ] 若 normal 场景负载特征改变导致预算越线，`docs/perf-budget.json` 已同步更新且 Notes 说明改动依据；否则证明预算仍达标
- [ ] Notes 记录：为什么是空场而非平衡回归（AC-052 通关率达标、config.js 平衡曲线未变、`72759d4` 波 12 组成变化），以及为什么选用的修复不把 normal 改造成 stress

## Touches

- `tasks/gap-perf-budget-normal-scenario-no-enemies.md`
- `tests/dynamic-perf.mjs`
- `tests/perf-budget.test.mjs`