---
id: feat-attackable-tiles
title: 可攻击资源地块：塔在空手时攻击地块、破坏后掉落物品（地图交互）
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/destructibles-sim.test.mjs tests/destructibles.test.mjs
---
## Proposal

地图交互太少（用户原话「地图交互还是太少了，可以加一点可以让塔攻击去获得物品或者什么的地图块」）。现状可破坏物只能「花金币手动拆除」（金脉/石碑/补给箱/虫巢/图腾，`public/js/shared/destructibles.js` + `public/js/sim/destructible-system.js`）。本任务新增「可被塔攻击的资源地块」：地块有 HP，**塔在射程内无敌人可打时自动索敌攻击它（敌人永远优先）**，打掉后掉落金币/小物品；现有商店购买与手动拆除保留。复用 destructible 占格框架，把「花金币拆除」扩展出「塔攻击掉血」的第二路径。设计要点：① 新增地块类型「资源矿脉」（确定性掉落金币，金额由 seed+波次派生）；② `tower-system.js` 的索敌加一条「空手时找射程内最近可攻击地块」的低优先级分支（不改敌人索敌的 RNG/顺序）；③ 地块掉落不进 RNG、不改 sim 确定性。

## AC

- [x] 新增「资源矿脉」地块类型（有 HP），塔在无敌人时自动攻击、破坏后掉落金币
- [x] 敌人永远优先于地块（有敌人可打时不打地块）
- [x] 掉落确定性（seed+波次派生），不消耗 RNG、不改 sim 确定性
- [x] `node --test tests/destructibles-sim.test.mjs tests/destructibles.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/shared/destructibles.js`、`public/js/sim/destructible-system.js`、`public/js/sim/tower-system.js`，不引入第三方依赖
- [x] 回归测试覆盖地块 HP/攻击/掉落/敌人优先/确定性
- [x] `npm test` 全绿；补跑 `node --test tests/destructibles-sim.test.mjs tests/destructibles.test.mjs tests/combat.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/destructibles.js`
- `public/js/sim/destructible-system.js`
- `public/js/sim/tower-system.js`
- `public/js/sim/wave-director.js`
- `tests/destructibles-sim.test.mjs`
- `tasks/feat-attackable-tiles.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-10。掉落内容/金额为草案（金币为主，物品可后续扩展）；地块与贴路建塔位（已落地）可能占同一格，落图时须避开。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为地图交互机制，无新文档面，L_D/L_G/L_S 无需量化。

实现增量（2026-11-03）：① 资源矿脉不并入 `DESTRUCTIBLE_TYPES` 五类注册表，单独 `RESOURCE_VEIN_TYPE` + `ATTACKABLE_BY_ID`，避免波及按五类遍历的既有 UI/精灵/文案测试；复用同一占格/拆除框架（`createDestructibleEntries` 统一出运行时条目，`destructibleTypeOf` 回退到可攻击注册表）。② 实际 Touches 新增 `public/js/sim/wave-director.js`：开波时回满存活矿脉血量（血量是波内瞬态、不落盘，回满保证内存残血与刷新后一致）。③ 落图（把矿脉布点写进地图）是后续任务，本任务只交付机制 + 运行时条目 + 回归测试。④ `public/js/sim.js` 未改动：跨系统调用走 `this.sim.destructibleSystem.*` 直连，避免 EXPORT_SURFACE 与结构预算债务。