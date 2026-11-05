---
id: refactor-i18n-domain-split
title: 并发重构·阶段1：拆 i18n ui 域词典（feature 片段 + 聚合器）
status: todo
labels:
  - refactor
parent: null
children: []
extra: {}
---
## Proposal

并发友好重构·阶段 1：拆 i18n `ui` 域词典（当前 3 路 Touches 冲突，纯数据搬运最低风险）。

- `public/js/shared/i18n/en-US.ui.js`(1332 行) 与 `zh-CN.ui.js`(1332 行) 拆成 `en-US.ui.<feature>.js` / `zh-CN.ui.<feature>.js` 片段 + 一个 `ui` 域聚合器（复用现有 `en-US.js` → `en-US.{enemies,relics,meta,ui}.js` 的 spread 聚合范式，再往下一层）。
- 每个 feature 的 en + zh 两个片段同一 owner 同时提交，保证 `tests/i18n-coverage.test.mjs` 键集合奇偶一致。
- 纯数据搬运，不碰 RNG/逻辑。

## AC

- [ ] `ui` 域词典拆成 feature 片段 + 聚合器，键集合不变（`tests/i18n-coverage.test.mjs` 绿）
- [ ] en/zh 键奇偶一致保持
- [ ] 现有 import 路径兼容（或一次性改全）
- [ ] `npm test` 全绿

## DoD

- [ ] 落地于 `shared/i18n/*`(拆分)，零第三方依赖
- [ ] 纯数据搬运，不改文案、不改逻辑
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/i18n/en-US.ui.js`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/` (新片段文件)
- `tests/i18n-coverage.test.mjs`
- `tasks/refactor-i18n-domain-split.md`

## Notes

立案 2026-11-06，路线图阶段 1。参照 `en-US.js` 的 spread 聚合范式照抄。与 `feat-gacha-ui`/`feat-mobile-guard`/`feat-skill-expansion` 都碰 i18n ui 词典，Touches 会冲突——本任务落地后这些任务不再碰聚合点。