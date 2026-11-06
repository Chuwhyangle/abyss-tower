---
id: refactor-sim-hooks
title: 并发重构·阶段5 重做：sim 战斗 hook 总线（上一版破坏确定性已回滚，AC 已重置）
status: done
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

⚠️ 上一版（commit c8c75c42）已**回滚**（revert ab4840a2）：它在隔离 worktree 里 `sim:determinism` 跑绿，但 fan-in 合并 develop 后**确定性红**（2 个 seed 的 state/events/rng 哈希不一致）——因为它没合并最新 develop 就验证。本任务需**重做**。

- 新增 `public/js/shared/hooks.js`：hook 名单 + 按注册顺序调度/缺失跳过/非法回退的运行时。
- 在 `sim/combat-system.js`（dealDamage/killEnemy/leak）与 `sim/relic-system.js` 接 hook 总线，让遗物/海克斯行为在各自模块声明，不再改共享 sim 核心。
- ⛔ 确定性红线：hook 按固定数组顺序遍历（绝不 Object.keys 序）；hook 内不得新建 RNG 或改 combatRng 调用顺序。

## AC

- [x] hooks.js 运行时正确（顺序调度/缺失跳过/非法回退）
- [x] 遗物/海克斯行为走 hook，不再改 combat-system/relic-system
- [x] **先 `git merge develop` 合并最新 develop，再跑** `node scripts/check-sim-determinism.mjs --check` 通过；`tests/lib/seams.mjs` hooks 缝验证
- [x] `npm run balance` 无漂移；`npm test` 全绿

## DoD

- [x] 落地于 `shared/hooks.js`(新)、`sim/combat-system.js`、`sim/relic-system.js` + 各 hook 声明模块，零第三方依赖
- [x] ⛔ 确定性最高危：固定顺序调度 + 独立随机流 + **合并 develop 后** sim:determinism 双门禁（这是上一版翻车点）
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

立案 2026-11-06，路线图阶段 5。**回滚记录**：上一版 commit c8c75c42 落地后 `check-sim-determinism` 红（`feel-sim-diff-seed-c` state、`visual-fixed-seed` events/rng/state 不一致），已 revert ab4840a2，遗物词条退回 combat-system 内联（feat-relic-behaviors 功能保留）。**教训：worker 在隔离 worktree 跑 determinism 是假绿，必须先合并 develop 再验证**。本任务 AC 已把这条写死。

**重做落地（2026-11-06，commit 038c7b77）**：分支基于 develop `45502753`，实现后显式 `git merge develop`（Already up to date）再复验：

- `node scripts/check-sim-determinism.mjs --check`：3 个 seed 的 events/rng/state 全一致（含上一版翻车的 `feel-sim-diff-seed-c` / `visual-fixed-seed`）。
- `npm test`：2151/2151 全绿（含 `tests/sim-hooks.test.mjs` 10 例与 seams `hooks` 缝）。
- `npm run balance`（40 seed × 3 候选 = 1080 局）：与未改动 develop 基线的输出逐行一致，仅「耗时」行不同（345.7s vs 356.8s）。
- anti-drift Touches：9 个改动文件全部在声明范围内。

**实现要点**：`HookBus` 名单 `HOOK_NAMES` 冻结、provider 按注册顺序调度、`fold` 对 `undefined/null` 回退；新增 `rngFor(name)` 懒创建 `${seed}:hook:${name}` 独立随机流（与 combatRng、`${seed}:hex:*` 隔离；当前无 hook 抽取，故战斗 RNG 调用顺序不变）。遗物词条整体迁到 `RelicBehaviorProvider`（逐字复刻、仅移动位置）；海克斯副作用经 `HexHookProvider` 适配器接总线。觉醒 / 教义 / 派系 setMods 属各自系统，不在本阶段 hook 范围。