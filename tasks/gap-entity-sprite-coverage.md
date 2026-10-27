---
id: gap-entity-sprite-coverage
title: 单位精灵覆盖：六类实体独立精灵与 ≥2 状态动画（AC-023）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/sprite-coverage.test.mjs
depends_on:
  - ART-001
  - gap-sprite-pipeline
goal_ac: AC-023
---
## Proposal

AC-023 的 criterion 是 `node --test tests/sprite-coverage.test.mjs`，该文件当前不存在（AC 证据为 `criterion-capability-unevaluable: tests/sprite-coverage.test.mjs does not resolve under the criterion's cwd`）。GOAL-006 退出条件要求「8 塔（含进化形态）、12+ 敌人与首领、召唤物、可破坏物、传送门、基地都有独立精灵与至少两种状态动画」，当前仓库在**实体维度**上有四处结构性缺口：

- **没有任何实体精灵，全部是程序化绘制**：`public/js/render/tower-renderer.js`（1042 行）、`enemy-renderer.js`（1009 行）、`ally-renderer.js`（70 行）、`destructible-renderer.js`（369 行）、`portal-renderer.js`（259 行）都用 Canvas 路径直接构造形体；全仓 `public/js/` 无 `new Image` / `createImageBitmap`，即「独立精灵」在代码里没有承载点。
- **状态动画已有语义、没有精灵帧**：塔有 `tower.recoil`（`sim/tower-system.js:13`）与 `disabledUntil`/`upgradePulse`；敌人有 `enemy.hitFlash`（`sim/combat-system.js:83`）、`enemy.cast`（首领吟唱，`sim/enemy-system.js:154`）；盟友有 `ally.recoil`（`sim/enemy-system.js:338`）；可破坏物有 `item.destroyed`；传送门有 `portalChargeLevel(phase, time)`（`render/portal-renderer.js:42`）；基地有 `game.baseHp` 比例与 `Renderer.hurtFlash`（`render.js:165-178`）。这些状态目前只驱动程序化形变，没有「同一实体的第 2 套精灵帧」。
- **id 集是封闭且可枚举的，但没有任何覆盖登记**：`TOWERS` 8 型 × 每型 3 条进化 = 32 个塔形态；`ENEMIES` 12 型（含 `boss`、`splitling`）+ `BOSS_VARIANTS` 3 个变体（`enemy.variant` 为 `armored`/`summoner`/`berserk`，`null` 时是通用首领）；召唤物目前只有 `kind: 'skeleton'`（`shared/hexes/undead-legion.js:56`，框架入口 `sim.spawnAlly`）；可破坏物 5 型（`DESTRUCTIBLE_TYPES`：vein/obelisk/cache/nest/totem）；传送门与基地都在 `portal-renderer.js`（基地绘制在 201-203 行）。今天没有任何数据结构把「实体 id → 精灵 id → 状态 → 图集帧」登记起来，也不存在「新增一种敌人却忘记出图」的机械拦截。
- **验收面缺失**：AC-023 需要的是一份能在 Node 里机械判定的覆盖证明——每个实体 id 都有独立精灵、每个实体至少两种状态对应**不同**的图集帧、清单可解析且资源真实存在——而不是「有一张图集」。现有 `tests/render-animations.test.mjs` 只按三档画质断言程序化动画的行为，不涉及精灵资源。

<!-- dedup-ref -->
相邻但不重叠的任务：ART-001（AC-021）定稿 `docs/ASSET_PIPELINE.md` 的清单 schema 与目录规范，本任务消费它而不重写（故 `depends_on: [ART-001]`）；gap-sprite-pipeline（AC-022）交付 `SpritePipeline`（加载/图集切帧/DPR/回退）与一个自检资源，其 Notes 明确「本任务只交付管线 + 一个自检资源，不改任何实体渲染器」，本任务只通过注入的管线绘制实体（故 `depends_on: [gap-sprite-pipeline]`）；gap-goal-006-scene-sprite-adoption-ac 覆盖的是**场景维度**（标题/选图/战斗/结算 × 两视口，提案新增 AC-030，仍为 needs-human），与实体维度互补；VIS-001（AC-018）是确定性场景采集基建。判定 **separate**：验收面彼此独立（AC-023 的判据是 `tests/sprite-coverage.test.mjs`），合并会把两条目标级 AC 压进同一个任务并放大管线任务的爆炸半径。

