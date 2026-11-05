---
id: refactor-ui-registry
title: 并发重构·阶段3：UI/render 面板注册表，统一双 UI 装配
status: todo
labels:
  - refactor
parent: null
children: []
extra: {}
depends_on:
  - refactor-css-partition
---
## Proposal

并发友好重构·阶段 3：UI/render 面板注册表，统一「双 UI 装配机制」（最隐蔽的耦合），把 `index.html`/`ui.js`/`render.js` 移出热路径。

- 新增 `public/js/ui/registry.js`：面板自注册（`registerPanel(id, mount)`），`ui.js` 与 `index.html` 各留一个动态 bootstrap。
- `index.html` 的 13 个自挂载 `<script type="module">` 并行入口（achievements/bounties/cosmetics/daily-history/leaderboard/season/share/stats/relic-codex/replay/auth-ui）收敛为「1 个入口 script + 动态 import」，消除依赖图盲区。
- 新增 `public/js/render/registry.js`：渲染器自注册，`render.js` 的 13 个静态 import 解耦。
- 不碰 sim 确定性；保首屏加载顺序（bootstrap 缓存 import 扫描）。

## AC

- [ ] 面板/渲染器走注册表自注册，index.html 不再有 13 个自挂载 script（或收敛为入口+动态 import）
- [ ] 新增面板/渲染器只改自己的文件 + 注册，不碰 ui.js/render.js/index.html
- [ ] `npm test` 全绿；浏览器 smoke/flow 验收通过；首屏无明显变慢
- [ ] import-graph 不再有 in-degree=0 的自挂载入口

## DoD

- [ ] 落地于 `ui/registry.js`(新)、`render/registry.js`(新)、`ui.js`、`render.js`、`index.html` + 各 panel 模块，零第三方依赖
- [ ] 不碰 sim/确定性/存档
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/ui/registry.js` (new)
- `public/js/render/registry.js` (new)
- `public/js/ui.js`
- `public/js/render.js`
- `public/index.html`
- `public/js/achievements-ui.js`
- `public/js/bounties-ui.js`
- `public/js/cosmetics-ui.js`
- `public/js/daily-history-ui.js`
- `public/js/leaderboard-ui.js`
- `public/js/season-ui.js`
- `public/js/share-ui.js`
- `public/js/stats-ui.js`
- `public/js/relic-codex-ui.js`
- `public/js/replay-ui.js`
- `public/js/auth-ui.js`
- `tasks/refactor-ui-registry.md`

## Notes

立案 2026-11-06，路线图阶段 3。⚠️ 与阶段 2（css partition）都碰 index.html，串行（依赖阶段 2）。风险中（首屏加载顺序），不碰确定性。这是消除「依赖图盲区」的关键一步（耦合 agent 的 §4-C 判定）。