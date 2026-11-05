---
id: feat-mobile-guard
title: 移动端信息/防误触：塔卡属性 + 下一波情报 + 出售确认
status: ready
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

- [x] 移动端塔卡显示伤害/射程/对空对地
- [x] 下一波情报移动端可达（不藏）；出售有确认；商店有横滚提示
- [x] `npm test` 全绿；browser-mobile 验收通过

## DoD

- [x] 落地于 `shop.js`/`hud.js`/`input.js`/`styles.css`，零第三方依赖
- [x] 复用触控断点与设计 token，不新增魔法值
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/ui/shop.js`
- `public/js/ui/hud.js`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `public/styles.css`
- `tests/browser-mobile.mjs`
- `tasks/feat-mobile-guard.md`

## Notes

立案 2026-11-06，源自 P1-8「移动端信息/防误触」。与 `feat-true-fullscreen` 都改 `styles.css`，Touches 冲突需串行。

落地实现：

- **塔卡属性行**（AC1）：攻击塔显示 `shop.cardStats`（伤害/射程/对空对地），辅助塔显示精简后的 `shop.auraStats`（增伤/攻速/射程）。桌面仍由 `data-tip` 悬浮提示承担，属性行仅紧凑视口显示。`shop.auraStats` 由「光环增伤 +X% · 光环攻速 +X% · 射程 R」精简为「增伤 X% · 攻速 X% · 射程 R」，否则战旗卡在 196px 卡内换行撑高商店、把战场压出视口（横屏 ih=390 时商店需 ≤85px，实测 83px）。
- **下一波情报**（AC2）：`updateNextWave` 在紧凑视口把面板挂到 `.stage` 左上角（复用 `input.js` 的 `layoutForViewport`），不再藏进默认隐藏的遗物抽屉；桌面仍挂遗物面板底部。
- **出售确认**（AC2）：复用 `showConfirm`，点「出售」先弹确认框，取消不卖、确认才卖，确认/取消按钮 ≥44px 触控目标（入场动画结束后）。
- **商店横滚提示**（AC2）：`shop.scrollHint` 追加 `.shop-scroll-hint`。
- **`input.js` 未改动**：触控吸附/点按与 `layoutForViewport` 断点原样复用，故从 Touches 移除（无实际 diff）。

验收：`npm test` 2034 例全绿；`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` 通过。
