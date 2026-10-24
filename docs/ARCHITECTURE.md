# 架构总览

> 读者：第一次进入仓库的贡献者、接手项目的 AI 会话。
>
> 定位：这是一张**地图**，不是规范正本。它回答四个问题——系统分成哪些层、一次远征的数据怎么流动、哪些约束不能破、改完之后要跑什么。
>
> 正本与冲突处理：
> - 运行时行为与接口契约：`docs/TECH_DESIGN.md`
> - 需求与玩法口径：`docs/PRD.md`
> - 中英文用词：`docs/GLOSSARY.md`
> - 协作方式与提交规范：`CLAUDE.md`、`CONTRIBUTING.md`
>
> 本文与正本或代码冲突时，以正本和代码为准，并顺手修正本文。本文**不复制**塔/遗物/敌人数量、数值表、接口字段全表这类易过期内容，只给入口。

---

## 0. 术语速查

| 术语 | 含义 |
|---|---|
| 正本 | 某个主题的唯一权威文档；本仓库的规则正本是 `docs/PRD.md` 与 `docs/TECH_DESIGN.md` |
| shared / sim / app | 三个前端分层：共享纯逻辑 / 战斗模拟 / 页面编排，详见第 1 节 |
| 包络校验 | 服务端只检查上报值的合理范围（不逐帧验证），防止明显越界与重复领奖 |
| RNG | Random Number Generator，带种子的随机数生成器；同种子必得同结果 |
| 快照 | 客户端在整备阶段写入 localStorage 的存档；服务端数据库才是持久权威 |
| DPR | Device Pixel Ratio，设备像素比；画质设置会影响它，但不影响模拟 |
| fan-in | quay 在任务完成后把分支合并回 `develop` 并跑全量门禁的机械流程 |
| worktree | 与主检出分离的任务工作目录，见 `CONTRIBUTING.md` 的 quay 小节 |

---

## 1. 运行时分层

| 层 | 位置 | 运行环境 | 职责 | 不要做 |
|---|---|---|---|---|
| 共享规则 shared | `public/js/shared/` | 浏览器 + Node 服务端 + 测试 | 纯数据与纯函数：RNG、地图、波次、数值、效果、事件、计分、快照、成就、i18n | 不碰 DOM / Canvas / 网络 / 数据库 / 进程状态 |
| 战斗模拟 sim | `public/js/sim.js` | 浏览器 + Node 测试与平衡模拟 | 确定性战斗：塔、敌人、投射物、技能、波内状态机 | 不碰 DOM / Canvas / 音频 / 网络 |
| 应用编排 app | `public/js/app/`、`public/js/main.js` | 浏览器 | 页面入口与控制器：开局、波次、输入、会话、本地存档 | 不直接绘制、不写 SQL、不实现战斗规则 |
| 呈现层 | `public/js/ui.js`、`public/js/render.js`、`public/js/render/`、`public/js/audio.js`、`public/js/*-ui.js` | 浏览器 | DOM HUD 与弹窗、Canvas 分层渲染、WebAudio 合成 | 渲染只读模拟状态，不得反向修改 sim |
| 浏览器运行时 | `public/js/game-app.js` | 浏览器 | 固定步长推进、rAF 渲染、HUD 节流、性能采样、后台暂停 | 不改规则，不做持久化决策 |
| HTTP 层 | `server/index.mjs`、`server/http/`、`server/routes/` | Node | 监听、静态资源、路由、登录门禁、请求校验 | 路由不内联 SQL；单文件保持薄 |
| 领域服务 | `server/services/` | Node | 远征状态迁移、结算编排、响应序列化 | 不直接 prepare / exec SQL |
| 持久化 | `server/db/`、`server/db/migrations/`、`server/db.mjs` | Node | SQLite 连接、仓储、版本化迁移、旧档案兼容 | 不承载 HTTP 语义 |
| 认证 | `server/auth/` | Node | 会话 Cookie、密码、限流、身份解析 | 不参与游戏规则 |

### 1.1 依赖方向

下图省略了 `public/js/` 前缀：

