---
id: gap-art-review-record
title: 美术语义评审记录：四场景 × 两视口真实采集 + 全新上下文评审结论（AC-029）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/art-review.mjs --check
depends_on:
  - gap-result-scene-polish
goal_ac: AC-029
---
## Proposal

GOAL-006 退出条件要求「四场景 × 两视口的语义评审结论写入 `docs/ART_REVIEW.md`」，AC-029 以 `node scripts/art-review.mjs --check`（expect exit 0）见证。检查器、`docs/ART_REVIEW.md` 骨架与确定性采集基建已由 VIS-001 落地，但记录区仍是空壳。main 上实测（2026-10-27）：

```
$ node scripts/art-review.mjs --check
美术评审 · docs/ART_REVIEW.md

覆盖场景：—
覆盖视口：—

问题：
  - 缺少评审条目（需要至少一条 `### 标题` + 场景 / 日期 / 评审者 / 结论 / 分数 的记录）
  - 评审记录未覆盖场景：title / map / combat / result
  - 评审记录未覆盖视口：desktop / mobile

结论：未通过
exit=1
```

所以 AC-029 今天不是「能力缺失」，而是一次真实失败读数：被检查的记录不存在。缺的不是检查器（`scripts/art-review.mjs` 与 `scripts/lib/review-record.mjs` 已在位，且会拒绝缺字段 / 结论非「通过」的坏记录），也不是采集器（`tests/visual-scenes.mjs --scene all` 已能产出 title/map/combat/result × desktop/mobile 的真实截图），而是**真实的评审本身**：有人真的看过四场景两视口的画面，并把结论与依据写下来。

本任务只做这一件事：对真实采集图做一次全新上下文的语义评审，把结论原样写入记录，让 AC-029 成为可自证的证据。它不改检查器、不改采集阈值、不改任何产品渲染代码。

<!-- dedup-ref -->
机制分工：检查器与采集基建归 VIS-001（done；它故意在缺记录时 exit 1，并明确「语义评审待 ART-001 完成后由全新上下文评审填写」），美术方向与令牌归 ART-001（AC-021），机械层（背景与氛围、UI 可读性、移动视口）分别归 AC-024 / AC-025 / AC-027 对应的任务，本任务与它们正交：任何机械套件通过都不蕴含有人看过四张场景图并给出结论。同族但不同机制的 gap-feel-review-record（AC-020，`docs/FEEL_REVIEW.md`，打击感语义层）与本任务共享 `scripts/lib/review-record.mjs` 的格式与「全新上下文评审」方法，但评审对象、记录文件与 AC 完全不同，判定 separate、不合并。`docs/ART_REVIEW.md` 的 Touches 与 gap-background-atmosphere-gate 无重叠（后者明确只做机械层、不产出评审结论）。

## Plan

1. **起点读数**：在 worktree 内跑 `node scripts/art-review.mjs --check`，确认 exit 1（缺记录），把命令与输出原样记入记录的「评审过程」节，作为「记录起初不存在」的证据。
2. **真实采集 after**：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/visual-scenes.mjs --scene all --quality high --out /tmp/art-after`。确认 manifest 覆盖 title / map / combat / result 与 desktop 视口，且 title/map 有 mobile（390×844 竖屏）、combat/result 有 mobile-landscape（844×390 横屏）——这是本仓库 `SCENE_VIEWPORTS` 的既有定义，不要为凑评审改采集器。
3. **入库对照图**：把 `/tmp/art-after/contact-sheet.png` 与 `manifest.json` 复制到 `docs/reviews/art-after/`（完整逐场景帧留在 /tmp，路径写进记录）；before 侧引用 VIS-001 已入库的 `docs/reviews/baseline-contact-sheet.png`，构成同 seed 的前后对照。
4. **全新上下文评审**：启动一个独立 subagent 作为评审者，只给它 before/after contact sheet（必要时给单场景帧）、GOAL-006 的视觉退出条件原文、`docs/ART_DIRECTION.md` 的风格支柱与 `docs/ART_REVIEW.md` 里的评审问题清单；**不给**本任务的实现过程、预期结论或任何「应当通过」的暗示。记录其 agent 标识与上下文隔离方式；执行者只原样转写它的逐项观察、扣分理由、结论与 0–10 分数，不得改写。
5. **写记录**：把 `docs/ART_REVIEW.md` 的「## 评审记录」空壳说明替换为真实条目——至少四条（title / map / combat / result 各一条），每条 `视口：desktop、mobile` 且分别写两视口观察；必填字段齐全：`场景`、`视口`、`日期`（YYYY-MM-DD）、`评审者`、`结论`、`分数`（n/10）。另在「## 评审过程」写采集命令、两侧 commit、日期、评审者身份与隔离方式、起点失败读数。⚠️ 解析器把评审区内任何 `### ` 标题都当作条目，因此该区不得出现非条目的三级标题；格式模板必须留在围栏代码块内。
6. **诚实收口**：若评审者判定某场景不通过，保持「未通过」并立案修复（新 gap 任务，id 写进记录），不得为关 AC 改写结论；只有真实整改并复评通过后，记录才可写成「通过」。
7. **回归护栏**：新增 `tests/art-review-record.test.mjs`，用 `scripts/lib/review-record.mjs` 与 `checkArtReview` 解析真实记录，断言 `ok:true`、覆盖四场景与两视口、每条 `reviewer` 非空且 `score` 为 n/10；断言记录引用的 PNG 存在且 >1KB；反向断言——临时副本删掉条目、或把结论改成「未通过」时 `checkArtReview` 返回 `ok:false`，证明检查不是空转。
8. **自检**：`node scripts/art-review.mjs --check` exit 0、`node --test tests/art-review-record.test.mjs`、`npm test` 全绿；`git status` 只含本任务 Touches 内文件。本任务不新增 `scripts/` 源文件；若最终确需新增，必须同步 `scripts/test-changed.mjs` 的 `TEST_MAP` 并把它加进 Touches。

