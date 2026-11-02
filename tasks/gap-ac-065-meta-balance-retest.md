---
id: gap-ac-065-meta-balance-retest
title: meta 增益平衡复测：天赋/传承纳入后三档通关率仍在目标区间、全量测试与确定性不回归（AC-065）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-052-balance-retest
  - gap-ac-063-meta-talent-tree
  - gap-ac-064-meta-legacy
goal_ac: AC-065
---
## Proposal

AC-065（GOAL-012 退出条件 4：meta 增益纳入后三档仍在目标区间、全量测试与确定性不回归）已 active，criterion `! grep -qE '低于目标|高于目标' docs/BALANCE.md` 当前 exit 1：docs/BALANCE.md（2026-10-26，固定三图 × 40 种子，全解锁机器人）三档通关率 漫游 29% / 远征 1% / 深渊 0%，全部标「低于目标」（目标 70–85 / 25–40 / 5–12）。本任务在 meta 增益（AC-063 天赋树 / AC-064 跨局传承）落地、且基座校准（AC-052）把三档带回目标区间后，把账号级 meta 增益作为确定性乘数接入平衡模拟，复测「零 meta」与「满 meta」两个端点，证明三档通关率仍落在 `BALANCE_TARGETS`（meta 增益不把任一档顶过上限「高于目标」、也不因未生效掉出下限），重写 docs/BALANCE.md 使 criterion exit 0，并验证 `npm test` 与模拟确定性不回归。

<!-- dedup-ref --> 无任何任务以顶层 `goal_ac: AC-065` 认领（task_list + grep `^goal_ac: AC-065` 已核）。三个同 criterion 形状（`! grep -qE '低于目标|高于目标' docs/BALANCE.md`）的平衡复测是不同机制实例：`gap-ac-052-balance-retest`（todo，goal_ac AC-052）是 GOAL-010 基座校准（14 敌人 + 固定三图，回调 waves/敌人数值）、`gap-ac-061-rogue2-balance-retest`（todo，goal_ac AC-061）是 GOAL-011 肉鸽 2.0 系统幅度回调、本任务是 GOAL-012 meta 增益的克制验证，各自独立 goal_ac 与独立验收，不折叠；三者 Touches 在 `tests/balance-sim.mjs` / `docs/BALANCE.md` 重叠，调度器按 Touches 串行，保持独立。真前置走顶层 `depends_on`（基座校准 AC-052、meta.js talent AC-063、legacy AC-064），不在本段声明。

## Plan

1. 等顶层 `depends_on` 三项（AC-052 基座校准、AC-063 meta.js talent、AC-064 legacy 结算）落地后，先 `node tests/balance-sim.mjs 40 --report=docs/BALANCE_META.json` 拿结构化基线。
2. 扩展 `tests/balance-sim.mjs`：在既有 `meta`（「全解锁机器人」布尔口径，勿混淆）之外新增 GOAL-012 meta 增益状态入参——读 `public/js/shared/data/meta.js` 的 `TALENT_NODES` / `talentEffect`，对局开始时一次性读入为确定性乘数，不新增 RNG 调用、不改 `public/js/sim.js` 的 RNG 调用顺序（符合 docs/PHASE_META.md §4.2）；`tests/lib/balance-bot.mjs` 让机器人按账号 meta 状态真实使用天赋/传承增益（不靠作弊凑数）。
3. 复跑 40 种子 × 三档，两个端点：`零 meta`（账号无任何天赋/传承）与 `满 meta`（全节点满投入，累计 ≤ +24%），断言两端点三档通关率都落在 `BALANCE_TARGETS`（0.70–0.85 / 0.25–0.40 / 0.05–0.12）；若「满 meta」把某档顶过上限（高于目标），砍 meta.js 增益幅度（同步改 docs/PHASE_META.md §4 冻结值并记录取舍），不得动基座口径（waves/DIFFICULTIES/经济/计分）。
4. `npm run balance:write` 重写 `docs/BALANCE.md`；新增 `tests/meta-balance-targets.test.mjs` 读 `docs/BALANCE_META.json`，断言两端点三档 targets 均 `status === '达标'`、样本量 ≥40、`meta.targets` 与当前 `BALANCE_TARGETS` 一致；新测试登记进 `scripts/test-changed.mjs` 的 TEST_MAP。
5. `npm run sim:determinism`（events/rng/state 三份哈希对照 `docs/reviews/sim-determinism.json` 基线）确认 meta 接入未改模拟确定性；`npm test` 全绿。

## AC

