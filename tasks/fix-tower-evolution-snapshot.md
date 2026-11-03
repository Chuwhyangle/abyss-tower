---
id: fix-tower-evolution-snapshot
title: 塔进化状态写入单局快照：serializeTower/normalizeTowers 补 evolutions，修复存读档丢进化
status: ready
labels:
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/tower-evolution.test.mjs tests/snapshot.test.mjs
---
> **RETREATED / 搁置（误推进：promote 连跑 acceptance（现有绿测试）导致未实现即 done，退回 ready 待 worker 实现）**

## Proposal

「独塔为王」升到 10 级自动兼得三条进化、普通塔满级选一条进化后，刷新页面/续玩时塔的进化被清空。根因：`public/js/shared/snapshot.js` 的 `serializeTower`（约 248 行）只写 `type/c/r/level/invested/maxHp/hp`，不写 `evolution`/`evolutions`；`normalizeTowers`（约 76 行）也不读回。读档重建在 `public/js/sim.js:184-196` 取 `tower.evolutions ?? tower.evolution` 得 `undefined` → 空数组。后果：溅射/减速/连锁等进化系数永久丢失（独塔 `missingEvolutionMul` 只兜底补回伤害/射程/攻速三键），三选一重新弹出，违背 PRD「不再三选一」。修复：序列化写入 `evolutions` 数组、反序列化读回归一化；旧档无该字段按无进化处理，与 `tests/tower-evolution.test.mjs`「旧存档没有 evolution 字段时按未进化处理」约定一致，无需改 `SAVE_VERSION`。同根因覆盖普通塔单条进化（`evolution` 单串），`normalizeEvolutionIds` 已兼容数组/单串/旧档。

## AC

- [x] `serializeTower` 输出的塔状态含 `evolutions`（数组），`normalizeTowers` 读回并归一化到 `tower.evolutions`
- [x] 独塔满级塔 `toSnapshot` → 重建后 `evolutions` 与升满时一致、`canEvolve` 为 false、不再弹三选一
- [x] 普通塔满级单进化 `toSnapshot` → 重建后 `towerEvolution` 恢复、进化系数（含 splash/slow/chain 等非三键）不变
- [x] `node --test tests/tower-evolution.test.mjs tests/snapshot.test.mjs` exit 0
- [x] 旧档（无 evolution 字段）重建仍按未进化处理，行为与现测试约定一致

## DoD

- [x] 修复落地于 `public/js/shared/snapshot.js`（序列化+反序列化），不引入新依赖
- [x] 新增回归测试：独塔满级进化跨存读档保持 + 不再弹三选一；普通塔单进化跨存读档保持
- [x] `npm test` 全绿；改到塔/快照时补跑 `node --test tests/tower-evolution.test.mjs tests/snapshot.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/snapshot.js`
- `tests/tower-evolution.test.mjs`
- `tests/snapshot.test.mjs`
- `tasks/fix-tower-evolution-snapshot.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-1。同根因覆盖普通塔单条进化与独塔三条进化，修复一处即两处收口。

该轴仍暗,理由:本任务为 scoped 缺陷修复，不引入新结构、不改文档面，L_D/L_G/L_S 无需量化。
