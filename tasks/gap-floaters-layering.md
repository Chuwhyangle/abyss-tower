---
id: gap-floaters-layering
title: 伤害飘字分层与设置三档不刷屏
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/floaters.test.mjs
goal_ac: AC-016
---
## Proposal

GOAL-005 退出条件要求「飘字在『全部』档可见且不刷屏，『仅关键』档只保留关键事件」，AC-016 以 `node --test tests/floaters.test.mjs` 见证；该文件当前不存在（AC 证据为 `criterion-capability-unevaluable`）。当前实现有三处结构性缺口：

- **没有分层模型**：`public/js/render/floater-renderer.js` 只有 13/17px 两档字号和一份固定描边/字色，把所有飘字当同一种东西画；`big` 一个字段同时承担「字号更大」「关键事件」「关键档可见」三种语义（`public/js/sim.js:435-440` 的 `key || big` 判据），伤害、暴击、金币、治疗、漏怪/基地受损、首领状态六类事件在数据里没有各自的层。
- **「全部」档会刷屏**：`public/js/sim/combat-system.js:67-76` 对每次 ≥12 的伤害都 `addFloater`，36 敌混战里同一敌人连续挨打会叠出多份数字；`public/js/sim.js:309-313` 的 `updateVisuals` 只按 ttl 过滤过期项，真正的 90 条硬上限与「丢弃最旧」在 `public/js/sim/combat-system.js:157` 的 `cleanup()` 里，既不按时间窗合并同层数字，也没有绘制帧预算，屏幕上是一堵数字墙。`docs/TECH_DESIGN.md` §5.5 只有「飘字 90 上限」一句，没有分层与降级规则。
- **三档语义没有单一实现、没有验收**：`off/key/all` 的可见性判据内联在 `Simulation.addFloater`；`tests/settings.test.mjs` 只覆盖设置值归一化，`tests/` 下没有任何测试覆盖「关键档只保留关键事件」「全部档不刷屏」这两条 AC 语义；`tests/dynamic-perf.mjs:623` 只断言 off 档不生成。`FLOATER_LABELS`（`public/js/settings.js:324`）也只服务 UI 标签。

<!-- dedup-ref -->
相邻但不重叠的任务：gap-impact-events（AC-012，结构化命中事件）、gap-weapon-impact-vfx（AC-015，命中特效）、gap-audio-impacts（AC-014，命中音效）、gap-hitstop-camera-feedback（AC-013，hitstop/震屏）。四者分别改事件层、渲染特效层、音频层与镜头层，验收面独立；本任务只做飘字这一层的数据模型、三档可见性策略与绘制预算。与 gap-impact-events 共享 `public/js/sim.js`，但本任务只改 `addFloater` 与飘字刷新，不触碰 `dealDamage`/`hitEnemy` 与事件产出；两者由调度器按 Touches 串行，保持分开。

## Plan

1. **文档先行（CLAUDE.md 约定）**
   - `docs/PRD.md` §4.12 把飘字三档补成明确语义：`off` 不生成；`仅关键` 只保留暴击、关键伤害、金币、治疗、漏怪/基地受损、首领状态等关键事件，普通伤害不出现；`全部` 显示全部伤害但必须合并、有帧预算。同时写明「关键」的判据是既有 `key || big`（不扩大关键档范围）。
   - `docs/TECH_DESIGN.md` §5.5 增加飘字分层表（层名、触发事件、字号/字重/颜色、层级 z 序）、同层合并规则（同层 + 世界坐标 0.3 格内 + 0.12s 窗口内累加数字）与每帧绘制预算（关闭 0 / 仅关键 12 / 全部 28 条）；§5.6 补「关闭与关键档在生成侧就减少对象，而不是仅隐藏」。
