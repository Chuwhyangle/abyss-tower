---
id: gap-ac-055-factions-points
title: 五派系点数：遗物派系标注、4/8/12 阈值与独立 setMods 层在模拟/快照/UI 一致生效（AC-055）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-054-rogue2-design-rebase
goal_ac: AC-055
---
## Proposal

AC-055（五派系点数与 4/8/12 阈值在模拟、快照与 UI 一致生效）已由 goal-driver 激活，criterion 为 `grep -q 'faction' public/js/shared/data/relics.js`（expect exit 0），当前 exit 1：`relics.js` 尚无 `faction` 字段，70 件遗物只有 6 个 `set`。origin（GOAL-011 退出条件 2）要求五派系点数走独立 setMods 层、不被旧 caps 裁剪——但 `RelicSystem.recomputeMods` 把所有 mods 过 `clampMods`（GLOBAL_MOD_CAPS / 每件上限），派系效果若继续塞旧键会被静默裁到 0。本任务只做派系层：遗物派系标注、点数聚合、4/8/12 三档独立 setMods 层、快照与 UI 一致；不碰首领核心/契约/教义/觉醒（AC-056..061 各自认领）。

<!-- dedup-ref --> 无任何任务以 `goal_ac: AC-055` 认领（task_list + grep 已核）。同机制前任 `gap-factions-points`（goal_ac AC-033）已于 2026-10-27 被人在 Notes 撤销（superseded，等待重新设计），本任务把它重基到 GOAL-011 的 AC-055。冻结表由 `gap-ac-054-rogue2-design-rebase`（todo，AC-054）产出 `docs/PHASE_ROGUE2.md`，本任务以它为唯一数值来源；该前置依赖走顶层 `depends_on` 字段，不在本段声明。合并候选已跑 task-granularity-advice：peers=[]（relics.js 仅被 AC-054 在 prose 提及、未进其 Touches）。

## Plan

1. 按 `docs/PHASE_ROGUE2.md` 冻结表为 `public/js/shared/data/relics.js` 的 70 件遗物加 `faction`（五派系或 neutral）；不改既有 mods 数值与稀有度权重，旧 6 套 `set` 行为不破坏。
2. 新增 `public/js/shared/factions.js`：`FACTION_ORDER`、`FACTION_TIERS`（4/8/12）、`factionPoints(states)`、`factionTiers(states)`、`factionSetMods(tiers)`；纯函数、无 DOM、无 `Math.random`、不 import sim/render。
3. `RelicSystem.recomputeMods` 把派系 setMods 合入独立层（`sim.factionMods`），不经 `clampMods`；塔/战斗读属性时按「基础 mods + 派系 setMods」合并，0 点时与改动前逐字节一致。
4. UI：`panels.js` 显示五派系点数与下一档；`modals.js` 遗物卡标注派系；i18n 中英成对新增键。
5. 快照：点数与档位由 relics 派生则不入快照；若需缓存，只存派生值并在恢复时重算，旧档兼容。
6. 新增 `tests/factions.test.mjs`：70 件映射覆盖、点数=等级、4/8/12 触发、setMods 不被 caps 裁剪、0 点行为不变、快照往返。

## AC

- [ ] `grep -q 'faction' public/js/shared/data/relics.js` exit 0（AC-055 本体判据）
- [ ] `node --test tests/factions.test.mjs` exit 0
- [ ] `node --test tests/relic-sets.test.mjs tests/relics-depth.test.mjs` exit 0
- [ ] `node --test tests/snapshot.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 同一 seed 的确定性模拟里，拾取遗物使派系点数增长，到 4/8/12 时对应档位效果在战斗中真实生效（不是只测函数返回值）
- [ ] 70 件遗物全部有 faction 或 neutral，且与 `docs/PHASE_ROGUE2.md` 冻结表一致；旧 6 套 set 行为不被破坏
- [ ] 0 派系点时同一 seed 的战斗结果与改动前逐字节一致；派系 setMods 不经 `clampMods` 裁剪
- [ ] 桌面与移动视口都能看到五派系点数与下一档，不溢出、不遮 HUD

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/factions.js` (new)
- `public/js/sim/relic-system.js`
- `public/js/sim.js`
- `public/js/ui/panels.js`
- `public/js/ui/modals.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/factions.test.mjs` (new)
- `tasks/gap-ac-055-factions-points.md`

## Notes

setMods 必须走独立层：旧 GLOBAL_MOD_CAPS / 每件上限已被 Ⅲ 级遗物顶满，继续塞旧键会被静默裁成 0。派系点数只由遗物等级决定，不引入第二货币。若某件遗物在 PHASE_ROGUE2 里被判为中立，测试仍要求它出现在映射表中并标注 neutral。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。