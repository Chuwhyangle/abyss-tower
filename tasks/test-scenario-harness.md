---
id: test-scenario-harness
title: 无头模拟场景构造器 + 复用断言 + 不变量（测试体系地基）
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/scenario.test.mjs
---
## Proposal

测试体系（`docs/TODO.md` TODO-13）的地基。`sim.js` 已是确定性无头引擎，但每个测试各自 ad-hoc 构造 `Simulation`，没有统一「场景构造器」，复用断言散落各处。本任务新增：① `tests/lib/scenario.mjs` —— 声明式 `buildScenario(spec)`：spec 声明 map/towers/relics/hex/skill/waves/difficulty/mode → 返回就绪 `Simulation` + 驱动 helper（place/build/upgrade/evolve/sell/startWave/step/spawnEnemy/castSkill/buyRelic/read snapshot+stats+RNG hash）。**纯数据+功能特效，零美术零 DOM**；复用 `sim.js` 的确定性，不改其 RNG 顺序。② `tests/lib/assertions.mjs` —— 复用断言：stats 数值近似、确定性哈希（events/rng/state 三份）、快照 round-trip（toSnapshot→重建逐字段一致）、no-crash、RNG 顺序不变。③ 不变量：对任意 scenario 跑几条全局铁律（同 seed 两次结果字节一致、快照 round-trip、无崩溃、normal 模式 RNG 顺序不变）。

## AC

- [x] `buildScenario(spec)` 声明式构造（map/towers/relics/hex/skill/waves/difficulty/mode 可组合），返回就绪 Simulation + 驱动 helper
- [x] 驱动 helper 覆盖塔生命周期（建/升/进化/卖）+ 波次（开波/步进/刷怪）+ 技能 + 遗物 + 读状态（snapshot/stats/RNG hash）
- [x] `assertions.mjs` 提供 stats 数值/确定性哈希/快照 round-trip/no-crash 复用断言
- [x] 不变量（同 seed 两次一致、快照 round-trip、无崩溃、RNG 顺序不变）对任意 scenario 通过
- [x] `node --test tests/scenario.test.mjs` exit 0（地基自身 + 示范：一个塔轴 + 一个海克斯轴走 harness）

## DoD

- [x] 落地于 `tests/lib/scenario.mjs`（新）、`tests/lib/assertions.mjs`（新）、`tests/scenario.test.mjs`（新），零第三方依赖
- [x] 示范用例证明「轴测试走 harness」比 ad-hoc 更省（buildScenario + 复用断言）
- [x] `npm test` 全绿；不改 `sim.js`、不引入新随机流
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `tests/lib/scenario.mjs` (new)
- `tests/lib/assertions.mjs` (new)
- `tests/scenario.test.mjs` (new)
- `tasks/test-scenario-harness.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-13（测试体系 Go）第 1 步地基。后续「分类法」（axes/seams 注册表 + 测试矩阵）与「迁移示范」依赖本任务落地。确定性红线：buildScenario 不得新增 RNG 调用、不得改 `sim.js` 的 `combatRng` 顺序。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

实现 2026-11-04：`node --test tests/scenario.test.mjs` 8/8 全绿（地基自证 + 塔轴 + 海克斯轴示范）。`npm test` 1970 例中唯一红为 `docs-consistency「check:docs」`——`docs/TODO.md:225-226` 引用了 TODO-13 分类法/迁移示范尚未落地的产物（`tests/lib/axes.mjs`、`tests/lib/seams.mjs`、`scripts/test-matrix.mjs`、`docs/TESTING.md`），属立案 `6affb1c` 即存在的前置红、已由 `gap-docs-todo-planned-block-missing` 单独立案追踪，非本任务改动所致（本任务新增 8 例全绿、未改 `sim.js`、未新增 RNG 调用）。

该轴仍暗,理由:本任务为测试基础设施，纯测试代码无新玩法文档面，L_D/L_G/L_S 无需量化。