---
id: gap-starter-relic-upgrade-guarantee
title: 开局信物三选一 + 第 3 波起三选一必含升级卡
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/starter-relic.test.mjs
depends_on:
  - DOCS-002
  - gap-factions-points
goal_ac: AC-034
---
## Proposal

设计稿要求开局「信物三选一」：三个不同派系各给 1 件入门遗物（Ⅰ）+ 该派系 1 点；并从第 3 波起，每次三选一必含 1 张「已拥有且未满级遗物」的升级卡。当前 `rollRelicOffers`（`public/js/shared/data/relics.js`）是完全随机抽取，升级卡没有任何保底；开局只有 `start_relic` 解锁时随机送 1 件，没有三选一流程。这导致「遗物升级几乎不发生」，也是旧设计审计 §1.1 的核心问题。本任务只做开局信物与升级保底，不碰派系阈值本身（由 `gap-factions-points` 提供数据）。

## Plan

1. 共享层新增 `rollStarterOffers(seedKey, mode)`：确定性返回 3 件不同派系的 Ⅰ 级信物；同一 seed 在普通 / 每日 / 本周 / 无尽 / 变异下可复现，每日同组玩家候选一致。
2. `server/services/run-service.mjs` 在创建 run 时生成并持久化 starter 候选；新增最小 API（`GET` 读取候选、`POST` 选择）或复用既有 offers 槽位，但不得破坏旧 run 的 `offers` 结构。
3. `public/js/app/run.js` 在选图/海克斯之前插入信物三选一；选择成功后把遗物与派系点写进 run，再进入原有流程；失败停留在同一组候选，不重复消耗。
4. `rollRelicOffers` 增加保底：`wave >= 3` 且存在已拥有且未满级遗物时，第一个 offer 必须是其中一件的升级卡（`fromLevel >= 1`）；其余仍按权重随机。池子为空时保持既有金币/修复补位。
5. 快照与旧档：旧 run 没有 starter 字段时跳过信物流程；快照恢复后候选与已选状态幂等。
6. 新增 `tests/starter-relic.test.mjs`：候选确定性、三派系不重复、选择后点数为 1、第 3 波起必含升级卡、旧档兼容、每日同组一致。

## AC

- [ ] `node --test tests/starter-relic.test.mjs` exit 0
- [ ] `node --test tests/relics.test.mjs tests/daily-challenge.test.mjs` exit 0
- [ ] `node --test tests/api.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 真实创建一局：开局出现三张不同派系信物，选中后遗物入包、对应派系 +1 点，随后正常进入选图
- [ ] 同一 seed 重复创建得到同一组信物；每日挑战同组玩家候选一致
- [ ] 第 3 波起，只要存在已拥有且未满级遗物，三选一必含一张升级卡；没有可升级遗物时行为与今天一致
- [ ] 刷新、快照恢复、旧档续玩都不重复发信物、不换候选

## Touches

- `server/services/run-service.mjs`
- `server/routes/runs.mjs`
- `public/js/shared/data/relics.js`
- `public/js/app/run.js`
- `public/js/ui/modals.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/starter-relic.test.mjs` (new)
- `tasks/gap-starter-relic-upgrade-guarantee.md`

## Notes

<!-- dedup-ref -->
与 `gap-factions-points` 的边界：派系数据、点数与阈值由该任务提供，本任务只消费 `faction` 字段并发放 1 点；与 `gap-contracts` 的边界：契约卡只替换三选一里的一张，不改变保底升级卡的优先级，调度器按 Touches 串行。开局信物是服务端权威选择，客户端不得自造候选。
