---
id: feat-modal-navigation
title: 点功能改居中弹窗：天赋树/图鉴/成就/悬赏/生涯/赛季统一 openModal 可关闭
status: done
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

- [x] 天赋树、遗物图鉴、成就、悬赏、生涯、赛季点开均为居中弹窗，可关闭（遮罩/Esc/关闭按钮）
- [x] 弹窗内容完整、可滚动，移动端不溢出
- [x] 各模块原有功能（升级/展示/刷新）在弹窗内正常
- [x] `npm test` 全绿；浏览器验收通过

## DoD

- [x] 落地于各 panel 模块 + `styles.css`，零第三方依赖
- [x] 复用 `.modal`/`.modal-backdrop` 模式，不新增弹窗基础设施
- [x] 不碰 sim/数值/存档
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/ui/meta-tree.js`
- `public/js/relic-codex-ui.js`
- `public/js/achievements-ui.js`
- `public/js/bounties-ui.js`
- `public/js/stats-ui.js`
- `public/js/season-ui.js`
- `public/styles.css`
- `tests/browser-i18n.mjs`
- `tasks/feat-modal-navigation.md`

## Notes

立案 2026-11-06，源自 TODO-14「点功能改弹窗」+ P0-2。改动跨 6 个 panel 模块，文件所有权集中在本任务，不与其它在飞任务重叠。参照 `panels.js` 的 `showUnlocks/showLeaderboard`（openModal 范例）。

实现提交 89bddf11：6 个模块统一 `import { ui } from './ui.js'`，点击入口用 `ui.openModal(shell(), { className: '<x>-modal panel-modal', closable: true })` 承载原 panel 内容，关闭按钮绑 `ui.closeModal()`、遮罩与 Esc 由既有 `openModal`/input.js 全局处理。bounties 的 `controller?.reload()` 换成 `reloadPanel(panel)`（claim/refresh 在弹窗内重渲染）；season 补 `ensureStyle()` 注入原 STYLE。`styles.css` 增 `.panel-modal { min-width:0; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:var(--line-strong) transparent }`（不新增弹窗基础设施）。`tests/browser-i18n.mjs` 悬赏断言由 `#bounties-panel` 改为 `.bounties-modal`（已入 Touches）。

验证：`npm test` 2027 全绿（合并 develop 后，gacha 文档 planned 块豁免 a90a9c5e 已随合并带入）；`check:syntax/imports/style/structure` 全绿；本任务相关 7 个测试文件（relic-codex/season-ui/panels-visual/meta-tree/bounties/achievements/stats）全绿。browser-i18n 已同步为弹窗选择器，未在本机复跑整条浏览器链（本机 headless Chrome 环境见仓库记忆）。