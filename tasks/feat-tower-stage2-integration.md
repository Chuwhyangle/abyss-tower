---
id: feat-tower-stage2-integration
title: 爬塔·阶段2集成：端到端串通 + 难度映射定夺 + 全量/浏览器验收
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/run-lifecycle.test.mjs tests/replay.test.mjs tests/snapshot.test.mjs
---
## Proposal

爬塔阶段 1（`feat-tower-stage1-server`/`-client`/`-ui`，均 done）已分别落地服务端/客户端/UI。本任务是**阶段 2 集成收尾**：① 端到端串通「选 tower mode → 节点地图选路 → fight/event/merchant 分流 → 登顶结算」全链路，修阶段 1 三任务合流后的边界（API 形状对齐、route 恢复、旧 linear 存档缺 `ruleset.tower` 走线性分支）；② 难度映射定夺（`docs/PHASE_TOWER.md` §5：A「楼层=波次」vs B「波次等价」，跑 `npm run balance` 实验选一个，回写 `ruleset.tower.difficultyMode` 与 `docs/BALANCE.md`）；③ 全量 `npm test` 绿 + 浏览器验收（`node tests/browser-smoke.mjs` + 爬塔选路流程，`LANG=zh_CN.UTF-8`）；④ 新增源文件补 `scripts/test-changed.mjs` 的 TEST_MAP。

## AC

- [ ] 端到端爬塔流程可玩：选路 → 节点分流 → 登顶结算，三节点类型（打/事件/商人）都走通
- [ ] 旧 linear 存档（缺 `ruleset.tower`）仍走线性分支，续玩不坏档
- [ ] 难度映射 A/B 经 balance 实验定夺，`difficultyMode` 与 `docs/BALANCE.md` 一致
- [ ] `npm test` 全绿；`LANG=zh_CN.UTF-8` 补跑 `node tests/browser-smoke.mjs` 与爬塔流程

## DoD

- [ ] 集成落地，不引入第三方依赖；`sim.js` 确定性未变（normal 模式 RNG 字节级等价）
- [ ] 新增源文件登记 `scripts/test-changed.mjs` 的 TEST_MAP
- [ ] `npm test` 全绿 + 浏览器验收绿
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `server/services/run-service.mjs`
- `public/js/app/combat.js`
- `public/js/app/run.js`
- `public/js/ui.js`
- `scripts/test-changed.mjs`
- `tasks/feat-tower-stage2-integration.md`

## Notes

立案 2026-11-03，源自 `docs/PHASE_TOWER.md` §6.1 阶段 2。集成阶段 Touches 以实际合流后的边界为准，若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。难度映射若 balance 实验无法在单任务内收敛，允许落到 needs-human 交 manager。

该轴仍暗,理由:本任务为爬塔集成收尾，契约已冻结，无新文档面，L_D/L_G/L_S 无需量化。
