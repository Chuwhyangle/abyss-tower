---
id: gap-map-difficulty-spread-compensation
title: 逐图难度补偿：三张固定图通关率收敛（难图加奖励或降难度）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-balance-bot-boss-counter
---
## Proposal

固定三图难度分布太宽：单径峡谷 98% vs 双径汇流 18%，同难度下体感差 5 倍。人已裁定：难图要么**认定为难图并加奖励**（调 scoreMul）、要么**降低难度**（加 per-map hpMul），或两者各做一部分。目标是把三图逐图通关率收敛到合理区间，同时三档整体不越线。

<!-- dedup-ref --> 依赖 `gap-balance-bot-boss-counter`（口径对齐 + 三档校准）先行；本任务在其落地后的新口径上做逐图补偿并复测。

## Plan

1. 给三张固定图（canyon/twin/ring）加 per-map `hpMul`（难度补偿）：难图（twin/ring）降 HP、易图（canyon）不降或微升，收敛逐图通关率。
2. 或/并调 `scoreMul`（奖励补偿）：难图加分，让「难图高风险高回报」。
3. `node tests/balance-sim.mjs 40` 逐图口径看三图通关率是否收敛（极差明显缩小）。
4. 复跑三档确认仍落带（漫游 70–85 / 远征 25–40 / 深渊 5–12），`--write` 重写 docs/BALANCE.md。

## AC

- [x] 逐图通关率极差缩小（难图与易图差距不再 >3 倍）
- [x] `! grep -qE '^[|] (漫游|远征|深渊) [|].*[|] (低于目标|高于目标) [|]' docs/BALANCE.md` exit 0
- [x] `npm test` exit 0

## DoD

- [x] 三张固定图逐图通关率收敛（差距 ≤3 倍），难图有对应奖励（scoreMul）或降难度（hpMul）补偿
- [x] 三档整体通关率仍在目标区间，docs/BALANCE.md 由同一轮 40 种子生成

## Touches

- `docs/BALANCE.md`
- `public/js/shared/maps/canyon.js`
- `public/js/shared/maps/rasterize.js`
- `public/js/shared/maps/ring.js`
- `public/js/shared/maps/twin.js`
- `public/js/shared/waves.js`
- `public/js/sim/snapshot-mapper.js`
- `public/js/sim/wave-director.js`
- `server/services/run-service.mjs`
- `tests/balance-sim.mjs`
- `tests/lib/balance-report.mjs`
- `tasks/gap-map-difficulty-spread-compensation.md`

## Notes

- per-map `hpMul`（敌人生命补偿，spec → rasterize.buildFixedMap 的 roundHpMul 收敛到 [0.8,1.2] → map.meta → generateWave → 敌人/首领 hpMul）：裂谷关隘（易图，单路 39 格）1.2 上调；双牙桥（难图，固定 trait TRADE 生命 1.08）0.9 下调；环心遗迹（难图，固定 trait ECHO 速度 1.06）0.95 下调。
- 三档倍率 / 波次生成 / BALANCE_TARGETS 口径未动，仅叠加 per-map `hpMul`。
- `hpMul` 透传补齐三处重建 wave 元数据的调用点：wave-director.currentWaveHpMul（整备期虫巢拆除按下一波强度）、snapshot-mapper.nextWavePreview（含缓存 key）、run-service.serveWave（服务端真实开波）。
- 40 种子复测（docs/BALANCE.md 同轮生成）：漫游 77% / 远征 30% / 深渊 9%，全部落带。
- 逐图通关率极差（全解锁 · 固定地图）：漫游 75/78/78 → 1.04 倍，远征 35/25/30 → 1.40 倍，深渊 13/8/8 → 1.63 倍，均 ≤3 倍。
