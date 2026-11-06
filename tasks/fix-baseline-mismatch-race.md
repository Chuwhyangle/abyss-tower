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

- [ ] 连续多轮 worker 结果中 exited-not-landed 的 BASELINE-MISMATCH 占比显著下降（目标 <10%）
- [ ] fan-in 日志不再出现「develop is NOT a continuation of main」
- [ ] main 与 develop 不再长期分叉（或明确记录两者关系）
- [ ] 不孤儿化 develop 独有代码

## DoD

- [ ] 落地于 quay 配置/脚本或本仓库的 fan-in 流程（按方案 1/2/3 之一）
- [ ] 不改 sim/游戏逻辑

## Touches

- `tasks/fix-baseline-mismatch-race.md`

## Notes

立案 2026-11-06，源自审计 agent 的 P0-1 发现。这是整条流水线吞吐的头号杀手（43% 失败），比任何单个功能都重要。需要 quay 侧或仓库 fan-in 流程的改动——若涉及 plugin 源码，可能需要上游 quay 修复。