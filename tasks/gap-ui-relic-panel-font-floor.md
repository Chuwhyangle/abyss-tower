---
id: gap-ui-relic-panel-font-floor
title: UI 可读性字号下限：修掉 9.5px 遗物等级角标 .relic-level，让 ui 视觉套件 exit 0（AC-025）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/visual-check.mjs --suite ui
depends_on: []
goal_ac: AC-025
---
## Proposal

GOAL-006 退出条件要求「界面最小字号、对比度与未解锁卡可读性通过」，AC-025 以 `node scripts/visual-check.mjs --suite ui`（expect exit 0）见证。当前台账证据为 fail：五项里只有 `最小可见字号（px）: 9.5000（阈值 ≥ 12）· relic-level` 红，其余四项（HUD 对比度 7.57、商店卡对比度 16.87、未解锁卡字号 12.5px、未解锁卡不透明度 0.5）全部达标。失败样本 `.relic-level` 是遗物列表条目里的等级角标——`public/js/ui/shop.js` 渲染 `<em class="relic-level">${view.levelLabel}</em>`，其样式在 `public/styles.css` 硬编码 `font-size: 9.5px`，跌破 12px 可读下限。

<!-- dedup-ref -->
为什么上一轮修复没守住：`gap-ui-readability-font-floor`（done）当时只把 combat@desktop 采样里可见的四个 <12px 选择器（`.wave-state` / `.relic-title` / `.relic-empty` / `.shop-hint`）抬到 12px；那时遗物列表为空、只渲染 `.relic-empty`，`.relic-level` 与 `.relic-chip` 根本没进样本面。现在 combat@desktop 出现带等级的遗物条目，9.5px 的 `.relic-level` 成为最小字号，同一机制（桌面战斗面可见正文 <12px）暴露了新样本，套件转红。这是纯表现层缺陷，不改模拟/计分/接口。

## Plan

1. 改 `public/styles.css`：`.relic-level` 从 9.5px 抬到 ≥12px（优先消费 `var(--text-min)`=12px 或 `var(--text-sm)`=12.5px）；同面板 `.relic-chip`（10.5px）、`.next-wave-panel .relic-title span`（10px）、`.next-wave-row`（10.5px）一并抬到 ≥12px，否则修完 9.5px 后它们会依次成为下一个最小样本。层级差异改用颜色/字重/字距表达，不靠缩小字号。
2. 跑 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite ui`，逐项读数全绿；`minFontSample` 不再是任何 <12px 遗物面板选择器。若最小字号样本移到别的选择器，同样修到 ≥12px。不得用 `.key`/`.glyph` 白名单或隐藏元素规避。
3. 扩展 `tests/ui-styles.test.mjs` 的「可见正文字号不低于 12px 下限」断言：新增 `.relic-level` / `.relic-chip` / `.next-wave-*` 选择器，并做反向验证（临时改回 9.5px 时断言红）。
4. 回归：`npm test` 全绿；`node scripts/visual-check.mjs --suite art` 与 `--suite mobile` 保持通过（只动桌面战斗遗物面板字号，不碰像素指标与移动端）。

## AC

- [ ] `node scripts/visual-check.mjs --suite ui` exit 0；五项读数逐项列出且全部达标，`minFontSample` 不再是 `.relic-level` 或其它 <12px 遗物面板选择器
- [ ] 该输出没有任何样本靠 `.key`/`.glyph` 白名单或隐藏元素规避
- [ ] `node --test tests/ui-styles.test.mjs` 通过，且新增的 ≥12px 断言在把 `.relic-level` 临时改回 9.5px 时失败（反向验证写进 Evidence）
- [ ] `npm test` 全绿；`node scripts/visual-check.mjs --suite art`、`--suite mobile` exit 0

## DoD

- [ ] 真实跑通 ui 套件并把全绿输出贴进 Evidence（不是「应该能过」）
- [ ] `scripts/visual-check.mjs`、`tests/visual-scenes.mjs`、`scripts/lib/visual-metrics.mjs` 阈值与采集零改动（`git diff` 可证）
- [ ] 只改表现层：`public/js/sim.js` 与任何模拟/计分/RNG 路径零改动
- [ ] `public/styles.css` 中 combat@desktop 可见正文（含遗物面板）无 <12px 字面值残留

## Touches

- `public/styles.css`
- `tests/ui-styles.test.mjs`
- `tasks/gap-ui-relic-panel-font-floor.md`