## Plan

1. **文档先行**（CLAUDE.md 约定）：
   - `docs/ASSET_PIPELINE.md`：在 ART-001 已定的 schema 内增加实体命名与状态后缀约定（`<family>.<entity-id>.<state>`，如 `enemy.grunt.move`、`tower.arrow-longbow.attack`、`portal.spawn.charge`）、实体图集分组与锚点规则（单位锚点固定在脚底/塔基，避免不同帧漂移）；不另发明格式，若 ART-001 已定义同名规则以文档为准。
   - `docs/TECH_DESIGN.md` 新增「单位精灵覆盖与状态动画」小节：六类实体的覆盖集来源、状态优先级（敌人 `cast > hit > move`；塔 `disabled > recoil > idle`；盟友/可破坏物/传送门/基地各自的状态函数）、进化形态选择规则（`tower.evolutions` 多选时取最后一个已应用形态作为主体，其余以挂饰精灵叠加或忽略，规则冻结）、缺资源时回退到既有程序化绘制、DPR 变体由 `applyDpr()` 唯一权威。
2. 新增 `public/js/render/sprite-coverage.js`（纯数据/纯函数，导入期零 DOM、无 `Math.random`、不 import sim/render）：
   - `ENTITY_SPRITE_FAMILIES = ['tower','enemy','summon','destructible','portal','base']`；
   - `ENTITY_SPRITES`：32 个塔形态（8 型 + 24 进化 id）、12 个敌人类型 + 3 个首领变体、`skeleton`、5 个可破坏物、`portal`、`base`，每条 `{ id, states: { <state>: spriteId }, anchor, scale }`，加载期深冻结；
   - 纯状态选择器：`towerSpriteState(tower, settings)`、`enemySpriteState(enemy)`（首领 `enemy.variant` 解析变体 id）、`summonSpriteState(ally)`、`destructibleSpriteState(item)`、`portalSpriteState(phase, time)`、`baseSpriteState(hpRatio, hurtFlash)`；未知输入返回 `null`（渲染器据此走既有程序化路径，不抛错）；
   - `entitySpriteIds()` / `coverageGaps(manifest)`：供测试枚举与「新增实体忘记出图」的机械拦截。
3. 新增 `scripts/build-entity-sprites.mjs`（零第三方依赖，`node:zlib` 自写 PNG 编码 + CRC32，与 `build-sprite-atlas.mjs` 同风格）：用声明式几何 spec（形体轮廓 + 「暗黑霓虹几何」色板 + 每个状态一帧姿态差异）生成实体图集 `@1x`/`@2x` + atlas JSON，并把实体条目合并进 `public/assets/sprites/manifest.json`（保留 AC-022 的 probe 条目不动），每条带 `provenance` / `license` / `generator` / 内容哈希；同输入两次执行产物字节一致（不写时间戳）。不手绘、不引入第三方资源。
4. **渲染接线**（只通过注入的 `SpritePipeline`，实体渲染器内仍不得出现 `new Image`）：`public/js/render.js` 把 `this.sprites` 传给五个实体渲染器；`tower-renderer.js` / `enemy-renderer.js` / `ally-renderer.js` / `destructible-renderer.js` / `portal-renderer.js` 先用 `sprite-coverage.js` 的状态选择器算出精灵 id，再 `sprites.draw(ctx, id, x, y, {...})`；返回 `false` 时**完整走**既有程序化绘制（默认缺资源时画面与今天一致），返回 `true` 时跳过对应的程序化形体绘制、保留射程圈/血条/首领标签/受击闪白等覆盖层。
5. 保持既有约束：`tests/render-animations.test.mjs:192`（实体渲染器不得 `new Image`）与 `tests/render-budget.test.mjs` 每帧绘制预算不回归；三档画质（off/light/full）只影响额外特效层，不影响「实体有精灵时用精灵」这一事实。
6. 新增 `tests/sprite-coverage.test.mjs`（AC-023 的 criterion）：
   - 从数据表枚举权威 id 集（`TOWERS` + 全部 `evolutions`、`ENEMIES` + `BOSS_VARIANTS`、`DESTRUCTIBLE_TYPES`、`undead-legion` 的 `kind`、portal/base），与 `ENTITY_SPRITES` 做集合相等断言（多一个/少一个都失败）；
   - 每个实体 ≥2 个状态、状态精灵 id 互不相同、对应图集帧解码后的像素哈希互不相同；
   - 清单可解析：文件存在、PNG 尺寸与声明一致、图集帧在图片边界内、哈希与 `provenance` 字段齐全；
   - 状态选择器单测（正常态、受击态、吟唱态、destroyed、低血/受击）与未知输入返回 `null`；
   - 源码断言：五个渲染器引用注册表与注入管线；`sprite-coverage.js` 无 `Math.random`、不 import sim/DOM；实体渲染器无 `new Image`；
   - 生成器确定性：两次序列化的清单实体段字节一致（不在单测里跑整脚本，断言 canonical 序列化不含时间戳/随机量）。
