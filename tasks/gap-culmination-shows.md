---
id: gap-culmination-shows
title: 漏怪 / 清波 / 首领死亡：三段独立演出与 reduced-motion 降级
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/feel-culmination.test.mjs
goal_ac: AC-017
---
## Proposal

GOAL-005 退出条件要求「漏怪、清波、首领死亡各有独立演出；reduced-motion 或关闭震屏时仍保留非运动反馈」，AC-017 以 `node --test tests/feel-culmination.test.mjs` 见证；该文件当前不存在（AC 证据为 `criterion-capability-unevaluable`）。当前三处事件都只是「顺带」的表现，没有独立演出：

- **漏怪**：`public/js/sim/enemy-system.js:262-272` 只做 `baseHp -= dmg`、`shake +7`、在**敌人位置**加一条通用 `leak` 特效（`public/js/render/effect-renderer.js:522-540`，与普通基地受击共用 `baseHit` 样式）、红色飘字与 `hurt` 音效；`public/js/render.js:167-183` 的红色暗角由 `baseHp` 差值推导。没有基地脉冲、没有横幅，也没有和普通命中区分开的演出签名。
- **清波**：`public/js/sim/wave-director.js:165-202` 结算奖励后只回调 `onWaveClear`；`public/js/app/combat.js:57-63` 暂停并弹一条 DOM toast。没有慢动作、没有全屏横幅/扫光，清波与「商店刷新」在体感上没有区别。
- **首领死亡**：`public/js/sim/combat-system.js:123-139` 的 `enemy.boss` 分支只做 `shake +10`、金币飘字、`bossKill` 音效；死亡特效靠半径 `BOSS_KILL_RADIUS` 反推 `bossKill` 变体（`public/js/render/effect-renderer.js:11,415-455`），没有任何屏幕空间演出、名字横幅或慢镜头，且「是不是首领」是渲染层猜测而非事件事实。
- **没有统一模型与降级**：三者没有共享的纯数据规格，也没有 reduced-motion 语义；关闭震屏后只剩红色暗角和粒子，漏怪与首领死亡失去仪式感。

本任务把三者做成同一套「演出层」的三个独立签名：一个纯数据/纯函数的规格模块、一个屏幕空间渲染器、模拟侧的三个显式事件，以及 reduced-motion / 关闭震屏时的静态降级。只改表现，不新增 RNG 调用、不改结算与胜负。

<!-- dedup-ref -->
相邻但不重叠的任务：gap-impact-events（AC-012 结构化命中事件）、gap-weapon-impact-vfx（AC-015 武器命中特效）、gap-audio-impacts（AC-014 命中音效）、gap-hitstop-camera-feedback（AC-013 hitstop/镜头）、gap-floaters-layering（AC-016 飘字分层）、gap-auto-quality-default（AC-011 默认画质）。六者分别改「每次命中的事件 / 特效 / 音效 / 镜头 / 飘字 / 默认档」；本任务只做漏怪、清波、首领死亡三个**低频高潮事件**的独立演出与 reduced-motion 降级，验收面是独立的 `tests/feel-culmination.test.mjs`。与之共享 `public/js/sim.js`、`sim/enemy-system.js`、`sim/combat-system.js`、`render.js`、`game-app.js`、i18n 与两份文档，调度器会按 Touches 串行；本任务只新增 `feel.culmination.*` 文案命名空间与 `addCulmination` 记录入口，不修改既有命中的事件 / 特效 / 音效 / 飘字逻辑。保留为独立任务：三段演出有独立验收，且上述高频层任务均已 ready 或待派发。

## Plan

1. **文档先行（CLAUDE.md 约定）**
   - `docs/PRD.md` 新增 §4.14「战斗高潮演出」：玩家可见的三段行为（漏怪 = 红闪 + 基地脉冲 + 「基地受损」横幅；清波 = 慢动作 + 金色横扫 + 「第 N 波清除」横幅；首领死亡 = 白闪 + 扩散环 + 首领名横幅），并写明 reduced-motion / 关闭震屏时保留静态横幅、色块与边框，只取消位移/缩放/慢动作。
   - `docs/TECH_DESIGN.md` §5.5 增加「高潮演出层」：三行签名表（kind / bannerKey / flash 颜色 / pulse 形状 / duration / timeScale / shake / zoom）、事件来源 `Simulation.addCulmination`、绘制层级（受击暗角之后、FPS 面板之前）、降级规则，以及「不调用随机数、不改变模拟结算」的确定性约束。
2. **新模块 `public/js/shared/culmination.js`**（纯数据 + 纯函数，无 DOM/Canvas、无 `Math.random`、不 import sim/render）：
   - `CULMINATION_KINDS = Object.freeze(['leak', 'waveClear', 'bossKill'])`。
   - `CULMINATION_SPECS`（加载时深冻结）：每项 `{ id, bannerKey, detailKey, accent, flash: { color, peak, duration }, pulse: { shape, color, rings }, duration, motion: { timeScale, shake, zoom } }`。三个 `bannerKey`、`flash.color`、`pulse.shape`、`timeScale`、`duration` 两两不同，构成可机械判定的独立签名。
   - `culminationSpec(kind)`：未知 kind 返回 `null`（渲染层跳过并计数，不抛错）。
   - `culminationPlan(kind, { reducedMotion = false, shake = true } = {})`：返回 `{ kind, bannerKey, detailKey, accent, flash, pulse, motion: { mode, timeScale, shake, zoom, pulse } }`；当 `reducedMotion || !shake` 时 `mode='reduced'`、`motion.timeScale=1`、`motion.shake=0`、`motion.zoom=0`、`motion.pulse=false`，但 `bannerKey/detailKey/accent/flash` 原样保留（非运动反馈不降级）。
