---
id: test-harness-adoption
title: 迁移示范 + 落地「新功能走 harness + 声明接缝」约定（docs/TESTING.md）
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/scenario.test.mjs tests/test-matrix.test.mjs
---
## Proposal

测试体系（`docs/TODO.md` TODO-13）第 3 步收尾。地基（`test-scenario-harness` done）与分类法（`test-matrix-taxonomy` done）已落地 `buildScenario`/`assertions`/`axes`/`seams`/`test-matrix`。本任务：① **迁移示范**——把一组代表性现有测试迁到新 harness（建议 hexes 轴 + relics 轴 + snapshot 缝，具体目标 worker 按迁移成本选，至少 3 个文件），证明「走 harness + 注册表」比 ad-hoc 更省、且覆盖矩阵能查到；② **契约落地**——新增 `docs/TESTING.md`（测试体系契约：轴/缝/不变量三分法、新功能「注册 1 轴 + 声明 k 缝」的操作步骤、确定性红线、M+N+Z 纪律），并在 CLAUDE.md 补一句「新功能必须走 `tests/lib` 场景构造器测试并声明接缝」；③ 清理 TODO-13 的计划态标记（`<!-- docs-consistency:planned-* -->`，产物已落地）。

## AC

- [ ] 至少 3 个现有测试文件迁移到 harness + 注册表（hexes 轴 + relics 轴 + snapshot 缝示范），迁移后仍全绿
- [ ] `docs/TESTING.md` 落地：三分法 + 新功能操作步骤 + 确定性红线 + M+N+Z 纪律
- [ ] CLAUDE.md 补一句「新功能走 harness + 声明接缝」
- [ ] TODO-13 计划态标记清理；`scripts/test-matrix.mjs` 能报告迁移后的覆盖矩阵
- [ ] `node --test tests/scenario.test.mjs tests/test-matrix.test.mjs` exit 0

## DoD

- [ ] 落地于 `docs/TESTING.md`（新）、`CLAUDE.md`、迁移的测试文件，零第三方依赖
- [ ] 迁移不改被测行为（纯测试重构），`npm test` 全绿
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `docs/TESTING.md` (new)
- `CLAUDE.md`
- `tests/hexes.test.mjs`
- `tests/relics-turnbased.test.mjs`
- `tests/snapshot.test.mjs`
- `tasks/test-harness-adoption.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-13 第 3 步。依赖地基 + 分类法（均 done）。迁移目标以 worker 实际选择为准（至少 3 文件），若与 Touches 有出入须 task_write 修正再 fan-in。迁移是纯测试重构，不得改被测玩法/数值/sim 确定性。

该轴仍暗,理由:本任务为测试迁移与契约文档，无新玩法文档面，L_D/L_G/L_S 无需量化。
