---
id: gap-ac-044-full-suite-reverify-landed-fix
title: AC-044 复验：planned 块修复并入主线后 `npm test` exit 0（台账上一轮失败读数早于 fan-in）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: npm test
goal_ac: AC-044
---
## Proposal

AC-044（GOAL-009「结构性重构：拆分长文件与结构门禁」）的 criterion 逐字为 `npm test`，expect `exit 0`。台账最后一次读数（2026-10-28T13:06:51.695Z）为假：`# tests 1679 / # pass 1678 / # fail 1`，exit 1。唯一失败面是 `not ok 322 - 真实仓库文档一致：check:docs 的判定为通过` —— `docs/PHASE_REFACTOR.md` 是 GOAL-009 的计划正本，其中按设计尚未创建的产物路径被 `docs-consistency` 判成「现在必须存在」（`scripts/structure-budget.mjs`、`scripts/visual-parity.mjs`、`scripts/check-sim-determinism.mjs`、`tests/lib/visual/` 等 14 条）。

**为什么上一轮的修复没能让台账变真 —— 是读数早于落地，不是回归**：

- 修复提交 `6103528`（`feat(docs): docs-consistency 支持计划态产物的块级豁免（AC-044）`）提交于 2026-10-28 20:50:49 +0800（= 12:50:49Z），当时**只存在于任务分支 `task/gap-ac-044-full-suite-green`**；merge target 的 tip 仍是 `27c57d3`（`d7448a8` 计划正本那棵树，尚无块级豁免）。
- 台账读数 13:06:51Z 跑的是 merge target 那棵树，所以必然红；机械 fan-in 到 13:08:22Z（`eba1eeb`）才把 `6103528` 并进来 —— 读数比落地早了约 90 秒。
- 落地后再没有任何任务声明 `goal_ac: AC-044`（`grep -l '^goal_ac: AC-044' tasks/*.md` 只命中 `gap-ac-044-full-suite-green`，已 done），也就没人按原命令重读一次，假读数一直留在台账里，AC-044 因此被继续判假。

**立案时实测（HEAD `60d2804`，main == develop）**：`npm test` 连跑两次均为 `# tests 1684 / # pass 1684 / # fail 0`（24.1s / 24.0s），`npm run check:docs` exit 0（21 个文件）。测试数由 1679 增至 1684，正是 `6103528` 给 `tests/docs-consistency.test.mjs` 补的 5 个 planned 块 fail-closed 用例。即判据**此刻为真**，缺的不是再修一遍，而是一个按 criterion 重读、把读数写回可复算位置的归属任务。

本任务因此是**只读见证**：不改任何生产 / 脚本 / 文档代码，只按 criterion 原命令重读并记录读数；若真出现红，如实记失败面并按既有门禁处理，绝不放宽门禁换取绿。

<!-- dedup-ref --> 机制去重（mechanism-based，非症状关键词）：`goal_ac` 是单值标量，在飞的 `gap-ac-005-full-suite-reverify-planned-blocks`（AC-005）、`gap-ac-002-full-suite-3x-reverify-planned-blocks`（AC-002）、`gap-ac-007-stability-gate-deterministic-vs-flaky`（AC-007）、`gap-ac-049-phase-doc-ownership-sync`（AC-049）各自只声明自己的 `goal_ac`，折叠进它们任何一个都会让 AC-044 重新落成无主缺口，且它们的 Touches 已分属别的文件 lane。本任务 Touches 只有自身任务文件，与四者零文件重叠；`node <plugin>/scripts/dist/task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-044-full-suite-reverify-landed-fix.md --json` 返回 `peers: []`、`mentions: []`。结论：独立立案、不合并。

## Plan

