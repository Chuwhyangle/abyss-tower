# 《渊塔守卫》技术设计文档 v0.1

- 状态：**已评审**（2026-10-22）
- 对应需求：`docs/PRD.md` v1.2
- 目标：确定架构、模块边界、接口契约、数据模型、难度探索方法与测试策略，作为 M2–M5 的实现依据。
- v1.22 事件连锁（2026-10-24）：`shared/events.js` 扩到 12 类事件并新增 `EVENT_CHAINS`（3 条纯数据连锁，选项 → 2 波后的固定后续事件，延迟节点为 7/12/17/22/27 波）。连锁排期由事件历史唯一推导，服务端据此校验；快照升到 v5（`chains:[{chainId,wave}]`，无连锁时仍写 v3/v4）。
- v1.8 文档同步（2026-10-23）：按实际交付校准内容量（塔 8 / 遗物 30 / 地图原型 6 / 词缀 8）；数据表已拆到 `shared/data/`，runs 路由拆为仓储 + 领域服务，快照统一为 v4。
- v2.0 方向（2026-10-23）：新增第 14 节（成就 / 生涯统计 / 音乐 / 可访问性）；只新增系统设计，不改变第 1–13 节已有决策。
- 评审结论：
  - 难度命名「漫游 / 远征 / 深渊」。
  - 排行榜合并，按最终分数排序，展示难度标签。
  - 每日挑战开局自选难度，使用当日固定种子。
  - 第 30 波清空直接胜利结算。

---

## 1. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Node.js ≥ 22.5（当前 22.23） | 内置 `node:sqlite`、原生 ESM、单进程部署 |
| HTTP | `node:http` | 接口量小，无需框架；零依赖，规避 npm 不可达 |
| 数据库 | SQLite（`node:sqlite`） | 单文件、易备份、适合小圈子 |
| 前端 | 原生 ES Module + Canvas 2D + DOM UI | 游戏以 Canvas 为主，UI 用 DOM；无构建步骤，改完即刷新 |
| 音频 | WebAudio 合成 | 不依赖音频素材与网络 |
| 测试 | `node:test` + 无头 Chrome | 零依赖；模拟器可在 Node 中跑真实战斗逻辑 |
| 部署 | 单 Node 进程 + systemd | `npm start` 即用；端口 8787 |

**约束**：npm registry 当前不可达，因此首版坚持零运行时依赖。未来若引入依赖，需先解决镜像/代理问题。

---

## 2. 架构总览

```
┌──────────────────────────── 浏览器 ────────────────────────────┐
│  main.js（入口）→ app/GameController（编排/状态）               │
│    ├─ app/RunController      开局、选图、续玩、开局装配         │
│    ├─ app/CombatController   开波、清波、遗物、结算             │
│    ├─ app/InputController    画布/键盘输入                      │
│    ├─ app/SessionController  资料、认证、商店、排行榜           │
│    ├─ ui.js         DOM：HUD、商店、弹窗、排行榜                │
│    ├─ game-app.js   rAF 循环、渲染、音效、HUD 节流              │
│    ├─ sim.js        纯战斗模拟（无 DOM）                        │
│    ├─ render.js     渲染门面 → render/ 分层渲染器               │
│    ├─ audio.js      WebAudio 合成音效                           │
│    └─ shared/       RNG、地图、波次、数值、难度、遗物           │
└───────────────┬─────────────────────────────────────────────────┘
                │ REST（JSON + 会话 Cookie）
┌───────────────▼─────────────────────────────────────────────────┐
│  Node http server（index.mjs：引导/静态/路由装配）              │
│    ├─ http/         响应原语、RouteContext、静态文件            │
│    ├─ routes/       路由类：system/auth/profile/board/runs      │
│    ├─ 规则：地图生成、波次生成、遗物抽取、结算校验              │
│    ├─ shared/ 同一份纯逻辑（与浏览器完全一致）                  │
│    └─ SQLite：accounts / sessions / runs / leaderboard          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 权威边界

- **服务端权威**：地图、波次、遗物三选一、每日种子、结算分数/星核、排行榜。客户端无法改变已放行波次与抽卡结果。
- **客户端权威**：实时战斗模拟（单机、低对抗场景）。服务端不逐帧校验，只做包络校验（波次上限、数值钳制）。
- **不做 WebSocket**：交互发生在波次之间，REST 足够；避免长连接与状态同步复杂度。

### 2.2 关键架构决策

1. **模拟与渲染分离**：`sim.js` 不引用 DOM/Canvas/音频，浏览器与平衡模拟器共用同一份战斗逻辑。
2. **前后端共享纯函数**：地图/波次/难度/遗物/数值放在 `public/js/shared/`，服务端直接 import。
3. **确定性**：所有生成逻辑使用种子 RNG；战斗中的暴击也使用战斗种子 RNG，保证模拟器可复现。
4. **无构建链路**：浏览器直接加载 ESM；服务端直接运行 `.mjs`。代价是没有类型检查，用测试与代码评审补足。

---

## 3. 目录结构（目标）

```
rogue-td/
├─ package.json
├─ docs/
│  ├─ PRD.md
│  └─ TECH_DESIGN.md
├─ server/
│  ├─ index.mjs          # 引导：监听、来源校验、静态资源、路由装配
│  ├─ http/              # respond / context / static
│  ├─ routes/            # router、system、auth、profile、leaderboard、runs、unlock
│  ├─ db.mjs             # SQLite 连接、建表/迁移、查询封装
│  └─ data/game.db       # 运行时生成
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ js/
│     ├─ main.js         # 入口：错误收集 + GameController.boot()
│     ├─ app/            # 控制器：game/run/combat/session/input/store
│     ├─ game-app.js     # 固定步长循环、渲染调度、HUD 节流
│     ├─ sim.js          # 纯战斗模拟：敌人/塔/投射物/遗物效果
│     ├─ render.js       # 渲染门面：画质/DPR/分层编排
│     ├─ render/         # 分层渲染器：背景/塔/敌人/弹道/特效/光晕/覆盖层
│     ├─ ui.js           # DOM：标题页、HUD、商店、弹窗
│     ├─ api.js          # fetch 封装
│     ├─ audio.js        # WebAudio 合成
│     └─ shared/
│        ├─ rng.js       # hash + mulberry32
│        ├─ config.js    # 可调数值（波次、经济、上限）
│        ├─ data.js      # 塔/敌人/遗物/解锁/难度
│        ├─ mapgen.js    # 种子地图生成
│        ├─ waves.js     # 种子波次生成
│        └─ scoring.js   # 分数/星核公式（前后端共用，服务端为准）
└─ tests/
   ├─ mapgen.test.mjs
   ├─ waves.test.mjs
   ├─ scoring.test.mjs
   ├─ api.test.mjs
   ├─ browser-smoke.sh
   └─ balance-sim.mjs    # 无头战斗模拟与难度探索
