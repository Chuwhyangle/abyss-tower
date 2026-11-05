---
id: refactor-touches-conflict
title: 并发重构·阶段0 安全网：touches-conflict 冲突预检 + OWNERSHIP 单 owner 表
status: todo
labels:
  - refactor
parent: null
children: []
extra: {}
---
## Proposal

并发友好重构·阶段 0 安全网（纯脚本/文档，零游戏代码风险）。源自三路架构论证（耦合/竞争/并发）的路线图第一步。

1. 新增 `scripts/touches-conflict.mjs`：只读解析 `tasks/*.md` 的 `## Touches`（含 `(new)` 标注），按文件归组输出两两重叠矩阵；发现「两个 ready 任务申明同一非 new 文件」时 exit 1。供 worker 领任务前自查谁会串行。
2. 新增 `docs/OWNERSHIP.md`：单 owner 表（内容 lane / sim lane / UI 外壳 lane / render 外壳 lane / 服务端 lane / i18n lane），`touches-conflict.mjs` 与 `scripts/structure-budget.allow.d/` 从它派生。

## AC

- [ ] `scripts/touches-conflict.mjs` 能解析 Touches、输出重叠矩阵、冲突时 exit 1
- [ ] `docs/OWNERSHIP.md` 有单 owner 表，覆盖主要 lane
- [ ] `node scripts/touches-conflict.mjs` 对当前 open 任务集 exit 1（存在重叠，正确报出）
- [ ] `npm test` 全绿；新脚本登记 `scripts/test-changed.mjs` TEST_MAP

## DoD

- [ ] 落地于 `scripts/touches-conflict.mjs`(新)、`docs/OWNERSHIP.md`(新)、`scripts/test-changed.mjs`、`tests/`，零第三方依赖
- [ ] 纯只读，不改游戏代码
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `scripts/touches-conflict.mjs` (new)
- `docs/OWNERSHIP.md` (new)
- `scripts/test-changed.mjs`
- `tests/touches-conflict.test.mjs` (new)
- `tasks/refactor-touches-conflict.md`

## Notes

立案 2026-11-06，源自用户「重构优化 + 提高并发吞吐」需求，三路架构论证（耦合/竞争热点/并发方案）收敛的路线图阶段 0。关键裁定：这是阶段 4/5（确定性高危拆分）的安全网，必须先做。