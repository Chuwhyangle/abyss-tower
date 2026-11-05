---
id: feat-relic-behaviors
title: 遗物升级行为词条：Ⅱ/Ⅲ 级解锁机制（非纯数值）
status: todo
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

遗物升级行为词条（P1-9）。现状：遗物升级纯 ×1/1.6/2.2 数值放大。改每级解锁行为词条（Ⅲ 级必给机制）——玩法深度，非平衡。

- 复用遗物已有的「重复=升 Ⅰ/Ⅱ/Ⅲ」机制（`relics.js` normalizeRelicState），为部分遗物加「Ⅱ/Ⅲ 级解锁的行为词条」（如 Ⅲ 级毒雾塔遗物解锁「毒雾蔓延」等机制级效果）。
- 词条数据驱动：`relics.js` 每遗物加 `behaviors: {Ⅱ:[], Ⅲ:[]}`，sim 层按等级消费。

## AC

- [ ] 至少 N 件遗物（≥6）有 Ⅱ/Ⅲ 级行为词条，Ⅲ 级必给机制（非纯数值）
- [ ] 词条在 sim 层生效、确定性保持（seed 派生，不改 RNG 顺序）
- [ ] 存档兼容：旧档遗物等级不变，行为词条按等级补挂
- [ ] `npm test` 全绿；遗物行为词条有测试覆盖

## DoD

- [ ] 落地于 `relics.js` + `sim` 消费，零第三方依赖
- [ ] 不碰遗物基础数值（只加等级行为词条）
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/data/relics.js`
- `public/js/sim.js` (或 sim 子模块消费)
- `tests/` (遗物行为词条测试)
- `scripts/test-changed.mjs`
- `tasks/feat-relic-behaviors.md`

## Notes

立案 2026-11-06，源自 P1-9「遗物升级行为词条」。⚠️ 改 sim 层须守住确定性（RNG 调用顺序不能变）。数值改动需 balance 复测。设计细节（哪 6+ 件遗物、各自 Ⅲ 级词条）需在实现中补 Notes 或 PHASE 增量。