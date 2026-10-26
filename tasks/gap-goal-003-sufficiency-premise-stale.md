---
id: gap-goal-003-sufficiency-premise-stale
title: GOAL-003 退出条件覆盖裁定：AC-008/AC-009 已越权写入目标库，两条合取项均已覆盖（勿再加重复 AC）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: grep -q '^## 退出条件' goals/GOAL-003-*.md && grep -q
    '普通/每日/本周/无尽/变异模式都能选到三张固定图' tests/fixed-maps-server.test.mjs
goal_ac: AC-008
---
## Proposal

GOAL-003（地图 2.0：三张固定可复用地图与可破坏物）的退出条件是一个合取式，原文逐字为：

> `node --test tests/fixed-maps.test.mjs tests/fixed-maps-server.test.mjs tests/destructibles.test.mjs` 全通过，且三张地图可在普通/每日/本周/无尽/变异中开局。

**结论先行：当前该合取式的两个合取项都已有在域 AC 见证，且 witness 可执行通过——不存在未被覆盖的部分。本任务 ⛔ 不提议新增 AC（新增只会与 AC-008 重复），提议的处置是请人核定后把这条 `insufficient` follow-up 以「前提失效」关闭。**

派发给我时的快照（prompt 原文）称：

> (NONE — the goal body carries no non-empty `## 退出条件` section. That absence is ITSELF why the mechanical layer judged `insufficient`, without ever consulting the semantic judge.)

并称在域 AC 只有 AC-003 一条。该快照对应 `.quay/goal-round.jsonl` 的 4 轮（03:34:41Z–03:37:25Z，每轮 `sufficiency=insufficient（在域 AC 1 条）`）。按台账 `since=03:34:41.264Z` + `elapsed=215485ms` 反推，prompt 生成于 ≈03:38:17Z——恰在下面这次批量写入之前：

- `goals/GOAL-003-*.md` 的 mtime 是 2026-10-26T03:38:28Z，当前该文件已含非空 `## 退出条件` 节。用 goal-driver 的 `extractSections` 同款正则对当前 body 实测，可抽出上面引用的整段全文（`hasExitConditions` 现为 true）。⇒ `insufficient` 的**形式原因**（机械层走「退出条件从未写下」短路，语义判官从未被调用）已消失。这与兄弟任务 `gap-goal-001-exit-condition-test-coverage` / `gap-goal-002-exit-condition-stability-gate-coverage` 记录的同一批次修复一致（把压平的行内 `退出条件：…` 补回 `## 退出条件` 标题）。
- AC-008「三张固定图在普通/每日/本周/无尽/变异中开局一致」与 AC-009「可破坏物拆除：模拟/渲染/点击/刷新保持」于 2026-10-26T03:38:50Z 激活，与 AC-005/006/007/010 同属 03:38:50–03:39:03Z 那次**任务 ABI 之外**的批量写入（兄弟任务已记录该批次）。
- 此后没有跑过任何一轮 goal 判定（`goal-round.jsonl` 仅 4 行，末轮 03:37:25Z），所以 `insufficient` 是对旧输入的判定，不是对当前 AC 集的判定。

**逐合取项覆盖映射（当前库状态）：**

1. 「`node --test tests/fixed-maps.test.mjs tests/fixed-maps-server.test.mjs tests/destructibles.test.mjs` 全通过」
   → **AC-003**，criterion 与该命令逐字相同，expect `exit 0`；status=achieved，evidence=`acceptance passed (exit 0)` @ 2026-10-26T03:38:05Z。
2. 「三张地图可在普通/每日/本周/无尽/变异中开局」
   → **AC-008**，criterion=`node --test tests/fixed-maps-server.test.mjs`，expect `exit 0`。该文件的测试「普通/每日/本周/无尽/变异模式都能选到三张固定图」对 normal/daily/weekly/endless/mutated 五模式逐个建局，断言 `ruleset.mapPool === 'fixed-v1'`、候选 id 顺序 `canyon→twin→ring`、固定 trait 与共享池一致，并实际选图。本立案时实跑该 criterion：**exit 0，6/6 pass**。
