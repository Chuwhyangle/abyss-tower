# PHASE 抽卡 · 冻结表

> 状态：定稿（2026-11-06，三路子代理论证收敛后 manager 裁定）
> 对标《明日方舟》的「塔抽取」系统。本表是抽卡机制、数值、字段契约与 AC 映射的唯一定义处。

## 0. 背景与目标

塔目前是「星核商店固定购买」（arc/poison/banner/shock 30 核、sniper 40 核）。改为**随机抽取**：用游玩产出的星核抽塔，给塔加稀有度分层，配一张全屏抽卡页 + 出货动画。对标舟的「干员寻访」。

- 抽卡资源 = **星核（cores）**（`profile.cores`，DB `player_wallets.currency_id='cores'`）。⚠️ 用户口头称「积分」，但代码里「积分」是赛季通行证分数（不可花费），本表沿用「星核」避免撞名。
- 抽卡产出 = 塔（后续重做/新增塔时再调稀有度分布）。

## 1. 稀有度分级（塔分类，三路论证后重排）

6 档框架，但**免费基础塔不进抽卡池**（否则 3★ 权重 50% 会全是已拥有塔，首抽即负反馈）。现有 8 塔映射：

| 稀有度 | 档位 | 塔 | 是否可抽 |
|---|---|---|---|
| 传说 | 6★ | sniper 狙击 | ✅ |
| 史诗 | 5★ | arc 电弧（连锁+无视护甲，「一看就强」） | ✅ |
| 稀有 | 4★ | banner 战旗（纯辅助，降档） | ✅ |
| 普通 | 3★ | poison 毒雾、shock 震荡 | ✅ |
| 基础 | 1★ | arrow 弩、cannon 炮、frost 霜 | ❌ 开局拥有，不进池，图鉴展示 |
| （预留） | 2★ | 暂无 | — |

- 数据契约：新增 `public/js/shared/data/towers-rarity.js`（`TOWER_RARITY`：id→rarity/star/color），**不动 `towers.js` 战斗数值职责**。
- 抽卡池 = 可抽 5 塔；免费三塔保留 `towers.js` 的「无 `unlock` 字段」护栏（`unlockedTowerIds` 里 `!TOWERS[id].unlock` 恒可用）。

## 2. 概率与保底（对标舟，适配 5 塔池）

| 稀有度 | 概率 |
|---|---|
| 6★ | 5% |
| 5★ | 12% |
| 4★ | 28% |
| 3★ | 55% |

- **软保底**：连续 30 抽无 6★ 后，6★ 概率每抽 +2%（31 抽 7%…），**60 抽硬保底必出 6★**。
- **首 6★ 必未拥有**（池内首个 6★ 必出尚未拥有的 6★ 塔，避免「唯一 6★ 出货即重复」）。
- **十连必 4★+**（十连结果全 3★ 时，强制末位升档为 4★）。
- 保底计数账号级、跨次抽卡继承；出 6★ 后清零。软保底从 50 提前到 30（相对舟，因池小）。
- 确定性红线：抽卡 RNG 用 server 侧 `node:crypto` 随机，**不进** `sim.js` 确定性流（抽卡是账号级永久状态，与单局回放/分享码无关）。

## 3. 价格与经济（三路论证后砍价）

- 单抽 **15 星核**，十连 **150 星核**（首版无折扣）。
- **重复转化 = 塔碎片**（复用遗物「重复=升级」已验证心智，重复是长期成长而非退款）：
  - 3★ 重复 → 5 碎片、4★ → 10、5★ → 20、6★ → 40。
  - 碎片存 `player_kv('gacha','shards')`（JSON `{ towerId: count }`）。
  - **升星（消耗碎片提升塔）为阶段 2**，首版只攒碎片 + 展示碎片条；首版不改塔战斗数值（避免 balance 风险）。
- 塔从「星核商店」移除：`unlocks.js` 的 5 个 `tower_*` 解锁项下线（perk 解锁保留）。
- 平衡红线：抽卡是账号养成，不碰塔局内数值（塔强度不变），故三档通关率原则上零漂移；落地后 `npm run balance` 复测确认。

## 4. 字段契约与存储（三路论证后定稿）

- **塔拥有**：复用 `player_unlocks` 表（`grantUnlock(accountId, 'tower_<id>')` 幂等 `INSERT OR IGNORE`）。存量 `tower_*` 商店数据与抽卡 key **同空间**，零迁移。
- ⚠️ **地雷修复（必须做）**：`server/routes/unlock.mjs` 的 `updateProfile({ unlocks })` 走 `DELETE-all` 全量重写（`db.mjs:174-194`），会清掉抽到的塔——**改为增量 `grantUnlock`**（或 `updateProfile` 内按 diff 增删），否则 perk 商店购买会 lost-update 掉抽卡塔。
- **抽卡历史**：新建 `gacha_history` 表（`account_id`、`drawn_at`、`tower_id`、`rarity`、`is_new`、`shards`、`request_id`），迁移 `server/db/migrations/0012_gacha.mjs`；加索引 `idx_gacha_history_account(account_id, id DESC)`。
- **保底计数**：`player_kv('gacha','pity6')`（整数 JSON），读改写压进同一事务。
- **碎片**：`player_kv('gacha','shards')`（JSON map）。
- 塔拥有判定：`unlockedTowerIds()` 逻辑**基本不动**（`TOWERS[id].unlock` 就是 `tower_<id>`，与 `grantUnlock` 对齐），只确保不删免费塔护栏、不删 `towers.js` 的 `unlock` 字段。下游 `towersUnlocked → sim.unlockedTowers` 链路零改动。

