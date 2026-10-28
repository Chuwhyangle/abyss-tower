---
id: refactor-render-effects-tower-projectile
title: 重构 R2：拆分 effect/tower/projectile 渲染器
status: todo
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: npm test
depends_on:
  - refactor-baseline-and-structure-gate
goal_ac: AC-043
---
## Proposal

`effect-renderer.js`（1049）、`tower-renderer.js`（1054）、`projectile-renderer.js`（772）同样是「事件/变体/预算表 + 粒子池 + 绘制」混在一个模块。特效是本项目改动最频繁的区域之一，拆分后数据表与绘制逻辑可分别演进，且并行任务不再互斥。行为与像素零变化。

## Plan

1. `effect-renderer.js`：外提 `effect-data.js`（EFFECT_EVENTS、EFFECT_KIND_EVENTS、EFFECT_PROFILES、EFFECT_VARIANTS、SHARP_HIT_STAR、显存/粒子预算常量），
   外提 `effect-pool.js`（ParticlePool），`effect-draw.js`（drawSharpHitStar、impactFor、effectProgress 与各事件绘制），类保留编排。
2. `tower-renderer.js`：外提 `tower-data.js`（TOWER_ANIMATIONS、RECOIL、ANIM_VARIANTS、SKIN_OUTLINE_BUDGET、EVOLUTION_* 表），
   `tower-draw.js`（塔体、进化视觉、后坐力绘制）。
3. `projectile-renderer.js`：按弹种把绘制函数外提为 `projectile-draw.js`，类只留编排与缓存。
4. 每步跑 `npm test` 与 `node scripts/visual-parity.mjs --check`；最后删除本任务债务文件。

## AC

- [ ] 三个入口文件与所有新模块均 ≤ 600 行；数据模块满足纯度规则
- [ ] 公共导出名与签名不变（`EFFECT_EVENTS`、`ParticlePool`、`TOWER_ANIMATIONS`、`evolutionVisual`、`ProjectileRenderer` 等）
- [ ] `npm test` 全绿；静态检查通过
- [ ] `node scripts/visual-parity.mjs --check` exit 0
- [ ] `node scripts/structure-budget.mjs --check` exit 0，且 `refactor-render-effects-tower-projectile.json` 已删除
- [ ] `npm run perf:budget` 通过（粒子池拆分不得改变分配次数）

## DoD

- [ ] 纯移动优先，不顺手优化；问题写 Notes 另立任务
- [ ] 无兼容重导出壳；测试 import 同步更新
- [ ] 边界与 `docs/PHASE_REFACTOR.md` §6 R2 一致

## Touches

- `public/js/render/effect-renderer.js`
- `public/js/render/effect-data.js` (new)
- `public/js/render/effect-pool.js` (new)
- `public/js/render/effect-draw.js` (new)
- `public/js/render/tower-renderer.js`
- `public/js/render/tower-data.js` (new)
- `public/js/render/tower-draw.js` (new)
- `public/js/render/projectile-renderer.js`
- `public/js/render/projectile-draw.js` (new)
- `scripts/structure-budget.allow.d/refactor-render-effects-tower-projectile.json`
- `tests/render-visuals.test.mjs`
- `tasks/refactor-render-effects-tower-projectile.md`
