# 协作开发指南

## 环境

- Node.js ≥ 22.5（使用内置 `node:sqlite`）
- 零第三方依赖，无需 `npm install`
- 本地启动：`npm start`（默认 `http://localhost:8787`）

每个开发者使用自己的本地数据库（`server/data/game.db`，已被 gitignore）。需要复现数据时用种子：

```bash
DB_PATH=/tmp/rtd-dev.db PORT=8787 npm start
```

## 分支模型

- `main`：随时可发布；只接受 PR 合入，禁止直接 push。
- 功能：`feature/<topic>`；修复：`fix/<topic>`；纯文档：`docs/<topic>`；重构：`refactor/<topic>`。
- 一个 PR 只做一件事；大改拆成可独立审查的小 PR。

```bash
git switch main && git pull
git switch -c feature/boss-abilities
# ...开发...
git push -u origin feature/boss-abilities
gh pr create --fill
```

## 合并前检查

- `npm test` 全绿（50+ 项，含接口与迁移）。
- 改到 UI/渲染/流程：再跑 `npm run smoke` / `npm run flow`（需要本机 Google Chrome）。
- 改到数值/平衡：跑 `npm run balance`，并说明对通关率的影响。
- CI 必须通过；至少 1 人 review。

## 代码约定

- **封装优先**：类/模块组织，职责单一；避免巨型文件和过程式大函数。
- **前后端共享逻辑**只放在 `public/js/shared/`，服务端直接 import。
- **`sim.js` 必须确定性**：不要改变 RNG 调用顺序；战斗结果要能复现。
- **先文档后开发**：影响玩法/接口的改动，先改 `docs/PRD.md` / `docs/TECH_DESIGN.md`。
- 公共 API（`window.__rtd`、存档键、HTTP 端点）变更需在 PR 里单独说明。

## 提交规范

`feat|fix|perf|refactor|docs|chore(scope): 摘要`

不要提交：`server/data/*.db*`、`backups/`、`.claude/`、任何密钥/令牌。
