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

- [x] 至少 3 个现有测试文件迁移到 harness + 注册表（hexes 轴 + relics 轴 + snapshot 缝示范），迁移后仍全绿
- [x] `docs/TESTING.md` 落地：三分法 + 新功能操作步骤 + 确定性红线 + M+N+Z 纪律
- [x] CLAUDE.md 补一句「新功能走 harness + 声明接缝」
- [x] TODO-13 计划态标记清理；`scripts/test-matrix.mjs` 能报告迁移后的覆盖矩阵
- [x] `node --test tests/scenario.test.mjs tests/test-matrix.test.mjs` exit 0

## DoD

- [x] 落地于 `docs/TESTING.md`（新）、`CLAUDE.md`、迁移的测试文件，零第三方依赖
- [x] 迁移不改被测行为（纯测试重构），`npm test` 全绿
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `docs/TESTING.md` (new)
- `CLAUDE.md`
- `tests/hexes.test.mjs`
- `tests/relics-turnbased.test.mjs`
- `tests/snapshot.test.mjs`
- `docs/TODO.md`
- `tasks/test-harness-adoption.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-13 第 3 步。依赖地基 + 分类法（均 done）。

worker 落地情况：AC #1/#2/#3 的迁移与契约产物（hexes/relics/snapshot 走 harness、`docs/TESTING.md`、CLAUDE.md 一句）已由先行任务 `test-migration-demo`（done，commit c3692aa）随 develop 落地，本 worker 复验全绿——3 个迁移文件 `node --test tests/hexes.test.mjs tests/relics-turnbased.test.mjs tests/snapshot.test.mjs` 33 例 exit 0；AC #5 的 `node --test tests/scenario.test.mjs tests/test-matrix.test.mjs` 26 例 exit 0；`node scripts/test-matrix.mjs` 报告「未覆盖接缝：无」「未知缝引用：无」。本任务的真实增量是 AC #4 的 TODO-13 计划态标记清理：移除 `docs/TODO.md` TODO-13 段落的 `<!-- docs-consistency:planned-start/end -->` 豁免并置状态为「已实现」（产物已落地，`check:docs` 仍绿）。故 Touches 增补 `docs/TODO.md`。迁移是纯测试重构，未改被测玩法/数值/sim 确定性。

该轴仍暗,理由:本任务为测试迁移与契约文档，无新玩法文档面，L_D/L_G/L_S 无需量化。