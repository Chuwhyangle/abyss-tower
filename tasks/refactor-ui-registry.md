---
id: refactor-ui-registry
title: 并发重构·阶段3：UI/render 面板注册表，统一双 UI 装配
status: done
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

- [x] 面板/渲染器走注册表自注册，index.html 不再有 13 个自挂载 script（或收敛为入口+动态 import）
- [x] 新增面板/渲染器只改自己的文件 + 注册，不碰 ui.js/render.js/index.html
- [x] `npm test` 全绿；浏览器 smoke/flow 验收通过；首屏无明显变慢
- [x] import-graph 不再有 in-degree=0 的自挂载入口

## DoD

- [x] 落地于 `ui/registry.js`(新)、`render/registry.js`(新)、`ui.js`、`render.js`、`index.html` + 各 panel 模块，零第三方依赖
- [x] 不碰 sim/确定性/存档
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/ui/registry.js` (new)
- `public/js/render/registry.js` (new)
- `public/js/ui/bootstrap.js` (new)
- `public/js/render/renderers.js` (new)
- `public/js/ui.js`
- `public/js/render.js`
- `public/index.html`
- `public/js/render/glow-renderer.js`
- `public/js/render/background-renderer.js`
- `public/js/render/portal-renderer.js`
- `public/js/render/tower-renderer.js`
- `public/js/render/enemy-renderer.js`
- `public/js/render/ally-renderer.js`
- `public/js/render/projectile-renderer.js`
- `public/js/render/destructible-renderer.js`
- `public/js/render/effect-renderer.js`
- `public/js/render/floater-renderer.js`
- `public/js/render/overlay-renderer.js`
- `public/js/render/skill-renderer.js`
- `public/js/render/culmination-renderer.js`
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
- `public/js/ui/notifications.js`
- `public/js/ui/season-pass.js`
- `public/js/ui/meta-tree.js`
- `public/js/auth-ui.js`
- `scripts/test-changed.mjs`
- `tests/ui-registry.test.mjs`
- `tests/bounties.test.mjs`
- `tests/notifications.test.mjs`
- `tests/relic-codex.test.mjs`
- `tests/replays.test.mjs`
- `tests/season-pass.test.mjs`
- `tests/season-ui.test.mjs`
- `tests/share-ui.test.mjs`
- `tests/leaderboard.test.mjs`
- `tests/destructibles-ui.test.mjs`
- `tests/feel-culmination.test.mjs`
- `tests/browser-smoke.mjs`
- `tests/browser-flow.mjs`
- `tasks/refactor-ui-registry.md`

## Notes

立案 2026-11-06，路线图阶段 3。⚠️ 与阶段 2（css partition）都碰 index.html，串行（依赖阶段 2）。风险中（首屏加载顺序），不碰确定性。这是消除「依赖图盲区」的关键一步（耦合 agent 的 §4-C 判定）。

### 实现（2026-11-06）

- 新增 `public/js/ui/registry.js`：`registerPanel(id, mount)` / `panelIds()` / `resetPanels()` / `mountPanels(context, order)`。挂载只执行一次；DOM 未就绪时挂到 `DOMContentLoaded`；单面板抛错只记 `console.error('[ui] panel mount failed', id, err)`，不影响后续面板。
- 新增 `public/js/ui/bootstrap.js`：13 个大厅面板的唯一清单（id → 动态 `import()`），并行装载后按旧 index.html 顺序 `mountPanels({ ui }, ids)`。`ui` 实例经 mount 参数注入，面板不再 `import { ui } from './ui.js'`，消除「门面 ↔ 面板」静态环（ui.js 维持 299 行，满足 ui-split <300 行约束）。
- 新增 `public/js/render/registry.js` + `public/js/render/renderers.js`：`registerRenderer(id, Class)` / `createRenderer(id, ...args)`；清单按层序 import 13 个渲染器，`render.js` 只保留注册表与清单 import，构造时按 id 创建实例；未知 id 立即抛错。
- `public/index.html` 删除 13 个面板 `<script type="module">`，只留 `/js/main.js` 单一入口。
- 13 个面板模块尾部改为 `registerPanel('<id>', install)`；其中 achievements/bounties/season/stats/relic-codex/meta-tree 原 `import { ui }`，改为 mount context 注入；13 个渲染器模块尾部自注册。
- AC2 机制：新增面板/渲染器只需在自身模块调用 `registerPanel`/`registerRenderer`，再在 `ui/bootstrap.js` 或 `render/renderers.js` 清单加一行——不碰 `ui.js` / `render.js` / `index.html`。

### 验收证据

- `npm test` → exit 0，2133/2133 pass，0 fail（含新增 `tests/ui-registry.test.mjs` 7 例：单一入口、清单/注册一一对应、注册表行为、DOMContentLoaded 延迟、import-graph 入边）。
- `node --no-warnings scripts/import-graph.mjs` → OK（362 文件 / 885 依赖，无越层无环）；AC4 入边断言：13 面板 + 13 渲染器 + bootstrap 的 in-degree 均 ≥1。
- `node scripts/style-check.mjs` 通过（398 文件）；`structure-budget` OK（657 文件，无环）；`docs-consistency` 通过（29 文件）；`check-doc-ownership` OK（0 open 任务声明总文档）；`check:syntax` exit 0；`sim:determinism` OK（3 seed 的 events/rng/state 哈希与基线一致，未碰 sim）。
- 浏览器验收（`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）：`node tests/browser-smoke.mjs` exit 0；`node tests/browser-flow.mjs` exit 0（含续玩、三选一、排行榜面板打开/关闭、商店）。
- 首屏测量（同一 host，`Page.reload` 3 次到 `dataset.boot === 'ok'`）：重构 539/544/522ms（中位 539），develop 基线（纯净 worktree `3792e8fd`）445/517/636ms（中位 517），两侧模块请求数均 231；差异在抖动范围内，无可见变慢。
- `check:version` 报 CHANGELOG v1.34 与 CONTENT_VERSION v1.35 不一致；develop 上同样存在（本任务未改版本/CHANGELOG），属既有红。

### 验收夹具修复（非本重构引入，develop 基线可复现）

- `tests/browser-smoke.mjs` / `tests/browser-flow.mjs` 的技能数量硬编码 3，已随 develop `4e20673a`（技能扩到 6）过期 → 改为 `SKILL_ORDER.length`。
- `tests/browser-flow.mjs` 预建塔选格未跳过 `sim.destructibleAt`，MAP-005 起可破坏物占可建造格，导致 `canBuild=false` → 选格加该条件。
- `tests/browser-flow.mjs` 遗物断言假设开局 0 遗物，当前账号自带初始遗物 `bloodstake` → 恢复断言改为与刷新前一致、拾取后断言 `preWave.relics + 1`。
- 归因证据：在纯净 develop worktree（`3792e8fd`）跑同一流程，分别复现「技能条等待超时」与 `relics=1` 恢复不一致，证明与本重构无关。
