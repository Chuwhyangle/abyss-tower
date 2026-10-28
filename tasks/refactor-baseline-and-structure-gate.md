---
id: refactor-baseline-and-structure-gate
title: 重构地基：结构预算门禁 + 视觉/确定性基线与见证工具
status: ready
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

- [ ] `node scripts/structure-budget.mjs --check` exit 0（当前所有超限文件均已登记债务）
- [ ] 负对照：任取一个文件把预算调低 1 行，`--check` 必须 exit 1；数据模块 import 运行时模块必须 exit 1；人为构造 import 环必须 exit 1
- [ ] `node --test tests/structure-budget.test.mjs` 全绿
- [ ] `docs/reviews/refactor-baseline.json` 覆盖 5 场景 × 2 视口 + 16 scenario × 2 视口，且 `node scripts/visual-parity.mjs --check` 在未改动树上 exit 0，连续两次结果一致
- [ ] `docs/reviews/sim-determinism.json` 覆盖 3 个 seed 的 events/rng/state 三份哈希，且 `node scripts/check-sim-determinism.mjs --check` exit 0
- [ ] `npm test` 全绿

## DoD

- [ ] 门禁与见证工具零第三方依赖，Node ≥ 22.5 原生实现
- [ ] 债务文件按任务归属，五个拆分任务各自只删自己的文件
- [ ] `docs/PHASE_REFACTOR.md` §5/§6 与实现一致（含 `allow.d` 目录口径）
- [ ] 基线可在未改动的 worktree 上稳定复跑（两次哈希一致，无时间戳）

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
- `tasks/refactor-baseline-and-structure-gate.md`
