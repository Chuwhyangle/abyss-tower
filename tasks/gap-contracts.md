---
id: gap-contracts
title: 契约卡：第 9/14/19/24 波替换一张遗物卡，每局最多两次
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/contracts.test.mjs
depends_on:
  - DOCS-002
  - gap-factions-points
goal_ac: AC-036
---
## Proposal

设计稿的契约卡替换「每 5 波额外事件弹窗」：第 9/14/19/24 波，用 1 张契约卡替换三选一里的 1 张遗物卡；同一弹窗、仍是 3 张；每局最多接受 2 次；契约可被刷新掉；负面效果以 chip 常驻并标注「本波/本局」。红线是只改客户端可模拟的资源，绝不改敌人 HP/速度/入口（服务端波次生成是红线）。当前三选一只有 relic/gold/repair，没有契约卡。本任务只做契约卡，不碰核心与教义。

## Plan

1. 新增 `public/js/shared/contracts.js`：五条契约（血契 / 债契 / 贫契 / 惰契 / 焚契）的代价与收益规格、`rollContractOffer(seedKey, wave, states)`、`applyContract(contract, state)`；纯函数、确定性、无 DOM、不改敌人字段。
2. `server/services/run-service.mjs`：在指定波次把 1 张遗物卡替换为契约卡，写入既有 offers 槽位；刷新时契约卡随整组丢弃；每局接受次数与已接受契约持久化。
3. `public/js/sim/relic-system.js` + `public/js/app/combat.js`：应用代价与收益（最大生命、当前金币、刷新次数、下一波卡数、塔攻速、派系点数、焚毁遗物），全部走客户端可模拟资源。
4. UI：`public/js/ui/modals.js` 契约卡样式与「本波/本局」标注；`public/js/ui/hud.js` 常驻 chip；选择后不可撤销。
5. 快照与旧档：契约列表、接受次数、剩余负面效果进入快照；旧档无契约字段时跳过。
6. 新增 `tests/contracts.test.mjs`：四条波次、替换规则、刷新丢弃、每局上限 2、五条代价/收益、绝不改敌人 HP/速度/入口、快照往返。

## AC

- [ ] `node --test tests/contracts.test.mjs` exit 0
- [ ] `node --test tests/relics.test.mjs tests/run-lifecycle.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 真实跑到第 9/14/19/24 波：三选一里恰有一张契约卡，刷新后契约卡随之消失
- [ ] 接受一条契约后代价与收益立即生效，并在 HUD 留下标注「本波/本局」的 chip
- [ ] 每局最多接受 2 次；第 3 次不再出现契约卡
- [ ] 契约只改客户端可模拟资源，同一 seed 下敌人 HP/速度/入口与不接受契约时完全一致

## Touches

- `server/services/run-service.mjs`
- `public/js/shared/contracts.js` (new)
- `public/js/sim/relic-system.js`
- `public/js/sim.js`
- `public/js/app/combat.js`
- `public/js/ui/modals.js`
- `public/js/ui/hud.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/contracts.test.mjs` (new)
- `tasks/gap-contracts.md`

## Notes

<!-- dedup-ref -->
与 `gap-boss-cores` 的边界：契约只替换普通三选一，不进入首领核心槽位。与 `gap-starter-relic-upgrade-guarantee` 的边界：第 3 波起的保底升级卡优先于契约替换；同一槽位只能有一张契约。红线：契约绝不修改服务端生成的敌人 HP/速度/入口，测试要用同一 seed 对比证明。
