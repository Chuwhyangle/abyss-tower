---
id: feat-relic-behaviors
title: 遗物升级行为词条：Ⅱ/Ⅲ 级解锁机制（非纯数值）
status: ready
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

- [x] 至少 N 件遗物（≥6）有 Ⅱ/Ⅲ 级行为词条，Ⅲ 级必给机制（非纯数值）
- [x] 词条在 sim 层生效、确定性保持（seed 派生，不改 RNG 顺序）
- [x] 存档兼容：旧档遗物等级不变，行为词条按等级补挂
- [x] `npm test` 全绿；遗物行为词条有测试覆盖

## DoD

- [x] 落地于 `relics.js` + `sim` 消费，零第三方依赖
- [x] 不碰遗物基础数值（只加等级行为词条）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/data/relics.js`
- `public/js/sim/relic-system.js`
- `public/js/sim/combat-system.js`
- `public/js/sim/projectile-system.js`
- `tests/data-split.test.mjs`
- `tests/relics-behaviors.test.mjs`
- `tasks/feat-relic-behaviors.md`

## Notes

立案 2026-11-06，源自 P1-9「遗物升级行为词条」。⚠️ 改 sim 层须守住确定性（RNG 调用顺序不能变）。数值改动需 balance 复测。

实现增量（设计落 Notes，不入 PRD/TECH_DESIGN）：
- 8 件遗物新增 `behaviors` 字段：frostglint(Ⅲ frostHitFreeze)、venomfang(Ⅱ poisonHitSpread / Ⅲ poisonKillSpread)、sparkplug(Ⅲ arcKillZap)、steadyaim(Ⅲ arrowShotPierce)、frostedge(Ⅱ frostHitFreeze)、venomvial(Ⅲ poisonHitSpread)、static(Ⅱ arcKillZap)、siege(Ⅲ cannonKillBurst)。
- 6 种机制 kind（全部非纯数值）：poisonHitSpread / frostHitFreeze / poisonKillSpread / arcKillZap / cannonKillBurst / arrowShotPierce。
- `relicBehaviorsAtLevel` 纯函数按等级累积 Ⅱ+Ⅲ（Ⅱ 级词条在 Ⅲ 级仍生效）；RelicSystem.recomputeMods 派生 `sim.relicBehaviors`（纯派生、不进快照），combat/projectile 结算点按 kind+towerType 消费。
- 确定性：计数器挂塔（arrowShotPierce）/挂敌人（frostHitFreeze），击杀传播走既有 poisonHop 单槽语义，均不消耗 combatRng、不改 RNG 调用顺序。
- 存档兼容：快照 relics 仍只写 {id, level}，行为词条按等级补挂，旧档等级不变。
- 基础数值未动（只加 behaviors 字段），零第三方依赖。

## Blocker

**2026-11-05T20:22:12.890Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'main' — 'develop' (1881c60f) is NOT a continuation of the project's default branch 'main' (b43bc44b) — it is 2 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task feat-relic-behaviors's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'main'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：02c84578-4627-42fe-b9f1-56b7e36ef744
