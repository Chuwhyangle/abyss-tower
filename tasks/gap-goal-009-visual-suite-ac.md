---
id: gap-goal-009-visual-suite-ac
title: GOAL-009 充分性缺口：`visual-check --suite all` 通过无在域 AC（提案新增 AC-050）
status: todo
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-009（结构性重构：拆分长文件与结构门禁）的退出条件是合取式。第四条原文逐字为：

> 视觉像素与重构前逐帧一致，且 `visual-check --suite all` 通过。

**未被覆盖的部分（逐字）：「`visual-check --suite all` 通过」。**

在域证据：round 2894（`2026-10-28T12:11:54.792Z`）的 `goal-sufficiency` 事实逐字为 `sufficiency=insufficient（在域 AC 4 条）`，那 4 条是 AC-044 / AC-045 / AC-048 / AC-049，**不含任何一条提到这条命令**。

**为什么现有 AC 集不覆盖它**

- 全库唯一在 criterion 里提到这条命令的是 AC-047：`node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all`（`docs/PHASE_REFACTOR.md:114`）。它当前是 `draft`，不在在域集合内。
- 它不是「还没被激活过」，而是**被目标库拒绝激活**。round 2894 的 `flips` 逐字记录（日志本身截断）：
  `write exit 2: goal-store: write failed: cannot activate AC-047: criterion-capability-unevaluable: criterion refused BEFORE execution — it is not a reading. uncertifiable-executed-artifact: scripts/visual-parity.mjs`
  拒绝单位是**整条 criterion 字符串**：`scripts/visual-parity.mjs` 实测不存在（`test ! -e` 通过），于是整条被判「能力不可确立」，连同一行里**确实存在、今天就是绿**的 `scripts/visual-check.mjs --suite all` 一起被冻结。AC-043 与 AC-046 是同一死法（`scripts/structure-budget.mjs`、`scripts/check-sim-determinism.mjs`）。
- 所以这条子句的在域覆盖是 **0**：它唯一的载体，是一个在 R0 落地前永远无法激活的 AC；而 `scripts/visual-parity.mjs` 正是 R0（`refactor-baseline-and-structure-gate`，`ready`）的交付物。结果是「视觉门必须绿」（`docs/PHASE_REFACTOR.md:56`：「fan-in 时全量测试与视觉像素门必须绿」）这条要求，在最需要它的 R1–R5 拆分期恰恰没有任何目标级见证。
- 也没有任务会补上它：round 2894 的 `gap_spawns` 为 AC-044 / AC-045 / AC-049 各立了一个 owner 任务，而**至今没有任何任务带 `goal_ac: AC-047`**（`grep -rn 'goal_ac: AC-047' tasks/*.md` 为空）。红的那三条有人管，被冻结的这条没人管。

**提案：为 GOAL-009 新增一条 AC（AC-050；AC-001…AC-049 已占用，实测 `goals/` 无 AC-050、`tasks/` 无引用）**

- id：`AC-050`
- title：视觉回归套件通过：feel / art / ui / mobile 四套件全 PASS
- criterion：`npm run visual:check`
- expect：`exit 0`
- origin：GOAL-009 退出条件第四条：「视觉像素与重构前逐帧一致，且 `visual-check --suite all` 通过。」的后半句

**为什么这条 AC 覆盖了缺口**

