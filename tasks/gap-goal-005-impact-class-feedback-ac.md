---
id: gap-goal-005-impact-class-feedback-ac
title: GOAL-005 充分性缺口：首领命中/破盾/护甲吸收缺目标级 AC（提案新增 AC-021）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/impact-class-feedback.test.mjs
---
## Proposal

GOAL-005（战斗反馈 2.0：每一击都有重量）的退出条件是合取式。其中第三条与第四条各有一段**目前在域 AC 里没有任何见证**，原文逐字为：

> 八种武器都有可区分的命中音效与命中特效；**暴击、击杀、首领命中、破盾各有独立反馈层**，并受并发限流与粒子预算约束。

> 伤害飘字在「全部」档可见且不刷屏，「仅关键」档只保留关键事件；**破盾、护甲、治疗可辨识**。

**未被覆盖的部分：这两段里的事件类别层——「首领命中」「破盾」「护甲吸收」。**

逐条对照现有 AC 集（AC-011…AC-020）：

- **AC-014**（`gap-audio-impacts`，criterion `node --test tests/audio-impacts.test.mjs`）按**武器类型**分音色，并在 `impactVoice` 里追加「暴击高频层」「致死低频层」两个附加层；验收面是 8 武器签名、并发限流与压缩总线。首领命中、破盾、护甲三个事件类别**不在**它的任一 AC 条目里。
- **AC-015**（`gap-weapon-impact-vfx`，`tests/impact-vfx.test.mjs`）按**武器类型**给 8 种形态与粒子预算；其 AC 逐条是 `IMPACT_VFX` 8 键、颜色/形态两两不同、`particles` 钳制、`ImpactVfxPool` 并发预算——**没有事件类别这个维度**。
- **AC-016**（`gap-floaters-layering`，`tests/floaters.test.mjs`）的层模型逐字是六层 `damage / crit / reward / heal / penalty / status`——**没有 shield、没有 armor、没有 bossHit**；其 `floaterLayer` 推导规则把护盾/护甲数值按颜色归入 `damage` 层，与普通伤害不可区分。
- **AC-012**（`gap-impact-events`）只**产出** `shieldAbsorbed / armorAbsorbed / target.type` 字段，它是数据源而非反馈层；没有任何 AC 要求这些字段被某个消费者表现为可辨识层。
- **AC-017**（`gap-culmination-shows`）覆盖首领**死亡**（`bossKill`）的三段演出，不覆盖首领**命中**。
- **AC-020**（`gap-feel-review-record`）的评审问题清单里逐字包含「暴击/破盾/击杀/首领命中是否有独立层」——即目标自己把这三个类别列为待判定项，但 AC 集里没有任何一条**建造**它们的 AC，评审只能记录缺失、无法让它成立。

代码事实（当前 HEAD，`public/js/sim/combat-system.js`）：

- `:41-43` 护甲在伤害计算里**静默**扣除（`final = Math.max(1, final - enemy.armor * (1 - armorPierce))`），没有飘字、没有特效、没有音效，玩家看不出「这一击被护甲吃掉了多少」。
- `:58-64` 护盾**静默**吸收（`enemy.shield -= absorbed; final -= absorbed`）；盾被本击打穿与「只是打到本体」在表现上完全一致，没有独立层。
- 首领挨打与普通敌人走完全相同的命中路径；`enemy.boss` 分支只在**死亡**时（`:123-139`）加震屏、金币飘字与 `bossKill` 音效。

而且 GOAL-005 的**范围**节自己逐字写着「伤害飘字分层：普通 / 暴击 / **破盾** / **护甲** / 治疗」——所以这不是超出目标要求的追加，而是 AC 集相对目标自己声明的范围漏掉的那一层。

**提案：为 GOAL-005 新增一条 AC（AC-021 是当前最小空闲号）**

