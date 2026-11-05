---
id: AC-092
title: 阶段5 sim hook 总线落地（hooks.js）
status: draft
kind: criterion
goal: GOAL-020
criterion: test -s public/js/shared/hooks.js || { echo "sim hook 总线未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-020 退出条件 5：阶段5 sim 战斗 hook 总线
---
