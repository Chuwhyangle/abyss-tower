---
id: AC-006
title: quay 运行时忽略项已入库
status: achieved
kind: criterion
goal: GOAL-001
criterion: git show HEAD:.gitignore | grep -q '^\.quay/\*' || { echo
  'CAUSE=runtime ignore block missing from HEAD:.gitignore' >&2; exit 1; }
expect: exit 0
origin: GOAL-001 范围：提交 quay 运行时忽略项
activatedAt: 2026-10-26T03:39:03.051Z
statusLog:
  - at: 2026-10-26T03:52:36.123Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
