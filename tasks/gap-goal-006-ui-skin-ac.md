---
id: gap-goal-006-ui-skin-ac
title: GOAL-006 充分性缺口：UI 图标与卡面皮肤化缺目标级 AC（提案新增 AC-043）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node tests/browser-ui-skin.mjs
depends_on:
  - ART-001
  - gap-sprite-pipeline
---
## Proposal

GOAL-006（视觉重制：全面精灵化，落地「暗黑霓虹几何」）的退出条件是合取式。第三条原文逐字为：

> 8 塔（含进化形态）、12+ 敌人与首领、召唤物、可破坏物、传送门、基地都有独立精灵与至少两种状态动画；UI 图标与卡面完成皮肤化。

**未被覆盖的部分（逐字）：「UI 图标与卡面完成皮肤化。」**

同一句的前半（对象维度：塔 / 敌人 / 召唤物 / 可破坏物 / 传送门 / 基地的独立精灵与至少两种状态动画）由 AC-023 覆盖；**后半在 GOAL-006 的全部在域 AC 里没有任何见证**——「皮肤化」被当成可读性指标的副产品，而实际上没有任何一条 AC 测量过图标与卡面的像素来源。

**为什么现有 AC 集不覆盖它**（逐条对照 AC-021…AC-029、AC-031）：

- **AC-023**（`node --test tests/sprite-coverage.test.mjs`）只覆盖**对象维度**：塔/敌人/召唤物/可破坏物/传送门/基地的 id 与状态帧。它的 origin 只引用了退出条件第三条的前半。manifest 现状也佐证：`public/assets/sprites/manifest.json` 共 158 条，`ui/` 前缀只有 7 条，全部是场景面板与徽记（`ui/scene-title-logo`、`ui/scene-map-card`、`ui/scene-map-thumbnail`、`ui/scene-combat-hud`、`ui/scene-result-panel`、`ui/scene-map-badge`、`ui/scene-result-badge`）——**没有任何 `ui/icon-*` 或 `ui/card-*` 条目**。
- **AC-025**（`node scripts/visual-check.mjs --suite ui`）的 criterion 只读 `uiMetrics()`（`scripts/visual-check.mjs:145-158`）的 `minFontSize` / `hudContrast` / `shopContrast` / `lockedFontSize` / `lockedOpacity` / `lockedVisible`——这是**可读性指标**，不是贴图来源。标题里写着「UI 皮肤化与可读性」，但 criterion 里「皮肤化」没有对应读数：把塔卡、遗物卡、海克斯卡、技能卡全部留在纯 CSS + 内联 SVG，这六项照样全绿。
- **AC-031**（`node tests/browser-sprite-scenes.mjs`）断言 DOM 里 `[data-sprite-id]` 的 id 集与 `SCENE_SPRITES[scene].required` **完全相等**；而该表（`public/js/shared/scene-sprites.js:55-60`）只有 title 2 条 / map 2 条 / combat 2 条 / result 1 条**场景面板**。塔卡、遗物卡、技能卡、海克斯卡、地图卡与 22 个 UI 图标**不在任何 required 集里**，它们全部缺席也不会让 AC-031 变红。
- **AC-024**（`--suite art`）从像素读背景层次、单位与背景 ΔE、剪影覆盖；程序化绘制的卡面同样能过阈值，判据不是「像素来自 manifest 的哪一条」。
- **AC-021 / AC-022 / AC-026 / AC-027 / AC-028 / AC-029** 分别是文档 schema、管线契约、双语、移动布局、性能预算、语义评审记录，与「图标/卡面是否走贴图」正交。

**代码事实（当前 HEAD）：**

