---
id: feat-one-tower-balance
title: 独塔重做 balance 验证：复测三档通关率并回调 7 塔大招数值
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs tests/meta-balance-targets.test.mjs
---
## Proposal

独塔重做（`feat-one-tower-core` + `feat-one-tower-ultimates` + `feat-one-tower-visuals`，均已 done）的 7 塔大招数值是草案（`docs/TODO.md` TODO-3 表）。本任务跑 `npm run balance` / `sweep`，复测三档通关率（目标区间见 `docs/BALANCE.md`），**重点验证独塔为王从「太垃圾、无优势」回到「一塔顶 7 塔」的可行区间**；若越线（太强秒全场，或仍太弱）则回调 7 塔大招的 N 值/倍率/常驻特性，并让 balance 脚本重写 `docs/BALANCE.md` 与 `docs/BALANCE_META.json` 口径一致。注意：独塔重做合法改变了 sim 行为，`check-sim-determinism` 的旧基线过期属预期，本任务**不** `--write` 复采（复采由 goal-driver 另立任务）。

## AC

- [ ] `npm run balance` 复测三档通关率，记录独塔为王的专项通关率/余金
- [ ] 独塔为王回到目标区间；若偏离，回调 7 塔大招数值并重新复测达标
- [ ] `docs/BALANCE.md` 由 balance 脚本重写，与代码数值一致
- [ ] `node --test tests/hex-one-tower.test.mjs tests/meta-balance-targets.test.mjs` exit 0

## DoD

- [ ] 数值回调（如有）落地于 `public/js/shared/hexes/one-tower.js`；`docs/BALANCE.md` 重写一致
- [ ] 不引入第三方依赖；不改 `sim.js` 的 RNG 调用顺序
- [ ] `npm test` 全绿；补跑 `node --test tests/hex-one-tower.test.mjs tests/meta-balance-targets.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/one-tower.js`
- `docs/BALANCE.md`
- `tests/hex-one-tower.test.mjs`
- `tasks/feat-one-tower-balance.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-3 草案数值（待 balance）。若 worker 实际 Touches 有出入（如 BALANCE_META.json、config），须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为平衡模拟与数值回调，无新文档面（BALANCE 为脚本重写产物），L_D/L_G/L_S 无需量化。
