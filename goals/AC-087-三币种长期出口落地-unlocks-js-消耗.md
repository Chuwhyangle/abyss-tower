---
id: AC-087
title: 三币种长期出口落地（unlocks.js 消耗）
status: draft
kind: criterion
goal: GOAL-019
criterion: grep -q 'sink\|升星\|star' public/js/shared/data/unlocks.js || { echo
  "三币种出口未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-019 退出条件 2：局外三币种长期出口
---