3. （范围项，退出条件未直接要求）可破坏物点击拆除并影响局面
   → **AC-009**，criterion 覆盖 `destructibles` / `destructibles-sim` / `destructibles-ui` 三文件。本立案时实跑：**exit 0，35/35 pass**。

**因此人的决策不是「新增 AC」，而是就既有的 AC-008/AC-009 三选一（不要再加第二条）：**

1. **认可 AC-008 + AC-009（推荐）**——不改目标库。GOAL-003 的在域 AC = AC-003（achieved）+ AC-008 + AC-009，与退出条件两个合取项一一对应；机械层不再短路，充分性键从台账里的 `de714050…` 变为新值，stall 计时按新实例重置，下一轮由语义判官重判。
2. **调整 AC-008 的 criterion**——例如只跑该文件里那条五模式测试（`--test-name-pattern`）以缩小失败面；但整文件跑更保守，除非有明确理由，不建议。
3. **supersede AC-008 / AC-009**——须同时说明为什么退出条件的对应合取项不应有目标级 AC（例如只在任务级 MAP-00x 验收）。

**备注（非提案，不阻塞上面的处置）：** 退出条件里写死的三文件命令不含 `tests/destructibles-sim.test.mjs` / `tests/destructibles-ui.test.mjs`，而范围节要求可破坏物「点击拆除…影响金币/塔属性/敌人/基地」，这两项交互恰由 AC-009 的另两个文件见证——退出条件比范围窄。若人希望退出条件自身见证交互，可另立任务把命令扩为五文件；这不会改变本任务的充分性结论（AC-009 已覆盖）。

<!-- dedup-ref --> 关联但不同机制：`gap-goal-001-exit-condition-test-coverage` 与 `gap-goal-002-exit-condition-stability-gate-coverage`（均 needs-human）处理 GOAL-001/GOAL-002 的同批次越权写入，目标与 AC 都不同；本任务只裁定 GOAL-003。合并候选检查：以本任务 Touches 跑 `task-granularity-advice --root /data/home/wenhao/abyss-tower` 返回 peers=[]、mentions=[]。

## Touches

- `goals/GOAL-003-地图-2-0-三张固定可复用地图与可破坏物.md`
- `goals/AC-008-三张固定图在普通-每日-本周-无尽-变异中开局一致.md`
- `goals/AC-009-可破坏物拆除-模拟-渲染-点击-刷新保持.md`
- `tests/fixed-maps-server.test.mjs`
- `tests/destructibles.test.mjs`
- `tests/destructibles-sim.test.mjs`
- `tests/destructibles-ui.test.mjs`
- `tasks/gap-goal-003-sufficiency-premise-stale.md`

## Acceptance Criteria

- [ ] 复核目标库现状：`goal_list goal=GOAL-003` 的在域 AC 含 AC-003、AC-008、AC-009，且 `grep -q '^## 退出条件' goals/GOAL-003-*.md` 为真
- [ ] 五模式 witness 可执行通过：`node --test tests/fixed-maps-server.test.mjs` exit 0（本立案时实测 exit 0 / 6 pass）
- [ ] 可破坏物 witness 可执行通过：`node --test tests/destructibles.test.mjs tests/destructibles-sim.test.mjs tests/destructibles-ui.test.mjs` exit 0（本立案时实测 exit 0 / 35 pass）
- [ ] 记录 AC-008 与 AC-009 最近一次 gate 结果（`.quay/gate-events.jsonl` 中对应 item_id 的最新 verdict；若无，跑 `quay goal gate AC-008 --json` / `AC-009` 补一条）(待外部)
- [ ] 人在 Notes 记录裁定：认可 AC-008 + AC-009 / 调整 criterion / supersede (待外部)

## Definition of Done

- [ ] GOAL-003 的目标级 AC 集合与退出条件两个合取项一一对应，AC-008/AC-009 的去留已在目标库体现 (待外部)
- [ ] 下一轮 `goal-round` 中 GOAL-003 不再因「无 `## 退出条件`」短路，且充分性键已随 body + AC 集合变化而重置 (待外部)
- [ ] 本任务自身未写 goal-store：立案过程只读 `goal_get` / `goal_list`，未调用 `goal_write`，也未改 `goals/*.md`；任何 goal 文件改动均可归因于 driver 下一轮 flip，而非本任务
