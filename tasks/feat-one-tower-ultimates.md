---
id: feat-one-tower-ultimates
title: 独塔重做·七塔大招：弩/霜/电弧/毒/战旗/震荡/狙击的 10 级独属大招
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-one-tower.test.mjs tests/combat.test.mjs tests/tower-evolution.test.mjs
---
## Proposal

`feat-one-tower-core`（done）已落地「3/6/9 逐级选进化 + 大招触发框架 + 炮台大招参考实现」。本任务按 `docs/TODO.md` TODO-3 的 7 塔大招草案，为其余 **7 座塔**（弩/霜/电弧/毒/战旗/震荡/狙击）在 `ultimateSpec` 里各补一个 10 级大招（常驻特性 + 每 N 次触发效果）。草案数值（待 balance 验证）：

| 塔 | 常驻特性 | 触发大招（每 N 次） |
|---|---|---|
| 弩塔 arrow | 攻速 +20% | 每 6 次 → 贯穿 2 目标（各 60%）+ 必暴击 |
| 霜塔 frost | 减速 +20% | 每 6 次 → 冻结 1.0s（首领 0.5s）+ 冻结易伤 +25% |
| 电弧塔 arc | 连锁 +1、跳转 +0.6 | 每 5 次 → 本次连锁必暴击 + 跳转 +1.2 |
| 毒雾塔 poison | 毒伤 +30% | 每 6 次 → 即时结算当前毒伤（无视护甲）+ 1.5 格传播毒 |
| 战旗 banner | 光环强化 + 获得自攻（军令箭） | 每 5 次 → 号令齐射（光环内 4 目标 150%）+ 全塔攻速 +40% |
| 震荡塔 shock | 击退 +30% | 每 4 次 → 溅射 ×1.6 + 击退 ×2 + 减速 +0.2 |
| 狙击塔 sniper | 射程 +15%、处决线（对 <30% 血 +40%） | 每 4 次 → 无视射程处决：250% + 最大生命 6%（首领 2%） |

**战旗质变**（manager 已裁定）：纯支援塔在独塔模式空转（`tower-system.js` 的 `support` 短路），10 级必须让它获得自身攻击（军令箭，复用 bolt 投射物、吃自己光环），否则独塔+战旗不可玩。实现复用现有机制（贯穿/连锁/冻结/毒/减速/击退/暴击/无视护甲/百分比生命），确定性计数器 `tower.ultimateShots`，不耗 RNG、不改 sim RNG 顺序。

## AC

- [ ] 7 塔各在 `ultimateSpec` 返回大招规格（常驻特性 + 触发 N + 效果），10 级解锁生效
- [ ] 弩贯穿必暴击、霜冻结易伤、电弧连锁暴击、毒即时毒爆传播、战旗自攻号令、震荡溅射击退、狙击无视射程处决——各效果按草案落地
- [ ] 战旗获得自身攻击（军令箭），独塔+战旗可玩
- [ ] 确定性：所有触发计数器不耗 RNG，`sim.js` RNG 顺序不变
- [ ] `node --test tests/hex-one-tower.test.mjs tests/combat.test.mjs tests/tower-evolution.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/shared/hexes/one-tower.js`、`public/js/sim/projectile-system.js`、`public/js/sim/combat-system.js`，不引入第三方依赖
- [ ] 回归测试覆盖 7 塔大招的触发与数值
- [ ] `npm test` 全绿；补跑 `node --test tests/hex-one-tower.test.mjs tests/combat.test.mjs tests/tower-evolution.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/one-tower.js`
- `public/js/sim/projectile-system.js`
- `public/js/sim/combat-system.js`
- `tests/hex-one-tower.test.mjs`
- `tasks/feat-one-tower-ultimates.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` TODO-3（7 塔大招草案）。依赖 `feat-one-tower-core`（done）的 `ultimateSpec` 钩子与 `tower.ultimateShots` 计数器。数值为草案，落地后 `npm run balance` 验证「一塔顶 7 塔」下限。战旗「军令箭自攻」是最大改动点（support 塔短路要开例外）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为玩法重做，机制设计已定稿、无新文档面，L_D/L_G/L_S 无需量化。
