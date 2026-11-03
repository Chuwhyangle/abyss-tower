---
id: feat-tower-stage1-client
title: 爬塔·阶段1客户端：api/combat/run/nodes 节点图循环 + sim mode 分支
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/run-lifecycle.test.mjs tests/snapshot.test.mjs
---
## Proposal

爬塔阶段 0（done）已落地共享契约。本任务落地**阶段 1 客户端逻辑**（`docs/PHASE_TOWER.md` §6.1 Agent C 的落点）：① `public/js/app/api.js` 新增 `getNodes`/`chooseNode`/`getMerchant`/`pickMerchant`；② `public/js/app/combat.js` 的 `handleWaveClear` 后置序列按节点类型分流（fight→draft、event→事件、merchant→商人、boss→首领核心）；③ `public/js/app/run.js` 的 `beginGame`/`resumeRun` 传 route/node、恢复节点图；④ 新建 `public/js/app/nodes.js`（节点地图视图控制器）；⑤ `public/js/app/controller.js` 装配 `onChooseNode`/`onMerchant` 回调；⑥ `public/js/sim.js` 的 `gameOver`（`MAX_WAVE=30` 通关）与 `computePendingEvent` 按 mode 分支（**normal 模式字节级等价，不改 RNG 调用序**）。

## AC

- [ ] api.js 四个新调用落地；combat.js 清波后按节点类型分流
- [ ] run.js 恢复 route/node；nodes.js 节点图视图控制器；controller.js 装配回调
- [ ] sim.js 的 gameOver/pendingEvent 按 mode 分支，normal 模式行为/RNG 不变
- [ ] `node --test tests/run-lifecycle.test.mjs tests/snapshot.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/app/api.js`、`combat.js`、`run.js`、`controller.js`、`nodes.js`（新）、`public/js/sim.js`，不引入第三方依赖
- [ ] 回归测试覆盖节点循环、route 恢复、mode 分支、normal 确定性
- [ ] `npm test` 全绿；补跑 `node --test tests/run-lifecycle.test.mjs tests/snapshot.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/app/api.js`
- `public/js/app/combat.js`
- `public/js/app/run.js`
- `public/js/app/controller.js`
- `public/js/app/nodes.js` (new)
- `public/js/sim.js`
- `tests/run-lifecycle.test.mjs`
- `tasks/feat-tower-stage1-client.md`

## Notes

立案 2026-11-03，源自 `docs/PHASE_TOWER.md` §6.1 阶段 1（Agent C）。`sim.js` 是确定性红线文件，改完须 `npm test` 全绿自证 normal 模式 RNG 顺序未变。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为爬塔客户端逻辑，契约已冻结，无新文档面，L_D/L_G/L_S 无需量化。
