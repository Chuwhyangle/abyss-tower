---
id: gap-balance-bot-boss-counter
title: 平衡口径对齐：机器人真人下限（补狙击/战旗 + 技能/海克斯/进化），删旧口径，重跑三档校准（AC-052）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-052
---
## Proposal

人已裁定两件事，本任务一并落地：

1. **机器人塔组补狙击/战旗**仍属「真人下限」不是作弊（首领是主要威胁时真人天然建单体高伤塔 + 光环辅助；真人下限约束是决策固定、不卖塔、不卡时机，不是故意配烂塔）。
2. **删除旧口径、全对齐到新口径**：`--skill=none` 默认、`--baseline` v1.31 随机图对照、balance-sim 里「机器人不选主海克斯/不做分支进化/不主动用技能」的描述，全部删掉；统一以「真人下限」为唯一口径（技能 aurora + 主海克斯 + 塔进化 + 固定塔组含狙击/战旗）。

<!-- dedup-ref --> 承接 `gap-ac-052-balance-retest`（superseded）Notes 的「选项 2」与人的口径对齐裁定；AC-052/061/065 三个平衡 AC 共根因，本任务一次收口。

## Plan

1. `tests/lib/balance-bot.mjs`：机器人默认走真人下限——技能 aurora（冷却好就放）、开局选主海克斯（第一 offer）、满级塔进化（第一分支）、固定塔组含狙击/战旗；不卖塔、不卡技能时机。配比与「真人下限」论证写入 Notes。
2. `tests/balance-sim.mjs`：删 `--baseline`（v1.31 随机图对照）与 `--skill=none` 默认口径；机器人描述改为真人下限；`--skill` 参数只保留 `aurora|meteor|chrono` 显式覆盖（默认 aurora）。
3. `config.js BALANCE_TARGETS` 不变（70–85 / 25–40 / 5–12 数值口径维持），但 docs/BALANCE.md 的「口径」说明改为真人下限解读。
4. `node tests/balance-sim.mjs 40` 跑三档，漫游 ≥70%、远征/深渊不越上限；越线只回调波次组成/新敌人数值（GOAL-010 非目标红线内）。
5. `--write` 重写 docs/BALANCE.md，删掉 v1.31 对照段落。

## AC

- [ ] `grep -qE 'sniper|banner' tests/lib/balance-bot.mjs` exit 0（塔组含狙击/战旗）
- [ ] `! grep -q '\-\-baseline' tests/balance-sim.mjs` exit 0（旧 v1.31 对照已删）
- [ ] `! grep -qE '^[|] (漫游|远征|深渊) [|].*[|] (低于目标|高于目标) [|]' docs/BALANCE.md` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 机器人唯一口径为真人下限（技能/海克斯/进化/狙击/战旗默认生效），旧 `--skill=none` 与 v1.31 对照已删除；配比与论证写入 Notes
- [ ] 40 种子复跑三档落进 70–85 / 25–40 / 5–12，docs/BALANCE.md 由同一轮生成、无 v1.31 对照、无手工改数字

## Touches

- `tests/lib/balance-bot.mjs`
- `tests/balance-sim.mjs`
- `public/js/shared/config.js`
- `docs/BALANCE.md`
- `tasks/gap-balance-bot-boss-counter.md`
