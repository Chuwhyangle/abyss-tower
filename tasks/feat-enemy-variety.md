---
id: feat-enemy-variety
title: 敌人节奏扩充：后期专属敌人 + 首领变体
status: done
labels:
  - feat
  - gameplay
parent: null
children: []
extra: {}
---
## Proposal

敌人节奏扩充（P1-11）。现状：14 种敌人波 14 前全登场，后期（15~30 波）无专属新敌人。补后期专属敌人 + 首领变体：

- 新增 2~3 种后期专属敌人（`minWave` ≥ 15），机制贴合后期（如高护甲精英、加速突袭、群体治疗精英），复用现有 `enemies.js` 数据 + `enemy-system.js` 行为 + `enemy-renderer.js` 程序化形状。
- 首领变体：现有 3 首领变体复用为后期波次不同形态（词缀强化变体），不新增首领骨架。
- 数值按现有 minWave/护甲/速度口径，进对应波次池（对齐 6 章节主题）。

## AC

- [x] 新增 2~3 种后期敌人（minWave≥15），有独特机制，进波次池
- [x] 敌人总数 ≥14 保持；新敌人行为有区分度
- [x] 确定性保持：波次生成 seed 派生，不改 sim.js RNG 顺序
- [x] `npm test` 全绿；`node --test tests/enemies-depth.test.mjs` 等敌人测试不回归

## DoD

- [x] 落地于 `enemies.js` + `enemy-system.js` + `enemy-renderer.js`（+波次池），零第三方依赖
- [x] 程序化形状，走 sprite-coverage 登记（若新增图元）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/data/enemies.js`
- `public/js/shared/waves.js`
- `public/js/sim/enemy-system.js`
- `public/js/sim/combat-system.js`
- `public/js/render/art-tokens.js`
- `public/js/shared/i18n/zh-CN.enemies.js`
- `public/js/shared/i18n/en-US.enemies.js`
- `tests/enemies-depth.test.mjs`
- `tests/data-split.test.mjs`
- `tests/sprite-coverage.test.mjs`
- `tests/nodes.test.mjs`
- `public/assets/sprites/entities/entity-atlas@1x.png`
- `public/assets/sprites/entities/entity-atlas@2x.png`
- `public/assets/sprites/entities/entity-atlas.json`
- `public/assets/sprites/manifest.json`
- `docs/reviews/entity-sprite-coverage-contact-sheet.png`
- `docs/reviews/entity-sprite-states-contact-sheet.png`
- `tasks/feat-enemy-variety.md`

## Notes

立案 2026-11-06，源自 P1-11。实现：新增 3 种后期专属敌人，全部 `minWave ≥ 15` 进波次池——`obsidian`（黑曜魔像，w15，单次伤害上限 12 封顶，压制暴击/狙击）、`regenerator`（再生者，w19，周期性自愈自身、不奶友军）、`warden`（守望者，w24，光环内友军护盾封顶）。首领变体沿用既有 3 变体轮换（feat-tower-elite-nodes 已落），未新增骨架。确定性：新机制走时间/状态惰性计时器（`regenTimer`/`guardTimer`，首帧 `=0` 延迟首触发），零新增 RNG，不改 sim.js RNG 顺序。形状复用 golem/priest/shield 图元，enemy-renderer.js 数据驱动无需逐敌注册，sprite-coverage 自动登记并重生成图集/manifest/contact-sheet。敌人总数 14→24。黑曜魔像色 `#7f96a6`（亮灰蓝），敌人/地形最小对比度 ≥3.0（grunt 仍为全群系最差 3.80）。`npm test` 2037 例全绿。

## Blocker

**2026-11-05T18:58:36.435Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'main' — 'develop' (2e69148c) is NOT a continuation of the project's default branch 'main' (4242e1b4) — it is 2 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task feat-enemy-variety's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'main'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：c5925073-1f31-4737-bd3e-5ddfb1adeb18
