# TODO / 待办与改进

> 记录讨论中的待办与改进需求，作为实现任务的输入源。落地时转成 quay/实现任务，完成后移入「已完成」。
> 创建于 2026-11-03。原则：出方案要**深和宽**——不是把 bug 修了就完事，要完善机制、把同类问题一起收口。

## 待修复（bug）

### TODO-1 塔进化状态未写入单局快照（存读档丢进化）

- **现象**：「独塔为王」升到 10 级自动兼得三条进化后，刷新页面/续玩，塔的 `evolution`/`evolutions` 被清空：溅射/减速/连锁等进化系数永久丢失（仅伤害/射程/攻速被独塔的 `missingEvolutionMul` 兜底补回），且三选一重新弹出，违背 PRD「不再三选一」。普通塔（3 级选一条进化）刷新后同样丢那一条进化。
- **根因**：`public/js/shared/snapshot.js` 的 `serializeTower`（约 248 行）只写 `type/c/r/level/invested/maxHp/hp`，不写 `evolution`/`evolutions`；`normalizeTowers` 也不读回。读档重建在 `public/js/sim.js:184-196` 取 `tower.evolutions ?? tower.evolution` 得 `undefined` → 空数组。
- **方案**：`serializeTower` 写入 `evolutions`（数组），`normalizeTowers` 读回并归一化；旧档无此字段按无进化处理（与 `tests/tower-evolution.test.mjs`「旧存档没有 evolution 字段时按未进化处理」约定一致，无需改 `SAVE_VERSION`）。深和宽：同根因覆盖普通塔单条进化，`normalizeEvolutionIds` 兼容数组/单串/旧档。
- **状态**：[ ] 方案已定，待实现

### TODO-4 遗物三选一必须点「确定」才能进下一关

- **查证**：现在是「点卡片 = 确认」，选完只解除暂停回到 prep，**不会自动进下一波**（下一波要手动点 HUD 按钮）。无独立「确定」按钮；正常路径不会「未选跳过」。真正的缺陷：`run.js` 的 `restorePendingDraft()` 对「`offers` 为空」分支没处理，会渲染一个 `closable:false`、无卡片、关不掉的空弹窗 → **软锁**。
- **方案**：
  1. 加「确定」按钮：点卡片高亮选中，点「确定」才 `pickOffer` + 关弹窗；未选时「确定」禁用（防误触，Esc/遮罩仍不可关）。
  2. 修软锁：`restorePendingDraft` 与 `handleWaveClear` 对齐——`offers` 为空或已选都清 `pendingDraft` + 解暂停 + toast，绝不渲染空弹窗。
- **文件**：`public/js/app/combat.js`（pickOffer/handleWaveClear）、`public/js/ui/modals.js`（showDraft）、`public/js/app/run.js`（restorePendingDraft）。
- **状态**：[ ] 方案已定，待实现

### TODO-5 索敌顺序修一下

- **查证**：`findTarget` 规则本身正确（射程内 `progress` 最大 = 最靠基地，`tower-system.js:40-53`，与 i18n 帮助文案一致）。但 `updateTowers` 锁死目标：只要当前目标存活且在射程内就**不重选**（`tower-system.js:24-27`），导致正打中等进度肉盾时不切换去打 90% 进度的快怪，「最靠基地优先」失效。
- **方案**：
  1. **开火时刻重选**：`cd<=0` 时用 `findTarget` 重新选目标（而非只在无目标时选），保证打当前最靠基地者；只在开火瞬间重选，避免每帧抖动导致火力分散。
  2. 统一确定性排序口径：`progress` 降序 + `id` 升序（与 `skill-system.js` 的 `skillTargets` 一致），可测。
- **文件**：`public/js/sim/tower-system.js`（updateTowers/findTarget）。
- **状态**：[ ] 方案已定，待实现

### TODO-6 大招时停偏短 + 我方攻击是否也被停

- **查证**：**我方塔在时停期间其实没有停**——`updateTowers` 无 stasis 判断，照常索敌开火并带过载（+50% 攻速/+1 射程，L4 再 +20%）。「自己也被暂停」是释放瞬间的 **hitstop 冻结帧**（约 90ms 全局放慢）造成的错觉；「暂停太短」是 `stop` 数值本身短（L1 1.2s → L10 2.4s，CD 100s→50s；过载 3.5s→7s）。
- **方案**：
  1. 去错觉：chrono 释放的 `skill` 来源命中事件不计入 hitstop（`camera-feedback.js` 的 `hitstopFor`），放大招不再「全场顿一下」。
  2. 时长：`stop` 数值上调（需 balance 模拟验证），或把「时停」与「过载」两段的时长在卡面讲清楚。
  3. 文案：帮助/卡面明确「时停期间我方塔持续攻击并过载」。
