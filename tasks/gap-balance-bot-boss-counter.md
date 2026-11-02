---
id: gap-balance-bot-boss-counter
title: 机器人塔组补狙击/战旗首领对策塔（真人下限）+ 重跑三档校准（AC-052）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-052
---
## Proposal

人已裁定：机器人塔组补狙击（首领单体对策）与战旗（光环辅助）仍属「真人下限」，不是作弊。理由：首领是主要威胁时真人天然会建单体高伤塔针对首领，战旗光环是常见辅助；机器人当前「不建狙击/战旗」是不真实的过度弱势，用它校准出的目标会让真人轻松碾压。真人下限的约束是「决策固定、不随波次自适应、不卖塔、不卡技能时机」，而非「故意配一套烂塔」。

护城河：塔组仍固定、不按波次切换；只补狙击/战旗到合理配比（不做完美 meta 配比）；技能时机/卖塔/遗物选择维持原样。

<!-- dedup-ref --> 承接 `gap-ac-052-balance-retest`（needs-human）Notes 里的「选项 2」；机器人真人下限（技能 aurora / 主海克斯 / 塔进化）修复是前置口径，若未落地需一并补齐。

## Plan

1. 补 `tests/lib/balance-bot.mjs` 固定塔组：加入狙击与战旗（首领对策 + 光环），配比写入 Notes 并论证「真人下限」。
2. 确认技能/海克斯/进化三件真人下限修复在机器人里生效（未落地则补齐）。
3. `node tests/balance-sim.mjs 40 --skill=aurora` 跑三档，看漫游是否 ≥70%、远征/深渊是否不越线上限（40%/12%）。
4. 若越线，按 GOAL-010 非目标只回调波次组成/新敌人数值，复跑直到三档落带。
5. `--write` 重写 `docs/BALANCE.md`。

## AC

- [ ] `grep -qE 'sniper|banner' tests/lib/balance-bot.mjs` exit 0（机器人塔组含狙击/战旗）
- [ ] `! grep -qE '^[|] (漫游|远征|深渊) [|].*[|] (低于目标|高于目标) [|]' docs/BALANCE.md` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 机器人塔组固定含狙击/战旗、不随波次切换、不卖塔、不卡技能时机；配比与「真人下限」论证写入 Notes
- [ ] 40 种子复跑三档通关率落进 70–85 / 25–40 / 5–12，`docs/BALANCE.md` 由同一轮生成、无手工改数字

## Touches

- `tests/lib/balance-bot.mjs`
- `tests/balance-sim.mjs`
- `docs/BALANCE.md`
- `tasks/gap-balance-bot-boss-counter.md`
