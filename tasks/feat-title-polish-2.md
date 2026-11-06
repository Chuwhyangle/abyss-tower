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

- [x] 标题页有浮游粒子层，`node scripts/ui-animation-audit.mjs` exit 0（无违规）
- [x] 按钮分组后主按钮「开始远征」视觉最突出，次要入口归组，无按钮丢失
- [x] 开局配置流合并后仍能正确进入各模式（normal/daily/weekly/endless/tower/mutated）
- [x] `npm test` 全绿；浏览器 smoke/flow 验收通过

## DoD

- [x] 落地于 `index.html`、`title.js`、`styles.css`（+可能的轻量粒子模块），零第三方依赖
- [x] 复用设计 token，不新增魔法值；移动端不溢出
- [x] 不碰 sim/数值/存档/回放
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/index.html`
- `public/js/ui.js`
- `public/js/ui/title.js`
- `public/js/ui/run-config.js` (new)
- `public/css/title.css`
- `public/css/modals.css`
- `public/js/shared/i18n/zh-CN.ui.title.js`
- `public/js/shared/i18n/en-US.ui.title.js`
- `tests/ui-split.test.mjs`
- `tasks/feat-title-polish-2.md`

## Notes

立案 2026-11-06，源自 P0-2「标题页整体重构 + 13 按钮分组 + 开局 4 弹窗合并」与 TODO-13/14。与 `feat-gacha-ui` 都改 `index.html`/`styles.css`，若同时派发会有 Touches 冲突——本任务依赖 `feat-gacha-ui` 落地后再派（depends_on）。

### 实现决策（2026-11-06）

1. **粒子层**：大厅已有 `MenuBackground` canvas 浮游粒子（跟随画质设置，低配 0 粒子、reduce-motion 关闭），因此本次不重复造 canvas，改为叠加 `.title-neon` 静态 CSS 点阵（三层 radial-gradient + mask 渐隐）增加纵深。当前全局无限动画已有 4 个（预算上限），点阵刻意不带任何动画，`scripts/ui-animation-audit.mjs` exit 0。
2. **按钮分组**：`.title-actions` 拆为 `title-cta`（开始远征 + 继续，`title-play` 独占整行、金色辉光）+「挑战模式 / 成长 / 记录」三组。`#btn-weekly`/`#btn-mutation`/`#btn-tower` 仍由 `ui.js` 动态插入同一 mode 分组，13 个入口 id 全部保留，顺序与既有断言一致。
3. **开局配置页**：合并「模式 / 携带技能 / 变异 / 难度」为单页 `run-config`（保留 `.difficulty-modal`、`.diff-card[data-id]`、`.skill-chip` 等既有选择器），模式页签原地切换并复用各模式入口回调；变异模式要求先选 ≥1 个变异。信物三选一 / 海克斯三选一 / 地图三选一属于对局开局内容（且被现有浏览器验收与流程测试深度依赖），保持独立，不并入配置页。
4. **CSS 分区**：`public/styles.css` 已在 refactor-css-partition 拆到 `public/css/*.css`，故样式落在 `title.css`、`modals.css`，零新增魔法值（全部用既有 token）。
5. **模块拆分**：为守住 ui-split 的「门面 <300 行 / 子模块 <400 行」，配置页方法拆到 `public/js/ui/run-config.js`（`runConfigMethods`），`title.js` 只保留技能卡与标题场景；`ui.js` 291 行、`title.js` 227 行、`run-config.js` 233 行。

### 验收记录

- `npm test`：2141/2141 通过。
- `npm run smoke` / `npm run flow` / `npm run test:mobile`：均通过（zh_CN locale）。
- `node scripts/ui-animation-audit.mjs`：exit 0。
- 六模式逐一浏览器验证（临时脚本，不入库）：normal/daily/weekly/mutated/endless/tower 均能从分组入口打开配置页、页签切换正确、选难度后进入信物三选一。
