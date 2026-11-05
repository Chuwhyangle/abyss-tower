---
id: feat-gacha-contract
title: 抽卡·阶段0 契约/数据层：塔稀有度映射 + 抽卡配置 + 拥有判定护栏 + unlock 增量修复 + 迁移 0012
status: ready
labels:
  - feat
parent: null
children: []
extra: {}
---
## Proposal

抽卡系统（对标明日方舟）的数据层契约，冻结表见 `docs/PHASE_抽卡.md`（已定稿，§1-4）。本任务只做数据层，不碰 UI/路由。

1. 新增 `public/js/shared/data/towers-rarity.js`：`TOWER_RARITY`（塔 id→rarity/star/color），映射 6★sniper、5★arc、4★banner、3★poison+shock、1★arrow/cannon/frost（免费不进池）。
2. 新增 `public/js/shared/data/gacha.js`：抽卡池配置——可抽 5 塔、概率 6★5%/5★12%/4★28%/3★55%、单抽 15 核/十连 150、软保底 30 抽(+2%/抽)/硬保底 60、十连必 4★+、首 6★ 必未拥有、碎片 3★=5/4★=10/5★=20/6★=40。纯数据纯函数（`rollGacha(seed, count, owned, pity)` 可测，用注入的 RNG 保持确定性可测）。
3. `unlocks.js`：`unlockedTowerIds()` 保留免费塔护栏（`!TOWERS[id].unlock`）不变，塔拥有判定与 `tower_<id>` 对齐（基本不动，只确认护栏不丢）。
4. ⚠️ 地雷修复：`server/routes/unlock.mjs` 的 `updateProfile({ unlocks })` 是 DELETE-all 全量重写，会清掉抽到的塔——改成增量 `grantUnlock`（或 `updateProfile` 内按 diff 增删）。
5. `server/db.mjs`：抽卡读写原语（读/写 pity6、读/写碎片 shards、写 gacha_history、`drawGachaInTx` 单事务）。
6. 迁移 `server/db/migrations/0012_gacha.mjs`：建 `gacha_history` 表 + 索引。

## AC

- [x] `towers-rarity.js` 的 8 塔映射与 `docs/PHASE_抽卡.md` §1 一致（6★sniper/5★arc/4★banner/3★poison+shock/1★免费三塔）
- [x] `gacha.js` 概率/价格/保底/碎片常量与 §2-3 一致，`rollGacha` 用注入 RNG 可确定性复现（权重正确、软/硬保底、十连保底、首 6★ 必新）
- [x] `unlock.mjs` 改为增量 `grantUnlock`（不再 DELETE-all 清掉塔拥有）
- [x] 迁移 `0012_gacha.mjs` 可 apply 且幂等；`gacha_history` 有 `(account_id, id DESC)` 索引
- [x] `npm test` 全绿；新增数据层单测覆盖 rollGacha 概率/保底边界

## DoD

- [x] 落地于 `towers-rarity.js`(新)、`gacha.js`(新)、`unlocks.js`、`unlock.mjs`、`db.mjs`、`0012_gacha.mjs`(新)，零第三方依赖
- [x] 抽卡 RNG 不进 `sim.js` 确定性流（账号级状态，与单局回放/分享码无关）
- [x] 塔局内数值不变（稀有度只影响展示/边框，不碰 `towers.js` 战斗数值）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量已在 `docs/PHASE_抽卡.md`

## Touches

- `public/js/shared/data/towers-rarity.js` (new)
- `public/js/shared/data/gacha.js` (new)
- `public/js/shared/data/unlocks.js`
- `public/js/shared/data.js`
- `server/routes/unlock.mjs`
- `server/db.mjs`
- `server/db/migrations/0012_gacha.mjs` (new)
- `tests/gacha.test.mjs` (new)
- `tests/system-status.test.mjs`
- `docs/PHASE_抽卡.md`
- `scripts/test-changed.mjs`
- `tasks/feat-gacha-contract.md`

## Notes

立案 2026-11-06，源自用户「对标明日方舟做抽塔」需求，三路子代理论证（玩法/经济/实现）收敛后 manager 裁定，冻结表 `docs/PHASE_抽卡.md`。关键裁定：免费三塔下放 1★ 不进池（否则首抽 50% 负反馈）；价格砍到 15 核（30 核对「一局 ~105 核」是十倍黑洞）；重复转碎片（复用遗物「重复=升级」心智）而非返星核；unlock.mjs 的 DELETE-all 覆写是必须修的 lost-update 地雷。升星（碎片消耗）为阶段 2，本任务只攒碎片。

落地补充：`tests/system-status.test.mjs` 迁移版本 11→12（新迁移使 latestVersion 前进）；`docs/PHASE_抽卡.md` 仅补阶段1 路径（`server/routes/gacha.mjs`、`public/assets/gacha/`）的 docs-consistency planned 块——冻结表定稿时漏标这些计划态路径，docs-consistency 全量 red，本任务补机械标注（非设计增量）。

## Blocker

**2026-11-05T22:06:29.341Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: name: 'AssertionError'
- run_id：wk-prod-anchor
- session_id：8a9ea69d-2597-4efd-a41c-6230979b6861