- UI 图标是内联 SVG：`public/js/render/canvas-shapes.js:11` 的 `ICON_PATHS`（22 个名字：tower / enemy / skill / settings / relic-common / relic-rare / relic-epic / sound / muted / lock / close / pause / fullscreen / rename / cores / gold / victory / warning / empty / rotate / bell）经 `iconSvg()`（:58）直接吐 `<svg><path>`；`ICON_NAMES`（:45）即注册表全集。Canvas 侧的 `drawIcon()`（:82）共用同一份路径。
- 卡面是纯 DOM + CSS，没有任何贴图挂点：`.tower-card`（`public/js/ui/shop.js:54`）、`.relic-card`（`public/js/ui/modals.js:111`，含 `evolution-card`）、`.hex-card`（`public/js/ui/hex-select.js:55`）、`.skill-card`（`public/js/ui/title.js:122`）、`.map-card`（`public/js/ui/modals.js` 地图弹窗模板）。
- 这条要求不是可选项，美术方向文档已经把它写成规范：`docs/ART_DIRECTION.md:101`「字体族沿用系统无衬线栈；精灵化不改字体，改的是图标与底纹。」；`docs/ASSET_PIPELINE.md:59` 的目录树也已为 `ui/<组件>-<状态>.png`（图标、边框、九宫格底纹）留位。

**提案：为 GOAL-006 新增一条 AC（AC-043；当前最小空闲号，AC-001…AC-042 已占用）**

- id：`AC-043`
- title：UI 图标与卡面皮肤化：图标注册表与五类卡面全部走 manifest 精灵，缺资源程序化回退
- criterion：`node tests/browser-ui-skin.mjs`
- expect：`exit 0`
- origin：GOAL-006 退出条件第三条：「…；UI 图标与卡面完成皮肤化。」

**为什么这条 AC 覆盖了缺口：** 它的 criterion 在真实浏览器里判定「图标 / 卡面的像素来源是 manifest 条目」这件事本身，而不是它们的可读性或场景归属：22 个 `ICON_PATHS` 名字与 5 类卡面（tower / relic / skill / hex / map）必须在 `UI_SKIN_IDS` 里映射到 `ui/icon-<name>` / `ui/card-<type>`，这些 id 必须能在 `public/assets/sprites/manifest.json` 解析且 `sprites.spriteStyle(id)` 非空，页面里渲染出的实例必须带 `data-sprite-id` 且**不带** `data-sprite-fallback`；第二臂用 CDP 屏蔽 `*assets/sprites/*` 后重载，断言图标回退到内联 SVG、卡面回退到既有 CSS 且画面无空白块、`window.__bootErrors` 为空。它与 AC-023（对象维度）、AC-025（可读性指标）、AC-031（场景面板 × 视口）**互为补集**：上述任何一条单独通过，都不能推出 UI 图标与卡面真的在使用贴图。

<!-- dedup-ref -->
相邻但不重叠的任务：QA-004（`todo`，合并后的全局视觉一致性收口——机制是调色板/描边/动效对齐，其 Touches 不含本任务的卡面与图标文件）、gap-goal-006-scene-sprite-adoption-ac（`done`，已落地 AC-031，只覆盖四场景面板与视口矩阵）。本任务只做「UI 图标与卡面 × 资源来源」这一维，机制不同、验收面独立，判定 separate，不合并。文件侧检查（`task-granularity-advice --json`）当前 `peers: []`，无 open 任务声明相同 Touches。

## Plan

1. **文档先行**（CLAUDE.md 约定：影响接口/表现的改动先改设计文档；实现任务不碰 `docs/PRD.md` / `docs/TECH_DESIGN.md`）：
   - `docs/PHASE_FEEL_ART.md`：新增「UI 图标与卡面」冻结表——id 命名（`ui/icon-<name>`、`ui/card-<type>`）、22 个图标名（与 `ICON_PATHS` 一一对应）、5 类卡面（tower / relic / skill / hex / map）及其状态（默认 / 锁定 / 选中）、尺寸与九宫格切分、DPR 变体、缺资源时的程序化回退语言（内联 SVG / 既有 CSS）。
   - `docs/ASSET_PIPELINE.md`：在既有命名分组里补 `ui/icon-*` / `ui/card-*` 两类与它们的 provenance 字段要求；保持 `node --test tests/art-spec.test.mjs` 绿（该测试解析本文件的章节与 schema，新增内容必须落在既有 schema 内）。
