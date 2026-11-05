---
id: AC-081
title: 无尽模式 60 波后内容落地（endless.js）
status: draft
kind: criterion
goal: GOAL-017
criterion: test -s public/js/shared/data/endless.js || { echo "无尽词缀数据未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-017 退出条件 1：无尽模式 60 波后词缀/首领循环（实现落为 endless.js）
---
