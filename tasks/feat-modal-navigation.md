---
id: feat-modal-navigation
title: 点功能改居中弹窗：天赋树/图鉴/成就/悬赏/生涯/赛季统一 openModal 可关闭
status: ready
labels:
  - feat
  - ui
parent: null
children: []
extra: {}
---
## Proposal

点功能改居中弹窗（TODO-14 + P0-2）。现状：天赋树（`meta-tree.js`）、遗物图鉴（`relic-codex-ui.js`）、成就、悬赏等点开后是「标题页内下滑 panel」或下方出现，用户要改成「居中弹窗、可关闭」。

- 把「标题页内隐藏 panel」型入口（天赋树/遗物图鉴/成就/悬赏/生涯/赛季）统一改成 `openModal` 居中弹窗（复用 `#modal-root` + `.modal` 样式），可关闭、遮罩点击/Esc 关闭。
- 保留各模块的渲染逻辑（`meta-tree.js` 的 `createPanel` 等），只换「承载容器」：panel 内容挂进 modal，而不是 `#meta-tree-panel` 等固定隐藏 div。
- 大内容（天赋树/图鉴）弹窗需可滚动（`.modal` 已有 `max-height:88vh` + 滚动）。

## AC

- [ ] 天赋树、遗物图鉴、成就、悬赏、生涯、赛季点开均为居中弹窗，可关闭（遮罩/Esc/关闭按钮）
- [ ] 弹窗内容完整、可滚动，移动端不溢出
- [ ] 各模块原有功能（升级/展示/刷新）在弹窗内正常
- [ ] `npm test` 全绿；浏览器验收通过

## DoD

- [ ] 落地于各 panel 模块 + `styles.css`，零第三方依赖
- [ ] 复用 `.modal`/`.modal-backdrop` 模式，不新增弹窗基础设施
- [ ] 不碰 sim/数值/存档
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/ui/meta-tree.js`
- `public/js/relic-codex-ui.js`
- `public/js/achievements-ui.js`
- `public/js/bounties-ui.js`
- `public/js/stats-ui.js`
- `public/js/season-ui.js`
- `public/styles.css`
- `tasks/feat-modal-navigation.md`

## Notes

立案 2026-11-06，源自 TODO-14「点功能改弹窗」+ P0-2。改动跨 6 个 panel 模块，文件所有权集中在本任务，不与其它在飞任务重叠。参照 `panels.js` 的 `showUnlocks/showLeaderboard`（openModal 范例）。