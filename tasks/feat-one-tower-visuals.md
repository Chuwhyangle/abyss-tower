---
id: feat-one-tower-visuals
title: 独塔重做·视觉特效：3/6/9/10 级外观逐级变炫酷 + 大招特效
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/sprite-coverage.test.mjs tests/tower-evo-visuals.test.mjs tests/render-visuals.test.mjs
---
## Proposal

`feat-one-tower-core` + `feat-one-tower-ultimates`（均 done）已落地独塔的机制层（3/6/9 逐级选进化 + 10 级大招，8 塔）。本任务补视觉层：① 塔外观随 3/6/9/10 级**逐级变炫酷**（程序化层次或精灵，至少每级有可辨差异）；② **大招特效**（炮台轰击余波 + 其余 7 塔大招的可视反馈：贯穿/冻结/连锁暴击/毒爆/号令/震波/处决）。约束：新精灵/特效必须登记进 `sprite-coverage`（缺一即红），渲染/性能预算（`render-budget`/`perf-budget`）不得越线；语义上「炫不炫」交玩家验收（本仓库已不做读图评审），本任务只保机械完整性。机制层数值不动。

## AC

- [ ] 3/6/9/10 级塔外观有逐级差异（至少 4 档可辨），大招触发时有对应特效
- [ ] 8 塔大招特效全部有可视化（炮台余波 + 7 塔贯穿/冻结/连锁/毒爆/号令/震波/处决）
- [ ] 新精灵/特效登记进 `sprite-coverage`，无缺失项；`render-budget`/`perf-budget` 门禁不红
- [ ] `node --test tests/sprite-coverage.test.mjs tests/tower-evo-visuals.test.mjs tests/render-visuals.test.mjs` exit 0

## DoD

- [ ] 落地于 render 层（`tower-draw.js`/`tower-renderer.js`/`effect-draw.js`/`sprite-coverage.js` 等），不引入第三方依赖
- [ ] 回归测试：4 档外观 + 8 塔大招特效的 sprite/effect 登记
- [ ] `npm test` 全绿；补跑 `node --test tests/sprite-coverage.test.mjs tests/tower-evo-visuals.test.mjs tests/render-visuals.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/render/tower-draw.js`
- `public/js/render/tower-renderer.js`
- `public/js/render/effect-draw.js`
- `public/js/render/sprite-coverage.js`
- `tests/sprite-coverage.test.mjs`
- `tasks/feat-one-tower-visuals.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` TODO-3 第 4 点（外观/特效随 3/6/9/10 逐级变炫酷）。依赖 core/ultimates（done）的机制。若 worker 实际 Touches 有出入（如新增 effect-data/sprite-manifest、新测试文件），须 task_write 修正再 fan-in。语义验收交玩家，不做读图评审。

该轴仍暗,理由:本任务为渲染/表现层，不引入新结构文档面，L_D/L_G/L_S 无需量化。