3. **i18n 文案**：`public/js/shared/i18n/zh-CN.js` 与 `en-US.js` 各新增 `feel.culmination.leak.title/detail`、`feel.culmination.waveClear.title/detail`、`feel.culmination.bossKill.title/detail` 六键，使用既有 `{damage}` / `{wave}` / `{reward}` / `{name}` 插值；不改任何既有键值。
4. **模拟侧事件（只记录、不结算）**
   - `public/js/sim.js`：构造时新增 `this.culminations = []`、`this.culminationSeq = 0`，并支持 `opts.recordCulminations === false` 关闭记录；新增 `addCulmination(kind, meta = {})`，写入 `{ seq: ++this.culminationSeq, kind, at: this.time, ...meta }`，环形上限 16 条（丢最旧）。**不调用 RNG、不读写结算、不播声音**。
   - `public/js/sim/enemy-system.js`：`leak()` 在飘字之后调用 `addCulmination('leak', { damage: enemy.dmg, baseHp: this.sim.baseHp, x, y })`。
   - `public/js/sim/combat-system.js`：`killEnemy()` 的 `enemy.boss` 分支调用 `addCulmination('bossKill', { type: enemy.type, name: ENEMIES[enemy.type]?.name || enemy.type })`。
   - `public/js/sim/wave-director.js`：`completeWave()` 在 `clearedWave = cleared` 之后、`onWaveClear` 回调之前调用 `addCulmination('waveClear', { wave: cleared, reward, interest })`。
5. **新渲染器 `public/js/render/culmination-renderer.js`**
   - `update(game, dt)`：按 `seq > seenSeq` 消费 `game.culminations`，用 `culminationPlan` 生成 active show（age 从 0 起），逐帧推进并按 duration 过期；`setSettings` / `setReducedMotion`；`timeScale()` 返回所有 active show 的最小 `motion.timeScale`（无 active 时 1）；`stats` 暴露 `{ leak, waveClear, bossKill, drawn, reducedFallbacks, skipped }` 供浏览器验收。
   - `render(g)`：三段互不相同的屏幕空间画法——漏怪（红色静态边框 + 以 `game.map.base` 为中心、按 `TILE` 换算的基地脉冲环 + 横幅）、清波（金色水平扫光 + 居中横幅）、首领死亡（白色闪光 + 多层扩散环 + 首领名横幅）。`motion.pulse=false` 时不画扩散/扫光，只保留横幅、色块与静态边框。
   - 不 import `sim` / `shared/rng`，不含 `Math.random`、不修改 `game` 状态。
6. **接线 `public/js/render.js`**：构造 `CulminationRenderer`；每帧在受击暗角之后、FPS 面板之前调用 `update` + `render`；`applySettings` 转发设置；用 `matchMedia('(prefers-reduced-motion: reduce)')` 计算 reduced-motion，并让既有相机震动在 reduced-motion 下也归零。
7. **接线 `public/js/game-app.js`**：`sim.updateVisuals` 使用 `renderer.visualTimeScale`（由 `culmination.timeScale()` 提供）缩放 dt，实现清波/首领死亡的视觉慢动作；模拟推进 `sim.update(STEP)` 不受影响（清波后已进入 prep/event 阶段）。reduced-motion 时缩放恒为 1。
8. **向后兼容**：无 `culminations` 的旧快照/测试不产生任何 show；未知 kind 跳过；既有 `leak` 特效、`hurt`/`bossKill` 音效、红色暗角、飘字全部保留原行为；不新增第三方依赖。
9. **测试 `tests/feel-culmination.test.mjs`**：覆盖下面的 AC 全部断言（纯函数 + `Simulation` 事件 + 源码接线 + i18n 键）。

## AC