1. 按 criterion 逐字重跑：`npm test`（= `node --test --test-concurrency=2 tests/*.test.mjs`），记录 HEAD sha、`# tests / # pass / # fail`、`# duration_ms` 与退出码；**连跑 2 次**，两次都绿才写结论（区分「偶发绿」与「确定性绿」）。
2. 复算上一轮的唯一红面：`npm run check:docs` exit 0；并只读核对 `docs/PHASE_REFACTOR.md` 里 `docs-consistency:planned-start` 与 `docs-consistency:planned-end` 的出现次数相等（结构配对，不改文件）。
3. 若出现红：先取唯一失败用例名，再读 `.quay/stability/round-*.tap` 的跨轮失败集判定「确定性红 / 偶发红」（AC-007 的 `classification` 落地后直接读它）。**不新增 skip、不豁免、不改 `package.json` 的 `test` 脚本**；把读数写进 Notes 后 retreat，并另立缺口承接该新红类。
4. 记录并发上下文：同期 AC-005 / AC-002 见证任务可能在跑同一套 suite（`--test-concurrency=2` 且都用临时目录 / 端口）。若首轮出现端口或临时目录类失败，记录首轮读数后重试一次，两轮读数与判断依据都写进 Notes，不掩盖、不删证据。
5. 收尾：确认 `git diff` 只含本任务文件；把读数写进 Notes 供 driver 下一轮独立复算。

## AC

- [x] `npm test` 在当前 HEAD exit 0；Notes 记 HEAD sha、两次运行的 `# tests / # pass / # fail` 与 `# duration_ms`
- [x] `npm run check:docs` exit 0，Notes 记「21 个文件」那一行原文（对应上一轮唯一红面 `not ok 322`）
- [x] `grep -c 'docs-consistency:planned-start' docs/PHASE_REFACTOR.md` 与 `planned-end` 计数相等，Notes 记该读数
- [x] Notes 记时序证据：`6103528` 12:50:49Z 在任务分支 → 台账读数 13:06:51Z（merge target 未含该提交）→ fan-in `eba1eeb` 13:08:22Z，说明上一轮为假是读数早于修复到达 merge target
- [x] `git diff` 只涉及 `tasks/gap-ac-044-full-suite-reverify-landed-fix.md`
- [x] 若本轮出现红：Notes 记唯一失败用例名 + 确定性 / 偶发红的判定依据 + 首轮读数，且未新增任何 skip / 豁免（本轮无红，条件不触发）

## DoD

- [x] AC-044 的 criterion 在最终 HEAD 上自证：Notes 含 `npm test` 的完整尾段（`1..N` 到 `# duration_ms`）与退出码，下一轮 driver 可直接复算
- [x] 读数是本任务真实执行的：两次 `npm test` 与一次 `npm run check:docs` 均为本轮实跑输出，不是引用台账或历史 `.tap`
- [x] 门禁未被放宽：未新增 skip / 忽略 / 豁免路径，未改 `package.json` 的 `test` 脚本，未改任何测试文件
- [x] 零代码改动：生产 / 运行时 / 玩家可见代码零变更；未新增 `scripts/` 或 `tests/` 源文件（因此不涉 `scripts/test-changed.mjs` 的 TEST_MAP 登记）
- [x] 不碰他人 lane：`scripts/docs-consistency.mjs`、`tests/docs-consistency.test.mjs`、`docs/PHASE_REFACTOR.md`、`scripts/check-stability.mjs`、`tests/check-stability.test.mjs` 零改动
- [x] 若红：不做局部修补换取绿，Notes 记失败面与归因后 retreat，并说明需要新缺口承接（本轮无红，条件不触发）
- [x] Notes 写清复用口径：此后 AC-044 复验先看「修复是否已到 merge target」再判断红绿，避免再把「读数早于落地」误记为回归

## Touches

- `tasks/gap-ac-044-full-suite-reverify-landed-fix.md`

## Notes

### 本轮读数（worktree `task/gap-ac-044-full-suite-reverify-landed-fix`，HEAD `15fca2a29b114a18acdb6d18eec54cd94d8f38d8`，node v22.23.2，develop 未前进、合并为 Already up to date）

**1) `npm test`（= `node --test --test-concurrency=2 tests/*.test.mjs`）连跑 2 次，两次都绿：**

