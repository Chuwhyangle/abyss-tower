---
id: feat-resource-vein-placement
title: 资源矿脉落图：把可攻击矿脉布点写进三张固定图（避开贴路建塔位）
status: todo
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

- [ ] 三张固定图各有固定矿脉布点（每图 2~4 个），不落路径、不占建塔位、不撞现有可破坏物
- [ ] 矿脉点位确定性（固定地图数据），掉落复用 `feat-attackable-tiles` 的 seed+波次派生
- [ ] `node --test tests/fixed-maps.test.mjs tests/mapgen.test.mjs` exit 0（含矿脉占格校验）

## DoD

- [ ] 落地于 `public/js/shared/maps/canyon.js`、`twin.js`、`ring.js`，不引入第三方依赖
- [ ] 回归测试覆盖矿脉占格校验、与建塔位/可破坏物不冲突
- [ ] `npm test` 全绿；`npm run balance` 复测金币曲线无偏移
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/maps/canyon.js`
- `public/js/shared/maps/twin.js`
- `public/js/shared/maps/ring.js`
- `tests/fixed-maps.test.mjs`
- `tasks/feat-resource-vein-placement.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-10 落图尾巴。依赖 `feat-attackable-tiles`（done）的机制。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为地图数据布点，无新文档面，L_D/L_G/L_S 无需量化。
