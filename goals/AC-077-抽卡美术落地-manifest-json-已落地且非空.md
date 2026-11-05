---
id: AC-077
title: 抽卡美术落地（manifest.json 已落地且非空）
status: draft
kind: criterion
goal: GOAL-015
criterion: test -s public/assets/gacha/manifest.json || { echo "抽卡美术
  manifest.json 未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-015 退出条件 4：美术资源落本地 + manifest + SOURCES
---
