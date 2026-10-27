---
id: gap-impact-class-feedback
title: 命中类别层：首领命中 / 破盾 / 护甲吸收各有独立可辨识反馈（AC-030）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/impact-class-feedback.test.mjs
depends_on:
  - gap-floaters-layering
goal_ac: AC-030
---
## Proposal

AC-030 的 criterion 是 `node --test tests/impact-class-feedback.test.mjs`，该文件当前不存在（AC 证据为 `criterion-capability-unevaluable: tests/impact-class-feedback.test.mjs does not resolve under the criterion's cwd`）。GOAL-005 退出条件逐字要求「暴击、击杀、首领命中、破盾各有独立反馈层」与「破盾、护甲、治疗可辨识」。当前仓库在**事件类别维度**上只有生产者、没有任何消费层：

- **事件生产者已落地，但没有消费者**：`public/js/shared/impact-events.js`（AC-012，其任务已 done）逐次产出 `amount / armorAbsorbed / shieldAbsorbed / hpLost / crit / lethal / target { id, type }`；全仓 `grep -rn "impactEvents" public/js` 只命中生产者自己与 `tests/impact-events.test.mjs`，即渲染/飘字/音频层**没有任何一处读它**，「事件类别 → 反馈层」这条路在代码里不存在。
- **护盾/护甲在表现上仍然静默**：`public/js/sim/combat-system.js:41-64` 计算 `armorAbsorbed` 与 `shieldAbsorbed` 并把它们写进事件，但随后的飘字（`:86`）只用 `final`，且要求 `final >= 12 || crit`——纯护盾吸收的那一击 `final === 0`，玩家看到的是**什么都不发生**；护甲把 30 打变成 8 时也只飘一个「8」，看不出被吃掉多少。
- **首领受击与普通怪完全同一条表现路径**：`enemy.boss` 只在死亡分支（`:123-139`）触发震屏/金币/`bossKill` 音效；挨打时没有任何区别于普通敌人的层。
- **没有类别配色/层序/粒子规格的数据表**：`public/js/render/effect-renderer.js` 的 `EFFECT_EVENTS` 已有 `kill` / `bossKill` / `baseHit` 等条目，但没有 `bossHit` / `shieldBreak` / `armorAbsorb`；`public/js/shared/floaters.js` 尚不存在（由 gap-floaters-layering 创建六层 `damage/crit/reward/heal/penalty/status`），更没有 `shield / armor / bossHit` 三层。
- **验收面缺失**：AC-030 需要的是一份能在 Node 里机械判定的证明——三类事件的判据正确、三类表现两两可辨且不与既有六层冲突、低画质档仍可见且受粒子预算约束、消费端确实接线、且表现层零接触模拟（同 seed 两局逐字节一致）。今天没有任何测试覆盖其中任何一条。

<!-- dedup-ref -->
相邻但不重叠的任务：gap-impact-events（AC-012，只产事件字段，本任务只消费）、gap-audio-impacts（AC-014，按武器分音色 + 暴击/致死附加层）、gap-weapon-impact-vfx（AC-015，按武器给 8 种形态与命中粒子池）、gap-floaters-layering（AC-016，六层飘字模型；本任务在其之上追加 `shield / armor / bossHit` 三层，故声明 `depends_on: [gap-floaters-layering]`）、gap-culmination-shows（AC-017，首领死亡演出而非首领命中）。本任务只做「事件类别」这一维，判定 separate，不合并。文件重叠说明：`docs/PRD.md` / `docs/TECH_DESIGN.md` / `public/js/render/effect-renderer.js` / `public/js/game-app.js` 与多个 ready 任务共享，调度器按 Touches 串行即可；本任务不改 `public/js/sim/combat-system.js` 的伤害计算与事件字段。

## Plan