```

---

## 4. 共享规则模块

### 4.1 RNG

- `hashString(seed)` + `mulberry32`，纯 JS，Node/浏览器结果一致。
- `RNG` 提供 `float / int / range / pick / shuffle / weighted`。
- 种子命名规范：`${runSeed}:map`、`:decor`、`:wave:${n}`、`:relic:${wave}:${nonce}`、`:combat:${wave}`。

### 4.2 难度配置

```js
// shared/data.js（v1.4 平衡模拟定版）
export const DIFFICULTIES = {
  roam: {
    id: 'roam', name: '漫游', color: '#6fe0b0',
    hpMul: 0.85, countMul: 0.87, speedMul: 0.96,
    goldBonus: 60, hpBonus: 5,
    scoreMul: 0.80, coresMul: 0.80,
    desc: '熟悉机制与尝试流派',
  },
  standard: {
    id: 'standard', name: '远征', color: '#ffd36b',
    hpMul: 1.10, countMul: 1.04, speedMul: 1.01,
    goldBonus: 0, hpBonus: 0,
    scoreMul: 1.00, coresMul: 1.00,
    desc: '标准远征，设计基准',
  },
  abyss: {
    id: 'abyss', name: '深渊', color: '#ff6b8a',
    hpMul: 1.34, countMul: 1.12, speedMul: 1.05,
    goldBonus: -20, hpBonus: -3,
    scoreMul: 1.50, coresMul: 1.30,
    desc: '高压挑战，需要成熟构筑',
  },
};
```

- 数值为 **v1.4 定版**（40 种子 × 每种子 3 张候选地图），集中在配置对象里，便于平衡模拟批量扫描。
- 难度只影响参数，不改变 30 波结构。
- 每日挑战允许自选难度；排行榜合并，最终分数已包含难度倍率。

### 4.3 地图生成（路径图）

- 网格 22×12；每张地图由 1–3 条 lane 组成，每条 lane 从左侧入口出发，可共享汇流段/支路。
- 6 种原型：`canyon / twin / triple / ring / cross / switchback`；每种原型有 spawn 数、蜿蜒系数、分数倍率。
- 生成流程：选基地与汇流点 → 生成主路/支路 → 用带约束的随机 DFS 生成各入口到汇流点/基地的路径 → 校验长度差、可建造比例、路径不重叠 → 失败重试 140 次，最终兜底单径蛇形。
- 输出：
  ```js
  {
    archetype, modifier, meta: { portalCount, scoreMul, merge },
    lanes: [{ id, cells, polyline, length, color }],
    spawns: [{ id, c, r, x, y, color }],
    base, pathCells, buildable, blocked, rocks,
    // 兼容字段：polyline/spawn 指向第一条 lane
  }
  ```
- `generateMapCandidates(seed, 3)` 生成三张候选；同种子完全一致，至少包含一张单径/双径低复杂度地图。
- 8 个词缀：`rich / swift / mist / rift / armored / bounty / vista / surge`；`rift` 增加一个入口，`cross` 与 `rift` 组合会自动换词缀避免过度拥挤。
- 服务端与客户端使用同一生成器；服务端下发完整地图与 `meta`。

### 4.4 波次生成

```js
generateWave(seed, wave, difficulty, mapMeta) -> {
  index, groups[{type,count,interval,delay,portal}],
  hpMul, speedMul, reward, boss, totalCount,
  portals, modifierId
}
```

- 基础公式：`hpMul = 1.165^(wave-1) × 难度 hpMul × 词缀 hpMul`；`count` 规则不变。
- 数量预算：`4.5 + 1.05×wave`，第 10 波后每波额外 `+0.6`；单波上限 80。
- **入口计划**：前 5 波单入口；12 波后随机双入口；25 波后与首领/最终波使用全部入口。每个 group 分配 `portal`，客户端按 lane 生成敌人。
- 每 5 波首领；第 30 波为最终首领。首领基础 900 血 / 3 点漏怪伤害 / 5 护甲。
- 清波奖励 `20 + 3×wave`；击杀金币随波次小幅增长（0.5%/波）。
- 相同 `(seed, wave, difficulty, mapMeta)` 结果完全一致。
- 以上数值集中在 `shared/config.js`，由 `tests/balance-sim.mjs` 回归验证。

### 4.5 遗物等级与抽取

- 池：`RELICS`（60 件，稀有度权重 普通 58 / 稀有 30 / 史诗 12），每件最多 Ⅲ 级。
- 等级修正：基础 `mods` 为 Ⅰ 级，Ⅱ/Ⅲ 级按 `×1.6 / ×2.2` 缩放，并应用单件上限（`PER_RELIC_CAPS`）。多件汇总后再应用全局上限（`GLOBAL_MOD_CAPS`），攻速、连锁、溅射等有硬上限。
- 抽取：候选池包含未拥有与新遗物及未满级遗物；三件 ID 不重复；满级退出；候选不足用金币/修复补位。
- 种子：`${seed}:relic:${combo}:${nonce}`，`combo` 为已清波次，`nonce = 已刷新次数`。
- 服务端保存每波 `{ offers, picked }`；`pick` 按索引校验，`picked` 后拒绝二次选择与刷新。
- 兼容旧 `{ids:[...]}` 选项与旧遗物 ID 存档，统一归一化为 Ⅰ 级。
- 即时生命效果：获得/升级时只补发该等级相对上一等级新增的 `baseHp`。
- 套装：遗物可选 `set` 标签（`hunter` / `frost` / `guild` / `gambit` / `synergy` / `reserve`），档位在 `effects.js` 的 `RELIC_SET_BONUSES` 声明 2/4 件效果；`recomputeMods` 按不同遗物 ID 计件（升级不重复计入），追加档位后统一应用单件与全局上限。文案由效果注册表的 `effectText` 生成。
- 条件型效果：`effects.js` 的 `conditionSnapshot(sim)` 从本局状态提取只读快照（`hpRatio` / `gold` / `emptySlots`），`isLowHpState` / `isRichState` / `hasEmptySlots` 与各 `hitCondition` 都是纯函数；`sim.computeHit` 每次命中生成一次快照传给 `hitBonuses`，判定不读写随机数，固定种子的 RNG 顺序不变。阈值集中在 `CONDITION_THRESHOLDS`（低血 40% / 满金币 400 / 空位 8）。
- 塔的稳定属性在建造、升级、遗物变化时缓存；模拟步内不重建对象。

### 4.6 数值与伤害管线

集中定义在 `shared/data/`（`shared/data.js` 统一再导出）：

- 塔：8 种 × 3 级，字段 `dmg / rate / range / splash / slow / slowDur / dot / dotDur / chain / knockback / buffDmg / buffRate / support / cost`。
- 敌人：7 类，字段 `hp / speed / armor / gold / dmg / r / flying / heal / boss`。
- 遗物按等级聚合为全局修正 `mods`，在获得/升级时统一重算。

伤害计算顺序（固定）：

```
statsFor 缓存：基础伤害 × (1 + 塔专属加成 + 全局伤害加成)
→ computeHit：对首领加成 / 低血量加成 → 暴击（战斗种子 RNG）
→ damage：减速易伤 → 护甲减免（毒/电弧可无视或部分穿透）→ 扣血
```

- 塔专属/全局增伤**只在 statsFor 中应用一次**；computeHit 不再重复应用。
- 护甲：`max(1, dmg - armor × (1 - armorPierce))`。
- 面板显示 `statsFor().dmg`；对零护甲、无暴击、无条件增伤目标应与实际伤害完全一致。
- 减速取最强值，刷新持续时间；毒伤取最高 DPS，刷新持续时间。
- 敌人死亡金币：`round(gold × (1 + wave*0.005) × (1 + goldMul)) + killGold`。

---

## 5. 客户端运行时设计

### 5.1 状态机

```
标题页
  └─(选择难度/每日)→ 整备 prep
        ├─(开始下一波)→ 战斗 wave
        │     ├─清波→ 三选一 draft→ 整备
        │     ├─基地生命=0→ 失败结算 over
        │     └─清空第30波→ 胜利结算 over
        └─(退出)→ 放弃远征→ 标题页
