---
id: gap-ac-007-stability-gate-deterministic-vs-flaky
title: AC-007 复验：稳定性门禁区分确定性红与偶发红，并在 AC-044 修复面上 3 轮 exit 0
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/check-stability.test.mjs && npm test
depends_on:
  - gap-ac-044-full-suite-green
goal_ac: AC-007
---
## Proposal

AC-007（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `node scripts/check-stability.mjs`，expect `exit 0`。2026-10-28 复跑为假，且是**确定性红**：

- `node --no-warnings --test --test-concurrency=2 tests/*.test.mjs` → `# tests 1679 / # pass 1678 / # fail 1`，唯一失败为 `tests/docs-consistency.test.mjs:133`「真实仓库文档一致：check:docs 的判定为通过」。
- 直接量到失败面：`npm run check:docs` → exit 1，14 处「代码路径不存在」，全部来自 `docs/PHASE_REFACTOR.md`：`scripts/structure-budget.mjs`（5 处，行 5/40/75/110）、`scripts/structure-budget.allow.d/`（2 处，行 68/75）、`tests/structure-budget.test.mjs`（行 75）、`scripts/visual-parity.mjs`（2 处，行 76/114）、`docs/reviews/refactor-baseline.json`（行 76）、`scripts/check-sim-determinism.mjs`（2 处，行 77/113）、`docs/reviews/sim-determinism.json`（行 77）、`tests/lib/visual/`（行 99）。
- 稳定性门禁三轮失败面完全同构：`round-1-2026-10-28T12-27-49-633Z.tap`、`round-2-2026-10-28T12-28-13-743Z.tap`、`round-3-2026-10-28T12-28-37-748Z.tap` 各恰好 `1` 条 `not ok`，且是同一个用例（`not ok 322`）⇒ 这是「套件本身坏了」，不是「并发/时序不稳定」。

**根因归属**：`d7448a8`（docs lane 的 GOAL-009 计划正本）让 `docs/PHASE_REFACTOR.md` 先写出了尚未创建的产物路径，而 `docs-consistency` 把文档里每段反引号代码路径判为「现在必须存在」。**根因修复已由在飞任务 `gap-ac-044-full-suite-green`（ready，`goal_ac: AC-044`）拥有**——它给 `docs-consistency` 加 planned 块判定口径并给该文档打块标记。本任务**不重复**那处编辑，前置关系由 frontmatter `depends_on` 表达。

本任务收的是 AC-007 自己那一半、且目前无人拥有的缺口：**门禁无法区分「确定性红」与「偶发红」**。

- GOAL-002 的保证是「测试稳定 + 并发隔离」。`check-stability.mjs` 连跑 3 轮，但「三轮失败集完全相同」（本次：套件有确定性坏点）与「三轮失败集各不相同」（真正的稳定性/并发缺陷）得到的是同一个 verdict、同一条 `CAUSE=` 形状，跨轮差异只留在 `.tap` 原文里，没有被归成一类可机读的事实。
- 于是一次与稳定性无关的确定性红，会原样记进 AC-007 的台账，必须由人/立案者重新把整套 suite 的失败面翻一遍才能归因。**这个模式已经发生三次**：2026-10-27 `test-changed` 失效映射（`gap-ac-007-stability-gate-reverify`）、活任务库耦合（`gap-phase-ac-mapping-decouple-live-task-store`）、本轮计划态文档（本任务）。前两次各自修好了自己那个机制，而那都不是 AC-007 的机制。
- 判据要能被下一轮独立复算，就必须自带可机读的红类归属：先读 `classification`，再决定是「修套件」还是「查并发/隔离」。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：`gap-ac-044-full-suite-green`（ready，AC-044，Touches `scripts/docs-consistency.mjs` / `tests/docs-consistency.test.mjs` / `docs/PHASE_REFACTOR.md`）修的是**判定口径与计划态标记**，本任务不碰这三个文件；AC-007 的三个前序任务 `gap-stability-gate-evidence-and-startup-retry`（失败证据落盘 + 端口重试）、`gap-ac-007-stability-gate-reverify`（只读复验）、`gap-phase-ac-mapping-decouple-live-task-store`（活任务库解耦）均已 done，机制各不相同；本任务新增的机制是「**跨轮失败集的确定性/偶发性分类**」，与前四者互不替代。`task-granularity-advice --root /data/home/wenhao/abyss-tower --touches scripts/check-stability.mjs --touches tests/check-stability.test.mjs --json` 返回 `peers: []`、`mentions: []`，无合并候选。

