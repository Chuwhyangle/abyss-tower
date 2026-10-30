---
id: AC-013
title: hitstop 与定向震屏、镜头冲击受设置护栏且确定性不变
status: achieved
kind: criterion
goal: GOAL-005
criterion: node --test tests/hitstop.test.mjs
expect: exit 0
origin: GOAL-005 退出条件：reduced-motion 或关闭震屏时仍保留非运动反馈，模拟结果不变。
activatedAt: 2026-10-27T01:51:43.713Z
statusLog:
  - at: 2026-10-27T05:35:54.767Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
