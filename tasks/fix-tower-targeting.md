---
id: fix-tower-targeting
title: 索敌开火时刻重选目标 + 冻结飞行怪可被地面塔攻击
status: done
labels:
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs
    tests/tower-evolution.test.mjs tests/combat.test.mjs
    tests/towers-depth.test.mjs
---
## Proposal

两个塔索敌问题一并修（同文件 `public/js/sim/tower-system.js`）：①「最靠基地优先」失效——`findTarget`（40-53 行）规则正确（射程内 progress 最大），但 `updateTowers`（24-27 行）锁死目标不重选，正打中等进度肉盾时不切换去打 90% 进度快怪；② 地面塔（炮台 `groundOnly`）打不到飞行怪（翼魔），「独塔为王」+炮台对飞行怪无解。修复：① 开火时刻（`cd<=0`）用 `findTarget` 重新选目标，排序口径 progress 降序 + id 升序（与 `skill-system.js` 的 `skillTargets` 一致，确定性可测），只在开火瞬间重选避免每帧抖动；② `findTarget` 地面塔判定改为 `groundOnly && flying && !frozen`（冻结中的飞行怪可被地面塔打，`enemy-system.js:30` 的 `freezeUntil` 判定复用），渲染浮空表现不变。

## AC

- [ ] 塔开火时重选当前 progress 最大目标；出现更靠基地的敌人时下一发切换目标
- [ ] 目标选择排序确定性：progress 降序 + id 升序
- [ ] 冻结中的飞行怪可被 groundOnly 塔锁定与命中；未冻结的飞行怪仍不可被地面塔打
- [ ] `node --test tests/hex-one-tower.test.mjs tests/tower-evolution.test.mjs tests/combat.test.mjs tests/towers-depth.test.mjs` exit 0

## DoD

- [ ] 修复落地于 `public/js/sim/tower-system.js`，不引入新依赖
- [ ] 新增/扩展回归测试：锁目标切换、冻结飞行怪可被地面塔打
- [ ] `npm test` 全绿；补跑 `node --test tests/hex-one-tower.test.mjs tests/combat.test.mjs tests/towers-depth.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/sim/tower-system.js`
- `tests/hex-one-tower.test.mjs`
- `tests/combat.test.mjs`
- `tasks/fix-tower-targeting.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-5 + TODO-2（同文件 `tower-system.js`，合并为一个任务避免文件冲突）。