2. 新增 `public/js/shared/ui-skin.js`（纯数据 / 纯函数，导入期零 DOM、零 `Math.random`、不 import 模拟层与渲染层），形状对齐既有的 `public/js/shared/scene-sprites.js`：
   - `UI_SKIN_IDS = { icons: { <22 names> → 'ui/icon-<name>' }, cards: { tower, relic, skill, hex, map → 'ui/card-<type>' } }`，加载时深冻结；
   - `uiSkinId(kind, name)`（未知返回 `null`，不抛错）、`missingUiSkins(readyIds)`、`applyUiSkinTo(root, sprites)` / `applyUiSkinElement(el, sprites, id)`——命中时写 `data-sprite-id` + CSS 变量承载图集 URL，缺资源时写 `data-sprite-fallback="1"` 并**保留既有内联 SVG / CSS**，不覆盖成空白。
3. `scripts/build-sprite-atlas.mjs`：新增声明式 spec，把 22 个图标与 5 类卡面（含锁定 / 选中态）生成为 `public/assets/sprites/ui/ui-atlas@{1x,2x}.png` + `ui-atlas.json`。零第三方依赖、同输入两次字节一致、色值取自 `art-tokens.js`，**不手绘、不引入第三方素材**。
4. `public/assets/sprites/manifest.json`：为上述每条资源写 `provenance`（source / license / generator），与 ART-001 定的 schema 一致。
5. 接线（DOM 模块内**不** `new Image`，只调用注入管线的只读访问器）：
   - `public/js/render/canvas-shapes.js`：`iconSvg()` 输出带 `data-sprite-id="ui/icon-<name>"` 的宿主元素，内联 `<svg>` 作为回退子节点；
   - `public/js/ui/shop.js`（`.tower-card`）、`public/js/ui/modals.js`（`.relic-card`、`.map-card`）、`public/js/ui/hex-select.js`（`.hex-card`）、`public/js/ui/title.js`（`.skill-card`）加卡面 `data-sprite-id` 与皮肤样式。
6. 测试：
   - `tests/ui-skin.test.mjs`（`node --test`）：`UI_SKIN_IDS` 覆盖全部 `ICON_NAMES` 与 5 类卡面、每个 id 能在 manifest 解析、未知键返回 `null`、回退语义（`spriteStyle` 返回 `null` 时 `applyUiSkinElement` 返回 false 且加 `data-sprite-fallback`）、源码断言（四个 UI 模块含 `data-sprite-id` 且仍无 `new Image`；`ui-skin.js` 不 import sim/render、不含 `Math.random`）。
   - `tests/browser-ui-skin.mjs`（本提案要新增的 AC-043 的 criterion，复用 `tests/harness.mjs`）：臂一在桌面与移动两视口实跑，覆盖标题技能卡、海克斯弹窗、地图弹窗、战斗商店塔卡与 HUD 图标，断言每个实例的 `data-sprite-id` 等于 `UI_SKIN_IDS` 映射、无 `data-sprite-fallback`、背景 URL 解析到 `/assets/sprites/`；臂二屏蔽 `*assets/sprites/*` 后重载，断言回退标记存在、元素仍有非零尺寸、`window.__bootErrors` 为空、管线 `stats().failed > 0`。
7. `scripts/test-changed.mjs`：为新增源文件补 `TEST_MAP` 条目（`public/js/shared/ui-skin.js` → `tests/ui-skin.test.mjs`），避免全量 suite 的「审计覆盖」项变红。
8. 不新增第三方依赖、不改构建步骤；不改战斗数值、模拟、RNG、存档或计分；`npm test` 只新增 `tests/ui-skin.test.mjs`（`browser-ui-skin.mjs` 不是 `*.test.mjs`，不进 `npm test`）。

## AC

