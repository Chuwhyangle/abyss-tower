---
id: gap-ui-readability-font-floor
title: UI 可读性字号下限：修掉 10px 海克斯倍率角标，让 ui 视觉套件 exit 0（AC-025）
status: done
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

- [x] `node scripts/visual-check.mjs --suite ui` exit 0；输出中五项读数（min-font、hud-contrast、shop-contrast、locked-font、locked-opacity）逐项列出且全部达标
- [x] 该输出的 `minFontSample` 不再是 `hex-badge-mul`，且没有任何样本靠 `.key`/`.glyph` 白名单或隐藏元素规避
- [x] `node --test tests/ui-styles.test.mjs` 通过，且新增的 ≥12px 断言在把字号临时改回 10px 时会失败（把这次反向验证写进 Evidence）
- [x] `node --test tests/a11y-color.test.mjs tests/hex-flow.test.mjs` 通过，`npm test` 全绿
- [x] `docs/TECH_DESIGN.md` §14.4 含 12px 字号下限、未解锁卡可读口径与 `node scripts/visual-check.mjs --suite ui` 验收命令（偏差：总文档归文档 lane，develop 的 §14.4 已含 12px 下限与未解锁卡口径；验收命令正本落在 `docs/PHASE_FEEL_ART.md` 的 AC-025 映射行与本任务 Notes）

## DoD

- [x] 真实跑通 ui 套件并把全绿输出贴进 Evidence（不是「应该能过」）
- [x] 用 `node tests/visual-scenes.mjs --scene combat` 采集 1440×900 与 390×844 截图，确认 HUD 徽标不换行/不溢出、倍率清晰可读，未解锁卡在商店中仍明显可辨
- [x] `scripts/visual-check.mjs`、`tests/visual-scenes.mjs`、`scripts/lib/visual-metrics.mjs` 的阈值与采集零改动（`git diff` 可证）
- [x] 只改表现层：`public/js/sim.js` 与任何模拟/计分路径零改动

## Touches

- `public/styles.css`
- `tests/ui-styles.test.mjs`
- `tasks/gap-ui-readability-font-floor.md`

## Notes

- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。

### 实现增量（§14.4 增量正本，2026-10-27）

- **令牌复用**：AC-027 已在 `:root` 落下 `--text-min: 12px` 下限令牌，并把 `.hex-badge` / `.hex-badge-mul` 从 11px/10px 抬到 `var(--text-min)`；本任务不重复定义令牌，而是把桌面战斗面剩余的四个 <12px 字面值统一改为引用同一令牌：`.wave-state` 11.5px、`.relic-title` 10.5px（其 `span` 与 `#relic-count` 继承）、`.relic-empty` 10.5px、`.shop-hint` 10.5px。
- **层级差异**：徽标倍率仍用 `--gold`、战斗状态用 `--gold`/`--muted`、遗物侧栏标题用 `--muted` + 字距，没有靠缩小字号区分层级。
- **采样面**：ui 套件只采集 combat@desktop 的直系文本节点（`tests/visual-scenes.mjs` 的 DOM 指标脚本）。修复后用同一套可见性判定枚举全视口文本节点，combat@desktop 已无 <12px 正文；未给任何正文元素加 `.key`/`.glyph`，也没有隐藏元素规避。
- **回归护栏**：`tests/ui-styles.test.mjs` 的「可见正文字号不低于 12px 下限」断言新增 `.wave-state` / `.relic-title` / `.relic-empty` / `.shop-hint`，无浏览器时也能拦住回退（已做反向验证）。
- **文档所有权偏差（与 AC-027 同处理）**：AC-5 原写 `docs/TECH_DESIGN.md` §14.4。DOCS-001 规定两份总文档只由 `DOCS-*` 任务修改，且 develop 的 §14.4「字号下限」条已由文档 lane 写入可见文本 ≥12px、白名单仅 `.key`/`.glyph`、未解锁内容 ≥12px 且整卡不透明度 ≥0.45、层级差异不靠缩字号。验收命令 `node scripts/visual-check.mjs --suite ui` 的正本在 `docs/PHASE_FEEL_ART.md` 的 AC-025 映射行；本任务 Touches 已摘除总文档，不越权写入。
- **范围边界（可另立后续任务）**：桌面其它屏幕（result / map / settings / 海克斯弹窗等）仍有 9–11.5px 字面值，不在 ui 套件的样本面内；本次不跨屏改动，避免一次改多处布局带来溢出风险。

