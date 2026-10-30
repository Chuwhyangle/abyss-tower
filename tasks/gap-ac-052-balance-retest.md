---
id: gap-ac-052-balance-retest
title: 三档平衡复测：通关率回到 70–85 / 25–40 / 5–12 并重写 docs/BALANCE.md（AC-052）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-050-enemies-expand
goal_ac: AC-052
---
## Proposal

AC-052（GOAL-010 退出条件 3）已激活，criterion `! grep -qE '低于目标|高于目标' docs/BALANCE.md` 当前 exit 1：docs/BALANCE.md（2026-10-26，固定三图 × 40 种子，全解锁机器人）三档通关率为漫游 29% / 远征 1% / 深渊 0%，全部标「低于目标」（目标 70–85 / 25–40 / 5–12）。本任务在敌人扩充（AC-050）落地后，重跑固定三图平衡模拟并回调数值，让三档通关率逐档回到目标区间，重写 docs/BALANCE.md 使 criterion exit 0。

<!-- dedup-ref --> 无任务以 `goal_ac: AC-052` 认领；`gap-rogue2-balance`（superseded，`goal_ac: AC-039`）是 GOAL-007 肉鸽 2.0 的平衡复测、`MAP-006`（done，`goal_ac: AC-003`）是固定图落地时的平衡文档任务，两者目标区间来源与本任务不同、机制实例不同，故独立立案不折叠。`gap-ac-054-rogue2-design-rebase` 与本任务同 Touches `scripts/test-changed.mjs`（各加一条 TEST_MAP 登记），调度器按 Touches 串行即可，无合并必要。`gap-ac-050-enemies-expand` 是本任务的前置（见顶层 depends_on）：平衡模拟以 14 类敌人的最终树为口径，本任务在 AC-050 之后落地。

## Plan

1. 等 AC-050（wraith/golem 进 ENEMIES/waves/sim）落地后，先跑 `node tests/balance-sim.mjs 40 --report=docs/BALANCE.json` 拿结构化基线（meta.targets / summary / targets / difficulties / content）。
2. 按 GOAL-010 非目标红线（不改 30 波结构、三档难度倍率表 DIFFICULTIES、经济与计分口径、首领机制红线与入口计划），只回调波次组成（`public/js/shared/waves.js` 的 weight / countMult / minWave）与新敌人数值；若机器人策略是系统性短板（MAP-006 记录其不选主海克斯、不主动用技能），同步把 `tests/lib/balance-bot.mjs` 修到「代表真人下限」的口径，不得靠关闭新系统或新敌人凑数。
3. 复跑 40 种子，直到三档 full-unlock 通关率逐档落在 `BALANCE_TARGETS`（0.70–0.85 / 0.25–0.40 / 0.05–0.12）；若某档无法同时达标，任务保持打开并写明取舍与原因，目标调整需人拍板、不得自行放宽。
4. `npm run balance:write` 重写 `docs/BALANCE.md`；新增 `tests/balance-targets.test.mjs` 读取 `docs/BALANCE.json`，断言三档 `targets` 均 `status === '达标'`、样本量 ≥40、`meta.targets` 与当前 `BALANCE_TARGETS` 一致；并把该新测试登记进 `scripts/test-changed.mjs` 的 TEST_MAP。

## AC

