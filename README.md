# 渊塔守卫 · Abyss Tower

单人肉鸽塔防网页游戏。固定 30 波通关，三档难度，每波结束三选一遗物，星核永久解锁。
前后端同仓库：浏览器负责实时战斗渲染，Node 服务端负责地图/波次/遗物生成、存档与排行榜。

- 需求文档：[docs/PRD.md](docs/PRD.md)
- 技术设计：[docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)
- 平衡模拟记录：[docs/BALANCE.md](docs/BALANCE.md)

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
- 每 5 波一个首领，第 30 波为最终首领。
- 结算获得星核，在星核商店永久解锁电弧塔、毒雾塔与初始加成。
- 每波结束自动存档，刷新页面可「继续上一局」。

快捷键：`1`–`5` 选塔，`U` 升级，`S` 出售，`空格` 暂停，`Esc` 取消。

## 三档难度（机器人全解锁口径）

| 难度 | 敌人生命 | 敌人数量 | 初始金币 | 基地生命 | 分数倍率 | 通关率 |
|---|---|---|---|---|---|---|
| 漫游 | ×0.94 | ×0.94 | +60 | +5 | ×0.80 | 约 85% |
| 远征 | ×1.08 | ×1.04 | — | — | ×1.00 | 约 45% |
| 深渊 | ×1.18 | ×1.08 | −20 | −3 | ×1.50 | 约 10% |

每日挑战：所有人同一套地图/波次/遗物种子，开局自选难度，每天最多结算 3 次。
排行榜为合并榜，按最终分数排序，展示难度标签。

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
    ui.js         HUD / 商店 / 弹窗
    api.js        接口封装
    audio.js      合成音效
    shared/       前后端共享：RNG / 地图 / 波次 / 数值 / 难度 / 计分
server/
  index.mjs       HTTP 服务与业务接口
  db.mjs          SQLite 连接、建表与迁移
  data/game.db    运行时数据库（自动创建）
tests/
  *.test.mjs      单元与接口测试
  browser-*.mjs   无头浏览器冒烟 / 端到端流程
  balance-sim.mjs 平衡模拟器
docs/
```

## 测试

```bash
npm test        # 单元 + 接口测试
npm run smoke   # 无头浏览器：加载→选难度→建塔→开波
npm run flow    # 端到端：三选一→刷新续玩→退出→排行榜/商店→结算
npm run balance # 20 种子平衡模拟（约 20 秒）
```

浏览器测试要求本机有 `google-chrome`，且服务已启动。

## 部署（systemd）

```bash
sudo cp deploy/rogue-td.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rogue-td
sudo systemctl status rogue-td
```

查看日志：`journalctl -u rogue-td -f`。

数据备份（在线一致性快照，无需停服）：

```bash
npm run backup                    # 写入 backups/game-<时间戳>.db
npm run backup -- /path/to.db     # 指定目标（不会覆盖已存在文件）
```

备份使用 SQLite `VACUUM INTO`，不会受到 WAL 未落盘的影响。

## 已知边界

- 单机/小圈子使用，无账号密码，仅用浏览器本地匿名令牌识别玩家。
- 战斗模拟在客户端进行，服务端做波次放行、数值封顶与结算校验，不追求强反作弊。
- 排行榜合并三档难度，深渊 1.5× 分数倍率会带来榜位优势（评审时的取舍）。
- 首版不做无尽模式、多人联机、移动端触控深度适配。
- 平衡数值为 M2 模拟定版 v1，M4 仍可根据真人试玩微调（集中在 `shared/config.js` 与 `data.js` 的 `DIFFICULTIES`）。
