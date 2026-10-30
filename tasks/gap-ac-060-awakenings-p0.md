---
id: gap-ac-060-awakenings-p0
title: 觉醒 P0：四条三级遗物行为词条（AC-060）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-054-rogue2-design-rebase
  - gap-ac-057-boss-core-choice
goal_ac: AC-060
---
## Proposal

AC-060（觉醒 P0：四条三级遗物行为词条）已由 goal-driver 激活，criterion 为 `grep -q 'awaken' public/js/shared/data/relics.js`（expect exit 0），当前 exit 1：`relics.js` 无任何 `awaken` 字样，也没有觉醒数据或行为钩子。origin（GOAL-011 退出条件 4）要求「任选 1 件 Ⅲ 级遗物获得行为词条、不消耗原遗物、第 10 波起可出、每件最多 1 条」。冻结表 `docs/PHASE_ROGUE2.md` §7 冻结了 P0 四条觉醒（sharp-pierce/powder-ignite/frostheart-shatter/toxin-spread）与字段契约（§7.2 效果表、§8.1 `awakenings.js` 导出 `AWAKENING_IDS` + `awakeningFor` + `applyAwakening`、§8.2 `sim.rogue2.awakenings`、§8.3 `awakening_gained` 事件、§8.4 快照 v5）。本任务只做四条觉醒行为与最小表现；不碰派系阈值/信物/首领核心/契约/教义（AC-055/056/057/058/059 各自认领），首领核心的觉醒选项入口由 AC-057 提供。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-060` 认领（task_list + grep 已核）。同机制前任 `gap-awakenings-p0`（goal_ac AC-038）已于 2026-10-27 被人在 Notes 撤销（superseded，等待重新设计），本任务把它重基到 GOAL-011 的 AC-060。与 `gap-ac-057-boss-core-choice`（ready，AC-057）的边界：核心三选一里觉醒条目的出现、波次门槛（第 10 波起）、「已拥有 Ⅲ 级遗物才可觉醒」、同一遗物不重复、选择持久化引用都由该任务提供，本任务只消费其「可选中 + 持久化引用」并落地具体词条行为与表现；二者 Touches 在 relics.js/i18n/run.js 重叠，调度器按 Touches 串行，保持独立（各自 goal_ac 与独立验收，不合并）。与 `gap-ac-059-doctrines`（todo，AC-059）的边界：觉醒改单件遗物行为、教义改某一类塔的全部实例，两者可同时存在但不得互相覆盖效果键。合并候选已跑 task-granularity-advice：peers 即同族 gap-ac-050/051/052/055/056/057/058/059/063/064，均为独立机制、独立验收，不合并。冻结表由 `gap-ac-054-rogue2-design-rebase`（done，AC-054）产出；真前置（核心入口）走顶层 `depends_on` 字段，不在本段声明。

## Plan

1. 按 `docs/PHASE_ROGUE2.md` §7 在 `public/js/shared/data/relics.js` 新增觉醒数据：`AWAKENING_IDS = ['sharp-pierce','powder-ignite','frostheart-shatter','toxin-spread']` 与四条觉醒定义（id/relicId/nameKey/effect/触发条件，§7.2），数据结构带 `awaken`（满足 AC-060 判据）。
2. 新增 `public/js/shared/awakenings.js`：`AWAKENING_IDS`（4 项）、`awakeningFor(relicId)`（→ 定义 | null）、`applyAwakening(state, relicId)`（返回 `{ state, event }`，写 `sim.rogue2.awakenings`、同一遗物不重复、不消耗原遗物）；纯函数、无 DOM、无 `Math.random`、不 import sim/render；§8.1 导出名逐符号对齐。
3. 结算点接线：`public/js/sim/projectile-system.js` 落 sharp-pierce（弩塔每第 6 发穿透 2 个目标、穿透目标承受 60% 伤害）与 powder-ignite（炮台命中同一目标 5 次后落点燃烧 2s、每秒 20% 攻击力）；`public/js/sim/enemy-system.js` 落 frostheart-shatter（被减速目标死亡时 1.2 格霜爆冻结 0.4s）与 toxin-spread（中毒死亡传播 1 层、最多 3 跳、不叠层）；未觉醒路径保持原 RNG 调用顺序与结果。
4. 表现：`public/js/render/effect-renderer.js` 霜爆与中毒传播的最小特效，遵守既有粒子预算与画质档、不新增每帧渐变（GOAL-006 约束）；`public/js/shared/i18n/zh-CN.js` / `en-US.js` 中英成对新增键。
5. 快照 v5：`public/js/app/run.js` 恢复 `sim.rogue2.awakenings`；旧档无 `awakenings` 按空处理、恢复幂等。
6. 新增 `tests/awakenings.test.mjs`：四条触发/不触发、只对绑定遗物生效、同一遗物不重复觉醒、未觉醒同 seed 逐字节一致、快照往返、首领核心候选门槛；并在 `scripts/test-changed.mjs` 的 TEST_MAP 登记该测试文件。

## AC

- [ ] `grep -q 'awaken' public/js/shared/data/relics.js` exit 0（AC-060 本体判据）
- [ ] `node --test tests/awakenings.test.mjs` exit 0
- [ ] `node --test tests/sim-systems.test.mjs tests/impact-events.test.mjs` exit 0
- [ ] `node --test tests/snapshot.test.mjs` exit 0
- [ ] `grep -q 'awakenings' scripts/test-changed.mjs` exit 0（TEST_MAP 登记，审计覆盖不红）
- [ ] `npm test` exit 0

## DoD

- [ ] 四条觉醒在确定性模拟里各自产生可观察的行为差异（穿透目标数 / 燃烧窗口 / 霜爆冻结 / 中毒传播跳数）
- [ ] 未觉醒的同一 seed 与改动前逐字节一致，不触碰 `public/js/sim.js` 战斗 RNG 调用顺序
- [ ] 觉醒只作用于绑定的 Ⅲ 级遗物，不改变遗物本身等级；同一遗物不重复觉醒
- [ ] 觉醒条目只在第 10 波起、存在已拥有 Ⅲ 级遗物时出现（入口由 AC-057 提供）；快照恢复后仍生效、旧档无 `awakenings` 字段按空继续

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/awakenings.js` (new)
- `public/js/sim/projectile-system.js`
- `public/js/sim/enemy-system.js`
- `public/js/render/effect-renderer.js`
- `public/js/app/run.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/awakenings.test.mjs` (new)
- `scripts/test-changed.mjs`
- `tasks/gap-ac-060-awakenings-p0.md`

## Notes

觉醒通过首领核心选择、第 10 波起、每件遗物最多 1 条、不消耗原遗物，候选与选择持久化由 `gap-ac-057-boss-core-choice`（AC-057）提供，本任务只落地 `applyAwakening` 行为与表现；觉醒抽取不新开种子流（核心候选沿用 `${seed}:core:${wave}`，§9.1），不触碰 `public/js/sim.js` 的战斗 RNG 调用顺序。与教义（AC-059）的边界：觉醒改单件遗物行为、教义改某一类塔的全部实例，两者可同时存在但不得互相覆盖效果键。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。