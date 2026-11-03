---
id: gap-ac-018-feel-effects-density
title: AC-018 复红：采样帧并发命中特效 5→3 跌破 feel 门禁，恢复 effects-active ≥4
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-018
---
## Proposal

AC-018（GOAL-005 退出条件「战斗场景机械指标：反馈覆盖、对比度、特效预算」）criterion 逐字为 `node scripts/visual-check.mjs --suite feel`，expect `exit 0`。本轮直接测量（非台账陈旧尾巴）exit 1：8 项 feel 指标里**只有 `effects-active` 一项红**——`✘ 同时存在的命中特效: 3（阈值 ≥ 4）`，其余 7 项全绿（反馈覆盖 0.0022 / 命中特效覆盖 0.0010 / 受击闪白 0.0007 / 飘字覆盖 0.0006 / 飘字条数 2 / ΔE 17.4 / 特效预算 3 ≤ 320）。两次独立采集读数一致（ledger evidence 2026-11-03T10:45Z 与本 agent 复跑均 3）——该值是固定种子下 `sim.effects.length` 的确定性读数，不是计时测量，**不是同机负载噪声**。

**为什么此前修复没守住**：`gap-ac-018-feel-reverify`（done，`goal_ac: AC-018`）是只读见证——它只在 AC-019 harness 修复 `a9f9b22` 落地后的 HEAD 上重跑 criterion 并记录 exit 0（当时「命中特效 5」）。它从未拥有「命中特效密度」这一层，也没有任何代码能兜住它。此后 sim 战斗改动落地，把采样帧 t=8s 的并发命中特效从 5 压到 3，跌破 `THRESHOLDS.feel.minActiveEffects = 4`。

**机制**：`feelMetrics`（`tests/lib/visual/metrics.mjs`）读 `payload.effects = sim.effects.length`，采样点是 `combat-impact` 帧（`COMBAT_TIMELINE` 的 t=8s）。每次弹道命中产一个 `spark`（`public/js/sim/projectile-system.js`，ttl 0.15s），故该帧的并发命中特效 = 最近 0.15s 内的命中数——对节奏漂移天然脆弱（`tests/visual-scenarios.mjs:40` 已有注释承认「帧只在固定时刻采样，短特效 muzzle 0.1s / spark 0.15s 会被漏掉」）。最可疑的因果提交是 `5a0e68e`（fix(sim): 塔开火时重选 progress 最大目标——每发都重选队首敌人、火力向最靠基地的怪集中，同窗口并发命中变少）；次选 `88b3ee0`（塔空手时自动攻击资源矿脉）。两者都是合法玩法修复、不是 bug、不可回滚；feel 门禁的 `minActiveEffects: 4` 是 VIS-001 按旧索敌行为实测 5 校准的，对新合法节奏已过期。

**修法约束（本 repo 惯例，见 VIS-001 / gap-background-atmosphere-gate 的 DoD）**：不得为转绿下调 `minActiveEffects`，不得删除/阉割 `effects-active` 检查。二选一，优先前者：

1. **恢复命中特效密度（优先、轻量）**：sim 表现层让采样窗口内并发命中特效回到 ≥4——如命中 `spark` 的 ttl 适当加长（0.15→~0.22s）或每命中补一个低预算次级表现特效；只改表现层，不改伤害/胜负/模拟结果/RNG 调用顺序，`effect-budget`（≤320，现 3）不越线。
2. **让见证对节奏漂移稳健（次选、与既有 infra 对齐）**：把 `effects-active` 从「t=8s 单帧瞬时计数」改为「采样窗口内的峰值并发命中特效」（复用 `tests/visual-scenarios.mjs` 的 `trace.maxEffects` 逐步累计口径）；这更贴近「命中特效覆盖率」语义，属度量语义变更，必须在 Notes 证明它仍在特效被整体删除时变红（count→0 必红），且不得顺带下调任何阈值。

## AC

- [ ] `node scripts/visual-check.mjs --suite feel` exit 0，且 `effects-active`（同时存在的命中特效 ≥ 4）为 ok（AC-018 本体判据）
- [ ] `node --test tests/visual-check.test.mjs` exit 0（改动 `scripts/lib/visual-metrics.mjs` / `tests/lib/visual/metrics.mjs` 度量口径时同步更新/新增单测）
- [ ] `npm test` exit 0（全量 suite，含模拟确定性用例——修复不得改变 RNG 调用序列/模拟结果）
- [ ] `git diff -- scripts/lib/visual-metrics.mjs` 中 `minActiveEffects` 未下调（无 diff，或 Notes 给出「真实反馈回归」证据与依据）
- [ ] Notes 记录因果归因：`git log --oneline a9f9b22..HEAD -- <相关 sim 文件>` 定位 5→3 的落地提交，写明 hash 与 `git show --stat` 摘要；存疑时在嫌疑提交父节点重跑 feel 确认读数 5

## DoD

- [ ] 真实浏览器连续 2 次 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite feel` exit 0，每次读数（effects-active 数值 + 8 项 ok 表）写入 Notes
- [ ] 修复只改表现层：同 seed 模拟结果与 RNG 调用序列不变（确定性用例全绿），不引入第三方依赖
- [ ] 门禁语义未被放宽：特效整体删除时 `effects-active` 必红（count 0 < 4）；`effect-budget` ≤ 320 不越线；`minActiveEffects` 未下调
- [ ] 落地 diff 只含 `## Touches` 声明文件，`git status --short` 无本任务相关未提交改动

## Touches

- `public/js/sim/projectile-system.js`
- `scripts/lib/visual-metrics.mjs`
- `tests/lib/visual/metrics.mjs`
- `tests/lib/visual/session.mjs`
- `tests/visual-check.test.mjs`
- `tasks/gap-ac-018-feel-effects-density.md`

## Notes

立案依据（2026-11-03，本 agent 直接测量，非台账陈旧尾巴）：criterion `node scripts/visual-check.mjs --suite feel` exit 1，唯一红项 `effects-active`（同时存在的命中特效 3 < 4）。复跑读数与本轮 ledger evidence（2026-11-03T10:45Z）一致，均 3——确定性回归。

待 worker 补充：因果归因 hash、修复方式（方向 1/2）、连续 2 次 feel 读数、`npm test` 结果。若实际 Touches 与本声明有出入（如未改动 `tests/lib/visual/session.mjs`），须 task_write 修正再 fan-in。
