---
id: AC-088
title: 阶段0 安全网落地（touches-conflict.mjs）
status: draft
kind: criterion
goal: GOAL-020
criterion: test -s scripts/touches-conflict.mjs || { echo "安全网冲突预检脚本未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-020 退出条件 1：阶段0 安全网（touches-conflict.mjs）
---
