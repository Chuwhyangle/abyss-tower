---
id: feat-true-fullscreen
title: 电脑版真全屏：canvas 填满视口 + HUD 覆盖停靠
status: ready
labels:
  - feat
  - ui
parent: null
children: []
extra: {}
depends_on:
  - feat-gacha-ui
  - feat-title-polish-2
---
## Proposal

电脑版真全屏（P0-1）。现状：`.stage` 被 `min(100%, calc((100vh - 190px) * 1.8333), 1200px)` 压住——canvas 硬顶 1200px 宽 + 给 HUD 预留 190px 高，大屏四周留白。改成 canvas 填满可用视口，HUD 改覆盖/停靠。

- `.stage` 放宽到填满可用视口（去掉 1200px 硬顶 + 减少 HUD 预留高度），canvas 等比放大到真正占满。
- HUD/商店/下一波情报等改为覆盖在 canvas 上（半透明停靠），而非单独占 190px 布局块。
- 移动端（强制横屏 + 紧凑屏）布局不回归，复用现有 `@media` 断点。

## AC

- [ ] 桌面大屏（≥1440px 宽）canvas 填满视口无四周留白（或留白显著减少）
- [ ] HUD/商店/下一波情报覆盖停靠，可读性不降
- [ ] 移动端横屏/竖屏布局不回归（browser-mobile 验收通过）
- [ ] `npm test` 全绿；visual 套件不因布局改动误红（确认不是真漂移）

## DoD

- [ ] 落地于 `styles.css`（+可能的 `index.html` 结构调整），零第三方依赖
- [ ] 不碰 canvas 逻辑分辨率、sim/数值
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/css/hud.css`
- `public/css/shop.css`
- `public/css/skills.css`
- `tasks/feat-true-fullscreen.md`

## Notes

立案 2026-11-06，源自 P0-1「电脑版全屏不是真全屏」。⚠️ 改 `.stage`/HUD 布局可能触发 visual-parity 像素漂移——若 visual 套件红，按「同环境对照」判定是布局改动导致的真漂移（需复采基线）还是 Chrome 陈旧（环境噪声）。与 `feat-gacha-ui`/`feat-title-polish-2` 都改 `styles.css`，依赖它们落地后派发（depends_on）。

### 实现记录（2026-11-06）

- `public/styles.css` 已被 `refactor-css-partition` 拆为 `public/css/*`，实际落在 `hud.css`（.stage/.stage-wrap/.hud/.relic-panel/.tower-panel/.toast）、`shop.css`（.shop）、`skills.css`（.btn-skill）。`index.html` 无需结构调整（纯 CSS 覆盖，DOM 不变）。
- 断点选 `(min-width: 1200px) and (min-height: 521px)`：1200px 是 HUD 单行 + 8 张塔卡单行都放得下的最小宽度（实测 1150px 时中英文 HUD 已换行）；521px 高度与紧凑断点 `(max-height: 520px)` 互补，移动端横屏 844×390 完全不受影响。
- 停靠高度用 `--dock-top` / `--dock-bottom` 变量：中文 HUD 59px / 商店 98px，英文 93px / 117px，取上界（≥1440px 时 HUD 中英文都稳定 59px，回落到 64px）；遗物栏、塔面板、技能钮、toast 据此避让，不被停靠条压住。
