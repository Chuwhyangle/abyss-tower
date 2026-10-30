---
id: gap-ac-018-feel-reverify
title: AC-018 复验：harness 开局信物三选一修复落地后 visual-check --suite feel 恢复 exit
  0（开局弹窗超时红由 AC-019 拥有）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/visual-check.mjs --suite feel
depends_on:
  - gap-ac-019-perf-budget-opening-harness
goal_ac: AC-018
---
## Proposal

AC-018（GOAL-005 退出条件「战斗场景机械指标：反馈覆盖、对比度、特效预算通过」）的 criterion 逐字为 `node scripts/visual-check.mjs --suite feel`，expect `exit 0`。2026-10-30 直接复跑 exit 2，读数 `[visual-check] Error: 等待超时：海克斯/地图选择弹窗`。这不是反馈指标回归，而是测试 harness 落后于开局流程：

- commit `21ae9a9`（AC-056 开局信物三选一）在开局最前插入「信物三选一」弹窗（`public/js/ui/starter-select.js` 的 `.starter-select`，卡片 `.relic-card`、确认 `#btn-confirm-starter`），开局顺序变为 信物 → 海克斯 → 地图；
- `tests/harness.mjs` 的 `chooseOpeningHex`（:358-372）只 `waitFor('.hex-modal, .map-modal')`，从不点信物弹窗（`grep -n starter tests/harness.mjs` 零命中），信物弹窗一直卡在屏幕、海克斯/地图弹窗永不出现，`browser.waitFor` 超时抛错；
- `tests/visual-scenes.mjs` → `VisualSceneSession.gotoMap` → `chooseOpeningHex` 与 perf:budget 共用同一公共 helper，故 AC-018 与 AC-019 / AC-028 以完全相同的方式红。

**本任务不重复修复该机制**：同一处红已有在飞归属 —— `gap-ac-019-perf-budget-opening-harness`（ready，`goal_ac: AC-019`）修 `tests/harness.mjs` 补信物三选一步骤。harness 修好、开局流程跑通到真实战斗采样后，feel 套件恢复对反馈覆盖 / 对比度 / 特效预算的真实判定。

**为什么此前 AC-018 的修复没有守住**：VIS-001（done，`goal_ac: AC-018`）交付了确定性场景采集与 feel 套件并实测 exit 0；本轮红不是 VIS-001 的指标判定失效，而是 commit `21ae9a9`（AC-056）引入的**新开局弹窗**使 `chooseOpeningHex` 卡死，采集永远到不了战斗采样。此前任何一次修复都不覆盖这一新机制。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：本任务只承担 AC-018 自己的见证面——在 `gap-ac-019-perf-budget-opening-harness` 落地后的 HEAD 上逐字执行 criterion `node scripts/visual-check.mjs --suite feel` 连续 2 次 exit 0、读数写入 Notes 供 driver 独立复算；不重复编辑 AC-019 lane 的 `tests/harness.mjs`，也不重复 VIS-001（done）与 `gap-ac-028-perf-budget-reverify`（todo，AC-028 的 perf:budget 见证）。`goal_ac` 是单值标量，折叠进 AC-019 任务会让 AC-018 失去独立、可被 driver 逐字复算的归属。本任务 Touches 只有自身任务文件，与三者零文件重叠；`task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-018-feel-reverify.md --json` 返回 `peers: []`、`mentions: []`。

## AC

- [x] 逐字执行 criterion `node scripts/visual-check.mjs --suite feel` exit 0（AC-018 本体判据）
- [x] 在被评估 HEAD 上独立连续 2 次 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite feel` exit 0，每次读数（退出码 / 是否 `[visual-check] Error` / feel 各指标 ok 表）写入 Notes
- [x] `git merge-base --is-ancestor <AC-019 修复提交> HEAD` exit 0，Notes 写明该提交 hash
- [x] Notes 记录本轮失败面证据：`[visual-check] Error: 等待超时：海克斯/地图选择弹窗` 原文 + 根因（`21ae9a9` 开局信物三选一，`chooseOpeningHex` 未处理 `.starter-select`）
- [x] 若 feel 套件跑通后暴露真实反馈指标回归（反馈覆盖 / 对比度 / 特效预算越线，非开局超时），对应源文件已出现在本任务 `## Touches`，且 Notes 记录失败文本与根因（未触发则 Touches 不扩容、Notes 记「未触发」）