- [ ] `node --test tests/feel-culmination.test.mjs` exit 0
- [ ] 规格完整性：`CULMINATION_KINDS` 恰为 `leak/waveClear/bossKill` 三个且与 `Object.keys(CULMINATION_SPECS)` 一致；每项 `accent` 为合法 hex，`flash.color/peak/duration`、`duration`、`motion.timeScale/shake/zoom` 均为有限数且 `duration>0`、`0<timeScale<=1`、`pulse.rings>=1`；`culminationSpec('unknown')===null`
- [ ] 独立可辨识：三个 `bannerKey` 两两不同、三个 `flash.color` 两两不同、三个 `pulse.shape` 两两不同、三个 `timeScale` 两两不同、三个 `duration` 两两不同（`new Set(...).size===3`）
- [ ] 降级规则：对三个 kind 分别调用 `culminationPlan(kind, { reducedMotion:true })` 与 `{ shake:false }`，均满足 `motion.mode==='reduced'`、`motion.pulse===false`、`motion.shake===0`、`motion.zoom===0`、`motion.timeScale===1`，且 `bannerKey/detailKey/accent/flash.color` 与完整模式逐字段相等（非运动反馈保留）
- [ ] 漏怪事件：`sim.leak(enemy)` 后 `sim.culminations` 末尾为 `{ kind:'leak' }` 且 `damage>0`、`baseHp` 等于漏怪后的基地生命；`seq` 严格递增且全局唯一
- [ ] 清波事件：`completeWaveAt(sim, 3)`（phase='wave'、wave=3、waveDef.reward 固定）后末尾事件 `kind==='waveClear'`、`wave===3`、`reward`/`interest` 为有限数并与 `sim.gold` 增量一致
- [ ] 首领死亡事件：`sim.spawnEnemy('boss', 0, hpMul)` 后 `sim.killEnemy(boss)`，末尾事件 `kind==='bossKill'`、`type==='boss'`、`name` 非空；普通怪击杀不产生 `bossKill`
- [ ] 表现零接触模拟：同一 seed 两局执行同一脚本（漏怪 + 清波 + 首领击杀，中间推进相同步数），一局 `recordCulminations:true`、一局 `false`，序列化 `{gold,baseHp,kills,wave,clearedWave,enemies:[id,hp,progress,dead],floaters,effects}` 逐字节一致
- [ ] 确定性源码：`public/js/shared/culmination.js` 与 `public/js/render/culmination-renderer.js` 不含 `Math.random`，且不 import `sim` / `shared/rng` / DOM
- [ ] 接线源码断言：`public/js/sim/enemy-system.js` 的 `leak()` 调用 `addCulmination('leak'`；`public/js/sim/combat-system.js` 的首领分支调用 `addCulmination('bossKill'`；`public/js/sim/wave-director.js` 的 `completeWave()` 调用 `addCulmination('waveClear'`；`public/js/render.js` 构造 `CulminationRenderer` 并在渲染中调用其 `update`/`render`；`public/js/game-app.js` 用 `visualTimeScale` 缩放 `updateVisuals`
- [ ] i18n 完整性：三组 `feel.culmination.*.title/detail` 键在 `zh-CN` 与 `en-US` 字典中都存在且非空，`t(key, params)` 插值后不含未替换的 `{...}` 占位符
- [ ] `npm test` exit 0

## DoD

- [ ] 真实对局驱动（`tests/harness.mjs` 的 `launchBrowser`）：同一局内制造一次漏怪、清一波、击杀首领，读取 `app.renderer.culmination.stats`，要求 `leak/waveClear/bossKill` 各 `>=1`、`drawn` 各 `>=1`（横幅确实绘制）、`window.__bootErrors` 为空；记录驱动脚本与输出摘要
- [ ] reduced-motion 实跑：通过 CDP `Emulation.setEmulatedMedia` 注入 `prefers-reduced-motion: reduce` 后重复三类事件，`stats.reducedFallbacks >= 3`、三类横幅仍 `drawn >= 1`、`timeScale() === 1`、相机无位移；截图可见静态横幅与色块
- [ ] 三张演出截图（漏怪 / 清波 / 首领死亡）与同一 seed「演出开 / 关」两局的金币、生命、击杀、波次、敌人 HP 摘要一致（实跑对比，不以单元测试代替），结果与截图路径写入任务 Notes
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` 与 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run flow` exit 0
- [ ] `npm test` exit 0
- [ ] `docs/PRD.md` §4.14 与 `docs/TECH_DESIGN.md` §5.5 的签名表、降级规则、绘制层级与实现一致；Notes 记录三段演出的视觉差异点（颜色 / 横幅 / 脉冲 / 慢动作倍率）

## Touches

- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `public/js/shared/culmination.js` (new)
- `public/js/render/culmination-renderer.js` (new)
- `public/js/render.js`
- `public/js/game-app.js`
- `public/js/sim.js`
- `public/js/sim/enemy-system.js`
- `public/js/sim/combat-system.js`
- `public/js/sim/wave-director.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/feel-culmination.test.mjs` (new)
- `tasks/gap-culmination-shows.md`

## Notes

- 三段演出共享同一套「规格 + 渲染器」机制，但签名两两不同；验收点不是「有没有横幅」，而是三个 kind 的颜色 / 横幅键 / 脉冲形状 / 慢动作倍率 / 时长都不同，且 reduced-motion 下仍有非运动反馈。
- 慢动作只缩放 `updateVisuals` 的 dt 与渲染时间；`sim.update(STEP)` 仍按固定步长推进，不在本文档里改变模拟结果。
- 首领事件的「是不是首领」由模拟侧显式记录，不再由渲染层按半径反推；既有按半径反推的 `bossKill` 特效保持不变，作为粒子层叠加。
- 与高频命中层任务的共享文件由调度器按 Touches 串行；本任务只新增 `addCulmination` 与 `feel.culmination.*`，不修改既有命中的特效 / 音效 / 飘字路径。
