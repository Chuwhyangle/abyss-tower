---
id: gap-scene-sprite-adoption
title: 场景精灵接入矩阵：四场景 × 两视口走精灵 + 缺资源场景级回退（AC-031）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - ART-001
  - gap-sprite-pipeline
goal_ac: AC-031
---
## Proposal

AC-031 的 criterion 是 `node tests/browser-sprite-scenes.mjs`（expect exit 0），该文件当前不存在，AC 证据为 `criterion-capability-unevaluable`（命令无法解析，不能算一次读数）。GOAL-006 退出条件第二条逐字要求：

> 标题、选图、战斗、结算四个场景在桌面与移动两个视口下全部走精灵资源；缺失资源时有程序化回退且不崩溃。

**当前 HEAD 的代码事实（2026-10-27 实测）：**

- 精灵管线尚不存在：`public/js/render/sprite-pipeline.js`、`public/js/render/sprite-manifest.js`、`public/assets/` 目录、`scripts/build-sprite-atlas.mjs` 均不在仓库内；`docs/ASSET_PIPELINE.md` / `docs/ART_DIRECTION.md` 也不存在。管线本体与文档分别由 `gap-sprite-pipeline`（AC-022）与 `ART-001`（AC-021）交付，两者都还是 todo/ready，本任务的 `depends_on` 已声明这两个前置。
- 全仓 `grep -rn "new Image\|createImageBitmap\|backgroundImage" public/js` 0 命中：今天没有任何外部图片加载或使用路径。「四个场景全部走精灵资源」在代码里没有承载点。
- 四场景的承载位置：标题 `public/js/ui/title.js:23`（`titleMethods`）、选图 `public/js/ui/modals.js`（`.map-modal` DOM 模板）、结算 `public/js/ui/result.js:34`（`showResult`）都是 **DOM 场景**；战斗是 Canvas（`public/js/render.js`，`Renderer.applyDpr()` 是 DPR 的唯一权威）。
- 场景级回退同样没有见证：管线层的缺资源回退由 AC-022 覆盖，但「每个场景在缺资源时仍能进入、渲染、不崩溃」是场景层的机制，现有 AC 集无一测量。

**为什么这条 AC 不能用既有 AC 代替**：AC-021 只校验文档与 manifest schema；AC-022 是注入假 loader 的单测，其 Notes 明确要求「默认缺资源时画面必须与今天逐像素一致」——管线通过不蕴含任何场景在使用精灵；AC-023 是实体维度（塔/敌人/召唤物/可破坏物/传送门/基地），不覆盖标题/选图/结算三个 DOM 场景；AC-024/025/027 是质量指标与布局，程序化绘制也能通过；AC-029 只看语义评审记录是否存在。本任务补的正是「场景 × 视口接入矩阵 + 场景级回退」这一维，验收面独立。

<!-- dedup-ref -->
机制分工与相邻任务：`gap-sprite-pipeline`（AC-022，管线本体与自检资源）与 `ART-001`（AC-021，文档与 manifest schema）是本任务的前置依赖，本任务只在其上补场景接线，不重写管线或文档格式；`gap-entity-sprite-coverage`（AC-023，实体维度）与本任务共享 `public/js/render.js` 与 `public/assets/sprites/manifest.json`，但验收面不同（`tests/sprite-coverage.test.mjs` vs `tests/browser-sprite-scenes.mjs`），判定 **separate**，调度器按 Touches 串行即可；`gap-art-review-record`（AC-029）只写评审记录，不接线；`gap-i18n-coverage-zero-hardcode`（AC-026）也改 `public/js/ui/{title,modals,result}.js`，但只改文案，本任务只加 `data-sprite-id` 与图片设置，文件重叠由调度器串行。已存在的 `gap-goal-006-scene-sprite-adoption-ac`（done）是产生 AC-031 的提案，不含实现，且未以 `goal_ac` 认领本 AC，不是重复任务。

## Plan

1. **文档先行**（CLAUDE.md 约定；在 ART-001 已定稿的 schema 内增量，不另发明格式）：
   - `docs/ASSET_PIPELINE.md`：增加 `scenes` 分组（title / map / combat / result 各自的必需 id 集）与场景图集的命名、目录、锚点约定。
   - `docs/ART_DIRECTION.md`：写明四场景分别使用哪些精灵组（标题背景与 logo、选图卡片与地图缩略、战斗背景与 HUD 皮肤、结算面板），以及缺资源时的程序化语言。
   - `docs/TECH_DESIGN.md`：新增「场景精灵接入矩阵」小节——四场景 → 必需/可选 id、两视口下 id 集一致（DPR 变体可不同）、DOM 场景如何通过管线暴露的 URL 设置 `<img>` / CSS 变量、Canvas 场景如何用注入的 `SpritePipeline` 绘制、缺资源回退到既有程序化绘制、`data-sprite-id` / `data-sprite-fallback` 标记约定。
