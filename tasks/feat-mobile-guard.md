---
id: feat-mobile-guard
title: 移动端信息/防误触：塔卡属性 + 下一波情报 + 出售确认
status: todo
labels:
  - feat
  - mobile
parent: null
children: []
extra: {}
---
## Proposal

移动端信息/防误触（P1-8）。现状：移动端塔卡不显示伤害/射程/对空对地、下一波情报被藏进默认隐藏的遗物抽屉、无出售确认、商店无横滚提示。

- 塔卡显示关键属性（伤害/射程/对空对地），移动端可见。
- 下一波情报在移动端不藏抽屉（或给出明显入口）。
- 出售塔加确认（防误触）；商店横滚提示。
- 触控目标放大（复用现有触控断点，`input.js` 的吸附/点按）。

## AC

- [ ] 移动端塔卡显示伤害/射程/对空对地
- [ ] 下一波情报移动端可达（不藏）；出售有确认；商店有横滚提示
- [ ] `npm test` 全绿；browser-mobile 验收通过

## DoD

- [ ] 落地于 `shop.js`/`hud.js`/`input.js`/`styles.css`，零第三方依赖
- [ ] 复用触控断点与设计 token，不新增魔法值
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/ui/shop.js`
- `public/js/ui/hud.js`
- `public/js/app/input.js`
- `public/styles.css`
- `tests/browser-mobile.mjs`
- `tasks/feat-mobile-guard.md`

## Notes

立案 2026-11-06，源自 P1-8「移动端信息/防误触」。与 `feat-true-fullscreen` 都改 `styles.css`，Touches 冲突需串行。