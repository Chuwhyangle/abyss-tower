---
id: gap-doctrines
title: 教义：通过首领核心选择 5 条塔专精，不可逆、塔身徽记
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/doctrines.test.mjs
depends_on:
  - gap-boss-cores
goal_ac: AC-037
---
## Proposal

设计稿的教义替换「逐塔专精」：每局最多 2 次，通过首领核心选择，对某一种塔的全部塔生效、不可逆。首发每种塔 1 条：弩塔·穿透 / 炮台·燃烧 / 霜塔·冰封 / 电弧·过载 / 毒雾·疫病。塔身加徽记、弹道形态变化；HUD 只显示 1–2 个图标。当前没有教义数据、没有核心选项消费方，也没有塔身徽记。本任务只做教义行为与表现；核心入口由 `gap-boss-cores` 提供。

## Plan

1. 新增 `public/js/shared/doctrines.js`：五条教义规格（塔类型、效果键、徽记 id、弹道变体）、`DOCTRINE_IDS`、`applyDoctrine(sim, id)`；纯函数/纯数据，确定性。
2. `public/js/sim/tower-system.js` 与 `public/js/sim/combat-system.js`：按塔类型对所有同类塔应用效果（穿透 / 燃烧 / 冰封 / 过载 / 疫病），不可逆、不叠加、不改其他塔类型。
3. `public/js/render/tower-renderer.js` 与 `public/js/render/projectile-renderer.js`：塔身徽记与弹道变体；低配档只保留徽记，不新增每帧渐变。
4. `public/js/ui/modals.js` + `server/services/run-service.mjs`：核心候选中的教义项只在第 10 波起出现，且受每局 2 次上限约束；选择即生效。
5. HUD 只显示已选教义的 1–2 个图标；i18n 中英。
6. 新增 `tests/doctrines.test.mjs`：五条效果、同类塔全生效、其他塔不变、不可逆、上限 2、快照往返、渲染徽记标记。

## AC

- [ ] `node --test tests/doctrines.test.mjs` exit 0
- [ ] `node --test tests/towers-depth.test.mjs tests/sim-systems.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 通过首领核心选择一条教义后，该类塔的全部实例都获得对应行为，其他塔类型不变
- [ ] 塔身出现徽记、弹道形态有可见变化；低配档仍有徽记且不加额外每帧开销
- [ ] 教义不可逆、不叠加，每局最多 2 条；快照恢复后仍生效
- [ ] HUD 只显示已选教义图标，不新增面板层级

## Touches

- `public/js/shared/doctrines.js` (new)
- `public/js/sim/tower-system.js`
- `public/js/sim/combat-system.js`
- `public/js/render/tower-renderer.js`
- `public/js/render/projectile-renderer.js`
- `public/js/ui/modals.js`
- `server/services/run-service.mjs`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/doctrines.test.mjs` (new)
- `tasks/gap-doctrines.md`

## Notes

<!-- dedup-ref -->
与 `gap-boss-cores` 的边界：核心入口、波次门槛与每局上限由该任务提供，本任务只实现教义行为与表现，并在核心候选里注册教义项。与 `gap-awakenings-p0` 的边界：觉醒改单件遗物行为，教义改某一类塔的全部实例；两者可同时存在但不得互相覆盖效果键。表现层遵守 GOAL-006 的精灵/低配约束，不新增 `ctx.filter` / `shadowBlur`。
