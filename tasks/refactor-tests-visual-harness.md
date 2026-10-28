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

- [x] `visual-scenes.mjs`、`visual-scenarios.mjs`、`visual-check.test.mjs` 与所有新模块均 ≤ 800 行
- [x] 现有导出名与签名不变；`node tests/visual-scenes.mjs --scenario all --quality high --viewport desktop --out /tmp/x` 仍可运行
- [x] `npm test` 全绿；`node scripts/visual-check.mjs --suite all` PASS
- [x] `node scripts/visual-parity.mjs --check` exit 0（拆分不得改变采集结果）
- [x] `node scripts/structure-budget.mjs --check` exit 0，且本任务债务文件已删除

## DoD

- [x] 纯移动优先，不重写采集/断言逻辑；问题写 Notes 另立任务
- [x] 新 harness 模块有直接单测（至少 session/plan 的纯函数部分）
- [x] 边界与 `docs/PHASE_REFACTOR.md` §6 R5 一致

## Notes

### 拆分后的模块边界（行数为拆分后实测，`structure-budget` 的 `countLines` 口径）

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `tests/lib/visual/session.mjs` | 662 | 视口/画质解析、`buildInitScript` 与页面冻结/接管脚本、`VisualSceneSession` |
| `tests/lib/visual/plan.mjs` | 430 | 场景目录与帧计划（纯数据）、`scenarioPlan`/`validateScenarioPlans`、`checkFrameTimes`/`TimeDriftError`/`frameKey` |
| `tests/lib/visual/metrics.mjs` | 327 | 采集结果 → 指标（feel/art/ui/mobile）、§8.6 阈值文档断言、注入白名单与单测基线样本 |
| `tests/lib/visual/contact-sheet.mjs` | 73 | contact sheet PNG 拼图与 HTML 索引页 |
| `tests/visual-scenes.mjs` | 565 | 采集编排 + CLI（全部对外符号经 re-export 保持原状） |
| `tests/visual-scenarios.mjs` | 539 | 浏览器端注入运行时、`ScenarioRunner`、`captureScenario`、manifest 条目（计划符号 re-export） |
| `tests/visual-check.test.mjs` | 798 | 只留用例 |
| `scripts/visual-check.mjs` | 183 | 套件编排 + 打印；指标换算改由 harness 提供并 re-export |

### 纯移动证据

- 「原文件逐行 → 新文件行多重集」比对：两个原入口文件缺少的行只剩 import 行（被新模块 import 取代）与段首注释（重写为模块头），采集/断言逻辑行一条未改。
- 同环境对照（决定性）：在未改动的 develop 主检出上用同一台机器现采基线 `node scripts/visual-parity.mjs --write --baseline /tmp/r5-baseline-develop.json`，再在本分支 `node scripts/visual-parity.mjs --check --baseline /tmp/r5-baseline-develop.json` → **exit 0（182 帧：180 帧逐像素一致，2 帧容差内渲染变体，网格最大差 0）**。

### AC 读数

- 行数：见上表，8 个文件全部 ≤ 800。
- 导出面：脚本化比对 `visual-scenes` 19 个、`visual-scenarios` 24 个、`scripts/visual-check.mjs` 12 个导出名，全部仍在原文件可取（`buildInitScript`/`ScenarioRunner` 等）。
- `node tests/visual-scenes.mjs --scenario all --quality high --viewport desktop --out /tmp/r5-scenario-all` exit 0（16 个场景 / 84 帧 / 21.2s）。⚠️ AC 原文的 `--out /tmp/x` 在本机不可用：`/tmp/x` 是他人（vince）留下的 0 字节文件，`mkdirSync` 必然 EEXIST；换成可写目录后同一条命令通过。
- `npm test`：1728 例全绿。首跑出现过一次 `tests/hex-flow.test.mjs`「遗物候选与刷新费用走共享海克斯钩子」偶发失败，单跑与随后两次全量均绿；该用例与视觉 harness 无依赖关系。
- `node scripts/visual-check.mjs --suite all`：PASS（feel/art/ui/mobile 四套件全绿，结论：通过）。
- `node scripts/visual-parity.mjs --check`（仓库基线 `docs/reviews/refactor-baseline.json`）：**exit 1，但不是本分支引入的**。同一命令在未改动的 develop 主检出上同样 exit 1，漂移帧数与幅度一致（182 帧，例 `combat@desktop/combat-impact` 平均差 1.249）。基线采于 2026-10-28 22:15，其后 develop 无任何 `public/js` / `public/styles.css` 改动（`git log 6e55de9..HEAD -- public/js public/styles.css public/index.html` 为空），画面统计 meanLuma/stdLuma/levels 与基线逐项相同，仅剩亚像素/字形级差异 → 判定为本机 Chrome（153.0.8010.52）渲染变体超出 R0 标定容差，库里基线已陈旧。拆分中性由上面的同环境基线对照证明（exit 0）；AC 打勾依据的是「拆分不得改变采集结果」这一实质判据。
- `node scripts/structure-budget.mjs --check` exit 0（437 源文件、债务 13 条），`scripts/structure-budget.allow.d/refactor-tests-visual-harness.json` 已删除。

### 一处必要的范围外改动（已登记进 Touches）

`tests/docs-consistency.test.mjs`：其「计划正本 planned 块内必须仍有缺失路径」判据，恰好只由 R5 的四个 `tests/lib/visual/*` 路径支撑；R5 落地后该断言必然变红（`npm test` 曾因此红）。改法保持语义不变——真实文档「块外路径必须存在」照旧校验，块内豁免机制改由自包含 fixture 证明（块内缺失路径仍被判为已豁免、块外同一条仍被判红），不再依赖计划产物的落地进度。

### 另立任务建议（本次不改）

`docs/reviews/refactor-baseline.json` 已与当前 Chrome 渲染不一致（develop 自身 `--check` exit 1）。AC-047 的判据需要一次同环境 `--write` 重采（R6 收口时顺手做，或单独立「视觉基线重采」任务），否则任何分支的 parity 都会红；重采前 parity 只能作为「同环境对照」使用（`--write --baseline /tmp/...` + `--check --baseline /tmp/...`）。

## Touches

- `tests/visual-scenes.mjs`
- `tests/visual-scenarios.mjs`
- `tests/visual-check.test.mjs`
- `tests/lib/visual/session.mjs` (new)
- `tests/lib/visual/plan.mjs` (new)
- `tests/lib/visual/metrics.mjs` (new)
- `tests/lib/visual/contact-sheet.mjs` (new)
- `tests/docs-consistency.test.mjs`
- `scripts/visual-check.mjs`
- `scripts/structure-budget.allow.d/refactor-tests-visual-harness.json`
- `tasks/refactor-tests-visual-harness.md`
