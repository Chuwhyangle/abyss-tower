---
id: feat-tower-stage0-contract
title: 爬塔·阶段0 共享契约：tower.js 节点图 + route 接进 events/snapshot/scoring/replay
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/replay.test.mjs tests/snapshot.test.mjs
---
## Proposal

爬塔模式 PHASE 冻结表 `docs/PHASE_TOWER.md`（DOCS-004 done）已定稿。本任务是**阶段 0（串行共享契约层）**，先于服务端/客户端/UI 落地：① 新增 `public/js/shared/tower.js`（节点图 DAG 生成 `${seed}:tower:graph`、节点类型 fight/event/merchant/boss/elite/treasure、后继计算、商人库存 `${seed}:shop:<node>`、选路状态契约——全纯函数、seed 派生、确定性，不触碰 `sim.js` RNG 顺序）；② 把 `route` 字段接进共享契约：`events.js` 的 mode-aware 事件谓词（爬塔任意节点可解析事件，不改 normal 的 RNG/调用序）、`snapshot.js` 升 `SAVE_VERSION=8` + `MODES` 加 `'tower'` + route/node 字段（presence-gated，旧档零字节改动）、`scoring.js` 的爬塔 victory/分数口径、`replay.js` 升 `REPLAY_VERSION=3` + 编解码 route + `MODES` 加 `'tower'`。四条实现红线（MODES 三处硬编码、事件谓词、回放 route、sim 确定性）按 §6.2 逐条守住。

## AC

- [x] `public/js/shared/tower.js` 存在：节点图/节点类型/后继/商人库存/选路契约，seed 派生确定性
- [x] `events.js` 事件谓词爬塔节点可解析，normal 模式调用序/RNG 不变
- [x] `snapshot.js` `SAVE_VERSION=8`、`MODES` 含 `tower`、route/node 字段 presence-gated
- [x] `replay.js` `REPLAY_VERSION=3`、编解码 route、`MODES` 含 `tower`
- [x] `node --test tests/replay.test.mjs tests/snapshot.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/shared/tower.js`（新）、`events.js`、`snapshot.js`、`scoring.js`、`replay.js`，不引入第三方依赖
- [x] 回归测试覆盖节点图确定性、route 编解码、旧档兼容（无 route 字段按线性处理）
- [x] `npm test` 全绿；补跑 `node --test tests/replay.test.mjs tests/snapshot.test.mjs tests/events.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/tower.js` (new)
- `public/js/shared/events.js`
- `public/js/shared/snapshot.js`
- `public/js/shared/scoring.js`
- `public/js/shared/replay.js`
- `tests/tower.test.mjs` (new)
- `tests/replay.test.mjs`
- `tests/snapshot.test.mjs`
- `tests/event-chains.test.mjs`
- `tests/destructibles-sim.test.mjs`
- `tests/hex-flow.test.mjs`
- `tasks/feat-tower-stage0-contract.md`

## Notes

立案 2026-11-03，源自 `docs/PHASE_TOWER.md` §6.1（阶段 0）。难度映射（楼层=波次 vs 波次等价）留 §5 balance 待验，阶段 0 不裁决、只定契约符号。阶段 1（服务端/客户端/UI 并行）依赖本任务落地后拆。worker 实测 Touches 有出入已修正：新增 `tests/tower.test.mjs`；`SAVE_VERSION=8`/`REPLAY_VERSION=3` 版本号字面量断言同步改 `tests/snapshot.test.mjs`、`tests/event-chains.test.mjs`、`tests/destructibles-sim.test.mjs`、`tests/hex-flow.test.mjs`（后四者仅版本号字面量，非契约变更）。全量 `npm test` 1940 例全绿，`check:syntax`/`check:imports`/`check:style`/`check:version`/`check:docs` 均过。

该轴仍暗,理由:本任务为共享契约层，无新文档面，L_D/L_G/L_S 无需量化。