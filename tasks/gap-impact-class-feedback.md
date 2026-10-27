---
id: gap-impact-class-feedback
title: 命中类别层：首领命中 / 破盾 / 护甲吸收各有独立可辨识反馈（AC-030）
status: todo
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

1. **文档先行**（CLAUDE.md 约定）：
   - `docs/PRD.md` §4.12 的反馈表补「事件类别层」一列：首领命中、破盾、护甲吸收各有独立表现；写明 reduced-motion / 关闭震屏 / 低画质档下仍保留非运动反馈（类别飘字）。
   - `docs/TECH_DESIGN.md` §4.6 补类别判据表（`bossHit` / `shieldBreak` / `armor` 三行：触发谓词、事件字段来源、与武器层的叠加规则），§5.5 补层序与配色表（层名、`z`、字号/字重、颜色、后缀、VFX 形态）与档位/粒子预算降级路径。
2. **新纯函数模块 `public/js/shared/impact-class-feedback.js`**（无 DOM/Canvas、无 `Math.random`、不 import `sim` / `render` / 设置）：
   - `IMPACT_CLASSES = { bossHit, shieldBreak, armor }`，每项 `{ floater: { color, size, weight, z, suffix }, vfx: { shape, color, particles, ring }, priority }`，三类在色相、后缀、`z` 上两两不同（封装为冻结常量）。
   - `classifyImpactClasses(event)`：纯推导，输入即 AC-012 的事件 schema。`event.target.boss === true || event.target.type === 'boss'` → `bossHit`（首领变体 `armored/summoner/berserk` 的 `type` 同为 `'boss'`）；`event.shieldAbsorbed > 0 && event.hpLost > 0` → `shieldBreak`（本击打穿盾、余量落到本体）；`event.shieldAbsorbed > 0 && event.hpLost === 0` 只是纯吸收，**不**含 `shieldBreak`；`event.armorAbsorbed > 0` → `armor`；返回稳定顺序（按 `priority` 升序）的层名数组；缺字段 / `undefined` / 非法输入返回 `[]` 且不抛错。同一条事件可同时命中 `bossHit` 与 `shieldBreak`（首领带盾）。
   - `classFloaterText(event, cls)`（文案冻结，测试按此断言）：`bossHit` → 该击实际扣血 `-<hpLost>`，若 `hpLost === 0`（首领带盾被完全吸收）则用 `-<shieldAbsorbed>`；`shieldBreak` → `破盾 -<shieldAbsorbed>`；`armor` → `-<armorAbsorbed> 甲`。数值一律 `Math.round`，后缀与 `IMPACT_CLASSES[cls].floater.suffix` 一致。
   - `classVfxSpec(cls, profile)`：按 `profile.particleScale` 缩放并以 `profile.maxParticles` 钳制，**任何档位 `particles >= 1`**；耗尽/低档降级为「核心闪白 + 类别色环」而不是整块消失；未知 cls 返回 `null`。
3. **层模型接线**：在 AC-016 交付的 `public/js/shared/floaters.js` 中把 `shield` / `armor` / `bossHit` 三层加入 `FLOATER_LAYERS`（`z` 与既有六层两两不同：类别层整体位于 `damage` 之上、`crit` 之下或按文档冻结的顺序），并把三层纳入 `planFloaterFrame` 的重要性排序（`crit > shield > bossHit > armor > penalty > status > reward > heal > damage`，以文档为准）；不改变 AC-016 已有的六层语义与合并规则。
4. **消费端（新增类，职责单一，导出以便单测）**：在 `public/js/game-app.js` 增加 `ImpactFeedbackConsumer` 类（导出）——按事件对象身份记录游标，逐帧把 `sim.impactEvents` 中新增的事件取出，调用 `classifyImpactClasses`，命中类别时：
   - 用 `sim.addFloater(event.x, event.y - 0.45, classFloaterText(...), IMPACT_CLASSES[cls].floater.color, <big>, { key: true, layer: cls })` 产出类别飘字（`addFloater` 已按 `floatersMode` 门控）；
   - 用 `sim.addEffect({ kind: cls, x: event.x, y: event.y, ttl: ... })` 产出类别特效（`addEffect` 已按 `effectsLevel` 门控）；
   - 游标用「上一条事件对象引用」定位，环形缓冲裁掉旧事件时（引用已不在数组内）整体按当前窗口消费，不抛错、不重复消费。
   **不新增 RNG 调用、不修改 `sim.update` 组织方式、不改任何伤害数值/波次/结算；`sim.impactEvents` 只读。**
5. **特效表接线**：`public/js/render/effect-renderer.js` 的 `EFFECT_EVENTS` 增加 `bossHit` / `shieldBreak` / `armorAbsorb` 三条（颜色、形态、ring、tiers 粒子），并在渲染循环中按 `event.kind` 进入对应分支；低档粒子 ≥ 1；关闭震屏 / reduced-motion 时类别特效不依赖镜头运动即可辨认。
6. **新增 `tests/impact-class-feedback.test.mjs`**（沿用 `tests/combat.test.mjs` 的 `makeSim/addEnemy` 手法与 `tests/impact-events.test.mjs` 的事件读取方式），覆盖下列 AC 全部条目。
7. 不新增第三方依赖；不做音频层（AC-014 负责）、不做武器层形态（AC-015 负责）、不改 AC-016 的六层语义。

## AC

