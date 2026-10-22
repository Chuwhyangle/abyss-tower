# 渊塔守卫 · Abyss Tower

单人肉鸽塔防网页游戏。固定 30 波通关，三档难度，每波结束三选一遗物，星核永久解锁。
前后端同仓库：浏览器负责实时战斗渲染，Node 服务端负责地图/波次/遗物生成、存档与排行榜。

- 需求文档：[docs/PRD.md](docs/PRD.md)
- 技术设计：[docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)
- 地图设计：[docs/MAP_DESIGN.md](docs/MAP_DESIGN.md)
- 平衡模拟记录：[docs/BALANCE.md](docs/BALANCE.md)
- 动态性能记录：[docs/PERFORMANCE.md](docs/PERFORMANCE.md)

## 快速开始

```bash
cd /home/wenjin/rogue-td
npm start
```

打开 `http://localhost:8787`（局域网用 `http://<服务器IP>:8787`）。

- 无需安装依赖，要求 Node.js ≥ 22.5（使用内置 `node:sqlite`）。
- 默认监听 `0.0.0.0:8787`，可用环境变量 `PORT` / `HOST` / `DB_PATH` 覆盖。

## 玩法

- 点击底部塔卡 → 点击空地建造；点击已建塔可升级/出售（返还 70%）。
- 击退 30 波即通关；基地生命归零则远征失败。
- 每波结束从三件遗物中选一件（可花 25 金币刷新，次数有限）。
- 遗物最多 Ⅲ 级：重复选中会升级并展示「Ⅰ → Ⅱ」及前后效果；满级退出候选池，池尽时提供金币/修复补位。
- 每局开局从 **3 张候选地图** 中选一张：单径峡谷 / 双径汇流 / 三径裂隙 / 环形回廊 / 交叉回廊，并附带 1 个词缀（富矿 / 疾风 / 薄雾 / 裂界）。
- 中后期会有多个传送门同时出怪，需要覆盖汇流点与不同路线；首领波与第 30 波全入口开启。
- 每 5 波一个首领，第 30 波为最终首领。
- 结算获得星核，在星核商店永久解锁电弧塔、毒雾塔与初始加成。
- 每波开始前与清波后自动存档；战斗中刷新会重放当前波，选遗物时刷新会恢复同一组选项。
- 大厅与局内均可打开画质设置（低配 / 高配 / 自定义），只影响表现，不影响战斗结果。

快捷键：`1`–`5` 选塔，`U` 升级，`S` 出售，`空格` 暂停，`Esc` 取消。

## 手机端

- **强制横屏**：进入战斗时自动尝试全屏并锁定横屏；无法锁定时显示不可跳过的旋转提示，可点“重试自动横屏”。
- 触控建造：点塔卡 → 点空地；点位靠近可建造格或已有塔时会自动吸附，降低小屏幕误触。
- HUD 提供遗物入口、全屏/横屏按钮；商店可左右滑动。
- 首次默认低配画质（30 FPS、DPR 1），可在设置中切换。
- iOS Safari 不支持网页强制旋转/全屏，只能按系统限制手动横屏；Android Chrome 通常可自动完成。

## 三档难度（机器人全解锁口径）

| 难度 | 敌人生命 | 敌人数量 | 初始金币 | 基地生命 | 分数倍率 | 机器人通关率（全解锁） |
|---|---|---|---|---|---|---|
| 漫游 | ×0.85 | ×0.87 | +60 | +5 | ×0.80 | 约 83% |
| 远征 | ×1.02 | ×1.01 | — | — | ×1.00 | 约 28% |
| 深渊 | ×1.18 | ×1.07 | −20 | −3 | ×1.50 | 约 5% |

每日挑战：所有人同一套地图/波次/遗物种子，开局自选难度，每天最多结算 3 次。
排行榜为合并榜，按最终分数排序，展示难度标签。

通关率为 40 种子、固定机器人策略的结果，不等同真人；零解锁约为 68% / 13% / 3%。机器人固定 18 塔上限、不会卖塔/针对性换塔，详见 `docs/BALANCE.md`。

## 画质设置

- 低配：30 FPS、DPR 1、精简装饰、关键飘字、关闭光晕/震动。
- 高配：60 FPS、DPR 2、完整装饰、全部飘字、开启光晕/震动。
- 自定义可逐项调整，保存到当前浏览器；损坏设置自动回退低配。
- 30 FPS 只限制绘制，战斗模拟仍按固定步长推进；局内打开设置会暂停，关闭后恢复原暂停状态。

## 技术栈

- 前端：原生 ES Module + Canvas 2D + DOM，无构建步骤、无框架、无运行时依赖。
- 后端：`node:http` + `node:sqlite` + 原生 ESM。
- 音频：WebAudio 实时合成，无音频素材。
- 测试：`node:test` + 无头 Chrome（CDP）。

```
public/
  index.html / styles.css
  js/
    main.js       页面编排、输入、存档续玩
    game-app.js   rAF 循环、渲染调度、音效
    sim.js        纯战斗模拟（Node 可直接运行）
    render.js     Canvas 绘制
    ui.js         HUD / 商店 / 弹窗 / 画质设置
    api.js        接口封装
    audio.js      合成音效
    settings.js   画质预设、持久化与回退
    shared/       前后端共享：RNG / 地图 / 波次 / 数值 / 难度 / 遗物等级 / 计分 / 存档兼容
server/
  index.mjs       HTTP 服务与业务接口
  db.mjs          SQLite 连接、建表与迁移
  data/game.db    运行时数据库（自动创建）
tests/
  *.test.mjs      单元与接口测试
  harness.mjs     隔离服务端 / Chrome / CDP
  browser-*.mjs   冒烟、续玩、遗物、设置端到端测试
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
- 公网可直接访问且无账号体系；如需限制访问，可在 Cloudflare Zero Trust 中加 Access 策略。

数据备份（在线一致性快照，无需停服）：

```bash
npm run backup                    # 写入 backups/game-<时间戳>.db
npm run backup -- /path/to.db     # 指定目标（不会覆盖已存在文件）
```

备份使用 SQLite `VACUUM INTO`，不会受到 WAL 未落盘的影响。

## 已知边界

- 单机/小圈子使用，无账号密码，仅用浏览器本地匿名令牌识别玩家。
- 战斗模拟在客户端进行，服务端做波次放行/清波确认、数值封顶与结算校验，不追求强反作弊。
- 排行榜合并三档难度，深渊 1.5× 分数倍率会带来榜位优势（评审时的取舍）。
- 首版不做无尽模式、多人联机、移动端触控深度适配。
- 平衡数值为 v1.3（40 种子）定版；机器人策略固定，若需要更贴近真人，应在 M4 用真人试玩继续校准。
- 旧存档（v2，仅遗物 ID）会按 Ⅰ 级恢复；旧进行中远征的波次状态保守回退一波。
- 性能数据来自无头 Chrome 软件渲染（`--disable-gpu`），不代表真实 GPU/移动设备；详见 `docs/PERFORMANCE.md`。
