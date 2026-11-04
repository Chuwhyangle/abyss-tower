---
id: test-migration-demo
title: 测试体系迁移示范 + 落地「新功能必须走 harness」约定（收口）
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/scenario.test.mjs tests/test-matrix.test.mjs
---
## Proposal

测试体系（`docs/TODO.md` TODO-13）第 3 步收口。地基（`test-scenario-harness` done）与分类法（`test-matrix-taxonomy` done）已落地 `buildScenario`/`assertions`/不变量 + `axes`/`seams` 注册表 + 覆盖矩阵。本任务：① **迁移示范**——把一组现有测试迁到新 harness 证明「轴/缝/不变量」怎么替代 ad-hoc（选 hexes + relics + snapshot 三组：hexes 走轴注册表参数化、snapshot 走缝注册表、各配复用断言），不追求全量迁移（1900+ 例增量迁移留给后续）；② 落地 `docs/TESTING.md`——测试体系契约（`buildScenario` spec、轴/缝/不变量分类法、新功能如何注册 1 轴 + 声明 k 缝、确定性红线）；③ `CLAUDE.md` 补一句「新功能测试必须走 `tests/lib/scenario` 的 `buildScenario` + 注册轴/缝，禁止 ad-hoc 造 `Simulation`」。

## AC

- [x] 迁移示范：hexes/relics/snapshot 三组走 harness（轴/缝注册 + 复用断言），证明比 ad-hoc 更省
- [x] `docs/TESTING.md` 落地：场景构造器契约 + 轴/缝/不变量分类法 + 新功能接缝声明约定
- [x] `CLAUDE.md` 补一句「新功能测试走 harness」约定
- [x] `node --test tests/scenario.test.mjs tests/test-matrix.test.mjs` exit 0；`node scripts/test-matrix.mjs` 报告无未声明接缝

## DoD

- [x] 落地于 `tests/`（迁移示范三组）、`docs/TESTING.md`（新）、`CLAUDE.md`，零第三方依赖
- [x] 迁移示范证明「+1 轴 +k 缝、不 ×N」的纪律成立
- [x] `npm test` 全绿；`check:docs` 不红（TESTING.md 引用文件均已存在）
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `docs/TESTING.md` (new)
- `CLAUDE.md`
- `tests/hexes.test.mjs`
- `tests/relics-turnbased.test.mjs`
- `tests/snapshot.test.mjs`
- `tasks/test-migration-demo.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-13 第 3 步。依赖 `test-matrix-taxonomy`（done）的 axes/seams。迁移示范是「证明 + 立规矩」，不是全量迁移（全量留给后续增量）。`docs/TESTING.md` 是测试体系的契约文档，若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为测试体系收口与示范，纯测试/文档代码无新玩法，L_D/L_G/L_S 无需量化。