2. 新增 `public/js/shared/scene-sprites.js`（纯数据/纯函数，导入期零 DOM、无 `Math.random`、不 import sim/render）：
   - `SCENE_SPRITES = { title, map, combat, result }`，每项 `{ required: [id…], optional: [id…], fallback: 'programmatic' }`，加载时深冻结；
   - `sceneSpriteIds(scene)`；`sceneSpritePlan(scene, { viewport, assetsReady })` → `{ ids, variant, useFallback }`；`missingSceneSprites(scene, readyIds)`；
   - 未知 scene 返回 `null`，不抛错。
3. `public/js/render/sprite-pipeline.js` 增加只读能力，**不改变 AC-022 的既有契约**：`url(id)`（该 id 当前 DPR 变体的可加载 URL）、`image(id)`、按 id 的绘制计数（`draw()` 内自增，`stats().draws` 暴露）。若管线已有等价只读访问器，直接复用，不重复实现。
4. 场景接线（缺资源时保持既有程序化绘制，不抛错、不刷屏）：
   - `public/js/ui/title.js`、`public/js/ui/modals.js`、`public/js/ui/result.js`：通过 `this.game?.renderer?.sprites` 取 `url(id)` / `image(id)`，给资源元素加 `data-sprite-id="<id>"`，用 `<img src>` 或 CSS 变量 `--sprite-<id>` 设置；DOM 模块内**不** `new Image`；资源不可用时加 `data-sprite-fallback="1"` 并保持既有样式。
   - `public/js/render.js`：战斗场景按 `SCENE_SPRITES.combat` 绘制对应精灵，仅调用注入的管线；`draw()` 返回 `false` 时完整走既有程序化绘制。
