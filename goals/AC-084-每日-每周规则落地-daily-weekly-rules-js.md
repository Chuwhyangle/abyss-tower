---
id: AC-084
title: 每日/每周规则落地（daily-weekly-rules.js）
status: draft
kind: criterion
goal: GOAL-018
criterion: test -s public/js/shared/data/daily-weekly-rules.js || { echo
  "每日每周规则数据未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-018 退出条件 1：每日/每周挑战加新规则
---
