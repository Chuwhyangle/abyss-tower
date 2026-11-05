---
id: AC-082
title: 爬塔 elite 节点落地（tower-elite.js）
status: draft
kind: criterion
goal: GOAL-017
criterion: test -s public/js/shared/data/tower-elite.js || { echo "elite
  节点数据未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-017 退出条件 2：爬塔 elite 节点补内容
---
