---
id: refactor-baseline-and-structure-gate
title: 重构地基：结构预算门禁 + 视觉/确定性基线与见证工具
status: done
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/structure-budget.test.mjs
goal_ac: AC-043
---
## Proposal

GOAL-009 的其余任务都需要同一块地基：可执行的结构预算门禁 + 「行为不变」的可执行见证。当前仓库没有任何行数/导入环/数据模块纯度检查，也没有可对照的模拟与视觉基线；没有它们，拆分无法证明「零行为变化」。本任务先落地门禁与基线，并把现有 24 个超限文件按负责任务登记为债务（每个任务一个债务文件，互不冲突）。

## Plan

1. `scripts/structure-budget.mjs`：扫描 `public/js`、`server`、`scripts`、`tests` 的 `.js/.mjs`；规则三条——
   单文件 ≤ 600 行（数据豁免：`public/js/shared/i18n/*.js`、`server/db/migrations/*.mjs`、`*-data.js`）；
   静态 import 图无环（Tarjan）；数据模块不得 import 运行时模块（`public/js/sim|render|app|ui`、`server/`）。
   债务登记读取 `scripts/structure-budget.allow.d/*.json`：条目 = `{ path, maxLines, owner }`，owner 必须是已存在的任务 id。
2. 生成五个按任务归属的债务文件：`refactor-render-skill-enemy.json`（skill-renderer 1396、enemy-renderer 1081）、
   `refactor-render-effects-tower-projectile.json`（effect 1049、tower 1054、projectile 772）、
   `refactor-server-run-leaderboard.json`（run-service 1017、leaderboard 893）、
   `refactor-shared-achievements-audio.json`（achievements 1027、audio 1221）、
   `refactor-tests-visual-harness.json`（visual-scenes 1257、visual-scenarios 942、visual-check.test 900）；
   `refactor-closeout.json` 只登记运行时剩余三件：background-renderer 727、sprite-pipeline 649、relic-codex-ui 632。
   （预算口径：`public/js` 与 `server` ≤600；`scripts` 与 `tests` ≤800，故 balance-sim 1289 / visual-scenes 1257 /
   visual-scenarios 942 / visual-check.test 900 由对应任务处理，其余工具与测试不超 800。）
3. `tests/structure-budget.test.mjs`：正/负对照——超限必红、allow 覆盖内必绿、导入环必红、数据模块 import 运行时必红。
4. `scripts/visual-parity.mjs`：复用 `tests/visual-scenes.mjs` 采集路径（5 场景 × 两视口 + 16 scenario × 两视口），
   每帧落 `pixelHash`；`--check` 与基线逐帧对照，任一不一致 exit 1。
5. 生成基线 `docs/reviews/refactor-baseline.json`（在本任务合入前的同树上采集）。
6. `scripts/check-sim-determinism.mjs`：对 `visual-fixed-seed` / `feel-sim-diff-seed-b` / `feel-sim-diff-seed-c`
   调 `scripts/feel-sim-diff.mjs` 生成 events/rng/state 哈希，落 `docs/reviews/sim-determinism.json`；`--check` 重跑并对照。
7. 接入 `npm run verify:local`（structure-budget 阻塞）与 CI（`.github/workflows/ci.yml`）；parity/determinism 不进每次 CI，只作为 GOAL AC 判据。

## AC

- [x] `node scripts/structure-budget.mjs --check` exit 0（当前所有超限文件均已登记债务）
- [x] 负对照：任取一个文件把预算调低 1 行，`--check` 必须 exit 1；数据模块 import 运行时模块必须 exit 1；人为构造 import 环必须 exit 1
- [x] `node --test tests/structure-budget.test.mjs` 全绿
- [x] `docs/reviews/refactor-baseline.json` 覆盖 5 场景 × 2 视口 + 16 scenario × 2 视口，且 `node scripts/visual-parity.mjs --check` 在未改动树上 exit 0，连续两次结果一致
- [x] `docs/reviews/sim-determinism.json` 覆盖 3 个 seed 的 events/rng/state 三份哈希，且 `node scripts/check-sim-determinism.mjs --check` exit 0
- [x] `npm test` 全绿

## DoD

- [x] 门禁与见证工具零第三方依赖，Node ≥ 22.5 原生实现
- [x] 债务文件按任务归属，五个拆分任务各自只删自己的文件
- [x] `docs/PHASE_REFACTOR.md` §5/§6 与实现一致（含 `allow.d` 目录口径）
- [x] 基线可在未改动的 worktree 上稳定复跑（两次哈希一致，无时间戳）

