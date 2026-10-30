---
id: AC-022
title: 精灵管线：加载、图集、DPR、缺资源回退
status: achieved
kind: criterion
goal: GOAL-006
criterion: node --test tests/sprite-pipeline.test.mjs
expect: exit 0
origin: GOAL-006 退出条件：四个场景全部走精灵资源，缺失资源时有程序化回退且不崩溃。
activatedAt: 2026-10-27T01:51:46.070Z
statusLog:
  - at: 2026-10-27T04:49:30.760Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
