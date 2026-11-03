---
id: fix-chrono-stasis-feedback
title: 时之终章：去掉释放 hitstop 错觉、上调时停时长、文案讲清时停期间我方照常输出
status: ready
labels:
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/sim-skills.test.mjs tests/skills.test.mjs
---
> **RETREATED / 搁置（误推进：promote 连跑 acceptance（现有绿测试）导致未实现即 done，退回 ready 待 worker 实现）**

## Proposal

「时之终章」时停的两个观感问题：① 释放瞬间的 hitstop 冻结帧（`public/js/render/camera-feedback.js` 的 `hitstopFor`，`source:'skill'` 的命中事件触发约 90ms 全局放慢）让玩家误以为「我方也被暂停」——实际模拟层塔在时停期间照常索敌开火并带过载（`tower-system.js` 的 `updateTowers` 无 stasis 判断）；② `stop` 时长偏短（L1 1.2s→L10 2.4s，`public/js/shared/data/skills.js` 的 chrono 段）。修复：① 释放时 `source:'skill'` 的命中事件不计入 hitstop；② 上调 `stop` 数值（具体值经 balance 模拟验证，保持随等级线性/插值）；③ i18n 文案明确「时停期间我方塔持续攻击并过载」（`zh-CN.ui.js`/`en-US.ui.js` 的 `skill.chrono.desc`/`summary`）。

## AC

- [ ] chrono 释放的 `source:'skill'` 命中事件不触发 hitstop 冻结帧
- [ ] `stop` 数值上调，写入 `public/js/shared/data/skills.js`，随等级线性/插值一致
- [ ] 卡面/帮助文案写明「时停期间我方塔持续攻击并过载」
- [ ] `node --test tests/sim-skills.test.mjs tests/skills.test.mjs` exit 0

## DoD

- [ ] 修复落地于 `public/js/render/camera-feedback.js`、`public/js/shared/data/skills.js`、`public/js/shared/i18n/zh-CN.ui.js`、`public/js/shared/i18n/en-US.ui.js`，不引入新依赖
- [ ] 新增/扩展回归测试：skill 来源命中不产生 hitstop；stop 数值上调
- [ ] `npm test` 全绿；补跑 `node --test tests/sim-skills.test.mjs tests/skills.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/render/camera-feedback.js`
- `public/js/shared/data/skills.js`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tests/sim-skills.test.mjs`
- `tasks/fix-chrono-stasis-feedback.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-6。深和宽：去错觉 + 调时长 + 文案三件事一起收口，避免只改数值留下「我方被暂停」的误解。
