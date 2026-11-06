---
id: feat-gacha-ui
title: 抽卡·阶段1 前端：全屏抽卡页 + 三态切屏 + 出货动画 + 概率公示/历史弹窗
status: done
labels:
  - feat
parent: null
children: []
extra: {}
depends_on:
  - feat-gacha-contract
---
## Proposal

全屏抽卡页，冻结表 `docs/PHASE_抽卡.md` §6。页面要精美、完善（用户明确要求「非常非常完善，该跳转的跳转，该展开的展开」）。

1. `index.html`：加第 3 个 `.screen` section `#gacha-screen`（含返回按钮、余额、碎片条、Banner 区、单抽/十连按钮、结果区）；标题页 `.row` 加 `btn-gacha`。
2. `ui.js`：`el` 注册 gacha 屏/按钮；`showGacha()/hideGacha()` 做**三态对称翻转**（`title/game/gacha` 三屏 `hidden` 互斥）；⚠️ `showTitle`/`showGame` 都要补 `gacha.hidden=true`；进抽卡页 `stopMenuBackground()`；`refreshLocale()` 加 gacha 分支。
3. 新增 `public/js/ui/gacha-ui.js`：页面渲染 + 单抽/十连交互 + 出货动画（3★普通过场/4★蓝光/5★紫光延迟/6★金光全屏闪；十连逐张翻开 4★+ 高亮）+ 「概率公示」弹窗 + 「抽卡历史」弹窗（复用 `#modal-root`）。动画计时器纳入切屏清理（防孤儿定时器）。
4. CSS：抽卡页及组件样式（复用 token + `.btn`/`.modal`）。`refactor-css-partition` 已把 `styles.css` 拆为 `public/css/*`，本任务样式落在新分区 `public/css/gacha.css`（a11y 之前加载，reduced-motion 仍由 a11y 兜底）。
5. i18n：`zh-CN.ui.js`/`en-US.ui.js` 加抽卡文案。

## AC

- [x] `btn-gacha` 从标题页进抽卡页，返回按钮回标题页；`title/game/gacha` 三屏不叠显（showTitle/showGame 也翻 gacha）
- [x] 单抽/十连调 `/api/gacha/draw`，结果区展示塔卡 + 稀有度边框/光效；余额/碎片条刷新
- [x] 出货动画分档（4★/5★/6★ 有区分度），十连逐张翻开；切屏后无孤儿定时器/动画
- [x] 「概率公示」「抽卡历史」弹窗可开可关，概率与 `/api/gacha/pool` 一致
- [x] 进抽卡页停止菜单背景动画，切语言抽卡文案刷新
- [x] 浏览器验收（smoke/flow 或新增 gacha 页验收）通过

## DoD

