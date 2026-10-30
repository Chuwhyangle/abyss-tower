---
id: gap-ac-054-rogue2-design-rebase
title: 落地 AC-054：PHASE_ROGUE2 设计重基冻结表（70 遗物/6 套装 + 核心/契约/教义/觉醒字段表）与测试覆盖
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-054
---
## Proposal

AC-054（设计重基：PHASE_ROGUE2 覆盖 70 遗物/6 套装与核心/契约/教义/觉醒字段表）已由 goal-driver 激活，criterion 为 `test -s docs/PHASE_ROGUE2.md && grep -q '五派系' docs/PHASE_ROGUE2.md && grep -q '首领核心' docs/PHASE_ROGUE2.md`（expect exit 0），但当前无任何 todo/ready/needs-human 任务以顶层 `goal_ac` 认领它；`docs/PHASE_ROGUE2.md` 与 `tests/rogue2-design.test.mjs` 均 MISSING（曾随 revert 14fec37 一并删除）。本任务执行设计重基落地：产出唯一冻结表 + 覆盖测试，使 AC-054 判据 exit 0，并为后续实现任务（AC-055..061）提供冻结数值。

<!-- dedup-ref --> 设计口径沿自提案任务 gap-goal-011-rogue2-design-rebase-ac（needs-human）已论证的方案：本任务只执行其 Plan 第 2 步的「设计重基实现」，不写 goal-store、不改 goals/*.md；与提案任务的「新增 AC 裁定」机制不同、独立验收。合并候选已跑 `task-granularity-advice`（--touches docs/PHASE_ROGUE2.md tests/rogue2-design.test.mjs scripts/test-changed.mjs）返回 peers=[]、mentions=[]。

## Plan

1. 逐件盘点 `public/js/shared/data/relics.js` 的全部 relic 记录，每个标注五派系（火力/霜缚/蚀毒/雷暴/守护）或中立归属，落成 `docs/PHASE_ROGUE2.md` 唯一冻结表。
2. 冻结 6 套套装（hunter/guild/frost/gambit/reserve/synergy → 猎手/商道/霜寒/孤注/蓄势/星轨）与 4/8/12 三档阈值表、setMods 新键清单（不塞旧 caps）。
3. 冻结首领核心（升阶/搜寻/觉醒/教义/补给）、契约卡（5 条）、教义（5 条）、觉醒 P0（4 条）字段表。
4. 新增 `tests/rogue2-design.test.mjs`：真实读 relics.js 的全部 relic id 逐个断言派系/中立归属与字段表齐全，非手写清单。
5. 在 `scripts/test-changed.mjs` 的 TEST_MAP 登记新测试文件（否则全量 suite「审计覆盖」条红）。

## AC

- [ ] `test -s docs/PHASE_ROGUE2.md && grep -q '五派系' docs/PHASE_ROGUE2.md && grep -q '首领核心' docs/PHASE_ROGUE2.md` exit 0（AC-054 本体判据）
- [ ] `node --test tests/rogue2-design.test.mjs` exit 0（真实读 relics.js 全部 relic id 做派系/中立与字段表覆盖断言）
- [ ] `grep -q 'rogue2-design' scripts/test-changed.mjs` exit 0（TEST_MAP 已登记，审计覆盖不红）
- [ ] `npm test` exit 0（全量测试不回归）

## DoD

- `docs/PHASE_ROGUE2.md` 是唯一冻结表：relics.js 的每一件遗物都有五派系或中立归属，6 套套装、4/8/12 三档阈值、setMods 新键、首领核心/契约/教义/觉醒字段表齐全，且含「五派系」「首领核心」字样使 AC-054 判据 exit 0。
- `tests/rogue2-design.test.mjs` 真实读取 relics.js 的 relic id 做覆盖断言（非手写清单），`node --test` 通过。
- `scripts/test-changed.mjs` 的 TEST_MAP 已登记新测试文件，全量 `npm test` 不回归。
- 未改战斗数值/波次生成/经济计分口径；未写 goal-store、未改 `goals/*.md`、未改 `docs/PRD.md`/`docs/TECH_DESIGN.md`。

## Touches

- `docs/PHASE_ROGUE2.md` (new)
- `tests/rogue2-design.test.mjs` (new)
- `scripts/test-changed.mjs`
- `tasks/gap-ac-054-rogue2-design-rebase.md`