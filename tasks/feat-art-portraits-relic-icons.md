---
id: feat-art-portraits-relic-icons
title: 立绘 + 遗物图：程序化美术内容（塔/敌人/首领卡面 + 遗物图标）
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/sprite-coverage.test.mjs tests/render-budget.test.mjs
---
## Proposal

用户要「立绘和遗物图」。零第三方依赖，走现有 Canvas 程序化绘制 + 精灵图集管线（`public/js/render/sprite-coverage.js` 登记 kind），风格与现有配色/形状统一。① **立绘**：塔（8 座）、敌人（含新增怪）、首领（3 变体）的卡面画像——新增 `public/js/render/portrait-draw.js`（程序化绘制肖像：轮廓/特征/配色按实体 id 确定性生成），供 UI/图鉴/结算卡面用；② **遗物图**：所有遗物的图标——新增 `public/js/render/relic-art.js`（按遗物稀有度/颜色/glyph 程序化绘制图标），替换/增强现有遗物 chip 的纯色块。**不搞读图评审**（用户已定：语义验收交玩家），画完登记 sprite-coverage、守住 render-budget，玩家进游戏看效果。

## AC

- [ ] 8 塔 + 敌人 + 3 首领变体的程序化立绘（`portrait-draw.js`，确定性按实体 id 生成）
- [ ] 全部遗物的程序化图标（`relic-art.js`，按稀有度/颜色/glyph）
- [ ] 新 sprite/art kind 登记 `sprite-coverage.js`；`render-budget` 不红
- [ ] `node --test tests/sprite-coverage.test.mjs tests/render-budget.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/render/portrait-draw.js`（新）、`public/js/render/relic-art.js`（新）、`public/js/render/sprite-coverage.js`，零第三方依赖
- [ ] 立绘/图标接入 UI 展示（图鉴/卡面/遗物 chip 至少一处可见）
- [ ] `npm test` 全绿；补跑 `node --test tests/sprite-coverage.test.mjs tests/render-budget.test.mjs tests/render-visuals.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/render/portrait-draw.js` (new)
- `public/js/render/relic-art.js` (new)
- `public/js/render/sprite-coverage.js`
- `tests/sprite-coverage.test.mjs`
- `tasks/feat-art-portraits-relic-icons.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-17。与怪物线（TODO-16）并行：本任务画立绘/遗物图，怪物线做机制；新增怪物的立绘在怪物线落地后补。语义验收交玩家，不做读图评审。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为程序化美术内容，无玩法/数值改动，L_D/L_G/L_S 无需量化。
