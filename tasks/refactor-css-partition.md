---
id: refactor-css-partition
title: 并发重构·阶段2：拆 styles.css 为 ~15 个分区 css
status: todo
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

- [ ] styles.css 拆成 ~15 个分区 css + index.html 多 link，顺序正确
- [ ] `tests/ui-styles.test.mjs`、`tests/panels-visual.test.mjs`、`tests/a11y-color.test.mjs` 绿
- [ ] `npm run smoke` 通过（含 zh_CN locale）
- [ ] 拆分后 worker 加样式只碰自己 feature 的 css

## DoD

- [ ] 落地于 `public/css/*`(新)、`public/index.html`，零第三方依赖
- [ ] 机械搬运不改选择器/令牌值；tokens 只在 tokens.css
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/styles.css`
- `public/index.html`
- `public/css/` (新分区)
- `tests/ui-styles.test.mjs`
- `tasks/refactor-css-partition.md`

## Notes

立案 2026-11-06，路线图阶段 2。⚠️ 无构建步骤，~15 个 `<link>` 首屏多 ~14 个请求（`server/http/static.mjs` 有缓存，本地可接受，`docs/PERFORMANCE.md` 记一笔）。与阶段 3（UI registry，也碰 index.html）串行。