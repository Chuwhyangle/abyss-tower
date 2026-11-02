---
id: gap-balance-hpgrowth-retune
title: 平衡重调：降 hpGrowth 使三档通关率回目标区间（AC-052/061/065 共根因）
status: ready
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

- [ ] `! grep -qE '低于目标|高于目标' docs/BALANCE.md` exit 0（三档落带、无越线）
- [ ] `npm test` exit 0

## DoD

- [ ] `docs/BALANCE.md` 由 40 种子复跑重写，三档通关率各自落进 70–85 / 25–40 / 5–12，且「固定三图」口径下无「低于目标/高于目标」
- [ ] 只改了 `config.js`（hpGrowth，必要时 `difficulties.js` hpMul），未动地图几何、波次结构、塔/敌人本体数值

## Touches

- `public/js/shared/config.js`
- `public/js/shared/data/difficulties.js`
- `docs/BALANCE.md`
- `tasks/gap-balance-hpgrowth-retune.md`