- [ ] `node --test tests/impact-class-feedback.test.mjs` exit 0（AC-030 的 criterion）
- [ ] 分类器判据：`boss` 敌人受击返回含 `bossHit`（`target.type === 'boss'` 与 `target.boss === true` 两条输入都覆盖）；`shieldAbsorbed > 0 && hpLost > 0` 返回含 `shieldBreak`；`shieldAbsorbed > 0 && hpLost === 0`（盾未破、纯吸收）**不含** `shieldBreak`；`armorAbsorbed > 0` 返回含 `armor`；普通无盾无甲命中返回 `[]`；缺字段 / `undefined` / `null` 事件返回 `[]` 不抛错；首领带盾被一击穿透时同时含 `bossHit` 与 `shieldBreak`；返回顺序稳定（按 `priority`）
- [ ] 可辨识性：`IMPACT_CLASSES` 三类的 `floater.color`、`floater.suffix`、`floater.z` 两两不同；`shield` / `armor` / `bossHit` 三层的 `z`、色、字号与既有六层 `damage/crit/reward/heal/penalty/status` 全部不同（破盾与护甲在屏幕上不会被读成普通伤害或暴击）
- [ ] 档位与预算：`classVfxSpec(cls, EFFECT_PROFILES.low).particles >= 1` 且 `classVfxSpec(cls, EFFECT_PROFILES.low).particles < classVfxSpec(cls, EFFECT_PROFILES.high).particles`；三类同帧合计粒子数 `<= EFFECT_PROFILES[profile].poolBudget`；未知 cls 返回 `null` 不抛错
- [ ] 消费端接线（源码断言）：`public/js/game-app.js` 引用 `classifyImpactClasses` 与 `IMPACT_CLASSES`；`public/js/shared/floaters.js` 的 `FLOATER_LAYERS` 含 `shield` / `armor` / `bossHit` 键；`public/js/render/effect-renderer.js` 的 `EFFECT_EVENTS` 含 `bossHit` / `shieldBreak` / `armorAbsorb` 且渲染分支按 `kind` 可达；`public/js/shared/impact-class-feedback.js` 不含 `Math.random`、不 import `sim` / `render` / DOM
- [ ] 消费端不重复消费：把同一批 `impactEvents` 连续喂给消费者两次，第二次产出 0 条类别飘字/特效；环形缓冲被裁旧事件后仍不抛错且不重复
- [ ] 表现零接触模拟：同一 seed 两局（类别消费端挂载 / 不挂载），推进相同步数后序列化 `gold / baseHp / kills / wave / clearedWave / enemies` 与 `sim.impactEvents` 的逐条字段**逐字节一致**
- [ ] 真实对局可制造三类事件：用 `tests/combat.test.mjs` 的手法在单测里至少各构造一次 `bossHit`（`sim.spawnEnemy('boss')`）、`shieldBreak`（`shielder` 类型或手工 `shield` + 一击穿透）、`armor`（`armor > 0`），断言生产者事件字段与分类结果一致
- [ ] `npm test` exit 0

## DoD

- [ ] 真实浏览器（Chrome，`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`，`tests/harness.mjs` 的 `launchBrowser`）：开一局，制造至少一次首领命中、一次破盾、一次护甲吸收，读取渲染层统计要求三类飘字与三类特效各绘制 ≥1 次、`window.__bootErrors` 为空；记录驱动脚本与统计摘要到 Notes
- [ ] 同 seed 实测两局（类别反馈挂载 / 不挂载），结算的金币 / 生命 / 击杀 / 波次一致（实跑对比，不以单元测试代替）
- [ ] 三类截图（首领命中 / 破盾 / 护甲吸收）与一张普通命中对照图落盘到 `docs/reviews/`，人眼可一眼分辨；路径写入 Notes
- [ ] 低画质 + 关闭震屏 + reduced-motion 各跑一段：类别飘字仍可辨认（非运动反馈保留），特效粒子 ≥ 1 且不刷屏
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0
- [ ] `docs/PRD.md` §4.12 与 `docs/TECH_DESIGN.md` §4.6/§5.5 的类别判据、层序、配色、档位降级规则同实现一致；Notes 记录三类各自的视觉差异点（色/后缀/层序/形状）与消费端游标策略

## Touches

- `tasks/gap-impact-class-feedback.md`
- `public/js/shared/impact-class-feedback.js` (new)
- `public/js/shared/floaters.js`
- `public/js/game-app.js`
- `public/js/render/effect-renderer.js`
- `tests/impact-class-feedback.test.mjs` (new)

## Notes

- 本任务只消费事件、不改事件 schema：`public/js/sim/combat-system.js` 与 `public/js/shared/impact-events.js` 均不在 Touches；首领识别同时接受 `target.type === 'boss'` 与 `target.boss === true`，避免为分类去改生产者。
- 依赖 `gap-floaters-layering`（AC-016）：本任务在其六层模型上追加三层，**不**重新实现层模型；若派发时该文件尚不存在，说明依赖未满足，停在本任务门口而不是自带一份六层副本。
- `sim.addFloater` / `sim.addEffect` 自带的档位门控就是降级路径：飘字在 `off` 档不生成，特效在 `effects:'off'` 只保留 bolt/ring/leak——因此「任何档位类别层可见」由类别飘字承担，VFX 按既有档位语义降级，不新增设置项。
- 消费者在 `game-app.js` 而不在 `render.js`：渲染门面只画，页面编排层才持有 sim 的逐帧推进与新增视觉对象的生产；游标基于对象引用，环形缓冲 240 条远大于单帧新增量。
- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。
