---
id: gap-mobile-visual-font-floor
title: 移动端视觉字号下限：修掉标题技能卡 8.5px 与移动 HUD 9–10px 小字，让 mobile 套件 exit 0（AC-027）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/visual-check.mjs --suite mobile
goal_ac: AC-027
---
## Proposal

GOAL-006 退出条件要求「移动视口与低配降级路径通过」，AC-027 以 `node scripts/visual-check.mjs --suite mobile`（expect exit 0）见证。当前证据是一次真实失败读数（2026-10-27T03:30:08Z），不是能力缺失：mobile 套件 6 项里 5 项已过 —— 横屏/竖屏横向溢出 0px（阈值 ≤1）、最小可点击尺寸 44px（≥40）、画布 458.31×249.98（≥380×200）；唯一失败项是「移动端最小字号 8.5px（阈值 ≥12）」。

本机复现（`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite mobile`）得到同一读数 8.5000。mobile 套件的最小字号取 title@mobile（390×844 竖屏）与 combat@mobile-landscape（844×390 横屏）两份 DOM 的较小值（`scripts/lib/visual-metrics.mjs:341`），所以两处都要抬到 ≥12px：

- 8.5px 全仓仅一处：`public/styles.css:2715` 的 `.skill-role`（2720 行的 font-size），渲染在标题页技能卡里（`public/js/ui/title.js:100`），文案由 `skillRole(entry)` 提供；
- 同一张卡上还有 `.skill-desc` 10.5px（2750）、`.skill-summary` 9.5px（2757）、`.skill-actions .btn` 10.5px（2773）、`.skill-lock`/`.skill-max` 10px（2779/2784），以及卡头 `.skill-cards-head .eyebrow` 9px（2627）与 `.skill-cards-head .muted` 10px（2633）——只修 8.5px，下一次读数会立刻落到 9px；
- 战斗横屏走 `@media (max-width: 900px), (max-height: 520px)`（styles.css:2237 起）：`.stat-label`/`.stat-max` 9px（2259/2268）、`.diff-badge`/`.speed-btn` 10px（2276/2287），另有 `.tower-card .name` 11.5px、`.tower-card .cost` 10.5px、`#btn-relics-mobile` 11px 等 11–11.5px 档。

这是纯表现层缺陷：小字在 390×844 / 844×390 下对低视力用户不可读，而 AC-027 的阈值就是 12px。修复不进入模拟、计分、接口或 RNG 调用顺序。

<!-- dedup-ref -->
相邻但不同的任务：`gap-ui-readability-font-floor`（AC-025，桌面 ui 套件）修的是 combat@desktop（1440×900）可见文本里的 `.hex-badge`/`.hex-badge-mul`；本条失败样本全在移动视口 —— 标题页技能卡（ui 套件根本不采集 title 场景）与移动媒体块里的 HUD 覆盖值，验收命令、样本面、目标 AC 均不同，判定 separate，不合并。两条任务都改 `public/styles.css`/`docs/TECH_DESIGN.md`/`tests/ui-styles.test.mjs`，由调度器按 Touches 串行即可；本任务自足：若该任务已抬高字号令牌，直接复用其取值，否则按本任务的取值做到 ≥12px。

## Plan

