---
id: gap-ac-045-static-checks-green
title: 静态检查链收口：四命令单点定义 + CI 阻塞 + 漂移钉子（AC-045）
status: ready
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/static-gate.test.mjs && npm run check:static
depends_on:
  - gap-ac-044-full-suite-green
  - refactor-baseline-and-structure-gate
goal_ac: AC-045
---
## Proposal

GOAL-009 的 AC-045（`npm run check:syntax && npm run check:imports && npm run check:style && npm run check:docs`，expect exit 0）
没有任何任务用 `goal_ac` 认领。实测四段里只有 `check:docs` 红（14 处，全部来自 `docs/PHASE_REFACTOR.md` 的计划态产物），
`check:syntax` / `check:imports`（185 文件 505 依赖，无越层无环）/ `check:style`（215 文件）已绿 —— 也就是说
「命令现在是红的」这一半的根因（计划态产物的判定口径）已经有归属，不需要本任务重做。

本任务要收的是另一半、且目前完全无主的缺口：**这条链没有单一出口，也没有进 CI**。

- `check:static` 不存在：AC-045 判据在 `docs/PHASE_REFACTOR.md` §7 手写一遍，`verify:local` 用不同顺序（syntax → style →
  imports → version → docs）再手写一遍，两者靠人工保持一致。
- CI 只跑 `npm test` 与一段自写的 `--input-type=module --check` 语法循环 —— 即 `check:imports`（越层依赖/环）与
  `check:style` 在自动化里**完全缺席**。GOAL-009 要在 R1–R5 五个并行任务里搬动 24 个 ≥600 行的文件，
  `check:imports` 正是唯一能机械挡住「拆分把 render 层拆出越层依赖或新环」的门禁；它不在 CI 里，
  等于重构期最核心的静态门禁只靠人手跑 `verify:local`，一旦漏跑就是静默回归。

本任务做三件事：把四命令定义在一处（`check:static`）、让 CI 跑它（语法检查同时从两套实现收敛为一套）、
用测试把「判据 / 脚本 / CI」三处机械对齐并带负对照。不改 `check:docs` 的判定口径（不动 `scripts/docs-consistency.mjs`），
不创建 R0 的结构预算/视觉/确定性产物，不改任何运行时行为。

<!-- dedup-ref -->
机制去重与粒度决策：`gap-ac-044-full-suite-green`（goal_ac AC-044）负责 `check:docs` 的计划态产物块级豁免，
`refactor-baseline-and-structure-gate`（goal_ac AC-043）负责结构预算与见证工具并把自身接入 CI；本任务的机制是
「静态四命令的单点定义 + CI 接线 + 漂移钉子」，与两者互不替代，故**不合并**：折叠进任一任务都会让 AC-045 重新变成无主缺口。
它只在 `package.json`、`.github/workflows/ci.yml` 两个文件上与 AC-043 任务重叠（该任务已 ready、先落地），
调度按 Touches 串行即可；本任务新增的文件仅 `tests/static-gate.test.mjs`。

## Plan

1. `package.json`：新增 `"check:static": "npm run check:syntax && npm run check:imports && npm run check:style && npm run check:docs"`，
   顺序与 AC-045 判据逐字一致，作为四命令的唯一字面定义。`verify:local` 保持原样（它是更宽的人审门，含 version/test/coverage），
   只由测试断言两者不漂移。
2. `.github/workflows/ci.yml`：把自写的 `--input-type=module --check` 循环替换为单步 `npm run check:static`。
   覆盖从「只查语法」扩到「语法 + 导入图 + 风格 + 文档」，实现从两份收敛为一份；仍只用 `actions/checkout` + `actions/setup-node`，零第三方依赖。
3. `tests/static-gate.test.mjs`（新增，纯结构断言 + 负对照，不跑全量扫描）：
   - (a) `package.json` 的 `check:static` 拆出的四段与顺序 == AC-045 判据列表；
   - (b) `check:static` 的每条 `npm run check:*` 都出现在 `verify:local` 里（子集断言，防止只改一处）；
   - (c) `ci.yml` 含 `npm run check:static` 步骤，且不再含 `--input-type=module --check`；
   - (d) 负对照（临时 fixture 改文本再断言，不是只匹配字符串）：删 `check:static` 任一段 → (a) 红；
     删 `verify:local` 的 `check:imports` → (b) 红；从 `ci.yml` 删该步骤 → (c) 红。
4. 验证：在依赖落地后的树上跑 `npm run check:static` exit 0 且连续两次一致；`npm test` exit 0。

## AC

- [ ] `npm run check:static` exit 0，且在同一棵树上连续两次执行结果一致（无偶发红）
- [ ] `node --test tests/static-gate.test.mjs` 全绿，且 4 条负对照（删 check:static 任一段 / 删 verify:local 的 check:imports / 删 CI 步骤）各自使对应用例转红
- [ ] `.github/workflows/ci.yml` 中存在 `npm run check:static` 步骤，且全文不再出现 `--input-type=module --check`
- [ ] `check:static` 的四段与顺序逐字等于 AC-045 判据（`npm run check:syntax` → `check:imports` → `check:style` → `check:docs`），由测试机械断言
- [ ] `npm run verify:local` 仍覆盖四命令的全部四条（测试子集断言），CI 与 `verify:local` 之间不因本任务产生缺口
- [ ] `npm test` exit 0，用例数只增不减
- [ ] `git diff` 只涉及 Touches 的四个文件，无运行时/玩家可见代码改动，无第三方依赖

## DoD

- [ ] 四命令在仓库里只有一处字面定义（`package.json` 的 `check:static`）；CI 改为调用它后，语法检查不再有第二套 `--input-type=module --check` 实现
- [ ] 漂移钉子真实可执行：在临时 fixture 上删掉任一段，测试由绿转红（不是「断言文本里出现过某字符串」的弱检查）
- [ ] 三个入口（AC-045 判据 / `check:static` / CI 步骤）由测试机械对齐；未来任一处改动漏改另一处会立即红
- [ ] `npm run check:static` 连续两次 exit 0，`npm test` exit 0 —— 在依赖（docs 判定口径、R0 门禁产物）已落地的树上实测，不是预判
- [ ] 零第三方依赖、Node ≥ 22.5 原生实现；不改 `scripts/docs-consistency.mjs` 的判定语义，不改任何玩家可见行为
- [ ] Notes 记下口径：`check:static` 是 AC-045 的唯一执行入口，后续阶段的 `docs/PHASE_<主题>.md` 引用静态门禁时写它，不再手抄四命令

## Touches

- `package.json`
- `.github/workflows/ci.yml`
- `tests/static-gate.test.mjs` (new)
- `tasks/gap-ac-045-static-checks-green.md`
