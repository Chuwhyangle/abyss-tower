---
id: gap-boss-cores
title: 首领核心：第 5/10/15/20/25 波清波后的五类核心选择
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/rogue2-accept.mjs cores
depends_on:
  - DOCS-002
  - gap-factions-points
goal_ac: AC-035
---
## Proposal

设计稿的首领核心替换「每 5 波额外事件弹窗」：第 5/10/15/20/25 波清波后各发 1 个核心，三选一且不可刷新。选项五类：定向升阶（任选 1 件未满级遗物 +1 级，始终可选）、搜寻（指定派系从 3 件中选 1）、觉醒（Ⅲ 级遗物行为词条，第 10 波起）、教义（第 10 波起，每局上限 2）、补给（仅第 5 波兜底：+2 最大生命 / +80 金币 / +1 刷新）。当前服务端只认识 `kind: 'relic' | 'gold' | 'repair'`，没有核心槽位，也没有不新增弹窗层级的复用路径。本任务只做核心选择本身；觉醒与教义的行为由各自任务落地，本任务提供入口与能力检查。

## Plan

1. 新增 `public/js/shared/cores.js`：`CORE_WAVES = [5,10,15,20,25]`、五类规格、`rollCoreOffers(seedKey, wave, states, capabilities)`、`applyCore(offer, state)`；纯函数、确定性、无 DOM。
2. `server/services/run-service.mjs`：首领波清波时在既有 `offers` 里写 `kind: 'core'` 槽位（key 复用波次），三选一不可刷新；服务端只验证「首领波已清」，不能验证是否真的击杀首领，按「清波即发放」处理。
3. `public/js/sim/relic-system.js` + `public/js/app/combat.js`：应用升阶 / 搜寻 / 补给；觉醒与教义在对应能力未落地时不出现在候选中（能力检查，不是隐藏错误）。
4. 复用既有三选一弹窗：`public/js/ui/modals.js` 顶部增加核心条，不新增弹窗层级；选择幂等，刷新对核心槽位无效。
5. 快照：核心选择、上限计数与已选教义列表进入快照；旧档无核心字段时跳过。
6. 新增 `tests/boss-cores.test.mjs`：五个波次、五类选项门槛、不可刷新、幂等、上限、快照往返、服务端「清波即发放」。

## AC

- [ ] `node --test tests/boss-cores.test.mjs` exit 0
- [ ] `node --test tests/reliquary.test.mjs tests/run-lifecycle.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 真实跑一局到第 5/10/15/20/25 波清波：每次都出现核心三选一，且不新增独立弹窗层级
- [ ] 定向升阶能对任意未满级遗物 +1 级；搜寻只出指定派系；补给只在第 5 波兜底
- [ ] 第 10 波前不出现觉醒/教义；教义每局最多 2 次；核心不可刷新
- [ ] 快照恢复后不重复发核心、不重置已选教义上限

## Touches

- `server/services/run-service.mjs`
- `public/js/shared/cores.js` (new)
- `public/js/sim/relic-system.js`
- `public/js/app/combat.js`
- `public/js/ui/modals.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/boss-cores.test.mjs` (new)
- `tasks/gap-boss-cores.md`

## Notes

<!-- dedup-ref -->
与 `gap-doctrines` / `gap-awakenings-p0` 的边界：本任务只提供核心入口与能力检查，教义/觉醒的具体行为由各自任务实现；本任务不得为了凑候选而先写空壳行为。与 `gap-contracts` 的边界：契约卡只替换普通三选一，不进入核心槽位。核心选项与每日/本周的固定规则共用同一 seed 派生，保证同组一致。