2. **新模块 `public/js/shared/floaters.js`**（纯数据 + 纯函数，无 DOM/Canvas、无 `Math.random`、不 import sim/render）：
   - `FLOATER_LAYERS`：六层 `damage / crit / reward / heal / penalty / status`，每层 `{ z, size, weight, color }`（`z` 两两不同；`size` 为该层基础字号，`big` 仍可在其上加成）。
   - `floaterLayer(meta)`：先认显式 `meta.layer`（合法层名才生效），再按现有调用点的真实签名推导——`big && 文本以 '!' 结尾`→`crit`；数字文本（可带 `+/-/!`）：颜色 `#7ef0a5`→`heal`、以 `+` 开头→`reward`、以 `-` 开头→`penalty`、其余→`damage`；非数字文案→`status`；未知/缺字段回退 `damage`。
   - `floaterVisible(mode, meta)`：`off`→false；`key`→保持既有 `Boolean(key || big)` 判据（不改变现网行为，避免把首领技能名等非大号提示新塞进关键档）；`all`→true；未知 mode 按 `all` 处理。
   - `floaterBudget(mode)`：`{ off: 0, key: 12, all: 28 }`（未知 mode 取 `all`）。
   - `createFloater({ x, y, text, color, big, key, layer })`：产出带 `layer/key/big/ttl/maxTtl` 的规范对象，`ttl` 保持既有 `big ? 0.9 : 0.65`。
   - `mergeFloaterText(a, b)`：两侧都是数字（可带 `+/-` 与 `!`）时求和并保留符号与 `!`（`'12!','8'`→`'20!'`；`'+10','+5'`→`'+15'`；`'-6','-4'`→`'-10'`）；任一非数字返回 `null`。
   - `pushFloater(list, floater, now, opts)`：在 `MERGE_RADIUS=0.3` 格、`MERGE_WINDOW=0.12s` 内找同层既有项，可合并则合并、不可合并则丢弃重复项，否则入列；返回被接受/合并后的飘字对象或 `null`。纯函数、确定序。
   - `planFloaterFrame(floaters, { mode, budget })`：过滤可见 → 同层 `CLUSTER_RADIUS=0.22` 格内聚类合并 → 按层重要性（crit > penalty > status > reward > heal > damage）、ttl 降序、原始下标升序稳定排序 → 截到 `budget` → 按层 `z` 升序给出绘制顺序，并为同层近邻分配 `STACK_STEP=0.16` 格的垂直错位；返回 `{ draw, suppressed, visible }`，不修改入参。
3. **`public/js/sim.js`**：`addFloater` 保留现有签名与默认值，内部改为 `createFloater` + `floaterVisible` + `pushFloater`（新增可选 `opts.layer`）；把 `layer/key` 落到飘字对象上；`updateVisuals` 的逐帧 ttl/位移逻辑不变。**不新增 RNG 调用、不改变模拟结算顺序**；关闭/关键档的「生成侧减少」由 `floaterVisible` 前置与合并共同实现。
4. **`public/js/render/floater-renderer.js`**：改为按 `this.game.floatersMode` 调用 `planFloaterFrame(floaters, { mode, budget: floaterBudget(mode) })`，逐层使用层字号/字重/颜色（显式 `floater.color` 优先），用 `stack` 做垂直错位；保留 `big` 字号加成以兼容旧数据；把本帧 `{ drawn, suppressed, visible, layers }` 写入 `this.stats` 供浏览器验收读取。绘制循环不再直接遍历 `game.floaters`。
5. **向后兼容**：没有 `layer/key` 字段的裸飘字（测试或旧存档注入）按推导层绘制、不抛错；未知层回退 `damage`；不改设置项枚举、UI 标签与 `settings.js` 公开 API。
6. 不新增第三方依赖；不改 `public/js/sim/combat-system.js` 的 90 条硬上限（本任务只在其之上做合并与帧预算）。

## AC