- [x] 落地于 `index.html`、`ui.js`、`gacha-ui.js`(新)、`public/css/gacha.css`(新)、`zh-CN.ui.js`、`en-US.ui.js`，零第三方依赖
- [x] 复用设计 token 与 `.btn`/`.modal`/`.screen` 模式，不新增全局魔法值
- [x] 抽卡页触控/移动端不溢出（参照现有 mobile 验收口径）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/index.html`
- `public/js/ui.js`
- `public/js/ui/gacha-ui.js` (new)
- `public/css/gacha.css` (new)
- `tests/lib/css-source.mjs`
- `scripts/ui-animation-audit.mjs`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `public/js/shared/i18n/zh-CN.ui.gacha.js` (new)
- `public/js/shared/i18n/en-US.ui.gacha.js` (new)
- `tests/browser-gacha.mjs` (new)
- `tasks/feat-gacha-ui.md`

## Notes

立案 2026-11-06。依赖 `feat-gacha-contract`（数据层，需 `towers-rarity.js`/`gacha.js`）。实现 agent 论证的 UI 风险点：三态翻转不对称会叠屏、菜单背景 rAF 泄漏、refreshLocale 漏 gacha 分支、出货动画孤儿计时器——本任务 AC 已逐条覆盖。美术资源由 `feat-gacha-art` 提供，本任务消费 `public/assets/gacha/` 下资源（缺资源时回退到程序化塔绘制，不崩）。

实现说明（2026-11-06）：

- 抽卡文案按既有片段化模式拆成 `zh-CN.ui.gacha.js` / `en-US.ui.gacha.js` 两个新词典文件，由两个聚合器 `...gacha` 展开；因此 Touches 增列这两个新文件。
- 服务端 gacha 路由由 `feat-gacha-server` 落地；本任务的浏览器验收 `tests/browser-gacha.mjs` 用注入脚本按冻结契约模拟 `/api/gacha/*`（其余请求透传真实测试服务端），聚焦前端行为：三态互斥、余额/碎片/保底刷新、单抽与十连、分档动画、公示/历史弹窗、切屏计时器清理、切语言刷新。
- 三态翻转在 UI 层直接完成（抽卡是纯大厅功能，不绕 controller）；`showTitle`/`showGame` 都调用 `stopGacha()` 并隐藏 gacha 屏，动画计时器统一登记在 `GachaPage.timers`，切屏时 `clearTimers()`；6★ 全屏闪为纯 CSS 动画，不挂清理计时器。
- 抽卡 API 走 `public/js/api.js` 的通用 `request()`，不改 `api.js` 文件本身（不在 Touches）。
- 合并 develop 时 `refactor-css-partition` 已落地：`public/styles.css` 删除，抽卡样式迁到 `public/css/gacha.css`，并在 `index.html` 按级联顺序（hex 之后、a11y 之前）加 link；同步把新分区登记进 `tests/lib/css-source.mjs` 的 `CSS_PARTS` 与 `scripts/ui-animation-audit.mjs` 的 `CSS_CASCADE_ORDER`，否则分区数量/顺序与动效审计会红。

验收记录（2026-11-06，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/browser-gacha.mjs` 通过；合并 develop 后复跑仍通过）：

- 三态互斥：进抽卡页后 `title/game` 均 hidden、`gacha` 可见；返回后 `gacha` hidden、标题页可见；进抽卡页时 `_menuBackground.running === false`。
- 页面读数：余额 300、碎片 5、保底剩余 48 抽、单抽 15 / 十连 150 星核、卡池 5 塔。
- 概率公示 4 档（5%/12%/28%/55%）与 `/api/gacha/pool` 的 rates 一致；历史 3 行、snake_case 行归一化后显示塔名。
- 单抽：请求体 `{count:1, request_id}`，结果卡 data-star=5/data-rarity=epic，余额刷新为 285。
- 十连：请求体 `{count:10, request_id}`，10 张卡逐张翻开（pending 清零），6★/5★/4★ 分档、6★ 触发全屏金光、网格布局，余额刷新为 135。
- 动画中途返回标题页：`_gachaPage.timers` 清零、busy 复位；移动端 390×844 无横向溢出（`scrollWidth <= innerWidth`）。
- 语言切换：en-US 下抽卡页动态区零 CJK（卡池塔名/保底/空态文案全部刷新），切回 zh-CN 恢复。
- 同时通过：`tests/i18n-coverage.test.mjs`、`tests/ui-styles.test.mjs`（含分区 link 顺序）、`scripts/ui-animation-audit.mjs`、`scripts/style-check.mjs`、`scripts/structure-budget.mjs --check`、`scripts/import-graph.mjs`、`scripts/check-doc-ownership.mjs`。

suite 修复（2026-11-06 复跑，上一轮 exited-not-landed 的真因）：

- 失败用例：`tests/ui-split.test.mjs` →「门面低于 300 行，子模块低于 400 行」，`ui.js` 因抽卡接线增至 329 行（develop 基线 293）。
- 修法：把抽卡屏 16 个 DOM 引用、7 个事件接线与三态辅助（`initGacha`/`leaveGacha`/`refreshGachaLocale`）收进 `gachaMethods`（`public/js/ui/gacha-ui.js`，已在 Touches），`ui.js` 的 `init()` 只调用一次 `initGacha()`；`showTitle`/`showGame` 改用 `leaveGacha()`，`refreshLocale()` 改用 `refreshGachaLocale()` 短路。
- 结果：`ui.js` 299 行（<300），`gacha-ui.js` 598 行（<600 运行时预算），行为不变；`npm test` 2126/2126 全绿；anti-drift Touches 检查通过（11 个实际文件全部在声明内）。

## Blocker

**2026-11-06T02:12:56.546Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: name: 'AssertionError'
- run_id：wk-prod-anchor
- session_id：4eb5875e-541c-4b3a-8e0a-55c923c04c0f
