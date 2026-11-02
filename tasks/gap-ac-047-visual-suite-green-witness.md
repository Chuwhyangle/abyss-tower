---
id: gap-ac-047-visual-suite-green-witness
title: 视觉像素逐帧一致：AC-047 只读复验见证——parity 与视觉套件当前全绿（03:12 fail 为页面启动超时抖动）
status: ready
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/visual-parity.mjs --check && node
    scripts/visual-check.mjs --suite all
goal_ac: AC-047
---
## Proposal

AC-047（视觉像素与重构前逐帧一致且视觉套件通过）criterion `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` 目前 `active`、evidence 为 fail（`2026-11-02T03:12:28Z`，exit 2）：失败形态是「页面启动超时」——`Browser.waitFor` 等 `document.body.dataset.boot === 'ok'` 超时（`tests/harness.mjs:140` 的 `waitBoot` → `VisualSceneSession.open`），且 harness `retried:true` 仍超时。

本任务是对这条 criterion 的只读复验见证，不改任何代码。立案前已实跑两侧：

- `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` → **exit 0**（逐帧对照无漂移/缺失/多出，仅若干 weapons 帧在容差内的渲染变体，网格最大差 0.297）；
- `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` → **exit 0**，feel / art / ui / mobile 四套件全 PASS，`结论：通过`。

同机 `node tests/browser-smoke.mjs` 亦 exit 0、页面正常置位 `dataset.boot='ok'`。因此 03:12 的 fail 是页面启动超时的环境/负载抖动（共享宿主上 Chrome 启动受载），不是渲染回归；前置 `done` 任务 `gap-ac-047-visual-parity-starter-recapture`（`goal_ac: AC-047`）复采的基线与 `.relic-level` 字号修复仍然 hold。本任务据此记录绿证，把 criterion 交还给 goal-driver 下一轮独立重判。

<!-- dedup-ref -->
机制去重与粒度：前置 `gap-ac-047-visual-parity-starter-recapture`（`done`，`goal_ac: AC-047`）是唯一带顶层 `goal_ac: AC-047` 的历史任务，已收口；当前无任何 todo/ready/needs-human 任务认领 AC-047，故本任务非重复。前者机制是「复采基线 + 字号修复」，本任务是「对 criterion 现状的只读复验」，Touches 仅自身，判 separate。

## AC

- [ ] `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` exit 0（AC-047 本体判据连写；parity 臂现红，见 Notes「worker 复验读数」）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` exit 0（parity 臂现红：combat-impact 确定性漂移，见 Notes「worker 复验读数」）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` exit 0（feel/art/ui/mobile 四套件全 PASS）
- [x] `npm test` exit 0（全量无回归，佐证页面与代码当前健康）

## DoD

- [ ] 只读见证，0 源代码/脚本/基线改动：落地合并 diff 仅含 `tasks/gap-ac-047-visual-suite-green-witness.md`
- [ ] Notes 记录两侧复验的时间戳与关键读数（parity 帧数与 exit code、visual-check 四套件 PASS 行）
- [ ] 说明 03:12 fail 的性质：`waitBoot` 等待 `dataset.boot='ok'` 超时是环境/负载抖动，非渲染回归，前置 done 任务的修复仍 hold
- [ ] 不 `--write` 基线、不改视觉阈值/脚本、不改 `public/js/**`、`server/**`、`docs/**`

## Touches

- `tasks/gap-ac-047-visual-suite-green-witness.md`

## Notes

### worker 复验读数（2026-11-02 续做，worktree HEAD bcdf332 = develop）

**parity 臂已转红**：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` → **EXIT=1**（三次复跑同帧同值，确定性）。唯一漂移帧 `combat@desktop/combat-impact`：luma-grid 最大差 **1.742** / 平均差 **0.078**，统计 `{"meanLuma":[31.845,31.846],"stdLuma":[24.08,23.988],"levels":[32,32]}`——超过精确级容差（maxCell ≤1），但平均差仍在 0.25 内、画面统计几乎不动，是局部单格的确定性视觉增量，非浏览器亚像素抖动。

**漂移归因**：立案基线复采于 `0f532a0`（2026-10-30）。AC-060 `feat(rogue2): 觉醒 P0 四条三级遗物行为词条`（commit `e8a50a7`，2026-10-31）在立案后（立案时主检出 HEAD `9fcc19f`，parity 仍 exit 0）经 fan-in 落地 develop：`public/js/render/effect-renderer.js` 新增 `frostBurst`/`poisonSpread` 复用 `drawRing`、`public/js/sim/combat-system.js` 新增觉醒击杀钩子（霜爆/毒传/炮台引燃）——战斗「命中」帧出现新的确定性环形视觉，使 refactor 基线过期。这是确定性渲染增量（feature 落地），不是渲染回归。

**视觉套件臂（AC3）**：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` → **EXIT=0**，feel/art/ui/mobile 四套件全 PASS，`结论：通过`（ui 最小可见字号 12 · stat-label 达标）。

**全量测试（AC4）**：`npm test` → **EXIT=0**（1868/1868 pass，0 fail）。

**结论**：本 witness 立案时的「parity 全绿」前提已随 AC-060 落地失效。03:12 的 `waitBoot` 超时归因仍成立（页面 boot 正常、visual-check/npm test 全绿），但 parity 臂现因 AC-060 觉醒视觉使基线过期而红；本 witness 的 DoD 禁止 `--write` 基线、不改任何代码，故 AC1/AC2 无法诚实勾绿。需另立「AC-060 觉醒视觉落地后复采 refactor 基线」任务（`--write` 复采 + 逐帧归因），由 goal-driver 后续独立重判 AC-047。

### 复验读数（2026-11-02，主检出 HEAD 9fcc19f）

- parity 臂：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` → EXIT=0；输出 `visual-parity: OK（…帧；逐像素一致 …，渲染变体 …）`；所有变体均在容差内（网格最大差 ≤1 / 平均差 ≤0.25），无缺失/多出/漂移。
- 视觉套件臂：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` → EXIT=0；feel/art/ui/mobile 四套件全 PASS，`结论：通过`（ui 最小可见字号 12 · stat-label 达标）。
- 页面 boot 佐证：`node tests/browser-smoke.mjs` EXIT=0，`dataset.boot='ok'` 正常置位。

### 03:12 fail 归因

evidence 的 fail 是 `waitBoot` 在 `tests/harness.mjs:140` 抛「等待超时：页面启动」——页面 JS 在 bootTimeout 内未把 `document.body.dataset.boot` 置为 `'ok'`。同机、同代码、当天稍后两臂与 smoke 均绿，说明是共享宿主负载下的 Chrome 启动/页面加载抖动，而非确定性回归。若后续该超时反复出现，可另立任务把 `bootTimeoutMs` 或 harness 的启动重试策略做成健壮性修复（本任务不做）。
