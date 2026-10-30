---
id: gap-goal-011-rogue2-design-rebase-ac
title: GOAL-011 充分性缺口：退出条件 1（设计重基）无在域 AC，8 条草稿 AC 因引用已删脚本无法激活（提案新增可执行 AC）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/rogue2-design.test.mjs
---
## Proposal

GOAL-011（肉鸽养成 2.0：派系、首领核心、契约卡与教义）的退出条件是合取式，共 5 条。goal-sufficiency 机械层判定 `insufficient` 的直接原因是「在域（active/achieved）AC 为 0」——但这不是没人写 AC，而是 8 条草稿 AC 全部卡死在 `draft` 无法激活：

- AC-054..AC-061 的 criterion 全是 `node scripts/rogue2-accept.mjs <sub>`，而 `scripts/rogue2-accept.mjs` 已在 revert `14fec37`（Revert "chore(scripts): 肉鸽 2.0 与发布收口的验收读数器（AC-032..042）"）中被删除，`ls scripts/rogue2-accept.mjs` 现不存在。
- 证据：`.quay/goal-round.jsonl` 第 5 轮（2026-10-30T07:05:29Z）`flips` 里 goal-driver 逐条尝试把 AC-054..AC-061 翻到 `active`，8 条全部 `ok:false`，reason 一致为 `criterion-capability-unevaluable … uncertifiable-executed-artifact: scripts/rogue2-accept.mjs`。这与 GOAL-009 的 AC-047 同一失败模式：criterion 是「不可评估」而非「fail」，目标库拒绝对其激活。⇒ 这 8 条 AC 永远出不了 `draft`，GOAL-011 永远 0 在域 AC、永远 `insufficient`。

**未被覆盖的部分（逐字，退出条件第 1 条）：**

> 设计重基：`docs/PHASE_ROGUE2.md` 定稿，70 件遗物全部有派系或中立归属，并被 `tests/rogue2-design.test.mjs` 覆盖。

**为什么现有 AC 集不覆盖它：** 名义上 AC-054 负责这条，但其 criterion `node scripts/rogue2-accept.mjs design` 引用的是已删除脚本，属 `criterion-capability-unevaluable`、无法激活，构不成在域见证。且该退出条件要求的两个产物目前都不存在：`docs/PHASE_ROGUE2.md` 与 `tests/rogue2-design.test.mjs` 均 MISSING；`docs/PROGRESSION_DESIGN.md` 仍停留在「22→33 件遗物、3 套集合」旧口径，未按当前 70 遗物/6 套装重基。

**提案：为 GOAL-011 新增一条 AC（覆盖退出条件第 1 条）**

- title：设计重基：PHASE_ROGUE2 覆盖 70 件遗物派系/中立归属与核心/契约/教义/觉醒字段表
- criterion：`node --test tests/rogue2-design.test.mjs`
- expect：`exit 0`
- origin：GOAL-011 退出条件 1：设计重基成唯一冻结表。

**为什么这条 AC 覆盖了缺口：** criterion 是 `node --test` 型「读取」判据（与在域 AC-053 的 `npm test`、AC-005 同族），不引用已删除的 `rogue2-accept.mjs`。`tests/rogue2-design.test.mjs` 真实读取 `public/js/shared/data/relics.js` 的 70 个 relic id 逐个断言：每个都有五派系（火力/霜缚/蚀毒/雷暴/守护）或中立归属、4/8/12 三档阈值表齐全、首领核心/契约/教义/觉醒字段表齐全。这正是退出条件第 1 条逐字要求的两个产物（冻结表 + 测试覆盖）。

<!-- dedup-ref --> 关联但已关闭的出处：DOCS-002（superseded）当初的设计重基任务就规定验收为 `node --test tests/rogue2-design.test.mjs exit 0`，DoD 与上段一致；本提案恢复同一验收口径，不新增机制。合并候选：`task-granularity-advice --root /data/home/wenhao/abyss-tower` 对 PHASE_ROGUE2.md / tests/rogue2-design.test.mjs / scripts/test-changed.mjs 返回 peers=[]、mentions=[]。

**本 AC 不覆盖的部分（明说）：** 退出条件第 2–5 条（五派系阈值生效、开局信物、首领核心/契约/教义/觉醒、平衡复测）仍由 AC-055..AC-061 草稿覆盖，但它们的 criterion 同样指向已删的 `rogue2-accept.mjs`，需以同样方式各自换成 `node --test tests/rogue2-*.test.mjs` 读取判据。本提案只处理第 1 条（最前置的冻结表，后续实现任务都以它为准）。

## Plan

1. 人先裁定本提案（见 DoD 最后一项）；执行者不得自行写目标库、不得把 GOAL-011 或任何 AC 置为 active/achieved。
2. 设计重基实现（本提案被采纳后执行；本任务不代写 `docs/PRD.md`/`docs/TECH_DESIGN.md`，只产出冻结表与测试）：
   - 逐件盘点 `public/js/shared/data/relics.js` 的 70 件遗物，标注五派系或中立，落成 `docs/PHASE_ROGUE2.md` 唯一冻结表；
   - 冻结 4/8/12 三档效果表、setMods 新键清单（不塞旧 caps）、首领核心/契约/教义/觉醒字段表；
   - 新增 `tests/rogue2-design.test.mjs`：真实读 `relics.js` 的 70 id 做全覆盖断言，非手写清单；
   - 在 `scripts/test-changed.mjs` 的 TEST_MAP 登记新测试文件（新增源文件不登记会让全量 suite「审计覆盖」条红）。
3. 人把本提案的 criterion 写入 GOAL-011 的目标库（或由 goal-driver 下一轮按新 criterion 激活）；`node --test tests/rogue2-design.test.mjs` 在冻结表与测试落盘后 exit 0。

## AC

- [ ] `node --test tests/rogue2-design.test.mjs` exit 0（设计重基落地后；立案时该文件 MISSING，属预期）
- [ ] `npm test` exit 0
- [ ] 人在 Notes 记录裁定：认可新增 AC（推荐）/ 调整 criterion / 改为修订退出条件并说明理由（待外部）
- [ ] 被采纳的 AC 由人写入 GOAL-011 目标库；本任务不写 goal-store、不改 `goals/*.md`（待外部）

## DoD

- [ ] `docs/PHASE_ROGUE2.md` 是唯一冻结表：70 件遗物每个都有派系或中立归属，4/8/12 三档与核心/契约/教义/觉醒字段表齐全
- [ ] 测试真实读取 `relics.js` 的 70 id 做覆盖断言，不是手写清单
- [ ] 本任务自身未写 goal-store：只读 goal_get / goal_list / task_list，未调 goal_write，未改 `goals/*.md`
- [ ] 人裁定记录写入 Notes，GOAL-011 的在域 AC 集不再为空（待外部）

## Touches

- `docs/PHASE_ROGUE2.md` (new)
- `tests/rogue2-design.test.mjs` (new)
- `scripts/test-changed.mjs`
- `tasks/gap-goal-011-rogue2-design-rebase-ac.md`

## Notes

本任务是 goal-sufficiency 的提案任务，状态 `needs-human`：`goals/*.md` 只由人/管理者写入，执行者不得自行登记新 AC，也不得把 GOAL-011 或任何 AC 置为 achieved/active。遵循 CLAUDE.md：`docs/PRD.md`/`docs/TECH_DESIGN.md` 不在 Touches（只由 DOCS lane 更新）。若人选择「修订退出条件」而不是新增 AC，请在裁定里说明理由并把本任务 supersede。