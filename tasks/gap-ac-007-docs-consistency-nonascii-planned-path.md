---
id: gap-ac-007-docs-consistency-nonascii-planned-path
title: AC-007 复验：docs-consistency 误报 docs/TODO.md 计划态路径（未打 planned 标记 + 非 ASCII 截断）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/docs-consistency.test.mjs && npm test
goal_ac: AC-007
---
## Proposal

AC-007（GOAL-002「测试稳定性与并发隔离」）criterion 逐字为 `node scripts/check-stability.mjs`，expect `exit 0`。2026-11-03 三轮全部 fail，且失败面完全相同——唯一失败用例 `tests/docs-consistency.test.mjs:321`「真实仓库文档一致：check:docs 的判定为通过」。直接量到失败面（本 agent，2026-11-03）：`analyzeDocs(ROOT).problems` 返回 1 条 `docs/TODO.md:135: 代码路径不存在 -> docs/PHASE_`。根因有两层：

- `docs/TODO.md` 第 135 行（爬塔设计草案「落地顺序」）用反引号引用了计划态未来文件 `docs/PHASE_爬塔.md`。该文件尚不存在（同文件第 122 行「待 docs lane 出 PHASE 冻结表」），且**未包进 `<!-- docs-consistency:planned-start/end -->` 块**，于是 docs-consistency 的代码路径存在性检查把它判为缺失。
- 叠加一个此前从未修过的截断缺陷：`scripts/docs-consistency.mjs` 的 `REPO_PATH_RE` token 字符类 `[A-Za-z0-9._/*-]` 是 ASCII-only，遇到中文「爬」即停，把 `docs/PHASE_爬塔.md` 截成 `docs/PHASE_` 再判存在性——即便将来文件真的落地，check 仍会把截断前缀误报为缺失。

修复两层：① `docs/TODO.md` 把该计划态路径放进 planned 块（沿用 `docs/PHASE_META.md` / `docs/PHASE_REFACTOR.md` 已建立的豁免机制，planned 块只豁免代码路径存在性）；② `scripts/docs-consistency.mjs` 的 `REPO_PATH_RE` 字符类加入非 ASCII（CJK）区间，让含中文的路径整段捕获，并补 fixture 用例证明「存在即不误报、缺失即报全名」而非截断。

## AC

- [x] `node --test tests/docs-consistency.test.mjs` exit 0（docs-consistency 全绿，含「真实仓库文档一致：check:docs 的判定为通过」）
- [x] `node -e "import('./scripts/docs-consistency.mjs').then(m=>process.exit(m.analyzeDocs(process.cwd()).problems.length?1:0))"` exit 0（真实仓库零 problem，无 `docs/TODO.md:135` / `docs/PHASE_` 误报）
- [x] `docs/TODO.md` 计划态路径 `docs/PHASE_爬塔.md` 位于 `<!-- docs-consistency:planned-start -->` 与 `<!-- docs-consistency:planned-end -->` 之间（`grep -n` 定位两标记行号夹住该路径所在行）
- [x] `scripts/docs-consistency.mjs` `REPO_PATH_RE` 支持非 ASCII（CJK）路径字符，新增 fixture 用例证明含中文路径「存在不误报、缺失报全名」而非截断成 `docs/PHASE_`
- [x] `node scripts/check-stability.mjs` 连续 3 轮 exit 0（AC-007 本体判据）

## DoD

- [x] 落地于 `docs/TODO.md`、`scripts/docs-consistency.mjs`、`tests/docs-consistency.test.mjs`，不引入第三方依赖
- [x] 回归测试覆盖 planned 块豁免与含中文路径整段捕获（存在/缺失两态）
- [x] `npm test` 全绿；`node scripts/check-stability.mjs` 3 轮 exit 0
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `docs/TODO.md`
- `scripts/docs-consistency.mjs`
- `tests/docs-consistency.test.mjs`
- `tasks/gap-ac-007-docs-consistency-nonascii-planned-path.md`

## Notes

立案 2026-11-03，本 agent 直接测量（非台账陈旧尾巴）：`node -e "import('./scripts/docs-consistency.mjs').then(m=>console.log(m.analyzeDocs(process.cwd()).problems))"` → `["docs/TODO.md:135: 代码路径不存在 -> docs/PHASE_"]`；最近三轮 `.tap`（`round-3-2026-11-03T08-11-06-336Z` / `08-07-40` / `07-59-53`）各恰好 1 条 `not ok 389`，失败面完全相同 ⇒ 确定性红，非并发/时序抖动。

实现 2026-11-03：① `docs/TODO.md` 落地顺序路径包进 planned 块（起止标记夹住 `docs/PHASE_爬塔.md` 所在行）；② `scripts/docs-consistency.mjs` 新增 `CJK_PATH_CHARS`（U+4E00–U+9FFF + U+3400–U+4DBF）并入 `REPO_PATH_RE` 字符类；③ `tests/docs-consistency.test.mjs` 新增「含中文路径整段捕获」fixture。验证：`node --test tests/docs-consistency.test.mjs` 12/12 全绿、`analyzeDocs` 零 problem、`node scripts/check-stability.mjs` 3 轮 exit 0（1894 项/轮）。

<!-- dedup-ref --> 机制去重（mechanism-based，非症状关键词）：`goal_ac: AC-007` 的既有任务——`gap-stability-gate-evidence-and-startup-retry`（证据落盘+端口重试）、`gap-ac-007-stability-gate-reverify`（TEST_MAP 失效映射只读复验）、`gap-phase-ac-mapping-decouple-live-task-store`（活任务库解耦）、`gap-ac-007-stability-gate-deterministic-vs-flaky`（确定性/偶发分类）、`gap-ac-007-hex-flow-relic-default-flaky-test`（hex-flow flake）——全部 done 且机制各不相同。「计划态路径 → docs-consistency 误报」这一机制此前由 `gap-ac-044-full-suite-green`（done）建立 planned 块豁免并用于 `docs/PHASE_REFACTOR.md`；本轮同类问题在 `docs/TODO.md` 再现（2026-11-03 爬塔草案新写的 `docs/PHASE_爬塔.md` 未打 planned 标记），并叠加一个全新的**非 ASCII 路径截断**缺陷（`REPO_PATH_RE` 字符类 ASCII-only），这是此前任何任务都没碰过的独立机制。`task-granularity-advice --root /data/home/wenhao/abyss-tower --touches docs/TODO.md scripts/docs-consistency.mjs tests/docs-consistency.test.mjs --json` → `peers: []`（无 open 任务声明这些文件），单独立案。