## Notes

- **债务归属补记**：`tests/balance-sim.mjs`（1289）在 R1–R5 的任务清单里没有对应的拆分任务，登记在 `refactor-closeout.json`，并在 `docs/PHASE_REFACTOR.md` §5 写明。R6 收口时不拆它（或另立任务承接）就会被 `debt-stale` / `debt-exceeded` 拦住——这是显式留下的收口债，不是漏登记。
- **门禁口径落定**（已写进 §5）：文件名即 owner（`<task-id>.json` 内每条 `owner` 必须等于文件名）；owner 必须是 `tasks/<owner>.md` 活任务；四类债务违规 over-budget / debt-exceeded / debt-stale / debt-unknown-path；数据豁免只免行数不免纯度；import 解析复用 `scripts/import-graph.mjs`（parseImports/resolveSpecifier/collectFiles），只有 SCC 用 Tarjan 自实现——避免两套解析器对同一份代码给出不同结论。
- **视觉见证两级判定（设计增量，已写进 §8）**：实测真浏览器截图跨进程存在亚像素/字形级渲染变体（8×8 亮度网格单元差 ≤0.01、画面统计 ≤0.02），纯 pixelHash 等价会在未改动树上随机变红（实测单次 `--check` 出现 4~6 帧假红）。因此：pixelHash 相同 = 逐像素一致；不同时要求 8×8 网格单元最大差 ≤1、平均差 ≤0.25 且 `meanLuma`/`stdLuma`/`levels` 在容差内，才判「同代码渲染变体」并逐条列出，否则判漂移。缺失帧/多出帧零容忍。
- **登记与配套**：三个新脚本进了 `scripts/test-changed.mjs` 的 TEST_MAP（否则全量套件的「审计覆盖」红）；`tests/verify-local.test.mjs` 的 EXPECTED_STEPS 同步加入 `check:structure`（verify:local 链改动必须同步该断言）。
- **基线条目格式**：每帧一行（含 64 个亮度网格值），264 行 / 119KB；缩进展开会变成 1.3 万行、把真实改动淹掉。round-trip 字节稳定由单测断言，基线不含时间戳/commit。
- **实测证据**（合并 develop 后复跑）：structure-budget = 433 源文件 / 16 债务条目 / 1327 条依赖 / 无环；视觉基线 182 帧 = 5 场景 × 2 视口（14 帧）+ 16 scenario × 2 视口（168 帧），连续两次 `--check` 均 exit 0（逐像素一致 179 / 178，渲染变体 3 / 4，网格差 ≤0.01）；确定性基线 3 seed × events/rng/state，`--check` exit 0；`npm test` 1727 例全绿；`coverage:changed` 四个脚本行覆盖 69.25% / 69.64% / 90.37% / 94.31%。
- **已知耦合**：`tests/docs-consistency.test.mjs` 要求 planned 块内仍有「未落地产物」；本任务落地后 §5/§7 计划块的路径都已存在，故把 R5 的四块具体路径（`tests/lib/visual/session.mjs` 等，R5 才会创建）写进 §6 计划块，维持该不变式的真实前提。R5/R6 落地时须删除计划块（§6 R6 已写明）。

## Touches

- `scripts/structure-budget.mjs` (new)
- `scripts/structure-budget.allow.d/refactor-render-skill-enemy.json` (new)
- `scripts/structure-budget.allow.d/refactor-render-effects-tower-projectile.json` (new)
- `scripts/structure-budget.allow.d/refactor-server-run-leaderboard.json` (new)
- `scripts/structure-budget.allow.d/refactor-shared-achievements-audio.json` (new)
- `scripts/structure-budget.allow.d/refactor-tests-visual-harness.json` (new)
- `scripts/structure-budget.allow.d/refactor-closeout.json` (new)
- `scripts/visual-parity.mjs` (new)
- `scripts/check-sim-determinism.mjs` (new)
- `tests/structure-budget.test.mjs` (new)
- `docs/reviews/refactor-baseline.json` (new)
- `docs/reviews/sim-determinism.json` (new)
- `docs/PHASE_REFACTOR.md`
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/test-changed.mjs`
- `tests/verify-local.test.mjs`
- `tasks/refactor-baseline-and-structure-gate.md`