## AC

- [ ] `node scripts/art-review.mjs --check` exit 0
- [ ] `node scripts/art-review.mjs --check --json` 的 `coverage.missingScenes` 与 `coverage.missingViewports` 均为 `[]`，且至少四条条目的 `verdict` 为 `pass`、`reviewer` 非空、`score` 形如 `n/10`
- [x] `node --test tests/art-review-record.test.mjs` exit 0，且含「删条目 / 改结论为未通过后检查失败」的反向用例
- [x] `test -s docs/reviews/art-after/contact-sheet.png && test -s docs/reviews/art-after/manifest.json && test -s docs/reviews/baseline-contact-sheet.png` exit 0
- [x] `grep -qE '^## 评审过程' docs/ART_REVIEW.md` exit 0，且该节写明采集命令、两侧 commit、日期、评审者与上下文隔离方式
- [x] `npm test` exit 0

## DoD

- [x] 真实跑过一次 `--scene all --quality high` 采集；before（baseline）与 after（art-after）两张 contact sheet 能被人直接打开并看清四场景两视口，不是占位图，也不是同一张图复制两次
- [x] 评审结论确实来自全新上下文：记录保留评审者 agent 标识 / 隔离方式与逐项扣分理由，执行者未改写结论
- [x] 记录对 GOAL-006 的视觉退出条件逐场景给出可见判断；未达标项写明归属任务并已立案
- [x] 没有为了关 AC 把不通过写成通过：`docs/ART_REVIEW.md` 的结论与评审者原始输出一致，原始输出摘要存入本任务 Notes
- [x] `docs/ART_REVIEW.md` 的「待评审（…）」占位文字已删除，评审记录区不再是空壳
- [x] 产品代码零改动：本任务 diff 不含 `public/`、`scripts/art-review.mjs`、`scripts/lib/review-record.mjs`

## Touches

- `docs/ART_REVIEW.md`
- `docs/reviews/art-after/contact-sheet.png` (new)
- `docs/reviews/art-after/manifest.json` (new)
- `tests/art-review-record.test.mjs` (new)
- `tasks/gap-art-review-record.md`

## Notes

评审记录是语义层证据，不能替代 `scripts/visual-check.mjs --suite art|ui|mobile` 的机械指标；两者同时成立才支撑 GOAL-006。记录必须诚实：如果画面仍不达标，宁可把结论写成不通过并立案修复，也不要为了关 AC 写通过——那会让 AC-029 重新退化成一条无法自证的证据。格式与判定以 VIS-001 落地的 `scripts/lib/review-record.mjs` 为准，不另发明格式。