```

- `sim.phase ∈ {prep, wave, over}`；`paused` 仅影响波内推进。
- 三选一弹窗期间 `paused = true`。
- 结算弹窗不可关闭，必须选择「再来一局」或「返回大厅」。

### 5.2 固定步长循环

- 模拟步长 `1/60s`；渲染跟随 `requestAnimationFrame`。
- 倍速：1× / 2× / 3×；暂停不推进模拟，但特效继续衰减。
- 单帧累积上限 24 步，防止切后台后爆炸。

### 5.3 输入与交互

- 点击塔卡进入建造模式；战场悬停显示射程与合法性；点击空地建造。
- 点击已有塔打开属性面板；`U` 升级、`S` 出售。
- `Esc`/右键取消；`空格` 暂停；数字键选塔。
- 建造成功后保持建造模式（便于连造），金币不足自动退出。

### 5.4 存档与续玩

- 仅在 `prep` 阶段写 localStorage 快照：难度、种子、金币、生命、塔、遗物、已清波次、击杀。
- 战斗中途不保存波内状态；刷新后回到该波开始前。
- 「继续上一局」流程：
  1. 读取快照 → `GET /api/runs/:id` 校验 `status=active`；
  2. 用种子重新生成地图；
  3. 恢复塔/金币/生命/遗物；
  4. 服务端波次计数以服务端为准，避免重复领奖。
- 服务端不可用时提示，不静默丢档。

### 5.5 渲染

- 地图静态层预渲染到离屏 Canvas（含草地、路径、箭头、岩石、装饰）。
- 动态层：传送门、水晶、塔、敌人、投射物、特效、飘字、建造预览。
- DPR 上限由画质设置决定（标准 1 / 高清 2）；Canvas 逻辑尺寸 1056×576，CSS 等比缩放。
- 实体上限：敌人 300、投射物 100、特效 320、飘字 90，超出丢弃最旧。
- 关闭 `imageSmoothingEnabled` 以外的复杂滤镜，避免低端机掉帧。
- 低配：减少草簇/碎石/箭头生成、关闭光晕与震动、只保留必要的攻击提示特效。

### 5.6 画质设置与运行时

- `settings.js` 提供低配/高配预设与自定义；存 `localStorage`，损坏或不可写回退默认低配。
- 帧率：30/60 只限制**绘制**频率；模拟固定步长仍按 60Hz 推进，3× 时每帧多步。
- 清晰度：DPR 1/2，切换时重设 Canvas 尺寸并重绘静态层。
- 装饰/飘字/光晕/震动：关闭时减少生成或绘制开销，而不是仅隐藏已有对象。
- 战斗中打开设置暂停；关闭/取消恢复原暂停状态；必选弹窗期间禁止打开。
- 页面隐藏时停止推进，返回时重置计时，不补算后台时间，且不改变手动暂停状态。
- `GameApp` 采集模拟/渲染/HUD 耗时、帧与渲染间隔、慢帧、实体数与堆信息，供动态性能测试读取。

### 5.7 移动端

- 视口：`viewport-fit=cover`、禁止缩放；游戏页使用 `100dvh` 与安全区内边距。
- 布局：横屏优先；HUD 单行紧凑、商店横向滚动、遗物面板改为 HUD 入口弹窗。
- 进入战斗（选择难度/继续/再来一局）时在用户手势内调用 `requestFullscreen` + `screen.orientation.lock('landscape')`；无法锁定时显示不可跳过的旋转提示与“重试自动横屏”。
- 触控：`pointerdown` 先显示射程预览，`click` 完成建造；触屏点位容错吸附到邻近可建造格/塔。
- iOS Safari 不支持网页强制旋转/全屏，作为平台限制记录，不承诺自动横屏。
- 画布 `touch-action:none`，商店 `pan-x`；移动端默认低配画质，但画质不参与模拟。

---

## 6. 服务端设计

### 6.1 数据模型

```sql
profiles(
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cores INTEGER NOT NULL DEFAULT 0,
  unlocks TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER, updated_at INTEGER
)

