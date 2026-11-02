---
id: BASE-001
title: 确认开发基线为 v1.31.0
status: done
labels: []
parent: null
children: []
extra:
  acceptance: git merge-base --is-ancestor abe054a HEAD && npm test
goal_ac: AC-001
---
## 背景

人要求把上游改动合并进开发基线，并在最新基线上继续开发。本地 main 已 fast-forward 到 `abe054a`（包含 UI 提交 `6d880bf` 与上游 release v1.31.0）。本仓库的 quay 状态（tasks/goals/.quay）按仓库既有约定只保留在本地，不入库，因此本任务不产生代码提交。

## 要求

- 确认 `main` 与 `origin/main` 一致，`abe054a` 是 HEAD 的祖先。
- 全量测试通过。

## Touches

- （无代码改动）

## Acceptance Criteria

- [ ] `git merge-base --is-ancestor abe054a HEAD` 成立
- [ ] `npm test` 全绿

## Definition of Done

- [ ] 验收命令通过并记录证据