## 5. API

- `GET /api/gacha/pool` → `{ currency:'cores', balance, price:{single:15,ten:150}, rates, pity6, owned, shards }`
- `POST /api/gacha/draw` `{ count: 1|10, request_id }` → 单事务包全流程（`spendCoresInTx` 条件扣费 → 抽 → 落库 → 记历史 → upsert pity → grantUnlock/碎片）→ `{ results:[{towerId,rarity,isNew,shards}], balance, pity6 }`
  - **幂等**：`request_id` 去重（重复请求直接返回首次结果，防客户端重试双扣）；塔拥有靠 `grantUnlock` 幂等，碎片靠 `request_id` 幂等。
  - 扣费照抄 `skills.mjs:126-143` 的「单事务内重读→条件扣费→写状态」形状。
- `GET /api/gacha/history` → 最近 N 条（脱敏，不含 account 信息）。

## 6. UI/UX（全屏抽卡页）

- 第 3 个 `.screen` section：`#gacha-screen`（`index.html` 加 section + 标题页 `.row` 加 `btn-gacha`）。
- **三态对称翻转**（⚠️ 实现 agent 强调的风险点）：`showGacha/hideGacha` 翻三屏 `hidden`；`showTitle/showGame` 都要补 `gacha.hidden=true`，否则叠屏。
- 进抽卡页 `stopMenuBackground()`（停掉标题页 canvas rAF，防空转争帧）；`refreshLocale()` 加 gacha 分支；出货动画计时器纳入切屏清理（防孤儿定时器）。
- 页面结构：顶部返回 + 余额 + 碎片；Banner 区（当前池 + 概率公示入口）；单抽/十连按钮；结果展示区（塔卡 + 稀有度边框/光效）；「概率公示」弹窗 + 「抽卡历史」弹窗（复用 `#modal-root`）。
- 出货动画（分档）：3★ 普通过场；4★ 蓝光；5★ 紫光 + 延迟；6★ 金光 + 大特效 + 全屏闪；十连逐张翻开，4★+ 高亮。
- 塔卡：复用 `render/tower-draw.js` 塔绘制 + 稀有度边框色。

## 7. 美术资源（CC0 拉取 + 程序化补）

- 召唤按钮：Summer Engine「Summon Button」/「Challenge Button」。
- 出货特效：Summer Engine「Pixel Sparkle Burst」+ itch.io FX 魔法爆裂/火花。
- 稀有度光效/边框/金色粒子：程序化（复用现有 canvas 精灵管线风格）为主，CC0 精灵图集为辅。
- 所有拉取资源落 `public/assets/gacha/`，标注来源与许可（CC0）。

## 8. 测试（走 harness）

- 抽卡概率/保底：新 `tests/gacha.test.mjs`（喂临时 DB 断言：draw 扣费/落库/保底计数/十连保底/首 6★ 必新/碎片分层/request_id 幂等/余额不足拒绝）。
- 轴/缝：`tests/lib/axes.mjs` 注册「塔稀有度」轴；`tests/lib/seams.mjs` 注册「抽卡→拥有塔→局内可建造」缝。
- 概率公示一致性：UI 展示概率与 `pool` 接口一致。
- `npm test` 全绿；`test-changed.mjs` 的 TEST_MAP 登记新文件。

## 9. 实施拆分（阶段0 串行 → 阶段1 三并行）

- **阶段 0（串行，契约/数据层）**：`towers-rarity.js` + `unlocks.js` 判定护栏 + `unlock.mjs` 增量修复 + `db.mjs` 抽卡读写 + 迁移 `0012_gacha.mjs` + gacha 配置（池/概率/价格/碎片）。
- **阶段 1（并行，依赖阶段0）**：
  - 服务端：`server/routes/gacha.mjs`（pool/draw/history）+ request_id 幂等 + 单事务。
  - 前端 UI：`#gacha-screen` + `ui.js` 三态翻转 + `gacha-ui.js`（页面/动画/结果/公示/历史）+ styles + i18n。
  - 美术：拉取 CC0 资源到 `public/assets/gacha/` + 集成。
- **阶段 2（集成，后置）**：塔升星（碎片消耗）、i18n 收口、`npm test` 全绿、`npm run balance` 复测、文档同步。