- [x] `node --test tests/floaters.test.mjs` exit 0
- [x] 层模型：`FLOATER_LAYERS` 恰含 `damage/crit/reward/heal/penalty/status` 六层，每层 `z/size/weight/color` 存在且 `size>0`、`weight` 为有限数、`z` 两两不同；`floaterLayer` 对六类真实调用签名（`'120!'`/#ffd36b/big、`'35'`/#eef3f8、`'+30'`/#ffd36b/big、`'+12'`/#7ef0a5/big、`'-8'`/#ff6b6b/big/key、`'狂怒'`/#ff6b6b/big/key）分别判为 crit/damage/reward/heal/penalty/status；显式合法 `layer` 覆盖推导，未知 `layer` 回退 damage
- [x] 三档语义：`floaterVisible('off', …)` 恒 false；`floaterVisible('key', {key:false,big:false})` false 而 `{key:true}`、`{big:true}` 均 true；`floaterVisible('all', …)` 恒 true；用 `Simulation.setVisualQuality` + `addFloater` 实测三档生成的飘字集合与纯函数判定一致（key 档不含普通伤害、all 档含，off 档清空后为 0 条）
- [x] 合并规则：`mergeFloaterText('35','9')==='44'`、`('12!','8')==='20!'`、`('+10','+5')==='+15'`、`('-6','-4')==='-10'`，非数字返回 null；`pushFloater` 只合并同层且在 `MERGE_RADIUS`/`MERGE_WINDOW` 内者，跨层或超窗口不合并、重复非数字文案被丢弃
- [x] 不刷屏：在 60 条近邻普通伤害上 `planFloaterFrame` 返回 `draw.length ≤ floaterBudget('all')` 且 `suppressed === visible - draw.length`；在 20 个互不相邻位置注入 20 条普通伤害时 `draw.length === 20`（低于预算不吞信息）；预算不足时 crit/penalty/status 层的项全部保留、先丢 damage
- [x] 绘制顺序：`draw` 的 `z` 非降；同一层近邻项的 `stack` 两两不同；`planFloaterFrame` 不修改输入数组与其中对象
- [x] 接线源码断言：`public/js/sim.js` 的 `addFloater` 引用 `floaterVisible` 与 `pushFloater`；`public/js/render/floater-renderer.js` 引用 `planFloaterFrame` 与 `floaterBudget`；`public/js/shared/floaters.js` 不含 `Math.random`、不 import `sim`/`render`/DOM
- [x] 表现零接触模拟：同一 seed 两局（`floaters:'off'` 与 `'all'`）推进相同步数后，序列化 `gold/baseHp/kills/wave/clearedWave/enemies` 逐字节一致
- [x] `npm test` exit 0

## DoD

- [x] 真实对局驱动（`tests/harness.mjs` 的 `launchBrowser`）：开一局、`app.applySettings` 切到 `floaters:'all'`，跑满 2 波并在 36 敌混战场景读取 `app.renderer.floaters.stats`，记录单帧 `drawn` 峰值与 `suppressed` 次数；要求 `drawn ≤ floaterBudget('all')`、`window.__bootErrors` 为空，输出统计摘要（记录驱动脚本与输出）
- [x] 同局切 `floaters:'key'` 再跑 1 波：`stats.layers` 不含 `damage`，且至少出现 `crit`/`reward`/`penalty` 中的一层；切 `'off'` 后 `sim.floaters.length === 0`（生成侧不产，而非绘制时隐藏）
- [x] 同 seed 实测两局（飘字 off / all），结算面板的波次、金币、生命、击杀一致（实跑对比，不以单元测试代替）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（飘字改动无 UI 回归）
- [x] `docs/PRD.md` §4.12 与 `docs/TECH_DESIGN.md` §5.5/§5.6 的六层表、合并窗口、三档预算与实现一致；Notes 记录六层各自的视觉差异点（字号/字重/颜色/层级）与合并后的数字表现（累加不丢总量）

## Touches

- `public/js/shared/floaters.js`
- `public/js/render/floater-renderer.js`
- `public/js/sim.js`
- `tests/floaters.test.mjs`
- `tasks/gap-floaters-layering.md`

