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

- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` exit 0（AC-047 本体判据连写；parity 臂随提交基线陈旧而红，回绿依赖另立「复采视觉基线」任务）（待外部）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-parity.mjs --check` exit 0（parity 臂单独绿，逐帧对照无漂移/缺失/多出；基线随 Chrome 153.0.8010.52 陈旧，同环境对照已证本改动中性，回绿依赖另立「复采视觉基线」任务）（待外部）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` exit 0（feel/art/ui/mobile 四套件全 PASS）
- [x] `node --test tests/visual-check.test.mjs` exit 0（新增 `bootWithRetry` 单测绿，且既有 session/plan/metrics 纯函数单测不回归）
- [x] `npm test` exit 0（无回归）

## DoD

- [x] `bootWithRetry` 语义用 stub 证明：`waitBoot` 首次抛 `Error('等待超时：页面启动')`、再次成功 ⇒ 返回成功且 `send('Page.reload', …)` 恰被调 1 次；`waitBoot` 全部超时 ⇒ 抛最后一次错误且 reload 次数 = attempts−1
- [ ] `VisualSceneSession.open()` 改调 `bootWithRetry`（已改调，session.mjs:563），reload 重放同一 initScript（同 seed/settings），确定性不变（同环境对照 `--write/--check /tmp` exit 0 已证逐帧中性；提交基线 parity 回绿依赖另立「复采视觉基线」任务，不 `--write` 基线）（待外部）
- [x] 不动采集/断言/阈值：不改 `tests/visual-scenes.mjs`、`tests/lib/visual/plan.mjs`、`tests/lib/visual/metrics.mjs`、`scripts/visual-check.mjs`、`docs/reviews/refactor-baseline.json`
- [x] 不碰 `public/js/**`、`server/**`、sim/RNG/计分/数值/存档
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写 Notes

## Touches

- `tests/lib/visual/session.mjs`
- `tests/visual-check.test.mjs`
- `scripts/structure-budget.allow.d/gap-ac-047-visual-boot-retry.json`
- `tasks/gap-ac-047-visual-boot-retry.md`

## Notes

实现（commit 03246b7f）：`tests/lib/visual/session.mjs` 新增导出纯函数 `bootWithRetry(browser, { attempts = 3, reload = true })`，`VisualSceneSession.open()` 改调它（初始 `Page.reload` 应用 deviceMetrics/touch 覆盖仍保留）；`tests/visual-check.test.mjs` 增 stub 单测。测试文件增至 839 行超 800 预算，登记 `scripts/structure-budget.allow.d/gap-ac-047-visual-boot-retry.json`（maxLines 900）并进 Touches。

AC 复验：AC-4（`node --test tests/visual-check.test.mjs`）exit 0，41 例全绿含 bootWithRetry stub；AC-5（`npm test`）exit 0，2027 例全绿；AC-3（`visual-check --suite all`）exit 0，feel/art/ui/mobile 全 PASS。

AC-2 / AC-1（parity 臂）留未勾——环境性红，非本改动：`node scripts/visual-parity.mjs --check` 对提交基线 `docs/reviews/refactor-baseline.json` 报 166 帧逐帧微漂（maxCellDelta≈4、mean≈0.2）。主 checkout（未改的 develop 同款代码）跑同一命令产出**逐字节相同**漂移数字（boss@desktop/before 网格最大差 4.044、meanLuma 31.043→31.14），证明漂移来自提交基线随 Chrome 153.0.8010.52 陈旧，与 boot 重试无关。同环境对照 `--write --baseline /tmp/parity-047.json` + `--check --baseline /tmp/parity-047.json` exit 0（182 帧：逐像素一致 179、渲染变体 3 均在容差内），自证本改动逐帧确定性不变（reload 重放同一 initScript，同 seed/settings）。DoD 要求「不 `--write` 基线」，故未复采提交基线；**需另立「复采视觉基线」任务**（参照 done 的 `gap-ac-047-visual-parity-starter-recapture`）在无负载窗口复采 `docs/reviews/refactor-baseline.json` 后 AC-047 才能回绿。

### 续做复验（2026-11-05 第二轮 worker，机制修复不变）

本轮对未勾三条做环境归因复核，确认非本改动后标注 `（待外部）`：

- AC-4 `node --test tests/visual-check.test.mjs` → **41/41 pass，exit 0**（含 bootWithRetry stub）；AC-5 `npm test` → **2027/2027 pass，exit 0**；AC-3 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node scripts/visual-check.mjs --suite all` → **exit 0，feel/art/ui/mobile 四套件全 PASS，结论：通过**。
- AC-2/AC-1（parity 臂）仍红：`visual-parity --check` 对提交基线报 166 帧逐帧微漂，签名与上轮**逐字节相同**（boss@desktop/before 网格最大差 4.044、meanLuma 31.043→31.14），证明是提交基线随 Chrome 153.0.8010.52 陈旧所致，与本改动无关。
- 同环境对照 `--write --baseline /tmp/parity-047-recheck.json`（182 帧）+ `--check` → **exit 0（逐像素一致 179，渲染变体 3 全在容差内）**，自证 bootWithRetry reload 重放同一 initScript、逐帧确定性不变。

**判定**：AC-1 / AC-2 / DoD-2 三条标注 `（待外部）`——它们被「提交基线陈旧」阻塞，需**另立「复采视觉基线」任务**（参照 done 的 `gap-ac-047-visual-parity-starter-recapture`）在无负载窗口 `--write` 复采 `docs/reviews/refactor-baseline.json` 后回绿；本任务 DoD 明令「不 `--write` 基线」，机制修复（bootWithRetry）已完整落地并自证中性。另注：AC-047 goal criterion 现为 `not-evaluated (timeout, 60000ms killed)`——连写命令 >60s，goal-driver 需给 AC-047 设 `timeoutMs` 才能重判并立案复采任务（goal-driver 侧配置，不在本任务 Touches）。
