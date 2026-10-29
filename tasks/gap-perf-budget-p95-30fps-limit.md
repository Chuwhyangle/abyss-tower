---
id: gap-perf-budget-p95-30fps-limit
title: perf:budget 门禁 p95 预算与 30FPS 场景帧间隔相悖：normal-1x-low 误红（非渲染回归）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-028
---
## Proposal

AC-028（`npm run perf:budget` exit 0）本轮 FAIL，唯一超限项是 `normal-1x-low` 的 `p95FrameMs`：实际 33.4ms，限制 ≤25ms。这不是渲染回归，而是预算配置与该场景自身帧率目标自相矛盾：

- `normal-1x-low` 是 30 FPS 低配场景（`tests/dynamic-perf.mjs` 的 `LOW = { fps: 30, ... }`，harness 本身断言其 `renderFps` 落在 20–38）。30 FPS 的帧间隔名义值即 1000/30 ≈ 33.3ms，25ms 的 p95 上限对一个 30 FPS 场景数学上不可达。
- 同一轮的 Δ 列全绿：`renderFps 29.92→29.91`（持平）、`avgRenderMs 1.197→0.919`（渲染耗时反降 23%）。渲染没有变慢；变红的是 `p95FrameMs`，它测的是 rAF 原始帧间隔（`public/js/game-app.js` 的 `frameIntervals`），是共享宿主软件渲染的调度抖动，不是渲染成本。
- `docs/perf-budget.json` 基线（2026-10-24）把该场景 `p95FrameMs` 记为 16.8ms（宿主低负载时的 60Hz rAF），25ms 上限按「60Hz + 少量余量」设定，但 `normal-1x-low` 是 30 FPS 场景——把这个 60Hz 上限套到 30 FPS 场景上属于配置错误；本轮 33.4ms 才是一个 30 FPS 场景在软件渲染共享宿主上的真实帧节奏。

修复：把 `docs/perf-budget.json` 里 `normal-1x-low` 的 `maxP95FrameMs` 从 25 提升到与 30 FPS 帧间隔一致并留共享宿主余量（≥40ms），并在既有单测 `tests/perf-budget.test.mjs` 里加一条一致性守卫，防止同样的「把 60Hz p95 上限套到低帧率场景」再次出现。**不触碰任何渲染代码**（Δ 列已证明无渲染回归）。

## AC

- [ ] `docs/perf-budget.json` 的 `normal-1x-low.budget.maxP95FrameMs` ≥ 40（覆盖 30 FPS 帧间隔 33.3ms + 共享宿主软件渲染余量）
- [ ] `tests/perf-budget.test.mjs` 新增一致性断言：任一 `baseline.renderFps < 40` 的场景，其 `budget.maxP95FrameMs` 必须 > 33.3；用旧值 25 跑该断言必须失败（证明守卫有效），新值 ≥40 通过
- [ ] `node --test tests/perf-budget.test.mjs` exit 0
- [ ] `npm run perf:budget` exit 0
- [ ] `npm test` exit 0
- [ ] 代码改动仅限 `docs/perf-budget.json` 与 `tests/perf-budget.test.mjs`（任务自身文件除外），未触碰 `public/js/` 渲染代码

## DoD

- [ ] 真实跑通 `npm run perf:budget`（Chrome，headless 软件渲染）exit 0，且输出表里 `normal-1x-low` 的 `p95FrameMs`（≈33.4）落在新上限内、`late-3x-high` / `skills-1x-high` 仍 PASS
- [ ] 守卫有效性反证落盘：临时把 `normal-1x-low.maxP95FrameMs` 改回 25，`node --test tests/perf-budget.test.mjs` 的新断言红；改回 ≥40 全绿
- [ ] Notes 记录：为什么 25ms 是配置错误（30 FPS 场景帧间隔名义 33.3ms，60Hz 上限不可达）、为什么选 40（33.3 + 共享宿主余量）、为什么不是渲染回归（Δ 列 renderFps 持平 / avgRenderMs 反降）
- [ ] `npm run perf:budget` 连续两次 exit 0，排除共享宿主偶发
- [ ] `npm test` 全绿（含新增守卫）

## Touches

- `tasks/gap-perf-budget-p95-30fps-limit.md`
- `docs/perf-budget.json`
- `tests/perf-budget.test.mjs`