## Plan

1. `scripts/check-stability.mjs`：新增**导出纯函数** `classifyRounds(rounds)`，输入 `summarizeRounds` 用的同一批 round 对象，输出 `{ kind, tests }`（全部 JSON 可序列化）：
   - 全部 `status === 'ok'` → `kind: 'all-pass'`；
   - 每一轮都失败，且各轮 `failedTests` 排序后逐轮完全相同 → `kind: 'deterministic'`（`tests` = 该失败集）；
   - 有失败轮但失败集跨轮不同，或有的轮通过、有的轮失败 → `kind: 'flaky'`；
   - 失败轮全是 `timeout` / `error` 时按 `(status, detail)` 判：跨轮完全相同 → `deterministic`，否则 `flaky`；
   - 失败轮里 `timeout/error` 与 `fail` 混类 → 一律 `flaky`（宁可指向并发/时序，不误报确定性）。
2. `runCheck` 把分类挂到 `report.classification`（`--json` 输出随之带上），文本报告在 `失败用例：` 之前追加一行：
   - `deterministic` → `红类：确定性红（跨轮失败集恒定，套件本身坏了，非稳定性缺陷）：<用例名…>`
   - `flaky` → `红类：偶发红（跨轮失败集不同 ⇒ 稳定性/并发隔离缺陷）`
   - `all-pass` → 不输出该行（现有通过路径的输出保持逐字不变）
   **退出语义不变**：任一轮失败仍 `process.exitCode = 1`；不新增豁免、不改 `--rounds` / `--concurrency` / `--timeout-ms` 的默认值。
3. `tests/check-stability.test.mjs`（沿用现有 `tempDir` / `writeTest` / `run` 夹具风格，不新增源文件）：
   - `classifyRounds` 纯函数用例六种：三轮全绿 / 两轮同一失败集 / 两轮失败集不同 / 一绿一红 / timeout 同 detail / timeout 异 detail；
   - 端到端确定性红：对现有 `FAILING` 夹具跑 `--rounds=2` → stderr 仍两条 `CAUSE=full suite failed`、stdout 含 `红类：确定性红`、`--json` 的 `classification.kind === 'deterministic'`、退出码仍 **1**（证明门禁没被放宽）；
   - 端到端通过：`PASSING` 夹具 `--rounds=2` → 退出码 0、stdout 无 `红类：` 行、`.quay/stability` 证据目录不产生（保持现有断言）。
4. 验证：`node --test tests/check-stability.test.mjs` exit 0；然后在 `gap-ac-044-full-suite-green` 已完成、`npm run check:docs` 已 exit 0 的树上逐字跑 AC-007 criterion `node scripts/check-stability.mjs`（默认 3 轮、并发 2）exit 0，逐轮读数与 `classification` 写进 Notes。

## AC

- [x] `node --test tests/check-stability.test.mjs` exit 0，新增用例覆盖上述六种 round 形状
- [x] 失败夹具 `--rounds=2`：stderr 有两条 `CAUSE=full suite failed`、stdout 有 `红类：确定性红`、`--json` 的 `classification.kind === 'deterministic'`，且退出码仍为 1
- [x] 通过夹具 `--rounds=2`：退出码 0，stdout 无 `红类：` 行，且不产生 `.quay/stability` 证据目录
- [x] `node scripts/check-stability.mjs`（默认 3 轮、并发 2）exit 0，stderr 无 `CAUSE=`；Notes 记逐轮耗时与 `# tests / # pass / # fail`
- [x] `npm test` exit 0
- [x] `git diff` 只涉及 `scripts/check-stability.mjs`、`tests/check-stability.test.mjs`、`tasks/gap-ac-007-stability-gate-deterministic-vs-flaky.md`

