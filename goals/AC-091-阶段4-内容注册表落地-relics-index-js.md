---
id: AC-091
title: 阶段4 内容注册表落地（relics/index.js）
status: draft
kind: criterion
goal: GOAL-020
criterion: test -s public/js/shared/data/relics/index.js || { echo "relics
  注册表未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-020 退出条件 4：阶段4 内容注册表拆分（relics/index.js）
---