```
shared/  ←  sim.js  ←  app/  ←  main.js / game-app.js
        ↑              ↑          │
        │              │          └──→ render.js、ui.js、audio.js（读 sim 状态）
        └────────── server/ ──────→ routes/ → services/ → db/ → shared/data
```

硬约束：

- `public/js/shared/` 是最底层，不得反向 import 任何上层模块。
- `public/js/sim.js` 不得 import `public/js/app/`、`public/js/render/`、`public/js/ui.js`、`server/`，也不得出现 DOM / Canvas / 网络调用。
- 任何影响胜负、金币、生命、掉落的计算都必须在 `public/js/shared/` 或 `public/js/sim.js`；渲染层只负责表现。
- `server/routes/` 不内联 SQL、不直接操作数据库；SQL 收敛在 `server/db/` 的仓储，状态迁移收敛在 `server/services/run-service.mjs`。`tests/architecture.test.mjs` 会挡住这条边界。
- 没有构建步骤：浏览器直接加载 ESM，服务端直接运行 `.mjs`。代价是缺少类型检查，用测试与代码评审补足。

### 1.2 权威边界

- **服务端权威**：地图、波次、遗物三选一、每日种子、结算分数与星核、排行榜。客户端不能自选已放行波次或抽卡结果。
- **客户端权威**：波内实时战斗。服务端不逐帧校验，只做包络校验。
- 细节见 `docs/TECH_DESIGN.md` 第 2.1 节。

---

## 2. 数据流：开局 → 波次 → 结算 → 持久化

```
浏览器                                          服务端
────────────────────────────────────────────────────────────────────────────
ui.js / app/controller.js
  │ POST /api/runs
  ├──────────────────────────────────────────→ server/routes/runs.mjs
  │                                              └→ services/run-service.mjs
  │                                                   ├→ shared/mapgen 生成候选地图
  │                                                   └→ db/runs.mjs 落库
  │← runId / seed / 候选地图 ────────────────────┘
  │ POST /api/runs/:id/map {index}
  ├──────────────────────────────────────────→ 记录 map_choice
  │ Simulation(seed, map) 本地开局
  │ POST /api/runs/:id/wave
  ├──────────────────────────────────────────→ 记录 waves_served
  │← 当前波参数（shared/waves 由种子生成）───────┘
  │ 60Hz 本地模拟 → 清波
  │ POST /api/runs/:id/clear {wave}
  ├──────────────────────────────────────────→ 记录 cleared_waves
  │ POST /api/runs/:id/relics → /relic
  ├──────────────────────────────────────────→ 服务端抽三选一并应用、落库
  │ POST /api/runs/:id/finish
  ├──────────────────────────────────────────→ 包络校验 → shared/scoring 计分
  │                                              └→ runs / profiles / leaderboard
  │← victory / score / cores ───────────────────┘       / 成就 / 技能
```

### 2.1 开局

1. 标题页由 `public/js/app/controller.js` 装配，`public/js/app/run.js` 的 `RunController` 负责开局。
2. `public/js/api.js` 封装请求：会话走 HttpOnly Cookie，旧的匿名令牌只用于绑定老账号。
3. `POST /api/runs` 在服务端生成种子、候选地图与难度配置；响应携带 `runId`、`seed`、`map` 等。
4. 玩家从候选地图中选一张（`POST /api/runs/:id/map`），客户端用同一种子重建地图并创建 `Simulation`。
5. 地图生成在 `public/js/shared/mapgen.js`，前后端共用，因此客户端看到的地图与服务端记录一致。

### 2.2 波次与遗物

1. `public/js/app/combat.js` 的 `CombatController` 在整备阶段请求下一波。
2. 服务端推进 `waves_served`；若上一波未确认清空，则**重放当前波**，不重复发奖。
3. 波次内容由 `public/js/shared/waves.js` 根据种子与波数生成，客户端无法挑波。
4. 波内由 `public/js/game-app.js` 以固定步长推进 `public/js/sim.js`；输入在 `public/js/app/input.js`，绘制在 `public/js/render.js` 与 `public/js/render/`。
5. 清波后客户端显式 `POST /api/runs/:id/clear`，然后服务端下发遗物三选一（`POST /api/runs/:id/relics`），玩家选择后 `POST /api/runs/:id/relic` 应用。
6. 局内事件由 `public/js/shared/events.js` 生成与结算，未结算事件会阻止开下一波。

