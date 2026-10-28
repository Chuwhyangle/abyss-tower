---
id: gap-goal-009-debt-clear-ac
title: GOAL-009 充分性缺口：退出条件第一条的「债务登记清空」无在域 AC 可读（提案新增 AC-051）
status: needs-human
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-009（结构性重构：拆分长文件与结构门禁）的退出条件是合取式。第一条原文逐字为：

> 结构预算门禁通过，且债务登记 `scripts/structure-budget.allow.json` 清空（数据文件豁免除外）。

**未被覆盖的部分（逐字）：「且债务登记 `scripts/structure-budget.allow.json` 清空（数据文件豁免除外）」。**

**为什么现有 AC 集不覆盖它**

在域 AC 共 6 条（AC-043 / 044 / 045 / 046 / 048 / 049；`.quay/goal-round.jsonl` round 2915 逐字记录 `sufficiency=insufficient（在域 AC 6 条）`）。唯一提到债务登记的是 AC-043：title 写着「结构预算门禁通过且债务登记清空」，criterion 是 `node scripts/structure-budget.mjs --check`，expect exit 0，已于 `2026-10-28T14:28:22.558Z` 判为 `achieved`。

这条 criterion 对合取式的第二个合取项是**结构性盲的**：在 `scripts/structure-budget.mjs` 里，债务条目正是「超限文件的许可证」——`over-budget` 只在「超过预算**且未登记**债务」时报出（`runCheck` 的 `lines > limit` 分支：`if (!entry) violations.push(...over-budget)`），登记了就能过。于是 `--check` exit 0 与「债务登记为空」不是同义，而是相反方向：今天实测

```
$ node scripts/structure-budget.mjs --check
structure-budget: OK（434 个源文件，运行时 172 / 工具 249 / 豁免 13，债务 16 条，1328 条依赖，无环）
EXIT=0
```

即门禁绿、AC-043 已 `achieved`，而债务 16 条仍分布在 `scripts/structure-budget.allow.d/` 的 6 个文件里（`loadDebt()` 实测 `files 6, entries 16`）。这不是「还没跑起来」，是判据本身读不到那个合取项：**目标可以在债务一条未清的情况下把第一条退出条件当作已满足**。

同一件事在三处各有半边，正好凑成一次漏读：
- `docs/PHASE_REFACTOR.md:73`：「任务完成即删自己的文件，最终目录必须为空（数据豁免除外）」；
- `docs/PHASE_REFACTOR.md` §7 表 AC-043 行写「结构预算通过、债务登记为空（数据豁免除外）」，但「命令」列只有 `--check`；
- `scripts/structure-budget.mjs` 的 `parseArgs` 实测只认 `--check / --root / --budget-lines / --budget-tool-lines / --json / --help`，没有任何「要求登记为空」的开关，所以今天**不存在**任何现成入口能量这个合取项。

另外，退出条件文本点名的是 `scripts/structure-budget.allow.json`（单个文件），实测 `test -e` → `absent`；实现是 `scripts/structure-budget.allow.d/<owner>.json`（一个任务一个文件）。提案按实现口径给判据，避免让人的裁定去追一个不存在的路径。

清空这件事有没有人做：有——`refactor-closeout`（`todo`，`goal_ac: AC-043`）的 AC 第 2 条就写着「`node scripts/structure-budget.mjs --check` exit 0，`allow.d/` 仅剩数据豁免（空目录或删除）」，R1–R5 五条拆分任务目前仍是 `ready`。缺的不是执行者，是**目标级的读数**：AC-043 今天已经绿了，清空与否在目标层不再有任何信号；R6 若半途停手，goal 依然显示六条在域 AC 全绿。

（注：本任务只处理「清空清单」。退出条件第四条（视觉像素逐帧一致 + `visual-check --suite all`）的覆盖缺口由已在飞的 `gap-goal-009-visual-suite-ac`（`needs-human`，提案 AC-050）承载，本任务不重复提出。）

**提案：为 GOAL-009 新增一条 AC-051（AC-050 已被在飞提案占用；实测 `goals/` 与 `tasks/` 均无 AC-050 / AC-051 的实体）**

- id：`AC-051`
- title：债务登记清空（数据豁免除外）
- criterion：`node -e "import('./scripts/structure-budget.mjs').then(m=>{const d=m.loadDebt();process.exit(d.entries.size===0&&d.problems.length===0?0:1)})"`
- expect：`exit 0`
- origin：GOAL-009 退出条件第一条「结构预算门禁通过，且债务登记 … 清空（数据文件豁免除外）」的后半句（前半句由 AC-043 承载）

**为什么这条 AC 覆盖了缺口**

1. **同义，且复用实现的唯一定义点**：criterion 不自己数文件，而是调 `structure-budget.mjs` 导出的 `loadDebt()`——债务目录 `DEBT_DIR`、条目解析、`entries` / `problems` 的口径全在脚本里，判据与门禁不可能各说各话。空目录与 `{"entries":[]}` 两种「清空」形态都实测解析为 `entries 0`。
2. **今天可激活，不受 bootstrap 冻结**：criterion 引用的 `scripts/structure-budget.mjs` 已存在且导出 `loadDebt`（R0 `refactor-baseline-and-structure-gate` 已 `done`），不引用任何待建产物，不会落入 AC-047 那种 `criterion-capability-unevaluable` 冻结。
3. **双向活性实测，不是预判**：
   - 今天：`EXIT=1`（`entries 16 / files 6`）——如实为红，因为清空还没发生；
   - 清空态：临时根下建空 `allow.d/` → `entries 0 / problems 0` → 判据为绿；`{"entries":[]}` 同样为绿。
   红绿两侧都由真实执行验证过。