1. **文档先行**（CLAUDE.md 约定）：设计增量已由文档 lane 收口到 `docs/PHASE_FEEL_ART.md` §3.2（九层 z 序 / 配色 / 后缀 / 重要性）与 `docs/TECH_DESIGN.md` §4.6「命中类别层」（判据表 / 文案冻结 / 叠加规则）；本任务实现按这两处冻结值落地，不改总文档。
2. **新纯函数模块 `public/js/shared/impact-class-feedback.js`**（无 DOM/Canvas、无 `Math.random`、不 import `sim` / `render` / 设置）：
   - `IMPACT_CLASSES = { shieldBreak, bossHit, armor }`，每项 `{ priority, event, floater: { layer, z, lift, size, weight, color, suffix, big }, vfx: { shape, color, accent, particles, ring, spin, duration } }`；三层在色相、后缀、z、字号上两两不同（冻结常量）。
   - `classifyImpactClasses(event)`：纯推导，输入即 AC-012 的事件 schema。`target.boss === true || target.type === 'boss'` → `bossHit`；`shieldAbsorbed > 0 && hpLost > 0` → `shieldBreak`；`armorAbsorbed > 0` → `armor`；返回按 `priority` 升序的层名数组；缺字段 / `undefined` / `null` 返回 `[]` 不抛错；首领带盾可同时命中两类。
   - `classFloaterText(event, cls)`：`bossHit` → `-<hpLost>`（`hpLost === 0` 时用 `-<shieldAbsorbed>`）、`shieldBreak` → `破盾 -<shieldAbsorbed>`、`armor` → `-<armorAbsorbed> 甲`；数值 `Math.round`，后缀取自类别表。
   - `classVfxSpec(cls, profile)`：按 `particleScale` 缩放、`maxParticles` 钳制、**任何档位 `particles >= 1`**，附与档位无关的保底层 `degrade = { core: '#ffffff', ring: true }`；未知 cls 返回 `null`。`classParticleTotal(profile)` 给出三类同帧合计。
3. **层模型接线**：`public/js/shared/floaters.js` 的 `FLOATER_LAYERS` 由六层扩为九层（从类别表取色/字号/字重/z），类别层 z = 60/70/80 位于 `penalty` 之上、`crit` 之下；`IMPORTANCE` 按冻结序 `crit 1 → shield 2 → bossHit 3 → armor 4 → penalty 5 → status 6 → reward 7 → heal 8 → damage 9` 重排（六层相对序不变）。
4. **消费端**：`public/js/game-app.js` 新增并导出 `ImpactFeedbackConsumer`——按事件对象身份（`WeakSet`）去重，逐帧消费新增事件；命中类别时 `sim.addFloater(...)`（`{ key: true, layer }`，起点按类别 `lift` 抬离武器层数字）与 `sim.addEffect({ kind: meta.event, ... })`；环形缓冲裁旧事件 / 数组整体重放都不重复、不抛错。
5. **特效表接线**：`EFFECT_EVENTS` 增加 `bossHit` / `shieldBreak` / `armorAbsorb`（色/形/环/时长取自类别表，粒子按档位），`EFFECT_KIND_EVENTS` 增 `armor → armorAbsorb` 别名；渲染分支按 `event`（由 `kind` 经 `classifyEffect` 得到）分流，形态 `burst`（双环+尖刺）/ `hexring`（六边环）/ `shards`（内收弧），并累计 `classDrawn` 计数供浏览器验收读取。
6. **新增 `tests/impact-class-feedback.test.mjs`**，覆盖全部 AC 条目；同时更新 `tests/floaters.test.mjs` 的「恰含六层」断言为九层（阶段冻结表已冻结九层）。
7. 不新增第三方依赖；不做音频层（AC-014 负责）、不做武器层形态（AC-015 负责）、不改 AC-016 的六层语义（只在九层模型上追加）。

## AC

