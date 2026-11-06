---
id: feat-gacha-server
title: 抽卡·阶段1 服务端：gacha 路由 pool/draw/history + request_id 幂等 + 单事务
status: done
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

- [x] `POST /api/gacha/draw` 正确扣费、抽卡、落库、记历史、更新 pity；余额不足返回拒绝且不改任何状态
- [x] `request_id` 幂等：同一 request_id 重试不重复扣费、返回首次结果
- [x] 概率/保底正确：软保底 30 抽 +2%/抽、硬保底 60 抽必 6★、十连必 4★+、首 6★ 必未拥有（`tests/gacha.test.mjs` 喂临时 DB 断言）
- [x] `GET /api/gacha/pool` 返回的 rates/price 与 `gacha.js` 常量一致
- [x] `GET /api/gacha/history` 脱敏、按时间倒序
- [x] `node --test tests/gacha.test.mjs` exit 0；`npm test` 全绿

## DoD

- [x] 落地于 `server/routes/gacha.mjs`(新)、`server/index.mjs`(注册路由)、`tests/gacha.test.mjs`(补全)，零第三方依赖
- [x] 全流程单事务（扣费→抽→落库→pity 原子，中途失败不产生「扣了核没给塔」）
- [x] 抽卡 RNG 用 server 侧 crypto 随机，不进 sim 确定性流
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `server/routes/gacha.mjs` (new)
- `server/routes/index.mjs`
- `tests/gacha.test.mjs`
- `scripts/test-changed.mjs`
- `tasks/feat-gacha-server.md`

## Notes

立案 2026-11-06。依赖 `feat-gacha-contract`（数据层，已落地）。实现 agent 论证的并发要点：`spendCoresInTx` 条件 UPDATE + `BEGIN IMMEDIATE` 已挡负余额与并发覆盖，缺的是「draw 全流程单事务」+ `request_id` 幂等键（否则客户端超时重试会双扣）。塔拥有落库复用 `grantUnlock`（幂等 INSERT OR IGNORE）。

实现记录（2026-11-06）：

- 路由装配点在 `server/routes/index.mjs`（架构重构后 `server/index.mjs` 只经 `createApiRouter()` 引导），故注册落在 `server/routes/index.mjs` 并登记进 Touches；`server/index.mjs` 无需改动（DoD 原路径描述的是注册这件事，不是那个文件）。
- `request_id` 语义：带上则作为账号内幂等键——`readGachaHistoryByRequest` 命中就重放首次 results，不扣费不抽取；缺省时由服务端 `crypto.randomUUID()` 生成一次性键（客户端不带键就没有跨请求去重语义，但不会 400）。非法键（非字符串/空/超 128 字符）返回 `INVALID_REQUEST_ID`。
- 幂等原子性：查重与 `drawGachaInTx` 在同一个同步 tick（`drawGachaInTx` 全程同步），Node 单线程下并发同键重试也只有第一个真正扣费；测试含 `Promise.all` 并发对照。
- `pool.owned` 用 `unlockedTowerIds`，语义是「全部已拥有塔 id」（含免费三塔），UI 可直接判断池塔是否已拥有。
- `history` 响应形状 `{ history: [{ towerId, rarity, isNew, shards, drawnAt }] }`，`?limit=` 缺省 20、db 层夹到 1..100；按自增 id 倒序，同毫秒也稳定。
- RNG 每次抽取 `new RNG(crypto.randomBytes(16).toString('hex'))`，与 sim 确定性流完全隔离。
- 验证：`node --test tests/gacha.test.mjs` 17/17；`npm test` 2131/2131 全绿；`scripts/style-check.mjs` 通过；architecture/test-changed/structure-budget 56/56。

## Blocker

**2026-11-06T02:02:06.173Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'main' — 'develop' (fe7bd29a) is NOT a continuation of the project's default branch 'main' (3f19784f) — it is 2 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task feat-gacha-server's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'main'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：14976d03-212b-4793-81ee-533e996992cb