第 1 轮 exit 0，尾段：

```
1..1684
# tests 1684
# suites 0
# pass 1684
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 24482.108605
```

第 2 轮 exit 0，尾段：

```
1..1684
# tests 1684
# suites 0
# pass 1684
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 24258.50657
```

→ 判定：**确定性绿**（两轮均 `# fail 0`、`# skipped 0`、`# todo 0`，无端口 / 临时目录类失败，无并发干扰迹象）。

**2) `npm run check:docs` exit 0**，原文行：

```
docs-consistency: 文档一致性检查通过（21 个文件）
```

上一轮唯一红面 `not ok 322 - 真实仓库文档一致：check:docs 的判定为通过` 在本 HEAD 上不再复现。

**3) planned 块结构配对（只读 grep）：**

- `grep -c 'docs-consistency:planned-start' docs/PHASE_REFACTOR.md` → `5`
- `grep -c 'docs-consistency:planned-end' docs/PHASE_REFACTOR.md` → `5`

计数相等（5 = 5）。

**4) 时序证据 —— 上一轮为假是「读数早于修复到达 merge target」，不是回归：**

- 修复提交 `6103528`（`feat(docs): docs-consistency 支持计划态产物的块级豁免（AC-044）`）时间 2026-10-28T20:50:49+08:00 = **12:50:49Z**，当时只存在于任务分支 `task/gap-ac-044-full-suite-green`，merge target tip 仍为 `27c57d3`（不含块级豁免）。
- 台账读数 **13:06:51Z** 跑的是 merge target 那棵树 ⇒ 必然红（1678/1679，唯一失败 `not ok 322`）。
- 机械 fan-in `eba1eeb`（`tasks: 翻 gap-ac-044-full-suite-green done（driver 机械 fan-in）`）时间 2026-10-28T21:08:22+08:00 = **13:08:22Z** 才并入 `6103528` ⇒ 读数比落地早约 90 秒。
- 本轮只读复核：`git merge-base --is-ancestor 6103528 develop` 成立（已是 develop 祖先）；`git log -1 -- scripts/docs-consistency.mjs` 当前最新提交即 `6103528`。
- 旁证（非本任务读数来源）：`goal_get AC-044` 现为 `status: achieved`，evidence `at 2026-10-28T13:17:15.026Z`、`verdict: pass`，与本轮自跑一致。本任务结论只用本轮实跑读数。

**5) 失败面与门禁：**

本轮全绿，无唯一失败用例需记录，也无确定性 / 偶发红的判定需要给。未新增任何 skip / 忽略 / 豁免，未改 `package.json` 的 `test` 脚本，未改任何测试文件 —— 门禁零放宽。

**6) 改动面：**

`git diff develop` 只含 `tasks/gap-ac-044-full-suite-reverify-landed-fix.md`（由 `task_write` 写入）。生产 / 运行时 / 玩家可见代码零改动；未新增 `scripts/` 或 `tests/` 源文件（不涉 `scripts/test-changed.mjs` 的 TEST_MAP 登记）；他人 lane（`scripts/docs-consistency.mjs`、`tests/docs-consistency.test.mjs`、`docs/PHASE_REFACTOR.md`、`scripts/check-stability.mjs`、`tests/check-stability.test.mjs`）零改动。

**7) 复用口径（供后续 AC-044 复验）：**

此后 AC-044 复验**先看「修复是否已到 merge target」再判断红绿**：拿到台账或 `.tap` 读数后，先比 `git log -1 --format='%cI' -- <修复文件>` 与读数 `at`，再用 `git merge-base --is-ancestor <修复 commit> <merge target>` 确认是否已落地；读数早于落地一律记「读数早于修复到达 merge target」，不得记为回归，也不得据此重开修复。真红时按 Plan 第 3 步取唯一失败用例名 + 跨轮失败集判确定性，写清后 retreat 并另立缺口承接；**不以 skip / 豁免 / 改 test 脚本换绿** 的底线不变。