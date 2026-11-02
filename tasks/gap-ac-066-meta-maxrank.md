---
id: gap-ac-066-meta-maxrank
title: 数值克制：meta.js 落 maxRank 上限字段，天赋/强化有界（AC-066）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-066
---
## Proposal

GOAL-012 退出条件 2 的「数值克制（可感知但不碾压）」此前无在域 AC——AC-063 只验了天赋树「一致生效」（`grep 'talent'`），没验「克制」。人已裁定：加 AC-066，criterion `test -s public/js/shared/data/meta.js && grep -q 'maxRank' public/js/shared/data/meta.js`，要求 meta.js 落一个 `maxRank` 上限字段。

本任务实现克制机制：给天赋/永久强化一个 rank 上限（`maxRank`），使加成有界、可感知但不碾压。当前 meta.js 有 LEGACY_MATERIALS / talent 相关纯函数，但无 `maxRank`。

<!-- dedup-ref --> 承接 `gap-goal-012-meta-restraint-ac`（needs-human）提案；AC-063（天赋一致生效）与 AC-064（传承分账）已各自认领，本任务只落「上限/克制」这一件事。

## Plan

1. `public/js/shared/data/meta.js` 加 `maxRank`（天赋 rank 上限，常量或表），并让 talent 投入/消耗路径在达到 maxRank 后拒绝再升。
2. sim 折叠 talentMods 时按 rank 封顶，超过 maxRank 的部分不生效（有界）。
3. 新增/扩展 `tests/meta-tree.test.mjs`：断言 maxRank 存在、rank 封顶生效、超限不越界写进 mods。
4. i18n 中英成对（若有新文案）。

## AC

- [ ] `test -s public/js/shared/data/meta.js && grep -q 'maxRank' public/js/shared/data/meta.js` exit 0（AC-066 本体判据）
- [ ] `node --test tests/meta-tree.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 天赋投入达到 maxRank 后无法再升，sim 折叠的 talentMods 有界、不越界写进 mods；0 投入时与改动前逐字节一致
- [ ] 上限值写入 `docs/PHASE_META.md` 冻结表（若该表已有 rank 口径则对齐）

## Touches

- `public/js/shared/data/meta.js`
- `tests/meta-tree.test.mjs`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tasks/gap-ac-066-meta-maxrank.md`
