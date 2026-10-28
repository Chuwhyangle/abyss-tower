---
id: gap-feel-sim-diff-evidence
title: 同 seed 模拟一致性：伤害事件日志 + RNG 序列 diff
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/feel-sim-diff.test.mjs
goal_ac: AC-020
---
## Proposal

FEEL-001 的评审者（E.8）要求：用伤害事件日志与 RNG 调用序列 diff 判定「同一 seed 在 before/after 间逐字节一致」。当前只有静态帧与快照计数，没有可复现的事件级证据；评审据此把「同 seed 一致性」列为阻塞。

本任务新增一个确定性对比工具与一份落盘结论，不修改战斗数值与表现。

## Plan

1. 新增 `scripts/feel-sim-diff.mjs`：在固定 seed 下跑指定场景，输出三份 JSON——结构化命中事件序列、RNG 调用序列摘要、终局状态哈希。
2. 支持对比两个产物目录（before/after 各跑一次），逐项 diff 并给出 exit code：一致 exit 0，任何差异 exit 1 并打印第一处差异。
3. 反向断言：人为改动 RNG 序列时工具必须报红，防止「永远 exit 0」的空转。
4. 用该工具对比 `3b8e1fd` 与当前 HEAD（after），把结论写入 `docs/reviews/feel-sim-diff.md`；若发现真实分叉，如实记录并立案。
5. 加测试覆盖：一致/不一致/产物缺失三种路径。

## AC

- [ ] `node scripts/feel-sim-diff.mjs --scene combat --seed visual-fixed-seed --out /tmp/feel-sim-diff` exit 0，产出 events/rng/state 三份 JSON
- [ ] 对两个产物目录执行 diff：一致时 exit 0，任何差异时 exit 1 且打印第一处差异
- [ ] `node --test tests/feel-sim-diff.test.mjs` 全绿，且含「RNG 序列变化必须报红」的反向断言
- [ ] `docs/reviews/feel-sim-diff.md` 记录 before/after 对比结论（一致或分叉，附命令与哈希）

## DoD

- [ ] `npm test` 全绿
- [ ] 工具不改变模拟结果（对比工具只读运行，不改 `public/js/**`）
- [ ] 结论可用于关闭 FEEL-001 的「30/30 vs 68」疑点，或给出真实分叉的立案依据

## Touches

- `scripts/feel-sim-diff.mjs` (new)
- `tests/feel-sim-diff.test.mjs` (new)
- `docs/reviews/feel-sim-diff.md` (new)
- `scripts/test-changed.mjs`
- `docs/PHASE_FEEL_ART.md`
- `tasks/gap-feel-sim-diff-evidence.md`

## Notes

`public/js/shared/floaters.js:119` 的 `mergeFloaterText` 已解释飘字 30+38→68 的展示层求和；本任务要证明的是模拟事件与 RNG 本身是否一致，两者不要混为一谈。

### 实现记录（2026-10-28）

- 工具契约：`--scene/--seed/--out` 产出 events/rng/state；`--diff 左 右` 一致 exit 0 / 差异 exit 1（打印首个 JSON 路径 + 两侧取值）/ 用法错误 exit 2；`--root <源码树>` 让**同一份采集代码**跑任意历史检出，before/after 不存在「两边工具不同」的嫌疑。
- 旁路接线只读：`RNG.prototype._next` 与 `sim.damage` / `sim.skillDamage` 各包一层记录器，底层返回值原样透传、不产生任何随机数、不改调用顺序；测试里有一条 mtime 断言守住「不改 `public/js/**`」。
- 事件字段口径：只记物理可观测的量（时间 / 目标 / 入参 / 扣血前后 / 暴击 / 持续伤害 / 致死），**不记** `weapon` / `source` 这类版本间新增的纯标注字段——否则「新增标注」会被误判成模拟分叉。
- 踩坑一：`startedAt: 0` 会退化成墙钟（`opts.startedAt || Date.now()`），两次运行的状态哈希因此不同；固定值必须用真值（取 1）。`toSnapshot()` 的 `savedAt` 是唯一读墙钟的字段，必须剔除。
- 踩坑二：场景必须自带 `crit` 遗物，否则暴击率为 0、`combatRng` 在本场景空跑，「RNG 序列一致」只剩波次生成，证明力不足。
- 结论：`3b8e1fd` ↔ HEAD 在 `visual-fixed-seed` / `feel-sim-diff-seed-b` / `feel-sim-diff-seed-c` 三个 seed 上 events / rng / state 三份哈希逐字节相等，**无分叉**；命令与哈希见 `docs/reviews/feel-sim-diff.md`。
- `scripts/test-changed.mjs`：新增 `scripts/` 源文件必须登记 TEST_MAP（审计覆盖），否则全量套件会在「存在未覆盖源文件」那条红。
- `docs/PHASE_FEEL_ART.md`：develop 上 `docs-phase-sync` 的「AC 映射缺少 open 任务」本来就已红（5 个 AC-020 支撑任务缺 id，本任务也是其中之一）；此次在 AC-020 行后补一行支撑任务说明，未改动任何 AC 语义，也未触碰 PRD / TECH_DESIGN。
