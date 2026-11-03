---
id: fix-relic-draft-confirm
title: 遗物三选一加「确定」按钮并修掉空 offers 软锁，必须显式确定才能推进
status: todo
labels:
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/relics-turnbased.test.mjs tests/run-lifecycle.test.mjs
---
## Proposal

清波后的遗物三选一现在是「点卡片=确认」，没有独立「确定」按钮，用户要求必须显式点「确定」才能推进。且 `public/js/app/run.js` 的 `restorePendingDraft()`（约 479-509 行）对「`offers` 为空」分支没处理，会渲染 `closable:false`、无卡片的空弹窗形成软锁。修复：① `public/js/ui/modals.js` 的 `showDraft` 加「确定」按钮——点卡高亮选中、点「确定」才 `pickOffer`（`public/js/app/combat.js:148-195`）并关弹窗，未选时确定禁用；② `restorePendingDraft` 与 `handleWaveClear`（`combat.js:122-136`）对齐，`offers` 空/已选都清 `pendingDraft` + 解暂停 + toast，绝不渲染空弹窗。

## AC

- [ ] 三选一弹窗出现「确定」按钮，未选卡时禁用；选中卡片后点「确定」才应用并关弹窗
- [ ] 未点确定时不推进（`pendingDraft` 保持、`nextWave` 不被调用）
- [ ] `restorePendingDraft` 对 `offers` 空/`picked` 分支清 `pendingDraft` + 解暂停 + toast，不渲染空弹窗
- [ ] `node --test tests/relics-turnbased.test.mjs tests/run-lifecycle.test.mjs` exit 0

## DoD

- [ ] 修复落地于 `public/js/app/combat.js`、`public/js/ui/modals.js`、`public/js/app/run.js`，不引入新依赖
- [ ] 新增/扩展回归测试覆盖「确定按钮」与「空 offers 不软锁」
- [ ] `npm test` 全绿；补跑 `node --test tests/relics-turnbased.test.mjs tests/run-lifecycle.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/app/combat.js`
- `public/js/ui/modals.js`
- `public/js/app/run.js`
- `tests/relics-turnbased.test.mjs`
- `tasks/fix-relic-draft-confirm.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-4。深和宽：除加确定按钮外，把续玩恢复路径的空 offers 软锁一并收口。
