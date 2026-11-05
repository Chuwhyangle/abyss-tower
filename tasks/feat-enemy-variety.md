---
id: feat-enemy-variety
title: 敌人节奏扩充：后期专属敌人 + 首领变体
status: ready
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

- [ ] 新增 2~3 种后期敌人（minWave≥15），有独特机制，进波次池
- [ ] 敌人总数 ≥14 保持；新敌人行为有区分度
- [ ] 确定性保持：波次生成 seed 派生，不改 sim.js RNG 顺序
- [ ] `npm test` 全绿；`node --test tests/enemies-depth.test.mjs` 等敌人测试不回归

## DoD

- [ ] 落地于 `enemies.js` + `enemy-system.js` + `enemy-renderer.js`（+波次池），零第三方依赖
- [ ] 程序化形状，走 sprite-coverage 登记（若新增图元）
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/enemies.js`
- `public/js/sim/enemy-system.js`
- `public/js/render/enemy-renderer.js`
- `public/js/shared/waves.js`
- `tests/enemies-depth.test.mjs`
- `scripts/test-changed.mjs`
- `tasks/feat-enemy-variety.md`

## Notes

立案 2026-11-06，源自 P1-11「敌人节奏：14 种敌人波 14 前全登场，加后期专属敌人+首领变体」。⚠️ 新增源文件/测试文件须登记 `scripts/test-changed.mjs` 的 TEST_MAP。数值改动需 balance 复测。