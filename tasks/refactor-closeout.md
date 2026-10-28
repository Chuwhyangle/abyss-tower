---
id: refactor-closeout
title: 重构 R6：收口剩余长文件并清空债务登记
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
  - refactor-render-skill-enemy
  - refactor-render-effects-tower-projectile
  - refactor-server-run-leaderboard
  - refactor-shared-achievements-audio
  - refactor-tests-visual-harness
goal_ac: AC-043
---
## Proposal

收口任务：把剩余的渲染长文件拆到预算内，清空债务登记，复核全部门禁，保证 GOAL-009 的退出条件全部可判。

## Plan

1. `background-renderer.js`（727）：外提 `background-data.js`（调色板/场景参数）与 `background-draw.js`（分带与装饰绘制）。
2. `sprite-pipeline.js`（649）：外提 `sprite-atlas.js`（图集/DPR 解析）与 `sprite-fallback.js`（缺资源回退）。
3. `relic-codex-ui.js`（632）：外提 `relic-codex-data.js` 与 `relic-codex-draw.js`（列表渲染与详情渲染分离）。
4. 清空 `scripts/structure-budget.allow.d/refactor-closeout.json`（仅保留数据豁免；如仍有余量，写进 Notes 并另立任务）。
5. 复核六个门禁：structure-budget、npm test、静态检查、确定性、视觉一致性、性能预算。

## AC

- [ ] `public/js` 与 `server` 下无非豁免文件超过 600 行；`scripts` 与 `tests` 下不超过 800 行
- [ ] `node scripts/structure-budget.mjs --check` exit 0，`allow.d/` 仅剩数据豁免（空目录或删除）
- [ ] `npm test` 全绿；`npm run check:syntax && npm run check:imports && npm run check:style && npm run check:docs` 通过
- [ ] `node scripts/visual-parity.mjs --check` exit 0 且 `node scripts/visual-check.mjs --suite all` PASS
- [ ] `node scripts/check-sim-determinism.mjs --check` exit 0
- [ ] `npm run perf:budget` 通过
- [ ] `docs/PHASE_REFACTOR.md` 的实测数字（文件数/行数/超限清单）已更新为收口后的值

## DoD

- [ ] 债务登记为空（数据豁免除外），且每个已删条目对应的文件实测行数在预算内
- [ ] 收口报告写进任务 Notes：每个文件的拆分前后行数表
- [ ] 无遗留兼容重导出壳；`node scripts/dead-exports.mjs` 无新增

## Touches

- `public/js/render/background-renderer.js`
- `public/js/render/background-data.js` (new)
- `public/js/render/background-draw.js` (new)
- `public/js/render/sprite-pipeline.js`
- `public/js/render/sprite-atlas.js` (new)
- `public/js/render/sprite-fallback.js` (new)
- `public/js/relic-codex-ui.js`
- `public/js/relic-codex-data.js` (new)
- `public/js/relic-codex-draw.js` (new)
- `scripts/structure-budget.allow.d/refactor-closeout.json`
- `docs/PHASE_REFACTOR.md`
- `tests/render-visuals.test.mjs`
- `tasks/refactor-closeout.md`