## DoD

- [x] AC-007 的 criterion 在最终 HEAD 上自证：`node scripts/check-stability.mjs` exit 0，Notes 记完整 stdout/stderr 与三轮读数，driver 下一轮可独立复算
- [x] 红类归属是机读的且真实可执行：端到端用例里对**真实两轮失败**的夹具实测 `classification.kind === 'deterministic'`（不是只断言字符串出现），并在 Notes 记下本轮 `d7448a8` 失败面（三个 `.tap` 各 1 条同一 `not ok 322`）作为动机读数
- [x] 门禁未被放宽：任一轮失败仍 exit 1；未改 `--rounds` / `--concurrency` / `--timeout-ms` 默认值；未新增任何忽略/豁免路径
- [x] 不改 `scripts/docs-consistency.mjs` 与 `docs/PHASE_REFACTOR.md`（AC-044 的 lane）；不改任何运行时/玩家可见代码
- [x] 零第三方依赖、Node ≥ 22.5 原生实现；未新增 `scripts/` 源文件（`scripts/test-changed.mjs` 的 TEST_MAP 已含 `check-stability.mjs` → `tests/check-stability.test.mjs`，无需改动）
- [x] Notes 记下复用口径：此后 AC-007 复验先读 `classification`，再决定是「修套件」还是「查并发/隔离」

## Touches

- `scripts/check-stability.mjs`
- `tests/check-stability.test.mjs`
- `tasks/gap-ac-007-stability-gate-deterministic-vs-flaky.md`

## Notes

设计增量（按 CLAUDE.md 第 5 条，实现任务不写总文档，增量落任务 Notes）：`check-stability.mjs` 的职责从「跑 N 轮 + 报失败」扩为「跑 N 轮 + 报失败 + 归红类」。归类的判据是三段式而非二值：`all-pass` / `deterministic`（跨轮失败集恒定 ⇒ 套件坏点）/ `flaky`（跨轮不同 ⇒ 不稳定）。这条区分不改变门禁的通过标准（任何失败仍 exit 1），只改变失败被记录时的可归因性——它服务的是 AC-007 台账本身的可复算性。

依赖说明：`depends_on: gap-ac-044-full-suite-green` 是硬前置。`docs/PHASE_REFACTOR.md` 的计划态产物在 AC-044 的 planned 块口径完成前会让 `npm run check:docs` 持续 exit 1，本任务的 AC 与 DoD 都要求 `node scripts/check-stability.mjs` exit 0，在此之前 dispatch 只会白烧一轮。

### 实现要点（2026-10-28，worktree `task/gap-ac-007-stability-gate-deterministic-vs-flaky`，已 merge develop）

- `scripts/check-stability.mjs` 新增两个导出纯函数：
  - `classifyRounds(rounds)` → `{ kind, tests }`，`kind ∈ all-pass | deterministic | flaky`。输入就是
    `summarizeRounds` 吃的那批 round 对象，返回值全部 JSON 可序列化（`tests` 已排序去重）：
    全部 `ok` ⇒ `all-pass`；有轮通过、有轮失败 ⇒ `flaky`；全部失败时，断言轮按排序后的 `failedTests`
    逐轮比对，完全相同 ⇒ `deterministic`；全部 `timeout`/`error` 时按 `(status, detail)` 元组比对；
    `timeout`/`error` 与断言失败混类一律 `flaky`（判据偏保守，不误报确定性）。
  - `classificationLine(classification)` → 文本报告的「红类：」行；`all-pass` 返回 `null`，所以通过路径的
    stdout 逐字不变。
- `runCheck` 把分类挂到 `report.classification`（`--json` 的 spread 输出随之带上），文本报告把红类行 splice
  在 `失败用例：` 之前（没有该行时追加末尾，覆盖纯 timeout/error 轮「无用例名」的场景）。
- **退出语义未动**：`if (!report.ok) process.exitCode = 1` 原样保留；`--rounds` / `--concurrency` /
  `--timeout-ms` 默认值未改（`DEFAULT_ROUNDS = 3`、并发仍取自 `npm test` 的 `--test-concurrency=2`）；
  未新增任何忽略/豁免分支。
