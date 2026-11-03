---
id: gap-result-scene-polish
title: 结算场景精灵与移动首屏修复：空金框、出屏分数/数据、孤立难度标签、奖励语义色（可选打磨）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node tests/browser-result-scene.mjs
depends_on:
  - gap-scene-sprite-adoption
---
## Proposal

AC-029 的语义评审（2026-10-27，全新上下文 subagent `ac76e326a17add0ff`）判结算场景**未通过**（5.0/10），阻断 GOAL-006 退出条件「四场景 × 两视口的语义评审结论写入 `docs/ART_REVIEW.md`」。评审记录与原始输出见 `docs/ART_REVIEW.md` 的「评审过程」「评审记录」（任务 `gap-art-review-record`）。

实测证据（after 采集，commit `a246670`，14 帧在 `/tmp/art-after`，`--quality high`）：

- `public/js/ui/result.js:98` 在结算面板顶部放了一个 `data-sprite-id="ui/scene-result-panel"` 的 `.scene-sprite` 空 div；桌面实采帧里该框约 235×110，框内亮度均值 21、面板底色 23，内部基本为空，读作空占位块，且是结算页首屏最显眼的装饰。基线 commit `7854759` 没有这个框——空框是场景精灵接入引入的回归。
- 844×390 横屏首屏只装下空金框、三行标题与大数字 8,420；「最终得分」标签、3×2 数据格、分享按钮全部在首屏之外（`result.js:104-110` 的 `.result-score` / `.result-cores` / 分享区没有短视口重排）。
- 两种视口的「远征难度」标签（`result.js:103` 的 `.diff-tag`）渲染在标题与大数字之间，下方没有数值，读起来像「难度 = 8,420」。
- 「获得星核 34」用粉红描边 + 粉红菱形，与 `docs/ART_DIRECTION.md`「奖励 `reward` = 金色」的语义色纪律不一致。

<!-- dedup-ref -->
机制分工：`gap-scene-sprite-adoption`（done）负责四场景接入精灵与缺资源回退，本任务只修它接入结算场景后暴露的可见缺陷；`gap-art-review-record`（AC-029）负责语义评审与记录，本任务不写评审记录、不替它下结论；`gap-ui-readability-font-floor` / `gap-mobile-visual-font-floor` 已修完机械字号与溢出，本任务不降低任何已达标阈值。判定 separate。

## Plan

1. **文档先行**（`docs/ART_DIRECTION.md`，属美术方向正本，允许实现任务增量）：写清结算场景精灵槽位规则——`ui/scene-result-panel` 是「金边晶体边框」，必须承载内容（徽记/标题）或从 DOM 移除，不允许渲染空框；短视口（`max-height: 520px`）下结算首屏必须包含场景标签、得分与「最终得分」标签；奖励星核徽记统一取 `role.reward` 金色。
2. `public/js/ui/result.js`：
   - resultPanel 精灵宿主改为承载可见内容（复用 `ui/scene-result-badge` 可选精灵或把标题区包进框内），保留 `aria-hidden="true"`；无法承载内容时直接移除该宿主。
   - `.diff-tag` 与难度值成对出现（移到大数字之后或并入「远征难度：<名称>」），不再出现孤立标签。
   - 「获得星核」徽记改用金色奖励令牌，去掉粉红描边/粉红菱形。
3. `public/styles.css`：新增短视口媒体查询（`@media (max-height: 520px)`）：压缩结算面板顶部精灵区、数据格改紧凑两列，保证 844×390 首屏可见「最终得分」标签与至少首行数据格与分享按钮；桌面端层级不变。
4. 新增 `tests/browser-result-scene.mjs`（复用 `tests/harness.mjs` 的 `startTestServer` / `launchBrowser` / `registerAndLogin`，结算构造可复用 `tests/visual-scenes.mjs` 的脚本化流程）：真实 Chrome + 真实服务，在 1440×900 与 844×390 两视口断言：resultPanel 宿主非空或不存在；「最终得分」标签、首行数据格与分享按钮的 `getBoundingClientRect()` 落在视口内；`.diff-tag` 文本包含难度名；星核徽记取金色。必须带 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`。
5. 新增 `tests/result-scene-layout.test.mjs`（纯源码/样式断言，不启浏览器）：`result.js` 不再输出空 `.scene-sprite` 宿主；`styles.css` 含短视口媒体查询；星核奖励样式引用金色令牌。
6. **复采入库**：`node tests/visual-scenes.mjs --scene result --quality high --out /tmp/art-after-fix`，把 `contact-sheet.png` 与 `manifest.json` 复制到 `docs/reviews/result-scene-fix/`，逐场景原图路径写进 Notes。
7. **回归**：`npm test`、`node scripts/visual-check.mjs --suite ui`、`node scripts/visual-check.mjs --suite mobile`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile`。不改 sim/RNG/计分/数值/存档。

