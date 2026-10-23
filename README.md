# 渊塔守卫 · Abyss Tower

单人肉鸽塔防网页游戏。固定 30 波通关，三档难度，每波结束三选一遗物，星核永久解锁。
前后端同仓库：浏览器负责实时战斗渲染，Node 服务端负责地图/波次/遗物生成、存档与排行榜。

- 需求文档：[docs/PRD.md](docs/PRD.md)
- 技术设计：[docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)
- 地图设计：[docs/MAP_DESIGN.md](docs/MAP_DESIGN.md)
- 平衡模拟记录：[docs/BALANCE.md](docs/BALANCE.md)
- 真人试玩记录：[docs/PLAYTEST.md](docs/PLAYTEST.md)
- 技能与养成设计：[docs/PROGRESSION_DESIGN.md](docs/PROGRESSION_DESIGN.md)
- 动态性能记录：[docs/PERFORMANCE.md](docs/PERFORMANCE.md)
- 更新日志：[CHANGELOG.md](CHANGELOG.md)

## 快速开始

```bash
cd abyss-tower   # 仓库根目录
npm start
```

打开 `http://localhost:8787`（局域网用 `http://<服务器IP>:8787`）。

- 无需安装依赖，要求 Node.js ≥ 22.5（使用内置 `node:sqlite`）。
- 默认监听 `0.0.0.0:8787`，可用环境变量 `PORT` / `HOST` / `DB_PATH` 覆盖。

## 玩法

- 点击底部塔卡 → 点击空地建造；点击已建塔可升级/出售（返还 70%）。
- 8 种防御塔：弩塔 / 炮台 / 霜塔 / 电弧塔 / 毒雾塔 / 战旗塔 / 震荡塔 / 狙击塔；后 5 种用星核永久解锁。
- 击退 30 波即通关；基地生命归零则远征失败。
- 每波结束从三件遗物中选一件（可花 25 金币刷新，次数有限）；遗物池 30 件，共 Ⅲ 级。
- 遗物最多 Ⅲ 级：重复选中会升级并展示「Ⅰ → Ⅱ」及前后效果；满级退出候选池，池尽时提供金币/修复补位。
- 每局开局从 **3 张候选地图** 中选一张：单径峡谷 / 双径汇流 / 三径裂隙 / 环形回廊 / 交叉回廊 / 折返长廊，并附带 1 个词缀（富矿 / 疾风 / 薄雾 / 裂界 / 重甲 / 悬赏 / 远眺 / 涌潮）。
- 中后期会有多个传送门同时出怪，需要覆盖汇流点与不同路线；首领波与第 30 波全入口开启。
- 每 5 波一个首领，第 30 波为最终首领；首领走走停停，停顿期间受到伤害 +35%，并会释放咆哮/召唤/震击技能，低血量进入狂怒。
- 整备阶段显示**下一波情报**（敌人类型与数量、首领提示），方便提前调整塔位与升级。
- 结算获得星核，在星核商店永久解锁电弧塔、毒雾塔、战旗塔、震荡塔、狙击塔与初始加成。
- 每波开始前与清波后自动存档；战斗中刷新会重放当前波，选遗物时刷新会恢复同一组选项。
- 大厅与局内均可打开画质设置（低配 / 高配 / 自定义），只影响表现，不影响战斗结果。
- 成就系统（49 项，普通/稀有/史诗三档，含隐藏成就）与生涯统计面板：每局结算都会留下记录。
- 中英双语：关键界面可切换 `zh-CN` / `en-US`，偏好保存在本地。
- 程序化背景音乐与环境音：与音效独立混音，页面隐藏时自动暂停。

快捷键：`1`–`8` 选塔，`Q` 释放技能，`U` 升级，`S` 出售，`空格` 暂停，`Esc` 取消。

## 手机端

- **强制横屏**：进入战斗时自动尝试全屏并锁定横屏；无法锁定时显示不可跳过的旋转提示，可点“重试自动横屏”。
- 触控建造：点塔卡 → 点空地；点位靠近可建造格或已有塔时会自动吸附，降低小屏幕误触。
- HUD 提供遗物入口、全屏/横屏按钮；商店可左右滑动。
- 首次默认低配画质（30 FPS、DPR 1），可在设置中切换。
- iOS Safari 不支持网页强制旋转/全屏，只能按系统限制手动横屏；Android Chrome 通常可自动完成。

## 三档难度（机器人全解锁口径）

> 下表通关率为 **v1.7 复测数据**。v1.8 新增战旗/震荡/狙击塔、折返长廊与 4 个词缀后尚未重新校准，数值与通关率以 `docs/BALANCE.md` 更新为准。

| 难度 | 敌人生命 | 敌人数量 | 敌人速度 | 初始金币 | 基地生命 | 分数倍率 | 机器人通关率（全解锁） |
|---|---|---|---|---|---|---|---|
| 漫游 | ×0.85 | ×0.87 | ×0.96 | +60 | +5 | ×0.80 | 约 90% |
| 远征 | ×1.10 | ×1.04 | ×1.01 | — | — | ×1.00 | 约 37% |
| 深渊 | ×1.34 | ×1.12 | ×1.05 | −20 | −3 | ×1.50 | 约 7% |

