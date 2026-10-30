---
id: gap-ac-019-perf-budget-opening-harness
title: perf:budget 开局超时：harness 未处理信物三选一导致等待海克斯/地图弹窗超时（AC-019）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-019
---
## Proposal

AC-019（打击感改造后性能预算不回归）criterion `npm run perf:budget` 当前 exit 1，失败信息 `[perf] FAIL: 等待超时：海克斯/地图选择弹窗`。这不是性能数值回归，而是测试 harness 落后于开局流程：commit `21ae9a9`（AC-056 开局信物三选一）在开局最前插入了「信物三选一」弹窗（`.draft-modal .starter-select`，卡片 `.relic-card`、确认 `#btn-confirm-starter`），开局顺序变成 信物 → 海克斯 → 地图；而 `tests/harness.mjs` 的 `chooseOpeningHex` 只 `waitFor('.hex-modal, .map-modal')`，从不点信物弹窗，于是信物弹窗一直卡在屏幕上、海克斯/地图弹窗永远不出现，`browser.waitFor` 超时抛错。

实测复现确认链路：`#btn-play` → `.difficulty-modal` → `.diff-card[data-id="standard"]` 后屏幕上是 `.starter-select`（`hexModal:false / mapModal:false / draftModal:true`）；手动点第一张 `.relic-card` + `#btn-confirm-starter` 后，`.hex-modal` → `.map-modal` → `window.__rtd.state.sim` 依次正常出现。因此只缺 harness 补一个「信物三选一」步骤，游戏与性能本身未回归。

修法（单一文件、公共 helper，一次修好 `chooseFirstMap` 与所有直接调用 `chooseOpeningHex` 的浏览器测试）：在 `tests/harness.mjs` 给 `chooseOpeningHex` 增加前置信物处理——先 `waitFor('.starter-select, .hex-modal, .map-modal')`，若存在 `.starter-select` 则点第一张 `.relic-card` 再点 `#btn-confirm-starter`，随后按原逻辑等待海克斯/地图弹窗；旧服务端无信物字段时直接跳过（与既有「旧服务端无该弹窗时直接跳过」约定一致）。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-019` 认领（task_list + grep `^goal_ac: AC-019` 已核）；`task-granularity-advice --root` 对 `tests/harness.mjs` 返回 open peers=[]、mentions=[]。前任 `gap-perf-budget-normal-scenario-no-enemies` / `gap-perf-budget-p95-30fps-limit`（均 done，goal_ac AC-028）是不同机制（空场误红 / p95 共享宿主噪声），与本次「开局弹窗超时」机制不同，独立立案不折叠。

## AC

- [x] `npm run perf:budget` exit 0（AC-019 本体判据）
- [x] `grep -nE 'starter-select|btn-confirm-starter' tests/harness.mjs` exit 0（harness 已处理信物三选一）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（harness 公共改动不回归既有浏览器验收）
- [x] `npm test` exit 0

## DoD

- [x] `npm run perf:budget` 真实跑通到战斗测量（不再停在开局弹窗），按 `docs/perf-budget.json` 判定 exit 0
- [x] `chooseOpeningHex` 在旧服务端无信物/海克斯字段时仍能跳过并继续（不因新增步骤破坏降级路径）
- [x] 只改 `tests/harness.mjs` 的测试编排，不碰 `public/js/**`、`server/**`、`docs/**`；不触碰 sim/RNG/计分/数值/存档

## Touches

- `tests/harness.mjs`
- `tasks/gap-ac-019-perf-budget-opening-harness.md`

## Notes

AC-019 的 criterion 是「打击感改造后性能预算不回归」，本任务修的是 criterion 的测量前置（开局流程新增信物三选一后 harness 未跟进），不是性能数值本身；修复后 perf:budget 恢复对战斗场景的真实采样。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。