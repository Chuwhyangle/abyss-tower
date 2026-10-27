---
id: DOCS-002
title: 肉鸽养成 2.0 设计重基：把 v1.9 口径对齐 70 遗物现状
status: ready
labels:
  - docs
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/rogue2-design.test.mjs
goal_ac: AC-032
---
## Proposal

`docs/PROGRESSION_DESIGN.md` 的「肉鸽养成 2.0」（§3、§8 v1.9）写于 22→33 件遗物、3 套集合的时代；当前 main 实际是 70 件遗物（普通 29 / 稀有 26 / 史诗 15，见 `public/js/shared/data/relics.js`）、3 套集合（hunter/frost/merchant）、10 个主海克斯与 12 敌人。直接按旧稿派实现任务会拿过期数值与旧池子打架。本任务只做设计重基：把五个派系映射到全部 70 件遗物、冻结 4/8/12 阈值与 setMods 键、重写首领核心/契约/教义/觉醒的字段契约，并把结论落到唯一冻结表 `docs/PHASE_ROGUE2.md`；不写实现代码。

## Plan

1. 逐件盘点 70 件遗物：按现有 `mods` 与 `set` 标注到 火力 / 霜缚 / 蚀毒 / 雷暴 / 守护 或 中立；记录映射理由与不可归类项。
2. 冻结 `docs/PHASE_ROGUE2.md`：派系点数 = 遗物等级、4/8/12 三档效果表；setMods 新键清单（暴伤、连锁衰减、冻结触发、中毒传播等），明确不塞旧 `GLOBAL_MOD_CAPS` / `PER_RELIC_CAPS`。
3. 冻结首领核心五类选项、契约卡五条、教义五条、觉醒 P0 四条的数据字段、事件字段与快照字段。
4. 在 `docs/PRD.md` 与 `docs/TECH_DESIGN.md` 增加增量小节并引用 `PHASE_ROGUE2`，不重复定义；按文档所有权只由本 `DOCS-*` lane 改这两份总文档。
5. 新增 `tests/rogue2-design.test.mjs`：断言 70 个遗物 id 全覆盖、5 派系与阈值表、核心/契约/教义/觉醒字段表齐全，且 PHASE_ROGUE2 被 PRD/TECH_DESIGN 引用。

## AC

- [ ] `node --test tests/rogue2-design.test.mjs` exit 0
- [ ] `node scripts/check-doc-ownership.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] `docs/PHASE_ROGUE2.md` 是唯一冻结表：70 件遗物每个都有派系或中立归属；4/8/12 三档效果、核心/契约/教义/觉醒字段表齐全
- [ ] PRD 与 TECH_DESIGN 只写增量并引用 PHASE_ROGUE2，不复制第二份数值表
- [ ] 测试真实读取 `data/relics.js` 的 70 个 id 做覆盖断言，不是手写清单

## Touches

- `docs/PHASE_ROGUE2.md` (new)
- `docs/PROGRESSION_DESIGN.md`
- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `tests/rogue2-design.test.mjs` (new)
- `tasks/DOCS-002.md`

## Notes

设计重基只定契约与数值表，不写实现。若盘点发现旧稿的某个机制在 70 件池子上不成立（例如「第 3 波起必含升级卡」与满级池的交互），在本任务 Notes 记录裁定理由，并在 PHASE_ROGUE2 写明替代口径；不要为了保留旧稿而掩盖数学上不成立的部分。
