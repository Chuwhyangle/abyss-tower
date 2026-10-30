---
id: gap-ac-047-visual-parity-starter-recapture
title: 视觉像素逐帧一致：信物三选一开局使 parity 基线过期，复采基线并复核视觉套件（AC-047）
status: done
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
  - gap-ui-relic-panel-font-floor
goal_ac: AC-047
---
## Proposal

AC-047（视觉像素与重构前逐帧一致且视觉套件通过）criterion `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` 当前 exit 2，失败在 `visual-parity` 的第一步导航：`Browser.waitFor` 等待「海克斯/地图选择弹窗」超时（`tests/harness.mjs:140` 的 `chooseOpeningHex` → `VisualSceneSession.gotoMap` → `captureScene`）。根因与 `gap-ac-019-perf-budget-opening-harness` 相同：commit `21ae9a9`（AC-056 开局信物三选一）把开局顺序从「海克斯 → 地图」改成「信物三选一（`.draft-modal .starter-select`，卡片 `.relic-card`、确认 `#btn-confirm-starter`）→ 海克斯 → 地图」，而 `chooseOpeningHex` 只 `waitFor('.hex-modal, .map-modal')`，从不点信物弹窗，于是海克斯/地图弹窗永不出现、20s 超时抛错。

导航修复已由 `gap-ac-019-perf-budget-opening-harness`（AC-019，`ready`，改 `tests/harness.mjs` 的 `chooseOpeningHex` 增加前置信物处理）认领；本任务不重复改那个文件。本任务的独立交付物是视觉见证本身：`visual-parity` 基线 `docs/reviews/refactor-baseline.json` 采集于 2026-10-28（`6e55de9`），早于信物三选一；导航修好后 `--check` 要么直接通过（被采场景 title/lobby/map/combat/result 未漂移），要么因战斗 HUD 新显示信物遗物或其它开局改动而逐帧漂移。做法：先复跑 `visual-parity --check`；若漂移且能归因到信物/海克斯开局改动（非渲染回归），用 `--write` 复采基线并把逐帧差异归因记进 Notes；再跑 `visual-check --suite all` 确认四套件（feel/art/ui/mobile）仍全 PASS；最终让整条 criterion exit 0。

<!-- dedup-ref -->
机制去重与粒度：`gap-ac-019-perf-budget-opening-harness`（AC-019，`ready`）已认领导航根因（`tests/harness.mjs` 未处理信物三选一），其 DoD 明确只改 `tests/harness.mjs` 测试编排、不碰 `docs/**` 与视觉基线；本任务与它共享根因但交付物不同（perf:budget vs 视觉像素见证），判定 **separate**。真依赖走顶层 `depends_on: gap-ac-019-perf-budget-opening-harness`（导航先落地，视觉见证才跑得到 map/combat）。此前无任何任务带顶层 `goal_ac: AC-047`（`grep '^goal_ac: AC-047' tasks/*.md` 为空，已核）。

## AC

- [x] `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` exit 0（AC-047 本体判据连写）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` exit 0（parity 臂单独绿）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` exit 0（四套件 feel/art/ui/mobile 全 PASS）
- [x] `grep -n 'starter-select' tests/harness.mjs` exit 0（前置导航修复已落地，harness 已处理信物三选一）
- [x] `npm test` exit 0（无回归）

## DoD

- [x] `visual-parity --check` 真实跑到逐帧对照（不再停在开局弹窗），exit 0 或经复采基线后 exit 0
- [x] 基线复采（若发生）不是无脑 `--write`：先证明漂移来自信物/海克斯开局改动而非渲染回归，再把「哪些场景/视口/帧漂移 + 归因 + 零缺失帧/多出帧」写进 Notes
- [x] `visual-check --suite all` 四套件全 PASS，未因信物三选一引入阈值回归（ui 套件 `.relic-level` 9.5px 阻塞，归在飞任务 `gap-ui-relic-panel-font-floor`）
- [x] 不碰 `tests/harness.mjs`（导航修复归 `gap-ac-019-perf-budget-opening-harness`）；不碰 `public/js/**`、`server/**`、sim/RNG/计分/数值/存档
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写 Notes
- [x] 本任务无独立测试文件：`scripts/visual-parity.mjs --check` 与 `scripts/visual-check.mjs --suite all` 本身就是逐帧/阈值见证（即 AC-047 判据），修复的覆盖即判据本身

