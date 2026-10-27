---
id: gap-hitstop-camera-feedback
title: hitstop 与定向震屏、镜头冲击：受设置护栏且不改变模拟与 RNG
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hitstop.test.mjs
depends_on:
  - gap-impact-events
goal_ac: AC-013
---
## Proposal

GOAL-005 退出条件要求「reduced-motion 或关闭震屏时仍保留非运动反馈」，同时受硬约束「设置只作用于表现，不改变模拟、RNG 顺序与结算」。AC-013 以 `node --test tests/hitstop.test.mjs` 见证，该文件当前不存在，且现有实现与要求有三处结构性缺口：

- **没有 hitstop**：`public/js/game-app.js:95-108` 的固定步长循环只按 `raw * this.speed` 累积，`dt` 没有任何时间缩放；「命中瞬间冻结」这一层完全不存在。若把减速/跳步写进 `sim.update()`，会直接改变模拟轨迹与 RNG 调用顺序，违反 `docs/TECH_DESIGN.md` §14.5 硬约束 2/3。
- **震屏是无方向的整帧随机平移**：`public/js/render.js:132-135` 在 `settings.shake` 为真时用两次 `Math.random()` 平移整帧，幅度取自 `game.shake`（`public/js/sim.js:78` 初始化、`:302-303` 以 `dt * 31` 衰减；由 `public/js/sim/combat-system.js:134`、`projectile-system.js:122`、`enemy-system.js:138/195/235/257/266` 累加）。它没有方向、没有镜头缩放冲击、没有幅度归一与并发上限，也没有「关闭震屏时的非运动替代反馈」；`Math.random()` 让同一场面的镜头抖动不可复现。
- **设置护栏只到开关层**：`public/js/settings.js:25/39/83` 只有 `shake` 布尔；系统 `prefers-reduced-motion` 仅在 `public/js/render/transition.js:55`、`public/js/ui/result.js:171`、`public/js/ui/season-pass.js:107` 被点状读取，从未约束战斗内镜头反馈。`public/js/render/menu-background.js:68` 的 `menuBackgroundBudget(settings, { reduceMotion })` 是仓库既有的「纯预算函数 + Node 测试」范式，本任务沿用同一形状。

本任务只新增表现层镜头反馈：消费 AC-012 的结构化命中事件，产出 hitstop 时间缩放、定向冲量（带方向、有上限、确定性抖动）与镜头缩放冲击；reduced-motion 或关闭震屏时运动分量恒为 0，但保留命中闪光/边缘染色等非运动反馈。模拟层（`public/js/sim.js` 与 `public/js/sim/*`）一行不改；同 seed、同模拟步数下快照与 `combatRng` 序列逐项不变。

<!-- dedup-ref --> 去重与合并：库内没有任何任务以 `goal_ac: AC-013` 认领本 AC，也没有 hitstop / 定向震屏 / 镜头冲击的任务；`task-granularity-advice` 以本任务 Touches 实测 peers 为 `gap-auto-quality-default`（AC-011）与 `gap-impact-events`（AC-012），仅共享 `docs/PRD.md`、`docs/TECH_DESIGN.md` 两个文档文件，机制不同、验收独立，判定 separate，不合并。

事件输入来自 `gap-impact-events` 落地的 `sim.impactEvents`（字段见其 Plan：weapon/source/crit/hpLost/armorAbsorbed/shieldAbsorbed/lethal/t/x/y/target），已在 depends_on 声明该前置。消费端用 `WeakSet` 按事件对象身份去重，因此不要求事件携带序号，也不改事件契约。

## Plan