1. 先文档后代码：在 `docs/TECH_DESIGN.md` §14.4「可访问性基线」补移动视口口径 —— 390×844（竖屏）与 844×390（横屏）下可见文本最小字号同样 ≥12px，白名单仍是 `.key`（快捷键角标）与 `.glyph`（图标字形）；写明验收命令 `node scripts/visual-check.mjs --suite mobile`，并注明 `--quality low` 低配路径用同一阈值。若 §14.4 已有桌面 12px 下限的措辞（gap-ui-readability-font-floor 可能已写），沿用其表述，不另立第二套口径。
2. 改 `public/styles.css` 标题页技能卡：`.skill-role` 8.5→≥12、`.skill-desc` 10.5、`.skill-summary` 9.5、`.skill-actions .btn` 10.5、`.skill-lock`/`.skill-max` 10、`.skill-cards-head .eyebrow` 9、`.skill-cards-head .muted` 10 全部抬到 ≥12px；优先消费 `--text-*` 令牌。层级差异改用颜色/字重/字距表达，不靠缩小字号。
3. 改移动 HUD 媒体块：`@media (max-width: 900px), (max-height: 520px)` 内的 `.stat-label`/`.stat-max` 9px、`.diff-badge`/`.speed-btn` 10px，以及同类 11–11.5px 小字（`.tower-card .name`/`.cost`、`#btn-relics-mobile` 等）抬到 ≥12px。
4. 布局护栏：844×390 横屏的 HUD 依赖紧凑间距（styles.css:2249 注释写明 5px gap 是为英文界面不换行而选），字号抬高后必须重新分配 padding/gap/letter-spacing，必要时用更短的可见文案或把非关键块整体隐藏，保住横屏/竖屏横向溢出 ≤1px、最小可点击 ≥40px、画布 ≥380×200。不得用 `display:none` 隐藏正文、不得把正文塞进 `.key`/`.glyph` 白名单、不得改阈值或采集逻辑过关。
5. 迭代测：反复跑 `node scripts/visual-check.mjs --suite mobile`，每次最小字号样本换到别的选择器就继续修到 ≥12，直到 6 项全绿；逐次读数记进 Evidence。
6. 低配路径：`node scripts/visual-check.mjs --suite mobile --quality low` 必须同样 exit 0（DOM 指标与画质正交，用来证明降级路径不是靠隐藏或缩小文字过关）。
7. 源码级回归：在 `tests/ui-styles.test.mjs` 增加断言 —— 解析 `:root` 字号令牌后，断言第 2、3 步列出的选择器（含媒体块内的 `.stat-label`/`.stat-max`/`.diff-badge`/`.speed-btn`）的 `font-size` 解析值 ≥12px；把 `.skill-role` 临时改回 8.5px 时该断言必须失败。
8. 回归：`node scripts/visual-check.mjs --suite ui` 与 `--suite art` 不得回退（ui 若仍因桌面小字失败，只记录现状、不在本任务修）；`npm test` 全绿，重点 `node --test tests/ui-styles.test.mjs tests/visual-check.test.mjs tests/skill-style.test.mjs`。

## AC

- [x] `node scripts/visual-check.mjs --suite mobile` exit 0；输出 6 项读数逐项列出，其中 `移动端最小字号` ≥ 12
- [x] `node scripts/visual-check.mjs --suite mobile --quality low` exit 0（低配降级路径同阈值通过）
- [x] `node --test tests/ui-styles.test.mjs` 通过，且新增的移动端 ≥12px 断言在把 `.skill-role` 临时改回 8.5px 时会失败（反向验证写进 Evidence）
- [x] `node --test tests/visual-check.test.mjs tests/skill-style.test.mjs` 与 `npm test` 全绿
- [x] `docs/TECH_DESIGN.md` §14.4 含移动视口 12px 下限与 `node scripts/visual-check.mjs --suite mobile` 验收命令

## DoD

- [x] 真实跑通 mobile 套件并把全绿输出贴进 Evidence（不是「应该能过」）
- [x] 用 `node tests/visual-scenes.mjs --scene title --viewport mobile --out <dir>` 与 `node tests/visual-scenes.mjs --scene combat --viewport mobile-landscape --out <dir>` 各采集一次，确认技能卡与 HUD 不换行/不溢出、小字清晰可读
- [x] `git diff` 可证 `scripts/visual-check.mjs`、`tests/visual-scenes.mjs`、`scripts/lib/visual-metrics.mjs` 零改动（阈值与采集逻辑不动）
- [x] 只改表现层：`public/js/sim.js`、`public/js/shared/` 与任何模拟/计分/RNG 路径零改动
- [x] 移动端触控与画布读数不回归：最小可点击仍 ≥40px、画布仍 ≥380×200（同一次 mobile 输出可证）

## Touches

- `public/styles.css`
- `tests/ui-styles.test.mjs`
- `docs/TECH_DESIGN.md`
- `tasks/gap-mobile-visual-font-floor.md`

## Evidence

