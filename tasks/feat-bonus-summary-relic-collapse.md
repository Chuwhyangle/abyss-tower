---
id: feat-bonus-summary-relic-collapse
title: 加成数据一览面板 + 遗物栏可收起
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs
---
## Proposal

两个信息可达性改进（`docs/TODO.md` TODO-8）：① 现在没有「全部加成汇总」面板——只有逐件 tooltip（`shop.js` 的 `relicEffectText`），`sim.mods` 聚合后的最终加成（伤害/攻速/射程/金币/减速/暴击等）无处总览；② 遗物栏桌面常驻不可收（`styles.css:660-674`）、移动端直接隐藏。方案：新增「加成一览」面板——汇总 `sim.mods` 的最终加成并列出来源（遗物/海克斯/契约/教义/天赋逐件效果）；遗物栏加折叠按钮（桌面收起）+ 移动端抽屉，与 TODO-7 的信息可达性联动。不改 `sim.mods` 的聚合逻辑，只做读侧展示。

## AC

- [x] 「加成一览」面板汇总 `sim.mods` 最终加成（伤害/攻速/射程/金币/减速/暴击等，含塔类型维度），并列出来源 item（遗物/海克斯/契约/教义/天赋）
- [x] 遗物栏桌面可折叠收起/展开；移动端以抽屉形式可开合
- [x] 面板数据与 `sim.mods`/遗物列表一致（不新造数值），i18n 键 zh/en 对称
- [x] `node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/ui/hud.js`、`public/js/ui/shop.js`、`public/index.html`、`public/styles.css`，不引入第三方依赖
- [x] 新增/扩展回归测试：加成一览数据正确、遗物栏折叠状态
- [x] `npm test` 全绿；补跑 `node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/ui/hud.js`
- `public/js/ui/shop.js`
- `public/index.html`
- `public/styles.css`
- `tests/ui-modules.test.mjs`
- `tests/ui-split.test.mjs`
- `tests/panels-visual.test.mjs`
- `tests/browser-mobile.mjs`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tasks/feat-bonus-summary-relic-collapse.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-8。深和宽：加成一览与遗物收起一起做，并与 TODO-7（手机适配）的信息可达性方向对齐。若 worker 实际 Touches 有出入（如新增 i18n 文件、新测试文件），须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为 UI 展示改进，不引入新结构文档面，L_D/L_G/L_S 无需量化。