---
id: AC-074
title: 抽卡数据层落地（gacha.js 已落地且非空）
status: draft
kind: criterion
goal: GOAL-015
criterion: test -s public/js/shared/data/gacha.js || { echo "抽卡数据层 gacha.js 未落地"
  >&2; exit 1; }
expect: exit 0
origin: GOAL-015 退出条件 1：数据层落地（gacha.js + towers-rarity.js + 迁移 0012_gacha）
---