- id：AC-021
- title：首领命中、破盾、护甲吸收各有可辨识的独立反馈层
- criterion：`node --test tests/impact-class-feedback.test.mjs`
- expect：`exit 0`
- origin：GOAL-005 退出条件：暴击、击杀、首领命中、破盾各有独立反馈层；破盾、护甲、治疗可辨识。

**为什么这条 AC 覆盖了缺口：** 它的验收面正好是「命中事件类别 → 独立反馈层」这一维，与 AC-014/015 的武器维度正交，与 AC-016 的六层飘字互补：新增的 `shield` / `armor` 两层与 `bossHit` 层不与既有六层中的任何一层重叠，暴击（AC-016 的 crit 层 + AC-014 的暴击音效层）与击杀（AC-014 的致死层 + 既有 reward 飘字）不需要重做也不会被这条覆盖声明重复计入。这条 AC 落地后，退出条件第三条的四个类别（暴击、击杀、首领命中、破盾）与第四条的三项辨识（破盾、护甲、治疗）都各有一条在域 AC 见证。

<!-- dedup-ref -->
相邻但不重叠的任务：gap-impact-events（AC-012，只产事件字段）、gap-audio-impacts（AC-014，武器音效 + 暴击/致死附加层）、gap-weapon-impact-vfx（AC-015，武器形态 + 粒子预算）、gap-floaters-layering（AC-016，六层飘字，明确不含 shield/armor）、gap-culmination-shows（AC-017，首领死亡而非首领命中）。本任务只做「事件类别」这一维，五者机制不同、验收面独立，判定 separate，不合并。文件重叠说明：`public/js/shared/floaters.js` 由 gap-floaters-layering 创建（六层），本任务在其之上追加 `shield / armor / bossHit` 三层；若派发时该文件尚不存在，本任务自带最小层模型，不硬依赖它的落地顺序。`docs/PRD.md` / `docs/TECH_DESIGN.md` / `public/js/render.js` 与多个 ready/todo 任务共享，调度器按 Touches 串行即可。

## Plan

1. **文档先行**（CLAUDE.md 约定）：`docs/PRD.md` §4.12 的反馈分层表补「事件类别层」一列——首领命中、破盾、护甲吸收各有独立表现，并写明 reduced-motion / 关闭震屏 / 低画质档下仍保留非运动反馈；`docs/TECH_DESIGN.md` §5.5 补类别层的规格表（层名、触发判据、颜色/字形/层序、特效形态）、与武器层的叠加规则、档位与粒子预算降级路径。
2. **新纯函数模块 `public/js/shared/impact-class-feedback.js`**（无 DOM/Canvas、无 `Math.random`、不 import `sim`/`render`）：
   - `IMPACT_CLASSES = { bossHit, shieldBreak, armor }`，每项 `{ floater: { color, size, weight, z, suffix }, vfx: { shape, color, particles }, priority }`，三类在色相、字形/后缀、层序上两两可分辨。
   - `classifyImpactClasses(event)`：纯推导，输入是 AC-012 的事件 schema——`event.target.type === 'boss'`（或 `event.target.boss === true`）→ `bossHit`；`event.shieldAbsorbed > 0 && event.hpLost > 0`（盾在本击被打穿、余量落到本体）→ `shieldBreak`；`event.armorAbsorbed > 0` → `armor`；返回稳定顺序的层名数组，缺字段/`undefined` 返回 `[]` 不抛错。同一条事件可同时命中 `bossHit` 与 `shieldBreak`（首领带盾）。
   - `classFloaterText(event, cls)` / `classVfxSpec(cls, profile)`：按画质档钳制粒子，low 档 `particles ≥ 1`，耗尽时降级为「核心闪白 + 类别色环」而不是整块消失。
