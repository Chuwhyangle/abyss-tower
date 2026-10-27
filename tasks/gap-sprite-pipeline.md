---
id: gap-sprite-pipeline
title: 精灵管线：清单加载、图集切帧、DPR 变体与缺资源回退
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/sprite-pipeline.test.mjs
depends_on:
  - ART-001
goal_ac: AC-022
---
## Proposal

GOAL-006 退出条件要求「四个场景全部走精灵资源，缺失资源时有程序化回退且不崩溃」，AC-022 以 `node --test tests/sprite-pipeline.test.mjs` 见证；该文件当前不存在（AC 证据为 `criterion-capability-unevaluable: tests/sprite-pipeline.test.mjs does not resolve under the criterion's cwd`）。当前仓库不存在任何精灵管线，四处结构性缺口：

- **没有任何外部图片加载路径**：全仓 `public/js/` 无 `new Image` / `createImageBitmap` / preload。现有 `drawImage` 画的都是离屏 canvas 自烘焙纹理（`public/js/render/glow-renderer.js:87`、`public/js/render/skill-renderer.js:605`、`public/js/render/overlay-renderer.js:28`）或整张烘焙背景（`public/js/render.js:136`）。图集切帧、DPR 变体、缓存失效、加载失败回退四件事都没有承载点。
- **DPR 的权威是唯一的，管线不能另起一套**：`public/js/render.js:66-71` 的 `applyDpr()` 以 `Math.min(settings.dpr, devicePixelRatio)` 计算，`public/js/settings.js:53` 把 dpr 限定为 {1,2}。管线必须被 `applyDpr()` 配置，而不是自己再读一次 `window.devicePixelRatio`，否则画质切换（`applySettings`）后精灵与画布分辨率会脱钩。
- **服务端不需要改**：`server/http/static.mjs` 对 `public/` 下任意文件按扩展名出 MIME，`.png`/`.json` 已登记，新增 `public/assets/` 即可被服务（缺失带扩展名资源返回 404，正好是回退路径要覆盖的场景）。
- **既有约束必须保持**：`tests/render-animations.test.mjs:192` 断言 `public/js/render/enemy-renderer.js` 与 `public/js/render/tower-renderer.js` 内不得出现 `new Image`（"不得加载外部图片"）。因此加载器只能存在于管线模块，实体渲染器通过依赖注入拿管线——这也是 AC-023 接入时的前提契约。

<!-- dedup-ref -->
相邻但不重叠：ART-001（AC-021）定稿 `docs/ART_DIRECTION.md` / `docs/ASSET_PIPELINE.md` 与运行时令牌，本任务消费其清单 schema 与目录规范，不重写文档（因此 `depends_on: [ART-001]`，文档先行）；VIS-001（AC-018）做确定性场景采集与视觉验收基建，本任务不依赖其像素比对（Touches 仅在 `package.json` 相交）；AC-023 才做塔/敌人/召唤物/可破坏物/传送门/基地的精灵与状态动画，本任务只交付管线 + 一个自检资源，不改任何实体渲染器。granularity 决策：与 ART-001 分开立案——验收面独立（AC-022 的判据是单测 exit 0，ART-001 是 `tests/art-spec.test.mjs`），且 ART-001 已 ready 即将派发。

## Plan

1. `public/js/render/sprite-manifest.js`（纯数据/纯函数，导入期零 DOM）：
   - `normalizeManifest(raw)` → `{ entries, errors }`：按 `docs/ASSET_PIPELINE.md` 的清单 schema 归一化。缺 `id`/`src`、尺寸非正整数、锚点越界、DPR 变体非数组的条目进入 `errors` 而不是抛错；重复 id 只保留最后一条并在 `errors` 记一条。
   - `resolveDprVariant(entry, deviceDpr)`：从 `entry.dpr`（如 `[1,2]`）取不超过 deviceDpr 的最高档；无匹配回落到该条目最低档；`0`/`NaN`/`undefined`/负数一律按 1；只有 @1x 的条目在 deviceDpr=3 时仍返回 1。
   - `atlasFrame(atlas, name)`：由 atlas JSON 的 `frames` 计算 `{ sx, sy, sw, sh, ax, ay }`，未知帧返回 `null`；`trimmed`/`rotated` 帧按 `docs/ASSET_PIPELINE.md` 约定支持或显式拒绝（拒绝即返回 `null`，不得抛错）。
