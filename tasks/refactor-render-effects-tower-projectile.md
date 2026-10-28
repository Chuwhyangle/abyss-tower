---
id: refactor-render-effects-tower-projectile
title: 重构 R2：拆分 effect/tower/projectile 渲染器
status: done
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: npm test
depends_on:
  - refactor-baseline-and-structure-gate
goal_ac: AC-043
---
## Proposal

`effect-renderer.js`（1049）、`tower-renderer.js`（1054）、`projectile-renderer.js`（772）同样是「事件/变体/预算表 + 粒子池 + 绘制」混在一个模块。特效是本项目改动最频繁的区域之一，拆分后数据表与绘制逻辑可分别演进，且并行任务不再互斥。行为与像素零变化。

## Plan

1. `effect-renderer.js`：外提 `effect-data.js`（EFFECT_EVENTS、EFFECT_KIND_EVENTS、EFFECT_PROFILES、EFFECT_VARIANTS、SHARP_HIT_STAR、显存/粒子预算常量），
   外提 `effect-pool.js`（ParticlePool），`effect-draw.js`（drawSharpHitStar、impactFor、effectProgress 与各事件绘制），类保留编排。
2. `tower-renderer.js`：外提 `tower-data.js`（TOWER_ANIMATIONS、RECOIL、ANIM_VARIANTS、SKIN_OUTLINE_BUDGET、EVOLUTION_* 表），
   `tower-draw.js`（塔体、进化视觉、后坐力绘制）。
3. `projectile-renderer.js`：按弹种把绘制函数外提为 `projectile-draw.js`，类只留编排与缓存。
4. 每步跑 `npm test` 与 `node scripts/visual-parity.mjs --check`；最后删除本任务债务文件。

## AC

- [x] 三个入口文件与所有新模块均 ≤ 600 行；数据模块满足纯度规则
- [x] 公共导出名与签名不变（`EFFECT_EVENTS`、`ParticlePool`、`TOWER_ANIMATIONS`、`evolutionVisual`、`ProjectileRenderer` 等）
- [x] `npm test` 全绿；静态检查通过
- [x] `node scripts/visual-parity.mjs --check` exit 0
- [x] `node scripts/structure-budget.mjs --check` exit 0，且 `refactor-render-effects-tower-projectile.json` 已删除
- [x] `npm run perf:budget` 通过（粒子池拆分不得改变分配次数）

## DoD

- [x] 纯移动优先，不顺手优化；问题写 Notes 另立任务
- [x] 无兼容重导出壳；测试 import 同步更新
- [x] 边界与 `docs/PHASE_REFACTOR.md` §6 R2 一致

## Touches

- `public/js/render/effect-renderer.js`
- `public/js/render/effect-data.js` (new)
- `public/js/render/effect-pool.js` (new)
- `public/js/render/effect-draw.js` (new)
- `public/js/render/effect-boss.js` (new)
- `public/js/render/tower-renderer.js`
- `public/js/render/tower-data.js` (new)
- `public/js/render/tower-draw.js` (new)
- `public/js/render/tower-body.js` (new)
- `public/js/render/projectile-renderer.js`
- `public/js/render/projectile-draw.js` (new)
- `scripts/structure-budget.allow.d/refactor-render-effects-tower-projectile.json`
- `scripts/test-changed.mjs`
- `tests/render-visuals.test.mjs`
- `tests/effect-variants.test.mjs`
- `tests/render-effects.test.mjs`
- `tests/impact-vfx.test.mjs`
- `tests/impact-vfx-drive.mjs`
- `tests/impact-class-feedback.test.mjs`
- `tests/render-animations.test.mjs`
- `tests/skin-budget.test.mjs`
- `tests/tower-evo-visuals.test.mjs`
- `tests/projectile-visuals.test.mjs`
- `tests/render-budget.test.mjs`
- `tests/skill-style.test.mjs`
- `tasks/refactor-render-effects-tower-projectile.md`

