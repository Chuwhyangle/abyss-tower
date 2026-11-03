---
id: feat-one-tower-core
title: 独塔重做·核心：3/6/9 逐级选进化 + 10 级大招框架 + 炮台大招参考实现
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs
---
## Proposal

独塔为王目前「10 级自动兼得三条进化」，太弱（满级弩塔 DPS ~330，一塔要顶 7 塔但只给 ~2 倍成长）。重做方案已定（`docs/TODO.md` TODO-3 的 7 塔大招草案，用户点头后冻结）：① 三条进化拆到 **3 / 6 / 9 级逐级选**（每 3 级从该塔三条进化里选一条，选完三条到 9 级），取代「10 级兼得」；② **10 级 = 固定大招**（每塔一个被动触发大招，非三选一）；③ 炮台大招作为**首个参考实现**：全图索敌（10 级解锁，射程覆盖全图）+ 每打 4 下 → 下一次「轰击」带「余波」二次范围伤害。本任务落地「逐级选进化 + 大招触发框架 + 炮台大招」，其余 7 塔大招由后续任务填（草案表见 TODO-3）。触发计数器须是塔级确定性自增（复用 `projectile-system.js` 的 `tower.arrowShots`/`enemy.frostHits` 范式），**不消耗 RNG、不改 sim RNG 调用顺序**。

## AC

- [x] 3/6/9 级各可三选一一条进化（UI 弹出 + 应用），选完三条到 9 级；10 级不再「兼得全部进化」
- [x] 大招触发框架：塔级确定性计数器「每 N 次攻击触发一次」，10 级解锁
- [x] 炮台大招：10 级解锁全图索敌（射程覆盖全图）+ 每 4 下轰击带余波二次范围伤害
- [x] `node --test tests/hex-one-tower.test.mjs` exit 0（现有断言更新到新机制）

## DoD

- [x] 落地于 `public/js/shared/hexes/one-tower.js`、`public/js/sim/tower-system.js`、`public/js/sim/projectile-system.js`、`public/js/ui/shop.js`，不引入第三方依赖
- [x] 回归测试覆盖 3/6/9 逐级选、10 级大招、炮台全图索敌/轰击余波
- [x] `npm test` 全绿；补跑 `node --test tests/hex-one-tower.test.mjs tests/tower-evolution.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/one-tower.js`
- `public/js/shared/hexes/runtime.js`
- `public/js/shared/i18n/en-US.ui.js`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/sim/tower-system.js`
- `public/js/sim/projectile-system.js`
- `public/js/ui/shop.js`
- `tests/hex-one-tower.test.mjs`
- `tests/tower-evolution.test.mjs`
- `tasks/feat-one-tower-core.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-3（7 塔大招草案）。这是三连任务的第一步（核心框架 → 7 塔大招 → 视觉特效），后续任务 Touches 落在 `projectile-system.js`/`combat-system.js`/render 层，与本任务逐文件不相交。若 worker 实际 Touches 与声明有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为玩法重做，机制设计已定稿、无新文档面，L_D/L_G/L_S 无需量化。

设计增量（2026-11-03 落地）：
- 进化层级：`EVOLUTION_TIERS = [2,5,8]`（3/6/9 级，0 起索引）；`canEvolve` = 已选数 < 当前层级应选数；`allowedEvolutions` 只给未选分支；`evolveTower` 逐条累积到 `tower.evolutions`。
- 10 级大招：`ULTIMATE_LEVEL = 9`（索引），`ultimateSpec` 钩子返回每塔大招规格，未定义大招的塔返回 null（仅靠逐级进化）。
- 炮台大招（草案数值，待 balance）：`every=4`、`fullMap=true`（全图索敌）、`aftershock { radius=1.6, damageMul=0.6 }`（余波 60% 二次范围伤害，`noCrit` 确定性触发）。
- 全图索敌用 `stats.fullMap` 布尔（射程数值保持有限，渲染层照常画射程圈）；计数器为塔级 transient `tower.ultimateShots`（复用 `tower.arrowShots` 范式，不进快照、不耗 RNG）。
- 新增 i18n 键 `shop.chooseEvolution`（zh/en 对称）；`runtime.js` 补 `canEvolve`/`ultimateSpec` 安全包装。
- Touches 声明追加 4 个实际触碰文件：`runtime.js`、i18n 两份、`tower-evolution.test.mjs`。