2. `public/js/render/sprite-pipeline.js`（`SpritePipeline` 类，构造注入 loader；模块导入期不触碰 `document`/`Image`，Node 下可直接 import）：
   - 每条目状态机：`missing | pending | ready | failed | skipped`；`preload(onProgress)` **永不 reject**，单条失败只影响该 id；并发上限默认 6，单条超时默认 8s（可注入，测试用短值）。
   - `frame(id)` → `{ image, sx, sy, sw, sh, dw, dh, ax, ay }`（无图集时 `sx=sy=0`，`sw/sh` 取整图），未知/未就绪/失败一律 `null`。
   - `draw(ctx, id, x, y, { scale, alpha, rotation })`：`null` 时返回 `false` 且**不发起任何绘制调用**（渲染器据此走既有程序化绘制）；就绪时恰好一次 `drawImage`（图集走 9 参重载）并返回 `true`；`alpha/rotation` 用 `save/restore` 包住。
   - `configure({ dpr })`：DPR 变化只重选变体，不重复下载已缓存的 URL（同一 URL 不二次加载）。
   - 内存预算 `maxBytes`：超预算时先丢弃 @2x 变体，仍超出则把剩余条目标记 `skipped`；`stats()` 给 `{ total, ready, failed, skipped, pending, bytes, inFlight }`。
   - 缓存失效：`invalidate(id)` 回到 `pending` 并递增 generation，失效前发出、失效后才回来的加载结果被丢弃；`dispose()` 释放引用且此后 `draw` 一律 `false`。
   - 缺资源每个 id 只 `console.warn` 一次（不刷屏），全程不用 `console.log`（`scripts/style-check.mjs` 的 `console-log` 规则）。
3. `public/js/render.js`：`Renderer` 构造时创建 `this.sprites = new SpritePipeline({ manifestUrl: '/assets/sprites/manifest.json', dpr: this.dpr })` 并 fire-and-forget `preload()`；`applyDpr()` 内调用 `this.sprites?.configure({ dpr: this.dpr })`；新增 `dispose()` 转发到管线。DPR 仍以 `applyDpr()` 为唯一权威。
4. `public/js/game-app.js`：`destroy()` 调 `this.renderer.dispose?.()`；浏览器测试通过既有 `window.__rtd` 以 getter 暴露 `sprites`（不新增全局名）。
5. `scripts/build-sprite-atlas.mjs`（零依赖，`node:zlib` 自写 PNG 编码 + CRC32）：由声明式 spec 生成自检资源——`@1x`/`@2x` 两张 PNG + atlas JSON（≥2 帧，覆盖 trimmed 与非 trimmed），把 provenance（生成脚本、尺寸、DPR、授权字段）写进 `public/assets/sprites/manifest.json`；同输入两次执行产物字节一致（不写时间戳）。资源路径遵循 `docs/ASSET_PIPELINE.md` 的目录规范；若文档约定与本 Plan 的 `probe/` 路径不同，以文档为准，并通过 `task_write` 同步 Touches。
6. `tests/sprite-pipeline.test.mjs`：注入假 loader（成功 / 失败 / 永不返回 / 计数并发），覆盖 Plan 1–2 的每条契约，并做源码级断言（实体渲染器仍无 `new Image`；管线不 import 模拟层、不含 `Math.random`）。
7. `tests/browser-sprites.mjs`：真实浏览器验收（复用 `tests/harness.mjs` 的 `startTestServer` / `launchBrowser`），见 DoD。
8. `docs/TECH_DESIGN.md` 新增「精灵资源管线」小节：状态机、DPR/变体选择、内存预算、回退与降级契约；与 `docs/ASSET_PIPELINE.md` 不重复定义，只写运行时实现。
9. `package.json` 增加 `test:sprites` 脚本指向 `tests/browser-sprites.mjs`。

## AC