## Notes

2026-10-29 实施记录（分支 `task/refactor-render-effects-tower-projectile`）：

- 拆分边界（§4 依赖方向 data → primitives → entity → orchestrator）：
  - 特效：`effect-data.js`（事件表 / kind→事件映射 / 画质档 / 变体视图 / 预算换算，只依赖 shared 纯表）→
    `effect-pool.js`（ParticlePool）、`effect-draw.js`（逐事件画法 + 星芒 / 命中类别层 / 战旗光环 / 进度换算）、
    `effect-boss.js`（蓄力 / 咆哮 / 召唤 / 震击）→ `effect-renderer.js`（档位重置 + 逐事件分派）。
  - 塔：`tower-data.js`（动画预算 / 后坐系数 / 皮肤描边预算 / 进化视觉表，零 import）→
    `tower-draw.js`（进化轮廓与符文、停摆表现）、`tower-body.js`（八种塔体造型）→ `tower-renderer.js`（遍历编排 + 放置预览）。
  - 弹道：`projectile-draw.js`（kind 形态表 + 八塔型形态表 + 形态解析）→ `projectile-renderer.js`（贴图光栅化缓存 + 分桶编排）。
- 相对 Plan 的增量（Plan 未枚举，属 §4 的「绘制原语 / 单实体绘制」层）：`effect-boss.js`、`tower-body.js`。
  单列这两个才能让所有新模块 ≤ 600 行；绘制方法以「方法集合挂回同一原型」组织，与 `skill-draw.js` / `enemy-body.js` 既有惯例一致
  （对外仍是同一个实例、同一套方法签名）。
- 纯移动见证：脚本把 HEAD 上的旧模块与拆分后模块渲染到同一个录制型 ctx（方法名 + 参数逐条记录，`Math.random` 固定种子），
  逐调用比对完全一致——特效 8988 条（24 种事件 × 3 画质档 × 3 帧）、塔 4138 条（8 塔型 × 进化/停摆/后坐 × 3 档）、
  弹道 2219 条（13 种形态 × 3 档）。导出名与签名不变，未加兼容重导出壳。
- 数据纯度：`effect-data.js` 只 import `shared/data.js` 与 `shared/impact-class-feedback.js`；
  kill 事件的高光色需 `Palette.semanticColor('buff')`，而数据模块不得 import `public/js/render/`，
  故取字面量 `#ffd36b`，并在 `tests/render-visuals.test.mjs` 新增断言把它与 `Palette.semanticColor('buff')` 锁死（语义色改表时先红）。
- 源码级契约改为覆盖整组模块的合并源串（沿用 R1 做法）；`skill-style` 的语义色守卫覆盖运行时模块，
  `effect-data.js` 作为色值表本身不在此列（其字面量由上面那条锁死断言把关）。
- `scripts/test-changed.mjs` 登记 7 个新源文件（审计覆盖门禁要求，否则 `tests/test-changed.test.mjs` 判红）。
- 行数：effect-renderer 142 / effect-data 281（数据豁免）/ effect-pool 30 / effect-draw 570 / effect-boss 184；
  tower-renderer 275 / tower-data 181（数据豁免）/ tower-draw 212 / tower-body 412；
  projectile-renderer 207 / projectile-draw 569。
- 见证读数：`npm test` 1747/1747 全绿；`check:syntax` / `check:imports`（210 文件 579 依赖，无越层无环）/ `check:style` / `check:docs` 通过；
  `structure-budget --check` OK（464 源文件，债务 4 条，本任务条目已删）；`visual-parity --check` OK（182 帧：173 逐像素一致 + 9 容差内变体）；
  `perf:budget` PASS（normal-1x-low 1.197→0.524ms、late-3x-high 2.089→0.922ms、skills-1x-high 4.710→1.958ms）；`dead-exports` 无新增。
- 环境注记：`visual-parity --check` 需 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`（与本次改动无关的既有要求）。
