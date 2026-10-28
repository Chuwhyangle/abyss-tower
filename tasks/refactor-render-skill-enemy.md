---
id: refactor-render-skill-enemy
title: 重构 R1：拆分 skill-renderer 与 enemy-renderer
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

`skill-renderer.js`（1396 行）与 `enemy-renderer.js`（1081 行）把静态表（画质档、警告注册表、动画变体、闪白参数）与绘制逻辑混在一起。数据改一行要读懂整套绘制；两个文件也是并行任务的热点互斥点。本任务按「数据 / 反馈原语 / 绘制 / 编排」拆开，行为与像素零变化。

## Plan

1. `skill-renderer.js`：外提 `skill-data.js`（QUALITY_CAPS、SKILL_QUALITY_PROFILES、SKILL_WARNING_PROFILES/REGISTRY、颜色工具），
   外提 `skill-warnings.js`（renderWarnings + warningCountdown 相关），`skill-draw.js`（技能本体绘制），
   类保留为编排；对外导出名与签名不变，调用方 import 路径同步更新。
2. `enemy-renderer.js`：外提 `enemy-data.js`（ENEMY_ANIMATIONS、ENEMY_WALK_PROFILES、ENEMY_ANIM_VARIANTS、SKIN_OUTLINE_BUDGET、HIT_HIGHLIGHT），
   外提 `enemy-feedback.js`（hitFlashAlpha、hitHighlightAlpha、drawHitHighlight），Boss 地面与身体绘制各自成函数模块；
   类保留编排。
3. 每一步先跑 `npm test` 与 `node scripts/visual-parity.mjs --check`，再进入下一文件。
4. 删除 `scripts/structure-budget.allow.d/refactor-render-skill-enemy.json`。

## AC

- [ ] `skill-renderer.js`、`enemy-renderer.js` 均 ≤ 600 行；新增的 `skill-*`/`enemy-*` 模块均 ≤ 600 行且数据模块满足纯度规则
- [ ] 公共导出名与签名不变（`qualityProfile`、`SkillRenderer`、`enemyWalkProfile`、`hitFlashAlpha`、`EnemyRenderer` 等），无兼容重导出壳
- [ ] `npm test` 全绿；`npm run check:syntax && npm run check:imports && npm run check:style` 通过
- [ ] `node scripts/visual-parity.mjs --check` exit 0（逐帧像素哈希与基线一致）
- [ ] `node scripts/structure-budget.mjs --check` exit 0，且 `refactor-render-skill-enemy.json` 已删除
- [ ] `npm run perf:budget` 通过

## DoD

- [ ] 纯移动优先：每步只移动代码，不顺手改行为；发现的问题写进 Notes、另立任务
- [ ] 测试 import 路径同步更新，未新增死导出（`node scripts/dead-exports.mjs` 无新增）
- [ ] 拆分边界与 `docs/PHASE_REFACTOR.md` §4/§6 一致

## Touches

- `public/js/render/skill-renderer.js`
- `public/js/render/skill-data.js` (new)
- `public/js/render/skill-warnings.js` (new)
- `public/js/render/skill-draw.js` (new)
- `public/js/render/enemy-renderer.js`
- `public/js/render/enemy-data.js` (new)
- `public/js/render/enemy-feedback.js` (new)
- `scripts/structure-budget.allow.d/refactor-render-skill-enemy.json`
- `tests/render-visuals.test.mjs`
- `tasks/refactor-render-skill-enemy.md`