## Notes

- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。
- 实现（2026-10-27）：新增 `public/js/shared/floaters.js`（纯函数，无 RNG/DOM/Canvas）；`Simulation.addFloater` 改为 `floaterVisible`（生成侧裁剪）→ `createFloater` → `pushFloater`（同层 0.3 格 / 0.12s 累加，重复非数字丢弃）；`FloaterRenderer` 改为 `planFloaterFrame`（0.22 格聚类 → 重要性/ttl/下标排序 → 预算截断 → z 升序 + 0.16 格垂直错位），并把 `{drawn,suppressed,visible,layers}` 写进 `renderer.floaters.stats`。`tests/floaters.test.mjs` 17 条全绿。
- 六层视觉差异（本轮落地值）：

  | 层 | z | 字号 | 字重 | 颜色 | 视觉差异点 |
  |---|---|---|---|---|---|
  | damage | 10 | 13（big +4） | 600 | #eef3f8 | 最底层、常规字重偏冷白 |
  | heal | 20 | 14 | 600 | #7ef0a5 | 绿色治疗数字 |
  | reward | 30 | 15 | 700 | #ffd36b | 金色奖励，`+` 前缀 |
  | status | 40 | 16 | 700 | #ffd36b | 非数字文案（首领技能名/阶段/塔被摧毁） |
  | penalty | 50 | 17 | 700 | #ff6b6b | 红色危险数字，`-` 前缀，压在伤害之上 |
  | crit | 90 | 15（+big 4 = 19） | 800 | #ffd36b | 最粗最大、`!` 后缀、最上层 |

  显式 `floater.color` 优先于层色（现网调用点都传色），层色只作为裸飘字的兜底。
- 合并后的数字表现：同层 0.3 格 + 0.12s 窗口内 `35`+`9`→`44`、`12!`+`8`→`20!`、`+10`+`+5`→`+15`、`-6`+`-4`→`-10`；累加不丢总量，只丢不可合并的重复文案。
- 与 `docs/PHASE_FEEL_ART.md` §3.2 的差异（供文档 lane 收口）：§3.2 把 `FLOATER_LAYERS` 冻结为九层，其中 `armor/bossHit/shield` 目前没有活调用点（归属 AC-030 / gap-impact-class-feedback）。本任务按 AC 落地六层，z 沿用冻结表取值（10/20/30/40/50/90），三层的预留 z（60/70/80）由后续任务追加时不会打乱现有次序；PRD §4.12 与 TECH §5.5.3/§5.6 的三档语义、合并窗口、0/12/28 预算与本实现一致。
- DoD 驱动脚本：`/tmp/floaters-dod.mjs`（真实 `launchBrowser` 对局，脚本不入库以免越出 Touches）。输出摘要：
  - all 档：跑满 2 波后进入 36 敌混战，24 帧采样 `peakDrawn=11 ≤ 28`，`suppressed` 出现 23 帧、累计 156，末帧 `visible=12/drawn=5/layers=[damage,crit]`，`window.__bootErrors` 为空。
  - key 档：同局切档后 20 帧采样 `layers=[crit]`（无 damage），`peakDrawn=3 ≤ 12`。
  - off 档：存量过期后 `sim.floaters.length=0`，继续打暴击伤害后仍为 0（生成侧不产）。
  - 同 seed 两局（脚本化定步 2400 帧，all / off）：结算面板 `wave=1, clearedWave=1, kills=2, goldLeft=139, baseHp=23` 完全一致；all 局 `maxFloaters=2`、off 局 `0`。
- 回归：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0；`node --test tests/floaters.test.mjs` 17/17；`sim-systems/combat/impact-events/ambience-presets/effect-variants/feel-defaults/settings/docs-phase-sync` 共 80 条相关用例全绿；`node scripts/check-doc-ownership.mjs` OK。
