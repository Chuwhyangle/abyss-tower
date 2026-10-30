---
id: GOAL-001
title: 上游基线合并与开发基线确认
status: achieved
kind: goal
origin: 人 2026-10-24：把这些东西 merge 过来，我们在它的基础上再进行开发。
activatedAt: 2026-10-24T09:18:31.330Z
statusLog:
  - at: 2026-10-26T03:57:01.094Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

人 2026-10-24 要求把 GitHub 上游改动合并进本地开发基线，后续开发在最新基线上进行。

## 范围

- 本地 main 与 origin/main 对齐到 abe054a（包含 UI 退出入口提交 6d880bf 与上游 release v1.31.0）。
- 提交 quay 运行时忽略项，保证后续 driver 产生的运行时文件不进入版本库。

## 非目标

不改产品代码、不改玩法与数值、不新增功能。

## 退出条件

`git merge-base --is-ancestor abe054a HEAD` 成立，且全量测试通过。