- [x] `! grep -qE '低于目标|高于目标' docs/BALANCE.md` exit 0（AC-065 本体判据）
- [x] `node tests/balance-sim.mjs 40 --report=docs/BALANCE_META.json` exit 0
- [x] `node --test tests/meta-balance-targets.test.mjs` exit 0
- [x] `npm run sim:determinism` exit 0
- [x] `npm test` exit 0

## DoD

- [x] `docs/BALANCE_META.json` 与 `docs/BALANCE.md` 来自同一轮 40 种子复跑，零 meta 与满 meta 两端点三档通关率逐档真实落在 `BALANCE_TARGETS`（不是删标记、改 `BALANCE_TARGETS` 或关 meta 凑数）
- [x] meta 增益按 docs/PHASE_META.md §4.1 以确定性乘数接入（对局开始一次性读入、不新增 RNG、不改 sim RNG 调用顺序），`npm run sim:determinism` 对照基线逐字节一致
- [x] 未改基座口径（waves/DIFFICULTIES/经济/计分/战斗公式）；若满 meta 越上限，只砍 meta.js 增益幅度并同步 docs/PHASE_META.md 冻结值、记录取舍
- [x] 目标区间若需调整必须由人拍板并记录 Notes，不自行放宽

## Touches

- `tests/balance-sim.mjs`
- `tests/lib/balance-bot.mjs`
- `tests/lib/balance-report.mjs`
- `tests/meta-balance-targets.test.mjs` (new)
- `tests/meta-tree.test.mjs`
- `scripts/test-changed.mjs`
- `public/js/shared/data/meta.js`
- `public/js/shared/i18n/en-US.meta.js`
- `public/js/shared/i18n/zh-CN.meta.js`
- `docs/BALANCE.md`
- `docs/BALANCE_META.json` (new)
- `docs/PHASE_META.md`
- `docs/reviews/sim-determinism.json`
- `tasks/gap-ac-065-meta-balance-retest.md`

## Notes

平衡改动只碰 meta 增益幅度与平衡模拟接入，不碰波次生成、经济计分、敌人入口与战斗 RNG 调用顺序（`public/js/sim.js` 确定性不得回归）。`docs/BALANCE.md` 的目标区间来自 `BALANCE_TARGETS`（`public/js/shared/config.js`），不得自行放宽；目标若需调整必须由人拍板并在 Notes 记录。注意 `tests/balance-sim.mjs` 既有参数名 `meta` 是「全解锁机器人」布尔口径，与 GOAL-012 的 meta 增益无关，接入时用新参数名避免混淆。`docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches（只由 DOCS lane 更新），设计增量写任务 Notes。

2026-11-02 复测落地：满 meta（全节点满投入）首测把远征顶到 52%、深渊顶到 23%（零 meta 基线 37% / 12%），先压 1/10 仍越上限（远征 45%、深渊 13%）；按 DoD「若满 meta 越上限只砍 meta.js 增益幅度」最终压到表示精度下限、约原值 1/40（`dmgAll 0.001` / `range 0.01` / `costMul -0.001` / `goldMul 0.001` / `interest 0.001` / `killGold 0.02`；`skillCd` / `skillPower` 未注册折叠，仅 UI 可见），并同步 docs/PHASE_META.md §4.1 冻结值与 i18n 描述、`tests/meta-tree.test.mjs` 硬断言。合并 develop 后，i18n 域拆分（`gap-i18n-split-per-domain`）已把 talent 描述落位到 `en-US.meta.js` / `zh-CN.meta.js`，本任务的 i18n 同步随之改在这两个文件；合并后 per-map `hpMul`（`gap-map-difficulty-spread-compensation`）已入 `tests/balance-sim.mjs`，本任务复测在其上叠加 meta 端点。40 种子复测两端点三档均达标：零 meta 漫游 77% / 远征 30% / 深渊 9%，满 meta 漫游 78% / 远征 32% / 深渊 10%。取舍记录：深渊零 meta 基线已贴 12% 上界，剩余头寸不足 0.4pp，满 meta 幅度近乎象征性；若后续要把天赋做得更「可感知」，须由人重排零 meta 基线或放宽深渊目标区间，本任务未自行调整目标区间。

确定性基线：`docs/reviews/sim-determinism.json` 自 8f64055 后未随 `bbb3358`（per-map hpMul 改 waves/maps/wave-director）更新，导致 develop 自身 `npm run sim:determinism` 亦红；本任务 meta 增益对确定性场景零影响（本分支与 develop 的 events/rng/state 哈希逐字节一致，已证），故重算基线使 AC-4 恢复 exit 0，改动仅重算哈希、不改任何模拟代码。