runs(
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  mode TEXT NOT NULL,              -- normal | daily
  difficulty TEXT NOT NULL,        -- roam | standard | abyss
  seed TEXT NOT NULL,
  day TEXT NOT NULL,               -- YYYY-MM-DD（UTC）
  waves_served INTEGER NOT NULL DEFAULT 0,   -- 最高已放行波次
  cleared_waves INTEGER NOT NULL DEFAULT 0,  -- 已确认清波数（进行中 < 已放行）
  map_choice INTEGER NOT NULL DEFAULT -1,    -- 三张候选地图中的选择；-1 未选择
  relics TEXT NOT NULL DEFAULT '[]',
  offers TEXT NOT NULL DEFAULT '{}',
  rerolls_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- active | finished | abandoned
  victory INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  wave_reached INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
)

leaderboard(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT, name TEXT,
  mode TEXT, difficulty TEXT, day TEXT, seed TEXT,
  wave INTEGER, score INTEGER, kills INTEGER,
  victory INTEGER, duration_ms INTEGER,
  created_at INTEGER
)
```

- `profiles.stats` JSON：
```json
{
  "runs": 0,
  "kills": 0,
  "wins": 0,
  "byDifficulty": {
    "roam":     { "bestWave": 0, "bestScore": 0, "wins": 0, "runs": 0 },
    "standard": { "bestWave": 0, "bestScore": 0, "wins": 0, "runs": 0 },
    "abyss":    { "bestWave": 0, "bestScore": 0, "wins": 0, "runs": 0 }
  }
}
```
- 迁移策略：`server/db/migrations/` 编号迁移 + checksum 校验；启动时按序执行，迁移前 `VACUUM INTO` 备份，失败拒绝启动。旧匿名令牌数据迁移为 `unclaimed` 账号，通过 `/api/auth/claim` 原地升级。
- 索引：`runs(token,status)`、`leaderboard(mode,score)`、`leaderboard(mode,day,score)`。
- 榜单口径：同一玩家在同一榜单（远征 / 某日每日）取最高分，不按难度拆榜；难度列仅用于展示标签。

### 6.2 接口契约

所有 `/api/*`（除 health）要求请求头 `x-player-token`，格式 `[A-Za-z0-9_-]{8,80}`。

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| POST | `/api/session` | `{name?}` | `{profile, dailyAttemptsLeft, daily}`（`daily = {day, seed, modifiers[], streak}`） |
| GET | `/api/profile` | — | `{profile}` |
| GET | `/api/profile/skins` | — | `{selected, skins[], sets[]}`；`sets` 为套装画廊（成员解锁态与收集进度，纯表现） |
| PUT | `/api/profile/skins` | `{tower?, enemy?}` | 同 GET；未解锁/错对象 403/400 |
| POST | `/api/runs` | `{mode, difficulty}` | 见下 |
| GET | `/api/runs/:id` | — | `{run}`（含 clearedWaves/wavesServed/inProgress/difficulty/relics 状态/maxRerolls） |
| POST | `/api/runs/:id/map` | `{index}` | `{map, mapMeta, mapChoice}`；开局前选择三张候选之一 |
| POST | `/api/runs/:id/wave` | `{}` | `{wave, replay, clearedWaves, wavesServed}`；有未清波次时重放当前波；未选地图 409 |
| POST | `/api/runs/:id/clear` | `{wave}` | `{ok, clearedWaves, wavesServed, nextWave, duplicate?}` |
| POST | `/api/runs/:id/relics` | `{reroll?:boolean}` | `{wave, offers[{kind,id,fromLevel,toLevel}|{kind,amount}], picked, relics, rerollsUsed, maxRerolls}` |
| POST | `/api/runs/:id/relic` | `{index}`（兼容 `{relicId}`） | `{applied, picked, relics}` |
| POST | `/api/runs/:id/finish` | `{waveReached, kills, goldLeft, baseHp}` | `{victory, score, coresEarned, totalCores, personalBest, rank, dailyAttemptsLeft}` |
| POST | `/api/runs/:id/abandon` | `{}` | `{ok:true}` |
| POST | `/api/unlock` | `{unlockId}` | `{profile}` |
| GET | `/api/leaderboard` | `?mode=normal|daily&day=` | `{mode, day, entries[]}`（条目含难度标签） |
| GET | `/api/health` | — | `{ok, uptime}` |

**开始远征返回**：

```json
{
  "runId": "…",
  "seed": "…",
  "mode": "normal",
  "difficulty": "standard",
  "day": "2026-10-22",
  "map": { "…": "完整地图对象" },
  "startingGold": 260,
  "baseHp": 20,
  "relics": [],
  "towersUnlocked": ["arrow", "cannon", "frost"],
  "maxRerolls": 1,
  "dailyAttemptsLeft": null,
  "daily": null,
  "difficultyConfig": { "…": "倍率与说明，UI 展示用" }
}
```

每日挑战（`mode=daily`）额外返回 `daily: {day, seed, modifiers[{id,name,desc,color}], streak}`；
服务端在开局时校验 `seed === daily-${day}` 且候选地图词缀与派生组合一致。

**结算校验**：

- `waveReached = clamp(int, 0, run.cleared_waves)`；进行中的波次不计入结算。
- `kills ≤ waveReached*600 + 50`；`goldLeft ≤ waveReached*1200 + 600`；`baseHp ≤ 120`。
- `victory = cleared_waves >= 30 && waveReached >= 30`；第 30 波中途死亡不算通关。
- 清波必须显式 `POST /clear`；未确认清波时再次请求波次会重放当前波，不推进、不重复发奖。
- 服务端按 `run.difficulty` 套用倍率；**不接受客户端传入难度、分数、胜利标记**。
- 时长由服务端 `finished_at - created_at` 计算，用于展示与同分排序。

### 6.3 结算公式（shared/scoring.js）

```js
rawScore =
  waveReached * 1000 +
  kills * 8 +
  Math.floor(goldLeft) * 2 +
  baseHp * 150 +
  (victory ? 10000 : 0);

score = Math.round(rawScore * difficulty.scoreMul * mapMeta.scoreMul);

cores = Math.round(
  (waveReached * 2 + Math.floor(rawScore / 2500) + (victory ? 15 : 0)) *
  difficulty.coresMul
);
```

- 前后端共用同一函数；客户端用本地值做结算预览，最终以服务端返回为准。
- 排行榜为**合并榜**：不按难度拆分，按最终分数降序，条目展示难度标签与通关标记。
- 每日榜按 `(mode=daily, day)` 过滤；远征榜过滤 `mode=normal`。
- 排名口径：同一玩家在同一榜单取最高分，再按分数降序；同分按 `duration_ms` 升序。

### 6.4 每日挑战

- 日期：`dayKey()` 取服务器本地时区（`YYYY-MM-DD`），`runs.day`、次数上限、榜单与种子统一使用该日期。
- 种子：`daily-${日期}`；玩家可自选 `difficulty`，不影响地图与波次组合（只影响倍率）。
- 词缀：`dailyChallenge(day)`（shared/scoring.js）以同一种子复用 `candidatePlan()` 的原型/词缀排列，
  取前三项作为当日词缀；开局时服务端校验候选地图词缀与派生组合一致，不一致返回 500。
- 连续参与：`dailyStreak(days, today)` 从今天（今天未参与则从昨天）向前统计连续日期；
  开局的每日远征即计入，与是否结算无关。
- 每次开始前检查当天已结算次数 < 3。
- 每日榜按 `(mode=daily, day)` 查询，合并三档难度，按最终分数排序并展示难度标签（结构不变）。

### 6.5 静态资源与安全

- 静态目录 `public/`，路径规范化并校验前缀，防目录穿越。
- 响应头：`nosniff`、`SAMEORIGIN`、`no-referrer`、CSP（`default-src 'self'; script-src 'self'`）。
- 所有 SQL 使用参数化；JSON body 上限 256KB；昵称去控制字符、≤16 字符；客户端渲染昵称使用转义。
- 令牌只是匿名标识，不是凭证；不做敏感数据存储。

---

## 7. 难度探索方法（先摸索）

不靠拍脑袋定三档数值，用**无头模拟**先跑出差异，再试玩校准。

### 7.1 模拟器

- `tests/balance-sim.mjs` 直接 import `sim.js` 与共享规则，在 Node 中跑真实战斗逻辑。
- 机器人策略（先固定一套，后续可换）：
  - 在路径旁按覆盖率排序选建造点；覆盖采样遍历所有 lane（含共享主路），不会漏掉多入口地图的任一路；
  - 前期弩塔 + 炮台，第 3 波前补霜塔；
  - 优先铺塔再升级，固定 18 塔上限；
  - 遗物按启发式权重选择（伤害 > 攻速 > 经济 > 控制）。
- 运行矩阵：3 难度 × 2 种解锁状态（零解锁 / 全解锁）× 40 个种子 × 每种子 3 张候选地图（=720 局）；候选地图与真人开局三选一使用同一生成器。
- 输出指标：
  - 通关率、平均到达波次、每波结束生命/金币/塔数；
  - 按地图原型、词缀、候选序号分别统计通关率/平均波次/生命/塔数；
  - 每波「需求 DPS」（敌总血量 / 波次时长）与「可用 DPS」曲线；
  - 单局时长估计（模拟步数 × 1/60）。

### 7.2 调参顺序

1. 先调**基准难度（远征）**：让机器人（代表中等水平）全解锁通关率落在 25%–35%。
2. 再调漫游：同一机器人全解锁通关率 80%–90%，前 10 波几乎无压力。
3. 最后调深渊：全解锁通关率 5%–15%，漏怪集中在中后期。
4. 零解锁口径单独报告，不作为三档目标；用它观察电弧/毒雾塔与初始加成的解锁价值。
5. 主要调 `DIFFICULTIES` 倍率；地图原型/词缀出现明显离群时，再调 `mapgen.js` 的 `scoreMul` 与词缀数值。最后微调经济与遗物强度，避免「无脑全造弩塔」或「某一件遗物必选」。

### 7.3 验收口径

- 机器人数据只用于**相对比较与回归**，绝对通关率以真人试玩为准。
- 每次数值改动后跑 `node tests/balance-sim.mjs 40 --write`，结果写入 `docs/BALANCE.md`（自动生成表格）。
- M4 前至少完成 3 轮「调参 → 模拟 → 试玩」循环。

### 7.4 v1.4 定版结果（40 种子 × 3 候选地图，机器人全解锁）

| 难度 | 通关率 | 平均已清波次 | 零解锁通关率 | 说明 |
|---|---|---|---|---|
| 漫游 | 87% | 29.8 | 76% | 新手与试流派 |
| 远征 | 32% | 26.3 | 18% | 基准挑战 |
| 深渊 | 7% | 20.5 | 1% | 需要成熟构筑 |

- 每个种子跑满 3 张候选地图，总体表按候选均匀加权，接近「玩家随机选图」的口径；标准档三张候选的通关率分别为 25% / 40% / 30%，只看 candidate 0 会得到不同结论。
- 地图原型差异明显（全解锁·远征）：单径峡谷 37%、双径汇流 48%、环形回廊 33%、三径裂隙 27%、交叉回廊 13%。交叉回廊需要二次分配火力，机器人尤其不擅长，因此 `scoreMul` 提到 1.10（双径汇流降到 0.97）作计分补偿；这是**机器人口径**下的偏差，真人可通过换塔/卖塔缩小差距。
- 词缀差异（全解锁·远征）：薄雾 28%、富矿 32%、疾风 34%、裂界 32%。疾风已从 +12% 移速/+15% 金币调整为 +14%/+12%，但在全解锁下仍略占优；零解锁下疾风反而更差（远征 14% vs 薄雾 22%），说明词缀排序依赖解锁状态，不能据此把某一词缀继续大幅削弱。
- 零解锁深渊只有 1%，仅用于体现解锁价值，不作为调参目标；零解锁漫游/远征为 76% / 18%。
- 伤害修复后重跑：机器人现在会在第 1 波前完成开局整备；此前数据存在「空手接第一波」偏差，已修正。
- 机器人的固定策略（18 塔上限、固定顺序、不卖塔/不针对性换塔）会放大种子与地图差异；同一套参数下，20 种子与 40 种子的结果可相差近 10 个百分点，因此定版以 40 种子为准。
- 调参中发现并修复：① 不同难度曾使用不同种子导致比较失真；② 难度过度集中在最终首领，通过「降低首领墙 + 后期数量加速」摊平；③ 遗物增伤重复计算，修复后整体重新定版；④ 平衡模拟曾只跑第一张候选地图，已改为每种子跑满 3 张并按原型/词缀拆分。

---

## 8. 测试策略

### 8.1 单元测试（`node --test`）

- 地图生成：路径连续、起终点在左右边缘、无重复格、非路径格不贴身、可建造比例 > 45%、同种子结果一致。
- 平衡机器人：塔位覆盖采样遍历所有 lane（含路径终点），避免多入口地图漏采样导致建塔位置偏差（`tests/maps.test.mjs`）。
- 波次生成：同种子一致、波次递增数量/血量单调、30 波存在最终首领、数量上限生效。
- 伤害管线（`tests/combat.test.mjs`）：面板与实际伤害一致、塔专属/全局增伤只应用一次、暴击/护甲/条件增伤/特殊塔。
- 遗物（`tests/reliquary.test.mjs`）：等级数值 25→40→55、升级/满级/补位、即时生命增量、全局上限、v2 旧档兼容。
- 设置（`tests/settings.test.mjs`）：默认低配、预设/自定义识别、非法值归一化、损坏/不可写存储回退。
- 结算：分数/星核公式、难度倍率、封顶钳制、按已清波次判定通关。

#### 8.1.1 本地快筛（`npm run test:changed`）

- 用途：按 `git diff --name-only <base>...HEAD` 的改动文件，经 `scripts/test-changed.mjs` 里的显式映射挑选相关测试，缩短本地 / worker 内环反馈时间。
- 映射规则集中在 `TEST_MAP`；`sim.js`、`public/js/shared/`、`server/index.mjs`、`package.json` 等共享文件直接回退全量；未覆盖映射的文件同样回退全量并打印原因。
- **门禁永远全量**：`npm test` 与 fan-in 的 `test_command` 保持不变；`test:changed` 只是本地快筛，不参与合并前判定。

### 8.2 接口测试（`tests/api.test.mjs`）

- 独立测试服务（临时 DB、随机端口）。
- 覆盖：会话 → 开局 → 波次 → 重放当前波 → 清波确认 → 抽遗物 → 选遗物 → 结算 → 排行榜；
- 异常：无令牌 401、他人远征 404、重复结算/重复选择/非法刷新 409、每日次数耗尽 429、非法难度 400、结算超已清波次被钳制、第 30 波途中死亡不算通关。

### 8.3 浏览器测试（隔离服务端 + 独立浏览器配置）

- `tests/browser-smoke.mjs`：选难度 → 建塔 → 开波，采集页面错误。
- `tests/browser-flow.mjs`：波中刷新重放、遗物选择中刷新恢复、带遗物续玩、退出、排行榜/商店、失败结算。
- `tests/browser-settings.mjs`：默认低配、预设应用/持久化、局内暂停恢复、必选弹窗保护、损坏存储回退。
- `tests/browser-relics.mjs`：Ⅰ→Ⅱ 展示、升级生效、补位奖励展示与应用。
- `tests/browser-mobile.mjs`：390×844 竖屏、844×390 横屏、旋转提示、无溢出/遮挡、触控建塔、设置与遗物弹窗。
- 所有浏览器测试均启动自己的临时服务与临时 Chrome profile，不读写线上数据库。

### 8.4 动态性能测试（`tests/dynamic-perf.mjs`）

- 固定种子、固定塔布局/遗物、真实战斗运行；覆盖正常战斗、后期 18 塔 3×、超规模敌人注入、低/高/自定义画质。
- 记录模拟/渲染/HUD 耗时、帧间隔 P95/P99、>50ms 慢帧、实体数与堆趋势；验证 30FPS 只限制绘制。
- 同种子、同操作、同模拟步数下，不同画质战斗状态哈希必须一致。
- 结果写入 `docs/PERFORMANCE.md`；无头软件渲染数据仅用于相对回归。

### 8.5 手动验收清单

- 三档难度均能开局、通关/失败结算、上榜；
- 每日挑战同一天不同浏览器得到相同地图/波次/遗物；
- 刷新续玩不跳波、不重复领奖；
- 画质切换不影响战斗结果；后台返回不补算；
- 无控制台报错。

---

## 9. 部署

- 启动：`npm start`（`node --no-warnings server/index.mjs`），监听 `0.0.0.0:8787`。
- 环境变量：`PORT`、`HOST`、`DB_PATH`（默认 `server/data/game.db`）。
- systemd 单元：
  - `WorkingDirectory=/home/wenjin/rogue-td`
  - `ExecStart=/usr/bin/node --no-warnings server/index.mjs`
  - `Restart=on-failure`
  - `Environment=NODE_ENV=production`
- 备份：每日复制 `game.db`（WAL 模式需 `sqlite3 .backup` 或停服复制）。
- 可选公网：Cloudflare Tunnel 指向 `localhost:8787`；首版默认不暴露。
- 日志：stdout/stderr → journald；请求错误打印方法、路径、错误栈。

---

## 10. 与现有原型的差异 / 改造清单

以下改造已在 v1.3 完成；保留对照用于回溯设计取舍：

| 模块 | 原型现状 | 目标 |
|---|---|---|
| 波数 | 60 波无尽 | 30 波固定通关，胜利判定 |
| 难度 | 无 | 三档 `DIFFICULTIES`，服务端记录与分榜 |
| 引擎 | `engine.js` 直接 import Renderer/audio | 拆为 `sim.js`（纯逻辑）+ `game-app.js`（循环/渲染/音效） |
| 结算 | 无尽分数 | 难度倍率 + 通关奖励 + 时长 |
| 数据库 | 无 difficulty/victory/duration | 迁移补列，排行榜分难度 |
| UI | 无 index.html/styles.css | 完整标题页/游戏页/弹窗 |
| 平衡 | 拍脑袋数值 | 模拟器驱动，`docs/BALANCE.md` 记录 |
| 测试 | 无 | 单元 + 接口 + 冒烟 + 模拟 |

复用：RNG、地图生成、波次主体、渲染器骨架、音效合成、API 封装思路。
重写/重构：引擎拆分、结算与验证、难度、UI、数据库迁移、测试。

---

## 11. 里程碑执行计划

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| M2 可玩纵切 | 拆分 sim/app；HTML/CSS；30 波流程；三选一；胜负结算（先本地） | 手玩能完整走完一局，三档都能开局 |
| M2.5 平衡探索 | 模拟器 + 机器人；跑出三档差异；产出 `BALANCE.md` v1 | 三档通关率相对关系符合预期 |
| M3 在线功能 | SQLite 迁移；接口联调；星核商店；排行榜；每日挑战；续玩 | 接口测试全绿，刷新续玩可用 |
| M4 打磨 | 音效、粒子、飘字、屏震、数值终调、性能优化 | 60fps，三档体感明确，无阻断性 bug |
| M5 部署 | systemd、备份、局域网验收、可选隧道 | 重启自恢复，数据不丢 |

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 无构建链路导致运行时错误发现晚 | 白屏/卡死 | 每个模块 `node --check`；冒烟测试纳入每次改动 |
| 零依赖下无框架，UI 代码量偏大 | 开发慢 | DOM 结构集中、组件方法化；不为小功能引入抽象层 |
| 战斗模拟与渲染耦合复发 | 无法平衡模拟 | 把「sim 不 import DOM」写成硬约束，测试中直接 import |
| 数值平衡靠感觉 | 三档体验糊在一起 | 模拟器矩阵 + 机器人指标 + 真人试玩三轮 |
| 排行榜作弊 | 小圈子体验 | 服务端钳制 + 波次放行校验；不追求强反作弊 |
| npm 不可达 | 无法加依赖 | 保持零依赖；确需依赖时先修代理/镜像 |
| 固定机器人对种子/地图敏感 | 平衡结论偏差 | 40 种子定版、公开口径与固定策略；真人试玩校准 |
| 遗物升级导致数值失控/计算量上升 | 卡顿或必选 | 等级上限、单件/全局上限；塔属性缓存；模拟回归 |
| 清波确认失败导致重复领奖 | 存档不一致 | 清波幂等、波前快照保护、重放当前波 |
| 画质设置改变战斗结果 | 不公平/不可复现 | 设置只进渲染与特效生成；固定步长模拟；画质一致性哈希测试 |

---

## 13. 评审结论与剩余风险

**已确认**：
1. 难度命名：漫游 / 远征 / 深渊。
2. 每日挑战：开局自选难度。
3. 排行榜：合并榜，按最终分数排序，展示难度标签。
4. 第 30 波清空：直接胜利结算。

**已知风险**：
- 合并榜下，深渊的 1.5× 分数倍率可能导致高难度成绩主导榜单。首版接受此设定；M4 平衡时若发现倍率失衡，只调 `scoreMul`，不改榜单结构。
- 每日挑战同种子但不同难度，敌人强度不同；榜单以最终分数比较，需在 UI 中明确展示难度标签，避免误解。

---

## 14. v2.0 系统设计（成就 / 生涯统计 / 音乐 / 可访问性）

本节只写新增决策。既有数据模型与接口见第 6 节，客户端运行时见第 5 节；不重复抄录。

### 14.1 成就系统

**数据模型**（迁移 `0002_achievements`，已存在）：

```sql
account_achievements(
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, achievement_id)
)
```

- **定义单一来源**：`public/js/shared/achievements.js` 导出 `ACHIEVEMENTS`（`id/title/desc/condition/group/rarity/hidden/target/progress/check`）、分组表 `ACHIEVEMENT_GROUPS`（通关 / 构筑 / 挑战 / 收集）、稀有度表 `ACHIEVEMENT_RARITIES`（common / rare / epic）与纯函数 `evaluateAchievements(ctx)`；服务端判定，客户端只读取展示。
- **判定上下文**：`run`（本局结算：mode/difficulty/victory/waveReached/kills/score/durationMs/relics）、`stats`（结算后的生涯统计）、`dailyRuns` / `dailyWins`、`unlocked`（已解锁集合，供组合成就使用）。
- **落库时序**：`POST /api/runs/:id/finish` 在同一结算流程内先更新 `player_stats`，再调用 `unlockAchievements`，保证成就看到的是「本局已计入」的统计。
- **幂等**：主键 + `INSERT OR IGNORE`，重复结算不会重复解锁或重复发奖。
- **进度模型**：带 `target` 的成就额外提供 `progress(ctx)`，判定统一为 `progress(ctx) >= target`；`achievementProgress()` 返回 `{current, target}` 并封顶到 target。摘要接口用 `careerStats()` + 每日挑战统计重建只读上下文（`run` 为空），已解锁成就的进度直接显示为完成。
- **接口**：`GET /api/achievements` 返回 `{total, unlockedCount, groups[], achievements[], seasonal, seasonalHistory[]}`；每项含 `id/title/desc/condition/group/groupName/rarity/rarityName/hidden/unlocked/unlockedAt/progress`。未解锁的隐藏成就只返回 `title: "???"`、`desc: ""`、`condition: "???"`、`progress: null`，真实描述不下发；结算响应可附带本次新增成就用于即时提示。`seasonal` 为 `{season, endsAt, daysLeft, ended, total, unlockedCount, achievements[]}`：赛季成就条目与普通成就同构（`group: "season"`），`endsAt/daysLeft/ended` 由服务端按赛季月末边界计算，客户端据此显示剩余天数与赛季结束状态。
- **通知**：解锁成就时写入通知中心（`kind: "achievement"`）；赛季成就条目附带 `seasonal: true` / `season`，客户端据此使用「赛季成就」样式。通知写入遵循用户偏好，关闭「成就通知」后只停止新增未读，不影响成就解锁本身。
- **扩展规则**：新增成就只加定义与（必要时）判定上下文字段，不改表；累计/组合类成就必须基于服务端统计判定，禁止客户端上报解锁。
- **验收**：`node --test tests/achievements.test.mjs tests/achievements-depth.test.mjs`（AC-102）。

### 14.2 生涯统计聚合口径

**存储**：`player_stats(account_id, stat_key, scope_key, value_num, updated_at)`；`scope_key` 为空串表示全局，`difficulty:<id>` 表示分难度。

| 口径 | 键 | 聚合方式 |
|---|---|---|
| 全局 | `runs` | 已结算且未放弃的对局数 |
| 全局 | `wins` | `victory = 1` 的对局数 |
| 全局 | `kills` | 结算被服务端接受的击杀数累计 |
| 分难度 | `runs` / `wins` | 同上，按 `roam / standard / abyss` 分别累计 |
| 分难度 | `best_wave` / `best_score` | 历史最大值，单调不减 |

- **计入范围**：每日挑战与远征同样计入生涯统计与成就；`abandoned` 对局不计入 `runs / wins / kills`，也不刷新 `best_*`。
- **写入时机**：只在对局结算（finish）时聚合，不逐波累加；统计更新与成就判定处于同一结算事务，失败一起回滚。
- **接口**：`GET /api/profile` 内已含 `stats`；新增只读快照 `GET /api/stats`，返回同一口径（含按难度分组），不引入第二套计算。
- **展示**：总局数、通关率、最高波次、最常用塔/遗物；其中「最常用塔/遗物」从历史对局派生，属于展示层聚合，不写入 `player_stats` 主键。
- **验收**：`node --test tests/stats.test.mjs`（AC-103），覆盖胜利 / 失败 / 放弃三类，并验证 `best_*` 单调性与分难度口径。

### 14.3 音乐系统结构

- **依赖边界**：纯 WebAudio 合成，无音频素材、无第三方依赖，不参与战斗判定。
- **结构**：`AudioFX` 单例（`public/js/audio.js`）。`MUSIC_TRACKS` 按情绪分轨（`menu / battle / boss`），每轨 = 和弦进行 + 振荡器音色 + 和弦时值；`scheduleMusicStep()` 用定时器逐和弦调度，振荡器 + 包络合成，循环播放。
- **音量通道**：音效走 master 增益，音乐走独立 `musicGain`（默认明显低于音效）；`sound` 与 `music` 两个设置项相互独立。
- **生命周期**：`startMusic(mood)` / `stopMusic()`；页面隐藏时暂停、回到前台续播；用户手势前不创建 `AudioContext`；音效与音乐都关闭时不创建上下文。
- **扩展约束**：新增曲目只加 `MUSIC_TRACKS` 数据；曲目切换不得阻塞主循环，也不得触发 `sim.js` 的任何随机调用。
- **验收**：`tests/audio-events.test.mjs` 与 `tests/music.test.mjs`（AC-105）。

### 14.4 可访问性基线

- **动效**：尊重 `prefers-reduced-motion`，关闭屏幕震动、粒子与光晕等装饰动画；战斗模拟、波次与计分完全不变。
- **键盘**：所有可交互控件可 Tab 到达，焦点样式可见且不被全局 `outline: none` 覆盖；弹窗打开后焦点进入并限制在弹窗内，Esc 可关闭。
- **语义**：弹窗使用 `role="dialog" aria-modal="true"` + `aria-labelledby`；控件组（如速度）使用 `role="group"` + `aria-label`；动态提示使用 `aria-live="polite"`；纯装饰元素标 `aria-hidden="true"`。
- **对比与信息传达**：正文对比度达到 WCAG AA（≥4.5:1），关键数值可读；状态不只靠颜色区分。
- **边界**：可访问性只改 DOM、样式与动画开关，不进入 `sim.js`，不改变伤害、敌人数、攻速、掉落或计分。
- **验收**：`node --test tests/a11y-baseline.test.mjs`（AC-104），至少覆盖 reduced-motion 开关、键盘焦点可见性与关键弹窗语义。

### 14.5 硬约束（v1.8–v2.0 全程）

1. **零依赖**：不引入第三方运行时/前端依赖，不引入构建链；优先使用 Node 与浏览器内置能力。
2. **模拟确定性**：`sim.js` 的 RNG 调用顺序不可改变；新增内容不得插入、删除或重排既有随机调用，平衡结果必须能用固定种子复现。
3. **表现与模拟解耦**：音乐、可访问性、UI 与特效只作用于表现层，任何情况下都不得改变战斗结果。
4. **数值纪律**：未经过平衡模拟（`npm run balance` / `npm run sweep`，40 种子 × 3 候选地图）定版的新塔/敌人/遗物数值，在文档中一律标注「待平衡模拟校准」，不写未评估的数值承诺。
