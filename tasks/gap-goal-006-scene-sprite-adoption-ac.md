---
id: gap-goal-006-scene-sprite-adoption-ac
title: GOAL-006 充分性缺口：四场景 × 两视口精灵接入矩阵缺目标级 AC（提案新增 AC-030）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node tests/browser-sprite-scenes.mjs
depends_on:
  - ART-001
  - gap-sprite-pipeline
---
## Proposal

GOAL-006（视觉重制：全面精灵化，落地「暗黑霓虹几何」）的退出条件是合取式。第二条有一段目前在域 AC 里没有任何见证，原文逐字为：

> 标题、选图、战斗、结算四个场景在桌面与移动两个视口下全部走精灵资源；缺失资源时有程序化回退且不崩溃。

**未被覆盖的部分（逐字）：「标题、选图、战斗、结算四个场景在桌面与移动两个视口下全部走精灵资源」。** 后半句「缺失资源时有程序化回退且不崩溃」在**管线层**由 AC-022 覆盖，但**场景层**（每个场景在缺资源时仍能进入、渲染且不崩溃）同样没有见证；本提案把两半作为同一条 AC 的两个臂，因为它们共同定义「场景级接入」这一个机制。

**为什么现有 AC 集不覆盖它**（逐条对照 AC-021…AC-029）：

- **AC-021**（`node --test tests/art-spec.test.mjs`）只校验 `docs/ART_DIRECTION.md` / `docs/ASSET_PIPELINE.md` 存在且含必需章节、manifest schema 可被示例资源通过、令牌对比度达标；它不涉及任何场景是否真的加载或绘制精灵。
- **AC-022**（`node --test tests/sprite-pipeline.test.mjs`）的 origin 逐字引用了本节退出条件，但它的 criterion 是**注入假 loader 的单元测试**，验收面是状态机、DPR 变体选择、图集帧、缺资源回退与内存预算。更关键的是，它的落地任务 `gap-sprite-pipeline` 在 Notes 里明确写着：「管线是**基础设施**，不是视觉改动：默认 manifest 缺资源 / 空清单时画面必须与今天逐像素一致（回退即既有程序化绘制）。任何"看起来变了"都应视为缺陷。」——也就是说 **AC-022 落地后四个场景仍可完全不使用精灵而照样通过**；其 DoD 只用一个自检资源验证加载与绘制。这是「criterion 无法见证自己 origin」的典型缺口。
- **AC-023**（`node --test tests/sprite-coverage.test.mjs`）的 origin 是退出条件第三条，覆盖的是**对象维度**（塔/敌人/召唤物/可破坏物/传送门/基地），不是**场景维度**，也不覆盖标题、选图、结算这三个 DOM 场景。
- **AC-024**（`node scripts/visual-check.mjs --suite art`）从像素读背景层次、单位与背景 ΔE、剪影像素覆盖；程序化绘制同样能通过这些阈值，判据不是「图像来自 manifest 的哪一条」。
- **AC-025**（`node scripts/visual-check.mjs --suite ui`）是字号、对比度、未解锁卡可读性等**质量指标**，不是皮肤化/精灵接入；标题里虽有「UI 皮肤化」，但 criterion 不测量贴图来源。
- **AC-026** / **AC-028**：双语与性能，与场景接入正交（性能预算通过不蕴含场景走精灵）。
- **AC-027**（`node scripts/visual-check.mjs --suite mobile`）覆盖移动视口布局、触控尺寸与低配降级，但不验证「移动视口下同样走精灵」，也不验证两视口使用同一 id 集。
- **AC-029**（`node scripts/art-review.mjs --check`）只看 `docs/ART_REVIEW.md` 是否存在四场景 × 两视口的语义评审条目；而退出条件允许缺资源时程序化回退，所以一份「四场景全部走程序化回退」的记录也能通过这条 AC。

**代码事实（当前 HEAD）：**

