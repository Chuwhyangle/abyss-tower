<!-- docs-consistency:ignore-file — 归档的历史方案，正文含当时计划但未落地的文件名 -->
# 双线并行开发方案：账号/数据 与 游戏内容 v0.1

> **状态：历史文档（2026-10-23 归档）**——本文写于「仓库无 remote、地图线与账号线并行」的阶段；
> 两条线均已合并、账号 P0 已落地，文中"立刻要做的事"和分支操作不再适用。
> 当前协作方式见 [CONTRIBUTING.md](../CONTRIBUTING.md)，任务编排见工作区的 quay 任务库。
> 保留正文仅作为当时分工与契约的决策记录。

- 状态：**已完成 / 归档**
- 适用：账号/数据线（本线） + 地图/内容线（另一 AI）
- 关联：`docs/ACCOUNTS_DESIGN.md`

---

## 1. 当前实际状态（2026-10-22）

```
main @ 037b8ab
  M public/js/shared/mapgen.js     ← 内容线未提交改动（+357/-76）
  ?? docs/MAP_DESIGN.md            ← 内容线新增设计稿
```

- 仓库没有配置 remote，所有分支都在本地 `.git`。
- `main` 上已有未提交的内容线改动，**这是当前最大的风险**：两边同时改 `index.mjs`/`data.js` 时会互相覆盖，且未提交内容一旦执行 `checkout`/`reset` 可能丢失。
- 本账号线在独立 worktree：`feature+accounts-auth`，只新增文档，未触碰任何游戏代码。

### 立刻要做的一件事

内容线先把当前改动提交到独立分支：

```bash
# 由内容线执行（不是我执行，避免抢别人的改动）
git switch -c feature/map-v2
git add public/js/shared/mapgen.js docs/MAP_DESIGN.md
git commit -m "feat(map): 多入口/分叉地图设计 v2 与生成器改造"
git switch main
```

如果 `mapgen.js` 还没到可运行状态，用 WIP 提交：

```bash
git commit -m "wip(map): 地图 v2 生成器（未完成，勿合并）"
```

> 不要用 `git stash`：多个 worktree 共享 stash 栈，容易误弹别人的改动。用 WIP 提交最安全。

---

## 2. 分支与合并策略

```
main ──●────────────●────────────●──────────────►
        \            \            \
         \            \            └─ feature/map-v2（内容线）
          \            └─ feature/accounts-auth（账号线：S1→S2→S3）
           └─ （可选）chore/server-router-split（纯重构，先合）
```

- 两条线都从 `main` 拉短分支，**不直接 push 到 main**（当前无 remote，也遵循同样习惯）。
- 账号线先落地 S1（路由/业务拆分 + 迁移执行器，纯重构），合并后再做 S2/S3。这样 `index.mjs` 的冲突窗口只存在一次。
- 内容线基于合并后的 main rebase，再合并地图改造。
- 每次合并前双方各跑一遍：`npm test` + `npm run smoke` + `npm run flow`；涉及内容数值再加 `npm run balance`。
- 建议给 main 打标签：`v1.3-auth-base`（账号线起点）、`v1.3-map-base`（内容线起点），出问题好回退。

---

## 3. 文件所有权矩阵

| 路径 | 归属 | 规则 |
|---|---|---|
| `public/js/shared/mapgen.js` | 内容线 | 账号线只读 |
| `public/js/shared/waves.js` | 内容线 | 账号线只读 |
| `public/js/shared/data.js` | 内容线 | 内容定义（塔/遗物/敌人/难度/解锁）唯一来源；账号线只 import |
| `public/js/shared/config.js` | 内容线 | 平衡数值 |
| `public/js/{sim,render}.js` | 内容线 | 战斗与绘制 |
| `public/js/ui.js` / `styles.css` | 内容线为主 | 账号线不直接改；认证 UI 放新文件 |
| `docs/MAP_DESIGN.md` / `BALANCE.md` | 内容线 | — |
| `server/game/content.mjs` | **内容线** | 包装 `generateMap`/`generateWave`；签名变化只改这里 |
| `server/db/**`（含 migrations） | **账号线** | 迁移文件单一所有权 |
| `server/auth/**` / `server/routes/**` / `server/services/**` | 账号线 | 内容线不改 |
| `public/js/auth*.js` / `public/auth.css` | 账号线 | 内容线不碰 |
| `docs/ACCOUNTS_DESIGN.md` / `PARALLEL_DEV_PLAN.md` | 账号线 | — |
| `server/index.mjs` | 账号线（S1 后冻结） | S1 拆完路由后基本不再改 |
| `public/index.html` | 共享，低冲突 | 账号线只在末尾加 `<script type="module" src="/js/auth.js">` 与一个 `#auth-root` 容器；内容线不动这两处 |
| `package.json` | 共享 | 新增脚本先沟通；账号线只加 `test:auth` 等 |
| `tests/harness.mjs` | 账号线改一次 | 增加 `registerAndLogin()`；注册成为硬门槛，所有浏览器测试必须先登录 |
| `tests/*.test.mjs`（内容相关） | 内容线 | — |
| `tests/auth*.test.mjs` / `db-migrations.test.mjs` | 账号线 | — |

### 共享文件冲突处理

1. `public/js/shared/data.js`：账号线不新增内容定义。若账号线需要「货币/进度类型」常量，放 `public/js/shared/progression.js`（新文件，账号线所有）。
2. `server/index.mjs`：S1 只做「搬运」——把现有 handler 原样搬到 `routes/game.mjs`，不加新功能，保证 diff 可机械审查。内容线在 S1 合并前不要改这个文件。
3. `tests/harness.mjs`：账号线一次性加认证辅助，内容线 rebase 即可；如内容线也要改，先合并账号线的 harness 版本。
4. CSS：账号线使用 `public/auth.css`，避免和内容线的 `styles.css` 大改冲突。

