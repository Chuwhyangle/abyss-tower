---
id: feat-title-polish-2
title: 标题页二波：霓虹粒子背景 + 13 按钮分组 + 开局 4 弹窗合并配置页
status: ready
labels:
  - feat
  - ui
parent: null
children: []
extra: {}
depends_on:
  - feat-gacha-ui
---
## Proposal

标题页二波美化（TODO-13 收尾 + P0-2），在 `feat-gacha-ui` 之外的独立 UI 任务。现状：标题页已有 Orbitron 字体 + 按钮动效 + 辉光 + 菱形徽记（第一波已落地）。本任务补三块：

1. **霓虹粒子背景**：标题页加程序化浮游粒子层（纯 CSS/轻量 canvas，复用「暗黑霓虹几何」风格），让背景更有生命力。动效须过 `scripts/ui-animation-audit.mjs`（无限循环只允许 transform/opacity，≤4 个无限动画，reduced-motion 覆盖）。
2. **13 按钮分组**：`#title-screen` 的 8 个小按钮（商店/排行榜/成就/生涯/赛季/天赋树/遗物图鉴/玩法）+ 主按钮（开始远征/每日/无尽/继续）重新分组，突出主行动、次要入口归入分组（P0-2「13 按钮分组」）。
3. **开局弹窗合并**：开局 4 个弹窗（选图/难度/变异/技能）合并成单页配置流，减少开局点击负担（P0-2「开局 4 弹窗合并成配置页」）。

## AC

- [ ] 标题页有浮游粒子层，`node scripts/ui-animation-audit.mjs` exit 0（无违规）
- [ ] 按钮分组后主按钮「开始远征」视觉最突出，次要入口归组，无按钮丢失
- [ ] 开局配置流合并后仍能正确进入各模式（normal/daily/weekly/endless/tower/mutated）
- [ ] `npm test` 全绿；浏览器 smoke/flow 验收通过

## DoD

- [ ] 落地于 `index.html`、`title.js`、`styles.css`（+可能的轻量粒子模块），零第三方依赖
- [ ] 复用设计 token，不新增魔法值；移动端不溢出
- [ ] 不碰 sim/数值/存档/回放
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/index.html`
- `public/js/ui/title.js`
- `public/styles.css`
- `tasks/feat-title-polish-2.md`

## Notes

立案 2026-11-06，源自 P0-2「标题页整体重构 + 13 按钮分组 + 开局 4 弹窗合并」与 TODO-13/14。与 `feat-gacha-ui` 都改 `index.html`/`styles.css`，若同时派发会有 Touches 冲突——本任务依赖 `feat-gacha-ui` 落地后再派（depends_on）。