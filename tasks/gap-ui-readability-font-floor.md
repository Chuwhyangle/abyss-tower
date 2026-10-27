---
id: gap-ui-readability-font-floor
title: UI 可读性字号下限：修掉 10px 海克斯倍率角标，让 ui 视觉套件 exit 0（AC-025）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/visual-check.mjs --suite ui
depends_on:
  - VIS-001
goal_ac: AC-025
---
## Proposal

GOAL-006 退出条件要求「界面最小字号、对比度与未解锁卡可读性通过」，AC-025 以 `node scripts/visual-check.mjs --suite ui`（expect exit 0）见证。main 上该入口尚不存在，所以 AC 当前证据是 `criterion-capability-unevaluable`，而不是一次失败读数。

<!-- dedup-ref -->
机制分工：`scripts/visual-check.mjs`、`tests/visual-scenes.mjs` 与阈值表归 VIS-001（本任务依赖它已落地，不改它的阈值或采集逻辑）；本任务只负责把真实 UI 修到该套件全绿，并留下源码级回归护栏。在 VIS-001 分支上实测（其 `public/` 与 main 逐字节一致）：ui 套件 5 项里 4 项已过 —— HUD 文本对比度 7.57、商店卡文本对比度 16.87（阈值 ≥4.5）、未解锁卡字号 12.5px（≥12）、未解锁卡不透明度 0.5（≥0.45）；唯一失败项是最小可见字号 10px，样本 `hex-badge-mul`（HUD 海克斯倍率角标，`public/styles.css:3809` 硬编码 10px）。它的兄弟节点 `.hex-badge` 也是硬编码 11px，因此在只修 10px 之后，`.hex-badge-name` 会立刻成为下一个失败样本——两处必须一起做到 ≥12px。

这是纯表现层缺陷：1440×900 下倍率与徽标名对低视力用户不可读，且字号阶梯里的 `--text-xs`（11px）也没有被声明为「低于可读下限」。修复不改任何模拟、计分或接口。

## Plan

1. 先文档后代码：在 `docs/TECH_DESIGN.md` §14.4「可访问性基线」补一条可验收口径 —— 可见文本最小字号 ≥12px（快捷键角标 `.key`、图标字形 `.glyph` 不承载正文，不计入），未解锁卡名称/倍率同样 ≥12px 且整卡不透明度 ≥0.45，对比度沿用 WCAG AA ≥4.5:1，并写明验收命令 `node scripts/visual-check.mjs --suite ui`。字号阶梯的具体取值以 ART-001 的 `docs/ART_DIRECTION.md` 为准，本节只写下限与验收口径。
2. 改 `public/styles.css`：把 `.hex-badge`（11px）与 `.hex-badge-mul`（10px）提升到 ≥12px，优先消费字号令牌（例如 `var(--text-sm)` = 12.5px）；若选择把 `--text-xs` 抬到 12px，须复核其余 8 处引用在 1440×900 与 390×844 下不溢出。徽标的层级差异改用颜色/字重/字距表达，不靠缩小字号。
3. 跑 `node scripts/visual-check.mjs --suite ui`，逐项读数必须全绿；若最小字号样本移到别的选择器，同样修到 ≥12px。不得通过隐藏元素、给文字套 `.key`/`.glyph`、或修改阈值/采集逻辑过关。
4. 回归：`node scripts/visual-check.mjs --suite art` 保持通过（ui 只动字号，不应影响 art 的像素指标）；`npm test` 全绿，重点 `node --test tests/ui-styles.test.mjs tests/a11y-color.test.mjs tests/hex-flow.test.mjs`。
5. 在 `tests/ui-styles.test.mjs` 增加源码级回归断言：先解析 `:root` 的 `--text-*` 令牌，再断言 `.hex-badge` 与 `.hex-badge-mul` 的 `font-size` 解析值 ≥12px。这样没有浏览器时 `npm test` 也能拦住回退到 10/11px。

## AC

- [ ] `node scripts/visual-check.mjs --suite ui` exit 0；输出中五项读数（min-font、hud-contrast、shop-contrast、locked-font、locked-opacity）逐项列出且全部达标
- [ ] 该输出的 `minFontSample` 不再是 `hex-badge-mul`，且没有任何样本靠 `.key`/`.glyph` 白名单或隐藏元素规避
- [ ] `node --test tests/ui-styles.test.mjs` 通过，且新增的 ≥12px 断言在把字号临时改回 10px 时会失败（把这次反向验证写进 Evidence）
- [ ] `node --test tests/a11y-color.test.mjs tests/hex-flow.test.mjs` 通过，`npm test` 全绿
- [ ] `docs/TECH_DESIGN.md` §14.4 含 12px 字号下限、未解锁卡可读口径与 `node scripts/visual-check.mjs --suite ui` 验收命令

## DoD

- [ ] 真实跑通 ui 套件并把全绿输出贴进 Evidence（不是「应该能过」）
- [ ] 用 `node tests/visual-scenes.mjs --scene combat` 采集 1440×900 与 390×844 截图，确认 HUD 徽标不换行/不溢出、倍率清晰可读，未解锁卡在商店中仍明显可辨
- [ ] `scripts/visual-check.mjs`、`tests/visual-scenes.mjs`、`scripts/lib/visual-metrics.mjs` 的阈值与采集零改动（`git diff` 可证）
- [ ] 只改表现层：`public/js/sim.js` 与任何模拟/计分路径零改动

## Touches

- `public/styles.css`
- `tests/ui-styles.test.mjs`
- `docs/TECH_DESIGN.md`
- `tasks/gap-ui-readability-font-floor.md`
