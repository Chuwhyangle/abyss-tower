---
id: gap-ac-028-perf-budget-reverify
title: AC-028 复验：harness 开局信物三选一修复落地后 perf:budget 恢复 exit 0（开局弹窗超时红由 AC-019 拥有）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: npm run perf:budget
depends_on:
  - gap-ac-019-perf-budget-opening-harness
goal_ac: AC-028
---
## Proposal

AC-028（GOAL-006 退出条件「`npm run perf:budget` 通过，60fps 目标不回归」）的 criterion 逐字为 `npm run perf:budget`，expect `exit 0`。2026-10-30 直接复跑 exit 1，读数 `[perf] FAIL: 等待超时：海克斯/地图选择弹窗`。这不是性能数值回归，而是测试 harness 落后于开局流程：

- commit `21ae9a9`（AC-056 开局信物三选一）在开局最前插入「信物三选一」弹窗（`public/js/ui/starter-select.js` 的 `.starter-select`，卡片 `.relic-card`、确认 `#btn-confirm-starter`），开局顺序变为 信物 → 海克斯 → 地图；
- `tests/harness.mjs` 的 `chooseOpeningHex`（:358-372）只 `waitFor('.hex-modal, .map-modal')`，从不点信物弹窗（`grep -n starter tests/harness.mjs` 零命中），信物弹窗一直卡在屏幕、海克斯/地图弹窗永不出现，`browser.waitFor` 超时抛错。

**本任务不重复修复该机制**：同一处红已有在飞归属 —— `gap-ac-019-perf-budget-opening-harness`（todo，`goal_ac: AC-019`）修 `tests/harness.mjs` 补信物三选一步骤。AC-019 与 AC-028 的 criterion 同为 `npm run perf:budget`，两者以完全相同的方式红；harness 修好、`perf:budget` 跑通到真实战斗采样后，两条 AC 一起转绿。

**为什么此前两次 AC-028 修复都没有守住**：`gap-perf-budget-p95-30fps-limit`（done）修的是 `normal-1x-low` p95 绝对阈值（`docs/perf-budget.json` maxP95FrameMs 25→40）；`gap-perf-budget-normal-scenario-no-enemies`（done，commit `8200e9c`）修的是 wave 12 滴灌空场（normal 场景补站场敌人）。二者都只保证「性能测量本身不误红」，都不涉及开局流程编排；本轮红是 AC-056 开局信物三选一引入的**新机制**（harness 落后于开局弹窗），此前任何一次修复都不覆盖。

<!-- dedup-ref --> 机制去重与粒度决策（mechanism-based，非症状关键词）：本任务只承担 AC-028 自己的见证面——在 `gap-ac-019-perf-budget-opening-harness` 落地后的 HEAD 上逐字执行 criterion `npm run perf:budget` 连续 2 次 exit 0、读数写入 Notes 供 driver 独立复算；不重复编辑 AC-019 lane 的 `tests/harness.mjs`，也不重复 `gap-perf-budget-p95-30fps-limit` / `gap-perf-budget-normal-scenario-no-enemies`（均 done，机制分别是 p95 阈值 / 空场，与本轮开局超时不同）。`goal_ac` 是单值标量，折叠进 AC-019 任务会让 AC-028 失去独立、可被 driver 逐字复算的归属。本任务 Touches 只有自身任务文件，与三者零文件重叠；`task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches tasks/gap-ac-028-perf-budget-reverify.md --json` 返回 `peers: []`、`mentions: []`。

## Plan

1. 确认 `gap-ac-019-perf-budget-opening-harness` 的修复提交已在被评估 HEAD 的祖先链中：`git merge-base --is-ancestor <fix-commit> HEAD` exit 0，记下 hash；不要只凭「它已 done」就当已生效。
2. 在该 HEAD 上逐字执行 criterion（`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run perf:budget`）一轮，随后再执行一轮，共 2 轮；每轮记录退出码与关键输出（是否报 `[perf] FAIL`、各场景 PASS/FAIL 表）。
3. 任一轮非零：抓取失败场景名与读数。若仍是开局弹窗超时（`等待超时：海克斯/地图选择弹窗`），说明 AC-019 修复未真正落地或未生效，登记证据并回写 AC-019 任务 Notes，不要在本任务并发编辑 `tests/harness.mjs`；若是真实预算回归（某场景 renderFps / avgRenderMs / p95FrameMs 越线且 Δ 列证实渲染回退），先把对应源文件加入本任务 `## Touches`，再动手修（此时 AC-028 的「视觉重制后预算不回归」才暴露出真实机制面）。
4. 不改产品行为、玩法与数值；不改 `tests/harness.mjs`（AC-019 lane）；不改 `docs/perf-budget.json` / `tests/perf-budget.test.mjs`，除非 Notes 证明是真实渲染回归（非开局超时、非 p95 共享宿主噪声）。

## AC

- [ ] 逐字执行 criterion `npm run perf:budget` exit 0（AC-028 本体判据）
- [ ] 在被评估 HEAD 上独立连续 2 次 `npm run perf:budget` exit 0，每次读数（退出码 / 是否 `[perf] FAIL` / 各场景 PASS 数）写入 Notes
- [ ] `git merge-base --is-ancestor <AC-019 修复提交> HEAD` exit 0，Notes 写明该提交 hash
- [ ] Notes 记录本轮失败面证据：`[perf] FAIL: 等待超时：海克斯/地图选择弹窗` 原文 + 根因（`21ae9a9` 开局信物三选一，harness 未处理 `.starter-select`）
- [ ] 若 perf:budget 跑通后暴露真实预算回归（非开局超时、非 p95 共享宿主噪声），对应源文件已出现在本任务 `## Touches`，且 Notes 记录失败文本与根因（未触发则 Touches 不扩容、Notes 记「未触发」）

## DoD

- [ ] 读数可被 driver 独立复算：Notes 给出命令原文 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run perf:budget`、每轮退出码与关键输出
- [ ] 被评估 HEAD 已提交，`git status --short` 无本任务相关未提交改动
- [ ] 门禁语义未被放宽：`docs/perf-budget.json` 不在本任务 diff 中（预算阈值不动），除非 Notes 证明是真实渲染回归且更新基线有依据
- [ ] 零运行时/玩家可见改动、零第三方依赖；本任务 diff 不含 AC-019 lane 的 `tests/harness.mjs`
- [ ] Notes 写清取舍：为什么 AC-028 的见证不折叠进 AC-019 任务（`goal_ac` 单值标量，AC-028 需独立归属供 driver 逐字复算）

## Touches

- `tasks/gap-ac-028-perf-budget-reverify.md`

## Notes

立案依据（2026-10-30，本 agent 直接测量，非台账陈旧尾巴）：criterion `npm run perf:budget` exit 1，读数 `[perf] FAIL: 等待超时：海克斯/地图选择弹窗`。根因是 `21ae9a9`（AC-056）插入开局信物三选一、`tests/harness.mjs` `chooseOpeningHex` 未处理 `.starter-select`；与 AC-019 同 criterion、同根因。机制修复归在飞任务 `gap-ac-019-perf-budget-opening-harness`（todo），本任务只读见证、顶层 `depends_on` 引用它。读数占位（worker 落地后填）：第 1 / 2 轮退出码与关键输出、AC-019 修复提交 hash。
