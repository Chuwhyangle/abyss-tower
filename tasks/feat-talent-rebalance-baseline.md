---
id: feat-talent-rebalance-baseline
title: 天赋树·阶段2：零 meta 基线重排 + balance 复测（+1%/级 腾头寸不顶穿）
status: done
labels:
  - feat
parent: null
children: []
depends_on:
  - feat-talent-rework-contract
extra:
  schema: execution
  acceptance: node --test tests/meta-balance-targets.test.mjs tests/meta-tree.test.mjs
---
## Proposal

天赋树 +1%/级 + 技能接线落地后，`npm run balance` 复测满 meta 端点 **远征 54% 超目标 [25%,40%]**（+14pp，也超过 ±5pp 容忍），深渊贴/超 12% 上界——正是三路论证预言的「可感知 vs 顶穿三档」冲突（`docs/TODO.md` TODO-14 方案第 5 条已裁定：重排零 meta 基线）。修复：**重排零 meta 基线**（`public/js/shared/data/difficulties.js` 的 hpMul：深渊 1.34→~1.42、远征 1.10→~1.16、漫游微调），让满 meta 落回目标区间（深渊 ~10-11%、远征 ~35-37%、漫游 ~81-83%）；重跑 `npm run balance` 验证三档不越界；同步重写 `docs/BALANCE.md`/`docs/BALANCE_META.json` 与 `tests/meta-balance-targets.test.mjs` 的断言。**注意**：数值 +1%/级 保持不动（这是「有成长感」的前提），只动基线难度腾头寸。

## AC

- [x] `difficulties.js` 的 hpMul 重排（深渊/远征基线调难），腾出 ~6pp 头寸
- [x] `npm run balance` 复测：满 meta 三档落回目标区间（深渊 ≤12%、远征 ≤40%、漫游 ≤85%）
- [x] `docs/BALANCE.md`/`BALANCE_META.json` 脚本重写一致；`meta-balance-targets.test.mjs` 断言随目标区间更新
- [x] `node --test tests/meta-balance-targets.test.mjs tests/meta-tree.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/shared/data/difficulties.js`，`docs/BALANCE.md`/`BALANCE_META.json` 脚本重写，零第三方依赖
- [x] 三档通关率复测记录在 Notes（满 meta 不越界 + 零 meta 基线有区分度）
- [x] `npm test` 全绿；补跑 `node --test tests/meta-balance-targets.test.mjs tests/meta-tree.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/data/difficulties.js`
- `docs/BALANCE.md`
- `docs/BALANCE_META.json`
- `tests/meta-balance-targets.test.mjs`
- `tests/balance-sim.mjs`
- `tests/lib/balance-report.mjs`
- `tests/data-split.test.mjs`
- `tests/nodes.test.mjs`
- `tasks/feat-talent-rebalance-baseline.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-14 方案第 5 条 + `feat-talent-rework-contract` 的 balance 基线漂移（满 meta 远征 54% 超目标）。依赖阶段 0（depends_on）。这是「可感知 vs 顶穿三档」的收口：数值 +1%/级 保持，只重排零 meta 基线腾头寸。若复测无法在单任务内收敛，允许落到 needs-human 交 manager。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

实现落地 2026-11-04：`difficulties.js` hpMul 重排为 深渊 1.34→1.50、远征 1.10→1.22、漫游 0.85→0.90（+1%/级 天赋数值不动）。40 种子复测（`node tests/balance-sim.mjs 40 --write`）：零 meta 深渊 8.33%、远征 25%、漫游 77.5%；满 meta 深渊 11.67%（≤12%）、远征 40%（≤40%）、漫游 80.83%（≤85%），三档均落目标区间，零 meta 三档仍有区分度（77.5%/25%/8.33%）。`npm test` 2007 例全绿；`node --test tests/meta-balance-targets.test.mjs tests/meta-tree.test.mjs` 19 例全绿。同步更新 data-split/nodes 内容快照与 meta-balance-targets 断言。

该轴仍暗,理由:本任务为平衡基线重排，数值口径由 balance 脚本收口，无新玩法文档面，L_D/L_G/L_S 无需量化。
