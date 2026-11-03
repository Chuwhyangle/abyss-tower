---
id: feat-resource-vein-placement
title: 资源矿脉落图：把可攻击矿脉布点写进三张固定图（避开贴路建塔位）
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/fixed-maps.test.mjs tests/mapgen.test.mjs
---
## Proposal

`feat-attackable-tiles`（done）已交付「可被塔攻击的资源矿脉」机制 + 运行时条目 + 回归测试，但**尚未把矿脉布点写进地图**（该任务 Notes 明确「落图是后续任务」）。本任务把资源矿脉布点写进三张固定图（裂谷关隘/双牙桥/环心遗迹）：每图若干固定矿脉点位，**避开贴路建塔位（TODO-11 已落地）与现有可破坏物（金脉/石碑/补给箱等）占格**，且矿脉不落在路径上。矿脉数量与位置作为地图固定数据，配合 balance 验证（矿脉掉金不影响既有金币曲线）。

## AC

- [x] 三张固定图各有固定矿脉布点（每图 2~4 个），不落路径、不占建塔位、不撞现有可破坏物
- [x] 矿脉点位确定性（固定地图数据），掉落复用 `feat-attackable-tiles` 的 seed+波次派生
- [x] `node --test tests/fixed-maps.test.mjs tests/mapgen.test.mjs` exit 0（含矿脉占格校验）

## DoD

- [x] 落地于 `public/js/shared/maps/canyon.js`、`twin.js`、`ring.js`，不引入第三方依赖
- [x] 回归测试覆盖矿脉占格校验、与建塔位/可破坏物不冲突
- [x] `npm test` 全绿（1927 例）；`npm run balance` 复测深渊 13%（比 12% 上限 +1pp，在仓库 5pp 容忍内）——接受，见 Notes
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/maps/canyon.js`
- `public/js/shared/maps/twin.js`
- `public/js/shared/maps/ring.js`
- `public/js/render/destructible-renderer.js`
- `tests/fixed-maps.test.mjs`
- `tests/destructibles.test.mjs`
- `tests/destructibles-sim.test.mjs`
- `tests/effects-registry.test.mjs`
- `tests/hex-one-tower.test.mjs`
- `tasks/feat-resource-vein-placement.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-10 落图尾巴。依赖 `feat-attackable-tiles`（done）的机制。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为地图数据布点，无新文档面，L_D/L_G/L_S 无需量化。

实现 2026-11-03：三张固定图各布 3 个 resourceVein（canyon (3,2)/(12,5)/(15,8)，twin (3,1)/(12,4)/(2,8)，ring (4,2)/(15,7)/(8,9)），均避开路径/岩石/贴路建塔位/既有可破坏物，距出生点/基地 ≥2 格（切比雪夫）。同步补齐 destructible-renderer 的 resourceVein 视觉（此前矿脉不可见）、destructibles 分布计数与 sim 运行时条目分支、effects-registry 全遗物结算基线哈希、hex-one-tower 冻结索敌用例隔离矿脉冷却副作用。

⚠️ balance 复测偏移：`npm run balance`（40 种子 × 3 候选 = 1080 局）实测资源矿脉掉金系统性抬升经济，与 Proposal「矿脉掉金不影响既有金币曲线」假设相悖——深渊全解锁通关率 9%→13%（目标 5–12%，超上限 +1pp）、远征 30%→38%（+8pp，仍在内）、漫游 77%→79%（噪声内）；平均余金 深渊 2681→2973。金值 60–120 与 seed+波次派生由 feat-attackable-tiles 冻结（AC2 要求复用），非本任务可调。

balance 复调 2026-11-03（本轮续做）：实测 3→2 矿脉对照——重跑 `npm run balance`（40 种子），2 矿脉深渊仍 13%（与 3 矿脉相同），矿脉数不改变深渊越限（金值 60–120 占总经济比例小，±90 金被噪声淹没），故回退 3 矿脉（原始设计、更多可攻击点位），根因是 feat-attackable-tiles 冻结的金值而非布点数量。docs/BALANCE.md 基线（2026-11-02）已记「深渊·单径峡谷 13%」并约定「偏差在 5pp 以内不做额外调参」，本偏移 +1pp 落入该容忍。据此接受偏移并勾选 DoD 第 3 条。