---

## 4. 冻结的跨线契约

### 4.1 服务端内容适配层

内容线提供、账号线调用：

```js
// server/game/content.mjs  —— 只有内容线改
export function buildMap(seed) { ... }              // 现 generateMap(seed)
export function buildWave(seed, wave, difficulty) { ... } // 现 generateWave(...)
export function contentVersion() { return CONTENT_VERSION; }
```

- 账号线的 `routes/game.mjs` 只 import 这三类函数。
- `generateMap` / `generateWave` 签名或返回结构变化时，内容线必须同步更新此适配层与对应测试，账号线无需改路由。
- `CONTENT_VERSION` 由内容线在 `shared/` 中维护，每次影响玩法/数值的发布递增；写入每局 `runs.content_version` 与榜单条目。

### 4.2 身份上下文

- `http/middleware.mjs` 解析会话后注入 `req.account = {id, kind, username}` 与 `req.profile`。
- 业务 handler **不读** `x-player-token`、不读 Cookie 原文；只读 `req.account.id`。
- 内容相关逻辑（地图/波次/遗物/结算）保持纯函数，不感知账号。

### 4.3 数据读写边界

- 写入玩家进度统一走 `services/progression.mjs`：
  - `awardCurrency(accountId, currencyId, delta)`
  - `grantUnlock(accountId, unlockId)`
  - `bumpStat(accountId, statKey, scopeKey, delta)`
  - `recordEvent(accountId, type, payload)`
- 内容线若新增“击杀掉落某种货币/解锁某物”，只调用这些函数并传入新 ID，不直接写 SQL、不改表。

### 4.4 测试夹具

- 服务端测试统一从 `tests/harness.mjs` 获取隔离服务（临时 DB + 随机端口）。
- **不提供游客通道**：所有浏览器测试必须先用 `registerAndLogin()` 创建测试账号（每次随机用户名），再进入大厅。
- 内容线测试不要手写 Cookie；统一从 harness 拿已登录的上下文。账号线 S4 交付后，内容线 rebase 即可复用。

---

## 5. 迁移文件规则

- 目录：`server/db/migrations/`。
- 命名：`NNNN_short_name.sql` 或 `NNNN_short_name.mjs`，四位递增。
- 只允许账号线新增；**已应用的迁移禁止修改**（执行器校验 checksum，不一致拒绝启动）。
- 内容线需要新字段/新表时，在 `docs/` 提一条需求（表名、字段、查询方式），由账号线出迁移。
- 迁移执行器启动流程：
  1. 打开 DB，`PRAGMA foreign_keys=ON; journal_mode=WAL`。
  2. 读 `schema_migrations`。
  3. 若有未应用版本，先 `VACUUM INTO backups/pre-migration-<ts>.db`。
  4. 逐个在事务中执行；失败回滚并**拒绝启动**（不带着半套 schema 提供服务）。
  5. 校验 checksum。

---

## 6. 推荐执行顺序（两条线的时间轴）

| 时间 | 账号线 | 内容线 |
|---|---|---|
| D0 | 本文档评审 | 把 mapgen/MAP_DESIGN 提交到 `feature/map-v2` |
| D1 | S1：拆路由/业务 + 迁移执行器（纯重构）→ 合并 main | 在 map-v2 上继续地图算法，不碰 server |
| D2 | S2：schema + 旧数据迁移 | 地图 UI/测试；适配 `game/content.mjs` |
| D3 | S3：认证接口/会话/限流 | 合并 `feature/map-v2` 到 main（先跑全量测试） |
| D4 | 账号线 rebase main，接 `content.mjs` | 修合并后问题，冻结 `CONTENT_VERSION` |
| D5 | S4：登录/注册页 + 老账号绑定 + harness 自动登录 | 新内容开发（新塔/遗物/地图），只加 ID |
| D6 | S5：榜单 board_key / 设置同步 | 继续内容迭代 |
| D7 | S6：开 `AUTH_ENABLED=1`，观察 | 观察榜单/对局是否正常 |

合并顺序建议：**先 S1 重构，再内容线，再 S2/S3 账号功能**。理由：S1 不改行为，风险最低；早合并把 `index.mjs` 的冲突一次性消化，之后两条线的写集基本不相交。

---

## 7. 每日集成检查

```bash
# 在各自 worktree 中
git fetch --all          # 目前无 remote，可跳过
git rebase main          # 或 git merge main
npm test
npm run smoke
npm run flow
# 内容线涉及数值时：
npm run balance
```

- 任何一方合并后，另一方 24 小时内必须 rebase 一次，避免长期分叉。
- 出现冲突时按所有权矩阵判断：谁的写集谁解决；共享文件由账号线主导。
- 合并前给对方一句话说明改了什么、需要对方做什么（例如「data.js 新增 relic id，账号线无需动作」）。

---

## 8. 回滚预案

- 数据库：迁移前自动备份 + `npm run backup`；回滚用备份文件替换 `server/data/game.db`（先停服务）。
- 代码：main 打标签；账号功能通过 `AUTH_ENABLED=0` 可退回旧匿名令牌行为。
- 旧表 `legacy_*` 保留一个版本周期，确认无误后再清理。
- 部署：`sudo systemctl restart rogue-td`；迁移失败服务不会启动，避免半迁移状态对外服务。

---

## 9. 需要对方确认的三件事

1. `feature/map-v2` 是否愿意先提交现有 `mapgen.js` 改动（避免误丢）。
2. `CONTENT_VERSION` 放在 `public/js/shared/content-version.js` 是否可接受（新增文件，内容线维护）。
3. `server/game/content.mjs` 适配层由内容线维护，账号线只调用——是否同意。