3. **接线（只消费、不生产事件）**：在 AC-012 落地后的命中事件消费点（`public/js/game-app.js` 或 `public/js/render.js`，以实际落地位置为准）对每条事件调用 `classifyImpactClasses`；命中类别时用 `sim.addFloater(..., { layer })` 产出类别飘字、并由 `public/js/render/effect-renderer.js` 画对应类别特效；`public/js/shared/floaters.js` 的 `FLOATER_LAYERS` 追加 `shield` / `armor` / `bossHit` 三层，`public/js/render/floater-renderer.js` 按层绘制。**不新增 RNG 调用、不改结算与事件顺序、不触碰 `sim.update` 的组织方式。**
4. **新增 `tests/impact-class-feedback.test.mjs`**（沿用 `tests/combat.test.mjs` 的 `makeSim/addEnemy` 手法），覆盖下列 AC 全部条目。
5. 不新增第三方依赖；不改战斗数值、平衡、波次与经济。

## AC

- [ ] `node --test tests/impact-class-feedback.test.mjs` exit 0
- [ ] 分类器判据：首领受击返回含 `bossHit`；`shieldAbsorbed > 0 && hpLost > 0` 返回含 `shieldBreak`；`shieldAbsorbed > 0 && hpLost === 0`（盾未破、纯吸收）**不含** `shieldBreak`；`armorAbsorbed > 0` 返回含 `armor`；普通无盾无甲命中返回 `[]`；缺字段 / `undefined` 事件返回 `[]` 不抛错；首领带盾受击同时含 `bossHit` 与 `shieldBreak`
- [ ] 可辨识性：`IMPACT_CLASSES` 三类的 floater 颜色、字形/后缀、`z` 两两不同；`shield` / `armor` / `bossHit` 三层的 `z`、色、字号与既有六层 `damage/crit/reward/heal/penalty/status` 全部不同（破盾与护甲在空中不会被读成普通伤害）
- [ ] 档位与预算：`classVfxSpec(cls, EFFECT_PROFILES.low).particles >= 1`（任何画质档位下类别层都可见）且 `low < high`；类别层粒子计入既有命中粒子总预算，不超过 `impactBudget(profile)`
- [ ] 接线源码断言：`public/js/shared/floaters.js` 的 `FLOATER_LAYERS` 含 `shield` / `armor` / `bossHit` 键；命中事件消费点引用 `classifyImpactClasses`；`public/js/render/effect-renderer.js` 有类别特效分支
- [ ] 表现零接触模拟：同一 seed 两局（类别反馈开 / 关）推进相同步数后，序列化 `gold / baseHp / kills / wave / clearedWave / enemies` 逐字节一致；`public/js/shared/impact-class-feedback.js` 不含 `Math.random`、不 import `sim` / `render` / DOM
- [ ] `npm test` exit 0
- [ ] 本提案获人认可、AC-021 已写入 GOAL-005 目标库（待外部）

## DoD

- [ ] 真实对局驱动（`tests/harness.mjs` 的 `launchBrowser`）：开一局，制造至少一次破盾、一次护甲吸收、一次首领命中，读取渲染层统计要求三类各绘制 ≥1 次、`window.__bootErrors` 为空；记录驱动脚本与统计摘要到 Notes
- [ ] 同 seed 实测两局（类别反馈开 / 关），结算面板的金币 / 生命 / 击杀 / 波次一致（实跑对比，不以单元测试代替）
- [ ] 三类截图（破盾 / 护甲 / 首领命中）与一张普通命中对照图，人眼可一眼分辨；路径写入 Notes
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0
- [ ] `docs/PRD.md` §4.12 与 `docs/TECH_DESIGN.md` §5.5 的类别层表、判据与降级规则同实现一致
- [ ] 人裁定记录写入 Notes：认可 AC-021（推荐）/ 调整 criterion / supersede 并说明为什么这几个类别不应有目标级 AC（待外部）

## Touches

- `tasks/gap-goal-005-impact-class-feedback-ac.md`
- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `public/js/shared/impact-class-feedback.js`
- `public/js/shared/floaters.js`
- `public/js/render/floater-renderer.js`
- `public/js/render/effect-renderer.js`
- `public/js/render.js`
- `tests/impact-class-feedback.test.mjs`
