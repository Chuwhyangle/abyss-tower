---
id: refactor-tests-visual-harness
title: 重构 R5：拆分视觉采集/断言三件套
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
  - refactor-baseline-and-structure-gate
goal_ac: AC-043
---
## Proposal

视觉证据三件套 `tests/visual-scenes.mjs`（1257）、`tests/visual-scenarios.mjs`（942）、`tests/visual-check.test.mjs`（900）互相耦合：采集会话、场景计划、指标断言、contact sheet 全挤在三个文件里，正是上一次打击感复评「评审者只能反复看大图」的根因之一。拆出公共 harness 后，采集器与断言可分别演进，新增场景不必再改测试文件。

## Plan

1. 新建 `tests/lib/visual/session.mjs`：`VisualSceneSession`、`launchBrowser` 会话、viewport 定义、`hideFeedback/restoreFeedback` 等页面侧能力。
2. 新建 `tests/lib/visual/plan.mjs`：场景计划（`planFrame`、`planGroupFrames`、`scenarioPlan`、`validateScenarioPlans`、时间断言）。
3. 新建 `tests/lib/visual/metrics.mjs`：`evaluateFeel/evaluateArt/...` 的断言封装与阈值读取。
4. 新建 `tests/lib/visual/contact-sheet.mjs`：contact sheet 构建与 PNG 拼图辅助。
5. 三个入口文件只保留导出与编排（各自 ≤ 800 行）；对外导出名保持不变，测试与脚本 import 同步更新。
6. 删除 `scripts/structure-budget.allow.d/refactor-tests-visual-harness.json`。

## AC

- [ ] `visual-scenes.mjs`、`visual-scenarios.mjs`、`visual-check.test.mjs` 与所有新模块均 ≤ 800 行
- [ ] 现有导出名与签名不变；`node tests/visual-scenes.mjs --scenario all --quality high --viewport desktop --out /tmp/x` 仍可运行
- [ ] `npm test` 全绿；`node scripts/visual-check.mjs --suite all` PASS
- [ ] `node scripts/visual-parity.mjs --check` exit 0（拆分不得改变采集结果）
- [ ] `node scripts/structure-budget.mjs --check` exit 0，且本任务债务文件已删除

## DoD

- [ ] 纯移动优先，不重写采集/断言逻辑；问题写 Notes 另立任务
- [ ] 新 harness 模块有直接单测（至少 session/plan 的纯函数部分）
- [ ] 边界与 `docs/PHASE_REFACTOR.md` §6 R5 一致

## Touches

- `tests/visual-scenes.mjs`
- `tests/visual-scenarios.mjs`
- `tests/visual-check.test.mjs`
- `tests/lib/visual/session.mjs` (new)
- `tests/lib/visual/plan.mjs` (new)
- `tests/lib/visual/metrics.mjs` (new)
- `tests/lib/visual/contact-sheet.mjs` (new)
- `scripts/visual-check.mjs`
- `scripts/structure-budget.allow.d/refactor-tests-visual-harness.json`
- `tasks/refactor-tests-visual-harness.md`
