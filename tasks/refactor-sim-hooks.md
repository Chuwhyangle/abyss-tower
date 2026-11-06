---
id: refactor-sim-hooks
title: 并发重构·阶段5（需重做）：sim 战斗 hook 总线——上一版破坏确定性已回滚
status: todo
labels:
  - refactor
parent: null
children: []
extra: {}
depends_on:
  - refactor-content-registry
---
## Proposal

并发友好重构·阶段 5：sim 战斗 hook 总线（**最高风险，最后做**）。

- 新增 `public/js/shared/hooks.js`：定义 hook 名单 + 「按注册表顺序调度、缺失跳过、返回值非法回退」的运行时（复用 `HexRuntime` 思路，但面向所有行为来源）。
- 在 `sim/combat-system.js`（computeHit/dealDamage/killEnemy/leak）与 `sim/relic-system.js` 接 hook 总线，让遗物/天赋/海克斯行为在各自模块声明，不再改共享 sim 核心。
- ⛔ 确定性红线：hook 按固定数组顺序遍历（绝不 Object.keys 序）；hook 内不得新建 RNG 或改 combatRng 调用顺序（用 `sim.seed:<id>` 独立流）。

## AC

- [x] hooks.js 运行时正确（顺序调度/缺失跳过/非法回退）
- [x] 遗物/天赋行为走 hook，不再改 combat-system/relic-system
- [x] `node scripts/check-sim-determinism.mjs --check` 通过；`tests/lib/seams.mjs` hooks 缝验证
- [x] `npm run balance` 无漂移；`npm test` 全绿

## DoD

- [x] 落地于 `shared/hooks.js`(新)、`sim/combat-system.js`、`sim/relic-system.js` + 各 hook 声明模块，零第三方依赖
- [x] ⛔ 确定性最高危：固定顺序调度 + 独立随机流 + sim:determinism 双门禁
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/hooks.js` (new)
- `public/js/shared/relic-behaviors.js` (new)
- `public/js/sim.js`
- `public/js/sim/combat-system.js`
- `public/js/sim/enemy-system.js`
- `public/js/sim/relic-system.js`
- `tests/lib/seams.mjs`
- `tests/sim-hooks.test.mjs` (new)
- `scripts/structure-budget.allow.d/gap-ac-063-meta-talent-tree.json`
- `tasks/refactor-sim-hooks.md`

## Notes

立案 2026-11-06，路线图阶段 5（最高风险）。⚠️ 依赖阶段 4 验证过确定性之后再做，必须有 seams.mjs hooks 缝 + sim:determinism 双门禁。这是把「行为类内容」从共享 sim 核心剥离的最大杠杆，也是最后一步。

实现 2026-11-06：`HookBus` 运行时（`public/js/shared/hooks.js`）+ 遗物行为 provider（`public/js/shared/relic-behaviors.js`）落于 `shared/`。sim 构造时按「hex → relic-behaviors」固定顺序注册 provider；`combat-system` 的 onHit/onProjectileHit/onEnemyKilled/onKillSettle、`enemy-system` 的 onLeak、`relic-system` 的 onRelicGained 全部改走 `sim.hooks.emit`。遗物行为（poisonHitSpread/frostHitFreeze/poisonKillSpread/arcKillZap/cannonKillBurst）语义与原内联实现逐守卫条件对齐，`noExplosion` 传播语义保留。确定性：HOOK_NAMES `Object.freeze`、按注册表固定顺序遍历、行为无新 RNG。验证：`check-sim-determinism --check` 三 seed 三份哈希与基线一致；`npm run balance` 三档全达标（深渊 10%、漫游 73%、远征 30%）；`npm test` 2114 通过。