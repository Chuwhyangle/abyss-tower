# 文件所有权 · 单 owner 表（OWNERSHIP）

> 并发重构·阶段 0 的单一 owner 表：**每个文件/目录只归属一条 lane**。
> `scripts/touches-conflict.mjs`（冲突预检）与 `scripts/structure-budget.allow.d/`（结构债务登记）
> 都从本表派生口径——前者在**文件粒度**执行「任何共享文件即串行」，后者按「owner = 任务 id」登记超限债务。

## 规则

1. **单 owner**：下表每个路径只归属一条 lane；一条 lane 内的文件由该 lane 的 in-flight 任务独占写。
2. **跨 lane 串行**：一个 ready 任务不得跨 lane 写文件；确需跨 lane 时，拆分任务或与对侧 lane 串行。
3. **Touches 落 lane**：任务的 `## Touches` 必须落在本任务所属 lane 内；`(new)` 文件同样要归属到某条 lane。
4. **中性区声明**：`scripts/`、`tests/`、`tasks/` 等中性区不设单一 owner，但任何共享文件的并发写仍由
   `touches-conflict.mjs` 按「≥2 个 ready 任务申明同一非 new 文件」判串行。

## 单 owner 表

| 文件/目录 | 归属 lane | 说明 |
| --- | --- | --- |
| `public/js/shared/data/` | 内容 lane | 塔/遗物/敌人/波次/数值/解锁等冻结数据的唯一来源 |
| `public/js/shared/*.js`（`data/` 与 `i18n/` 除外） | 内容 lane | 地图、波次、计分等纯数据/纯函数 |
| `docs/PHASE_*.md`、`docs/BALANCE*.json` | 内容 lane | 设计冻结表与平衡复测产物 |
| `public/js/sim.js`、`public/js/sim/` | sim lane | 确定性战斗模拟（RNG 调用顺序不可变） |
| `public/js/render.js`、`public/js/render/` | render 外壳 lane | Canvas 渲染层 |
| `public/js/ui.js`、`public/js/ui/`、`public/js/app/` | UI 外壳 lane | DOM 界面与页面编排 |
| `public/js/main.js`、`public/js/api.js`、`public/js/*-ui.js` | UI 外壳 lane | 编排、接口、各面板 UI |
| `public/styles.css`、`public/index.html` | UI 外壳 lane | 样式与入口 |
| `public/js/shared/i18n/` | i18n lane | 中英文案表 |
| `server/`（`server/data/` 运行时数据除外） | 服务端 lane | HTTP 路由、认证、持久化 |
| `scripts/`、`tests/`、`tasks/` | 共享（中性） | 工具/测试/任务库；跨 lane 改动须在 Touches 精确声明 |
| `package.json`、`.github/`、`docs/PRD.md`、`docs/TECH_DESIGN.md` | 共享（中性） | CI/依赖/总文档（总文档只由文档 lane `DOCS-*` 更新） |

## 派生口径

- **`scripts/touches-conflict.mjs`**：把上表「单 owner」落到**文件粒度**——两个 ready 任务同时申明同一非 `(new)`
  文件即判串行（比 lane 更细，任何共享文件都拦），worker 领任务前可自查会与谁串行。
- **`scripts/structure-budget.allow.d/`**：债务条目的 `owner` 必须等于 `<task-id>.json` 的文件名去掉 `.json`，
  且 `tasks/<owner>.md` 必须存在（活任务）——即「一个任务一个 owner 文件」，与单 owner 原则同构。
