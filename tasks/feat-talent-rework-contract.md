---
id: feat-talent-rework-contract
title: 天赋树重做·阶段0：三层节点表 + unlocks 正交通道 + 死节点修复（skillCd/skillPower 接线）
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/meta-tree.test.mjs tests/meta-legacy.test.mjs
---
## Proposal

天赋树重做（`docs/TODO.md` TODO-14，三路子代理收敛）阶段 0 契约层。现状：8 节点全是 +0.1%/级 无感，且**技能系是死权重**——`skillCd`/`skillPower` 键不在 `EFFECT_REGISTRY`，`talentMods`（`meta.js:119`）直接过滤、技能层也从不读，1/3 的树零效果。本任务：① `public/js/shared/data/meta.js` 加 `TALENT_MECHANICS` 机制注册表 + 节点 `unlocks: string[]` 字段 + `talentUnlocks(talent)` 聚合器（镜像 `talentMods`，读 unlocks 过滤 TALENT_MECHANICS）+ `talentEffect` 空值防护（`Object.entries(node.effects || {})`）；② 三层节点表（数值 +1%/级 maxRank 2~3 递增 cost / 解锁暴击·利息·破甲·连锁永驻 maxRank 1 / 质变塔上限+1·技能二次施放·信物可控 maxRank 1）+ 成本阶梯（Tier1 1~2 核、rank2 3~5 核、机制叶子 12~20 核）；③ **死节点修复**：`skillCd`/`skillPower` 注册进 `effects.js` 的 `EFFECT_REGISTRY` + `skill-system.js` 消费（冷却乘进 `stats.cd`、效果乘进技能幅度），把 1/3 的树接活；④ `sim.js` 构造器 +1 行 `this.talentUnlocks = talentUnlocks(opts.talent)`（镜像 `unlockedTowers`，不进 `sim.mods`）。**保留旧 8 节点 id 不变、新节点 cost=1**（`investTalent` 的 points/spent 等价前提），零迁移、`SAVE_VERSION` 不动、确定性不变（talentUnlocks 纯函数零 RNG）。

## AC

- [ ] `meta.js` 落 `TALENT_MECHANICS` + `unlocks` 字段 + `talentUnlocks()` + 空值防护，旧 8 节点 id 保留
- [ ] 三层节点表 + 成本阶梯落地（数值/解锁/质变三类、maxRank/cost 分档）
- [ ] 死节点修复：`skillCd`/`skillPower` 注册进 EFFECT_REGISTRY + skill-system.js 消费，技能节点不再零效果
- [ ] `sim.js` 落 `this.talentUnlocks`（不进 mods、零 RNG）
- [ ] `node --test tests/meta-tree.test.mjs tests/meta-legacy.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/shared/data/meta.js`、`public/js/shared/effects.js`、`public/js/sim.js`、`public/js/sim/skill-system.js`，零第三方依赖
- [ ] 回归测试：talentUnlocks 过滤、三层节点 rank/cost、skillCd/skillPower 接线生效、旧玩家零迁移
- [ ] `npm test` 全绿；补跑 `node --test tests/meta-tree.test.mjs tests/meta-legacy.test.mjs tests/sim-skills.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/data/meta.js`
- `public/js/shared/effects.js`
- `public/js/sim.js`
- `public/js/sim/skill-system.js`
- `tests/meta-tree.test.mjs`
- `tasks/feat-talent-rework-contract.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-14 三路收敛方案。这是阶段 0（契约+死节点修复）；阶段 1（机制消费 baseInterest/二次施放/塔上限 + UI/i18n/路由）与阶段 2（零 meta 基线重排 + balance 复测）依赖本任务落地后拆。数值节点的最终 % 依赖阶段 2 的基线重排决策。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为天赋树契约与死节点修复，机制设计已定稿，无新玩法文档面，L_D/L_G/L_S 无需量化。
