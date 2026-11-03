---
id: feat-one-tower-visuals
title: 独塔重做·视觉：3/6/9/10 级外观与特效逐级变炫酷
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/render-budget.test.mjs tests/render-visuals.test.mjs
---
## Proposal

`feat-one-tower-core`（done）与 `feat-one-tower-ultimates`（done）已落地「3/6/9 逐级选进化 + 10 级固定大招」的机制。本任务补视觉表现，让塔的**外观与攻击特效随 3/6/9/10 逐级变炫酷**（用户明确要求「外观和特效都要发生变化，变得更炫酷」）：① 3/6/9 级每选一条进化，塔外观/配色/符文有一档可见变化（复用现有进化视觉 `tower-renderer.js` 的 `drawEvolutionMark` / 进化配色路径，扩到三档）；② 10 级大招各有专属特效（弩=贯穿光箭、霜=冻结冰爆、电弧=天雷、毒=绿雾爆、战旗=军令箭齐射、震荡=地裂、狙击=红线处决），复用 `public/js/render/effect-draw.js` 与 `projectile-visuals` 既有特效原语，不新开特效系统。**不得超 render-budget 预算**（perf 门禁），新精灵/特效要同步 `sprite-coverage` 清单。

## AC

- [x] 3/6/9 级进化各有可见外观档位变化（配色/符文/轮廓之一，不靠悬浮 tooltip）
- [x] 10 级大招各塔有专属攻击特效（至少与普通攻击可肉眼区分）
- [x] `node --test tests/render-budget.test.mjs tests/render-visuals.test.mjs` exit 0（预算不超）
- [x] 新精灵/特效同步进 `sprite-coverage`，`tests/sprite-coverage.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/render/`（tower-renderer/tower-draw/effect-draw 等），不引入第三方依赖
- [x] 回归测试覆盖三档进化外观 + 大招特效存在性 + 预算不超
- [x] `npm test` 全绿；补跑 `node --test tests/render-budget.test.mjs tests/render-visuals.test.mjs tests/sprite-coverage.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/render/tower-renderer.js`
- `public/js/render/effect-draw.js`
- `public/js/render/sprite-coverage.js`
- `public/js/sim/projectile-system.js`
- `tests/render-visuals.test.mjs`
- `tests/sprite-coverage.test.mjs`
- `scripts/structure-budget.allow.d/feat-one-tower-visuals.json`
- `tasks/feat-one-tower-visuals.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-3。视觉是玩法重做的最后一环；render 层不改 sim，`npm test` 的确定性门禁不受影响。

落地（2026-11-03）：实际 Touches 较立案多出 `sprite-coverage.js`（大招形态注册表 + 视觉分层档位）、`projectile-system.js`（大招效果对象加 weapon/ultimate/towerLevel 表现字段，不新增随机数调用、不改 sim 确定性）、`sprite-coverage.test.mjs`（八塔大招注册表断言）。effect-draw 615 行超 600 行结构预算，登记债务 `scripts/structure-budget.allow.d/feat-one-tower-visuals.json`（maxLines 640）。render 层未新增第三方依赖。

该轴仍暗,理由:本任务为渲染层视觉增强，不改玩法/数值/文档面，L_D/L_G/L_S 无需量化。