## Evidence

**1. ui 套件全绿（本 worktree，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）**

    $ node scripts/visual-check.mjs --suite ui
    视觉检查 · ui
      [ui] PASS
        ✔ 最小可见字号（px）: 12（阈值 ≥ 12） · stat-label
        ✔ HUD 文本对比度: 7.5700（阈值 ≥ 4.5）
        ✔ 商店卡文本对比度: 16.8700（阈值 ≥ 4.5）
        ✔ 未解锁卡字号（px）: 12.5000（阈值 ≥ 12）
        ✔ 未解锁卡不透明度: 0.5000（阈值 ≥ 0.45）
    结论：通过 → exit 0

修复前同一命令：`✘ 最小可见字号（px）: 10.5000（阈值 ≥ 12） · SPAN`。样本收敛过程：任务基线 10px `hex-badge-mul` → AC-027 落地后 `.hex-badge`/`.hex-badge-mul` 已是 `var(--text-min)`=12px → 本次首测最小样本落到遗物侧栏与商店提示（10.5px）→ 修复后最小样本为 `stat-label` = 12px，`minFontSample` 不再是 `hex-badge-mul`。白名单只覆盖 `.key`/`.glyph`（快捷键角标与图标字形），本次没有给任何正文元素加这两个类，也没有用 `display:none`/`visibility` 规避。

**2. 源码级断言 + 反向验证**

    $ node --test tests/ui-styles.test.mjs
    # pass 8 / fail 0

    # 反向验证 A：把 .hex-badge-mul 临时改回 font-size: 10px
    not ok 5 - 可见正文字号不低于 12px 下限（含移动 HUD 与技能卡覆盖）
      error: '.hex-badge-mul 的 font-size 为 10px，低于 12px 下限（10px）'
    # pass 7 / fail 1   ← 恢复 var(--text-min) 后 8/8

    # 反向验证 B：把本次新增的 .relic-empty 临时改回 10.5px
    not ok 5 - 可见正文字号不低于 12px 下限（含移动 HUD 与技能卡覆盖）
      error: '.relic-empty 的 font-size 为 10.5px，低于 12px 下限（10.5px）'
    # pass 7 / fail 1   ← 恢复后 8/8

**3. 回归**

    $ node --test tests/a11y-color.test.mjs tests/hex-flow.test.mjs
    # pass 17 / fail 0
    $ node --test --test-concurrency=2 tests/*.test.mjs      # = npm test
    # tests 1551 / pass 1551 / fail 0（22.5s）
    $ node scripts/visual-check.mjs --suite art              → PASS（8/8），exit 0
    $ node scripts/visual-check.mjs --suite mobile           → PASS（6/6，移动端最小字号仍 12），exit 0
    $ node scripts/check-doc-ownership.mjs                   → OK（0 个 open 任务声明总文档）

**4. 截图与布局读数**

- `node tests/visual-scenes.mjs --scene combat --viewport desktop --out /tmp/ac025-desktop`（1440×900，3 帧）；`--viewport mobile-landscape --out /tmp/ac025-landscape`（844×390，3 帧）。
- 390×844：combat 在竖屏按产品设计显示「正在切换横屏」提示（`SCENE_VIEWPORTS.combat` 只允许 desktop/mobile-landscape），用同一 `VisualSceneSession` 在 390×844 采了一张，确认 HUD 徽标在上层仍单行、`document.scrollWidth == 390`（overflowX 0）。
- 三视口实测（1440×900 / 390×844 / 844×390）：overflowX = 0 / 0 / 0；`.hex-badge.hud` 140.36×23.59（line-height 15.6px，单行，scrollW == clientW == 138）；`.relic-title` 138×24 单行；`.relic-empty` 138×18；`.shop-hint` 1408×17 单行；`.tower-card.locked` 整卡 opacity 0.5、名称 12.5px（桌面）/12px（移动）且可见。
- 视觉确认：HUD「遗物吞噬者 ×1.10」与「战斗中」单行清晰；遗物侧栏「遗物 0 / 每波结束可三选一」可读；底栏商店已解锁卡与 5 张未解锁卡的「未解锁」仍明显可辨。

**5. 零改动证明**

- `git diff -- scripts/ tests/visual-scenes.mjs` 为空；本分支相对 develop 只改 `public/styles.css`、`tests/ui-styles.test.mjs`（+ 本任务文件）。
- `public/js/sim.js`、`public/js/shared/`、计分与 RNG 路径零改动。