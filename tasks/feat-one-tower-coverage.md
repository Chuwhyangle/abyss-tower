---
id: feat-one-tower-coverage
title: 独塔覆盖脉冲 + 震荡软锁修复 + 数值回调（非 AOE 塔回目标区间）
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs tests/combat.test.mjs
---
## Proposal

`feat-one-tower-balance`（needs-human）诊断出独塔覆盖极化：单塔只有电弧（连锁）与炮台（全图）能赢，其余 6 塔 0%，根因是单塔武器缺「同时命中数」与「跨路射程」，纯数值调不动。三路覆盖子代理收敛到**方案 A「大招覆盖脉冲化」**：大招触发时（现有 `tower.ultimateShots % every` 确定性计数器，`projectile-system.js`）不再只打落点单目标，而是**全图按 progress 降序 / id 升序取前 K 名敌人，用该塔自己的武器签名结算**（泛化 `applyBannerVolley` 的现成循环，把「光环内」换「全图」；全部非 RNG 路径，不改 `sim.js` 确定性）。**不授予任何塔常驻 fullMap**（炮台身份不被稀释）。

- **6 塔 pulse 签名**（数值草案，`npm run balance` 收口）：弩=前 4 名 70% 伤害+必暴击（连珠齐射）；霜=前 4 名冻结 0.6~1.0s（寒潮）；毒=前 5 名当前 DoT 疫爆；震荡=以最深入敌人为圆心大半径（6~8 格）震啸（溅射+击退+减速）；战旗=全图前 4 名齐射（删 `applyBannerVolley` 的光环范围门）；狙击=处决贯线（最深入 lane 2~3 名）。
- **不接入脉冲**：电弧（已有连锁）、炮台（已有 fullMap）。
- **射程成长 0.04→0.07**（`one-tower.js` `LEVEL_GROWTH.range`，帮短程 AOE 塔够到汇流点）；**溅射成长 (1+0.06)^extraTiers**（炮台/震荡）。
- **战旗 selfAttack 吃等级成长**（现 `one-tower.js` 用 45 硬覆盖了等级化 dmg，是战旗 0% 的独立主因）。
- **震荡击退软锁修复**（`combat-system.js` 击退处）：按质量衰减（首领/魔像 ×0.15~0.2、石卫/石盾 ×0.4、普通 ×1.0）+ 单目标击退冷却 0.4s + 击退深度封顶 3 格（`enemy.maxProgress` 记录），确保敌人一旦前进就永远净前进。

## AC

- [ ] 6 塔大招触发时全图取前 K 名敌人结算（progress 降序/id 升序，非 RNG）
- [ ] 电弧/炮台不接入脉冲，身份不稀释
- [ ] 射程成长 0.07、溅射成长、战旗 selfAttack 成长落地
- [ ] 震荡击退软锁消除（质量衰减+冷却+深度封顶），波次可正常结束
- [ ] `npm run balance` 复测：6 塔漫游回 70~85%、深渊 5~12%、电弧 ≤85%（越线再回调）

## DoD

- [ ] 落地于 `public/js/shared/hexes/one-tower.js`、`public/js/sim/projectile-system.js`、`public/js/sim/combat-system.js`，不引入第三方依赖
- [ ] 回归测试覆盖脉冲 top-K 确定性、各塔签名、击退软锁消除
- [ ] `npm test` 全绿；`npm run balance` 复测达标（`docs/BALANCE.md` 脚本重写）
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/one-tower.js`
- `public/js/sim/projectile-system.js`
- `public/js/sim/combat-system.js`
- `tests/hex-one-tower.test.mjs`
- `tasks/feat-one-tower-coverage.md`

## Notes

立案 2026-11-03，源自 `feat-one-tower-balance` needs-human 的 AC2 决策。manager 裁定：采纳三路收敛的「大招覆盖脉冲化」（方案 A），不接受「独塔只有电弧/炮台能玩」。数值为草案锚点（topK/mul/半径/射程成长），`npm run balance` 40 种子收口。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为覆盖机制补齐，契约已定稿，无新文档面，L_D/L_G/L_S 无需量化。
