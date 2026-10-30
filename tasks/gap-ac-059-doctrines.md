---
id: gap-ac-059-doctrines
title: 教义：五条塔专精通过首领核心选择且不可逆（AC-059）
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
goal_ac: AC-059
---
## Proposal

AC-059（教义：五条塔专精通过首领核心选择且不可逆）已由 goal-driver 激活，criterion 为 `grep -q 'doctrine' public/js/shared/data/relics.js`（expect exit 0），当前 exit 1：`relics.js` 无任何 `doctrine` 字样，也没有教义数据或按塔类型生效的行为层。origin（GOAL-011 退出条件 4）要求「对某一类塔的全部塔生效，不可逆」；冻结表 `docs/PHASE_ROGUE2.md` §6 冻结了五条教义（bolt/cannon/frost/arc/poison，映射弩塔/炮台/霜塔/电弧塔/毒雾塔）与字段契约（§6.2 效果表、§8.1 `doctrines.js` 导出 `DOCTRINE_IDS` + `applyDoctrine`、§8.2 `sim.rogue2.doctrines`、§8.3 `doctrine_chosen` 事件、§8.4 快照 v5）。本任务只做教义行为与表现：教义数据、`applyDoctrine` 对同塔类全部塔生效且不可逆、塔身徽记、弹道变体、HUD 图标与 i18n；不碰派系阈值/信物/契约/觉醒（AC-055/056/058/060 各自认领），首领核心的教义选项入口由 AC-057 提供。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-059` 认领（task_list + grep 已核）。同机制前任 `gap-doctrines`（goal_ac AC-037）已于 2026-10-27 被人在 Notes 撤销（superseded，等待重新设计），本任务把它重基到 GOAL-011 的 AC-059。与 `gap-ac-057-boss-core-choice`（ready，AC-057）的边界：核心三选一里教义条目的出现、波次门槛（第 10 波起）、每局上限 2、选择持久化引用都由该任务提供，本任务只消费其「可选中 + 持久化引用」并落地具体词条行为与表现；二者 Touches 在 relics.js/modals.js/i18n/run.js 重叠，调度器按 Touches 串行，保持独立（各自 goal_ac 与独立验收，不合并）。合并候选已跑 task-granularity-advice：peers 即同族 gap-ac-055/056/057/058 与 i18n-only 的 AC-050/051/063/064，均为独立机制、独立验收，不合并。冻结表由 `gap-ac-054-rogue2-design-rebase`（done，AC-054）产出；真前置（核心入口）走顶层 `depends_on` 字段，不在本段声明。

## Plan

1. 按 `docs/PHASE_ROGUE2.md` §6 在 `public/js/shared/data/relics.js` 新增教义数据：`DOCTRINE_IDS = ['bolt','cannon','frost','arc','poison']` 与五条教义定义（id/towerType/nameKey/effect/结算点，§6.2），数据结构带 `doctrine`，满足 AC-059 判据。
2. 新增 `public/js/shared/doctrines.js`：`DOCTRINE_IDS`（5 项）与 `applyDoctrine(state, doctrineId)`（返回 `{ state, event }`，写 `sim.rogue2.doctrines`、不可逆、不叠加；doctrineId→塔类型映射 bolt→弩塔 arrow / cannon→炮台 / frost→霜塔 / arc→电弧塔 / poison→毒雾塔）；纯函数、无 DOM、无 `Math.random`、不 import sim/render；§8.1 导出名逐符号对齐。
3. `public/js/sim/tower-system.js`：对同塔类全部塔（已建与后续新建）应用教义效果并处理塔属性缓存失效；与派系 `setMods` 同类键**加算**（§3.2 同键加算，如 arc 连锁 +1 与雷暴 T1 `chainExtra` 加算），不覆盖其他塔类。
4. 结算点接线：`public/js/sim/projectile-system.js` 落 bolt 穿透 1 目标（第 2 目标 60% 伤害）/cannon 落点 2s 燃烧（每秒 15% 攻击力）/arc 连锁 +1 与范围 +0.8 格；`public/js/sim/combat-system.js` 落 frost 对已减速目标 +25% 伤害；`public/js/sim/enemy-system.js` 落 poison 命中向 0.8 格内最多 2 敌人扩散 60% 毒伤（不叠层）；未选教义路径保持原 RNG 调用顺序与结果。
5. 表现：`public/js/render/tower-renderer.js` 塔身徽记、`public/js/render/projectile-renderer.js` 弹道变体；低配档只保留徽记、不新增每帧渐变（GOAL-006 约束）；`public/js/ui/hud.js` 只显示已选教义 1–2 个图标、不新增面板层级；`public/js/ui/modals.js` 教义条目文案；i18n 中英成对新增键。
6. 快照 v5：`public/js/app/run.js` 恢复 `sim.rogue2.doctrines`；旧档无 `doctrines` 按空处理、恢复幂等。
7. 新增 `tests/doctrines.test.mjs`：五条教义覆盖、同塔类全部塔生效、其他塔类不变、不可逆不叠加、每局上限 2、快照往返、未选教义同 seed 逐字节一致；并在 `scripts/test-changed.mjs` 的 TEST_MAP 登记该测试文件。

## AC

- [x] `grep -q 'doctrine' public/js/shared/data/relics.js` exit 0（AC-059 本体判据）
- [x] `node --test tests/doctrines.test.mjs` exit 0
- [x] `node --test tests/snapshot.test.mjs` exit 0
- [x] `grep -q 'doctrines' scripts/test-changed.mjs` exit 0（TEST_MAP 登记，审计覆盖不红）
- [x] `npm test` exit 0

## DoD

- [x] 通过首领核心选择一条教义后，该类塔的全部实例（已建与后续新建）都获得对应行为（穿透/燃烧/冰封/过载/疫病），其他塔类型不变
- [x] 塔身出现徽记、弹道形态有可见变化；低配档仍有徽记且不加额外每帧开销
- [x] 教义不可逆、不叠加，每局最多 2 条；快照恢复后仍生效；旧档无 `doctrines` 字段按空继续
- [x] 未选教义的同一 seed 与改动前逐字节一致，不触碰 `public/js/sim.js` 战斗 RNG 调用顺序

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/doctrines.js` (new)
- `public/js/sim/tower-system.js`
- `public/js/sim/combat-system.js`
- `public/js/sim/projectile-system.js`
- `public/js/sim/enemy-system.js`
- `public/js/render/tower-renderer.js`
- `public/js/render/projectile-renderer.js`
- `public/js/ui/hud.js`
- `public/js/ui/modals.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `public/js/app/run.js`
- `tests/doctrines.test.mjs` (new)
- `tests/sim-systems.test.mjs`
- `scripts/test-changed.mjs`
- `tasks/gap-ac-059-doctrines.md`
- `public/js/sim.js`
- `public/js/shared/snapshot.js`
- `public/js/app/combat.js`
- `public/js/sim/relic-system.js`

## Notes

教义通过首领核心选择、每局上限 2、不可逆，候选与选择持久化由 `gap-ac-057-boss-core-choice`（AC-057）提供，本任务只落地 `applyDoctrine` 行为与表现；教义抽取不新开种子流（核心候选沿用 `${seed}:core:${wave}`，§9.1），不触碰 `public/js/sim.js` 的战斗 RNG 调用顺序。与觉醒（AC-060）的边界：觉醒改单件遗物行为、教义改某一类塔的全部实例，两者可同时存在但不得互相覆盖效果键。与派系 setMods 的同类键加算（§3.2）：arc 教义连锁 +1 与雷暴 T1 `chainExtra` 加算，不得覆盖。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。

## Blocker

**2026-10-30T16:53:22.778Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 4/9，剩余未勾 5）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：936407bb-8fcd-4a67-9a92-20cf0754d7f0