## AC

- [x] `node tests/browser-result-scene.mjs` exit 0（两视口 × 空框 / 首屏 / 难度标签 / 奖励色四类断言）
- [x] `node --test tests/result-scene-layout.test.mjs` exit 0
- [x] 844×390 首屏包含「最终得分」标签、至少一行数据格与分享按钮（`getBoundingClientRect()` 在视口内）
- [x] `data-sprite-id="ui/scene-result-panel"` 宿主内部有可见内容，或该宿主已被移除；不再出现空金框
- [x] `.diff-tag` 与难度值成对出现，两种视口都没有孤立「远征难度」标签
- [x] 星核奖励徽记取金色 `role.reward` 令牌，与 `docs/ART_DIRECTION.md` 一致
- [x] 复采证据存档：`docs/reviews/result-scene-fix/contact-sheet.png` 与 `manifest.json` 入库（存档证据；验收以浏览器断言为准，不驱动读图评审）
- [x] `npm test` exit 0；`node scripts/visual-check.mjs --suite ui`、`node scripts/visual-check.mjs --suite mobile` exit 0

## DoD

- [x] 真实浏览器两视口实跑并截图；844×390 首屏截图人眼可见「最终得分」标签与数据格
- [x] 空金框问题从画面上消失（填入内容或移除），不是用遮罩/同色块掩盖
- [x] 奖励语义色与 `docs/ART_DIRECTION.md` 的金色体系一致
- [x] 复采结果落盘，桌面端布局无回归（与修复前截图对照）
- [x] 不触碰 sim/RNG/计分/存档；`docs/ART_DIRECTION.md` 的增量与实现一致
- [x] 结算场景修复以浏览器断言验收：`tests/browser-result-scene.mjs` 与 `tests/result-scene-layout.test.mjs` exit 0（读图评审已退役，不再由 gap-art-review-record 复评）

## Touches

- `tasks/gap-result-scene-polish.md`
- `docs/ART_DIRECTION.md`
- `public/js/ui/result.js`
- `public/styles.css`
- `tests/browser-result-scene.mjs` (new)
- `tests/result-scene-layout.test.mjs` (new)
- `docs/reviews/result-scene-fix/contact-sheet.png` (new)
- `docs/reviews/result-scene-fix/manifest.json` (new)

## Notes

来源：`gap-art-review-record` 的全新上下文评审（subagent `ac76e326a17add0ff`，2026-10-27）对结算场景判 5.0/10 未通过，扣分 -2.3 空金框 / -1.4 移动横屏首屏出屏 / -0.6 孤立难度标签 / -0.4 奖励色 / -0.3 桌面下缘留白。原始输出已存入 `gap-art-review-record` 的 Notes，本任务只承接修复，不改写评审结论；修复后由 `gap-art-review-record` 重新评审。

实现落地（2026-11-03，commit `bcad443`）：resultPanel 精灵宿主改为承载 `.result-hero`（眉题 + 标题）的 240×120 标题卡，不再输出空占位框；新增 `@media (max-height: 520px)` 短视口压缩，`.modal-actions`/`.result-grid`/回放/分享面板按 order 重排，保证 844×390 首屏可见「最终得分」、首行数据格与分享按钮；`.diff-tag` 移入 `.result-score` 与难度值成对；星核徽章改 `--gold` 奖励语义。浏览器验收 `tests/browser-result-scene.mjs`（1440×900 + 844×390）与源码级 `tests/result-scene-layout.test.mjs` 全绿；复采证据入库 `docs/reviews/result-scene-fix/`（contact-sheet.png + manifest.json，manifest commit `bcad443`）。

## Needs-Human

**执行 2026-10-27T10:31:47.122Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[本任务落地后，`gap-art-review-record` 可重新采集并由全新上下文复评结算场景]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）

---

2026-10-29 用户决定：AC-029 读图评审退役，本任务不再阻断任何 goal，降级为可选打磨（todo）。DoD 里「重新采集并由全新上下文复评结算场景」与 AC 里 contact-sheet 入库两条因不再读图而作废——执行时以浏览器断言（tests/browser-result-scene.mjs）为准，不启动读图评审者。

2026-11-03 用户指示：改写上述两条作废 AC/DoD 恢复可派（DoD「本任务落地后…复评结算场景」→ 浏览器断言验收；AC「contact-sheet 入库且与修复前非同一张」→ 存档证据），状态 needs-human → todo。

## Needs-Human

**执行 2026-10-30T06:38:23.721Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[本任务落地后，`gap-art-review-record` 可重新采集并由全新上下文复评结算场景]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）