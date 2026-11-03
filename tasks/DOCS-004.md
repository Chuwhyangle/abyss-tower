---
id: DOCS-004
title: 爬塔模式 PHASE 冻结表：把 TODO-12 三路综合草案落成 docs/PHASE_TOWER.md
status: ready
labels:
  - docs
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/docs-phase-sync.test.mjs tests/docs-consistency.test.mjs
---
## Proposal

TODO-12「爬塔模式」的三路综合设计草案已定稿在 `docs/TODO.md`（节点图 DAG、打/事件/商人三类节点、8 条平衡红线、实现三阶段拆分、4 条实现红线）。本任务把它落成一份冻结表 `docs/PHASE_TOWER.md`（**ASCII 文件名**，避开 docs-consistency 的 REPO_PATH_RE 非 ASCII 路径截断误报），作为后续实现任务的字段契约与 AC 映射唯一定义处。文档须含：① 背景与范围（在 30 波难度阶梯上盖自选路线）；② 节点图契约（30 层 DAG、扇出 ±1、首领漏斗、节点类型、seed 派生 `${seed}:tower:*`）；③ 三类节点经济契约（打=唯一免费遗物、事件复用 events.js、商人定价表 8 条红线）；④ 难度映射（楼层=波次 vs 波次等价，标注 balance 待验）；⑤ 实现三阶段拆分（阶段 0 共享契约串行 → 阶段 1 服务端/客户端/UI 并行 → 阶段 2 集成）与 4 条实现红线（MODES 三处硬编码、事件谓词、回放 route REPLAY_VERSION=3、sim.js 确定性）。

## AC

- [x] `docs/PHASE_TOWER.md` 存在，含背景/范围/节点图契约/经济契约/难度映射/实现拆分六节
- [x] 节点图与经济契约与 `docs/TODO.md` 的爬塔草案一致（节点类型、8 条红线、商人定价）
- [x] ASCII 文件名 `PHASE_TOWER.md`（不触发 docs-consistency 非 ASCII 截断）
- [x] `node --test tests/docs-phase-sync.test.mjs tests/docs-consistency.test.mjs` exit 0

## DoD

- [ ] `docs/PHASE_TOWER.md` 落地，设计增量与 TODO.md 草案逐条对应
- [ ] 若 docs-phase-sync 需覆盖新 PHASE 文档，同步更新其检查（不破坏既有 PHASE_FEEL_ART 断言）
- [ ] `npm test` 全绿
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `docs/PHASE_TOWER.md` (new)
- `tests/docs-phase-sync.test.mjs`
- `tasks/DOCS-004.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-12（爬塔设计草案）。爬塔实现依赖本冻结表落地后再拆任务（阶段 0 共享契约 → 阶段 1 并行 → 阶段 2 集成）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为阶段冻结表文档，把已定稿设计落文档，L_D/L_G/L_S 无需量化。