---
id: GOAL-013
title: 内容与成长扩展：关卡节点化 + 天赋树重做 + 新型怪物 + 立绘遗物图
status: active
kind: goal
origin: 人 2026-11-04：在 v1.34 之上做一版内容与成长扩展，解决「重复度高、无成长感、缺美术内容」
activatedAt: 2026-11-04T03:56:53.352Z
statusLog:
  - at: 2026-11-04T03:56:53.352Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

v1.34 落地了独塔重做/天赋树接线/爬塔/测试体系。用户 2026-11-04 反馈四点：① 天赋数值无感需重做；② 关卡设计重复度高无亮点；③ 以 4~5 关为一个节点、每节点独立特色；④ 难度要持续爬升；并要求加速并行、补怪物线与美术线（立绘+遗物图）。本 goal 覆盖这四条线，各配一条 AC（AC-068~071）。

## 范围

1. **关卡节点化**（TODO-15）：30 波切 6 节点 × 5 波，每节点独立主题（敌人池 + 词缀 + 首领变体），难度曲线「节点内 1.13 + 边界 ×1.22」、首领「1.55 单调台阶 + final ×2.0」。
2. **天赋树重做**（TODO-14）：三层节点（数值 +1%/级 / 解锁 / 质变）+ 成本阶梯 + 死节点修复（skillCd/skillPower 接线）+ 零 meta 基线重排让 balance 收绿。
3. **新型怪物**（TODO-16）：新增 7 种敌人（skywing/bastion/mender/bomber/stalker/riftcaller/shieldbreaker），各带独特机制。
4. **立绘 + 遗物图**（TODO-17）：程序化塔/敌人/首领立绘 + 遗物图标，走 sprite 管线，语义验收交玩家。

## 非目标

- 不改 `sim.js` RNG 调用顺序与确定性（各线都声明红线）。
- 不做读图评审（用户已定语义验收交玩家）；不做第二货币/内购。
- 天赋数值的可感知以「重排零 meta 基线」腾头寸为手段，不放开三档目标区间。

## 退出条件

- AC-068 关卡节点化落地：`node --test tests/nodes.test.mjs` exit 0。
- AC-069 天赋树重做落地：`node --test tests/meta-tree.test.mjs tests/meta-balance-targets.test.mjs` exit 0（balance 收绿）。
- AC-070 新型怪物落地：`node --test tests/enemies-depth.test.mjs tests/waves.test.mjs` exit 0。
- AC-071 立绘 + 遗物图落地：`node --test tests/sprite-coverage.test.mjs tests/render-budget.test.mjs` exit 0。