1. 文档先行（CLAUDE.md 约定）：`docs/PRD.md` §4.12「关键约束」补一条——镜头反馈（hitstop / 震屏 / 缩放冲击）只作用于表现，reduced-motion 或关闭震屏时运动分量为 0 但保留命中闪光与边缘染色等非运动反馈，任何档位都不改伤害/RNG/结算；§7「美术与音频方向·反馈」补 hitstop 与定向震屏。`docs/TECH_DESIGN.md` §5.5 补「镜头反馈层」，§5.6 补运动预算（motion budget）与 reduced-motion 解析，§14.4 把 `prefers-reduced-motion` 的约束从 CSS 扩到 Canvas 镜头反馈。
2. 新增 `public/js/render/camera-feedback.js`（纯表现、零 DOM、Node 可直接导入；不得 import `../sim.js` / `../sim/*`，源码不得出现 `Math.random`）：
   - `CAMERA_LIMITS = { hitstopMax: 0.09, hitstopMin: 0.018, shakeMax: 7, zoomMax: 0.035, window: 0.22, maxImpulses: 6 }`。
   - `resolveMotionBudget(settings = {}, { reducedMotion = false } = {})` → `{ motion, shakeScale, zoomScale, hitstopScale, flashScale }`：`motion = !reducedMotion && settings.shake === true && settings.decorations !== 'off'`；`motion` 为假时 `shakeScale = zoomScale = 0`、`hitstopScale = 0.5`（冻结不是位移，保留但减半）、`flashScale = 1`。
   - `hitstopFor(event, budget)`：`source === 'dot'` 返回 0；否则按 `hpLost` 分级 + `crit` + `lethal` + `shieldAbsorbed > 0` 累加，clamp 到 `[hitstopMin, hitstopMax]` 后乘 `budget.hitstopScale`；纯函数，不读时钟、不读全局设置。
   - `shakeImpulseFor(event, { width, height }, random)` → `{ x, y, magnitude, ttl }`：方向为「命中点 → 屏幕中心」的单位向量（镜头被推离命中点），叠加 ±8° 播种抖动；幅度按 hpLost/crit/lethal 分级并 clamp 到 `shakeMax`；`random` 由调用方注入，模块内不用 `Math.random`。
   - `composeCameraTransform({ feedback, budget, legacyShake = 0, jitter })` → `{ x, y, zoom, focusX, focusY, flash, flashX, flashY }`：`budget.motion` 为假时 `x = y = 0`、`zoom = 1`（精确恒等，不做「极小值」近似），`flash/flashX/flashY` 照常返回；`legacyShake`（`game.shake`，覆盖漏怪/首领死亡等无命中事件的来源）用注入的播种抖动替代 `Math.random()`。
   - `class CameraFeedback`：`constructor({ settings, reducedMotion = false, seed = 1 })`；`consume(events)` 用 `WeakSet` 去重、冲量并发上限 `maxImpulses`、hitstop 取 `Math.max`；`update(dt)` 按真实时间衰减并返回 `{ timeScale, offsetX, offsetY, zoom, focusX, focusY, flash, hitstopRemaining }`（`hitstopRemaining > 0` 时 `timeScale = 0.05`，否则 1——冻结期模拟步进近乎停住但渲染照常）；`setSettings(settings, { reducedMotion })` 当帧重算预算（关闭震屏立即把 offset/zoom 归零）；`stats()` 返回 `{ hitstops, shakeImpulses, zoomPunches, flashes, suppressed }` 供浏览器验收读取；`reset()`。
   - 抖动使用模块内的 mulberry32（同 seed 同序列），绝不触碰 `sim.combatRng`。
