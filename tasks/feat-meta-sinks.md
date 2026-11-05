---
id: feat-meta-sinks
title: 局外三币种长期出口：星核升星消耗 + 皮肤/赛季可重复消耗
status: ready
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

- [ ] 星核有持续消耗出口（抽卡之外），如塔升星消耗星核
- [ ] 皮肤/赛季有可重复消耗（刷新/升级/兑换），非一次性
- [ ] `npm test` 全绿；经济不因此失衡（balance 复测）

## DoD

- [ ] 落地于 `unlocks.js`/`season-pass`/`cosmetics` 相关 + 服务端，零第三方依赖
- [ ] 不碰 sim/确定性
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/data/unlocks.js`
- `public/js/shared/season-pass.js`
- `server/routes/unlock.mjs` (星核升星消耗)
- `server/routes/season-pass.mjs` (赛季可重复消耗)
- `server/routes/profile.mjs` (皮肤/cosmetics 消耗)
- `tests/season-pass.test.mjs` (赛季消耗测试)
- `tests/cosmetics.test.mjs` (皮肤/称号消耗测试)
- `tests/skins.test.mjs` (皮肤测试)
- `scripts/test-changed.mjs`
- `tasks/feat-meta-sinks.md`

## Notes

立案 2026-11-06，源自 P0-4「局外三币种长期出口」。⚠️ 数值改动需 balance 复测；设计细节（各币种的具体消耗项/价格）需在实现中补 Notes。与抽卡（GOAL-015）的星核消耗要一起看，避免互相冲突。