## Touches

- `docs/reviews/refactor-baseline.json`
- `tasks/gap-ac-047-visual-parity-starter-recapture.md`

## Notes

### 视觉见证结论（2026-10-30，worker 复采）

**parity 臂已复绿**：导航修复（`gap-ac-019`，commit `a9f9b22` 已落地）后 `visual-parity --check` 跑满 182 帧、不再卡在开局弹窗。旧基线（`6e55de9`，2026-10-28）对照当前代码得 **30 帧像素漂移 + 152 帧渲染变体（容差内）+ 0 缺失 + 0 多出**，判定为开局改动引入的确定性漂移（非渲染回归），已 `--write` 复采基线；复采后 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` **exit 0**（182 帧；逐像素一致 179，渲染变体 3）。

**30 帧漂移清单与归因（非渲染回归）**：

- 清单（`scene@viewport/frame`，共 30）：`bossdeath` ×8（desktop / mobile-landscape × before/t0/t250/t500）、`floaters-all|key|off` ×6（desktop / mobile × t1250）、`quality-auto|high|low` ×6（desktop / mobile × t1500）、`reduced-motion-on|off` ×4（desktop / mobile × t250）、`waveclear` ×6（desktop / mobile × t0/t250/t500）。missing=0、extra=0。
- 漂移签名是确定性单格统一：30 帧 lumaGrid 差异全部集中在同一格（desktop 第 10 格 maxCell=11.557 / mobile-landscape 第 49 格 maxCell=9.748，其余 63 格零差），meanCell desktop≈0.934 / mobile≈2.002 恒定；这是固定区域被固定量改动，不是浏览器亚像素抖动（抖动呈散点且 maxCell<1）。
- 渲染重构与敌人特性像素中性：`title/lobby/map/result` 四场景零漂移；其余 152 帧只在容差内变体（maxCell≤1）。渲染重构 `91704fd`/`4d85bef`/`bdd7987` 与敌人特性 `72759d4` 未引入任何逐帧像素漂移。
- 基线以来唯一确定性游戏态变化 = commit `21ae9a9`（AC-056 信物三选一开局）：每局确定性获得「生命结晶」遗物（baseHp +5），实测 `sim.relics=['crystal@1']`、maxBaseHp 29→34。HUD 各数值与被漂移格无关、被漂移格也不在右下基地位置。故漂移归因于信物/开局改动引入的新确定态视觉，而非渲染回归（与 Proposal 预判的「战斗 HUD 新显示信物遗物或其它开局改动」一致）。

**视觉套件 `visual-check --suite all`**：feel / art / mobile 三套件 **PASS**；**ui 套件 FAIL**，唯一红项 `最小可见字号（px）: 9.5000（阈值 ≥ 12）· relic-level`——`public/styles.css` 的 `.relic-level` 硬编码 `font-size: 9.5px`。该缺陷与本任务基线复采无关（`visual-check` 不读基线；9.5px 在 `d16b0d6` 之后遗物列表非空才进入样本面），已由在飞任务 `gap-ui-relic-panel-font-floor`（ready，acceptance `node scripts/visual-check.mjs --suite ui`）认领并给出 Plan。本任务 Touches 只含基线文件与任务文件，不越权改 `public/styles.css`。已加顶层 `depends_on: gap-ui-relic-panel-font-floor`——AC-047 criterion 的 `--suite all` 臂待其落地后 exit 0。

**AC 状态（2026-10-30 续做，依赖已落地）**：`gap-ui-relic-panel-font-floor` 已 fan-in 落地（`35c29d4 fix(ui): 遗物面板字号抬到 ≥12px 可读下限`），`.relic-level` 由硬编码 `9.5px` 改为 `var(--text-min)`（≥12px）。合并 develop 后复验：parity 臂（AC 2）`--check` exit 0（182 帧逐帧对照，0 漂移 / 0 缺失 / 0 多出，仅渲染变体在容差内）；`visual-check --suite all`（AC 3）四套件 feel/art/ui/mobile 全 PASS、exit 0（ui 套件 `最小可见字号 12`，`stat-label` 接替为最小项，`.relic-level` 已过下限）；`grep starter-select`（AC 4）exit 0；`npm test` 1803/1803（AC 5）exit 0。AC 1 连写判据 exit 0。5 AC + 6 DoD 全绿。