- [x] `node --test tests/impact-class-feedback.test.mjs` exit 0（AC-030 的 criterion）
- [x] 分类器判据：`boss` 敌人受击返回含 `bossHit`（`target.type === 'boss'` 与 `target.boss === true` 两条输入都覆盖）；`shieldAbsorbed > 0 && hpLost > 0` 返回含 `shieldBreak`；`shieldAbsorbed > 0 && hpLost === 0`（盾未破、纯吸收）**不含** `shieldBreak`；`armorAbsorbed > 0` 返回含 `armor`；普通无盾无甲命中返回 `[]`；缺字段 / `undefined` / `null` 事件返回 `[]` 不抛错；首领带盾被一击穿透时同时含 `bossHit` 与 `shieldBreak`；返回顺序稳定（按 `priority`）
- [x] 可辨识性：`IMPACT_CLASSES` 三类的 `floater.color`、`floater.suffix`、`floater.z` 两两不同；`shield` / `armor` / `bossHit` 三层的 `z`、色、字号与既有六层 `damage/crit/reward/heal/penalty/status` 全部不同（破盾与护甲在屏幕上不会被读成普通伤害或暴击）
- [x] 档位与预算：`classVfxSpec(cls, EFFECT_PROFILES.low).particles >= 1` 且 `classVfxSpec(cls, EFFECT_PROFILES.low).particles < classVfxSpec(cls, EFFECT_PROFILES.high).particles`；三类同帧合计粒子数 `<= EFFECT_PROFILES[profile].poolBudget`；未知 cls 返回 `null` 不抛错
- [x] 消费端接线（源码断言）：`public/js/game-app.js` 引用 `classifyImpactClasses` 与 `IMPACT_CLASSES`；`public/js/shared/floaters.js` 的 `FLOATER_LAYERS` 含 `shield` / `armor` / `bossHit` 键；`public/js/render/effect-renderer.js` 的 `EFFECT_EVENTS` 含 `bossHit` / `shieldBreak` / `armorAbsorb` 且渲染分支按 `kind` 可达；`public/js/shared/impact-class-feedback.js` 不含 `Math.random`、不 import `sim` / `render` / DOM
- [x] 消费端不重复消费：把同一批 `impactEvents` 连续喂给消费者两次，第二次产出 0 条类别飘字/特效；环形缓冲被裁旧事件后仍不抛错且不重复
- [x] 表现零接触模拟：同一 seed 两局（类别消费端挂载 / 不挂载），推进相同步数后序列化 `gold / baseHp / kills / wave / clearedWave / enemies` 与 `sim.impactEvents` 的逐条字段**逐字节一致**
- [x] 真实对局可制造三类事件：用 `tests/combat.test.mjs` 的手法在单测里至少各构造一次 `bossHit`（`sim.spawnEnemy('boss')`）、`shieldBreak`（`shielder` 类型或手工 `shield` + 一击穿透）、`armor`（`armor > 0`），断言生产者事件字段与分类结果一致
- [x] `npm test` exit 0（本 worktree 实测：1569 pass / 0 fail）

## DoD

- [x] 真实浏览器（Chrome，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`，`tests/harness.mjs` 的 `launchBrowser`）：开一局，制造至少一次首领命中、一次破盾、一次护甲吸收，读取渲染层统计要求三类飘字与三类特效各绘制 ≥1 次、`window.__bootErrors` 为空；记录驱动脚本与统计摘要到 Notes
- [x] 同 seed 实测两局（类别反馈挂载 / 不挂载），结算的金币 / 生命 / 击杀 / 波次一致（实跑对比，不以单元测试代替）
- [x] 三类截图（首领命中 / 破盾 / 护甲吸收）与一张普通命中对照图落盘到 `docs/reviews/`，人眼可一眼分辨；路径写入 Notes
- [x] 低画质 + 关闭震屏 + reduced-motion 各跑一段：类别飘字仍可辨认（非运动反馈保留），特效粒子 ≥ 1 且不刷屏
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0
- [x] `docs/PRD.md` §4.12 与 `docs/TECH_DESIGN.md` §4.6/§5.5 的类别判据、层序、配色、档位降级规则同实现一致；Notes 记录三类各自的视觉差异点（色/后缀/层序/形状）与消费端游标策略

## Touches

- `tasks/gap-impact-class-feedback.md`
- `public/js/shared/impact-class-feedback.js` (new)
- `public/js/shared/floaters.js`
- `public/js/game-app.js`
- `public/js/render/effect-renderer.js`
- `tests/impact-class-feedback.test.mjs` (new)
- `tests/floaters.test.mjs`（AC-016「恰含六层」断言随九层模型更新）
- `docs/reviews/impact-class-boss-hit.png` (new)
- `docs/reviews/impact-class-shield-break.png` (new)
- `docs/reviews/impact-class-armor-absorb.png` (new)
- `docs/reviews/impact-class-normal-hit.png` (new)
- `docs/reviews/impact-class-low-quality.png` (new)
- `docs/reviews/impact-class-reduced-motion.png` (new)

## Notes

- 本任务只消费事件、不改事件 schema：`public/js/sim/combat-system.js` 与 `public/js/shared/impact-events.js` 均不在 Touches；首领识别同时接受 `target.type === 'boss'` 与 `target.boss === true`（`makeImpactEvent` 不产出 `boss` 字段，该分支只服务手工构造事件），避免为分类去改生产者。
- 依赖 `gap-floaters-layering`（AC-016）已在 develop 落地：本任务在其六层模型上追加三层，未重新实现层模型；`FLOATER_LAYERS.armor/bossHit/shield` 从类别表取色/字号/字重/z，类别表是这三层的唯一定义处。
- `sim.addFloater` / `sim.addEffect` 自带的档位门控就是降级路径：飘字在 `off` 档不生成、`key` 档因 `key: true` 保留；特效在 `effects:'off'` 只保留 bolt/ring/leak（类别特效被既有档位语义裁掉，与 Notes 原约定一致）；`light` 档保留类别特效并按 `EFFECT_PROFILES.low` 降粒子。**「任何档位类别层可见」由类别飘字承担**，VFX 按既有档位语义降级，不新增设置项。
- 消费者在 `game-app.js` 而不在 `render.js`：渲染门面只画，页面编排层才持有 sim 的逐帧推进与新增视觉对象的生产。游标策略：`WeakSet` 记对象身份（与 `CameraFeedback._seen` 同构），不要求事件带序号；环形缓冲（240）裁掉旧事件后旧引用直接失效，不重复也不抛错。
- 三类视觉差异点（冻结 + 实现取值）：
  - 破盾 `shield`：`#66d9ff` 青、后缀「破盾」、z=80、字号 20/字重 800、特效**六边环** hexring + 外扩碎片；
  - 首领命中 `bossHit`：`#ff7ad9` 洋红（与首领死亡同族）、无后缀、z=70、字号 19/字重 800、特效**双环 + 放射尖刺** burst（高配 8 根 / 低配 4 根）；
  - 护甲吸收 `armor`：`#9fb4c9` 钢色、后缀「甲」、z=60、字号 18/字重 700、特效**向内收拢的三段弧** shards。
