---
id: AC-089
title: 阶段2 css 分区落地（tokens.css）
status: draft
kind: criterion
goal: GOAL-020
criterion: test -s public/css/tokens.css || { echo "css 分区未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-020 退出条件 2：阶段2 拆 styles.css（tokens.css）
---
