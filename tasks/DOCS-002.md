---
id: DOCS-002
title: 肉鸽养成 2.0 设计重基：把 v1.9 口径对齐 70 遗物现状
status: superseded
labels:
  - docs
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/rogue2-accept.mjs design
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

- [x] `node --test tests/rogue2-design.test.mjs` exit 0
- [x] `node scripts/check-doc-ownership.mjs` exit 0
- [x] `npm test` exit 0

## DoD

- [x] `docs/PHASE_ROGUE2.md` 是唯一冻结表：70 件遗物每个都有派系或中立归属；4/8/12 三档效果、核心/契约/教义/觉醒字段表齐全
- [x] PRD 与 TECH_DESIGN 只写增量并引用 PHASE_ROGUE2，不复制第二份数值表
- [x] 测试真实读取 `data/relics.js` 的 70 个 id 做覆盖断言，不是手写清单

## Touches

- `docs/PHASE_ROGUE2.md` (new)
- `docs/PROGRESSION_DESIGN.md`
- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `tests/rogue2-design.test.mjs` (new)
- `tasks/DOCS-002.md`

## Notes

设计重基只定契约与数值表，不写实现。若盘点发现旧稿的某个机制在 70 件池子上不成立（例如「第 3 波起必含升级卡」与满级池的交互），在本任务 Notes 记录裁定理由，并在 PHASE_ROGUE2 写明替代口径；不要为了保留旧稿而掩盖数学上不成立的部分。

### 交付记录（DOCS-002 实现回合，2026-10-27）

- 冻结点数的唯一公式：`points = Σ clamp(level,1,3) + bonusPoints`（契约加点单派系 ≤ +3，分色显示）；
  4/8/12 → T1/T2/T3；任何派系只要有 4 件可升 Ⅲ 的遗物即可摸到 T3。
- 逐件归属：火力 11 / 霜缚 8 / 蚀毒 7 / 雷暴 8 / 守护 19 / 中立 17 = 70。
  规则优先级：经济红线（带任何经济效果 → 中立）> 金币条件型 → 中立 > 低血条件型 → 守护（按触发资源）
  > 主效果塔轴（毒/霜/电弧）> 攻速射程 → 雷暴 > 增伤暴击溅射 → 火力 > 基地生命/回复/空位 → 守护。
  人工裁决仅 4 件（stasislens → 霜缚、embertrace/cometcore → 蚀毒、gamblerscoin → 中立），已在表内记录。
- 旧稿不成立项共 8 条裁决（PHASE_ROGUE2 §10.1），其中影响最大的三条：
  R2 雷暴 T1「连锁衰减 0.75→0.82」不成立（当前电弧连锁无衰减、逐跳全额），改为「连锁目标 +1」；
  R3 蚀毒 T2「毒可叠 2 层」不成立（`poisonDps`/`poisonUntil` 单槽取最高 DPS），改为「中毒目标受伤 +12%」，
  叠层降 P1；R4 觉醒「静电过载：连锁可暴击」与雷暴 T3 重复，P1 觉醒改口径为「连锁 +1 且不衰减」。
- R1「+11 件新遗物」作废：池子已是 70 件，改为不新增遗物、只做归属重基；已同步改
  `docs/PROGRESSION_DESIGN.md` §8 v1.9 第 1 条。
- R6「第 3 波保底升级卡」判定为**更需要保留**（池子越大新卡占比越高、升级越难发生），已冻结为硬约束。
- 6 套装层退役拆成 M1（停止累加，常量保留导出）/M2（图鉴改派系分组后删 `set` 字段）两步，
  M1 必须与派系层同一提交（PHASE_ROGUE2 §10.2）。
- 见证：`node scripts/rogue2-accept.mjs design` → PASS；`node --test tests/rogue2-design.test.mjs` 12/12；
  `node scripts/check-doc-ownership.mjs` → OK（66 个任务）；`node --no-warnings scripts/docs-consistency.mjs` → 通过（21 文件）；
  `npm test` → 1644/1644 pass。

## Blocker

**2026-10-27T10:17:42.983Z — worker 未落地（exited-not-landed）**

- 未落地原因：task status=ready (not done)
- run_id：wk-prod-anchor
- session_id：fbe83240-0672-42e6-8bd7-034fc36921c7