- [ ] `! grep -qE '低于目标|高于目标' docs/BALANCE.md` exit 0（AC-052 本体判据）
- [x] `node tests/balance-sim.mjs 40 --report=docs/BALANCE.json` exit 0
- [ ] `node --test tests/balance-targets.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] `docs/BALANCE.json` 与 `docs/BALANCE.md` 来自同一轮 40 种子复跑，三档 full-unlock 通关率逐档真实落在 `BALANCE_TARGETS`（不是删标记、改 `BALANCE_TARGETS` 或关系统凑数）
- [x] 未改 30 波结构、三档难度倍率表、经济与计分口径、首领红线、战斗公式；`docs/BALANCE.md` 由 `npm run balance:write` 重新生成、无手工改数字
- [x] 机器人策略若改动，给出「代表真人下限而非完美操作/作弊」的证据（选取率/使用率写入 Notes），不是靠改测量仪器把数字抬上去

## Notes

机器人从「不选主海克斯 / 不用技能 / 不进化」补到真人下限口径后，三档 full-unlock 通关率由 29/1/0% 回到 76/26/11%（40 种子 × 3 候选图 × 全解锁，720 局）。随后 develop 合入派系套装（AC-055），机器人被套装增益抬高（深渊全解锁一度到 20.8%、标准到 41.7%），一度靠回调波次组成与新敌人数值落回 72.5% / 29.2% / 10.8%。再后 develop 合入开局信物升级保底（AC-056：`rollRelicOffers` 从第 3 波起强制占用一个 offer 位推升级卡），压缩了新遗物多样性，机器人首领波 DPS 不足，三档回落到 66.67% / 26.67% / 9.17%（原配置）——漫游档低于 70% 下限。

**结论：漫游档在任务允许范围内无法回到 70%，任务保持打开（needs-human）。** 已试遍 Plan 允许的三类杠杆，均不能把漫游拉到 70%：

- **波次 `countMult`**：×0.8 / ×0.9 / ×1.0 / ×1.3 → 漫游 65.83% / 67.50% / 66.67% / 53.33%（峰值 67.50%，非单调，killGold 自限）。
- **新敌人数值（相位幽魂/岩石魔像）**：调易（幽魂 hp 45/护甲 0、魔像 hp 260/护甲 6）漫游仍 67.50%，39 局败局中 37 局不变——漫游 31/39 败局死在首领波（第 25 波裂隙亲王 + 第 30 波血怒渊主），这两波是冻结红线，敌人侧数值触及不到。
- **波次 `weight`**（坦克型下调、群体型上调）：漫游仍 67.50%。

根因：AC-056 的保底升级卡让机器人每局少拿约 1/3 新遗物，18 塔 + ~19 遗物的 DPS 上限打不死已冻结的首领波；首领波小怪（grunt/flyer/tank/shielder/caster）在 `waves.js` 的 `isBoss` 分支硬编码、不随 countMult/weight 变化，战斗公式、遗物与首领机制又是红线/他任务领地。

因此本轮把波次组成与新敌人数值**全部回退到 AC-055 前基线**（`waves.js` countMult 恢复原值、相位幽魂/岩石魔像恢复 hp 58/护甲 1 与 hp 340/护甲 9），仅保留机器人真人下限修复。回退后 `docs/BALANCE.md`/`docs/BALANCE.json` 同一轮真实重跑为 66.67% / 26.67% / 9.17%：远征与深渊均在区间内，漫游低于 70% 下限，故 `grep '低于目标'` 判据与 `balance-targets` 见证测试如实失败，任务不翻转。

**需人工拍板（三选一，均不在本任务允许范围内）：**
1. 重校准漫游目标下限（0.70 → 0.65 一带，需人确认）；或
2. 机器人塔组补狙击/战旗等首领对策（需人确认仍属「真人下限」、并重跑三档校准）；或
3. AC-056 侧回调遗物 offer 保底（降频/放宽），由遗物/肉鸽 lane 落地。

红线未动：30 波结构、DIFFICULTIES 三档倍率表、经济与计分、首领机制、战斗公式、BALANCE_TARGETS 均未改；`docs/BALANCE.md` 与 `docs/BALANCE.json` 由同一轮 `node tests/balance-sim.mjs 40 --write --baseline --report=docs/BALANCE.json` 生成，无手工改数字。数据层内容快照（data-split）与固定种子结算基线（effects-registry）哈希随数值回退到基线、不再变更。

机器人「真人下限而非完美操作/作弊」证据（沿用）：

- **技能 aurora Lv1（使用率 100% 局）**：aurora 是默认解锁技能，真人开局即拥有；机器人仅在 `cooldown <= 0 && enemies.length > 0` 时施放（冷却好就放，不预判波次、不卡时机），是下限。旧口径 `skill=none` 相当于真人从不用默认技能，系统性低估。
- **主海克斯（选取率 100% 局）**：`pickHex(seed) = offerHexes(seed, 3)[0]`。真人开局三选一必选其一；取第一 offer 是「无偏好」下限，不是遍历三张按地图/遗物择优。
- **塔进化（满级塔 100% 进化到第一分支）**：满级塔进化免费、不占经济，真人必然顺手点；取第一分支是「不择优」下限。

## Touches

- `tests/balance-sim.mjs`
- `tests/lib/balance-bot.mjs`
- `tests/lib/balance-report.mjs`
- `tests/balance-targets.test.mjs` (new)
- `scripts/test-changed.mjs`
- `docs/BALANCE.md`
- `docs/BALANCE.json` (new)
- `tasks/gap-ac-052-balance-retest.md`

## Blocker

**2026-10-30T13:55:37.894Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 3/7，剩余未勾 4）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：e45a7139-e8f4-4fd6-9d38-e8c05995c6cd