7. 新增 `tests/browser-sprite-coverage.mjs`（复用 `tests/harness.mjs` 的 `startTestServer` / `launchBrowser` / `registerAndLogin` / `chooseOpeningHex` / `chooseFirstMap`）：真实 Chrome（`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）里用公开 sim API 造出六类实体——`sim.spawnEnemy` 覆盖 12 型、首领变体按波次/`variant` 字段覆盖 3 型、`sim.placeTower` 覆盖 8 型并为每型应用 3 条进化（`sim.evolveTower`）、`sim.spawnAlly({ kind: 'skeleton' })`、地图可破坏物覆盖 5 型、传送门与基地来自地图；在实例上包一层 `sprites.draw` 计数（测试侧插桩，不新增生产 API），断言每个实体的精灵 id 被绘制 ≥1 次；再切换状态（`recoil`/`hitFlash`/`cast`/`destroyed`/低血）断言帧 id 变化；缺资源臂用 CDP `Network.setBlockedURLs` 屏蔽 `*assets/sprites/*` 后重载，断言六类实体仍程序化绘制、`window.__bootErrors` 为空；逐族截图落到 `docs/reviews/`。
8. `package.json` 增加 `test:sprite-coverage` 脚本。不新增第三方依赖；不改战斗数值、模拟、RNG 调用顺序、存档或计分；不修改 `SpritePipeline` 的既有契约（若确实缺少只读访问器，通过 `task_write` 同步 Touches 并在 Notes 记录）。

## AC

- [ ] `node --test tests/sprite-coverage.test.mjs` exit 0（AC-023 的 criterion）
- [ ] 覆盖集与数据表严格相等：32 个塔形态（`TOWERS` 8 型 + 每型 `evolutions` 3 条）、12 个敌人类型（`ENEMIES`）+ 3 个首领变体（`BOSS_VARIANTS`，按 `enemy.variant` 解析，`null` 用通用首领）、召唤物 `skeleton`、5 个可破坏物类型（`DESTRUCTIBLE_TYPES`）、传送门、基地——每项恰有一个精灵组，多一个或少一个都失败
- [ ] 每个实体 ≥2 个状态动画，且状态精灵 id 互不相同、对应图集帧的像素哈希互不相同（不是同一张图换名字）
- [ ] 清单可解析：`public/assets/sprites/manifest.json` 中每个 id 的文件存在、PNG 尺寸与声明一致、图集帧在图片边界内、条目带 `provenance` / `license` / `generator` 字段
- [ ] 生成器确定性：`node scripts/build-entity-sprites.mjs` 连跑两次，两张 PNG + atlas JSON + manifest 实体段字节一致（不含时间戳/随机量）
- [ ] 纯函数状态选择：`enemySpriteState`（`cast > hit > move`）、`towerSpriteState`（`disabled > recoil > idle`）、`summonSpriteState`、`destructibleSpriteState`、`portalSpriteState`、`baseSpriteState` 各有单测，未知输入返回 `null` 且不抛错
- [ ] 源码接线：`render.js` 把管线注入五个实体渲染器；五个实体渲染器按注册表 id 调用 `sprites.draw`，返回 `false` 时走完整既有程序化路径；实体渲染器仍不含 `new Image`（`tests/render-animations.test.mjs:192` 保持绿）；`sprite-coverage.js` 不含 `Math.random`、不 import sim/DOM
- [ ] `node tests/browser-sprite-coverage.mjs` exit 0：真实 Chrome 下六类实体各自的精灵 id 均被绘制 ≥1 次，状态切换改变帧 id，缺资源臂（屏蔽 `*assets/sprites/*`）下程序化回退且 `window.__bootErrors` 为空
- [ ] `npm test` exit 0；`npm run check:syntax`、`npm run check:style`、`npm run check:imports` exit 0

## DoD

- [ ] 真实浏览器（Chrome，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）六类实体实跑：打印每个实体的 id、精灵 id、状态帧 id 与绘制计数；截图人眼可见「实体确实来自图集贴图」而不是纯程序化形体
- [ ] 状态动画对照：每个实体至少一组「状态 A / 状态 B」截图落盘（`docs/reviews/entity-sprite-coverage-contact-sheet.png` 覆盖 55 个实体的待机/行进帧，`docs/reviews/entity-sprite-states-contact-sheet.png` 覆盖攻击/受击/死亡/充能帧），前后对照说明哪些形体从程序化变成贴图
- [ ] 缺资源实测：屏蔽 `*assets/sprites/*` 后重新加载，六类实体仍按既有程序化路径渲染、`window.__bootErrors` 为空、`stats().failed > 0`、不刷屏；截图落盘并说明回退路径
- [ ] 覆盖拦截有效：临时从 `ENTITY_SPRITES` 删掉一个敌人 id，`node --test tests/sprite-coverage.test.mjs` 必须失败（证明它是覆盖证明，不是快照复位）；恢复后重跑通过
- [ ] 性能不回归：`npm run perf:budget` exit 0，记录每帧新增 `drawImage` 次数、实体图集字节数与内存预算占用；`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` exit 0
- [ ] `docs/ASSET_PIPELINE.md` / `docs/TECH_DESIGN.md` 的实体命名、状态优先级与接入规则同实现一致；Notes 记录实体计数、进化形态选择规则、DPR 变体与回退路径

## Touches

- `tasks/gap-entity-sprite-coverage.md`
- `docs/ASSET_PIPELINE.md`
- `public/js/render/sprite-coverage.js` (new)
- `public/js/render.js`
- `public/js/render/tower-renderer.js`
- `public/js/render/enemy-renderer.js`
- `public/js/render/ally-renderer.js`
- `public/js/render/destructible-renderer.js`
- `public/js/render/portal-renderer.js`
- `scripts/build-entity-sprites.mjs` (new)
- `public/assets/sprites/manifest.json`
- `public/assets/sprites/entities/entity-atlas.json` (new)
- `public/assets/sprites/entities/entity-atlas@1x.png` (new)
- `public/assets/sprites/entities/entity-atlas@2x.png` (new)
- `tests/sprite-coverage.test.mjs` (new)
- `tests/browser-sprite-coverage.mjs` (new)
- `docs/reviews/entity-sprite-coverage-contact-sheet.png` (new)
- `docs/reviews/entity-sprite-states-contact-sheet.png` (new)
- `package.json`

## Notes

- 实体维度与场景维度分开：本任务只改战斗内实体渲染器，不动 `ui/title.js` / `ui/modals.js` / `ui/result.js`（那是 AC-030 提案的范围）。
- 管线是基础设施：实体渲染器只接收注入的 `SpritePipeline`，自己不加载图片；`new Image` 只允许出现在管线模块内，`tests/render-animations.test.mjs:192` 的约束不变。
- 精灵是**替换形体**而不是叠加：`draw()` 返回 `true` 时跳过对应的程序化形体绘制（否则会双重描边、且每帧 drawImage 预算翻倍）；覆盖层（射程圈、血条、首领名、受击闪白、选中框）照旧。
- 命中/飘字/音效逻辑不写、不读本任务新增状态；`sim` 的状态字段是只读输入，禁止为了让动画更好看而改模拟层或 RNG 调用顺序。
- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。
