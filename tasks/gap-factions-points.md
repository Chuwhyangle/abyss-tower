---
id: gap-factions-points
title: 五派系点数：遗物派系标注、4/8/12 阈值与独立 setMods 层
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/rogue2-accept.mjs factions
depends_on:
  - DOCS-002
goal_ac: AC-033
---
## Proposal

现有 70 件遗物只有 3 个 `set`（hunter / frost / merchant），设计稿 v1.9 要用五派系（火力 / 霜缚 / 蚀毒 / 雷暴 / 守护）+ 点数（点数 = 遗物等级）+ 阈值 4/8/12 替换。当前 `RelicSystem.recomputeMods` 会把所有 mods 过 `GLOBAL_MOD_CAPS` / `PER_RELIC_CAPS`，套装效果若继续塞旧键会被静默裁到 0。本任务只做派系层：数据标注、点数聚合、三档 setMods 独立层、快照与 UI；不碰首领核心 / 契约 / 教义 / 觉醒。

## Plan

1. 按 DOCS-002 的 `docs/PHASE_ROGUE2.md` 映射，为 `public/js/shared/data/relics.js` 的 70 件遗物加 `faction`（或 neutral）；不改既有 mods 数值与稀有度权重。
2. 新增 `public/js/shared/factions.js`：`FACTION_ORDER`、`FACTION_TIERS`（4/8/12）、`factionPoints(states)`、`factionTiers(states)`、`factionSetMods(tiers)`；纯函数、无 DOM、无 `Math.random`、不 import sim/render。
3. `RelicSystem` 在 recompute 时把 setMods 合入独立层（`sim.factionMods`），不经过旧 caps；战斗与塔系统读取时按「基础 mods + setMods」合并，0 点时保持与改动前逐字节一致。
4. UI：`panels.js` 显示五派系点数与下一档；`modals.js` 遗物卡标注派系；i18n 中英成对新增键。
5. 快照：点数与档位由 relics 派生则不入快照；若需缓存，只存派生值并在恢复时重算，旧档兼容。
6. 新增 `tests/factions.test.mjs`：70 件映射覆盖、点数 = 等级、4/8/12 触发、setMods 不被 caps 裁剪、0 点行为不变、快照往返。

## AC

- [ ] `node --test tests/factions.test.mjs` exit 0
- [ ] `node --test tests/relics.test.mjs tests/relic-sets.test.mjs` exit 0
- [ ] `node --test tests/snapshot.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 同一 seed 的确定性模拟里，拾取遗物使派系点数增长，到 4/8/12 时对应档位效果在战斗中真实生效（不是只测函数返回值）
- [ ] 70 件遗物全部有 faction 或 neutral；旧 3 套 set 行为不被破坏
- [ ] 0 派系点时同一 seed 的战斗结果与改动前逐字节一致
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
- `tasks/gap-factions-points.md`

## Notes

setMods 必须走独立层：旧 `PER_RELIC_CAPS` / `GLOBAL_MOD_CAPS` 已被 Ⅲ 级遗物顶满，继续塞旧键会被静默裁成 0。派系点数只由遗物等级决定，不引入第二货币。若某件遗物在 PHASE_ROGUE2 里被判为中立，测试仍要求它出现在映射表中并标注 neutral。