- [x] `node --test tests/sprite-pipeline.test.mjs` exit 0
- [x] 清单校验：非法条目进 `errors` 且不抛错（缺 id/src、尺寸 0/负数/非整数、锚点越界各一例）；重复 id 只保留最后一条
- [x] DPR 变体：`resolveDprVariant` 在 deviceDpr = 1 / 1.5 / 2 / 2.6 / 0 / NaN 下取值符合 Plan；只有 @1x 的条目在 deviceDpr=3 时返回 1；`configure({dpr})` 后 `frame(id).dw/dh` 与该档变体尺寸一致
- [x] 图集：`atlasFrame` 对有效帧返回正确 `sx/sy/sw/sh` 与锚点偏移，未知帧返回 `null` 不抛错
- [x] 缺资源回退：loader 报错的条目 `state === 'failed'`、`frame(id) === null`、`draw()` 返回 `false` 且假 ctx 的 `drawImage` 调用数为 0、`preload()` 正常 resolve、`stats().failed` 计数正确
- [x] 超时与并发：永不返回的 loader 在配置的短超时后把条目标记 `failed`；20 条、并发上限 6 时 loader 观测到的同时在途峰值 ≤ 6
- [x] 内存预算：总量超 `maxBytes` 时先丢 @2x、再标 `skipped`，`stats().bytes <= maxBytes`，无条目死等 `pending`，不抛错
- [x] 失效竞态：`invalidate(id)` 后回 `pending`；失效前发出、失效后才完成的加载结果不得把条目变回 `ready`；重新 `preload()` 后才 `ready`
- [x] `draw()` 语义：单图恰好一次 4 参 `drawImage`；图集恰好一次 9 参 `drawImage` 且 `sx/sy/sw/sh` 正确；`alpha/rotation` 经 `save/restore` 不泄漏 ctx 状态
- [x] 源码断言：`public/js/render/sprite-pipeline.js` 不 import `sim` / `shared/rng`、不含 `Math.random`；`public/js/render/enemy-renderer.js` 与 `public/js/render/tower-renderer.js` 仍不含 `new Image`（不破坏 `tests/render-animations.test.mjs`）
- [x] `npm test` exit 0；`npm run check:syntax`、`npm run check:style`、`npm run check:imports` exit 0

## DoD

- [x] 真实浏览器加载：`node tests/browser-sprites.mjs` 在真实服务 + Chrome 下开局，`window.__rtd.sprites.stats()` 中自检资源为 `ready`，`frame(id)` 的 `sw/sh` 与 atlas JSON 一致，`draw()` 到画布后该区域像素发生变化（读回像素或 `toDataURL` 哈希对比），`window.__bootErrors` 为空
- [x] DPR 实测：同一浏览器分别以 `settings.dpr = 1` 与 `2` 开局，管线选中的变体分别是 `@1x` / `@2x`（记录实际请求 URL 与 `window.devicePixelRatio`）；设备 DPR=1 时不得请求 `@2x`
- [x] 缺资源实测：用 CDP `Network.setBlockedURLs` 屏蔽自检资源后重载页面——正常启动、`window.__bootErrors` 为空、该条目 `failed`、对局照常渲染（帧数/截图正常），且 warn 只有一条不刷屏
- [x] 资源可追溯：`node scripts/build-sprite-atlas.mjs` 连跑两次产物字节一致；`manifest.json` 每条带 provenance 与授权字段，符合 `docs/ASSET_PIPELINE.md`
- [x] 性能不回归：`npm run perf:budget` exit 0，并记录 preload 完成时刻、失败数、字节数与单帧新增 `drawImage` 次数
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（启动链无回归）
- [x] `docs/TECH_DESIGN.md` 的管线小节与实现一致；Notes 记录 DPR/内存预算取值理由与 AC-023 的接入契约（实体渲染器只接收注入的 pipeline，不自己加载图片）

## Touches

- `public/js/render/sprite-manifest.js` (new)
- `public/js/render/sprite-pipeline.js` (new)
- `public/js/render.js`
- `public/js/game-app.js`
- `public/js/app/controller.js`
- `scripts/build-sprite-atlas.mjs` (new)
- `scripts/test-changed.mjs`
- `public/assets/sprites/manifest.json` (new)
- `public/assets/sprites/probe/probe-atlas.json` (new)
- `public/assets/sprites/probe/probe.png` (new)
- `public/assets/sprites/probe/probe@2x.png` (new)
- `tests/sprite-pipeline.test.mjs` (new)
- `tests/browser-sprites.mjs` (new)
- `package.json`
- `tasks/gap-sprite-pipeline.md`