**1. 浏览器见证：mobile 套件 8.5px → 12px**（本 worktree，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）

    $ node scripts/visual-check.mjs --suite mobile
    视觉检查 · mobile
      [mobile] PASS
        ✔ 横屏横向溢出（px）: 0（阈值 ≤ 1）
        ✔ 竖屏横向溢出（px）: 0（阈值 ≤ 1）
        ✔ 最小可点击尺寸（px）: 44（阈值 ≥ 40）
        ✔ 画布宽度（px）: 458.3100（阈值 ≥ 380）
        ✔ 画布高度（px）: 249.9800（阈值 ≥ 200）
        ✔ 移动端最小字号（px）: 12（阈值 ≥ 12）
    结论：通过 → exit 0

修复前同一命令：`✘ 移动端最小字号（px）: 8.5000`，样本 `skill-role`。修完 `.skill-role` 后读数按预期换到下一个最小样本，逐轮记为：title@mobile `logo-kicker` = 12、combat@mobile-landscape `stat-label` = 12 —— 两份 DOM 的最小值都是 12，不再是「修一个、掉一个」。

**2. 低配路径同阈值**

    $ node scripts/visual-check.mjs --suite mobile --quality low
    … 同上 6 项全 ✔（移动端最小字号 12）→ exit 0

**3. 源码级断言 + 反向验证**

    $ node --test tests/ui-styles.test.mjs
    # pass 8 / fail 0

    # 反向验证：临时把 .skill-role 改回 font-size: 8.5px
    not ok 5 - 可见正文字号不低于 12px 下限（含移动 HUD 与技能卡覆盖）
      error: '.skill-role 的 font-size 为 8.5px，低于 12px 下限（8.5px）'
    # pass 7 / fail 1        ← 改回 var(--text-min) 后恢复 8/8

新增断言解析 `:root` 令牌后，逐个选择器（含 `@media` 块里的覆盖值）断言 `font-size` ≥12px；`--text-min` 本身就是下限令牌（12px），避免以后再往 9–11px 压。

**4. 回归**

    $ node --test tests/ui-styles.test.mjs tests/visual-check.test.mjs tests/skill-style.test.mjs
    # pass 36 / fail 0
    $ npm test
    # pass 1480 / fail 0
    $ node scripts/visual-check.mjs --suite art   → PASS，exit 0
    $ node scripts/visual-check.mjs --suite ui    → FAIL（最小可见字号 10.5px：桌面 .relic-title span / #relic-count / .relic-empty / .shop-hint / .wave-state）

`ui` 套件在本任务之前就是 FAIL（基线 10px `hex-badge-mul`）；本次把桌面最小字号抬到 10.5px，未回退。剩余桌面小字属 `gap-ui-readability-font-floor`（AC-025），按 Plan 第 8 步只记录现状、不在本任务修。

**5. 布局护栏（实测）**

- 844×390：HUD 仍是两行，`.hud-right` 737px / 可用 828px（余量 91px），字号抬高没有多撑一行；画布 458.31×249.98 与最小触控 44px 不变；stage-wrap 250px 与 shop（y=332 起）不重叠。
- 390×844：三张技能卡 `scrollWidth == clientWidth`（无横向溢出），卡头 316px 单行放得下；`document.scrollWidth == innerWidth`。
- `logo-kicker` 字距 0.52em→0.36em 换出的空间让 12px 在 390px 竖屏不溢出；卡头 `flex-wrap` 兜住窄屏换行。

**6. 采集截图**（`node tests/visual-scenes.mjs --scene title --viewport mobile --out …`、`--scene combat --viewport mobile-landscape --out …`）各跑一次：技能卡「控场」角色徽标 12px、描述 12.5px、摘要 12px 清晰可读；横屏 HUD「波次/金币/基地/击杀」「漫游」「1×2×3×」与塔卡「弩塔 70 / 未解锁」全部 ≥12px，无换行错位。

**7. 「零改动」证明**

- 本次提交只动 `public/styles.css`、`tests/ui-styles.test.mjs`、`docs/TECH_DESIGN.md`（+ 本任务文件）；`scripts/visual-check.mjs`、`tests/visual-scenes.mjs`、`scripts/lib/visual-metrics.mjs` 零改动 —— 阈值与采集逻辑未动。
- `public/js/sim.js`、`public/js/shared/`、计分与 RNG 路径零改动；改动全是 CSS 字号/字距/换行 + 一条源码级测试。