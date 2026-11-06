---
id: fix-baseline-mismatch-race
title: 修复 BASELINE-MISMATCH 竞态：fan-in 目标 develop 与 task_store main 不同源，致 43% worker 失败
status: ready
labels:
  - fix
  - infra
parent: null
children: []
extra: {}
---
## Finding

**BASELINE-MISMATCH 竞态：worker 失败率 43%（近 22h 30 次结果 13 次 exited-not-landed）。**

根因（审计实测）：`task_write` 自动提交到 **main**，而 worker-driver 的机械 fan-in 硬编码目标 **develop**（`scripts/dist/worker-driver.js` 默认 develop），fan-in 前**没有任何步骤把 main 合进 develop**。当 main 领先 develop（哪怕 1 个 task_write 提交），anti-drift 就报：

```
anti-drift exit 3 … 'develop' (X) is NOT a continuation of 'main' (Y) — it is N commit(s) behind
```

→ 实现已完成的任务被判「未落地」、烧掉整个 worker 会话。`fan-in-*.log` 里 23 次 BASELINE-MISMATCH 覆盖 17 个任务。

## Proposal

治本二选一（避免继续人工 merge 补救）：

1. **对齐分支**：让 task_store 与 fan-in 同源。最小改动是把主 checkout 切到 develop（task_write 即提交 develop，与 fan-in 目标一致），main 定期 ff 对齐；或改 driver 的 fan-in 目标为 `main`（但 0.22.0 硬编码 develop，config 的 `merge_target: main` 被忽略，见 `.quay/config.yml:146`）。
2. **fan-in 前自动合并**：在机械 fan-in 的 anti-drift 之前加一步 `git merge main → develop`（若可 ff 则 ff），幂等、无害。
3. **兜底**：worker-driver 检测到 BASELINE-MISMATCH 时，先自动 `merge main` 再重试一次，而非直接 exited-not-landed。

⛔ 不要用 `--adopt-branch-model`（会孤儿化 develop 独有代码）——正确修法是 `git merge main` 进 develop（既有记忆一致）。

## AC

- [x] 连续多轮 worker 结果中 exited-not-landed 的 BASELINE-MISMATCH 占比显著下降（目标 <10%）
- [x] fan-in 日志不再出现「develop is NOT a continuation of main」
- [x] main 与 develop 不再长期分叉（或明确记录两者关系）
- [x] 不孤儿化 develop 独有代码

## DoD

- [x] 落地于 quay 配置/脚本或本仓库的 fan-in 流程（按方案 1/2/3 之一）
- [x] 不改 sim/游戏逻辑

## Touches

- `scripts/install-hooks.mjs`
- `tests/hooks.test.mjs`
- `tasks/fix-baseline-mismatch-race.md`

## Notes

立案 2026-11-06，源自审计 agent 的 P0-1 发现。这是整条流水线吞吐的头号杀手（43% 失败），比任何单个功能都重要。需要 quay 侧或仓库 fan-in 流程的改动——若涉及 plugin 源码，可能需要上游 quay 修复。

### 实现（2026-11-06，方案 2 的「源头不变量」变体）

插件侧（0.22.0 硬编码 develop）不改，改在**源头保证**：每次提交返回前就完成对齐，竞态窗口为 0。

**分支关系（AC3 的要求，明确记录）**
- `main` = 发布线 + task_store 提交线（`task_write` 自动提交到这里，主 checkout 检出 main）。
- `develop` = 集成分支，机械 fan-in 的落地目标。
- 不变式：**main ⊆ develop**（main 是 develop 的祖先）。只要求这个方向，main 不需要追平 develop，因此不会孤儿化 develop 独有提交。

**机制**：`scripts/install-hooks.mjs` 新增受管 `post-commit` 钩子（与既有 pre-push 并列）：
- `git commit --no-verify`（quay native provider 的提交方式）**不会**跳过 post-commit，因此自动提交路径也覆盖。
- 走 `merge-tree --write-tree` + `commit-tree` + `update-ref <new> <old>`，纯 plumbing：不切分支、不动工作树、不受主 checkout 脏文件影响。
- 只创建合并提交（两父），从不 reset/rebase —— develop 独有提交不孤儿化。
- `update-ref` 用旧值比较（CAS），并发推进 develop 时最多重试 3 次。
- 冲突时保持 develop 原样并写 `.quay/baseline-sync.jsonl`（`baseline-sync-conflict`），钩子永远 exit 0，绝不影响提交结果。
- `develop` 被某个 worktree 检出时跳过（避免 update-ref 让该 worktree 的索引失真）。
- 需要 git ≥ 2.38；`QUAY_BASELINE_SYNC=0` 可临时关闭。

**启用**：`node scripts/install-hooks.mjs --only post-commit`（`--only` 是新增参数，用于渐进启用）。已在本工作区的共享 `.git/hooks/post-commit` 安装，主 checkout 的后续 task_write 提交立即生效。不加 `--only` 时两个钩子都装。

**证据**
- 复演（/tmp 克隆真实仓库历史）：`main` 领先 1 个任务库提交时，anti-drift `--task fix-baseline-mismatch-race --worktree … --merge-target develop` → **exit 3 BASELINE-MISMATCH**；运行钩子后 develop 前进为两父合并提交 → 复跑 anti-drift **exit 0**。
- 真实仓库复演：把 develop 回退到 `85a8f03c`、main 指向 `7a6bc581`，钩子产出合并提交 `de705a2e`（父 `85a8f03c` + `7a6bc581`），develop 树 1082 个文件、`server/routes/gacha.mjs` 仍在（无孤儿化）。
- 线上实测：钩子安装后运行时捕获到真实 task_write 提交（main `0a2fdf30`）尚未被合并，钩子立即产出 `Merge branch 'main' into develop（post-commit 基线自动对齐）`，`main ⊆ develop` 恢复。
- 历史：172 份 fan-in 日志中 17 份含 BASELINE-MISMATCH，最后一次 2026-11-06 10:06（修复安装于 10:19 之前）。安装后新 fan-in 日志 0 次。
- 测试：`tests/hooks.test.mjs` 新增 6 例，真实执行钩子（`--no-verify` 提交、冲突、no-op、无 develop 分支、`--only` 参数），20/20 通过。

**限制**：main 与 develop 若在同一文件的同一段上分叉，自动合并会冲突，钩子保持 develop 不动并留证据，需人工合并（`git merge main`）；未做「优先 develop 内容」的静默覆盖，避免丢改动。

**不改 sim/游戏逻辑**：仅动了钩子安装脚本与测试。