### 2.3 结算

1. 胜负确定后客户端 `POST /api/runs/:id/finish`，上报 `waveReached`、`kills`、`goldLeft`、`baseHp`。
2. 服务端**钳制并校验包络**：`waveReached` 不超过已清波次，击杀/金币/生命有上限；不接受客户端传入难度、分数或胜利标记。
3. `public/js/shared/scoring.js` 用同一公式计算分数与星核，再乘难度与地图倍率；客户端只做预览，最终以服务端响应为准。
4. 结算同时更新对局、玩家档案、排行榜、成就与技能进度。

### 2.4 持久化与续玩

- **服务端是唯一持久权威**：SQLite 保存 `profiles`、`runs`、`leaderboard` 及成就/统计/技能等表。表结构与迁移见 `docs/TECH_DESIGN.md` 第 6.1 节与 `server/db/migrations/`。
- **客户端只在整备阶段写本地快照**：调用链为 `public/js/app/store.js` → `public/js/shared/save.js` → `public/js/shared/snapshot.js`。战斗中途不保存波内状态，刷新后回到该波开始前。
- **续玩**：读取快照 → `GET /api/runs/:id` 确认 `status=active` → 用种子重建地图 → 恢复塔、金币、生命、遗物。服务端波次计数为准，避免重复领奖。
- 服务端不可用时应提示玩家，不能静默丢档；浏览器端不排队补写。

---

## 3. 确定性约束

### 3.1 RNG

- `public/js/shared/rng.js` 是唯一的随机源：`hashString` + `mulberry32`，封装为 `RNG`。
- 地图、波次、遗物、每日种子都由服务端或共享逻辑用显式种子生成；战斗中的随机判定使用战斗种子。
- `public/js/shared/`、`public/js/sim.js`、`server/` 的业务逻辑中**禁止** `Math.random()`。渲染层可以用它做纯装饰粒子，因为它不回流到模拟状态。
- **不要改变 `public/js/sim.js` 中 RNG 的调用顺序**。插入、删除或重排一次随机调用，都会让既有种子得到不同结果，并让平衡/性能基线失效。新增随机决策时，放在明确定义的位置并同步更新测试。

### 3.2 快照 v4 与旧档兼容

- `public/js/shared/snapshot.js` 是版本号的唯一来源：序列化、校验、迁移都在这里；`public/js/shared/save.js` 只保留旧导出名以稳定公共 API。
- 演进路径：v2 只有遗物 ID → v3 使用 `{id, level}` → v4 增加技能 `{id, level, cooldown}`。旧档按 Ⅰ 级恢复。
- 损坏输入由 `validateSnapshot` 判定：不抛异常，返回 `{ ok: false, reason }`；字段级异常收敛到安全默认值。
- 增加存档字段时：在 `snapshot.js` 提升版本号并补迁移，增加 `tests/snapshot.test.mjs` / `tests/save-compat.test.mjs` 用例；不要在别处复制版本常量。

### 3.3 画质一致性

- `public/js/settings.js` 只影响表现：绘制帧率 30/60、DPR 1/2、装饰/光晕/震动开关。
- 模拟始终是固定步长 1/60 秒；倍速只改变每帧推进的模拟步数。页面切到后台不补算。
- `tests/dynamic-perf.mjs` 会验证：相同种子、相同操作、相同模拟步数下，不同画质预设得到的战斗状态哈希一致。
- 因此**不要把设置对象传进 `public/js/sim.js`**，也不要用画质开关改变任何模拟分支。

### 3.4 服务端权威与包络校验

