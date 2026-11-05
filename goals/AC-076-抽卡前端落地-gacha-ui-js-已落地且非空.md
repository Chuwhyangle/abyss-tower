---
id: AC-076
title: 抽卡前端落地（gacha-ui.js 已落地且非空）
status: draft
kind: criterion
goal: GOAL-015
criterion: test -s public/js/ui/gacha-ui.js || { echo "抽卡前端 gacha-ui.js 未落地"
  >&2; exit 1; }
expect: exit 0
origin: GOAL-015 退出条件 3：前端全屏抽卡页可进可退
---
