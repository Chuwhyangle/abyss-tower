---
id: feat-one-tower-visuals
title: 独塔重做·视觉：3/6/9/10 级外观与特效随强化逐级变炫酷
status: todo
labels:
  - feat
parent: null
children: []
depends_on:
  - feat-one-tower-ultimates
extra:
  schema: execution
  acceptance: node --test tests/sprite-coverage.test.mjs tests/render-visuals.test.mjs
---
## Proposal

依赖 `feat-one-tower-ultimates`（7 塔大招落地）。独塔重做后，塔在 3/6/9 级逐级选进化、10 级解锁大招——这些强化应有**可见的视觉变化**（塔身、配色、攻击特效、大招专属特效逐级变炫酷），而不是数值变了外观却不动。本任务给独塔加视觉分层：每层进化（3/6/9）在塔身/攻击特效上叠一层可见变化，10 级解锁大招后触发专属大招特效（按各塔大招的机制形态设计：炮台轰击余波、弩贯穿、电弧连锁暴击、狙击处决等）。复用现有精灵图集与渲染框架（`tower-renderer.js` 的进化配色/符文、`effect-draw.js` 的特效层、`sprite-coverage.js` 的 kind 登记），遵守 render-budget / sprite-coverage / perf-budget 门禁（不得红）。

## AC

- [ ] 独塔 3/6/9/10 级各有可见的外观/特效变化（塔身 + 攻击特效随层级增强）
- [ ] 大招触发有专属特效，7 塔大招的视觉形态可区分
- [ ] 新特效/精灵登记进 `sprite-coverage`，`render-budget`/`perf-budget` 不红
- [ ] `node --test tests/sprite-coverage.test.mjs tests/render-visuals.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/render/tower-renderer.js`、`public/js/render/effect-draw.js`、`public/js/render/sprite-coverage.js`，不引入第三方依赖
- [ ] 回归测试覆盖层级视觉分层 + 大招特效登记 + 预算门禁
- [ ] `npm test` 全绿；补跑 `node --test tests/sprite-coverage.test.mjs tests/render-visuals.test.mjs tests/render-budget.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/render/tower-renderer.js`
- `public/js/render/effect-draw.js`
- `public/js/render/sprite-coverage.js`
- `tests/sprite-coverage.test.mjs`
- `tests/render-visuals.test.mjs`
- `tasks/feat-one-tower-visuals.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-3（视觉部分）。依赖 `feat-one-tower-ultimates`（depends_on）。具体视觉形态由 worker 在预算门禁内设计；若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为渲染表现升级，无新文档面，L_D/L_G/L_S 无需量化。
