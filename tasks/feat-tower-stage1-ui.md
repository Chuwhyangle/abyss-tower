---
id: feat-tower-stage1-ui
title: 爬塔·阶段1UI：节点地图选择弹窗 + 商人弹窗（复用现有弹窗骨架）
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/ui-modules.test.mjs tests/ui-split.test.mjs
---
## Proposal

爬塔阶段 0（done）已落地共享契约。本任务落地**阶段 1 UI 表现**（`docs/PHASE_TOWER.md` §6.1 Agent D 的落点）：① `public/js/ui.js`（或新模块）新增 `showNodeMap`（节点地图选择弹窗——只露节点类型+词缀，隐藏具体内容，符合 §4 反无脑选收益三闸之一）与 `showMerchant`（商人弹窗：买遗物/升级/治疗/maxHp/刷新/卖遗物）；② 复用现有 `showDraft`/`showEventModal` 骨架（`public/js/ui/modals.js`），不新开弹窗系统；③ 节点图走 DOM 弹窗（可选 Canvas 层），默认 DOM 以零渲染层改动。**不超 render-budget**；i18n 键按 zh/en 对称补。

## AC

- [x] `showNodeMap` 节点地图选择弹窗：展示节点类型+词缀，隐藏具体内容，点节点触发选路
- [x] `showMerchant` 商人弹窗：商品列表 + 购买/刷新/卖遗物
- [x] 复用现有弹窗骨架，render-budget 不红，i18n zh/en 对称
- [x] `node --test tests/ui-modules.test.mjs tests/ui-split.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/ui.js`、`public/index.html`、`public/styles.css`、i18n，不引入第三方依赖
- [x] 回归测试覆盖节点地图/商人弹窗渲染 + i18n 键
- [x] `npm test` 全绿；补跑 `node --test tests/ui-modules.test.mjs tests/ui-split.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/ui.js`
- `public/js/ui/tower.js` (new)
- `public/styles.css`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tests/ui-modules.test.mjs`
- `tests/ui-split.test.mjs`
- `tasks/feat-tower-stage1-ui.md`

## Notes

立案 2026-11-03，源自 `docs/PHASE_TOWER.md` §6.1 阶段 1（Agent D）。与阶段1客户端任务并行，API 形状以客户端 `nodes.js`/`combat.js` 的方法签名为准（PHASE 冻结表已定对外符号）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为爬塔 UI 表现，契约已冻结，无新文档面，L_D/L/G/L_S 无需量化。

worker 实测 Touches 已修正：新增 `public/js/ui/tower.js`（符合 Proposal「或新模块」，`showNodeMap`/`showMerchant` + 纯函数 `towerNodeView`/`towerNodeState`/`merchantOfferView`/`merchantSellView`）；`tests/ui-split.test.mjs` 登记新模块/门面方法/纯函数导出面。`public/index.html` 无需改动（弹窗走 openModal 动态生成，与既有 showDraft/showEventModal 一致），故从 Touches 移除。接口以共享契约 `public/js/shared/tower.js` 的 `generateTowerGraph`/`successors`/`merchantInventory` 对外符号为准。全量 `npm test` 1945 例全绿；`node --test tests/ui-modules.test.mjs tests/ui-split.test.mjs` 27 例全绿。