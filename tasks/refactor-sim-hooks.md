---
id: refactor-sim-hooks
title: 并发重构·阶段5：sim 战斗 hook 总线（最高风险）
status: ready
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

- [ ] hooks.js 运行时正确（顺序调度/缺失跳过/非法回退）
- [ ] 遗物/天赋行为走 hook，不再改 combat-system/relic-system
- [ ] `node scripts/check-sim-determinism.mjs --check` 通过；`tests/lib/seams.mjs` hooks 缝验证
- [ ] `npm run balance` 无漂移；`npm test` 全绿

## DoD

- [ ] 落地于 `shared/hooks.js`(新)、`sim/combat-system.js`、`sim/relic-system.js` + 各 hook 声明模块，零第三方依赖
- [ ] ⛔ 确定性最高危：固定顺序调度 + 独立随机流 + sim:determinism 双门禁
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/hooks.js` (new)
- `public/js/sim/combat-system.js`
- `public/js/sim/relic-system.js`
- `tests/lib/seams.mjs`
- `tests/sim-hooks.test.mjs` (new)
- `scripts/test-changed.mjs`
- `tasks/refactor-sim-hooks.md`

## Notes

立案 2026-11-06，路线图阶段 5（最高风险）。⚠️ 依赖阶段 4 验证过确定性之后再做，必须有 seams.mjs hooks 缝 + sim:determinism 双门禁。这是把「行为类内容」从共享 sim 核心剥离的最大杠杆，也是最后一步。