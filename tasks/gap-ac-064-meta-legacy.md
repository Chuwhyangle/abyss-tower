---
id: gap-ac-064-meta-legacy
title: 跨局传承：结算产出传承材料、与星核/成就/通行证/悬赏分层无重复（AC-064）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-phase-meta-design-freeze
goal_ac: AC-064
---
## Proposal

AC-064（跨局传承与星核/成就/通行证/悬赏分层清晰无重复）已激活，criterion `test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js` 当前 exit 1。本任务按 `docs/PHASE_META.md` 落跨局传承：每局结算按表现产出「传承材料」（legacy），用于天赋/强化，与星核（解锁为主）区分、不重复结算。前置依赖 `gap-phase-meta-design-freeze`（AC-062）。

<!-- dedup-ref --> 无任务以 `goal_ac: AC-064` 认领；AC-063（天赋树）与 AC-065（平衡）各自独立认领。

## Plan

1. `public/js/shared/data/meta.js` 加 legacy 材料定义与产出规则。
2. `server/services/run-settlement.mjs` 结算时按表现产出传承材料并累加到账号（与星核分账，不重复）。
3. 传承材料用于天赋/强化的消耗入口（UI + 服务端校验）。
4. i18n 中英成对；新增 `tests/meta-legacy.test.mjs`：产出规则、与星核分账、重复结算防护、快照/旧档兼容。

## AC

- [x] `test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js` exit 0（AC-064 本体判据）
- [x] `node --test tests/meta-legacy.test.mjs` exit 0
- [x] `npm test` exit 0

## DoD

- [x] 同一 seed 的结算里，传承材料按表现真实产出且与星核分账清晰、无重复结算（能对账）
- [x] 传承材料可用于天赋/强化，快照与旧档兼容；未启用 meta 的旧档照常结算

## Notes

设计增量（PHASE_META §5.3 契约落地）：
- `LEGACY_MATERIALS` 单材料 `legacy_core`（source=settlement, sink=talent_upgrade），`legacyYield` 为确定性纯函数（波次×1 + 击杀÷10 + 通关 +5，无 RNG）。
- 持久化走 `server/db/legacy.mjs`（`player_kv('meta','legacy')`），与星核 wallet（`player_wallets('cores')`）、成就/通行证/悬赏分离；`normalizeLegacy` 保证 bank 恒等于 materials 求和（机械可检）。
- 结算在 `run-settlement.mjs` 内按表现产出并累加，返回 `legacyEarned` / `totalLegacy`；`toSnapshot` 不写 legacy（账号级状态，不随单局存档）。
- 消耗入口本次落地服务端校验（`spendLegacyInTx`，余额不足拒绝）；DOM 消耗面板属 AC-063 天赋树，不在本任务 Touches。

## Touches

- `public/js/shared/data/meta.js`
- `server/db/legacy.mjs`
- `server/services/run-settlement.mjs`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/meta-legacy.test.mjs`
- `tasks/gap-ac-064-meta-legacy.md`
