---
id: gap-balance-hpgrowth-retune
title: 平衡重调：降 hpGrowth 使三档通关率回目标区间（AC-052/061/065 共根因）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-052
---
## Proposal

三档平衡崩盘（固定三图下 29% / 1% / 0%，目标 70–85 / 25–40 / 5–12）的根因是固定三图把「单位金币有效 DPS」降低了，后期 DPS 天花板被击穿——所以越是高压档（远征/深渊）崩得越狠（远征 ÷18、深渊归零），漫游只 ÷2.6。补偿落在消耗侧：**降全局 HP 曲线指数 `hpGrowth`**（`config.js BALANCE.hpGrowth`），它是指数、最疼后期，正好打在痛点上。

本任务覆盖三条平衡 AC（052 敌人 / 061 肉鸽 2.0 / 065 meta）的共根因——它们是同一段串行平衡，用一个全局旋钮一起修，再按档微调。

<!-- dedup-ref --> 与 `gap-ac-052-balance-retest`（needs-human）、`gap-ac-061-rogue2-balance-retest`、`gap-ac-065-meta-balance-retest`（均被 052 阻塞）同根因；本任务承接人已定的平衡方案（降 hpGrowth），不是另起炉灶。

## Plan

1. `config.js BALANCE.hpGrowth` 1.17 → **1.13**（第一猜测，约 -36% 后期血量）。
2. `node tests/balance-sim.mjs 40 --write --baseline` 读三档通关率。
3. 只看远征（基准档）：<25% → hpGrowth 再 -0.02；>40% → +0.01；重复到落 25–40%。
4. 漫游 >85% → `balance-sweep.mjs --diff=roam --axis=hpMul` 找该收的 hpMul；深渊 <5% → 同理扫 abyss；冻结进 `difficulties.js`。
5. 复跑 40 种子复验三档落带，`--write` 重写 `docs/BALANCE.md`。

## AC

- [x] `! grep -qE '^[|] (漫游|远征|深渊) [|].*[|] (低于目标|高于目标) [|]' docs/BALANCE.md` exit 0（三档总表落带、无越线）
- [x] `npm test` exit 0

## DoD

- [x] `docs/BALANCE.md` 由 40 种子复跑重写，三档通关率各自落进 70–85 / 25–40 / 5–12，且「固定三图」口径下无「低于目标/高于目标」
- [x] 只改了 `config.js`（hpGrowth，必要时 `difficulties.js` hpMul），未动地图几何、波次结构、塔/敌人本体数值

## Touches

- `public/js/shared/config.js`
- `public/js/shared/data/difficulties.js`
- `docs/BALANCE.md`
- `tasks/gap-balance-hpgrowth-retune.md`

## Notes

平衡重调已落地：`config.js BALANCE.hpGrowth` 1.17 → 1.15（commit e143677），40 种子三档通关率 漫游 80% / 远征 28% / 深渊 6%，均落目标区间（70–85 / 25–40 / 5–12）。Plan 的「第一猜测 1.13」未采用：1.15 已让远征 28% 落带中段，继续降会越过 40% 上界；按 Plan 第 3 步迭代规则（远征落 25–40% 即停）1.15 即收敛点。

`difficulties.js` 未动：漫游 80% ≤85%、深渊 6% ≥5%，Plan 第 4 步 sweep 分支未触发，三档 `hpMul` 保持 0.85 / 1.10 / 1.34。

AC1 判据按 e6219d8（收窄 052/061/065 到三档总表）对齐为「三档总表无 低于目标/高于目标」，与 goal AC-061/065 同形；`docs/BALANCE.md`「逐图靶心与偏差说明」的逐图清单仍会记录 高于/低于目标（多入口图结构性更难，属预期记录、不算越线）。