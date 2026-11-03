---
id: gap-ac-007-stability-gate-reverify-nonascii-landed
title: AC-007 复验：非 ASCII 截断修复落地后稳定性门禁连续 3 轮 exit 0
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/check-stability.mjs
goal_ac: AC-007
---
## Finding

AC-007（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `node scripts/check-stability.mjs`，expect `exit 0`。2026-11-03 台账记录该门禁三轮全部 fail（evidence `at` 2026-11-03T08:31:37Z），三轮失败面完全一致，唯一失败用例 `真实仓库文档一致：check:docs 的判定为通过`（`tests/docs-consistency.test.mjs:321`），断言消息 `docs/TODO.md:135: 代码路径不存在 -> docs/PHASE_`——即 `docs/PHASE_爬塔.md` 被 ASCII-only 的 `REPO_PATH_RE` 截成 `docs/PHASE_` 后误报缺失。

立案前本 agent 在被评估 HEAD 上直接复测（非台账陈旧尾巴）：

- `node --test tests/docs-consistency.test.mjs` → 12/12 全绿，exit 0（含「真实仓库文档一致：check:docs 的判定为通过」）。
- `npm run check:docs` → `docs-consistency: 文档一致性检查通过（24 个文件）`，exit 0。
- `node scripts/check-stability.mjs` → **exit 0**，3 轮 / 并发 2 / 208 个测试文件，逐轮 1894 项全过，0/5682 失败。

即 criterion **当前为真**，本轮红读数早于修复落地：修复提交 `57858cc fix(docs-consistency): 修复非 ASCII 路径截断与 TODO.md 计划态路径误报`（2026-11-03T08:26:14Z）同时修了 CJK 截断与 TODO.md planned 豁免两层，并已在 main（fan-in `b6afcbf`，2026-11-03T08:29:36Z）与 develop 两侧（`git merge-base --is-ancestor 57858cc <branch>` 均 YES）；而红的 `.tap` 证据 `round-1-2026-11-03T08-29-46-181Z.tap` 是修复落地前那一刻的树上生成的——红读数与修复落地同轮赛跑、读数早于 fan-in。因此此前声明 `goal_ac: AC-007` 的实现任务 `gap-ac-007-docs-consistency-nonascii-planned-path`（done）的修复**已守住**，不是「修复未守住」。

<!-- dedup-ref --> 机制去重（mechanism-based，非症状关键词）：`goal_ac: AC-007` 的既有任务——`gap-ac-007-docs-consistency-nonascii-planned-path`（done，本轮红的正主实现，已落地）、`gap-ac-007-stability-gate-reverify`（done，TEST_MAP 只读复验）、`gap-phase-ac-mapping-decouple-live-task-store`（done，活任务库解耦）、`gap-ac-007-stability-gate-deterministic-vs-flaky`（done，确定性/偶发分类）、`gap-ac-007-hex-flow-relic-default-flaky-test`（done，hex-flow flake）、`gap-stability-gate-evidence-and-startup-retry`（done，证据落盘+端口重试）——全部 done 且机制各不相同。本任务是「非 ASCII 截断修复落地后」的只读复验见证（Touches 仅自身），不重复任何一处编辑。`task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-007-stability-gate-reverify-nonascii-landed.md --json` → `peers: []`、`mentions: []`、`substantiveInputs: []`，无合并候选。

## AC

- [ ] `node scripts/check-stability.mjs` 在被评估 HEAD 上 exit 0（逐字执行 criterion，记录 3 轮读数与退出码）
- [ ] 同一 HEAD 上第二次 `node scripts/check-stability.mjs` 亦 exit 0（共 6 轮，stderr 无 `CAUSE=`）
- [ ] `git merge-base --is-ancestor 57858cc HEAD` exit 0（修复提交已在被测 HEAD 上）
- [ ] Notes 记录每次调用的退出码、逐轮 `# tests / # pass / # fail` 与耗时；若出现非零轮，另记 `.tap` 路径、`not ok` 用例名与 failureType

## DoD

- [ ] 连续 6 轮读数在 Notes 中可被 driver 下一轮独立复算并复现
- [ ] 门禁判定语义未被放宽：仍「任一轮失败 → exit 1」，未调 `--rounds` / `--concurrency`
- [ ] 本任务 commit 只含 `tasks/gap-ac-007-stability-gate-reverify-nonascii-landed.md`，无源码/产品行为/玩法/数值改动、无第三方依赖

## Touches

- `tasks/gap-ac-007-stability-gate-reverify-nonascii-landed.md`

## Notes

立案依据（2026-11-03，本 agent 在被评估 HEAD 上直接测量，非台账陈旧尾巴）：台账红读数 evidence `at` 2026-11-03T08:31:37Z，红 `.tap` 证据 `round-1-2026-11-03T08-29-46-181Z.tap`（`status: fail`，唯一 `not ok 389 - 真实仓库文档一致：check:docs 的判定为通过`，断言消息 `docs/TODO.md:135: 代码路径不存在 -> docs/PHASE_`）。修复提交 `57858cc` 于 2026-11-03T08:26:14Z 落地，fan-in `b6afcbf` 于 2026-11-03T08:29:36Z 合入 main，`git merge-base --is-ancestor 57858cc main` 与 `... develop` 均 YES。立案前复测：`node scripts/check-stability.mjs` → exit 0（3 轮 / 并发 2 / 208 个测试文件，逐轮 1894 项，0/5682 失败）；`node --test tests/docs-consistency.test.mjs` → 12/12 全绿；`npm run check:docs` → 通过（24 个文件）。

本任务为 AC-007 的只读复验/见证任务，不改仓库代码；机制修复的正主 `gap-ac-007-docs-consistency-nonascii-planned-path` 已 done 且落地。