每日挑战：所有人同一套地图/波次/遗物种子，开局自选难度，每天最多结算 3 次。
排行榜为合并榜，按最终分数排序，展示难度标签。

通关率为 40 种子、每个种子跑满 3 张候选地图、固定机器人策略的结果，不等同真人；零解锁约为 73% / 18% / 1%。目标区间为漫游 80–90%、远征 25–35%、深渊 5–15%，v1.7 三档均在区间内。机器人固定 18 塔上限、不会卖塔/针对性换塔，详见 `docs/BALANCE.md`。

地图原型差异明显（v1.7 口径）：远征全解锁下交叉回廊约 17%、双径汇流约 56%，已用 `scoreMul`（交叉回廊 1.10、双径汇流 0.97）做计分补偿；漫游口径下疾风词缀仍最强（约 94%），远征各词缀接近（32–40%）。v1.8 新增原型与词缀后需按同一方法复测，完整明细见 `docs/BALANCE.md`。

## 画质设置

- 低配：30 FPS、DPR 1、精简装饰、关键飘字、关闭光晕/震动。
- 高配：60 FPS、DPR 2、完整装饰、全部飘字、开启光晕/震动。
- 自定义可逐项调整，保存到当前浏览器；损坏设置自动回退低配。
- 30 FPS 只限制绘制，战斗模拟仍按固定步长推进；局内打开设置会暂停，关闭后恢复原暂停状态。

## 技术栈

- 前端：原生 ES Module + Canvas 2D + DOM，无构建步骤、无框架、无运行时依赖。
- 后端：`node:http` + `node:sqlite` + 原生 ESM。
- 音频：WebAudio 实时合成音效、背景音乐与环境音，无音频素材。
- 测试：`node:test` + 无头 Chrome（CDP）。

```
public/
  index.html / styles.css
  js/
    main.js       入口：安装错误收集并启动 GameController
    app/          页面编排：控制器（会话/开局/战斗/输入/存档/技能）
    game-app.js   rAF 循环、渲染调度、音效
    sim.js        纯战斗模拟（Node 可直接运行）
    render.js     渲染门面（画质/DPR/分层编排）
    render/       分层渲染器（背景/塔/敌人/弹道/技能/特效/光晕/覆盖层）
    ui.js         HUD / 商店 / 弹窗 / 画质设置
    achievements-ui.js / stats-ui.js / leaderboard-ui.js  成就、生涯统计、榜单界面
    i18n.js       语言切换与词典装配
    api.js        接口封装
    audio.js      合成音效、音乐与环境音
    settings.js   画质预设、持久化与回退
    shared/       前后端共享：RNG / 地图 / 波次 / 数据表 / 成就 / 快照 / 计分 / 存档兼容
      data/       常量、难度、塔、敌人、遗物、技能、解锁项、修正上限
      i18n/       zh-CN / en-US 词典
server/
  index.mjs       引导：监听、来源校验、静态资源与路由装配
  http/           响应原语、路由上下文、静态文件服务
  routes/         路由类（system/auth/profile/leaderboard/runs/unlock/achievements/stats/support）
  services/       领域服务（run-service：结算、快照、幂等）
  config.mjs      账号开关、注册策略、内容版本
  db.mjs          玩家档案/对局兼容读写层
  db/
    index.mjs     SQLite 连接、迁移执行与迁移前备份
    migrations/   版本化迁移（账号/平台线）
    accounts.mjs  账号与旧令牌别名
    sessions.mjs  会话
    leaderboard.mjs 榜单
    achievements.mjs / stats.mjs / runs.mjs  成就、统计、对局仓储
  auth/           密码、Cookie、限流、认证路由与身份解析
  data/game.db    运行时数据库（自动创建）
tests/
  *.test.mjs      单元与接口测试
  harness.mjs     隔离服务端 / Chrome / CDP
  browser-*.mjs   冒烟、续玩、遗物、设置、地图、手机端、账号端到端测试
  dynamic-perf.mjs 动态战斗性能测试
  balance-sim.mjs 平衡模拟器
docs/
```

## 测试

```bash
npm test              # 单元 + 接口测试
npm run smoke         # 无头浏览器：加载→选难度→建塔→开波
npm run flow          # 端到端：波中刷新重放→遗物选择恢复→结算
npm run test:settings # 画质设置：预设/持久化/暂停恢复/损坏回退
npm run test:relics   # 遗物升级与补位 UI
npm run test:mobile   # 手机端：竖屏提示、横屏布局、触控建塔
npm run test:map      # 地图三选一、原型/词缀与入口激活
npm run test:auth     # 账号接口：注册/登录/限流/CSRF/旧令牌绑定/回退模式
npm run test:auth:ui  # 登录门槛端到端：注册→恢复码→进入大厅→退出→登录
npm run verify:browser # 依次跑全部浏览器验收
npm run perf          # 动态战斗性能（固定种子，约 1 分钟）
npm run balance       # 40 种子平衡模拟（约 20 秒）
npm run balance:write # 重写 docs/BALANCE.md
```

