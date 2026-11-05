---
id: gap-ac-047-visual-boot-retry
title: AC-047 复红：视觉会话 reload 后 waitBoot 无重试，负载抖动使 criterion 假红；给 boot 加带 reload 的重试
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-047
---
## Proposal

AC-047（视觉像素与重构前逐帧一致且视觉套件通过）criterion `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` 当前 evidence 为 fail（2026-11-05T02:10:25Z，exit 2）。失败签名是 `[visual-parity] Error: 等待超时：页面启动`，栈为 `Browser.waitFor（tests/harness.mjs:140）→ Browser.waitBoot（tests/harness.mjs:144）→ VisualSceneSession.open（tests/lib/visual/session.mjs:543）`。根因在 `VisualSceneSession.open()`：`Emulation.setDeviceMetricsOverride` 之后 `Page.reload` 再 `await this.browser.waitBoot()`，这次 boot 等待**没有重试**——`launchBrowser` 对首次 boot 有 `withRetry(retries:1)` 兜底，但 `open()` 里 reload 后的第二次 boot 是裸 `waitBoot()`，一旦 20s（`HARNESS_BOOT_TIMEOUT_MS` 默认）内 `document.body.dataset.boot === 'ok'` 未置位，就抛裸 `Error('等待超时：页面启动')` 直接穿透整条 criterion（exit 2）。

这不是渲染回归，是共享宿主的瞬态启动抖动：前置只读见证 `gap-ac-047-visual-suite-green-witness`（done，`goal_ac: AC-047`）多轮实测同机同代码 `visual-parity --check` 与 `visual-check --suite all` 均 exit 0（parity 逐帧一致、四套件全 PASS），并明确记录「`waitBoot` 超时是环境/负载抖动，非渲染回归；若后续反复出现，可另立任务把 bootTimeoutMs 或启动重试策略做成健壮性修复」。此前两任 `goal_ac: AC-047` 任务（`gap-ac-047-visual-parity-starter-recapture` 复采基线 + `.relic-level` 字号修复、`gap-ac-047-visual-suite-green-witness` 只读见证）均已 done 收口，但**都没有消除「reload 后裸 `waitBoot()` 无重试」这个结构性缺陷**，所以 criterion 在负载抖动下仍会 exit 2——这正是 earlier fix did not hold 的根因。

**修法（机制修复，不动采集/断言/阈值）**：把 `VisualSceneSession.open()` 的「`Page.reload` + `waitBoot`」换成带 reload 的重试——`waitBoot()` 超时后 `Page.reload` 再等一次，最多 N 次总尝试（默认 3，与 harness 现有 `retries:1` 口径至少对齐）。reload 重放的是同一 initScript（同 seed / 同画质 / 同 settings），逐帧确定性不变，**不可能引入像素漂移**；它只把「负载下本可启动却恰好没在 20s 内置位」的瞬态失败自愈。实现上把重试封装成 `tests/lib/visual/session.mjs` 导出的纯函数 `bootWithRetry(browser, { attempts, reload })`，`open()` 改调它；`browser` 只需 `waitBoot()` 与 `send()`，可脱离真实浏览器用 stub 单测。

<!-- dedup-ref -->
机制去重与粒度：无任何 in-flight（todo/ready/needs-human）任务带顶层 `goal_ac: AC-047`（`task_list` 已核：带该字段的只有 done 的 `gap-ac-047-visual-parity-starter-recapture` 与 done 的 `gap-ac-047-visual-suite-green-witness`），故本任务非重复；`task-granularity-advice` 对 `tests/lib/visual/session.mjs` / `tests/visual-check.test.mjs` 报 peers=[]、mentions=[]。前任 witness 是「只读见证」（Touches 仅自身、零代码改动），本任务是「boot 重试健壮性」（改 session.mjs + 单测），机制与交付物均不同，判 separate。

## AC

- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` exit 0（AC-047 本体判据连写）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` exit 0（parity 臂单独绿，逐帧对照无漂移/缺失/多出）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` exit 0（feel/art/ui/mobile 四套件全 PASS）
- [ ] `node --test tests/visual-check.test.mjs` exit 0（新增 `bootWithRetry` 单测绿，且既有 session/plan/metrics 纯函数单测不回归）
- [ ] `npm test` exit 0（无回归）

## DoD

- [ ] `bootWithRetry` 语义用 stub 证明：`waitBoot` 首次抛 `Error('等待超时：页面启动')`、再次成功 ⇒ 返回成功且 `send('Page.reload', …)` 恰被调 1 次；`waitBoot` 全部超时 ⇒ 抛最后一次错误且 reload 次数 = attempts−1
- [ ] `VisualSceneSession.open()` 改调 `bootWithRetry`，reload 重放同一 initScript（同 seed/settings），确定性不变（以 `visual-parity --check` 仍 exit 0 佐证，不 `--write` 基线）
- [ ] 不动采集/断言/阈值：不改 `tests/visual-scenes.mjs`、`tests/lib/visual/plan.mjs`、`tests/lib/visual/metrics.mjs`、`scripts/visual-check.mjs`、`docs/reviews/refactor-baseline.json`
- [ ] 不碰 `public/js/**`、`server/**`、sim/RNG/计分/数值/存档
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写 Notes

## Touches

- `tests/lib/visual/session.mjs`
- `tests/visual-check.test.mjs`
- `tasks/gap-ac-047-visual-boot-retry.md`
