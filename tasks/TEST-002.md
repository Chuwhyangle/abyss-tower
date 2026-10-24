---
id: TEST-002
title: 修复测试隔离并新增稳定性门禁
status: ready
labels: []
parent: null
children: []
extra:
  acceptance: for i in 1 2 3; do node --test tests/*.test.mjs >/dev/null || { echo
    "CAUSE=full suite failed on run $i" >&2; exit 1; }; done
depends_on:
  - TEST-001
goal_ac: AC-002
---
## 背景

依赖 TEST-001 的根因结论。目标是把不稳定的测试修到可重复，并加一道可运行的稳定性门禁。

## 要求

- 修复隔离或时序问题，保证多个测试进程并行运行时互不干扰。
- 新增 `scripts/check-stability.mjs`：连续 N 次（默认 3）运行全量测试，任一次失败时输出 `CAUSE=...` 到 stderr 并以非 0 退出。
- 不修改产品行为、玩法与数值。

## Touches

- `tasks/TEST-002.md`
- `package.json`
- `scripts/check-stability.mjs`
- `scripts/test-changed.mjs`
- `scripts/test-isolation-audit.mjs`
- `tests/test-server.mjs`
- `tests/test-server.test.mjs`
- `tests/check-stability.test.mjs`
- `tests/harness.mjs`
- `tests/achievements-skills.test.mjs`
- `tests/achievements.test.mjs`
- `tests/announcement-notifications.test.mjs`
- `tests/api.test.mjs`
- `tests/bounties-depth.test.mjs`
- `tests/bounties.test.mjs`
- `tests/daily-challenge.test.mjs`
- `tests/daily-history.test.mjs`
- `tests/endless-leaderboard.test.mjs`
- `tests/endless.test.mjs`
- `tests/leaderboard-guard.test.mjs`
- `tests/leaderboard-paging.test.mjs`
- `tests/leaderboard-season.test.mjs`
- `tests/leaderboard-suspect-ui.test.mjs`
- `tests/leaderboard-titles.test.mjs`
- `tests/leaderboard.test.mjs`
- `tests/mutations.test.mjs`
- `tests/notification-batch.test.mjs`
- `tests/notification-paging.test.mjs`
- `tests/notification-prefs.test.mjs`
- `tests/notifications.test.mjs`
- `tests/season-pass-claim-all.test.mjs`
- `tests/season-pass.test.mjs`
- `tests/skills.test.mjs`
- `tests/stats.test.mjs`
- `tests/test-isolation-audit.test.mjs`
- `tests/weekly-challenge.test.mjs`

## Acceptance Criteria

- [x] 连续 3 次全量测试 0 失败
- [x] `node scripts/check-stability.mjs` 可运行且通过

## Definition of Done

- [x] 全量测试通过
- [x] 新门禁在 CI 或 package.json scripts 中可调用