# 《渊塔守卫》账号、进度与数据模型设计 v0.1

- 状态：**待评审**（评审通过后再动代码）
- 对应代码：当前 `main` @ `037b8ab`（v1.3 + 手机端横屏）
- 目标：把「浏览器匿名令牌」升级为可跨设备登录的账号体系，并建立一套**加内容不需要改表**的进度/游戏数据模型。
- 关联文档：`docs/PRD.md`、`docs/TECH_DESIGN.md`、`docs/PARALLEL_DEV_PLAN.md`

---

## 1. 现状与问题

当前身份完全依赖浏览器 `localStorage` 里的随机 UUID，通过请求头 `x-player-token` 传给服务端：

- 清缓存 / 换浏览器 / 换设备 = 进度丢失，且无法找回。
- 公网 `game.leyanwc.xyz` 无门槛，任何人访问都会自动生成 profile。
- `profiles` 把 `unlocks`、`stats` 塞进 JSON；`leaderboard` 把模式、日期写进列。
- 建表迁移是启动时 `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 补列，多个开发线同时改库必冲突。
- 没有服务端「进行中远征」查询，换设备后即使登录也接不上上一局。

结论：**登录不是单独加一张用户表，而是要把身份、会话、玩家数据、榜单一次性分层**，否则后面每加一个玩法都要改schema。

---

## 2. 范围

### P0（本次要做）

1. 账号注册 / 登录 / 登出 / 当前会话查询。
2. 游客账号 + 游客升级为注册账号（保留进度）。
3. 现有匿名令牌玩家无损迁移。
4. 跨设备进度：等级/星核/解锁/统计/设置/进行中远征。
5. 会话安全：HttpOnly Cookie、scrypt 密码、登录限流、Origin 校验。
6. 可扩展 schema + 版本化迁移机制。
7. 登录/注册界面与客户端接入。

### P1（紧接着）

- 云同步画质/操作设置（`player_kv`）。
- 恢复码找回密码（不依赖邮件）。
- 管理 CLI：列出账号、重置密码、禁用账号、补发恢复码。
- 榜单维度扩展（周榜、地图榜、赛季榜）。

### P2（预留，不在本次实现）

- 第三方登录（GitHub / Google / Passkey）——schema 预留 `account_identities`。
- 游客进度显式合并到已有账号。
- 成就 / 任务 / 赛季通行证——用 `player_progress` + `player_events` 承载，不需要加表。
- 邮箱找回（当前无 SMTP，不引入）。

### 明确不做

- 不做强反作弊：仍然只做波次状态机与结算包络校验。
- 不做实时联机 / WebSocket。
- 不做多租户 / 权限后台。
- 不做账号删除自助流程（用管理 CLI 软删）。

---

## 3. 身份与认证设计

### 3.1 账号类型

| 类型 | 说明 | 可登录 | 有进度 |
|---|---|---|---|
| `guest` | 打开游戏自动创建，绑定当前浏览器会话 | 否 | 是 |
| `registered` | 用户名 + 密码 | 是 | 是 |
| `disabled` | 被管理员禁用，数据保留 | 否 | 保留 |
| `deleted` | 软删除，仅管理员可见 | 否 | 保留 |

- `guest` 升级为 `registered` 时**不换 account_id**，所有进度天然保留。
- 升级成功后：签发新会话、吊销该账号其他会话、删除该账号的 `legacy_token` 别名（旧浏览器令牌立即失效，避免令牌泄露后仍能进账号）。
- 从已有游客会话登录到另一个注册账号时：吊销游客会话，签发目标账号的新会话；游客账号及其进度保留在原地，不自动合并（见待评审决策 #4）。
- 同一账号可绑定多种登录方式（P2 的 OAuth / Passkey），通过 `account_identities` 关联。

### 3.2 凭据

- 用户名：3–16 位，`[A-Za-z0-9_]`，大小写不敏感（存 `username_norm = lower(username)`），昵称另存并可中文。
- 密码：8–128 位；使用 Node 内置 `crypto.scryptSync`：
  - `N=16384, r=8, p=1, dkLen=64, salt=16B`，`maxmem=64MB`。
  - 存储格式 `scrypt$16384$8$1$<salt-b64>$<hash-b64>`，校验用 `timingSafeEqual`。
- 注册时生成一次性恢复码（8 组 × 4 字符），只返回一次，存 scrypt 哈希；用于无邮件找回。
- 不存明文密码、不存明文 IP、不存明文令牌。

### 3.3 会话

- 登录成功创建随机会话令牌（32B base64url），数据库只存 `sha256(token)`。
- 传输：`Set-Cookie: __Host-at_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=...`
  - 生产走 Cloudflare HTTPS，使用 `__Host-` 前缀 + `Secure`。
  - 本地 HTTP 开发降级为 `at_session` 且不带 `Secure`（由 `NODE_ENV` / `COOKIE_SECURE` 控制）。
- 有效期：滑动 30 天，绝对上限 90 天；每次使用更新 `last_used_at`。
- 登录时旋转会话（防会话固定）；改密后吊销该账号其他会话。
- CSRF：所有非 GET 请求校验：
  - 若带 `Origin`，必须与 `Host` 同源；
  - `Sec-Fetch-Site: cross-site` 直接拒绝；
  - `SameSite=Lax` 作为第二层。
- 多设备：允许多个活跃会话；**同一账号同时只有一局 active 远征**（开新局会 abandon 旧局，沿用当前行为）。本地快照只是加速，服务端 run 才是权威。

### 3.4 限流与审计

| 动作 | 限制 |
|---|---|
| 登录失败（按用户名） | 5 次 / 15 分钟，超限 429 + `Retry-After` |
| 登录失败（按 IP） | 20 次 / 15 分钟 |
| 注册（按 IP） | 5 次 / 小时 |
| 创建游客（按 IP） | 30 次 / 小时 |
| 找回密码（按用户名+IP） | 5 次 / 小时 |

- 失败返回统一文案「用户名或密码错误」，避免账号枚举。
- 成功/失败/注册/改密/登出写入 `auth_events`（审计 + 限流依据），保留 180 天后清理。
- 限流计数优先读 `auth_events`（重启不丢）；单进程内可加内存缓存减少查询。

### 3.5 注册策略

环境变量：

- `REGISTRATION_MODE=open|invite|closed`（默认 `invite`，公网环境推荐）。
- `REGISTRATION_INVITE_CODE=<code>`（`invite` 模式必填）。
- `AUTH_ENABLED=1`：启用账号体系；关闭时保持旧匿名令牌行为，便于回滚。
- `AUTH_REQUIRED=0|1`：是否禁止纯游客（默认 0，游客可玩，但榜单可按 board 配置限制）。

> 推荐：公网默认 `invite`，避免陌生人批量注册；朋友开局域网/内网时可用 `open`。

---

## 4. 数据模型总原则（可扩展的核心）

1. **ID/键 与 内容定义分离**
   - 内容（塔、遗物、敌人、地图、难度、解锁项）定义继续放在 `public/js/shared/data.js`，服务端直接 import；数据库只存字符串 ID。
   - 代码里不存在的 ID 一律拒绝；新增内容只改代码，不改表。

2. **强类型列只放需要查询/排序/聚合的字段**
   - 主键、外键、分数、时间、状态、波次等。
   - 稀疏、快速演化、按内容扩展的数据放 JSON，并且每个 JSON 带 `schemaVersion`。

3. **玩家数据分四层**
   - 身份：`accounts` / `account_identities` / `account_sessions`。
   - 玩家档案：`player_profiles` / `player_wallets` / `player_unlocks`。
   - 进度：`player_stats`（聚合计数）/ `player_progress`（按内容维度的状态）/ `player_kv`（杂项与设置）。
   - 事实记录：`runs` / `leaderboard_entries` / `player_events`（追加式事件）。

4. **货币、解锁、榜单都不写死在列里**
   - 货币是 `player_wallets` 的行（`currency_id`），不是 `cores` 列。
   - 解锁是 `player_unlocks` 的行，不是 JSON 数组。
   - 榜单是 `board_key` 的行，不是 `mode/day` 列。

5. **版本化**
   - 数据库：编号迁移 + 校验和，启动时按序执行，失败即拒绝启动。
   - 内容：`CONTENT_VERSION`（由内容开发线维护）写入每局与每条榜单记录。
   - JSON：`schemaVersion` 字段，读取时归一化，写入时升级。

6. **追加式事件**
   - `player_events` 记录解锁、购买、升级、通关等；统计可从事件重算，新玩法可先埋事件再定报表，不用改表。

7. **迁移只允许一个开发线写**
   - 只有平台/账号线可以新增 `server/db/migrations/*`。内容线需要新字段时提需求，不直接改库。详见 `docs/PARALLEL_DEV_PLAN.md`。

### 4.1 扩展操作手册（验证「不写死」）

| 需求 | 需要改什么 | 需要迁移吗 |
|---|---|---|
| 新增一座塔 / 一个遗物 / 一张地图 / 一种敌人 | `shared/data.js` + `CONTENT_VERSION` | 否 |
| 新增一种货币（如「余烬」） | 代码里的货币定义 + 钱包行 | 否 |
| 新增成就 / 关卡星级 / 塔熟练度 | 写 `player_progress`（type/key） | 否 |
| 新增每周榜 / 地图榜 / 赛季榜 | 榜单定义 + 写入 `board_key` | 否 |
| 新增一键领取 / 任务进度 | `player_progress` + `player_events` | 否 |
| 新增登录方式（OAuth/Passkey） | `account_identities` 插入身份 | 否 |
| 新增账号级开关/实验分组 | `accounts.meta` / `player_kv` | 否 |
| 新字段需要高频筛选/排序 | 加列 + 索引 | 是（编号迁移） |

---

## 5. 数据库 Schema（迁移 0001 草案）

> 所有表使用 `PRAGMA foreign_keys = ON`；时间统一为 Unix 毫秒整数；JSON 使用 TEXT。
> 这是设计稿，实施时拆成 `server/db/migrations/0001_accounts.sql` 等文件。

### 5.1 迁移记录

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

### 5.2 身份与会话

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,              -- crypto.randomUUID()
  kind          TEXT NOT NULL DEFAULT 'guest'
                CHECK (kind IN ('guest','registered')),
  username      TEXT,                          -- 登录名，游客为 NULL
  username_norm TEXT,                          -- lower(username)，唯一
  password_hash TEXT,                          -- scrypt 格式，游客为 NULL
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','disabled','deleted')),
  meta          TEXT NOT NULL DEFAULT '{}',    -- JSON：来源、实验组、管理备注
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX uq_accounts_username
  ON accounts(username_norm) WHERE username_norm IS NOT NULL;
CREATE INDEX idx_accounts_status ON accounts(status, created_at);

-- 未来 OAuth / Passkey / 邮箱等登录方式；P0 不写入
CREATE TABLE account_identities (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,                   -- 'github' | 'google' | 'passkey'
  subject     TEXT NOT NULL,                   -- 提供方用户 ID
  secret_hash TEXT,                            -- 可选（如恢复码、公钥摘要）
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  UNIQUE (provider, subject)
);
CREATE INDEX idx_identities_account ON account_identities(account_id);

CREATE TABLE account_sessions (
  id           TEXT PRIMARY KEY,               -- 公开的 session id
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,           -- sha256(原始令牌)
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  ip_hash      TEXT,                           -- HMAC-SHA256(IP, AUTH_IP_SALT)
  user_agent   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_sessions_account ON account_sessions(account_id, revoked_at, expires_at);
CREATE INDEX idx_sessions_expiry ON account_sessions(expires_at);

-- 旧 x-player-token → 账号映射；只存哈希
CREATE TABLE account_aliases (
  provider     TEXT NOT NULL,                  -- 'legacy_token'
  alias_hash   TEXT NOT NULL,                  -- sha256(token)
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (provider, alias_hash)
);

CREATE TABLE auth_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT,
  username_norm TEXT,
  event         TEXT NOT NULL,                 -- register/login_ok/login_fail/logout/password_change/recovery
  ip_hash       TEXT,
  user_agent    TEXT,
  detail        TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_auth_events_ip ON auth_events(ip_hash, created_at);
CREATE INDEX idx_auth_events_user ON auth_events(username_norm, created_at);
```

### 5.3 玩家数据

```sql
CREATE TABLE player_profiles (
  account_id   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,                  -- 对外昵称，可中文，不要求唯一
  title_id     TEXT,                           -- 预留：称号
  avatar_id    TEXT,                           -- 预留：头像
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  meta         TEXT NOT NULL DEFAULT '{}'      -- {"schemaVersion":1,...}
);

-- 货币独立成行：核心货币、活动货币、赛季货币都用同一张表
CREATE TABLE player_wallets (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency_id TEXT NOT NULL,                   -- 'cores' | 'embers' | ...
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, currency_id)
);

-- 解锁项独立成行：塔、初始加成、皮肤、功能开关
CREATE TABLE player_unlocks (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unlock_id   TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (account_id, unlock_id)
);

-- 聚合统计：runs/kills/wins 等计数与最佳值
-- scope_key 例子：''（全局）、'difficulty:abyss'、'mode:daily'、'season:2026S1'
CREATE TABLE player_stats (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stat_key   TEXT NOT NULL,                    -- 'runs' | 'kills' | 'wins' | 'best_wave' | ...
  scope_key  TEXT NOT NULL DEFAULT '',
  value_num  NUMERIC NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, stat_key, scope_key)
);

-- 按内容维度的状态：成就、关卡星级、塔熟练度、任务进度、赛季通行证
CREATE TABLE player_progress (
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  progress_type TEXT NOT NULL,                 -- 'achievement' | 'map' | 'tower' | 'quest' | 'season'
  progress_key  TEXT NOT NULL,                 -- 内容 ID
  value_num     INTEGER NOT NULL DEFAULT 0,    -- 等级/星级/计数
  state_json    TEXT NOT NULL DEFAULT '{}',    -- 该维度的详细状态
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, progress_type, progress_key)
);

-- 杂项键值：设置、一次性标记、实验开关
CREATE TABLE player_kv (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  namespace  TEXT NOT NULL,                    -- 'settings' | 'flags' | 'misc'
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, namespace, key)
);

-- 追加式事件：可从事件重算统计、支撑新任务/成就
CREATE TABLE player_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,                   -- 'run_finished' | 'unlock_bought' | 'level_up' | ...
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_player_events_account ON player_events(account_id, created_at);
CREATE INDEX idx_player_events_type ON player_events(event_type, created_at);
```

### 5.4 对局与榜单

```sql
CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL,               -- 'normal' | 'daily' | 未来模式
  board_key       TEXT,                        -- 结算时写入，如 'normal' / 'daily:2026-10-22'
  difficulty      TEXT NOT NULL,
  seed            TEXT NOT NULL,
  day             TEXT NOT NULL,
  content_version TEXT NOT NULL,               -- 开局时的内容版本
  ruleset_json    TEXT NOT NULL DEFAULT '{}',  -- 本局生效规则快照（倍率、上限、修正）
  waves_served    INTEGER NOT NULL DEFAULT 0,
  cleared_waves   INTEGER NOT NULL DEFAULT 0,
  relics          TEXT NOT NULL DEFAULT '[]',  -- [{id,level}]，内容形态仍可扩展
  offers          TEXT NOT NULL DEFAULT '{}',
  rerolls_used    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','finished','abandoned')),
  victory         INTEGER NOT NULL DEFAULT 0,
  score           INTEGER NOT NULL DEFAULT 0,
  wave_reached    INTEGER NOT NULL DEFAULT 0,
  kills           INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  result_json     TEXT NOT NULL DEFAULT '{}',  -- 结算明细（金币、基地血量、掉落等）
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER
);
CREATE INDEX idx_runs_account ON runs(account_id, status, created_at DESC);
CREATE INDEX idx_runs_board ON runs(board_key, score DESC, duration_ms ASC);

-- 榜单条目：一个 board_key 一张榜，加榜不加列
CREATE TABLE leaderboard_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  board_key     TEXT NOT NULL,                 -- 'normal' | 'daily:2026-10-22' | 'weekly:2026-W43'
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,                 -- 结算时快照，改名不影响历史
  -- 旧榜数据可能找不到对应 run，因此允许 NULL；删除 run 时保留榜单条目
  run_id        TEXT REFERENCES runs(id) ON DELETE SET NULL,
  difficulty    TEXT NOT NULL,
  score         INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  content_version TEXT NOT NULL,
  metrics_json  TEXT NOT NULL DEFAULT '{}',    -- {wave,kills,victory,...}
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_lb_board ON leaderboard_entries(board_key, score DESC, duration_ms ASC);
CREATE INDEX idx_lb_account ON leaderboard_entries(account_id, board_key);
```

### 5.5 旧表处理

迁移时**不删旧数据**：

- `profiles` → 数据复制到新表后改名为 `legacy_profiles`。
- `runs` → 先改名为 `legacy_runs`，再创建新 `runs`（表名冲突，必须先改名）。
- `leaderboard` → 数据复制到 `leaderboard_entries` 后改名为 `legacy_leaderboard`。

保留一个版本周期，确认无误后再由管理脚本清理；迁移前自动 `VACUUM INTO` 备份。

---

## 6. 旧数据迁移（v1 → v2）

`server/db/migrations/0001_accounts.sql`（结构）+ `0002_import_legacy.mjs`（数据，需 `node:crypto` 哈希令牌）。

按以下顺序在一个事务内执行（数据导入失败则整体回滚）：

1. 备份：`VACUUM INTO server/data/backups/pre-auth-<ts>.db`（在事务外）。
2. 事务内：`ALTER TABLE runs RENAME TO legacy_runs`；创建所有新表与索引。
3. 遍历 `legacy_profiles`：
   - `accounts`：`id = randomUUID()`，`kind='guest'`，`username=NULL`，`status='active'`。
   - `account_aliases`：`provider='legacy_token'`，`alias_hash=sha256(token)`。
   - `player_profiles`：`display_name = profiles.name`。
   - `player_wallets`：`currency_id='cores'`，`balance=profiles.cores`。
   - `player_unlocks`：展开 `profiles.unlocks` 数组。
   - `player_stats`：`runs/kills/wins` 写入 `scope_key=''`；`stats.byDifficulty.*` 写 `scope_key='difficulty:<id>'`。
4. 遍历 `legacy_runs`：按 `token` 查 alias → `account_id`；`content_version='v1.3'`，`ruleset_json='{}'`，`board_key` 按 mode/day 生成；其余字段原样写入新 `runs`。
5. 遍历 `legacy_leaderboard`：写入 `leaderboard_entries`，`board_key = mode='daily' ? 'daily:'+day : 'normal'`；`metrics_json={wave,kills,victory}`；`content_version='v1.3'`；关联对应 run（找不到则以 run_id 空串处理，实施时允许 NULL 或占位）。
6. 校验：新表行数与旧表一致；抽样比对星核、解锁数、最佳分数。
7. 旧表改名 `legacy_*`。

迁移后旧 `x-player-token` 仍可用：服务端 `sha256(token)` 查 `account_aliases`，命中则签发会话。迁移窗口结束后由 `AUTH_LEGACY_TOKENS=0` 关闭。

> 迁移脚本必须可重复执行（`schema_migrations` 保证只跑一次）并在测试库上先跑。

---

## 7. API 契约

### 7.1 公共

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | `{authEnabled, registrationMode, contentVersion, minClientVersion}` |
| GET | `/api/health` | 保持现状 |

### 7.2 认证

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/auth/guest` | `{}` | 201 `{account, profile, sessionExpiresAt}` + Cookie；已登录则 200 返回当前 |
| POST | `/api/auth/register` | `{username,password,inviteCode?}` | 201 `{account, profile, recoveryCode}` + Cookie；游客会话则原地升级 |
| POST | `/api/auth/login` | `{username,password}` | 200 `{account, profile}` + 新 Cookie |
| POST | `/api/auth/logout` | `{}` | 204，吊销当前会话 |
| GET | `/api/auth/me` | — | 200 `{account, profile}`；未登录 401 |
| PATCH | `/api/profile` | `{displayName}` | 200 `{profile}` |
| POST | `/api/auth/password` | `{currentPassword,newPassword}` | 200 `{ok:true}`，吊销其他会话 |
| POST | `/api/auth/recovery` | `{username,recoveryCode,newPassword}` | 200 `{ok:true}` |

`profile` 统一形状：

```json
{
  "accountId": "uuid",
  "kind": "guest",
  "username": null,
  "displayName": "指挥官-AB12",
  "createdAt": 1760000000000,
  "wallet": { "cores": 120 },
  "unlocks": ["arc", "poison"],
  "stats": {
    "runs": 12, "kills": 3456, "wins": 3,
    "byDifficulty": { "standard": { "bestWave": 18, "bestScore": 9000, "wins": 1, "runs": 5 } }
  },
  "progress": {},
  "settings": {}
}
```

> `stats` 保留旧形状，客户端与测试少改；新增维度用 `progress`/`player_progress`，不再往 `stats` 塞结构。

### 7.3 游戏接口

路径不变，身份从 Cookie 读取；兼容期仍接受 `x-player-token`。

新增：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/runs/active` | 返回当前账号进行中的远征（无则 `run:null`），用于跨设备续玩 |
| GET | `/api/profile/progress` | `{stats, progress, unlocks, wallet}`，可选 `?type=` 过滤 |
| PUT | `/api/profile/settings` | `{key, value}` 写入 `player_kv`（P1） |
| GET | `/api/leaderboard?board=normal\|daily:YYYY-MM-DD\|weekly:YYYY-Www&limit=20` | `board` 取代 `mode`，旧 `mode/day` 参数兼容 |

榜单响应保持 `{board, entries:[{name,difficulty,wave,score,kills,victory,durationMs,createdAt}]}`，`entries` 增加 `accountKind`（`guest`/`registered`）供前端标记。

### 7.4 错误约定

- 401：未登录 / 会话失效（客户端自动尝试 `/api/auth/guest`）。
- 403：Origin/CSRF 校验失败、账号被禁用。
- 409：用户名已存在、当前波次未结算、重复选择。
- 429：登录/注册/每日次数超限，带 `Retry-After`。
- 500：不泄露 SQL/堆栈，只返回通用文案并记日志。

---

## 8. 客户端改造

新增文件（避免与内容线冲突）：

```
public/js/auth.js        # 会话引导、登录/注册/登出、fetch 封装（credentials: same-origin）
public/js/auth-ui.js     # 登录/注册弹窗、游客提示、恢复码展示
public/auth.css          # 认证界面样式（不改 styles.css）
```

修改点：

- `api.js`：统一 `request()`，默认 `credentials:'same-origin'`；删除手写 token 的主路径，保留 `x-player-token` 兼容开关。
- `main.js` `boot()`：先 `GET /api/auth/me`；401 则 `POST /api/auth/guest`；再拉 profile。
- 大厅显示「游客 / 登录」入口；登录后显示昵称与登出。
- 换设备续玩：启动时先查 `/api/runs/active`，有则提示「继续上一局」，不依赖 localStorage 快照。
- 快照仍保留在本地作为断线加速；服务端 run 为准。
- 设置（画质/音效）继续本地存；P1 再云同步。

---

## 9. 服务端模块拆分（为并行开发服务）

```
server/
  index.mjs                 # 只做启动、静态资源、挂载路由
  http/middleware.mjs       # Origin 校验、body 解析、会话解析、错误封装
  routes/auth.mjs           # 认证接口
  routes/game.mjs           # 现有 /api/runs /api/unlock
  routes/profile.mjs        # /api/profile /api/profile/progress /settings
  routes/leaderboard.mjs    # 榜单
  services/runs.mjs         # 开局/波次/遗物/结算业务（从 index.mjs 抽出）
  services/progression.mjs  # 钱包、解锁、统计、事件写入
  db/index.mjs              # 连接、PRAGMA、迁移执行、备份
  db/migrations/*           # 只有平台线可新增
  db/repos/*.mjs            # accounts/sessions/profiles/runs/leaderboard
  game/content.mjs          # 包装 shared/mapgen.js、waves.js，内容线可改
```

- 内容线只通过 `server/game/content.mjs` 接触服务端；即使 `generateMap` 签名变化，也只改这一层。
- 路由与业务从 `index.mjs` 拆出后，`index.mjs` 基本不再被内容线修改，降低冲突。

---

## 10. 测试计划

### 单元

- scrypt 哈希/校验、错误密码、格式损坏。
- 会话令牌生成、哈希、过期、吊销。
- 用户名/密码校验、恢复码生成与校验。
- 限流窗口计算。

### 接口（`tests/auth.test.mjs`）

- 游客创建 → 改名 → 开局 → 登录升级 → 进度保留。
- 注册 → 登出 → 登录 → profile 一致。
- 错误密码、重复用户名、被禁用账号。
- Cookie 属性（HttpOnly/SameSite/Secure 按环境）。
- 跨账号隔离：A 不能读 B 的 run。
- Origin 不匹配的 POST 被 403。
- 登录限流 429 + `Retry-After`。
- `/api/runs/active` 跨会话续玩。
- 旧 `x-player-token` 迁移后仍可访问原进度。

### 迁移（`tests/db-migrations.test.mjs`）

- 用 v1.3 结构的夹具库（含 profiles/runs/leaderboard）跑迁移。
- 断言行数、星核、解锁、统计、榜单映射正确。
- 重复启动不重复导入；checksum 变化拒绝启动。
- 迁移前备份文件存在。

### 端到端（无头 Chrome）

- 注册 → 打一波 → 刷新 → 登出 → 登录 → 续玩。
- 游客 → 注册 → 星核/解锁保留。
- 手机端登录弹窗可操作（复用现有 mobile harness）。

### 回归

- 现有 `npm test`、`npm run smoke/flow/test:settings/test:relics/test:mobile` 全部保持通过（游客路径）。
- 内容线合并后，双方各自跑一遍完整测试再合并。

---

## 11. 实施顺序（评审通过后）

| 阶段 | 内容 | 验收 |
|---|---|---|
| S1 | 路由/业务拆分 + 迁移执行器（纯重构，无行为变化） | 现有测试全绿 |
| S2 | 0001 schema + 0002 旧数据导入 + 兼容令牌 | 迁移测试通过，旧玩家进度不丢 |
| S3 | 认证接口 + 会话 + 限流 + 审计 | 接口测试通过 |
| S4 | 客户端登录 UI + 游客升级 + `/api/runs/active` | 端到端通过 |
| S5 | 榜单 board_key、进度接口、设置同步 | 榜单兼容 |
| S6 | 开 `AUTH_ENABLED=1`，观察一周，关闭旧令牌 | 线上无 401 异常 |

每阶段独立可合并、可回滚；S1/S2 不改变玩家可见行为。

---

## 12. 待评审决策

| # | 决策 | 建议 |
|---|---|---|
| 1 | 公网注册策略 | 默认 `invite`，内网可 `open` |
| 2 | 游客是否可上排行榜 | 允许，条目标记「游客」；未来 ranked board 只收注册账号 |
| 3 | 忘记密码 | 不做邮件；恢复码 + 管理 CLI |
| 4 | 新设备游客进度是否自动并入已有账号 | v1 不自动合并，提示用户；P2 做显式合并 |
| 5 | 会话时长 | 滑动 30 天 / 绝对 90 天 |
| 6 | 昵称唯一性 | 不唯一；登录名唯一 |
| 7 | 是否保留免登录游客 | 保留，降低朋友试玩门槛 |
| 8 | 旧 `x-player-token` 保留多久 | 上线后 2 周，或全部活跃玩家至少登录一次后关闭 |

---

## 13. 风险与对策

| 风险 | 对策 |
|---|---|
| 迁移丢进度 | 事务 + 迁移前自动备份 + 行数/抽样校验 + 保留 legacy 表 |
| 内容线同时改库 | 迁移文件单一所有权；内容线通过 `game/content.mjs` 适配 |
| 公网被刷注册 | 默认邀请码、IP 限流、游客上限 |
| Cookie 在 HTTP 下不可用 | 本地自动降级非 Secure；生产强制 HTTPS |
| 多设备同时开局 | 明确单 active run 规则；后续可加 `device_id` |
| 内容版本变化导致榜单不可比 | 每条榜单记录 `content_version`，榜单可按版本筛选 |
| 旧令牌泄露 | 迁移后只存哈希；支持 `AUTH_LEGACY_TOKENS=0` 一键关闭 |

---

## 14. 与现有文档的差异

- PRD 第 187 行「不做账号密码体系」、第 242 行「账号注册、密码、第三方登录」列为不做——本设计将其提升为 P0/P2，需同步修订 PRD 与 README「已知边界」。
- TECH_DESIGN 第 343 行「启动时 CREATE TABLE + ALTER TABLE 补列」——改为编号迁移 + 校验和。
- 排行榜从 `leaderboard(mode, day)` 迁移为 `leaderboard_entries(board_key)`，旧接口参数保留兼容。

评审通过后，我会先更新 PRD/TECH_DESIGN 的对应段落，再进入 S1。