- **文件**：`public/js/render/camera-feedback.js`、`public/js/shared/data/skills.js`、i18n 文案。
- **状态**：[ ] 方案已定，待实现（数值待 balance）

### TODO-7 手机屏幕适配

- **查证**：**强制横屏**——竖屏直接盖 rotate-hint，游戏本体竖屏不可玩（`styles.css:2636-2687`）。紧凑屏把遗物面板/下一波情报整体 `display:none`（`styles.css:2350-2352`），HUD 靠隐藏信息压缩（≤720px 隐藏第 4 项 stat 等），触控层薄（只有画布 + 技能钮），browser-mobile 测试未覆盖塔面板/结算/offer 弹窗。
- **方案（已定 A，用户 2026-11-03 拍板）**：维持横屏，只优化信息可达性——紧凑屏信息改「可收起抽屉」而非隐藏、触控目标放大、扩 browser-mobile 覆盖（塔面板/结算/offer 弹窗）。
- **状态**：[x] 已实现中——`feat-mobile-drawer` + `feat-mobile-info-accessibility`（ready，待派；两任务 Touches 重叠，串行跑）

## 改进需求（design）

### TODO-2 飞行怪 vs 地面塔：冻结后可被地面塔攻击

- **需求**：地面塔（炮台，`groundOnly`）打不到飞行怪（翼魔），炮塔流派（尤其「独塔为王」+ 炮台）对飞行怪完全无解。
- **方案**：冻结中的飞行怪视为可被地面塔攻击——`findTarget` 改为 `groundOnly && flying && !frozen`（`tower-system.js:46`）；渲染浮空表现不变。深和宽：统一「冻结/时停期间飞行怪可被地面塔打」的口径，覆盖极光技能、霜塔 T2、frostheart-shatter 与 chrono 时停。
- **待确认**：冻结窗口是否够（极光 0.7~1.4s）；是否覆盖时停。
- **状态**：[ ] 方案已定，待实现

### TODO-3 独塔为王重做：分层选择 + 每塔独属强化 + 外观特效升级

- **已定方向**：
  1. 三条进化拆到 3 / 6 / 9 级逐级选（选完三条到 9 级）。
  2. 10 级 = 固定大招（每塔型一个，非三选一）。
  3. 每塔独属大招 = 被动触发型。炮塔模板：**全图索敌（10 级解锁）** + 每打 4 下 → 下一次「轰击」带「余波」二次范围伤害。
  4. 外观/特效随 3/6/9/10 逐级变炫酷。
- **分工**：其余 7 座塔（弩/霜/电弧/毒/战旗/震荡/狙击）大招由 quay（agent）出草案，用户点头/调数值。
- **待确认**：轰击/余波数值；现有 `onTowerUpgraded` 兼得进化 + `missingEvolutionMul` 兜底改为「3/6/9 逐级选 + 10 级大招」；视觉特效预算进 `sprite-coverage`/`render-budget`。

### 7 塔大招草案（2026-11-03 三路子代理综合，manager 裁定）

| 塔 | 常驻特性 | 触发大招（每 N 次） | 身份/记忆点 |
|---|---|---|---|
| 弩塔 arrow | 攻速 +20% | 每 6 次 → 下一发贯穿 2 目标（各 60%）+ 必暴击 | 连珠穿云 |
| 霜塔 frost | 减速 +20% | 每 6 次 → 命中冻结 1.0s（首领 0.5s）+ 冻结易伤 +25% | 急冻控杀 |
| 电弧塔 arc | 连锁 +1、跳转 +0.6 格 | 每 5 次 → 本次连锁必暴击 + 跳转 +1.2 格 | 天罚雷暴 |
| 毒雾塔 poison | 毒伤 +30% | 每 6 次 → 即时结算当前毒伤（无视护甲）+ 1.5 格传播毒 | 疫爆扩散 |
| 战旗 banner | 光环强化 + 获得自攻（军令箭） | 每 5 次 → 号令齐射（光环内 4 目标 150%）+ 全塔攻速 +40% | 御驾亲征 |
| 震荡塔 shock | 击退 +30% | 每 4 次 → 溅射 ×1.6 + 击退 ×2 + 减速 +0.2 | 地裂震啸 |
| 狙击塔 sniper | 射程 +15%、处决线（对 <30% 血 +40%） | 每 4 次 → 无视射程处决：250% + 最大生命 6%（首领 2%） | 夺命收割 |

- **manager 关键裁定**：
  1. **战旗必须质变**：纯支援塔在独塔模式下空转（`support` 塔不索敌不攻击），10 级必须让它获得自身攻击（军令箭自攻 + 号令齐射），三路一致同意。
  2. **「全图索敌」保留给炮台（常驻）+ 狙击（触发一次）**，其余塔不占全图身份，靠自身机制（贯穿/连锁/冻结/毒/击退）补覆盖——保持流派差异，守「可复玩」。
  3. 数值全部为草案（N 值/倍率/百分比），落地前 `npm run balance` 验证，确保「一塔顶 7 塔」的下限又不秒全场。
