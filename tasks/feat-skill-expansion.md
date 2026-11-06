---
id: feat-skill-expansion
title: 技能扩展：3 技能 → 5-6 技能（或每局变异分支）
status: done
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

技能扩展（P2-12）。现状：3 技能两胜全解锁，无变化。改 6+ 技能或每局变异分支：

- 新增 2~3 个技能（复用 `skills.js` 的技能骨架 + `skill-system.js` 行为），扩到 5~6 个。
- 或每局开局从技能池随机 3 个（变异分支），增加每局技能组合差异。
- 数值按现有技能口径（`skillStats`/`skillUpgradeCost`），balance 复测。

## AC

- [x] 技能总数 ≥5（新增 2+ 个，各有独特机制）
- [x] 确定性保持：技能 seed 派生，不改 sim.js RNG 顺序
- [x] `npm test` 全绿；技能测试覆盖新增技能
- [x] balance 复测不漂移

## DoD

- [x] 落地于 `skills.js` + `skill-system.js`（+i18n），零第三方依赖
- [x] 不碰现有 3 技能数值（只新增）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/data/skills.js`
- `public/js/sim/skill-system.js`
- `public/js/render/art-tokens.js`
- `public/js/render/skill-data.js`
- `public/js/shared/achievements-data.js`
- `public/js/shared/i18n/zh-CN.ui.skill.js`
- `public/js/shared/i18n/zh-CN.ui.achievements.js`
- `public/js/shared/i18n/en-US.ui.skill.js`
- `public/js/shared/i18n/en-US.ui.achievements.js`
- `public/js/ui/shared.js`
- `scripts/structure-budget.allow.d/feat-skill-expansion.json`
- `tests/achievements-depth-v2.test.mjs`
- `tests/skills.test.mjs`
- `tests/sim-skills.test.mjs`
- `tasks/feat-skill-expansion.md`

## Notes

立案 2026-11-06，源自 P2-12「技能扩展：3 技能两胜全解锁，改 6+ 或每局变异分支」。⚠️ 改 skill-system 须守 sim 确定性；数值需 balance 复测。

**设计增量（已落地，待 DOCS lane 同步总文档）**

- 新增 3 技能（`unlock: 'default'` 初始拥有），扩至 6 技能：`SKILL_ORDER = ['aurora','meteor','chrono','storm','plague','reignite']`。
  - 风暴·链雷（storm，burst，bossFactor 0.35，cd 50s）：从最深敌群起跳，3 连逐跳衰减（falloff 0.65），首跳 16% 最大生命；L4 主目标灼烧时连锁 +1；L7 每跳 25% 概率分叉 50% 旁支；L10 死于链雷的敌人在 0.8 格内爆发 3% 最大生命静电。
  - 疫病·腐潮（plague，control，bossFactor 0.4，cd 70s）：全场 6s DoT（15% 最大生命）+ 减速 30% 4s；L4 减速时长 +2s；L7 场上 ≥10 敌时总伤 ×1.5；L10 腐潮期间击杀向 1 格内传播 30% 减速 3s。
  - 重燃·熔炉（reignite，ultimate，bossFactor 1，cd 80s）：回复 25% 最大生命 + 全塔过载 3s（攻速 +40%）；L4 过载射程 +0.5 格；L7 基地 <50% 时回复 ×1.5；L10 攻速额外 +20%。
  - 数值沿用 `skillStats`/`skillUpgradeCost` 口径（10 级线性插值），不碰现有 3 技能数值。
- 成就 `skill_all_unlocked`（三式齐备→六式齐备）与 `skill_all_max` 目标 3→6，同步 i18n（zh-CN/en-US `.skill.js`/`.achievements.js`）。
- 渲染：`art-tokens.js`/`skill-data.js` 补三技能语义映射与警告半径；`ui/shared.js` 补 `skillSummary` 分支。
- 确定性：storm 分叉用 `skillRng`（`${seed}:skill:${wave}:${skillCastCount}` 派生），不动 `sim.js` 战斗 RNG 调用顺序。

**验收复核（2026-11-06 续做）**

- `npm test` 全绿 2100/2100；`tests/sim-skills.test.mjs`/`tests/skills.test.mjs` 覆盖三新技能全部里程碑。
- `npm run balance`（40 seeds，bot 默认 aurora 口径）复测：本任务对 aurora 路径零改动（skills.js 仅新增、skill-system.js 仅新增分支），balance 输出与任务前一致，无漂移。
- `scripts/structure-budget.mjs` OK；`skill-system.js` 695 行、`sim-skills.test.mjs` 840 行，均在 `feat-skill-expansion.json` 豁免预算内。