- 标题 `public/js/ui/title.js:30`（`titleMethods`）、选图 `public/js/ui/modals.js:220`（`.map-modal` 由 DOM 模板生成）、结算 `public/js/ui/result.js:34`（`showResult`）都是 **DOM 场景**；战斗是 Canvas（`public/js/render.js`）。
- 全仓 `grep -rn "new Image\|createImageBitmap\|background-image\|backgroundImage" public/js` **0 命中**：今天没有任何外部图片加载或使用路径。「四个场景全部走精灵资源」在代码里根本没有承载点。
- `public/assets/` 目录不存在，精灵 manifest 也尚不存在（由 ART-001 / gap-sprite-pipeline 创建）。因此这条退出条件不是「已经有实现、缺个测试」，而是**实现与见证同时缺失**。

**提案：为 GOAL-006 新增一条 AC（AC-030，当前最小空闲号：AC-021…AC-029 已占用）**

- id：`AC-030`
- title：四场景 × 两视口全部走精灵资源，缺资源时场景级回退不崩溃
- criterion：`node tests/browser-sprite-scenes.mjs`
- expect：`exit 0`
- origin：GOAL-006 退出条件：标题、选图、战斗、结算四个场景在桌面与移动两个视口下全部走精灵资源；缺失资源时有程序化回退且不崩溃。

**为什么这条 AC 覆盖了缺口：** 它的 criterion 在**真实浏览器里跑真实 UI 流程**，在桌面（1440×900）与移动（390×844）两个视口下分别到达标题、选图、战斗、结算四个场景，并用同一套断言判定「走精灵」这件事本身：DOM 场景看带 `data-sprite-id` 的元素是否解析到 manifest 的 `/assets/sprites/` URL，Canvas 场景看注入的 `SpritePipeline` 按 id 的绘制计数；同时断言两视口下同一场景的 id 集完全一致（DPR 变体可不同）。第二条臂用 CDP 屏蔽 `*assets/sprites/*` 后重载，断言四场景仍可到达、渲染、`window.__bootErrors` 为空、管线报 `failed > 0` 且每场景走程序化回退。这条 AC 与 AC-022（单测里的假 loader 契约）、AC-023（对象维度覆盖）、AC-024/025/027（质量指标与布局）、AC-029（语义记录）**互为补集**：上述任何一条单独通过，都不能推出四个场景真的在使用精灵。

<!-- dedup-ref -->
相邻但不重叠的任务：ART-001（AC-021，文档与令牌，本任务的 id 分组与 manifest schema 以其为准）、gap-sprite-pipeline（AC-022，管线本体，本任务在其之上补场景接入与绘制计数）、AC-023/AC-024/AC-025/AC-027 对应的在域 AC（对象、背景、UI、移动视口），以及 VIS-001（确定性场景采集基建）。本任务只做「场景 × 视口接入矩阵 + 场景级回退」这一维，机制不同、验收面独立，判定 separate，不合并。文件重叠说明：`docs/ASSET_PIPELINE.md` / `docs/ART_DIRECTION.md` / `docs/TECH_DESIGN.md` / `public/js/render/sprite-pipeline.js` / `public/js/render.js` / `scripts/build-sprite-atlas.mjs` / `public/assets/sprites/manifest.json` 与 ART-001、gap-sprite-pipeline 及若干 GOAL-005 任务共享，调度器按 Touches 串行即可；本任务不修改任何既有命中/音效/飘字逻辑。

## Plan

1. **文档先行**（CLAUDE.md 约定）：
   - `docs/ASSET_PIPELINE.md`：在 ART-001 已定的 manifest schema 内增加 `scenes` 分组（title / map / combat / result 各自的必需 id 集），不另发明格式。
   - `docs/ART_DIRECTION.md`：写明四场景的视觉锚点分别使用哪些精灵组（标题背景与 logo、选图卡片与地图缩略、战斗背景与 HUD 皮肤、结算面板）。
   - `docs/TECH_DESIGN.md`：新增「场景精灵接入矩阵」小节——四场景 → 必需/可选 id、两视口下 id 集一致（DPR 变体可不同）、DOM 场景如何通过管线暴露的 URL 设置 `<img>` / CSS 变量、Canvas 场景如何用注入的 `SpritePipeline` 绘制、缺资源回退到既有程序化绘制、`data-sprite-id` / `data-sprite-fallback` 标记约定。
