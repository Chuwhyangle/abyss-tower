---
id: refactor-closeout
title: 重构 R6：收口剩余长文件并清空债务登记
status: ready
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

- [x] `public/js` 与 `server` 下无非豁免文件超过 600 行；`scripts` 与 `tests` 下不超过 800 行
- [x] `node scripts/structure-budget.mjs --check` exit 0，`allow.d/` 仅剩数据豁免（空目录或删除）
- [x] `npm test` 全绿；`npm run check:syntax && npm run check:imports && npm run check:style && npm run check:docs` 通过
- [x] `node scripts/visual-parity.mjs --check` exit 0 且 `node scripts/visual-check.mjs --suite all` PASS
- [x] `node scripts/check-sim-determinism.mjs --check` exit 0
- [x] `npm run perf:budget` 通过
- [x] `docs/PHASE_REFACTOR.md` 的实测数字（文件数/行数/超限清单）已更新为收口后的值

## DoD

- [x] 债务登记为空（数据豁免除外），且每个已删条目对应的文件实测行数在预算内
- [x] 收口报告写进任务 Notes：每个文件的拆分前后行数表
- [x] 无遗留兼容重导出壳；`node scripts/dead-exports.mjs` 无新增

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
- `scripts/test-changed.mjs`
- `docs/PHASE_REFACTOR.md`
- `tests/ambience.test.mjs`
- `tests/ambience-presets.test.mjs`
- `tests/biome-visuals.test.mjs`
- `tests/weather-visuals.test.mjs`
- `tests/fixed-maps.test.mjs`
- `tests/render-visuals.test.mjs`
- `tests/sprite-pipeline.test.mjs`
- `tests/relic-codex.test.mjs`
- `tests/relic-codex-detail.test.mjs`
- `tests/i18n.test.mjs`
- `tests/structure-budget.test.mjs`
- `tests/docs-consistency.test.mjs`
- `tests/balance-sim.mjs`
- `tests/balance-bot.mjs` (new)
- `tests/balance-report.mjs` (new)
- `tests/balance-sweep.mjs`
- `tests/maps.test.mjs`
- `tasks/refactor-closeout.md`

## Notes

收口报告（2026-10-29 实测，分支 `task/refactor-closeout`，实现提交 `bdd7987`）。

### 拆分前后行数

| 文件 | 拆分前 | 拆分后 | 新增模块（行数） |
| --- | --- | --- | --- |
| `public/js/render/background-renderer.js` | 727 | 327 | `background-data.js` 151（数据豁免）、`background-draw.js` 277 |
| `public/js/render/sprite-pipeline.js` | 649 | 555 | `sprite-atlas.js` 68、`sprite-fallback.js` 75 |
| `public/js/relic-codex-ui.js` | 632 | 361 | `relic-codex-data.js` 78（数据豁免）、`relic-codex-draw.js` 201 |
| `tests/balance-sim.mjs` | 1289 | 547 | `tests/lib/balance-bot.mjs` 207、`tests/lib/balance-report.mjs` 614 |

### 拆分边界

- `background-data.js`：分层定义、群系场景、调色板覆盖、天气/粒子预算、过渡带与排除区——纯常量与纯查表函数，零 import。
  `background-draw.js`：远景/雾霭分带、区域过渡带、昼夜色调、天气粒子、地表道具——只碰传入的 ctx 与 RNG；
  `background-renderer.js` 只留烘焙编排与天气派生（`weatherFor` / `weatherLayer` 等导出不变）。RNG 调用顺序未变。
- `sprite-atlas.js`：图集帧 + DPR 变体 → 帧几何与 CSS 背景（纯函数）；`sprite-fallback.js`：默认加载器、加载结果归一、
  告警去重、内存预算两档回退（降档 / 丢最大条目）。管线类保留加载状态机与只读访问器。
- `relic-codex-data.js`：稀有度/套装顺序、效果单位表、已收录推导（只依赖 shared 数据与效果注册表）；
  `relic-codex-draw.js`：效果/周期/套装文案与详情卡 + 列表渲染；`relic-codex-ui.js` 只留面板接线、样式与只读接口。
- 无兼容重导出壳：调用方 import 与源码级断言同步更新（6 个渲染测试、3 个图鉴/i18n 测试、`tests/maps.test.mjs`、
  `tests/balance-sweep.mjs`），新源文件登记进 `scripts/test-changed.mjs` 的 TEST_MAP。

### 债务登记

`scripts/structure-budget.allow.d/refactor-closeout.json` → `{ "entries": [] }`（四个原登记文件的实测行数全部落到预算内：
327 / 555 / 361 / 547）。`tests/structure-budget.test.mjs` 的真实仓库断言同步放宽为「整体为空是合法终态，但不允许空壳债务文件」。

### 门禁读数

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 结构预算 | `node scripts/structure-budget.mjs --check` | exit 0（472 源文件，债务 0，无 import 环） |
| 全量测试 | `npm test` | 1747 / 1747 pass |
| 静态 | `check:syntax && check:imports && check:style && check:docs` | 全绿 |
| 确定性 | `node scripts/check-sim-determinism.mjs --check` | 3 seed 的 events/rng/state 哈希与基线一致 |
| 视觉像素 | `node scripts/visual-parity.mjs --check` | exit 0（11 帧同代码渲染变体，全部在容差内，无漂移） |
| 视觉套件 | `node scripts/visual-check.mjs --suite all` | PASS（结论：通过） |
| 性能预算 | `npm run perf:budget` | PASS |
| 死导出 | `node scripts/dead-exports.mjs` | 104（收口前 105，无新增） |

### 文档

`docs/PHASE_REFACTOR.md`：§1 改为「重构前 / 收口后」双列实测（472 文件 / 121,272 行；超 600 行非数据源文件 24 → 11，
且全部在工具/测试 800 行预算内），§5 记录收口终态，§6 R6 与 §7 的计划块（含起止标记行）全部日落——
`npm run check:docs` 在无块状态下 exit 0；`tests/docs-consistency.test.mjs` 的「计划正本必须有 planned 块」断言同步改为「收口后不得再有」。
