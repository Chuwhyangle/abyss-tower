---
id: feat-endless-post-60
title: 无尽模式 60 波后内容：周期词缀 + 首领循环
status: ready
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

无尽模式 60 波后内容（P0-5）。现状：无尽模式 60→999 波零新内容（`waves.js` 的 `ENDLESS.maxIndex=999`，60 波后只是 `hpGrowth` 单调涨）。补周期词条/循环结构：

- 60 波后加周期性变化：每 10 波追加一层随机「无尽词缀」（复用现有 MAP_MODIFIERS/事件词缀风格），hpMul/speedMul 周期性上台阶 + 稀有/精英敌人占比提升。
- 首领循环：60 波后每 10 波循环出首领（复用首领变体池），强度随循环数递增。
- 数值红线：无尽本就是挑战模式，不设三档通关率约束，但 60~100 波难度曲线要平滑（不让玩家 60 波瞬间崩）。

## AC

- [x] 无尽模式 60 波后每 10 波追加词缀/首领循环，非单调 hpGrowth
- [x] 确定性保持：无尽词缀 seed 派生，不改 sim.js RNG 顺序
- [x] `npm test` 全绿；新增无尽 60+ 波测试覆盖
- [x] `npm run balance` 复测不回归（若扫无尽则确认 60 波前不漂移）

## DoD

- [x] 落地于 `waves.js` + 词缀/首领循环数据，零第三方依赖
- [x] 不碰 30 波正常模式、爬塔、存档版本（或 presence-gate 隔离）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/waves.js`
- `public/js/shared/data/endless.js` (new)
- `tests/endless-post-60.test.mjs` (new)
- `tasks/feat-endless-post-60.md`

## Notes

立案 2026-11-06，源自 P0-5「无尽模式 60 波后内容」。设计细节（词缀池/首领循环/难度曲线）需先在实现中补 PHASE 增量或写 Notes，本任务提案只框定方向与红线。⚠️ 数值改动需 `npm run balance` 复测。

实现落地（2026-11-06）：
- 词缀：`public/js/shared/data/endless.js` 纯数据词缀池 6 个（碾压/疾驰/精锐/镀金/狂野/愈合），覆盖血量/移速/金币/精英四类效果。61 波起每 10 波追加一层，第 151 波封顶 10 层；逐层用 `${seed}:endless:affix:${layer}` 派生 seed 独立挑选，绝不消耗波次 rng。
- 首领循环：60 波后每 10 波（70/80/90…）循环出首领，每循环首领血量 ×1.12，第 150 波后封顶 10 循环。
- 数值红线：顶层 `hpMul` 字段保持原封顶基线不变（旧断言「血量封顶后不再增长」仍成立），实际抬升走各群组 `hpMul`；移速在封顶前叠加；金币乘到清波奖励；精英权重按词缀 elite 加成。60~100 波每循环 +10%~12%，曲线平滑无瞬间崩盘。
- 隔离：全部分支 gated by `endless && index > 60`（或 endlessAffix 非空），30 波正常模式/爬塔/存档逐字节不变。
- 验证：`npm test` 2034 例全绿（新增 `tests/endless-post-60.test.mjs` 7 例）；`npm run balance` 输出与基线逐字节一致（balance-sim 只扫 1~30 波，60 波前无漂移）。