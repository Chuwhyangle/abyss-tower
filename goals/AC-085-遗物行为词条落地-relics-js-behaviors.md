---
id: AC-085
title: 遗物行为词条落地（relics.js behaviors）
status: draft
kind: criterion
goal: GOAL-018
criterion: grep -q 'behaviors\|behavior' public/js/shared/data/relics.js || {
  echo "遗物行为词条未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-018 退出条件 2：遗物升级行为词条
---
