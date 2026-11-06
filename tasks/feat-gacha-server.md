---
id: feat-gacha-server
title: 抽卡·阶段1 服务端：gacha 路由 pool/draw/history + request_id 幂等 + 单事务
status: ready
labels:
  - feat
parent: null
children: []
extra: {}
depends_on:
  - feat-gacha-contract
---
## Proposal

抽卡服务端路由，依赖阶段 0 数据层（`feat-gacha-contract`）。冻结表 `docs/PHASE_抽卡.md` §5。

- 新增 `server/routes/gacha.mjs` 注册三个端点：
  - `GET /api/gacha/pool` → `{ currency:'cores', balance, price:{single:15,ten:150}, rates, pity6, owned, shards }`。
  - `POST /api/gacha/draw` `{ count: 1|10, request_id }` → 单事务包全流程（`spendCoresInTx` 条件扣费 → `rollGacha` 抽 → 落库塔拥有/碎片 → 记 `gacha_history` → upsert `pity6`）→ `{ results:[{towerId,rarity,isNew,shards}], balance, pity6 }`。余额不足拒绝。
  - `GET /api/gacha/history` → 最近 N 条（脱敏）。
- 幂等：`request_id` 去重（重复请求返回首次结果，防客户端重试双扣）；塔拥有靠 `grantUnlock` 幂等。
- 扣费照抄 `skills.mjs:126-143` 的单事务形状（事务内重读→条件扣费→写状态）。

## AC

- [ ] `POST /api/gacha/draw` 正确扣费、抽卡、落库、记历史、更新 pity；余额不足返回拒绝且不改任何状态
- [ ] `request_id` 幂等：同一 request_id 重试不重复扣费、返回首次结果
- [ ] 概率/保底正确：软保底 30 抽 +2%/抽、硬保底 60 抽必 6★、十连必 4★+、首 6★ 必未拥有（`tests/gacha.test.mjs` 喂临时 DB 断言）
- [ ] `GET /api/gacha/pool` 返回的 rates/price 与 `gacha.js` 常量一致
- [ ] `GET /api/gacha/history` 脱敏、按时间倒序
- [ ] `node --test tests/gacha.test.mjs` exit 0；`npm test` 全绿

## DoD

- [ ] 落地于 `server/routes/gacha.mjs`(新)、`server/index.mjs`(注册路由)、`tests/gacha.test.mjs`(补全)，零第三方依赖
- [ ] 全流程单事务（扣费→抽→落库→pity 原子，中途失败不产生「扣了核没给塔」）
- [ ] 抽卡 RNG 用 server 侧 crypto 随机，不进 sim 确定性流
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `server/routes/gacha.mjs` (new)
- `server/index.mjs`
- `tests/gacha.test.mjs`
- `scripts/test-changed.mjs`
- `tasks/feat-gacha-server.md`

## Notes

立案 2026-11-06。依赖 `feat-gacha-contract`（数据层）。实现 agent 论证的并发要点：`spendCoresInTx` 条件 UPDATE + `BEGIN IMMEDIATE` 已挡负余额与并发覆盖，缺的是「draw 全流程单事务」+ `request_id` 幂等键（否则客户端超时重试会双扣）。塔拥有落库复用 `grantUnlock`（幂等 INSERT OR IGNORE）。