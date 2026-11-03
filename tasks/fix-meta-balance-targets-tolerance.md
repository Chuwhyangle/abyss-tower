---
id: fix-meta-balance-targets-tolerance
title: meta 平衡目标测试落地 ±5pp 容忍：深渊 13.3%（矿脉先验漂移）不再硬断言失败
status: ready
labels:
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/meta-balance-targets.test.mjs
---
## Proposal

`feat-one-tower-balance`（needs-human）的 AC4 失败：`tests/meta-balance-targets.test.mjs` 对深渊硬断言 `status==='达标'`（目标 5–12%），而 `npm run balance:write` 重生成的 `docs/BALANCE_META.json` 记深渊 13.3%，高于目标上限。该 13.3% 是**先验漂移**——`feat-resource-vein-placement`（done）落图后矿脉掉金抬升经济（其 Notes 已记深渊 9%→13%、+1pp），且 `docs/BALANCE.md` 已约定「偏差 5pp 以内不做额外调参」；独塔改动对三档聚合几乎无影响（机器人口径独塔≈弩塔=0%）。修复：让 meta 平衡目标测试**落地 ±5pp 容忍**（与 BALANCE.md 约定一致）——达标判定改为「落在目标区间或偏离 ≤5pp」，深渊 13.3% 相对 12% 上限 +1.3pp 落入容忍；不回调矿脉金值、不改 BALANCE_TARGETS（矿脉漂移已按 5pp 容忍在 vein 任务接受过）。

## AC

- [ ] `tests/meta-balance-targets.test.mjs` 的达标判定落地 ±5pp 容忍（偏离 ≤5pp 仍判达标）
- [ ] 深渊 13.3%（+1.3pp）在容忍内通过，不硬断言失败
- [ ] 不改 `config.js` 的 BALANCE_TARGETS、不改矿脉金值
- [ ] `node --test tests/meta-balance-targets.test.mjs` exit 0

## DoD

- [ ] 落地于 `tests/meta-balance-targets.test.mjs`，不引入第三方依赖
- [ ] 回归测试覆盖容忍边界（正好 ±5pp 内/外）
- [ ] `npm test` 全绿
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `tests/meta-balance-targets.test.mjs`
- `tasks/fix-meta-balance-targets-tolerance.md`

## Notes

立案 2026-11-03，源自 `feat-one-tower-balance` needs-human 的 AC4 决策。manager 裁定：接受矿脉先验漂移，落地 BALANCE.md 已约定的 5pp 容忍，不回调经济。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为测试容忍口径落地，无新文档面，L_D/L_G/L_S 无需量化。