worker 连续两次长时停滞（08:15、09:21 均以 SIGTERM 终止）；改为等 gap-scene-sprite-adoption 落地后再评审最终画面，避免在未完成的美术上做语义结论。

### 2026-10-27 评审执行记录（worker）

- 起点读数：`node scripts/art-review.mjs --check` → exit 1（记录尚不存在），命令与输出已原样写入 `docs/ART_REVIEW.md`「评审过程」。
- 采集：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/visual-scenes.mjs --scene all --quality high --out /tmp/art-after`，exit 0，14 帧，totalMs 22251，after commit `a246670add21314694d1412e31176fca76e55b0a`。
- 入库：`docs/reviews/art-after/contact-sheet.png` + `manifest.json`；before 引用 `docs/reviews/baseline-contact-sheet.png`（commit `785475921db72c2b6180c8cf9b9647a2568ed459`）。
- 评审者：全新上下文 subagent `ac76e326a17add0ff`（general-purpose / sonnet）。隔离方式：只收到 before/after contact sheet、逐场景原图、`docs/ART_DIRECTION.md` 与 GOAL-006 视觉退出条件；**未**收到本任务 Proposal/Plan/AC、实现过程、git 历史或任何期望结论。执行者原样转写，未改写。
- 逐场景结论：title 7.8/10 **通过**；map 8.0/10 **通过**；combat 8.0/10 **通过**；result 5.0/10 **未通过**；总体 6.9/10 **未通过**。
- 诚实收口：结算场景未通过项已立案 `gap-result-scene-polish`（空金框、移动横屏首屏信息出屏、孤立「远征难度」标签、奖励色粉红→金色）。**AC-029 因此仍为红**：`node scripts/art-review.mjs --check` exit 1，AC 第 1、2 条未满足；本任务不 flip done，待 `gap-result-scene-polish` 落地后重新采集并由全新上下文复评，记录才可改写为通过。
- 回归护栏 `tests/art-review-record.test.mjs` 不硬编码 `ok:true`（本轮记录如实为未通过），改为断言：记录覆盖四场景×两视口、每条 reviewer/score 齐全、检查器判定与逐条结论一致、引用 PNG 存在且 >1KB，并含「删条目」「改结论为未通过」「全部改通过可放行」三个方向用例；`node --test tests/art-review-record.test.mjs` 7/7 通过。
- 全量回归：`npm test` → 1639 pass / 0 fail（exit 0）。

评审者原始输出（逐字）：

### 标题（title）
- 视口：desktop 1440×900、mobile 390×844
- 桌面观察：背景板可见（散落星点 + 底部地平线光带，压在近黑蓝绿之上），标题“渊塔守卫”为金色文字 + 辉光，金色主按钮“开始远征”是全页最亮、层级正确。账号行、每日/本周/变异/无尽四个挑战入口、3×4 小按钮网格均清晰可读，没有空白或坏图。技能区“ACTIVE SKILL”在 900 高度折线处被截断，只露出霜月·极光卡上缘与两张锁定卡的顶部。
- 移动观察：整套卡片纵向排布，主按钮与 12 个小按钮首屏可读；固定悬浮的“visualbot / 设备 / 退出登录”药丸正好压在“ACTIVE SKILL”标题与首张技能卡上缘，“携带 1 个 · 升级消耗星核”靠右可见。背景板只在面板上方的窄带露出，未出现空白块。
- 扣分理由：
  - 移动端固定底部账户条遮挡技能区标题与首张技能卡上缘 -1.0
  - 两种视口首屏内技能卡均只露出上缘，完整阅读需要滚动 -0.5
  - 文档要求的左下角“菱形晶体徽记 logo”在两种视口都看不到，标题实为文字 + 辉光回退（回退合理、无空白块，但“全面精灵化”覆盖不完整）-0.4
  - 背景板只能读到星点与地平线，“塔群剪影”不可辨，场景精灵的辨识度偏低 -0.3
- 结论：通过
- 分数：7.8/10

### 选图（map）
- 视口：desktop 1440×900、mobile 390×844
- 桌面观察：三张地图卡各带大幅路线缩略图（青色折线、入口/出口圆点、双入路线的金+青双线），这是相对基线最明确的精灵增量，卡内标题、特性、分数与“选择此图”均可读。右上角另有一块无标签的六边网格小缩略图；面板左下、第一张卡正下方还多出一块无标题迷你路线框（虚线边框 + 一条带端点圆点的路径），与三卡网格不齐、与居中“放弃本局”同排。
- 移动观察：单列卡片占满宽度，裂谷关隘/双牙桥的缩略图与文字层级清楚，滚动可达第三张；顶部说明文字被右侧六边缩略图挤到左侧两行但仍可读。三张卡的强调色（冷白蓝 / 金 / 青）在移动端同样各自为政。
- 扣分理由：
  - 桌面左下多余的无标题迷你路线框与卡片网格脱节、紧贴“放弃本局”，读作溢出或占位元素 -0.8
  - 三张卡强调色不统一（冷白蓝 / 金 / 青），金色同时是奖励与主 CTA 的语义色，卡面强调语言不唯一 -0.5
  - 每张卡的确认动作“选择此图”与“分数 ×0.95”仅约 11px，权重明显低于金色描边等装饰 -0.4
  - 右上角六边网格缩略图无标签、单独悬浮，与标题区争一点注意力 -0.3
- 结论：通过
- 分数：8.0/10

### 战斗（combat）
- 视口：desktop 1440×900、mobile-landscape 844×390
- 桌面观察：三帧（contact / impact / mixed）整体压暗，叠加冷光点阵、暗角与地平线光，路径棕带、可建造位虚线圆、塔的家族轮廓与身份色光环、敌人（粉幽灵 / 金色甲虫）与血条能一眼区分。右下基地晶体是全场最亮的玩法信息，符合“信息优先”；未看到方向互相矛盾的投影。景观层只加光，路径与塔位逐像素可读，没有抢戏。
- 移动观察：两行 HUD（波次/金币/基地/击杀、遗物/漫游/战斗中/倍速/退出）与底部塔栏可读；但战场按原比例缩到约 460×270，左右各约 190px 纯黑 letterbox，敌人只剩约 10px 高，只能靠颜色与血条辨认。
- 扣分理由：
  - 移动横屏单位剪影约 10px，远低于文档 24 逻辑像素的剪影下限，形状不可辨、只能靠色相 -0.9
  - 移动横屏左右约 45% 屏宽是纯黑留白，画面内容只占中间一条 -0.5
  - 文档指定的右下角 HUD 皮肤徽记（`ui/scene-combat-hud`）在两种视口均不可见，精灵覆盖不完整（无空白块）-0.4
  - 场景叠加的点阵网格与“可建造位”的虚线几何在低对比下形似，局部有轻微语义混淆 -0.2
- 结论：通过
- 分数：8.0/10

### 结算（result）
- 视口：desktop 1440×900、mobile-landscape 844×390
- 桌面观察：面板顶部是一块约 235×110 的金边圆角框，四角金钉、内部一条金线与一条青线；实测框内亮度均值 21、面板底色 23，内部基本是空的。其下是“EXPEDITION OVER / 抵达第 12 波（粉红）/ 远征难度（金色，无对应数值）/ 8,420 / 最终得分”，再下为 3×2 数据格、粉框“获得星核 34”、分享区与“生成分享码”，均清晰可读。
- 移动观察：面板几乎占满 810px 宽，但内容仍居中约 400px，左右大片空；390px 首屏只装下空金框、三行标题与大数字 8,420，“最终得分”标签、全部数据格与分享按钮都在首屏之外，“远征难度”直接落在大数字上方。
- 扣分理由：
  - 顶部金边“晶体边框”内部与面板同色、只有两条横线，读作空占位块，且是结算页最显眼的装饰 -2.3
  - 移动横屏把空框放在首屏顶部约 1/3，把“最终得分”标签、数据格与分享按钮全部挤到 390px 之外；大数字落在“远征难度”之下且没有“最终得分”标签，含义会被误读 -1.4
  - 两种视口都有孤立标签“远征难度”，下方没有数值 -0.6
  - 奖励“获得星核 34”用粉红描边 + 粉红菱形，与文档“奖励=金”的语义色及标题栏金色菱形不一致 -0.4
  - 桌面分享按钮以下留白偏多，面板下缘显空 -0.3
- 结论：未通过
- 分数：5.0/10

### 总体
- 跨场景一致性观察：四个场景共用同一套近黑蓝绿面板（1px 冷色描边、圆角、金色主操作），战斗 HUD 与 DOM 面板色温一致，整体氛围统一。金色稳定承担“主操作/高亮”，但同时也出现在地图卡强调描边与标题栏货币上，语义被摊薄；粉红/红既做结算标题（失败）又做奖励徽记，跨场景不统一。真正有“霓虹几何”质感的是战斗与选图路线，标题与结算仍以暗色卡片 + 金色为主。
- 相对基线的进步：战斗从明亮平面草地变成压暗 + 点阵 + 暗角的统一氛围，霓虹塔与敌人更突出，是最大进步；选图新增三张路线缩略图与六边网格，信息量与精灵覆盖明显提升；标题多了星海/地平线背景板，气质更暗更完整。
- 未通过项与归属：结算场景——顶部空金框（占位观感、且是首屏最大装饰）、移动横屏未重排导致分数标签/数据/分享出屏、孤立“远征难度”标签、奖励色与金色体系冲突，需结算场景的精灵内容与响应式布局修复；标题移动端固定账户栏遮挡技能区（布局侧）；选图左下无标题迷你框与卡片强调色统一（选图场景）。战斗移动端单位剪影与 letterbox 属可接受的下阶段优化，不构成本轮阻断。
- 总体结论：未通过
- 总分：6.9/10（四场景均值约 7.2；结算场景的占位框与移动端首屏问题属于退出条件内的阻断项，按 6.9 记）

### 2026-10-27 第二轮复核（worker）：阻塞确认，非 AC 漏勾

> 本节是给「为什么 AC 1、2 仍未勾」的**真因**留证——机械停派注记会把本轮写成 `ac-not-checked` /「AC 未全勾」，那只是现象，真因是依赖未落地。

- 合并 develop：`git merge --no-edit develop` → clean（merge commit `c8a0d5d`，17 个 develop 提交，全部为 culmination 相关 sim/render 与任务文件，不含结算页面改动）。
- anti-drift：`anti-drift-touches-check.ts --task gap-art-review-record --merge-target develop` → `ANTI-DRIFT OK`（4 个实际改动文件全部在 Touches 内）。
- 现状复核：`node scripts/art-review.mjs --check` → 仍 exit 1，唯一红项是结算场景 result（5.0/10 未通过）；`node --test tests/art-review-record.test.mjs` → 7/7 pass。
- 阻断源核验（关键）：`gap-result-scene-polish` 在 develop 上已是 `needs-human`（commit `8e381bf`，重试上限机械翻转），按仓库裁定 needs-human 没有机械再入队路径，须人工决定重派；且 `public/js/ui/result.js`、`public/styles.css`、`public/assets` 自评审 commit `a246670` 起到当前 develop **零改动** ⇒ 结算画面逐像素未变，现在重新采集 + 复评只会得到同一个「未通过」，复评无意义。
- 结论：本任务在 `gap-result-scene-polish` 真实落地前**无法诚实地关闭**（AC 第 1、2 条要求检查器 exit 0，AC 的 acceptance 命令同样是 `node scripts/art-review.mjs --check`）。本轮不伪造通过、不改写评审结论、不动产品代码；AC 保持 4/6，Touches 不变。
- 给人工的下一步：先把 `gap-result-scene-polish` 从 needs-human retreat 到 todo 并重派（其 Plan 已写明 result.js / styles.css 的具体修法与两视口浏览器断言，含 `LANG=zh_CN` 要求）；它落地后再派本任务，届时重跑 Plan 步骤 2–5（重新采集 → 全新上下文复评 result 场景 → 把该条目改写为通过）即可一次性收口 AC 1、2。

## Blocker

**2026-10-27T13:13:48.976Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 10/12，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：6faa9c67-7534-41b7-a9f1-ccd8a39c5314
