---
id: feat-one-tower-ultimates
title: 独塔重做·七塔大招：弩/霜/电弧/毒/战旗/震荡/狙击 各一个被动触发大招
status: ready
labels:
  - feat
parent: null
children: []
depends_on:
  - feat-one-tower-core
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs
---
## Proposal

依赖 `feat-one-tower-core`（10 级大招触发框架 + 炮台参考实现）。本任务填其余 7 塔大招，数值按 `docs/TODO.md` TODO-3 的草案表落地，全部走框架的塔级确定性计数器（每 N 次攻击触发一次），不消耗 RNG、不改 `sim.js` RNG 顺序：

- 弩塔「贯日」：常驻攻速 +20%；每 6 次 → 下一发贯穿 2 目标（各 60%）+ 必暴击
- 霜塔「急冻」：常驻减速 +20%；每 6 次 → 命中冻结 1.0s（首领 0.5s）+ 冻结易伤 +25%
- 电弧塔「天罚」：常驻连锁 +1、跳转 +0.6 格；每 5 次 → 本次连锁必暴击 + 跳转 +1.2 格
- 毒雾塔「疫爆」：常驻毒伤 +30%；每 6 次 → 即时结算当前毒伤（无视护甲）+ 1.5 格传播毒
- 战旗「凯旋」（质变）：常驻光环强化 + 获得自攻（军令箭）；每 5 次 → 号令齐射（光环内 4 目标 150%）+ 全塔攻速 +40%
- 震荡塔「地裂」：常驻击退 +30%；每 4 次 → 溅射 ×1.6 + 击退 ×2 + 减速 +0.2
- 狙击塔「处决」：常驻射程 +15%、处决线（对 <30% 血 +40%）；每 4 次 → 无视射程处决 250% + 最大生命 6%（首领 2%）

战旗是纯支援塔，`support` 塔不索敌不攻击，独塔模式下会空转——本任务须让它获得自身攻击（复用 bolt 投射物 + 自身光环自加成），这是三路子代理一致同意的质变。大招定义挂在 `public/js/shared/hexes/one-tower.js` 的钩子里，结算复用 chain/splash/slow/dot/knockback/crit/ignoreArmor/freeze 既有机制。

## AC

- [ ] 7 塔大招全部实现，走 `feat-one-tower-core` 的触发计数器框架，10 级解锁
- [ ] 战旗获得自身攻击能力（军令箭 + 号令齐射），不再是纯支援
- [ ] 数值按草案表落地，不消耗 RNG、不改 `sim.js` RNG 调用顺序
- [ ] `node --test tests/hex-one-tower.test.mjs` exit 0（7 塔大招断言）

## DoD

- [ ] 落地于 `public/js/shared/hexes/one-tower.js`、`public/js/sim/projectile-system.js`、`public/js/sim/combat-system.js`，不引入第三方依赖
- [ ] 回归测试覆盖每塔大招触发与数值（至少触发计数、常驻特性、首领打折）
- [ ] `npm test` 全绿；补跑 `node --test tests/hex-one-tower.test.mjs tests/combat.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/one-tower.js`
- `public/js/sim/projectile-system.js`
- `public/js/sim/combat-system.js`
- `tests/hex-one-tower.test.mjs`
- `tasks/feat-one-tower-ultimates.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-3 草案表。依赖 `feat-one-tower-core`（`depends_on` 顶层声明），须待其 done 后派发。若 worker 实际 Touches 与声明有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为玩法内容填充，机制设计已定稿、无新文档面，L_D/L_G/L_S 无需量化。
