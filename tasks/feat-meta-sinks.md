---
id: feat-meta-sinks
title: 局外三币种长期出口：星核升星消耗 + 皮肤/赛季可重复消耗
status: done
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

局外三币种长期出口（P0-4）。现状：星核/皮肤/赛季都是浅池（5~10 局毕业），缺持续消耗出口。

- 给星核（cores）加长期消耗出口：抽卡（已在 GOAL-015）+ 本任务补「塔升星消耗」（碎片+星核）。
- 皮肤/赛季：补可重复兑换/刷新类消耗（如赛季商店刷新、皮肤染色/升级），让毕业玩家有持续花钱的地方。

## AC

- [x] 星核有持续消耗出口（抽卡之外），如塔升星消耗星核
- [x] 皮肤/赛季有可重复消耗（刷新/升级/兑换），非一次性
- [x] `npm test` 全绿；经济不因此失衡（balance 复测）

## DoD

- [x] 落地于 `unlocks.js`/`season-pass`/`cosmetics` 相关 + 服务端，零第三方依赖
- [x] 不碰 sim/确定性
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/data/unlocks.js`
- `public/js/shared/skins.js`
- `public/js/shared/season-pass.js`
- `server/db/season_pass.mjs`
- `server/db/season-shop.mjs`
- `server/db/shards.mjs`
- `server/routes/unlock.mjs`
- `server/routes/season-pass.mjs`
- `server/routes/profile.mjs`
- `server/services/season-pass-service.mjs`
- `tests/season-pass.test.mjs`
- `tests/skins.test.mjs`
- `tests/data-split.test.mjs`
- `tests/tower-star.test.mjs`
- `tasks/feat-meta-sinks.md`

## Notes

立案 2026-11-06，源自 P0-4「局外三币种长期出口」。

设计增量（三币种长期消耗出口）：
- 星核（cores）：塔升星。可解锁塔（arc/poison/banner/shock/sniper）从 1★ 升到 5★，逐级消耗 30/60/120/240 星核；基础免费塔不参与。星级存 player_kv('tower_star','state')，纯账号收藏，不进战斗数值。
- 皮肤碎片（skin_shards）：皮肤升级。非默认皮肤（有配色变换）从 1 级升到 5 级，逐级消耗 10/20/40/80 碎片；等级存 player_kv('cosmetics','skin_upgrades')，只做收藏展示，不改配色/渲染。
- 赛季积分：赛季商店。溢出积分按「总积分 − 已兑换」可重复兑换（物资箱 5000→3 碎片、大箱 12000→8 碎片），已兑换账本存 player_kv(ledger, spent:<season>)。兑换只消耗溢出积分，不动里程碑进度。

balance 复测结论：三出口均为局外纯虚荣/兑换，不 import sim、不改任何战斗数值（塔伤害/经济/难度均未动），战斗平衡结构性无影响；`npm test` 2054 例全绿（含 data-split 内容快照逐字一致）。碎片扣减与星核同用条件 UPDATE 原子回滚，余额不足不会白扣。抽卡（GOAL-015）尚未落地，本任务只消耗 cores，不与抽卡碎片冲突。

拆分说明：赛季商店兑换迁到 server/db/season-shop.mjs、碎片钱包迁到 server/db/shards.mjs，避免 server/db/season_pass.mjs 超 600 行结构预算。