- [ ] `node tests/browser-ui-skin.mjs` exit 0（这是本提案要为 GOAL-006 新增的 AC-043 的 criterion）
- [ ] `node --test tests/ui-skin.test.mjs` exit 0
- [ ] `UI_SKIN_IDS.icons` 恰好覆盖 `ICON_NAMES` 的全部 22 个名字、`UI_SKIN_IDS.cards` 恰好覆盖 tower / relic / skill / hex / map 五类，且每条 id 都能在 `public/assets/sprites/manifest.json` 解析并带 `provenance`（source / license / generator）
- [ ] 资源齐全臂：桌面与移动两视口下，每个图标实例与每类卡面实例都带 `data-sprite-id`、无 `data-sprite-fallback`，且 `spriteStyle()` 解析出的背景 URL 指向 `/assets/sprites/ui/` 图集
- [ ] 缺资源臂：屏蔽 `*assets/sprites/*` 后重载，图标回退到内联 SVG、卡面回退到既有 CSS，所有实例仍有非零尺寸、`window.__bootErrors` 为空、`stats().failed > 0`，无未捕获异常
- [ ] 源码断言：`public/js/ui/shop.js`、`public/js/ui/modals.js`、`public/js/ui/hex-select.js`、`public/js/ui/title.js`、`public/js/render/canvas-shapes.js` 含 `data-sprite-id` 且不含 `new Image`；`public/js/shared/ui-skin.js` 不 import sim/render、不含 `Math.random`
- [ ] `node --test tests/art-spec.test.mjs` exit 0（新增的两段文档仍在既有 schema 内）
- [ ] `node scripts/visual-check.mjs --suite ui` 与 `node scripts/visual-check.mjs --suite mobile` exit 0（字号/对比度/锁定态与移动布局不回归）
- [ ] `npm run perf:budget` exit 0
- [ ] `npm test` exit 0
- [ ] 本提案获人认可、AC-043 已写入 GOAL-006 目标库（待外部）

## DoD

- [ ] 真实浏览器（Chrome，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）桌面与移动两视口实跑：输出每个图标 / 每类卡面的 `data-sprite-id`、解析到的图集 URL、渲染尺寸与截图路径；截图人眼可见卡面与图标确实来自图集，而不是内联 SVG / 纯 CSS
- [ ] 同一两视口再跑资源屏蔽臂：截图 + `window.__bootErrors` 为空 + 回退统计，证明缺资源时回退是既有程序化语言且不出现空白块
- [ ] 前后对照：改造前后同 seed 的桌面与移动 contact sheet 落盘（`docs/reviews/ui-skin-desktop-contact-sheet.png` / `ui-skin-mobile-contact-sheet.png` / `ui-skin-fallback-contact-sheet.png`）
- [ ] 生成器可重复：连续两次构建 `ui-atlas` 字节一致；manifest 每条 `ui/icon-*` / `ui/card-*` 都有出处、授权与生成方式记录
- [ ] 不回归：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` exit 0；`npm run perf:budget` exit 0；同 seed 对局结果与改造前一致
- [ ] `docs/PHASE_FEEL_ART.md` / `docs/ASSET_PIPELINE.md` 的 UI 皮肤表与实现一致；Notes 记录 id 清单、状态数、视口/DPR 差异与回退路径
- [ ] 人裁定记录写入 Notes：认可 AC-043（推荐）/ 调整 criterion / supersede 并说明为什么 UI 图标与卡面皮肤化不应有目标级 AC（待外部）

## Touches

- `tasks/gap-goal-006-ui-skin-ac.md`
- `docs/PHASE_FEEL_ART.md`
- `docs/ASSET_PIPELINE.md`
- `public/js/shared/ui-skin.js` (new)
- `public/js/render/canvas-shapes.js`
- `public/js/ui/shop.js`
- `public/js/ui/modals.js`
- `public/js/ui/hex-select.js`
- `public/js/ui/title.js`
- `scripts/build-sprite-atlas.mjs`
- `public/assets/sprites/manifest.json`
- `public/assets/sprites/ui/ui-atlas@1x.png` (new)
- `public/assets/sprites/ui/ui-atlas@2x.png` (new)
- `public/assets/sprites/ui/ui-atlas.json` (new)
- `tests/ui-skin.test.mjs` (new)
- `tests/browser-ui-skin.mjs` (new)
- `scripts/test-changed.mjs`
- `docs/reviews/ui-skin-desktop-contact-sheet.png` (new)
- `docs/reviews/ui-skin-mobile-contact-sheet.png` (new)
- `docs/reviews/ui-skin-fallback-contact-sheet.png` (new)
