---
id: gap-awakenings-p0
title: 觉醒 P0：四条三级遗物行为词条
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/awakenings.test.mjs
depends_on:
  - DOCS-002
  - gap-factions-points
goal_ac: AC-038
---
## Proposal

设计稿的首领核心包含「觉醒」：任选 1 件 Ⅲ 级遗物获得行为词条，不消耗原遗物，第 10 波起可出。首发 8 条里 P0 先做 4 条：锐利箭簇（每第 6 发穿透 2 个目标）、火药桶（炮台命中 5 次后落点燃烧 2s）、极寒之心（减速目标死亡时 1.2 格霜爆冻结 0.4s）、毒性催化（中毒死亡传播 1 层，最多 3 跳）。当前没有觉醒数据与行为钩子；核心入口由 `gap-boss-cores` 提供。本任务只做这 4 条行为与最小表现，不动概率与结算。

## Plan

1. 新增 `public/js/shared/awakenings.js`：四条规格（绑定遗物 id、触发条件、效果参数、i18n key）、`AWAKENING_IDS`、`awakeningFor(relicId)`；纯数据/纯函数、无 RNG。
2. `public/js/sim/combat-system.js` / `public/js/sim/projectile-system.js` / `public/js/sim/enemy-system.js`：按事件接入四条行为；只在已觉醒时改变行为，未觉醒路径保持原 RNG 调用顺序与结果。
3. `public/js/render/effect-renderer.js`：霜爆与传播的最小特效，遵守既有粒子预算与画质档；不新增每帧渐变。
4. 核心候选：`server/services/run-service.mjs` 在 Ⅲ 级遗物存在且第 10 波起时提供觉醒项；同一遗物只觉醒一次。
5. 快照：已觉醒遗物列表进入快照；旧档无字段时不影响。
6. 新增 `tests/awakenings.test.mjs`：四条触发/不触发、RNG 顺序不变、只对绑定遗物生效、快照往返、核心候选门槛。

## AC

- [ ] `node --test tests/awakenings.test.mjs` exit 0
- [ ] `node --test tests/sim-systems.test.mjs tests/impact-events.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 四条觉醒在确定性模拟里各自产生可观察的行为差异（穿透目标数 / 燃烧窗口 / 霜爆冻结 / 中毒传播跳数）
- [ ] 未觉醒的同一 seed 与改动前逐字节一致，RNG 调用顺序不变
- [ ] 觉醒只作用于绑定的 Ⅲ 级遗物，不改变遗物本身等级
- [ ] 核心候选只在第 10 波起、存在 Ⅲ 级遗物时出现，同一遗物不重复觉醒

## Touches

- `public/js/shared/awakenings.js` (new)
- `public/js/sim/combat-system.js`
- `public/js/sim/projectile-system.js`
- `public/js/sim/enemy-system.js`
- `public/js/render/effect-renderer.js`
- `server/services/run-service.mjs`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/awakenings.test.mjs` (new)
- `tasks/gap-awakenings-p0.md`

## Notes

<!-- dedup-ref -->
与 `gap-doctrines` 的边界：教义改某一类塔的全部实例，觉醒只改单件遗物的行为；两者同时存在时效果键必须分开。与 `gap-weapon-impact-vfx`（已完成）的边界：本任务只加行为与最小特效，不重做命中特效语言。确定性红线：未觉醒路径不得新增/重排 `combatRng` 调用。