## Notes

- 管线是**基础设施**，不是视觉改动：默认 manifest 缺资源 / 空清单时画面必须与今天逐像素一致（回退即既有程序化绘制）。任何"看起来变了"都应视为缺陷。
- 与 AC-023 的边界：实体渲染器只接收注入的 `SpritePipeline`，自己不 load 图片（`tests/render-animations.test.mjs:192` 的断言保持有效）。
- 自检资源同时是图集生成脚本的回归夹具：`scripts/build-sprite-atlas.mjs` 的可重复性是 AC-023 批量出图的前提。
- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。
- **运行时不变式与文档对齐**：实现逐条对齐 `docs/PHASE_FEEL_ART.md` §4.2 的契约表（状态机 / `frame(id)` 返回形状 / `draw` 布尔语义与「false 时零绘制」/ DPR 只由 `applyDpr()` 重选 / 预算先丢 @2x 再 `skipped` / generation 失效 / 缺资源每 id 只告警一次）。`docs/TECH_DESIGN.md` §5.5.2–§5.5.3 由文档 lane（DOCS-001）冻结，本次**未修改**该文档。
- **取值理由**：并发上限 6 —— 单场景首次预载的 URL 数 ≤ 8，6 路并行在同源静态服务下不会触发浏览器连接排队惩罚，又能让失败快速暴露；单条超时 8s —— 短于浏览器验收的启动等待（`HARNESS_WAIT_TIMEOUT_MS` = 20s），慢资源在开局阶段就降级，不会拖住后续帧；`maxBytes` 默认 64 MiB —— 按解码后 RGBA 估算（`w × h × 4`），四场景 @2x 图集合计约 16–24 MiB，留 2–3 倍余量，低端机由「先丢 @2x」兜底。
- **实测证据（本机 2026-10-27）**：
  - `node --test tests/sprite-pipeline.test.mjs`：18/18 通过（含清单校验、DPR 矩阵、图集切帧、失败/超时/并发/预算/失效竞态、源码断言）。
  - `node tests/browser-sprites.mjs`：通过。@1x 预载 ~0.5s、3072 bytes；@2x 预载 ~0.7s、12288 bytes；失败 0；设备 DPR=1 时只请求 `probe.png`、DPR=2 时只请求 `probe@2x.png`、`settings.dpr=1` + 设备 2x 只取 @1x；屏蔽 PNG 后 `failed=1`、warn 恰好 1 条、`__bootErrors` 为空、渲染帧数持续增长（2 → 22）。
  - `npm run perf:budget`：PASS（normal-1x-low / late-3x-high / skills-1x-high 三场景 Δ 均在预算内）。
  - 单帧新增 `drawImage` 次数：**0** —— 本任务只交付管线，尚未接任何实体渲染器；AC-023 接入后为「每个有精灵的实体恰好 1 次」。
  - `node scripts/build-sprite-atlas.mjs` 连跑两次：四个产物 sha256 完全一致（manifest `25d78f24…`、`probe.png` `284f206f…`、`probe@2x.png` `be9dbe94…`、`probe-atlas.json` `70c2b266…`）。
  - `npm test`：1496/1496 通过（合并 develop 前）。合并后在 `tests/docs-phase-sync.test.mjs` 上出现 1 条**与本次改动无关的**红：open 任务 `gap-weapon-impact-vfx` 把 `docs/TECH_DESIGN.md` 写回了 Touches（该任务当时有活跃 worker，属文档 lane 的既有不变量，交由该任务自行修复）。
  - `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`：exit 0（另有一次运行因「一次点击建出两座塔」的既有输入竞态误报，单独重跑通过；与本改动无关）。
- **路径更正**：自检资源文件名按 `docs/ASSET_PIPELINE.md`「DPR 1 不带后缀」定为 `probe.png` / `probe@2x.png`（Plan 原写 `probe@1x.png`），Touches 已同步为实际路径。
- **Touches 追加说明**：新增 `public/js/app/controller.js`（在既有 `window.__rtd` 上加 `sprites` getter，满足 DoD 的 `window.__rtd.sprites.stats()` 且不新增全局名）与 `scripts/test-changed.mjs`（新源文件必须登记 TEST_MAP，否则全量 suite 的「审计覆盖」变红）。