1. **判据与子句同义且是现成入口**：`package.json` 里 `visual:check` = `node scripts/visual-check.mjs --suite all`（实测）。criterion 引用仓库已有的唯一入口，不新增任何脚本或基线。
2. **今天就能被激活**：criterion 引用的两个 token（`npm`、该 npm 脚本）都解析得到，不存在「能力不可确立」的路径——与 AC-043/046/047 的冻结机制正相反。激活后它进在域集合，sufficiency 判定即可看见这条子句。
3. **实跑证据，不是预判**：2026-10-28 在主检出（HEAD `d7448a8`）连跑两次 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run visual:check`，两次都 `EXIT=0` + `结论：通过`，feel / art / ui / mobile 四套件全 PASS（例：反馈覆盖 0.0026 ≥ 0.002；背景亮度层次 15 ≥ 6；最小可见字号 12 ≥ 12；横屏横向溢出 0 ≤ 1）。
4. **它是 AC-047 的补集，不是子集**：`docs/PHASE_REFACTOR.md:120-121` 自己写着「R0 的 `visual-parity` 是逐帧哈希，不是阈值」——parity 对照的是重构前基线（必须 R0 先采集），四套件判的是 feel/art/ui/mobile 的阈值指标（今天就能跑）。机制不同、失败模式不同；AC-047 的 parity 臂仍然只能等 R0。
5. **它会在整段重构期持续看守**：进入在域集合后，goal-driver 每轮复核在域 AC，任何一次拆分把某个套件打红都会以 achieved-but-failing 暴露出来，而不是等 R6 收口才发现。

建议随本提案一并由人裁定、但**不由本任务执行**：把 AC-047 收窄为只判 parity（`node scripts/visual-parity.mjs --check`），避免同一条命令每轮跑两次。

**本提案刻意不做什么（避免误读）**

- **它不会让 GOAL-009 立刻变成 `covered`**。退出条件第一条（结构预算 + 债务清空）与第三条（模拟确定性哈希）仍只由 AC-043 / AC-046 承载，它们与 AC-047 的 parity 臂一样，被「判据里引用的脚本尚未存在」冻结，要等 R0 落地才可激活。本提案收的是其中**唯一一条今天就能进在域集合**的子句，其余是已知的顺序依赖，不是缺失的判据。
- 不写 goal store、不改 `goals/*.md`、不动 AC-043/046/047 的状态——AC 集合由人决定。

<!-- dedup-ref -->
机制去重与粒度决策：`refactor-baseline-and-structure-gate`（AC-043，`ready`）创建 `structure-budget` / `visual-parity` / `check-sim-determinism` 三件见证工具与基线；`gap-ac-049-phase-doc-ownership-sync`（AC-049，`todo`）钉住 §7 的 AC↔命令表。两者都不做「把一条今天可运行的门禁从被冻结的 AC 里拆出来」这件事，故判定 **separate**；此前也没有任何任务为 GOAL-009 提过 AC 集合或退出条件的修改（`.quay/goal-sufficiency-followup.json` 中 GOAL-009 的 `filedAt` 为 `null`）。文件侧检查（`task-granularity-advice --root /data/home/wenhao/abyss-tower --touches docs/PHASE_REFACTOR.md --touches tasks/gap-goal-009-visual-suite-ac.md --json`）返回 `peers` = gap-ac-044-full-suite-green / gap-ac-049-phase-doc-ownership-sync / refactor-baseline-and-structure-gate / refactor-closeout，共享文件只有 `docs/PHASE_REFACTOR.md` 一个；提案被认可时 §7 只需加一行，调度按 Touches 串行即可。

## AC

- [ ] `node -e "const s=require('./package.json').scripts['visual:check'];process.exit(s==='node scripts/visual-check.mjs --suite all'?0:1)"` exit 0（criterion 引用的入口存在且与退出条件同义）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run visual:check` 连续两次 exit 0，两次输出都是 `结论：通过`，且 feel / art / ui / mobile 四行均 `PASS`
- [ ] `test ! -e scripts/visual-parity.mjs && echo absent` 输出 `absent`（复核 AC-047 的冻结原因仍然成立：parity 半臂的产物尚未存在）
- [ ] `grep -rn 'goal_ac: AC-047' tasks/*.md` 无输出（立案前这条子句在任务库里确实没有 owner）
- [ ] 提案正本可复核：Proposal 里逐字引用退出条件第四条后半句、round 2894 的 `sufficiency=insufficient（在域 AC 4 条）`、以及 AC-047 的 `cannot activate` 原文
- [ ] 人裁定记录写入 Notes：认可新增 AC-050（推荐）/ 调整 criterion / supersede 并说明该子句为何不需要目标级 AC（待外部）
- [ ] 裁定为「认可」时，`docs/PHASE_REFACTOR.md` §7 表新增 AC-050 行（`npm run visual:check`）；§7 的编辑权当前归 `gap-ac-049-phase-doc-ownership-sync`（待外部）

## DoD

- [ ] 提案给的是**可执行判决**：criterion 是仓库现成入口（`npm run visual:check`），不新增脚本/基线，激活不受 bootstrap 依赖阻塞
- [ ] 实跑证据落盘：两次 `npm run visual:check` 的输出（四套件 PASS + `结论：通过`）连同立案时间点记进 Notes
- [ ] 冻结原因逐字记录而不是转述：AC-047 的 `criterion-capability-unevaluable … scripts/visual-parity.mjs` 原文进 Proposal，供后续同类 AC 复用这条教训——criterion 里**不要**把「今天就能跑的门禁」和「尚未存在的产物」用 `&&` 串成一条
- [ ] 缺口边界说清：Proposal 明写本提案**不**使 goal 变为 `covered`，剩余 AC-043 / AC-046 / AC-047-parity 的冻结是 R0 顺序依赖，不是缺失判据
- [ ] 本任务不改 goal store（`goals/*.md` 0 改动）、不改 AC-043/046/047 状态、不改 `package.json`
- [ ] 人裁定记录写入 Notes（认可 / 调整 / 拒绝及理由），并据此决定是否落地 AC-050 与 §7 那一行（待外部）

## Touches

- `docs/PHASE_REFACTOR.md`
- `tasks/gap-goal-009-visual-suite-ac.md`
