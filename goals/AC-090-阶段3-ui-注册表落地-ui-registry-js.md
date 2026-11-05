---
id: AC-090
title: 阶段3 UI 注册表落地（ui/registry.js）
status: draft
kind: criterion
goal: GOAL-020
criterion: test -s public/js/ui/registry.js || { echo "UI 注册表未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-020 退出条件 3：阶段3 UI 面板注册表
---