- **状态**：[x] 草案已出，待实现（拆 3/6/9 选进化 + 大招 + 视觉）

### TODO-8 加成数据一览 + 遗物栏可收起

- **查证**：无「全部加成汇总」面板（只有逐件 tooltip，`shop.js` 的 `relicEffectText`）；`sim.mods` 聚合后的最终加成（伤害/攻速/射程/金币/减速/暴击等）无处总览。遗物栏桌面常驻不可收（`styles.css:660-674`），移动端直接隐藏。
- **方案**：新增「加成一览」面板（汇总 `sim.mods` 最终加成并标注来源：遗物/海克斯/契约/教义/天赋）；遗物栏加折叠按钮（桌面）+ 移动端抽屉，与 TODO-7 联动。
- **文件**：`public/js/ui/hud.js`、`public/js/ui/shop.js`、`public/index.html`、`public/styles.css`。
- **状态**：[ ] 未开始

### TODO-9 局外升级系统（肉鸽感不足、难度偏低）

- **查证**：星核→解锁塔/perk/技能是唯一真正生效的养成；**天赋树 + 传承之核是半成品**——数据/DB/结算产出都写好（`shared/data/meta.js`、`server/db/legacy.mjs`、`server/db/accounts.mjs` 的 read/writeTalent），但：① 无 `/api/talent` 或 `spendLegacy` 路由（`spendLegacyInTx` 零调用）② 无 meta 树 UI ③ 对局不注入天赋（`run.js:315-362` 构造 Simulation 没传 `talent`，`talentMods` 恒空）。
- **方案（把半成品接线完）**：
  1. 服务端：新增 talent 读写 + 传承材料消耗路由。
  2. UI：meta 树界面（三系 8 节点 + 传承材料）。
  3. 对局注入：`run.js` 构造 Simulation 传 `talent`。
  4. 平衡：难度偏低可配合天赋树调。
- **文件**：`server/routes/`（新）、`server/db/legacy.mjs`、`public/js/app/run.js`、新 UI 模块。
- **状态**：[ ] 未开始

### TODO-10 可攻击获取物品的地图块

- **查证**：现有可破坏物是「花金币手动拆除」（金脉/石碑/补给箱/虫巢/诅咒图腾，`destructibles.js`、`destructible-system.js`），没有「塔攻击获取物品」机制。
- **方案**：新增「可被塔攻击的资源地块」：有 HP，被塔攻击破坏后掉金币/物品（现有商店购买保留）。复用 destructible 占格框架，把「金币拆除」改成「塔打掉血」。设计要点：是否自动索敌攻击、掉落内容、与贴路建塔位联动（地块占格）。
- **文件**：`public/js/shared/destructibles.js`、`public/js/sim/destructible-system.js`、`public/js/sim/tower-system.js`。
- **状态**：[x] 机制已落地（`feat-attackable-tiles` done：资源矿脉 hp140/金60~120 全链路）；落图待派（`feat-resource-vein-placement` ready：canyon 2 脉 / twin+ring 3 脉，落图后 `npm run balance` 复测，越线先加血 140→200 再砍金）

### TODO-11 开局建塔位：每图固定、偏少、贴路

- **查证**：已落地——`feat-buildable-mask`（done，commit 25ecd9b）：三图各 25 格手写 `buildableMask`，`rasterize.js` 支持掩码，回归测试卡死「纯塔位 15~25 格、贴路 ≥80%」。平衡实证：21~22 格远征崩到 23%，25 格三档达标。
- **方案（可选细化）**：峡谷 25→24（单入口易图、深渊 13% 偏上限），双牙桥/环心 25→26（双入口短 lane、深渊 8% 靠下限）。
- **文件**：`public/js/shared/maps/canyon.js|twin.js|ring.js`、`public/js/shared/maps/rasterize.js`、`docs/MAP_DESIGN.md`（旧表 215/209/207 待同步）。
- **状态**：[x] 已落地（25 格/图）；24/26 细化为可选项，非必须

### TODO-12 局内金币/经验 + 爬塔模式

- **查证**：线性 1..30 波、无节点图（`MAX_WAVE=30`，`run-service.mjs` 权威推进）；金币 5 来源（击杀/清波/出售/周期性遗物/地图词缀），默认无利息；无 XP/等级系统。做爬塔需动：`server/services/run-service.mjs`、`server/routes/runs.mjs`、`server/services/run-rules.mjs`、`public/js/shared/waves.js`、`public/js/app/combat.js`（+`run.js`）+ 节点选择 UI。
- **方案（大设计，需单独 PHASE 冻结表）**：节点图（**打 / 事件 / 商人**，只有「打」给遗物），种子派生保证确定性/防作弊；商人用现有金币经济；事件复用 `events.js`。分阶段：先出设计文档 → 再实现。
- **状态**：[x] 三路综合草案已出（2026-11-03），待 docs lane 出 PHASE 冻结表

