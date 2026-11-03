---
id: gap-ac-018-feel-window-sampling
title: AC-018 复红：feel 门禁单瞬时采样撞上特效空窗（t=8s effects=0），改窗口峰值口径
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

AC-018（GOAL-005 退出条件「战斗场景机械指标：反馈覆盖、对比度、特效预算」）criterion 逐字为 `node scripts/visual-check.mjs --suite feel`，expect `exit 0`。本轮直接测量（非台账陈旧尾巴）exit 1，8 项 feel 指标 4 红 4 绿：

- ✘ 反馈覆盖 0.0015（≥ 0.002）／命中特效覆盖 0（≥ 0.0003）／受击闪白覆盖 0（≥ 0.0004）／同时存在的命中特效 0（≥ 4）
- ✔ 伤害飘字覆盖 0.0015（≥ 0.00008）／飘字条数 5（≥ 1）／敌人与背景 ΔE 17.7（≥ 10）／特效预算 0（≤ 320）

确定性读数：ledger evidence（2026-11-03T11:22Z）与本 agent 复跑一致——effects=0、floaters=5、enemies=13、phase=wave，是固定种子下 `sim.effects.length` 的确定性读数，不是计时噪声。

**机制**：4 项红全部源自同一根因——feel 反馈密度指标在**单一瞬时**采样（`metricsFrame = combat-impact`，t=8.0s），而命中特效是短命爆发信号。`spark` ttl 0.15s、`ring` ttl 0.2s（`public/js/sim/projectile-system.js`）、受击闪白 0.25s（`public/js/sim/enemy-system.js` 每秒衰减 4），飘字 0.65/0.9s 更长。逐步累计复现（/tmp 脚本，t=6.5→8.05 每 0.05s 采样一次 `sim.effects.length`）：并发命中特效在 0–4 间以约 0.3s 周期震荡，t=7.75/7.80 达峰 4（2 spark + 2 ring），t=8.00 恰落空窗 0。命中特效在持续生成（spark+ring 成对出现、flash 也有），只是单瞬时采样点撞上空窗；`effectCoverage`/`hitFlashCoverage` 是「同瞬时隐藏表现层 vs 可见」的像素差，effects=0 时隐藏层像素差必然为 0，故一并归零。

**为什么此前修复没守住**：`gap-ac-018-feel-effects-density`（done，`goal_ac: AC-018`）在 5→3 时给每次命中补了第二个 `ring` 特效（`public/js/sim/projectile-system.js`），把 t=8.0s 瞬时并发数 3→5、exit 0。但它只**抬高了爆发幅度**（窗口峰值 3→4），没解决**相位脆弱**——metric 仍读 t=8.0s 单瞬时。其后 `feat-resource-vein-placement`（`1f49461`，三张固定图各布 3 个可攻击矿脉 + `public/js/shared/maps/{canyon,ring,twin}.js`）落地，矿脉占据可建造格/可被攻击，改变塔的开火节奏与目标分布，把 t=8.0s 采样相位推进了空窗（effects 5→0）。这是合法玩法落图、不可回滚；`gap-ac-018-feel-effects-density` 的 Notes 已明确记录当时弃用「窗口峰值口径」仅因当时窗口峰值只有 3，现在补了 ring 后窗口峰值已达 4，该口径已可用。

**修法（窗口峰值口径，即 `gap-ac-018-feel-effects-density` Proposal 中明确列出的方向 2）**：把 feel 反馈密度指标从「t=8.0s 单瞬时」改为「战斗窗口内的峰值」——

1. `effects-active`（同时存在的命中特效）：`payload.effects` 改为逐步累计的峰值 `max(sim.effects.length)`（复用 `tests/visual-scenarios.mjs` `groupEvidence` 里 `trace.maxEffects` 的逐步累计口径），而非最后一帧瞬时计数；
2. 覆盖类三项（feedbackCoverage / effectCoverage / hitFlashCoverage）：`metricsFrame` 及其 `references`（隐藏表现层对照帧）改在**峰值密度瞬时**采集——逐步推进时记录 max effects 所在 tick，在该 tick 采集「可见」截图与 4 张 hideFeedback 参照帧，保证「可见 vs 隐藏」像素差比较发生在确有特效的瞬时。

**约束（本 repo 惯例，不得违反）**：

- 特效被整体删除时仍必红：`no-feedback` / `effects-invisible` 注入下窗口峰值 count=0、覆盖=0，须仍跌破阈值（`tests/visual-check.test.mjs` 现有反例须继续红）；
- 不得下调任何阈值（`scripts/lib/visual-metrics.mjs` `THRESHOLDS.feel` 8 项原值不动，尤其 `minActiveEffects: 4`）；
- 确定性不变：固定 seed、RNG 调用顺序不变，`npm test` 模拟确定性用例全绿；
- 不破坏 `checkFrameTimes`：t=2/4.5/8 三帧 requestedTime 语义不变（峰值帧或独立采集、或给准确 requestedTime，不得引入时间漂移红）；
- 只改测试采集/度量口径，不改 `public/js/**` 玩法与表现。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：两个已 done 的 `goal_ac: AC-018` 任务（`gap-ac-018-feel-effects-density` 幅度修补、`gap-ac-018-feel-reverify` 只读见证）与 VIS-001（原始交付）均非在飞重复——本任务修的是它们都未覆盖的「单瞬时采样相位脆弱」这一度量根因。`task-granularity-advice.js --touches <本任务 Touches> --json` 返回 `peers: []`、`mentions: []`，与在飞任务零文件重叠。

## AC

- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite feel` 连续 2 次 exit 0，每次 8 项 ok 表写入 Notes（含 effects-active 峰值读数 ≥ 4、反馈覆盖 ≥ 0.002、命中特效覆盖 ≥ 0.0003、受击闪白覆盖 ≥ 0.0004）
- [ ] `node --test tests/visual-check.test.mjs` exit 0；改动度量口径时同步更新/新增单测，且 `no-feedback`/`effects-invisible` 注入下 feel 仍判红（count 0、覆盖 0 必红）
- [ ] `npm test` exit 0（全量 suite，含模拟确定性用例——度量口径改动不得改变 RNG 调用序列/模拟结果）
- [ ] `git diff -- scripts/lib/visual-metrics.mjs` 中 `THRESHOLDS.feel` 8 项阈值均未下调（无 diff，或 Notes 给出「真实反馈回归」证据与依据）
- [ ] Notes 记录因果归因：`git log --oneline f642eee..HEAD -- <相关文件>` 定位 5→0 的落地提交（`1f49461` 资源矿脉落图），写明 hash 与 `git show --stat` 摘要

## DoD

- [ ] 真实浏览器连续 2 次 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite feel` exit 0，每次 8 项 ok 表读数写入 Notes
- [ ] 门禁语义未被放宽：`no-feedback`/`effects-invisible` 注入下 feel 必红；`THRESHOLDS.feel` 未下调；特效整体删除时峰值 count 0 < 4 必红
- [ ] 落地 diff 只含 `## Touches` 声明文件，`git status --short` 无本任务相关未提交改动；零第三方依赖
- [ ] 确定性保持：同 seed 模拟结果与 RNG 调用序列不变（`npm test` 确定性用例全绿），`checkFrameTimes` 无时间漂移红

## Touches

- `tests/visual-scenes.mjs`
- `tests/lib/visual/metrics.mjs`
- `tests/lib/visual/session.mjs`
- `tests/visual-check.test.mjs`
- `tasks/gap-ac-018-feel-window-sampling.md`