# 发布流程

把发版动作固化成仓库内脚本 `scripts/release.mjs`，避免手工改版本号、误打 tag。
脚本零第三方依赖，默认 **dry-run**：任何写操作都要显式加 `--yes`。

版本号只有一个事实来源组合：`server/config.mjs` 的 `CONTENT_VERSION`、`CHANGELOG.md`
的顶部条目、`docs/PRD.md` 的修订记录，三者必须与 git tag 一致。`package.json` 的
`version` 是独立包版本，只要求是合法 semver。

## 前置条件

- Node ≥ 22.5（仓库既有要求）。
- 在源仓库里操作，且有 `git`。发布树本身不含 `.git`，不能在其中校验 tag。
- 发版从 `develop` 出发布分支；`main` 只接受 PR 合入（见 `CONTRIBUTING.md`）。

## 标准流程

```bash
# 0. 从最新 develop 切发布分支
git switch develop && git pull --ff-only
git switch -c release/v1.14.0

# 1. 预览版本标记改动（dry-run，不写文件）
node scripts/release.mjs prepare v1.14.0 --date 2026-10-24

# 2. 确认后写入 CONTENT_VERSION / CHANGELOG / PRD
node scripts/release.mjs prepare v1.14.0 --date 2026-10-24 --yes

# 3. 手工补全 CHANGELOG 条目正文与 PRD 修订说明（脚本只写占位「待补充。」）
$EDITOR CHANGELOG.md docs/PRD.md

# 4. 本地全量检查
npm test
npm run check:version

# 5. 提交并推送发布分支，创建 PR
git add server/config.mjs CHANGELOG.md docs/PRD.md
git commit -m "release: v1.14.0 — 摘要"
git push -u origin release/v1.14.0
gh pr create --base main --head release/v1.14.0 --title "release: v1.14.0" --body "发布说明"

# 6. PR 合入后，在 main 的最新提交上打 tag 并推送
git switch main && git pull --ff-only
node scripts/release.mjs verify v1.14.0     # 此时还没有 tag，会提示找不到 tag —— 预期
git tag v1.14.0
git push origin v1.14.0

# 7. 最终校验：工作树与 tag 提交必须一致
node scripts/release.mjs verify v1.14.0

# 8. 生成仅代码的发布树（默认 dry-run）
node scripts/release.mjs build v1.14.0 --ref develop
node scripts/release.mjs build v1.14.0 --ref develop --yes --out ../abyss-tower-release/v1.14.0
```

## 子命令

### `prepare <version>`

校验当前仓库的版本标记是否自洽，然后更新到目标版本：

| 文件 | 改动 |
| --- | --- |
| `server/config.mjs` | `CONTENT_VERSION` 的值 |
| `CHANGELOG.md` | 在顶部插入 `## vX.Y.Z — YYYY-MM-DD` 与占位条目 |
| `docs/PRD.md` | 修订记录第一条插入 `  - vX.Y.Z 待补充。` |

- 默认 dry-run，只打印将要做出的改动。
- `--yes` 才写文件；`--date YYYY-MM-DD` 固定 CHANGELOG 日期（默认今天）。
- 目标版本必须不低于当前版本；低于当前版本会失败并点名两个值。
- 当前仓库本身不自洽（三处版本对不上）时直接失败，不做任何写入。
- 已有的条目不会被覆盖：目标版本已经存在时对应文件保持不变。

### `build <version>`

从 `--ref`（默认 `develop`）生成只包含代码与文档的发布树：

- 先用 `git show` 校验来源 ref 的版本标记与目标版本一致，不一致则失败，不创建目录。
- 通过 `git worktree add --detach` 创建树，然后删除 `tasks/`、`goals/`、`.quay/`
  （任务板属于本地工作流，不进发布产物），并移除 `.git` 文件使其成为独立目录。
- 默认输出到 `<仓库目录名>-release/<version>`；用 `--out` 指定其他位置。
- 默认 dry-run；`--yes` 才创建。输出目录已存在且非空时拒绝执行。
- 停止条件：来源 ref 不存在、版本不一致、输出目录非空。失败时点名具体文件与值。

### `verify <version>`

只读校验，任何一项不满足都以退出码 1 结束，并点名文件与值：

1. 当前工作树的 `CONTENT_VERSION`、CHANGELOG 顶部版本、PRD 修订记录都等于目标版本；
2. `package.json` 的 `version` 是合法 semver；
3. `vX.Y.Z` tag 存在；
4. **tag 指向的提交**里的上述版本标记也等于目标版本（用 `git show` 读取，不依赖工作树）。

第 4 项专门拦截「tag 打在了版本号还没更新的提交上」这类历史事故。脚本不要求 tag
指向当前 `HEAD`：`verify` 可以在发布分支或 `main` 之外的任意提交上检查既有 tag。

## 限制与注意事项

- **不做远端操作**：脚本不 push、不建 PR、不打 tag。PR 与 tag 是刻意保留的人工步骤，
  便于复核。
- **CI 文件需要 workflow scope**：若发布包含 `.github/workflows/*.yml` 的改动，推送
  所用 GitHub token 必须具备 `workflow` scope，否则 GitHub 会拒绝接收；本仓库一律走
  SSH 推送，不受该限制影响，但用其他凭据的协作者需要注意。
- **发布树没有 `.git`**：不能在发布树内运行 `verify` 或 `build`。需要校验时回到源仓库。
- **不做版本递增推断**：`prepare` 只接受显式版本号，不会自动决定 major/minor/patch。
- **只维护三处标记**：新增版本来源文件时必须同步修改 `scripts/release.mjs` 的
  `readVersionSources` 与 `collectSourceErrors`，否则校验会漏掉它。
- **与 `check-version.mjs` 的分工**：`npm run check:version`（`scripts/check-version.mjs`）
  是 CI / pre-push 用的只读自洽检查，额外要求 tag 指向当前 `HEAD`；`release.mjs verify`
  面向发布流程，额外核对 tag 提交内容，不要求 tag == HEAD。
- **零第三方依赖**：只使用 Node 内置模块与系统 `git`。
