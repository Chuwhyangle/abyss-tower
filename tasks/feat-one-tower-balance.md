---
id: feat-one-tower-balance
title: 独塔重做 balance 验证：复测三档通关率并回调 7 塔大招数值
status: needs-human
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs tests/meta-balance-targets.test.mjs
---
## Proposal

独塔重做（`feat-one-tower-core` + `feat-one-tower-ultimates` + `feat-one-tower-visuals`，均已 done）的 7 塔大招数值是草案（`docs/TODO.md` TODO-3 表）。本任务跑 `npm run balance` / `sweep`，复测三档通关率（目标区间见 `docs/BALANCE.md`），**重点验证独塔为王从「太垃圾、无优势」回到「一塔顶 7 塔」的可行区间**；若越线（太强秒全场，或仍太弱）则回调 7 塔大招的 N 值/倍率/常驻特性，并让 balance 脚本重写 `docs/BALANCE.md` 与 `docs/BALANCE_META.json` 口径一致。注意：独塔重做合法改变了 sim 行为，`check-sim-determinism` 的旧基线过期属预期，本任务**不** `--write` 复采（复采由 goal-driver 另立任务）。

## AC

- [x] `npm run balance` 复测三档通关率，记录独塔为王的专项通关率/余金
- [ ] 独塔为王回到目标区间；若偏离，回调 7 塔大招数值并重新复测达标
- [x] `docs/BALANCE.md` 由 balance 脚本重写，与代码数值一致
- [ ] `node --test tests/hex-one-tower.test.mjs tests/meta-balance-targets.test.mjs` exit 0

## DoD