## DoD

- [x] 读数可被 driver 独立复算：Notes 给出命令原文 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite feel`、每轮退出码与关键输出
- [x] 被评估 HEAD 已提交，`git status --short` 无本任务相关未提交改动
- [x] 门禁语义未被放宽：`scripts/lib/visual-metrics.mjs` 的 `THRESHOLDS.feel` 不在本任务 diff 中（阈值不动），除非 Notes 证明是真实反馈回归且更新阈值有依据
- [x] 零运行时/玩家可见改动、零第三方依赖；本任务 diff 不含 AC-019 lane 的 `tests/harness.mjs`
- [x] Notes 写清取舍：为什么 AC-018 的见证不折叠进 AC-019 任务（`goal_ac` 单值标量，AC-018 需独立归属供 driver 逐字复算）

## Touches

- `tasks/gap-ac-018-feel-reverify.md`

## Notes

立案依据（2026-10-30，本 agent 直接测量，非台账陈旧尾巴）：criterion `node scripts/visual-check.mjs --suite feel` exit 2，读数 `[visual-check] Error: 等待超时：海克斯/地图选择弹窗`。根因是 `21ae9a9`（AC-056）插入开局信物三选一、`tests/harness.mjs` `chooseOpeningHex` 未处理 `.starter-select`；与 AC-019 / AC-028 同 criterion 路径、同根因。机制修复归在飞任务 `gap-ac-019-perf-budget-opening-harness`（已 done），本任务只读见证、顶层 `depends_on` 引用它。

复验读数（2026-10-30，worker 在被评估 HEAD 上独立落地，命令原文每轮一致）：

`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node --no-warnings scripts/visual-check.mjs --suite feel`

- 第 1 轮 exit 0，无 `[visual-check] Error`，feel 各指标全部 PASS：反馈覆盖 0.0026（阈值 ≥ 0.002）／命中特效覆盖 0.0007（≥ 0.0003）／受击闪白覆盖 0.0014（≥ 0.0004）／伤害飘字覆盖 0.0006（≥ 0.00008）／飘字条数 2（≥ 1）／同时存在的命中特效 5（≥ 4）／敌人与背景 ΔE 19.5200（≥ 10）／特效预算 5（≤ 320）。结论：通过。
- 第 2 轮 exit 0，无 `[visual-check] Error`，读数与第 1 轮一致（反馈覆盖 0.0026／命中特效 0.0007／受击闪白 0.0014／伤害飘字 0.0006／飘字条数 2／命中特效 5／ΔE 19.5200／特效预算 5）。结论：通过。

AC-019 修复提交 hash：`a9f9b2220eea0e551a21e0bc86de396a4ec97680`（`fix(harness): 开局信物三选一未处理导致 perf:budget 等海克斯/地图弹窗超时`）；`git merge-base --is-ancestor a9f9b2220eea0e551a21e0bc86de396a4ec97680 HEAD` exit 0。

「若 feel 套件跑通后暴露真实反馈指标回归」：未触发（feel 套件连续 2 轮全 PASS，无反馈覆盖 / 对比度 / 特效预算越线），Touches 不扩容。

取舍：AC-018 的见证不折叠进 AC-019 任务——`goal_ac` 是单值标量，折叠会让 AC-018 失去独立、可被 driver 逐字复算的归属；本任务与 `gap-ac-019-perf-budget-opening-harness` / VIS-001 / `gap-ac-028-perf-budget-reverify` 零文件重叠。

## Blocker

**2026-10-30T14:02:55.578Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'main' — 'develop' (c820532e) is NOT a continuation of the project's default branch 'main' (71f13abc) — it is 6 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task gap-ac-018-feel-reverify's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'main'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：136e86b5-e207-4f8b-b931-fea42c59fc79
