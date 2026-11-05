---
id: refactor-css-partition
title: 并发重构·阶段2：拆 styles.css 为 ~15 个分区 css
status: ready
labels:
  - refactor
parent: null
children: []
extra: {}
---
## Proposal

并发友好重构·阶段 2：拆 `styles.css`（4397 行单体，5 路 Touches 冲突）。

- 按现有 `/* ====== 区块 ====== */` 分节，机械拆成 ~15 个分区 css：`public/css/{tokens,base,title,shop,hud,modals,nodes,mobile,skills,achievements,meta,transitions,hex,a11y}.css`。
- `tokens.css`（设计令牌 + @font-face）永远最先加载；令牌只允许出现在 tokens.css（延续「设计令牌只在这定义」纪律）。
- `index.html` 从 1 个 `<link>` 变 ~15 个 `<link>`（顺序 = 级联顺序）。
- 机械搬运、不改任何选择器（diff 可审查）。

## AC

- [x] styles.css 拆成 ~15 个分区 css + index.html 多 link，顺序正确
- [x] `tests/ui-styles.test.mjs`、`tests/panels-visual.test.mjs`、`tests/a11y-color.test.mjs` 绿
- [x] `npm run smoke` 通过（含 zh_CN locale）
- [x] 拆分后 worker 加样式只碰自己 feature 的 css

## DoD

- [x] 落地于 `public/css/*`(新)、`public/index.html`，零第三方依赖
- [x] 机械搬运不改选择器/令牌值；tokens 只在 tokens.css
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/styles.css`
- `public/index.html`
- `public/css/tokens.css` (new)
- `public/css/base.css` (new)
- `public/css/title.css` (new)
- `public/css/shop.css` (new)
- `public/css/hud.css` (new)
- `public/css/modals.css` (new)
- `public/css/nodes.css` (new)
- `public/css/mobile.css` (new)
- `public/css/skills.css` (new)
- `public/css/achievements.css` (new)
- `public/css/meta.css` (new)
- `public/css/transitions.css` (new)
- `public/css/hex.css` (new)
- `public/css/a11y.css` (new)
- `tests/lib/css-source.mjs` (new)
- `tests/ui-styles.test.mjs`
- `tests/panels-visual.test.mjs`
- `tests/a11y-color.test.mjs`
- `tests/transition.test.mjs`
- `tests/mobile-input.test.mjs`
- `tests/hex-flow.test.mjs`
- `tests/result-audio.test.mjs`
- `tests/ui-animation-audit.test.mjs`
- `tests/icon-system.test.mjs`
- `tests/art-spec.test.mjs`
- `tests/result-screen.test.mjs`
- `tests/result-scene-layout.test.mjs`
- `tests/ui-transitions.test.mjs`
- `scripts/ui-animation-audit.mjs`
- `scripts/test-changed.mjs`
- `docs/ART_DIRECTION.md`
- `docs/PROGRESSION_DESIGN.md`
- `docs/TODO.md`
- `docs/OWNERSHIP.md`
- `tasks/refactor-css-partition.md`

## Notes

立案 2026-11-06，路线图阶段 2。⚠️ 无构建步骤，~15 个 `<link>` 首屏多 ~14 个请求（`server/http/static.mjs` 有缓存，本地可接受，`docs/PERFORMANCE.md` 记一笔）。与阶段 3（UI registry，也碰 index.html）串行。

落地 2026-11-06：
- 分区映射（develop 4474 行）：tokens=设计令牌+@font-face、title=标题页、base=按钮、hud/shop=游戏页、modals=弹窗、nodes=节点地图、mobile=移动端、skills/achievements/meta=主动技能、transitions=动效+转场+过场、hex=主海克斯、a11y=高对比度+reduced-motion。按级联顺序重拼与原文逐行 0 diff（仅把高对比度块与 reduced-motion 归入最后加载的 a11y.css，级联经核对无选择器重叠）。
- 测试/脚本侧：所有读 styles.css 的测试改经 `tests/lib/css-source.mjs` 的 `readCss()` 按级联顺序拼接；`scripts/ui-animation-audit.mjs` 无参数默认整体审计 `CSS_CASCADE_ORDER`；`scripts/test-changed.mjs` TEST_MAP 增 `public/css/` 目录规则。
- 文档侧：ART_DIRECTION/PROGRESSION_DESIGN/TODO/OWNERSHIP 的 `public/styles.css` 路径迁移为 `public/css/*`（机械路径同步）。
- ⚠️ 文档 lane 跟进：`docs/TECH_DESIGN.md:354` 仍引用 `public/styles.css`（总文档，本文档 lane 不得入 Touches），导致 `tests/docs-consistency.test.mjs`、`tests/docs-phase-sync.test.mjs` 各红 1 条；需 DOCS-* 任务把该行迁移为 `public/css/tokens.css`。

## Blocker

**2026-11-05T20:56:55.201Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: name: 'AssertionError'
- run_id：wk-prod-anchor
- session_id：da32c4b7-df7d-473b-a471-f63d1cd183a5