浏览器测试会自行启动独立服务端（临时 SQLite + 随机端口）与独立 Chrome profile，不需要线上服务，也不会污染真实玩家数据；只要求本机有 `google-chrome`。

## 部署（systemd）

```bash
sudo cp deploy/rogue-td.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rogue-td
sudo systemctl status rogue-td
```

查看日志：`journalctl -u rogue-td -f`。

升级代码后需要 `sudo systemctl restart rogue-td` 以加载服务端改动（前端静态文件即时生效）；重启前建议先 `npm run backup`。

## 公网访问（Cloudflare Tunnel）

- 地址：**https://game.leyanwc.xyz**
- Cloudflare DNS 自动生成 CNAME 并代理；根域名 `leyanwc.xyz` 未改动。
- 服务：`cloudflared-rogue-td.service`（开机自启，作为 `wenjin` 运行）。
- 配置：`/home/wenjin/.cloudflared/config.yml`
- 凭据：`/home/wenjin/.cloudflared/cert.pem` 与 `<tunnel-id>.json`，权限 600/400，**不提交仓库**。
- 服务器不开放 80/443 入站，Cloudflare Tunnel 只使用出站连接。
- 重建步骤：先恢复 `rogue-td`，再安装 `deploy/cloudflared-rogue-td.service`，确保两个服务均 active。
- 公网访问需要注册/登录；如需再加一层访问限制，可在 Cloudflare Zero Trust 中配置 Access 策略。

## 安全

- 漏洞报告与安全模型见 [SECURITY.md](SECURITY.md)。
- 运行时数据（`server/data/`）权限 `700/600`，systemd 设置 `UMask=0077`；数据库与备份永不入库。
- 建议：通过 TLS 反向代理/隧道暴露；配置随机 `AUTH_IP_SALT`；朋友注册完成后 `REGISTRATION_MODE=closed`；SSH 仅密钥登录。

数据备份（在线一致性快照，无需停服）：

```bash
npm run backup                    # 写入 backups/game-<时间戳>.db
npm run backup -- /path/to.db     # 指定目标（不会覆盖已存在文件）
```

备份使用 SQLite `VACUUM INTO`，不会受到 WAL 未落盘的影响。

## 账号与登录

- **必须注册账号才能进入游戏**；打开页面未登录时只显示登录/注册页。
- 注册开放、无邀请码、无邮箱验证；按 IP 限流（注册 5 次/小时，登录失败 5 次/15 分钟）。
- 密码使用 Node 内置 scrypt 哈希；会话使用 HttpOnly + SameSite=Lax Cookie，数据库只存令牌哈希。
- 进度（星核、解锁、统计、进行中远征）跟随账号，可在其他设备登录继续。
- 注册时展示一次恢复码；忘记密码可用「用户名 + 恢复码」重置，恢复码使用后自动轮换。
- 旧匿名令牌玩家：用原来保存过进度的浏览器打开，登录页会显示「绑定老账号并保留进度」，设置用户名密码即可原地迁移；绑定后旧令牌立即失效。
- 关键环境变量：
  - `AUTH_ENABLED=1`（默认）：账号模式；设为 `0` 可回退旧的 `x-player-token` 匿名模式。
  - `REGISTRATION_MODE=open|closed`（默认 `open`）：`closed` 仅用于紧急关闭注册，不使用邀请码。
  - `AUTH_IP_SALT=<random>`：IP 哈希盐，生产建议设置。
  - `COOKIE_SECURE=1`：强制 Secure Cookie；在 Cloudflare 后面通常由 `X-Forwarded-Proto` 自动识别 HTTPS。
- 首次启动会自动执行数据库迁移，并在 `server/data/backups/` 生成迁移前快照（`DB_BACKUP=0` 可跳过）。
- 账号接口：`/api/auth/register|login|logout|me|legacy|claim|password|recovery`；公开配置 `/api/config`。

## 已知边界

- 单机/小圈子使用，必须注册账号；不再提供匿名游客游玩。
- 战斗模拟在客户端进行，服务端做波次放行/清波确认、数值封顶与结算校验，不追求强反作弊。
- 排行榜合并三档难度，深渊 1.5× 分数倍率会带来榜位优势（评审时的取舍）。
- 首版不做无尽模式、多人联机、移动端触控深度适配。
- 平衡数值最后定版为 v1.7 复测（40 种子 × 每种子 3 张候选地图）；v1.8 新增塔/地图原型/词缀后**尚未复测**，`docs/BALANCE.md` 仍是旧数据。机器人策略固定，真人校准按 `docs/PLAYTEST.md` 记录。
- 旧存档（v2，仅遗物 ID）会按 Ⅰ 级恢复；旧进行中远征的波次状态保守回退一波。
- 性能数据来自无头 Chrome 软件渲染（`--disable-gpu`），不代表真实 GPU/移动设备；详见 `docs/PERFORMANCE.md`。
