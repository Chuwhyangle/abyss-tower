---
id: feat-endless-post-60
title: 无尽模式 60 波后内容：周期词缀 + 首领循环
status: todo
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

- [ ] 无尽模式 60 波后每 10 波追加词缀/首领循环，非单调 hpGrowth
- [ ] 确定性保持：无尽词缀 seed 派生，不改 sim.js RNG 顺序
- [ ] `npm test` 全绿；新增无尽 60+ 波测试覆盖
- [ ] `npm run balance` 复测不回归（若扫无尽则确认 60 波前不漂移）

## DoD

- [ ] 落地于 `waves.js` + 词缀/首领循环数据，零第三方依赖
- [ ] 不碰 30 波正常模式、爬塔、存档版本（或 presence-gate 隔离）
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/waves.js`
- `public/js/shared/data/` (词缀/首领循环数据，new)
- `tests/` (新增无尽测试)
- `scripts/test-changed.mjs`
- `tasks/feat-endless-post-60.md`

## Notes

立案 2026-11-06，源自 P0-5「无尽模式 60 波后内容」。设计细节（词缀池/首领循环/难度曲线）需先在实现中补 PHASE 增量或写 Notes，本任务提案只框定方向与红线。⚠️ 数值改动需 `npm run balance` 复测。