4. **与 AC-043 是互补而非重复**：AC-043 读门禁（行数 / 无环 / 纯度，债务登记在则是许可），AC-051 读债务清单为空；两条合起来才是退出条件第一条的合取式。删掉任一条都会留下今天这个漏读。
5. **它是 R6 的收口见证**：`refactor-closeout` 清空后这条自然转绿；若 R6 停在中途，目标层会持续显示 AC-051 红，而不是六条全绿。

建议随本提案一并由人裁定、但**不由本任务执行**：把退出条件文本里的 `scripts/structure-budget.allow.json` 更正为 `scripts/structure-budget.allow.d/`（文档 lane 的活，与 AC-049 的单一入口口径一致）。

**本提案刻意不做什么**

- 不写 goal store、不改 `goals/*.md`、不动 AC-043 的状态——AC 集合由人决定。
- 不替代 AC-043，也不把 AC-043 的判据改成合取式：那会让一条已 `achieved` 的 AC 变成红，语义上是新判据冒充旧判据；新增一条更诚实。
- 不新增 npm 脚本：`package.json` 现由 `gap-ac-045-static-checks-green`（`ready`）持有；且「判据引用未落地入口」正是 AC-047 被冻结的成因。等那条完成后再收成 `check:structure:debt-empty`。
- 不覆盖视觉缺口（见上，由 `gap-goal-009-visual-suite-ac` 承载）。

<!-- dedup-ref -->
机制去重与粒度决策：
- `refactor-closeout`（`todo`，`goal_ac: AC-043`）**清空**债务（干活）；本提案**读**清空（见证）。机制不同，文件也不同（它改 `allow.d/*.json` 与渲染文件，本提案只动 §7 表与漂移钉子）；`task-granularity-advice` 报的唯一 peer 就是它，判 **separate**（调度按 Touches 串行即可，不合并）。
- `refactor-baseline-and-structure-gate`（`done`）建门禁与债务目录，明确不含「要求为空」的模式（`parseArgs` 无此开关），故不覆盖。
- `gap-goal-009-visual-suite-ac`（`needs-human`）提的是退出条件第四条的可视套件缺口（AC-050）：子句不同、命令不同、失败模式不同，判 **separate**，不做同一提案的合并；两边都只提一条，互不重复。
- 立案前检查：`grep -rn 'goal_ac: AC-051' tasks/*.md` 无输出；没有任何 open 任务提出过「债务登记为空」的目标级 AC。

## AC

- [ ] criterion 双向活性：仓库根实跑 `node -e "import('./scripts/structure-budget.mjs').then(m=>{const d=m.loadDebt();process.exit(d.entries.size===0&&d.problems.length===0?0:1)})"` → exit 1，且 `loadDebt()` 读数 `entries 16 / files 6`；临时根下空 `allow.d/` → exit 0
- [ ] `node scripts/structure-budget.mjs --check` 今天 exit 0 且输出含「债务 16 条」——证明 AC-043 的判据对合取第二项是盲的
- [ ] `test ! -e scripts/structure-budget.allow.json && echo absent` 输出 `absent`（退出条件文本路径陈旧，提案按 `allow.d/` 口径给判据）
- [ ] `! grep -q 'require-empty\|debt-empty' scripts/structure-budget.mjs`（无匹配即 exit 0：今天不存在现成的「要求登记为空」开关）
- [ ] 提案正本可复核：Proposal 逐字引用退出条件第一条、round 2915 的 `sufficiency=insufficient（在域 AC 6 条）`、`--check` 的实测输出行
- [ ] 人裁定记录写入 Notes：认可新增 AC-051（推荐）/ 调整 criterion / 拒绝并说明该合取项如何由现有 AC 承载（待外部）
- [ ] 裁定为「认可」时，`docs/PHASE_REFACTOR.md` §7 表新增 AC-051 行，且 `tests/phase-refactor-sync.test.mjs` 的 `PHASE_ACS` 集合扩到含 AC-051（该测试断言 §7 恰好覆盖 AC-043…AC-049 各一次，新增 AC 必然要同步）（待外部）

## DoD

- [ ] 判据是「读数」而不是「预判」：`loadDebt()` 今天实跑 exit 1、清空态实跑 exit 0，两侧命令与原始输出都记进 Notes
- [ ] 缺口边界说清：Proposal 明写 AC-051 只承担退出条件第一条的后半句，前半句仍在 AC-043；不声称本提案让 GOAL-009 立刻 `covered`
- [ ] 不误伤已有绿灯：不改 AC-043 的 criterion、不动 `package.json`、不动 `scripts/structure-budget.mjs`
- [ ] 与在飞任务的机制边界有 `dedup-ref` 记录（清空 vs 读清空；第一条后半句 vs 第四条）
- [ ] 本任务不改 goal store（`goals/*.md` 0 改动）、不 mark 任何 GOAL 或 AC 的状态
- [ ] 人裁定记录写入 Notes（认可 / 调整 / 拒绝及理由），并据此决定是否落地 AC-051 与 §7 那一行（待外部）

## Touches

- `docs/PHASE_REFACTOR.md`
- `tests/phase-refactor-sync.test.mjs`
- `tasks/gap-goal-009-debt-clear-ac.md`
