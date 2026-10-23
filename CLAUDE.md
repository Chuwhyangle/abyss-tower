# 渊塔守卫 · 项目开发约定

单人肉鸽塔防（浏览器 Canvas 2D + Node 内置 http + node:sqlite，零第三方依赖，Node ≥ 22.5）。

## 常用命令

- `npm start` 启动（默认 0.0.0.0:8787，systemd 服务名 `rogue-td`）
- `npm test` 单元/集成测试
- `npm run smoke` / `flow` / `test:map` / `test:mobile` / `test:auth:ui` / `test:relics` / `test:settings` 浏览器验收
- `npm run perf` 动态性能记录（会重写 `docs/PERFORMANCE.md`）
- `npm run balance` / `sweep` 平衡模拟（会重写 `docs/BALANCE.md`）

## 工作方式（用户明确要求）

1. **先文档后开发**：影响玩法、数值、接口的改动，先改 `docs/PRD.md` / `docs/TECH_DESIGN.md`，再动代码。
2. **子代理并行**：开发任务拆给最多 **3 个子代理**；按文件所有权分工，禁止多个代理同时改同一文件。
3. **每 5 个版本重构一次**：到版本节点（v1.5、v2.0……）必须安排一次结构重构，力度不限，单独提交。
4. **封装优先**：新代码用类/模块组织，职责单一、边界清晰；避免巨型文件、散落的自由函数和过程式大函数。重构时保持公共 API 与行为不变。

## 代码地图与所有权

- `public/js/shared/`：服务端与浏览器共用的纯数据/纯函数（地图、波次、数值、计分）
- `public/js/sim.js`：战斗模拟。**必须保持确定性**，RNG 调用顺序不能改变
- `public/js/render*.js`：Canvas 渲染层
- `public/js/ui.js`：DOM 界面（HUD、商店、弹窗）
- `public/js/main.js`：页面编排、API 流程、输入绑定
- `server/index.mjs`：HTTP 引导与路由
- `server/auth/`、`server/db/`：认证与持久化
- `server/data/`、`backups/`：运行时数据，不入库

## GitHub 与网络

- 远端：`git@github.com:Chuwhyangle/abyss-tower.git`（SSH）
- 本服务器 **HTTPS 访问 github.com 会超时**（api.github.com 可直连）；`gh auth login --web` 也会超时。
- 推送/拉取一律走 SSH：`~/.ssh/config` 已绑定 `~/.ssh/id_ed25519_github`。
- CI：`.github/workflows/ci.yml`（84 个模块语法检查 + `npm test`），push/PR 自动运行。

## 提交前检查

- `npm test` 全绿；改到 UI/渲染时补跑对应浏览器测试。
- 不提交 `server/data/*.db*`、`backups/*.db`。
- 提交信息用中文，按 `feat/fix/perf/docs/chore(scope): 摘要` 格式。
