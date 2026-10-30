---
id: gap-ac-047-visual-parity-starter-recapture
title: 视觉像素逐帧一致：信物三选一开局使 parity 基线过期，复采基线并复核视觉套件（AC-047）
status: todo
labels:
  - gap
  - refactor
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-019-perf-budget-opening-harness
goal_ac: AC-047
---
## Proposal

AC-047（视觉像素与重构前逐帧一致且视觉套件通过）criterion `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` 当前 exit 2，失败在 `visual-parity` 的第一步导航：`Browser.waitFor` 等待「海克斯/地图选择弹窗」超时（`tests/harness.mjs:140` 的 `chooseOpeningHex` → `VisualSceneSession.gotoMap` → `captureScene`）。根因与 `gap-ac-019-perf-budget-opening-harness` 相同：commit `21ae9a9`（AC-056 开局信物三选一）把开局顺序从「海克斯 → 地图」改成「信物三选一（`.draft-modal .starter-select`，卡片 `.relic-card`、确认 `#btn-confirm-starter`）→ 海克斯 → 地图」，而 `chooseOpeningHex` 只 `waitFor('.hex-modal, .map-modal')`，从不点信物弹窗，于是海克斯/地图弹窗永不出现、20s 超时抛错。

导航修复已由 `gap-ac-019-perf-budget-opening-harness`（AC-019，`ready`，改 `tests/harness.mjs` 的 `chooseOpeningHex` 增加前置信物处理）认领；本任务不重复改那个文件。本任务的独立交付物是视觉见证本身：`visual-parity` 基线 `docs/reviews/refactor-baseline.json` 采集于 2026-10-28（`6e55de9`），早于信物三选一；导航修好后 `--check` 要么直接通过（被采场景 title/lobby/map/combat/result 未漂移），要么因战斗 HUD 新显示信物遗物或其它开局改动而逐帧漂移。做法：先复跑 `visual-parity --check`；若漂移且能归因到信物/海克斯开局改动（非渲染回归），用 `--write` 复采基线并把逐帧差异归因记进 Notes；再跑 `visual-check --suite all` 确认四套件（feel/art/ui/mobile）仍全 PASS；最终让整条 criterion exit 0。

<!-- dedup-ref -->
机制去重与粒度：`gap-ac-019-perf-budget-opening-harness`（AC-019，`ready`）已认领导航根因（`tests/harness.mjs` 未处理信物三选一），其 DoD 明确只改 `tests/harness.mjs` 测试编排、不碰 `docs/**` 与视觉基线；本任务与它共享根因但交付物不同（perf:budget vs 视觉像素见证），判定 **separate**。真依赖走顶层 `depends_on: gap-ac-019-perf-budget-opening-harness`（导航先落地，视觉见证才跑得到 map/combat）。此前无任何任务带顶层 `goal_ac: AC-047`（`grep '^goal_ac: AC-047' tasks/*.md` 为空，已核）。

## AC

- [ ] `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` exit 0（AC-047 本体判据连写）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` exit 0（parity 臂单独绿）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` exit 0（四套件 feel/art/ui/mobile 全 PASS）
- [ ] `grep -n 'starter-select' tests/harness.mjs` exit 0（前置导航修复已落地，harness 已处理信物三选一）
- [ ] `npm test` exit 0（无回归）

## DoD

- [ ] `visual-parity --check` 真实跑到逐帧对照（不再停在开局弹窗），exit 0 或经复采基线后 exit 0
- [ ] 基线复采（若发生）不是无脑 `--write`：先证明漂移来自信物/海克斯开局改动而非渲染回归，再把「哪些场景/视口/帧漂移 + 归因 + 零缺失帧/多出帧」写进 Notes
- [ ] `visual-check --suite all` 四套件全 PASS，未因信物三选一引入阈值回归
- [ ] 不碰 `tests/harness.mjs`（导航修复归 `gap-ac-019-perf-budget-opening-harness`）；不碰 `public/js/**`、`server/**`、sim/RNG/计分/数值/存档
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写 Notes
- [ ] 本任务无独立测试文件：`scripts/visual-parity.mjs --check` 与 `scripts/visual-check.mjs --suite all` 本身就是逐帧/阈值见证（即 AC-047 判据），修复的覆盖即判据本身

## Touches

- `docs/reviews/refactor-baseline.json`
- `tasks/gap-ac-047-visual-parity-starter-recapture.md`