3. `public/js/game-app.js`：构造时 `this.feedback = new CameraFeedback({ settings: this.settings, reducedMotion: detectReducedMotion(document), seed: sim.seed ?? 1 })`（复用 `public/js/render/transition.js:55` 的检测），并监听 `matchMedia('(prefers-reduced-motion: reduce)')` 的 change 事件刷新预算，`destroy()` 移除监听。`tick()` 顺序固定为：`const frame = this.feedback.update(raw)` → `this.acc += raw * this.speed * frame.timeScale`（仅未暂停时）→ 步进循环 → `this.feedback.consume(sim.impactEvents || [])` → `sim.updateVisuals(raw)` → `this.renderer.render(raw, frame)`。`applySettings()` 末尾调用 `this.feedback.setSettings(this.settings, { reducedMotion })`。
4. `public/js/render.js`：`render(dt, feedback = null)`；用 `composeCameraTransform` 替换 `:132-135` 的随机平移（运动开启时才 `translate(x, y)`）；`zoom !== 1` 时以 `focusX/focusY` 为锚做 `g.translate/scale/translate`；`g.restore()` 之后、受击警示之前画非运动命中闪光（addition 径向渐变，alpha 由 `flash` 决定）与致死边缘染色——这两项在 reduced-motion/关闭震屏时仍绘制。
5. 设置护栏不新增设置键：沿用 `settings.shake`、系统 `prefers-reduced-motion`、`settings.decorations === 'off'` 三个来源；不触碰 `public/js/settings.js`、设置面板、i18n 与 `server/routes/profile.mjs`（避免与 `gap-auto-quality-default` 的文件所有权冲突）。
6. 新增 `tests/hitstop.test.mjs`，覆盖：①预算映射四种组合（shake 开/关 × reducedMotion 开/关）与 `decorations === 'off'`，运动关闭时运动分量精确为 0 且 `flashScale > 0`；②`hitstopFor` 对 dot 为 0、对暴击/致死单调递增、永不超过 `hitstopMax`；③定向冲量方向（命中点在屏幕左侧时 `x > 0`、上侧时 `y > 0`）且幅度不超过 `shakeMax`；④同 seed + 同事件流逐帧 `offsetX/offsetY/zoom` 完全一致，不同 seed 抖动不同；⑤同一事件对象重复 `consume` 不重复触发，环形缓冲裁掉旧事件后消费仍正确；⑥运动关闭时连续 60 帧 `offsetX/offsetY/zoom` 恒为 0，且 `flash > 0`；⑦同 seed 两局各 900 步：一局每步后把 `sim.impactEvents` 喂给 `CameraFeedback`，另一局不喂，`JSON.stringify` 归一化（去掉 `savedAt/startedAt`）后的快照逐字节相等、`combatRng.float()` 序列逐项相等；⑧源码级断言：`camera-feedback.js` 不含 `Math.random`、不 import sim 层；`game-app.js` 的累积行使用 `frame.timeScale`；`render.js` 的震屏平移不再调用 `Math.random`。
7. 回归：`node --test tests/impact-events.test.mjs tests/render-effects.test.mjs tests/render-animations.test.mjs tests/sim-systems.test.mjs tests/combat.test.mjs tests/snapshot.test.mjs`；`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`、`npm run test:mobile`；最后 `npm test`。

## AC

- [ ] `node --test tests/hitstop.test.mjs` exit 0，且该文件覆盖 Plan 第 6 步的 ①–⑧ 全部八组断言（预算映射 / hitstop 上限与单调 / 定向与幅度上限 / 同 seed 可复现 / 去重与环形缓冲 / 护栏下恒零且有闪光 / 同 seed 快照与 combatRng 不变 / 源码级约束）
- [ ] `grep -rn "Math.random" public/js/render/camera-feedback.js public/js/render.js` 0 命中（镜头反馈无未播种随机）
- [ ] `grep -rn "sim\.combatRng\|sim\.rng\|from '../sim" public/js/render/camera-feedback.js public/js/render.js public/js/game-app.js` 0 命中（表现层不触达模拟 RNG）
- [ ] `node --test tests/impact-events.test.mjs tests/render-effects.test.mjs tests/render-animations.test.mjs tests/sim-systems.test.mjs tests/combat.test.mjs tests/snapshot.test.mjs` exit 0（事件契约、渲染预算、公共方法集合与存档结构均未回归）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（真实浏览器表现层无回归）
- [ ] `npm test` exit 0

## DoD

- [ ] 真实浏览器（Chrome、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）高配档自动战斗跑满 1 波，`window.__rtd.state.app.feedback.stats()` 显示 `hitstops > 0`、`shakeImpulses > 0`、`zoomPunches > 0`，并记录一次暴击/致死命中的 `offsetX/offsetY/zoom` 与 `hitstopRemaining` 非零读数（脚本输出摘要写入 Notes）
- [ ] 通过 CDP `Emulation.setEmulatedMedia` 置 `prefers-reduced-motion: reduce`（以及等价的关闭震屏路径）再跑同一场景：`stats().suppressed > 0`，全程 `offsetX/offsetY === 0` 且 `zoom === 1`，但 `flashes > 0`，截图可见命中闪光/边缘染色（无位移的非运动反馈）
- [ ] 局内切换「屏幕震动」开关立即生效：关闭后下一帧 offset/zoom 归零，重新开启在下一批命中恢复；无需刷新或重开对局
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` exit 0（移动端低配默认下运动关闭、非运动反馈仍可见）
- [ ] `docs/PRD.md` §4.12/§7 与 `docs/TECH_DESIGN.md` §5.5/§5.6/§14.4 的表述与实现一致；Notes 记录 hitstop/冲量/缩放的上限与阈值、播种抖动方案，以及「同 seed 同步数下模拟与 RNG 不变」的论证与实测命令

## Touches

- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `public/js/render/camera-feedback.js`
- `public/js/render.js`
- `public/js/game-app.js`
- `tests/hitstop.test.mjs`
- `tasks/gap-hitstop-camera-feedback.md`