2. 新增 `public/js/shared/scene-sprites.js`（纯数据/纯函数，导入期零 DOM、无 `Math.random`）：
   - `SCENE_SPRITES = { title, map, combat, result }`，每项 `{ required: [id…], optional: [id…], fallback: 'programmatic' }`，加载时深冻结；
   - `sceneSpriteIds(scene)`、`sceneSpritePlan(scene, { viewport, assetsReady })` → `{ ids, variant, useFallback }`；未知 scene 返回 `null` 不抛错；
   - `missingSceneSprites(scene, readyIds)` → 缺失 id 数组。
3. `public/js/render/sprite-pipeline.js`（AC-022 落地后的文件）增加只读能力，**不改变 AC-022 的既有契约**：`url(id)`（返回该 id 当前 DPR 变体的可加载 URL）、按 id 的绘制计数（`draw()` 内自增，`stats().draws` 暴露）与 `image(id)`。
4. 场景接线（缺资源时保持既有程序化绘制，不抛错、不刷屏）：
   - `public/js/ui/title.js`、`public/js/ui/modals.js`、`public/js/ui/result.js`：通过 `this.game?.renderer?.sprites` 取 `url(id)` / `image(id)`，给资源元素加 `data-sprite-id="<id>"`，用 `<img src>` 或 CSS 变量 `--sprite-<id>` 设置；DOM 模块内**不** `new Image`。
   - `public/js/render.js`：战斗场景按 `SCENE_SPRITES.combat` 绘制对应精灵，仅调用注入的管线。
5. 若 manifest 缺少场景皮肤条目：用 `scripts/build-sprite-atlas.mjs` 的声明式 spec 生成到 `public/assets/sprites/scenes/scene-atlas@{1x,2x}.png` + `scene-atlas.json`（零第三方依赖、同输入两次字节一致），provenance 写入 `public/assets/sprites/manifest.json`；若 ART-001 / gap-sprite-pipeline 已定义同名分组或路径，以文档与既有实现为准，并通过 `task_write` 同步 Touches。**不手绘、不引入第三方资源。**
6. 新增 `tests/scene-sprites.test.mjs`：四键完整性、每个 required id 都能在 manifest 中解析、plan 纯函数与回退语义、源码接线断言（三个 DOM 模块含 `data-sprite-id` 且仍无 `new Image`；`render.js` 引用 `SCENE_SPRITES.combat`；`scene-sprites.js` 不 import sim/render/DOM 且不含 `Math.random`）。
7. 新增 `tests/browser-sprite-scenes.mjs`（复用 `tests/harness.mjs` 的 `startTestServer` / `launchBrowser` / `registerAndLogin` / `chooseOpeningHex` / `chooseFirstMap`）：逐视口走真实 UI 到四个场景；断言每场景的 id 集与 `SCENE_SPRITES[scene].required` 相等；战斗场景读 `window.__rtd.state.renderer.sprites.stats().draws` 断言每个 required id 计数 ≥ 1；两视口同场景 id 集完全一致；回退臂用 `Network.setBlockedURLs` 屏蔽 `*assets/sprites/*` 后重载，断言四场景可到达、`window.__bootErrors` 为空、`stats().failed > 0`、每场景有 `data-sprite-fallback="1"` 或 canvas 回退计数 ≥ 1；把两臂 stats 与截图路径打印到 stdout。
8. 不新增第三方依赖；不改战斗数值、模拟、存档或计分；`npm test` 只新增 `tests/scene-sprites.test.mjs`。

## AC

