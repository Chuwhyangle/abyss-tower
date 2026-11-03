---
id: feat-stat-summary-panel
title: 加成一览面板 + 遗物栏可收起
status: superseded
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs
---
## Proposal

现在没有「全部加成汇总」面板——只有逐件遗物 tooltip（`shop.js` 的 `relicEffectText`），`sim.mods` 聚合后的最终加成（伤害/攻速/射程/金币/减速/暴击/生命等）无处总览；遗物栏桌面常驻不可收（`styles.css:660-674`）、移动端直接隐藏（`styles.css:2350-2352`）。本任务：① 新增「加成一览」面板，汇总 `sim.mods` 最终加成并标注来源（遗物/海克斯/契约/教义/天赋），复用 `stats-ui.js` 的统计口径或新建轻量面板；② 遗物栏加折叠按钮（桌面可收）+ 移动端抽屉（与 TODO-7 手机适配联动）。i18n 补新增文案键（zh-CN/en-US）。

## AC

- [ ] 「加成一览」面板可见：汇总 `sim.mods` 最终加成（伤害/攻速/射程/金币/减速/暴击等）并标注来源
- [ ] 遗物栏桌面可折叠收起/展开；移动端可从抽屉查看遗物与加成一览
- [ ] `node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/ui/hud.js`、`public/js/ui/shop.js`、`public/index.html`、`public/styles.css`，不引入第三方依赖
- [ ] 回归测试覆盖加成一览数据、折叠/展开、移动端抽屉可达性
- [ ] `npm test` 全绿；补跑 `node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/ui/hud.js`
- `public/js/ui/shop.js`
- `public/index.html`
- `public/styles.css`
- `tests/ui-modules.test.mjs`
- `tests/panels-visual.test.mjs`
- `tasks/feat-stat-summary-panel.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-8。**已被 `feat-bonus-summary-relic-collapse`（done）取代**：并发会话先落地了同一 TODO-8（加成一览 + 遗物收起，同一批文件同一份 AC），本任务为避免重复派发标记 superseded，不再实现。

该轴仍暗,理由:本任务为 UI 信息呈现增强，不改玩法/数值/文档面，L_D/L_G/L_S 无需量化。