- 客户端不能提交难度、分数、胜利标记；服务端按记录重算。
- 未确认清波时重复请求波次会重放当前波；重复清波/重复选择是幂等的。
- 这是包络级防作弊，不是逐帧反外挂；改动规则时优先保证可复现与不重复发奖。

### 3.5 改到确定性时的自检

- [ ] 有没有新增、删除或重排 RNG 调用？有则跑平衡与性能，并说明变化。
- [ ] 有没有改变快照形状？有则升版本、补迁移、补兼容测试。
- [ ] 有没有把规则从 `public/js/shared/` / `public/js/sim.js` 挪到渲染或路由？有则拉回来。
- [ ] 改到 `public/js/shared/` 或 `public/js/sim.js` 时，跑**全量** `npm test`，不要只依赖本地快筛。

---

## 4. 测试分层与门禁

命令的完整列表以 `package.json` 的 `scripts` 为准。下面按测试目的分层。

| 层 | 命令 | 代表文件 | 守住什么 |
|---|---|---|---|
| 单元 / 集成 | `npm test` | `tests/*.test.mjs` | 规则、模拟、快照、服务端接口与迁移 |
| 静态检查 | `npm run check:syntax`、`check:imports`、`check:dead-exports`、`check:version`、`check:docs` | `scripts/` | 语法、import 图、死导出、版本一致性、文档链接与路径 |
| 浏览器验收 | `npm run verify:browser`（含 `smoke` / `flow` / `test:map` / `test:mobile` / `test:auth:ui` / `test:relics` / `test:settings`） | `tests/browser-*.mjs` | 页面流程、刷新续玩、移动端、可访问性交互 |
| 平衡 | `npm run balance`、`npm run sweep` | `tests/balance-sim.mjs`、`tests/balance-sweep.mjs` | 通关率与难度曲线回归 |
| 性能 | `npm run perf` | `tests/dynamic-perf.mjs` | 帧耗时、慢帧、实体预算、画质一致性 |
| 本地快筛 | `npm run test:changed` | `scripts/test-changed.mjs` | 只挑相关测试，缩短内环 |

### 4.1 单元与接口

- 运行器是 Node 内置 `node:test`，零依赖。
- 接口测试通过 `tests/harness.mjs` 启动临时数据库与随机端口的独立服务，覆盖会话 → 开局 → 波次重放 → 清波 → 遗物 → 结算 → 排行榜的完整链路及异常分支。
- 覆盖面与用例清单见 `docs/TECH_DESIGN.md` 第 8.1–8.2 节。

### 4.2 浏览器验收

- 需要本机 Chrome；只有 Chromium 时设置 `CHROME_BIN`。
- 每个脚本自带临时服务与临时浏览器配置，不碰开发/线上数据库。
- 改了 UI、渲染或开局/续玩流程时，除了 `npm test` 必须补跑对应浏览器测试。

### 4.3 平衡与性能

- 平衡模拟会重写 `docs/BALANCE.md`；性能记录会重写 `docs/PERFORMANCE.md`。这些文件是基线，不是手写文案。
- 无头软件渲染的绝对帧数只用于相对回归；不要拿它当真实设备性能承诺。
- 改数值、塔、敌人、遗物或 `public/js/sim.js` 时，平衡与性能结果要一起看。

### 4.4 门禁

- **CI**：`.github/workflows/ci.yml` 在 push 到 `main` / `develop` 及所有 PR 上运行语法检查、`npm test` 与浏览器验收。
- **quay fan-in**：本地 `.quay/config.yml` 的 `loop.test_command` 决定合并前跑什么（当前为 `npm test`），门禁永远是全量；不是 `scripts/test-changed.mjs`。
- **worktree 供给**：`.quay/config.yml`、`.quay/profiles.yml` 被 gitignore，由 `.worktreeinclude` 声明、`scripts/worktree-include.sh` 复制到任务 worktree。
- **合并前**：`npm test` 全绿；动到 UI/渲染/流程补浏览器测试；动到数值补平衡说明。

---

## 5. 目录地图与文件所有权建议