5. 场景皮肤资源：若 manifest 缺少场景条目，用 `scripts/build-sprite-atlas.mjs` 的声明式 spec 生成 `public/assets/sprites/scenes/scene-atlas@{1x,2x}.png` + `scene-atlas.json`（零第三方依赖、同输入两次字节一致），provenance 写入 `public/assets/sprites/manifest.json`；若 ART-001 / gap-sprite-pipeline 已定义同名分组或路径，以文档与既有实现为准，并通过 `task_write` 同步 Touches。**不手绘、不引入第三方资源。**
6. 新增 `tests/scene-sprites.test.mjs`：四键完整性、每个 required id 都能在 manifest 中解析、plan 纯函数与回退语义（含未知 scene 返回 `null`）、源码接线断言（三个 DOM 模块含 `data-sprite-id` 且仍无 `new Image`；`render.js` 引用 `SCENE_SPRITES.combat`；`scene-sprites.js` 不 import sim/render/DOM 且不含 `Math.random`）。
7. 新增 `tests/browser-sprite-scenes.mjs`（复用 `tests/harness.mjs` 的 `startTestServer` / `launchBrowser` / `registerAndLogin` / `chooseOpeningHex` / `chooseFirstMap`）：逐视口走真实 UI 到四个场景；断言每场景 id 集与 `SCENE_SPRITES[scene].required` 相等；战斗场景读 `window.__rtd.sprites.stats().draws` 断言每个 required id 计数 ≥ 1；两视口同场景 id 集完全一致；回退臂用 CDP `Network.setBlockedURLs` 屏蔽 `*assets/sprites/*` 后重载，断言四场景可到达、`window.__bootErrors` 为空、`stats().failed > 0`、每场景有 `data-sprite-fallback="1"` 或 canvas 回退计数 ≥ 1；把两臂 stats 与截图路径打印到 stdout。浏览器测试必须带 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`。
8. 不新增第三方依赖；不改战斗数值、模拟、RNG 调用顺序、存档或计分；`npm test` 只新增 `tests/scene-sprites.test.mjs`。若最终新增 `scripts/` 源文件，必须同步 `scripts/test-changed.mjs` 的 `TEST_MAP` 并把它加进 Touches（`public/js/shared/` 属 SHARED_RULES，已回退全量，无需登记）。

## AC

- [ ] `node tests/browser-sprite-scenes.mjs` exit 0（AC-031 的 criterion；真实 Chrome + 真实服务、两视口 × 四场景、资源齐全与资源屏蔽两臂）
- [ ] `node --test tests/scene-sprites.test.mjs` exit 0
- [ ] `SCENE_SPRITES` 恰为 title / map / combat / result 四键，每项 `required` 非空，且所有 id 都能在 `public/assets/sprites/manifest.json` 中解析；`sceneSpritePlan('unknown') === null` 且不抛错
- [ ] 桌面（1440×900）与移动（390×844）两视口下，四个场景各自的 `data-sprite-id` / Canvas 绘制 id 集合完全一致（脚本 stdout 打印两侧 id 集，测试内断言相等）
- [ ] 资源齐全臂：标题 / 选图 / 结算存在解析到 `/assets/sprites/` 的元素，战斗场景每个 required id 的绘制计数 ≥ 1
- [ ] 缺资源臂：屏蔽 `*assets/sprites/*` 后重新加载，四个场景仍可到达并渲染（`window.__bootErrors` 为空、`stats().failed > 0`、每场景有回退标记），不抛未捕获异常
- [ ] 源码断言：`public/js/ui/title.js`、`public/js/ui/modals.js`、`public/js/ui/result.js` 含 `data-sprite-id` 且仍不含 `new Image`；`public/js/shared/scene-sprites.js` 不 import sim/render、不含 `Math.random`；`public/js/render/sprite-pipeline.js` 仍不含 `Math.random`
- [ ] 场景图集可复现：`node scripts/build-sprite-atlas.mjs` 连跑两次，场景 PNG 与 `scene-atlas.json` 字节一致（不含时间戳/随机量）
- [ ] `npm test` exit 0；`npm run check:syntax`、`npm run check:style`、`npm run check:imports` exit 0

## DoD

- [ ] 真实浏览器（Chrome，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）两视口 × 四场景实跑：输出每场景的 sprite id 集、绘制计数、DPR 变体与截图路径；截图人眼可见场景确实使用贴图而不是纯程序化绘制
- [ ] 同一两视口再跑资源屏蔽臂：四场景截图 + `window.__bootErrors` 为空 + 回退统计，证明缺资源不崩溃且回退是程序化绘制
- [ ] 前后对照：接入前后同 seed 的桌面与移动 contact sheet 落盘（`docs/reviews/scene-sprites-desktop-contact-sheet.png` / `scene-sprites-mobile-contact-sheet.png` / `scene-sprites-fallback-contact-sheet.png`），并说明每条场景资源来自 manifest 的哪一条 provenance
- [ ] 不回归：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` exit 0；`npm run perf:budget` exit 0（新增 drawImage 不突破预算）
- [ ] `docs/ASSET_PIPELINE.md` / `docs/ART_DIRECTION.md` / `docs/TECH_DESIGN.md` 的场景分组与接入矩阵同实现一致；Notes 记录 id 集、视口差异（变体）与回退路径

## Touches

- `tasks/gap-scene-sprite-adoption.md`
- `docs/ASSET_PIPELINE.md`
- `docs/ART_DIRECTION.md`
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

## Notes

- **依赖未落地时停在本任务门口**：若 `public/js/render/sprite-pipeline.js`、`public/assets/sprites/manifest.json` 或 `docs/ASSET_PIPELINE.md` 在派发 worktree 内不存在，说明 `ART-001` / `gap-sprite-pipeline` 尚未合入，不要自带副本或另发明 schema，直接报告依赖未满足。
- 精灵是**替换形体**而不是叠加：`draw()` 返回 `true` 时跳过对应的程序化形体绘制，避免双重描边与每帧 drawImage 预算翻倍；DOM 场景同理，有 `<img>` 时不再绘制程序化底图。
- DPR 的唯一权威是 `Renderer.applyDpr()`；DOM 场景取 `url(id)` 时由管线按已配置的 DPR 选变体，模块内不得自己读 `window.devicePixelRatio`。
- 回退必须静默：每个缺失 id 只 `console.warn` 一次（由管线负责），场景层不得额外刷屏，也不得使用 `console.log`（`scripts/style-check.mjs` 规则）。
- 本 AC 的 criterion 是浏览器脚本而非 `npm test` 覆盖的用例，因此 DoD 里的实跑读数（stdout 的 id 集 / 计数 / 截图路径）是必要证据，不能只用单测代替。
- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。
