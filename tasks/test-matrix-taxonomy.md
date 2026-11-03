---
id: test-matrix-taxonomy
title: 轴/缝注册表 + 参数化测试 + 覆盖矩阵报告（M+N+Z 分类法）
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/test-matrix.test.mjs
---
## Proposal

测试体系（`docs/TODO.md` TODO-13）第 2 步。地基（`test-scenario-harness` done）已落地 `buildScenario` + `assertions` + 不变量。本任务搭「分类法」，把「正交轴 + 接缝 + 不变量」变成显式注册表，让新功能加测试数是 **+1 不 ×N**：① `tests/lib/axes.mjs` —— 轴注册表：枚举各维度（塔 / 海克斯 / 遗物 / 技能 / 地图 / 难度 / 波次），每轴一条参数化 spec（`buildScenario` 最小场景 + 断言），一条 `node:test` 遍历整根轴；② `tests/lib/seams.mjs` —— 接缝注册表：跨维度接口（`sim.mods` 加成聚合、海克斯钩子 × 塔生命周期、快照往返、回放往返、mode 分支、经济），每缝一条参数化测试遍历「声明了该缝的轴」；③ `scripts/test-matrix.mjs` —— 覆盖矩阵报告（每轴 × 每缝覆盖情况，识别未声明/未覆盖的接缝）。核心纪律：新维度注册 1 轴 + 声明 k 缝，测试数 +1+k。

## AC

- [ ] `axes.mjs` 轴注册表 + 参数化轴测试覆盖 塔/海克斯/遗物/技能/地图/难度（至少 6 轴）
- [ ] `seams.mjs` 接缝注册表 + 参数化缝测试覆盖 加成聚合/钩子×塔生命周期/快照往返/回放往返/mode 分支（至少 5 缝）
- [ ] `scripts/test-matrix.mjs` 输出覆盖矩阵（每轴×每缝），能识别「某轴未声明某缝」
- [ ] 示范：一个轴 + 一个缝走通 harness + 断言复用
- [ ] `node --test tests/test-matrix.test.mjs` exit 0

## DoD

- [ ] 落地于 `tests/lib/axes.mjs`（新）、`tests/lib/seams.mjs`（新）、`scripts/test-matrix.mjs`（新）、`tests/test-matrix.test.mjs`（新），零第三方依赖
- [ ] 新脚本 `scripts/test-matrix.mjs` 登记 `scripts/test-changed.mjs` 的 TEST_MAP
- [ ] `npm test` 全绿；`node scripts/test-matrix.mjs` 输出矩阵报告
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `tests/lib/axes.mjs` (new)
- `tests/lib/seams.mjs` (new)
- `scripts/test-matrix.mjs` (new)
- `scripts/test-changed.mjs`
- `tests/test-matrix.test.mjs` (new)
- `tasks/test-matrix-taxonomy.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-13 第 2 步。依赖 `test-scenario-harness`（done）的 `buildScenario`/`assertions`。参数化遍历必须走 buildScenario，不得 ad-hoc 造 Simulation（否则分类法形同虚设）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为测试分类法基础设施，纯测试代码无新玩法文档面，L_D/L_G/L_S 无需量化。