| 目录 / 文件 | 内容 | 所有权建议 |
|---|---|---|
| `public/js/shared/` | 前后端共用的纯逻辑 | 高冲突区：一次只安排一个所有者；改接口要通知服务端与平衡线 |
| `public/js/shared/data/` | 塔、敌人、遗物、技能、难度等数据表 | 数值改动集中在这里，避免散落到 sim / render |
| `public/js/sim.js` | 战斗模拟 | 高冲突区；改动必须保持确定性并跑平衡/性能 |
| `public/js/app/` | 控制器与状态机 | 按控制器文件拆分；不要跨文件复制状态 |
| `public/js/render/` | 分层渲染器 | 一类实体一个文件；优先新增渲染器而不是继续膨胀门面 |
| `public/js/ui.js`、`public/js/*-ui.js` | DOM 界面 | 只做展示与事件转发，规则放回 shared / sim |
| `public/js/api.js` | 服务端 API 封装 | 对外错误统一为带 code 的 `ApiError` |
| `server/routes/` | 一资源一路由 | 保持薄；SQL 与领域编排下沉 |
| `server/services/run-service.mjs` | 远征领域服务 | 高冲突区；状态迁移规则集中在这里 |
| `server/db/` | 仓储与迁移 | SQL 只在这里；迁移文件只追加，不改已应用文件 |
| `server/auth/` | 认证 | 安全相关改动单独评审 |
| `tests/` | 测试与浏览器脚本 | 与源码分层对应；新增行为优先补测试 |
| `docs/` | PRD、技术设计、本总览等 | 先文档后开发；数值与清单以正本为准 |
| `tasks/`、`goals/` | quay 本地任务线 | 只在本地 `develop` 线跟踪，不进 `main` |

并行开发建议（与 `CLAUDE.md` 一致）：

- 按**文件所有权**分工，禁止两个代理同时改同一个文件。
- `public/js/shared/` 与 `public/js/sim.js` 是共享热点，尽量由单一所有者串行处理。
- 新文件优先：渲染器、仓储、路由各按职责新增，避免把逻辑堆进已有大文件。
- 迁移文件 `server/db/migrations/` 是追加式账本，已应用的迁移不可改写（校验和会让服务拒绝启动）。

---

## 6. 常见改动落点（速查）

| 想改什么 | 先读 | 验证 |
|---|---|---|
| 新塔 / 新敌人 / 新遗物 / 新技能 | `public/js/shared/data/`、`public/js/shared/data.js`、`public/js/shared/effects.js`、`public/js/sim.js` | `npm test`；改数值再跑 `npm run balance`；改表现再跑浏览器测试 |
| 波次曲线 / 难度 | `public/js/shared/waves.js`、`public/js/shared/data/difficulties.js`、`docs/PRD.md` | `npm test`、`npm run balance` |
| 地图生成 | `public/js/shared/mapgen.js`、`docs/MAP_DESIGN.md` | `npm test`、`npm run test:map` |
| 接口 / 结算 | `server/routes/`、`server/services/run-service.mjs`、`server/db/`、`public/js/api.js` | `npm test`（含接口测试） |
| 存档 / 续玩 | `public/js/shared/snapshot.js`、`public/js/shared/save.js`、`public/js/app/store.js` | `npm test`、`npm run flow` |
| 渲染 / 画质 | `public/js/render.js`、`public/js/render/`、`public/js/settings.js` | `npm run perf`、对应浏览器测试 |
| UI / 交互 | `public/js/ui.js`、`public/js/app/`、`public/js/*-ui.js` | `npm run smoke` / `flow` / `test:mobile` |
| 账号 / 安全 | `server/auth/`、`server/routes/auth.mjs`、`docs/ACCOUNTS_DESIGN.md` | `npm run test:auth`、`npm run test:auth:ui` |

---

## 7. 维护本文

- 新增层、目录或改变上文任何「硬约束」时，在同一个 PR 里更新本文件。
- 不粘贴具体数值、塔/遗物清单或完整接口字段表；用链接指向正本。
- 引用的路径必须可解析；发现失效路径视为文档 bug，随改动一起修。
