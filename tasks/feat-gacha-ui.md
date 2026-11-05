---
id: feat-gacha-ui
title: 抽卡·阶段1 前端：全屏抽卡页 + 三态切屏 + 出货动画 + 概率公示/历史弹窗
status: todo
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
4. `styles.css`：`.gacha-screen` 及组件样式（复用 token + `.btn`/`.modal`）。
5. i18n：`zh-CN.ui.js`/`en-US.ui.js` 加抽卡文案。

## AC

- [ ] `btn-gacha` 从标题页进抽卡页，返回按钮回标题页；`title/game/gacha` 三屏不叠显（showTitle/showGame 也翻 gacha）
- [ ] 单抽/十连调 `/api/gacha/draw`，结果区展示塔卡 + 稀有度边框/光效；余额/碎片条刷新
- [ ] 出货动画分档（4★/5★/6★ 有区分度），十连逐张翻开；切屏后无孤儿定时器/动画
- [ ] 「概率公示」「抽卡历史」弹窗可开可关，概率与 `/api/gacha/pool` 一致
- [ ] 进抽卡页停止菜单背景动画，切语言抽卡文案刷新
- [ ] 浏览器验收（smoke/flow 或新增 gacha 页验收）通过

## DoD

- [ ] 落地于 `index.html`、`ui.js`、`gacha-ui.js`(新)、`styles.css`、`zh-CN.ui.js`、`en-US.ui.js`，零第三方依赖
- [ ] 复用设计 token 与 `.btn`/`.modal`/`.screen` 模式，不新增全局魔法值
- [ ] 抽卡页触控/移动端不溢出（参照现有 mobile 验收口径）
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/index.html`
- `public/js/ui.js`
- `public/js/ui/gacha-ui.js` (new)
- `public/styles.css`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tasks/feat-gacha-ui.md`

## Notes

立案 2026-11-06。依赖 `feat-gacha-contract`（数据层，需 `towers-rarity.js`/`gacha.js`）。实现 agent 论证的 UI 风险点：三态翻转不对称会叠屏、菜单背景 rAF 泄漏、refreshLocale 漏 gacha 分支、出货动画孤儿计时器——本任务 AC 已逐条覆盖。美术资源由 `feat-gacha-art` 提供，本任务消费 `public/assets/gacha/` 下资源（缺资源时回退到程序化塔绘制，不崩）。