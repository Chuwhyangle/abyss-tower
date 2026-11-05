---
id: AC-079
title: 点功能改居中弹窗落地（图鉴 openModal）
status: draft
kind: criterion
goal: GOAL-016
criterion: grep -q 'openModal' public/js/relic-codex-ui.js || { echo
  "图鉴改居中弹窗未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-016 退出条件 2：点功能改居中弹窗
---