- [ ] 数值回调（如有）落地于 `public/js/shared/hexes/one-tower.js`；`docs/BALANCE.md` 重写一致
- [ ] 不引入第三方依赖；不改 `sim.js` 的 RNG 调用顺序
- [ ] `npm test` 全绿；补跑 `node --test tests/hex-one-tower.test.mjs tests/meta-balance-targets.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/one-tower.js`
- `docs/BALANCE.md`
- `docs/BALANCE_META.json`
- `tests/hex-one-tower.test.mjs`
- `tasks/feat-one-tower-balance.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-3 草案数值（待 balance）。若 worker 实际 Touches 有出入（如 BALANCE_META.json、config），须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为平衡模拟与数值回调，无新文档面（BALANCE 为脚本重写产物），L_D/L_G/L_S 无需量化。

### 复测与回调记录（2026-11-03 worker）

**三档通关率**（`npm run balance:write`，40 种子全解锁机器人口径）：

| 端点 | 漫游(70–85%) | 远征(25–40%) | 深渊(5–12%) |
|---|---|---|---|
| 零 meta | 79.2% 达标 | 38.3% 达标 | **13.3% 高于目标** |
| 满 meta | 76.7% 达标 | 39.2% 达标 | **13.3% 高于目标** |

深渊 13.3% 为**先验偏移**：资源矿脉（feat-resource-vein-placement）抬升经济所致，该任务已按 5pp 容忍在 BALANCE.md 记录但未在 targetStatus/meta 测试落地容忍；本任务独塔改动对三档聚合几乎无影响（独塔种子仅约 1/10，且机器人对独塔只建弩塔 = 0%）。→ 需 manager 决策：放宽深渊目标 / 回调矿脉经济 / 接受漂移。

**独塔专项**（强制塔型 × one_tower，20 种子 × 满 meta，逐塔胜率）：

| 塔 | 漫游 | 远征 | 深渊 | 漫游均余金 |
|---|---|---|---|---|
| 电弧 | 90% | 35% | 5% | 8047 |
| 炮台 | 15% | 5% | 0% | 5357 |
| 弩 | 0% | 0% | 0% | 4025 |
| 霜 | 0% | 0% | 0% | 3399 |
| 毒 | 0% | 0% | 0% | 374 |
| 战旗 | 0% | 0% | 0% | 5035 |
| 震荡 | 0% | 0% | 0% | 3738（20/20 卡死） |
| 狙击 | 0% | 0% | 0% | 1731 |

**数值回调**（`public/js/shared/hexes/one-tower.js`）：

- 弱塔上调：弩 6→3 发贯穿 5×85% + 攻速/伤害/射程常驻；霜 6→5 发易伤 +60%；毒 6→4 发 +80% 毒伤、2.2 传播；战旗 5→4 发 6 目标齐射、自攻 45→90 / 1.1→1.3；狙击 4→3 发 300%+12% 处决、+40% 攻速；炮台余波半径 1.6→2.2、倍率 0.6→1.0；震荡溅射 ×2.0、+80% 伤害。
- 战旗「自攻」从 10 级前置到建造起（否则单塔战旗杀不了怪→攒不到钱→到不了 10 级；manager 裁定 #1）。
- 电弧收窄：连锁 +1→0、跳转 +0.6→+0.3（防 100% 漫游秒全场；manager 裁定 #3「不秒全场」）。

**值调无法解决的根因**（供 manager 决策）：

1. **覆盖极化**：22×12 图 × 单塔，只有电弧（连锁）与炮台（全图）有覆盖；弩贯穿跳转 0.8 格、震荡溅射、霜/毒单体、狙击处决低频——覆盖常数在 `projectile-system.js`/`towers.js`，不在本任务 Touches。manager 裁定 #2 把全图身份留炮台/狙击，其余塔「靠自身机制补覆盖」，但现有机制覆盖半径太小，独塔必然漏怪。
2. **机器人永远给独塔建弩塔**（`balance-bot.desiredType`：`total<2 → arrow`），聚合里独塔=弩塔=0%；真人选电弧才 90%——机器人口径的「假太垃圾」。
3. **震荡独塔卡死**（stuck=20/20）：击退让敌人被无限推离、既不漏也不死、波次不结束——CC 塔独塔无击杀能力的结构性矛盾。

**AC 判定**：AC1 ✓（三档+专项已复测记录）；AC2 ✗（独塔未整体回区间：电弧漫游 90% 仍超 85%，其余 7 塔 0%，值调无效、根因在覆盖）；AC3 ✓（BALANCE.md 与 BALANCE_META.json 已由脚本重写）；AC4 ✗（hex-one-tower 26 例全过；meta-balance-targets 深渊 13.3% 高于目标硬断言失败，先验矿脉漂移）。

## Blocker

**2026-11-03T12:15:38.512Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 2/8，剩余未勾 6）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：91a68b74-1993-4949-a6e2-69186267aea5

## Needs-Human

**2026-11-03 — worker 续做判定：剩余 AC 被两项外部决策阻塞，无法在本任务 Touches 内满足；升级 needs-human，交 manager 拍板（不再机械重派）。**

- **AC2（独塔未回目标区间，覆盖极化，值调无效）**：22×12 单塔图只有电弧（连锁）与炮台（全图）有覆盖；电弧漫游 90%（>85%），其余 7 塔 0%。覆盖常数在 `projectile-system.js`/`towers.js`（不在本任务 Touches），弱塔普遍上调与电弧收窄已尽力，但无法让非 AOE 塔单塔过关。**需决策**：接受「独塔为王仅电弧/炮台可行」并改写本 AC，或另立任务扩覆盖机制。
- **AC4（`meta-balance-targets.test.mjs` exit 1，深渊 13.3% 高于 [5%,12%]）**：该偏移为**先验**——`feat-resource-vein-placement`（done）落图后矿脉掉金抬升经济（其 Notes 已记深渊 9%→13%、+1pp、自认落在 5pp 容忍内），本任务独塔改动对三档聚合几乎无影响（机器人口径独塔≈弩塔=0%）。`docs/BALANCE_META.json` 经 `npm run balance:write` 重新生成为 13.3% 后硬断言 `status==='达标'` 失败；develop 的 `docs/BALANCE_META.json` 仍停在矿脉落图前的 9.17%（陈旧）。**需决策**：放宽深渊目标（`public/js/shared/config.js` 的 `BALANCE_TARGETS`）/ 回调矿脉金值（`feat-attackable-tiles` 冻结）/ 接受漂移并让 meta 测试落地 5pp 容忍（三选一）。
- **已完成且已勾**：AC1 ✓（三档+专项复测记录在 Notes）、AC3 ✓（`docs/BALANCE.md`/`BALANCE_META.json` 由脚本重写、与代码数值一致）。数值回调已落地 `public/js/shared/hexes/one-tower.js`（commit b672814），待决策后随本任务或拆分任务落地 develop。