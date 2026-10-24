# 协作开发指南

## 环境

- Node.js ≥ 22.5（使用内置 `node:sqlite`）
- 零第三方依赖，无需 `npm install`
- 本地启动：`npm start`（默认 `http://localhost:8787`）
- 浏览器验收测试默认调用 `google-chrome`；只有 Chromium 时设 `CHROME_BIN`，例如
  `CHROME_BIN=/snap/bin/chromium npm run smoke`。

每个开发者使用自己的本地数据库（`server/data/game.db`，已被 gitignore）。需要复现数据时用种子：

```bash
DB_PATH=/tmp/rtd-dev.db PORT=8787 npm start
```

## 新贡献者先读什么

按这个顺序读，能在最短时间内建立全局认识：

1. `README.md`：游戏是什么、怎么跑起来、有哪些验收命令。
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：运行时分层、数据流、确定性约束、测试分层与文件所有权。**动手前先读这一份。**
3. `docs/GLOSSARY.md`：中英文用词的正本，改文案前必读。
4. `docs/PRD.md`（做什么）与 `docs/TECH_DESIGN.md`（怎么做）：需要查具体规则、接口或数据模型时再深入。
5. `CLAUDE.md`：仓库的协作与代码约定（先文档后开发、子代理分工、封装优先）。

`docs/ARCHITECTURE.md` 是地图，`docs/PRD.md` / `docs/TECH_DESIGN.md` 是规范正本；两者冲突时以正本和代码为准。

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

## quay 本地开发

本仓库用 quay 驱动任务开发，任务 worktree 与主检出分离。

- **worktree 供给**：每个任务 worktree 需要拿到主检出里被 gitignore 的 `.quay/config.yml`
  与 `.quay/profiles.yml`，否则测试读不到 `test_command`。声明清单在 `.worktreeinclude`，
  脚本 `scripts/worktree-include.sh` 按清单复制：

  ```bash
  git worktree add ../abyss-tower-worktrees/<task-id> -b task/<task-id> develop
  bash scripts/worktree-include.sh ../abyss-tower-worktrees/<task-id>
  bash scripts/worktree-include.sh --verify ../abyss-tower-worktrees/<task-id>
  ```

  `--verify` 只检查不复制，缺文件时打印具体路径并以 exit 2 失败。

- **driver 启动**：在仓库根目录运行 `quay driver start --kind promotion` 与
  `quay driver start --kind worker`，再用 `quay serve` 打开任务板。配置见 `.quay/config.yml`
  的 `loop:` 段（`worktree_root`、`test_command`、`gates`）。

- **任务板只在本地 `develop` 线跟踪**：`tasks/`、`goals/`、`adr/`、`meta/` 与 `.quay/` 是 <!-- docs-consistency:ignore — adr/ 与 meta/ 由 quay 按需创建，干净检出中不存在 -->
  quay 的本地工作线；`main` 保持干净、只走正常发布 PR。不要从 `main` 分叉任务 worktree，
  也不要把任务板状态提交到 `main`。

## 本地推送门禁（pre-push 钩子）

CI 工作流需要带 `workflow` scope 的 token 才能推送；本地可以在推送前补上同等门禁：

```bash
node scripts/install-hooks.mjs            # 安装（幂等，可重复执行）
node scripts/install-hooks.mjs --dry-run  # 只看将写入的路径与内容
```

门禁分两级，默认级保持在 10 秒内，不拖慢日常推送：

- **默认级**：`npm run check:syntax`（语法）+ `node scripts/check-version.mjs`
  （`CONTENT_VERSION` / CHANGELOG / PRD 修订记录 / `package.json` 版本一致性）。
- **完整级**：在推送命令前加 `HOOK_FULL=1`，改跑统一入口 `npm run verify:local`
  （语法 + 风格 + 依赖图 + 版本一致性 + 全量测试）与 `npm run perf:budget`
  （性能预算快速集）：

  ```bash
  HOOK_FULL=1 git push
  ```

- 某项检查失败时，钩子会打印 `✗ <检查项>未通过` 并中止后续检查，直接指出是哪一级没过。
- 不推送时也可以直接跑 `npm run verify:local`。它与 CI 的对应关系：语法检查与
  `npm test` 在 `.github/workflows/ci.yml` 的 `test` job 里也有；风格、依赖图、版本
  一致性是本地补充门禁。浏览器验收（`npm run verify:browser`）不在其中，按需单独跑。
- 不会覆盖已有的非本工具钩子；如确认要覆盖，加 `--force`。
- 紧急绕过：`git push --no-verify`（不推荐，会跳过全部本地门禁）。

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
