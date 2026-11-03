---
id: fix-relic-draft-confirm
title: 遗物三选一加「确定」按钮并修掉空 offers 软锁，必须显式确定才能推进
status: ready
labels:
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/relics-turnbased.test.mjs tests/run-lifecycle.test.mjs
---
> **RETREATED / 搁置（误推进：promote 连跑 acceptance（现有绿测试）导致未实现即 done，退回 ready 待 worker 实现）**

## Proposal

清波后的遗物三选一现在是「点卡片=确认」，没有独立「确定」按钮，用户要求必须显式点「确定」才能推进。且 `public/js/app/run.js` 的 `restorePendingDraft()`（约 479-509 行）对「`offers` 为空」分支没处理，会渲染 `closable:false`、无卡片的空弹窗形成软锁。修复：① `public/js/ui/modals.js` 的 `showDraft` 加「确定」按钮——点卡高亮选中、点「确定」才 `pickOffer`（`public/js/app/combat.js:148-195`）并关弹窗，未选时确定禁用；② `restorePendingDraft` 与 `handleWaveClear`（`combat.js:122-136`）对齐，`offers` 空/已选都清 `pendingDraft` + 解暂停 + toast，绝不渲染空弹窗。

## AC

- [x] 三选一弹窗出现「确定」按钮，未选卡时禁用；选中卡片后点「确定」才应用并关弹窗
- [x] 未点确定时不推进（`pendingDraft` 保持、`nextWave` 不被调用）
- [x] `restorePendingDraft` 对 `offers` 空/`picked` 分支清 `pendingDraft` + 解暂停 + toast，不渲染空弹窗
- [x] `node --test tests/relics-turnbased.test.mjs tests/run-lifecycle.test.mjs` exit 0

## DoD

- [x] 修复落地于 `public/js/ui/draft.js`、`public/js/ui/modals.js`、`public/js/ui.js`、`public/js/app/run.js`、`public/styles.css`，不引入新依赖
- [x] 新增/扩展回归测试覆盖「确定按钮」与「空 offers 不软锁」
- [x] `npm test` 全绿；补跑 `node --test tests/relics-turnbased.test.mjs tests/run-lifecycle.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/app/run.js`
- `public/js/ui/draft.js`
- `public/js/ui/modals.js`
- `public/js/ui.js`
- `public/styles.css`
- `tests/a11y-color.test.mjs`
- `tests/browser-flow.mjs`
- `tests/browser-relics.mjs`
- `tests/relics-turnbased.test.mjs`
- `tests/ui-modules.test.mjs`
- `tests/ui-split.test.mjs`
- `tasks/fix-relic-draft-confirm.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-4。深和宽：除加确定按钮外，把续玩恢复路径的空 offers 软锁一并收口。

实现（worker，2026-11-03）：
- `showDraft` 因 `public/js/ui/modals.js` 超 400 行上限（ui-split 结构预算）抽到新模块 `public/js/ui/draft.js`；点卡仅高亮选中并启用「确定」，只有点「确定」才 `pickOffer`。
- `public/js/app/combat.js` 未改：`handleWaveClear` 已对空 offers 清待选+解暂停+toast，`restorePendingDraft` 补同一分支对齐即可。
- 回归：`tests/relics-turnbased.test.mjs` 新增两条源码级断言；`tests/ui-split/ui-modules/a11y-color` 同步 draft.js 模块化；`tests/browser-relics/browser-flow` 补「确定」点击流程。
- 实测 `npm test` 1882/1882 绿；acceptance（relics-turnbased + run-lifecycle）14/14 绿。
- 已知（非本任务引入）：`tests/browser-relics.mjs`、`tests/browser-flow.mjs` 在信物三选一（AC-056）落地后，starter 遗物使 `relics.length` 为 1、首个 `.relic-chip` 非所选遗物，两测试仍在其预存断言处失败；本任务只改这两处测试的「确定」流程，未动预存断言。

该轴仍暗,理由:本任务为 scoped 缺陷修复，不引入新结构、不改文档面，L_D/L_G/L_S 无需量化。