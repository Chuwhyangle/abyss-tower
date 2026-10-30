---
id: gap-goals-gitignore-untracked
title: 修复 .gitignore：goals/*.md 进版本库（镜像 tasks 修法）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`.gitignore` 第 48 行 `goals/` 整目录忽略，导致 goals/ 下 70+ 个 goal 文件（GOAL-001~012 及 AC-001~065）零 git 跟踪：fan-in 的 doc-surface 只判已提交 diff，goals 的改动进不了校验面。tasks 已修好同型问题（`.gitignore` 用 `tasks/*` + `!tasks/*.md`，101 个 .md 全跟踪），goals 漏修。

修法镜像 tasks：`.gitignore` 把第 48 行 `goals/` 改成 `goals/*`，紧接其后加 `!goals/*.md` 例外（`goals/*.lock` 仍被 `goals/*` 覆盖忽略），然后 `git add -f` 全部历史 goals/*.md 并提交；此后新 goal 文件可普通 `git add`、无需 `-f`。

## AC

- [ ] `.gitignore` 例外落地：`grep -qE '^goals/\*$' .gitignore && grep -qE '^!goals/\*\.md$' .gitignore` exit 0
- [ ] 历史 goal 全部进 git 跟踪：`git ls-files 'goals/*.md' | wc -l` ≥ 70
- [ ] 文档所有权门禁不回归：`node scripts/check-doc-ownership.mjs` exit 0
- [ ] 全量测试不回归：`npm test` exit 0

## DoD

`.gitignore` 例外已落地并提交；70+ 个历史 goals/*.md 进 git 跟踪（`git ls-files 'goals/*.md' | wc -l` ≥ 70）；新 goal 文件 `git add` 无需 `-f`；tasks 跟踪不受影响（`git ls-files 'tasks/*.md' | wc -l` 仍为 101）。

## Touches

- `.gitignore`
- `tasks/gap-goals-gitignore-untracked.md`