- 阶段冻结表只冻结了 z / 字重 / 颜色 / 后缀，未钉字号与飘字起点，实现取值：字号 18/19/20（与既有六层 13–17 全部不同，满足「三层的字号与既有六层全部不同」）；`floater.lift` = armor 0.75 / bossHit 1.0 / shieldBreak 1.25 格，把类别飘字抬离武器层伤害数字那一行——否则「-5 甲」与「25」会叠成「-525 甲」（浏览器截图初版复现过）。设计增量已写在本 Notes，未改总文档（DOCS-001 单一 lane）。
- 浏览器验收驱动脚本：`/tmp/impact-class-browser.mjs`（真实 Chrome + 隔离测试服务；开一局后暂停，直接经 `sim.dealDamage` 制造三类命中，读取 `renderer.floaters.stats.layers`、`renderer.effects.classDrawn`、`app.impactFeedback.stats`，并按命中点放大裁剪截图）。统计摘要（高画质同帧三类）：`layers = [damage, armor, bossHit, shield]`、`classDrawn = { bossHit: 17, armorAbsorb: 34, shieldBreak: 17 }`、`consumer.classes = { bossHit: 1, armor: 2, shieldBreak: 1 }`、`bootErrors = []`。低画质（decorations=light / floaters=key / shake=false / dpr=1）同帧：`layers = [armor, bossHit, shield]`、`classDrawn = { bossHit: 15, armorAbsorb: 30, shieldBreak: 15 }`，粒子 3/4/2 颗（≥1）。reduced-motion：`app.reducedMotion = true`、`budget = { motion:false, shakeScale:0, zoomScale:0, hitstopScale:0.5, flashScale:1 }`，类别飘字与类别特效照常绘制（`classDrawn = { bossHit: 13, armorAbsorb: 13 }`）。
- 同 seed 实跑对比（`/tmp/impact-class-determinism.mjs`，真实浏览器 + 真实 `GameApp`，`x-test-seed: rtd-impact-class-seed`，两局各推进 1800 步并在第 30n 步注入首领/石卫/带盾三击）：`seedSame=true`、`settlementSame=true`、`eventsSame=true`、事件数 90/90、类别表现 120/0、`bootErrors` 均空；结算 `gold=320 baseHp=11 kills=0 wave=1 clearedWave=0`。
- 截图（`docs/reviews/`）：`impact-class-boss-hit.png`、`impact-class-shield-break.png`、`impact-class-armor-absorb.png`、`impact-class-normal-hit.png`（普通命中对照：只有白色 `40`，无类别层/类别特效）、`impact-class-low-quality.png`（低画质 + 关震屏，三类同屏）、`impact-class-reduced-motion.png`。
- 与既有测试的交互：`tests/floaters.test.mjs` 的两处 AC-016 断言（「恰含六层」与 `layer: 'armor'` 回退 `damage`）在同一次改动里更新为九层模型——阶段冻结表已冻结九层，旧断言与新冻结表冲突；为此 `tests/floaters.test.mjs` 已并入本任务 Touches。`tests/hitstop.test.mjs` 的源码断言要求 `feedback.consume(sim.impactEvents` 文本保留，消费端接线按该形式追加，未改该测试。
- `npm run smoke`（zh_CN 语系）exit 0；`node --no-warnings scripts/style-check.mjs` 通过（208 文件）；`node scripts/check-doc-ownership.mjs` OK。
