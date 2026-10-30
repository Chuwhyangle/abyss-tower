---
id: AC-062
title: 设计定稿：PHASE_META 机制/数值/字段契约/AC 映射
status: active
kind: criterion
goal: GOAL-012
criterion: test -s docs/PHASE_META.md && grep -q '字段契约' docs/PHASE_META.md &&
  grep -q 'AC 映射' docs/PHASE_META.md && grep -q 'GOAL-012' docs/PHASE_META.md
expect: exit 0
origin: GOAL-012 退出条件 1：先文档后开发，设计定稿成唯一冻结表
activatedAt: 2026-10-30T08:06:20.104Z
statusLog:
  - at: 2026-10-30T08:06:20.104Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-30T08:06:20.103Z
---
