# 《渊塔守卫》技术设计文档 v0.1

- 状态：**已评审**（2026-10-22）
- 对应需求：`docs/PRD.md` v1.2
- 目标：确定架构、模块边界、接口契约、数据模型、难度探索方法与测试策略，作为 M2–M5 的实现依据。
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
│  main.js（编排/输入/存档）                                      │
│    ├─ ui.js         DOM：HUD、商店、弹窗、排行榜                │
│    ├─ game-app.js   rAF 循环、渲染、音效、HUD 节流              │
│    ├─ sim.js        纯战斗模拟（无 DOM）                        │
│    ├─ render.js     Canvas 绘制（只读 sim 状态）                │
│    ├─ audio.js      WebAudio 合成音效                           │
│    └─ shared/       RNG、地图、波次、数值、难度、遗物           │
└───────────────┬─────────────────────────────────────────────────┘
                │ REST（JSON + x-player-token）
┌───────────────▼─────────────────────────────────────────────────┐
│  Node http server                                               │
│    ├─ 路由/鉴权/输入校验                                        │
│    ├─ 规则：地图生成、波次生成、遗物抽取、结算校验              │
│    ├─ shared/ 同一份纯逻辑（与浏览器完全一致）                  │
│    └─ SQLite：profiles / runs / leaderboard                     │
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
│  ├─ index.mjs          # HTTP 服务、路由、静态资源
│  ├─ api.mjs            # 业务接口（可选拆分）
│  ├─ db.mjs             # SQLite 连接、建表/迁移、查询封装
│  └─ data/game.db       # 运行时生成
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ js/
│     ├─ main.js         # 页面编排、事件、存档/续玩
│     ├─ game-app.js     # 固定步长循环、渲染调度、HUD 节流
│     ├─ sim.js          # 纯战斗模拟：敌人/塔/投射物/遗物效果
│     ├─ render.js       # Canvas：地图预渲染、单位、特效
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
// shared/data.js（M2 平衡模拟定版 v1）
export const DIFFICULTIES = {
  roam: {
    id: 'roam', name: '漫游', color: '#6fe0b0',
    hpMul: 0.94, countMul: 0.94, speedMul: 0.99,
    goldBonus: 60, hpBonus: 5,
    scoreMul: 0.80, coresMul: 0.80,
    desc: '熟悉机制与尝试流派',
  },
  standard: {
    id: 'standard', name: '远征', color: '#ffd36b',
    hpMul: 1.08, countMul: 1.04, speedMul: 1.02,
    goldBonus: 0, hpBonus: 0,
    scoreMul: 1.00, coresMul: 1.00,
    desc: '标准远征，设计基准',
  },
  abyss: {
    id: 'abyss', name: '深渊', color: '#ff6b8a',
    hpMul: 1.18, countMul: 1.08, speedMul: 1.03,
    goldBonus: -20, hpBonus: -3,
    scoreMul: 1.50, coresMul: 1.30,
    desc: '高压挑战，需要成熟构筑',
  },
};
```

- 数值为 **v0 假设**，集中在配置对象里，便于平衡模拟批量扫描。
- 难度只影响参数，不改变 30 波结构。
- 每日挑战允许自选难度；排行榜合并，最终分数已包含难度倍率。

### 4.3 地图生成

- 网格 22×12；随机 DFS 从 `(0, startRow)` 到任意 `col=21` 的格子。
- 约束：路径格不可重复；新格不得与已有路径正交相邻（当前格除外）；失败重试 80 次，兜底蛇形路径。
- 简化共线点；输出：
  - `polyline`（格中心，tile 坐标）
  - `pathCells`
  - `buildable[r][c]`
  - `blocked[r][c]` 与 `rocks`
  - `spawn` / `base`
- 服务端与客户端使用同一函数；服务端下发完整地图对象。

### 4.4 波次生成

```js
generateWave(seed, wave, difficulty) -> {
  index, groups[{type,count,interval,delay}], hpMul, speedMul, reward, boss, totalCount
}
```

- 基础公式：`hpMul = 1.168^(wave-1) × 难度 hpMul`；`count = round(baseCount × 类型系数 × 难度 countMul)`。
- 数量预算：`4.5 + 1.05×wave`，第 10 波后每波额外 `+1.2`；单波上限 80。
- 每 5 波首领；第 30 波为最终首领。首领基础 900 血 / 3 点漏怪伤害 / 5 护甲，避免单点墙。
- 清波奖励 `15 + 2×wave`；击杀金币随波次小幅增长（0.4%/波）。
- 相同 `(seed, wave, difficulty)` 结果完全一致。
- 以上数值集中在 `shared/config.js`，由 `tests/balance-sim.mjs` 回归验证。

### 4.5 遗物抽取

- 池：`RELICS`（约 22 件，稀有度权重 普通 58 / 稀有 30 / 史诗 12）。
- 已拥有遗物不再出现；抽 3 件不重复。
- 种子：`${seed}:relic:${wave}:${nonce}`，`nonce = 已刷新次数`。
- 服务端保存每波已下发选项；`pick` 必须命中已下发列表。

### 4.6 数值与伤害管线

集中定义在 `shared/data.js`：

- 塔：5 种 × 3 级，字段 `dmg / rate / range / splash / slow / slowDur / dot / dotDur / chain / cost`。
- 敌人：7 类，字段 `hp / speed / armor / gold / dmg / r / flying / heal / boss`。
- 遗物效果统一为 `mods` 对象，由 sim 聚合为全局修正。

伤害计算顺序（固定）：

```
基础伤害
→ 塔类型加成 + 全局伤害加成
→ 对首领加成 / 低血量加成
→ 暴击（战斗种子 RNG）
→ 减速易伤
→ 护甲减免（毒/电弧可无视或部分穿透）
→ 扣血
```

- 护甲：`max(1, dmg - armor × (1 - armorPierce))`。
- 减速取最强值，刷新持续时间；毒伤取最高 DPS，刷新持续时间。
- 敌人死亡金币：`round(gold × (1 + wave*0.02) × (1 + goldMul)) + killGold`。

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
- DPR 上限 2；Canvas 逻辑尺寸 1056×576，CSS 等比缩放。
- 实体上限：敌人 300、投射物 100、特效 320、飘字 90，超出丢弃最旧。
- 关闭 `imageSmoothingEnabled` 以外的复杂滤镜，避免低端机掉帧。

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
  waves_served INTEGER NOT NULL DEFAULT 0,
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
- 迁移策略：启动时 `CREATE TABLE IF NOT EXISTS`；对原型库用 `PRAGMA table_info` 检查并 `ALTER TABLE ADD COLUMN` 补齐新增列。
- 索引：`runs(token,status)`、`leaderboard(mode,score)`、`leaderboard(mode,day,score)`。
- 榜单口径：同一玩家在同一榜单（远征 / 某日每日）取最高分，不按难度拆榜；难度列仅用于展示标签。

### 6.2 接口契约

所有 `/api/*`（除 health）要求请求头 `x-player-token`，格式 `[A-Za-z0-9_-]{8,80}`。

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| POST | `/api/session` | `{name?}` | `{profile, dailyAttemptsLeft}` |
| GET | `/api/profile` | — | `{profile}` |
| POST | `/api/runs` | `{mode, difficulty}` | 见下 |
| GET | `/api/runs/:id` | — | `{run}`（含 status/wavesServed/difficulty/relics/maxRerolls） |
| POST | `/api/runs/:id/wave` | `{}` | `{wave}` |
| POST | `/api/runs/:id/relics` | `{reroll?:boolean}` | `{wave, offers, rerollsUsed, maxRerolls}` |
| POST | `/api/runs/:id/relic` | `{relicId}` | `{relic, relics}` |
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
  "difficultyConfig": { "…": "倍率与说明，UI 展示用" }
}
```

**结算校验**：

- `waveReached = clamp(int, 0, run.waves_served)`。
- `kills ≤ waveReached*600 + 50`；`goldLeft ≤ waveReached*1200 + 600`；`baseHp ≤ 120`。
- `victory = run.waves_served >= 30 && waveReached >= 30`。
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

score = Math.round(rawScore * difficulty.scoreMul);

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

- 种子：`daily-${UTC 日期}`；玩家可自选 `difficulty`，不影响地图与波次组合（只影响倍率）。
- 每次开始前检查当天已结算次数 < 3。
- 每日榜按 `(mode=daily, day)` 查询，合并三档难度，按最终分数排序并展示难度标签。

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
  - 在路径旁按覆盖率排序选建造点；
  - 前期弩塔 + 炮台，第 3 波前补霜塔；
  - 优先升级高频塔；预留 25 金币用于遗物刷新；
  - 遗物按启发式权重选择（伤害 > 攻速 > 经济 > 控制）。
- 运行矩阵：3 难度 × 2 种解锁状态（零解锁 / 全解锁）× 10 个种子。
- 输出指标：
  - 通关率、平均到达波次、每波结束生命/金币/塔数；
  - 每波「需求 DPS」（敌总血量 / 波次时长）与「可用 DPS」曲线；
  - 单局时长估计（模拟步数 × 1/60）。

### 7.2 调参顺序

1. 先调**基准难度（远征）**：让机器人（代表中等水平）通关率落在 30%–40%。
2. 再调漫游：同一机器人通关率 60%–70%，前 10 波几乎无压力。
3. 最后调深渊：通关率 5%–15%，漏怪集中在中后期。
4. 最后微调经济（金币产出/塔价）与遗物强度，避免「无脑全造弩塔」或「某一件遗物必选」。

### 7.3 验收口径

- 机器人数据只用于**相对比较与回归**，绝对通关率以真人试玩为准。
- 每次数值改动后跑 `node tests/balance-sim.mjs`，结果写入 `docs/BALANCE.md`（自动生成表格）。
- M4 前至少完成 3 轮「调参 → 模拟 → 试玩」循环。

### 7.4 M2 定版结果（20 种子，机器人全解锁）

| 难度 | 通关率 | 平均已清波次 | 说明 |
|---|---|---|---|
| 漫游 | 85% | 29.7 | 新手与试流派 |
| 远征 | 45% | 28.9 | 基准挑战 |
| 深渊 | 10% | 25.7 | 需要成熟构筑 |

- 零解锁远征约 5%、深渊 0%：解锁电弧/毒雾塔与初始加成是跨过中后期门槛的关键。
- 调参过程中发现并修复了两个结构问题：① 不同难度曾使用不同种子，导致比较失真；② 难度过度集中在最终首领，已通过「降低首领墙 + 后期数量加速」摊平。

---

## 8. 测试策略

### 8.1 单元测试（`node --test`）

- 地图生成：路径连续、起终点在左右边缘、无重复格、非路径格不贴身、可建造比例 > 45%、同种子结果一致。
- 波次生成：同种子一致、波次递增数量/血量单调、30 波存在最终首领、数量上限生效。
- 遗物抽取：三件不重复、排除已拥有、刷新后选项变化。
- 结算：分数/星核公式、难度倍率、封顶钳制、通关判定。
- 伤害管线：护甲、暴击、减速易伤、毒伤刷新。

### 8.2 接口测试

- 启动独立测试服务（临时 DB、随机端口）。
- 覆盖：新玩家会话 → 开局 → 取波次 → 抽遗物 → 选遗物 → 结算 → 排行榜；
- 异常：无令牌 401、他人远征 404、重复结算 409、每日次数耗尽 429、非法难度 400、结算超放行波次被钳制。

### 8.3 浏览器冒烟

- 无头 Chrome 加载页面、执行一局的最小交互（开局 → 建塔 → 开始波次），截图；
- 把 `window.onerror` / `unhandledrejection` 写入页面隐藏节点，用 `--dump-dom` 检查是否为空；
- 检查关键元素存在：Canvas 尺寸、商店 5 张卡、HUD 数值。

### 8.4 手动验收清单

- 三档难度均能开局、通关/失败结算、上榜；
- 每日挑战同一天不同浏览器得到相同地图/波次/遗物；
- 刷新续玩恢复正确；
- 60fps 基准场景；无控制台报错。

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

现有原型（未验收）保留作为参考，M2 按本设计改造：

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
