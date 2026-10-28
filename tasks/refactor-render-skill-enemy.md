---
id: refactor-render-skill-enemy
title: 重构 R1：拆分 skill-renderer 与 enemy-renderer
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

`skill-renderer.js`（1396 行）与 `enemy-renderer.js`（1081 行）把静态表（画质档、警告注册表、动画变体、闪白参数）与绘制逻辑混在一起。数据改一行要读懂整套绘制；两个文件也是并行任务的热点互斥点。本任务按「数据 / 反馈原语 / 绘制 / 编排」拆开，行为与像素零变化。

## Plan

1. `skill-renderer.js`：外提 `skill-data.js`（QUALITY_CAPS、SKILL_QUALITY_PROFILES、SKILL_WARNING_PROFILES/REGISTRY、颜色工具），
   外提 `skill-warnings.js`（renderWarnings + warningCountdown 相关），`skill-draw.js`（技能本体绘制），
   类保留为编排；对外导出名与签名不变，调用方 import 路径同步更新。
2. `enemy-renderer.js`：外提 `enemy-data.js`（ENEMY_ANIMATIONS、ENEMY_WALK_PROFILES、ENEMY_ANIM_VARIANTS、SKIN_OUTLINE_BUDGET、HIT_HIGHLIGHT），
   外提 `enemy-feedback.js`（hitFlashAlpha、hitHighlightAlpha、drawHitHighlight），Boss 地面与身体绘制各自成函数模块；
   类保留编排。
3. 每一步先跑 `npm test` 与 `node scripts/visual-parity.mjs --check`，再进入下一文件。
4. 删除 `scripts/structure-budget.allow.d/refactor-render-skill-enemy.json`。

## AC

- [x] `skill-renderer.js`、`enemy-renderer.js` 均 ≤ 600 行；新增的 `skill-*`/`enemy-*` 模块均 ≤ 600 行且数据模块满足纯度规则
- [x] 公共导出名与签名不变（`qualityProfile`、`SkillRenderer`、`enemyWalkProfile`、`hitFlashAlpha`、`EnemyRenderer` 等），无兼容重导出壳
- [x] `npm test` 全绿；`npm run check:syntax && npm run check:imports && npm run check:style` 通过
- [x] `node scripts/visual-parity.mjs --check` exit 0（逐帧像素哈希与基线一致）
- [x] `node scripts/structure-budget.mjs --check` exit 0，且 `refactor-render-skill-enemy.json` 已删除
- [x] `npm run perf:budget` 通过

## DoD

- [x] 纯移动优先：每步只移动代码，不顺手改行为；发现的问题写进 Notes、另立任务
- [x] 测试 import 路径同步更新，未新增死导出（`node scripts/dead-exports.mjs` 无新增）
- [x] 拆分边界与 `docs/PHASE_REFACTOR.md` §4/§6 一致

## Touches

- `public/js/render/skill-renderer.js`
- `public/js/render/skill-data.js` (new)
- `public/js/render/skill-warnings.js` (new)
- `public/js/render/skill-draw.js` (new)
- `public/js/render/skill-particles.js` (new)
- `public/js/render/enemy-renderer.js`
- `public/js/render/enemy-data.js` (new)
- `public/js/render/enemy-feedback.js` (new)
- `public/js/render/enemy-boss.js` (new)
- `public/js/render/enemy-body.js` (new)
- `scripts/structure-budget.allow.d/refactor-render-skill-enemy.json`
- `scripts/test-changed.mjs`
- `tests/render-visuals.test.mjs`
- `tests/render-animations.test.mjs`
- `tests/skin-budget.test.mjs`
- `tests/hitstop.test.mjs`
- `tests/skill-visuals.test.mjs`
- `tests/skill-style.test.mjs`
- `tests/render-budget.test.mjs`
- `tasks/refactor-render-skill-enemy.md`

## Notes

2026-10-28 实施记录（分支 `task/refactor-render-skill-enemy`）：

- 拆分边界（§4 依赖方向 data → primitives → entity → orchestrator）：
  - 技能：`skill-data.js`（画质档 / 预警规格 / 演出时长 / 分类正则 / 颜色工具，零 import 纯数据）→
    `skill-warnings.js`（预警配置 + 地面标记绘制）、`skill-draw.js`（L0–L3 绘制）、`skill-particles.js`（粒子池）
    → `skill-renderer.js`（时间同步 / 状态 / 纹理预烘焙 + 四层编排）。
  - 敌人：`enemy-data.js`（动画预算 / 行走幅度 / 描边预算 / 高光几何，零 import 纯数据）→
    `enemy-feedback.js`（闪白与高光纯函数）、`enemy-boss.js`（首领地面层）、`enemy-body.js`（形体绘制）
    → `enemy-renderer.js`（遍历编排）。
- 相对 §6 的增量（§6 未枚举，属于 §4 的「绘制原语 / 单实体绘制」层）：`skill-particles.js`、`enemy-boss.js`、`enemy-body.js`。
  单列这三者才能让编排类与各绘制模块都 ≤600 行；绘制方法以「方法集合挂回同一原型」组织，与 `public/js/ui/` 既有惯例一致
  （对外仍是同一个实例、同一套方法签名）。
- 纯移动验证：脚本比对拆分前后 49 个技能方法 + 4 个敌人方法的函数体，逐字节一致；导出名与签名不变，未加兼容重导出壳。
- 行数：skill-renderer 534 / skill-draw 506 / skill-particles 208 / skill-warnings 128 / skill-data 71；
  enemy-body 546 / enemy-renderer 248 / enemy-boss 152 / enemy-data 109 / enemy-feedback 58。
- 测试：7 个测试文件 import 路径同步；源码级契约（无 sim 依赖、无滤镜、逐帧零分配、无素材/写回）改为覆盖同组模块的合并源串。
- `scripts/test-changed.mjs` 登记 8 个新源文件（审计覆盖门禁要求，否则 `tests/test-changed.test.mjs` 判红）。
- 环境注记：`visual-parity --check` 需 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`——en-US 下字体回退会让所有文字帧漂移（与本次改动无关）。
- 见证读数：`npm test` 1727/1727 全绿；`check:syntax` / `check:imports`（193 文件 526 依赖，无越层无环）/ `check:style` 通过；
  `structure-budget --check` OK（441 源文件，债务 14 条，本任务条目已删）；`visual-parity --check` OK（182 帧：178 逐像素一致 + 4 容差内变体）；
  `perf:budget` PASS（skills-1x-high 渲染耗时 4.710→1.991ms）。
