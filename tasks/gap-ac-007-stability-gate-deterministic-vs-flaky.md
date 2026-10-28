---
id: gap-ac-007-stability-gate-deterministic-vs-flaky
title: AC-007 复验：稳定性门禁区分确定性红与偶发红，并在 AC-044 修复面上 3 轮 exit 0
status: ready
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

- [ ] `node --test tests/check-stability.test.mjs` exit 0，新增用例覆盖上述六种 round 形状
- [ ] 失败夹具 `--rounds=2`：stderr 有两条 `CAUSE=full suite failed`、stdout 有 `红类：确定性红`、`--json` 的 `classification.kind === 'deterministic'`，且退出码仍为 1
- [ ] 通过夹具 `--rounds=2`：退出码 0，stdout 无 `红类：` 行，且不产生 `.quay/stability` 证据目录
- [ ] `node scripts/check-stability.mjs`（默认 3 轮、并发 2）exit 0，stderr 无 `CAUSE=`；Notes 记逐轮耗时与 `# tests / # pass / # fail`
- [ ] `npm test` exit 0
- [ ] `git diff` 只涉及 `scripts/check-stability.mjs`、`tests/check-stability.test.mjs`、`tasks/gap-ac-007-stability-gate-deterministic-vs-flaky.md`

## DoD

- [ ] AC-007 的 criterion 在最终 HEAD 上自证：`node scripts/check-stability.mjs` exit 0，Notes 记完整 stdout/stderr 与三轮读数，driver 下一轮可独立复算
- [ ] 红类归属是机读的且真实可执行：端到端用例里对**真实两轮失败**的夹具实测 `classification.kind === 'deterministic'`（不是只断言字符串出现），并在 Notes 记下本轮 `d7448a8` 失败面（三个 `.tap` 各 1 条同一 `not ok 322`）作为动机读数
- [ ] 门禁未被放宽：任一轮失败仍 exit 1；未改 `--rounds` / `--concurrency` / `--timeout-ms` 默认值；未新增任何忽略/豁免路径
- [ ] 不改 `scripts/docs-consistency.mjs` 与 `docs/PHASE_REFACTOR.md`（AC-044 的 lane）；不改任何运行时/玩家可见代码
- [ ] 零第三方依赖、Node ≥ 22.5 原生实现；未新增 `scripts/` 源文件（`scripts/test-changed.mjs` 的 TEST_MAP 已含 `check-stability.mjs` → `tests/check-stability.test.mjs`，无需改动）
- [ ] Notes 记下复用口径：此后 AC-007 复验先读 `classification`，再决定是「修套件」还是「查并发/隔离」

## Touches

- `scripts/check-stability.mjs`
- `tests/check-stability.test.mjs`
- `tasks/gap-ac-007-stability-gate-deterministic-vs-flaky.md`

## Notes

设计增量（按 CLAUDE.md 第 5 条，实现任务不写总文档，增量落任务 Notes）：`check-stability.mjs` 的职责从「跑 N 轮 + 报失败」扩为「跑 N 轮 + 报失败 + 归红类」。归类的判据是三段式而非二值：`all-pass` / `deterministic`（跨轮失败集恒定 ⇒ 套件坏点）/ `flaky`（跨轮不同 ⇒ 不稳定）。这条区分不改变门禁的通过标准（任何失败仍 exit 1），只改变失败被记录时的可归因性——它服务的是 AC-007 台账本身的可复算性。

依赖说明：`depends_on: gap-ac-044-full-suite-green` 是硬前置。`docs/PHASE_REFACTOR.md` 的计划态产物在 AC-044 的 planned 块口径完成前会让 `npm run check:docs` 持续 exit 1，本任务的 AC 与 DoD 都要求 `node scripts/check-stability.mjs` exit 0，在此之前 dispatch 只会白烧一轮。
