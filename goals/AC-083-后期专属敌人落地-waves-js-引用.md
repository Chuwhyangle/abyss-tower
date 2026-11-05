---
id: AC-083
title: 后期专属敌人落地（waves.js 引用）
status: draft
kind: criterion
goal: GOAL-017
criterion: grep -q 'enemies-late\|lateEnemies\|LATE_ENEMIES'
  public/js/shared/waves.js || { echo "后期专属敌人未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-017 退出条件 3：敌人节奏扩充（后期专属敌人）
---