- 未改 `scripts/test-stability.mjs`：红类行由 `check-stability.mjs` 对 `formatReport` 返回的行数组做插入，
  共用的格式化 API 与 `test-stability.mjs` 的输出保持不变。

### 验证证据（最终 HEAD `1f4da7b`，已 merge develop）

1. `node --test tests/check-stability.test.mjs` → **exit 0，17/17 通过**（原 8 例 + 新增 9 例）。六种 round
   形状各一例：三轮全绿 / 两轮同一失败集 / 两轮失败集不同 / 一绿一红 / 全 timeout 同 detail /
   全 timeout（error）异 detail；另有「timeout 与断言失败混类 ⇒ flaky」与 `classificationLine` 两例。
2. 确定性红端到端（`FAILING` 夹具，`--rounds=2`）：退出码 **1**；stderr 恰两条
   `CAUSE=full suite failed on run {1,2}`；stdout 含
   `红类：确定性红（跨轮失败集恒定，套件本身坏了，非稳定性缺陷）：稳定性夹具失败`，且该行在 `失败用例：`
   之前；`--json` 实测
   `{"ok":false,"classification":{"kind":"deterministic","tests":["夹具失败"]},"failed":2,"failureRate":1}`。
3. 通过端到端（`PASSING` 夹具，`--rounds=2`）：退出码 0、stdout 无 `红类：` 行、`.quay/stability` 证据目录不产生。
4. AC-007 criterion 逐字跑 `node scripts/check-stability.mjs`（默认 3 轮、并发 2）→ **exit 0，stderr 无 `CAUSE=`**：

       稳定性：3 轮 / 并发 2 / 193 个测试文件
         轮次 1: ✓ 通过 25.31s（1693 项）
         轮次 2: ✓ 通过 24.84s（1693 项）
         轮次 3: ✓ 通过 24.43s（1693 项）
       失败率：0.0%（0/3 轮失败）
       用例失败率：0.0%（0/5079 项）

   stderr 全文：`check-stability: 193 个测试文件，3 轮，并发 2`，随后三轮
   `check-stability: 第 {1,2,3}/3 轮 … {25.31,24.84,24.43}s（ok）`，无 `CAUSE=`。
   每轮 `# tests 1693 / # pass 1693 / # fail 0`（三轮合计即 5079 项 / 0 失败）。
5. `npm test` → exit 0，`# tests 1693 / # pass 1693 / # fail 0`。
6. `npm run check:docs` exit 0（21 个文件）；`npm run check:style` 215 文件通过；`node --check` 两个改动文件通过。

### 动机读数（为什么需要红类归属）

`d7448a8`（docs lane 的 GOAL-009 计划正本）让 `docs/PHASE_REFACTOR.md` 先写出尚未创建的产物路径，
`docs-consistency` 把每段反引号代码路径判为「现在必须存在」⇒ `tests/docs-consistency.test.mjs` 唯一失败。
当时的稳定性门禁三轮 `.quay/stability/round-{1,2,3}-2026-10-28T12-2*.tap` **各恰好 1 条 `not ok`，且是同一个
`not ok 322`** —— 跨轮失败集恒定，本就是确定性红；但门禁当时只给同一个 verdict，跨轮差异留在 TAP 原文里，
必须人工翻三轮证据才能归因。本任务的 `classification.kind` 就是把这条判据变成机读事实。

### 复用口径（此后 AC-007 复验照此办）

1. 先跑 criterion 本身；若非 0，先读 `--json` 的 `classification`（或文本报告的 `红类：` 行），再决定动作。
2. `deterministic` ⇒ **套件本身有确定性坏点**：按 `tests` 列出的用例逐条修，不要去查并发/时序；
   跨轮重跑必然同样失败。
3. `flaky` ⇒ **稳定性/并发隔离缺陷**：按 `.tap` 证据查端口/共享状态/时序，别去改断言。
4. `flaky` 但 `tests` 里能看到同集失败 ⇒ 先怀疑「混类归 flaky」的保守判据（超时与断言失败同时出现），
   按 detail 分别定位，不要直接判成真偶发。