### 爬塔设计草案（三路子代理综合，manager 裁定）

**核心**：在现有 30 波难度阶梯上盖一层「自选路线」。节点图 seed 派生、服务端权威，只落「选路决策」+「当前节点游标」两样状态（`ruleset.tower.route`，零 DB 迁移）。

- **节点图**：30 层 DAG × 2~3 列、扇出 ±1、稀疏格制造「路径承诺」；5/10/15/20/25/30 层首领漏斗单列汇合；节点类型 = 打 / 事件 / 商人 / 精英（词缀强化+高稀有）/ 首领 / 宝藏。
- **三类节点**：打（金币 + **唯一免费遗物** + 推进）、事件（复用 `events.js` 高风险高收益，不产遗物）、商人（金币黑洞：买遗物/升级/治疗/maxHp/刷新/卖遗物）。三闸反「无脑选收益」：隐藏节点内容（只露类型+词缀）、遗物/上限/金币三资源分流、难度追击（躲架=遗物落后）。
- **经济**：不新增金币来源、不引入局内 XP（层数即等级，局外成长由天赋树承担）；商人价目普通遗物 80 起 / 稀有 160 / 史诗 300，按层上浮；**costMul 不作用于商人**（防 −18% 双吃）；刷新费随层涨。
- **8 条平衡红线**（采纳经济视角）：遗物 12~15 次/局、难度映射正确、商人买价 ≥60、治疗价 vs 卖血价防套利、刷新费 25+6×波、终局余金压回 2000~3000、costMul 作用域、囤币策略有出口。
- **关键待验证点（balance 实验定夺）**：难度映射「楼层=波次」（最简单，但 15 场战斗 vs 30 波曲线可能太硬）vs「波次等价」（只战斗推进难度，事件/商人不推进）。落地前 `npm run balance` 验证明。
- **需重排的既有节奏**：首领核心 6 次→3 次（10/20/30）、契约卡/事件定时器重排到节点。
- **实现红线**（采纳架构视角）：`MODES` 三处硬编码（snapshot/replay/leaderboard）、`normalizeEventHistory` 会吞爬塔事件、分享码要加 `route`（REPLAY_VERSION=3）、`sim.js`/`events.js` 确定性不得动（新随机流用 `${seed}:tower:*` 命名空间）。
<!-- docs-consistency:planned-start -->
- **落地顺序**：docs lane 出 `docs/PHASE_爬塔.md` 冻结表 → 阶段 0 串行共享契约层（tower.js + events/snapshot/scoring/replay）→ 阶段 1 并行（服务端/客户端逻辑/UI）→ 集成 + `npm test` 全绿。
<!-- docs-consistency:planned-end -->

## v1.34 改进（下一版本）

### TODO-13 开始页面（标题页）美化

- **需求（用户 2026-11-03，最优先）**：开始/标题页面太差劲，要做精美，像「一个正儿八经的手游」——背景、logo、按钮、排版、氛围整体升级。
- **现状**：`public/js/ui/title.js` 有场景精灵层（背景+logo）+ 技能卡 + 难度/变异弹窗，但整体简陋。
- **状态**：[ ] 未开始

### TODO-14 点击交互改弹窗

- **需求**：点开某功能（如天赋树）时，应该是**弹出窗口（可关闭）**，而不是从下面滑出/出现在页面下方。
- **现状**：天赋树等面板现在从下方出现。
- **状态**：[ ] 未开始

### TODO-15 天赋树重做：决策树结构 + 数值拉高 + 满级小质变

- **需求（用户原话）**：
  1. **数值拉高**：每级提升有意义但不过分（例：射程每级 +0.15 格，而非现在的 +0.01）。
  2. **满级小质变**：节点可升到 5 级，第 5 级有明显但非夸张的质变（例：射程节点第 5 级直接 +0.5 格）。
  3. **决策树结构**：解锁上一节点才能解锁下一节点，分支散开（树状），不是现在「一个页面平铺」。
- **现状**：`public/js/shared/data/meta.js` 的 `TALENT_NODES` 8 节点平铺、`maxRank:2`、每级增量极小（range 0.01 格 / dmgAll 0.001 / goldMul 0.001 / interest 0.001 / killGold 0.02），无解锁依赖、无分支、无质变。
- **状态**：[ ] 未开始（结构 + 数值需设计，满级质变需定义）

## 已完成

（暂无）