- [ ] `node tests/browser-sprite-scenes.mjs` exit 0（这是本提案要为 GOAL-006 新增的 AC-030 的 criterion）
- [ ] `node --test tests/scene-sprites.test.mjs` exit 0
- [ ] `SCENE_SPRITES` 恰为 title / map / combat / result 四键，每项 `required` 非空，且所有 id 都能在 `public/assets/sprites/manifest.json` 中解析；`sceneSpritePlan('unknown') === null`
- [ ] 桌面（1440×900）与移动（390×844）两视口下，四个场景各自的 `data-sprite-id` / Canvas 绘制 id 集合完全一致
- [ ] 资源齐全时每个场景至少使用 1 个精灵：标题 / 选图 / 结算存在解析到 `/assets/sprites/` 的元素，战斗场景每个 required id 的绘制计数 ≥ 1
- [ ] 缺资源臂：屏蔽 `*assets/sprites/*` 后重新加载，四个场景仍可到达并渲染（`window.__bootErrors` 为空、`stats().failed > 0`、每场景有回退标记），不抛未捕获异常
- [ ] 源码断言：`public/js/ui/title.js`、`public/js/ui/modals.js`、`public/js/ui/result.js` 含 `data-sprite-id` 且仍不含 `new Image`；`public/js/shared/scene-sprites.js` 不 import sim/render、不含 `Math.random`；`public/js/render/sprite-pipeline.js` 仍不含 `Math.random`
- [ ] `npm test` exit 0
- [ ] 本提案获人认可、AC-030 已写入 GOAL-006 目标库（待外部）

## DoD

- [ ] 真实浏览器（Chrome，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）两视口 × 四场景实跑：输出每场景的 sprite id 集、绘制计数、DPR 变体与截图路径；截图人眼可见场景确实使用贴图而不是纯程序化绘制
- [ ] 同一两视口再跑资源屏蔽臂：四场景截图 + `window.__bootErrors` 为空 + 回退统计，证明缺资源不崩溃且回退是程序化绘制
- [ ] 前后对照：接入前后同 seed 的桌面与移动 contact sheet 落盘（`docs/reviews/scene-sprites-desktop-contact-sheet.png` / `scene-sprites-mobile-contact-sheet.png` / `scene-sprites-fallback-contact-sheet.png`），并说明每条场景资源来自 manifest 的哪一条 provenance
- [ ] 不回归：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` exit 0；`npm run perf:budget` exit 0（新增 drawImage 不突破预算）
- [ ] `docs/ASSET_PIPELINE.md` / `docs/ART_DIRECTION.md` / `docs/TECH_DESIGN.md` 的场景分组与接入矩阵同实现一致；Notes 记录 id 集、视口差异（变体）与回退路径
- [ ] 人裁定记录写入 Notes：认可 AC-030（推荐）/ 调整 criterion / supersede 并说明为什么场景级接入不应有目标级 AC（待外部）

## Touches

- `tasks/gap-goal-006-scene-sprite-adoption-ac.md`
- `docs/ASSET_PIPELINE.md`
- `docs/ART_DIRECTION.md`
- `docs/TECH_DESIGN.md`
- `public/js/shared/scene-sprites.js` (new)
- `public/js/render/sprite-pipeline.js`
- `public/js/render.js`
- `public/js/ui/title.js`
- `public/js/ui/modals.js`
- `public/js/ui/result.js`
- `scripts/build-sprite-atlas.mjs`
- `public/assets/sprites/manifest.json`
- `public/assets/sprites/scenes/scene-atlas@1x.png` (new)
- `public/assets/sprites/scenes/scene-atlas@2x.png` (new)
- `public/assets/sprites/scenes/scene-atlas.json` (new)
- `tests/scene-sprites.test.mjs` (new)
- `tests/browser-sprite-scenes.mjs` (new)
- `docs/reviews/scene-sprites-desktop-contact-sheet.png` (new)
- `docs/reviews/scene-sprites-mobile-contact-sheet.png` (new)
- `docs/reviews/scene-sprites-fallback-contact-sheet.png` (new)
