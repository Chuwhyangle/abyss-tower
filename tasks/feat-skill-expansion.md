---
id: feat-skill-expansion
title: 技能扩展：3 技能 → 5-6 技能（或每局变异分支）
status: ready
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

- [ ] 技能总数 ≥5（新增 2+ 个，各有独特机制）
- [ ] 确定性保持：技能 seed 派生，不改 sim.js RNG 顺序
- [ ] `npm test` 全绿；技能测试覆盖新增技能
- [ ] balance 复测不漂移

## DoD

- [ ] 落地于 `skills.js` + `skill-system.js`（+i18n），零第三方依赖
- [ ] 不碰现有 3 技能数值（只新增）
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches；设计增量写 Notes

## Touches

- `public/js/shared/data/skills.js`
- `public/js/sim/skill-system.js`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tests/skills.test.mjs`
- `tests/sim-skills.test.mjs`
- `scripts/test-changed.mjs`
- `tasks/feat-skill-expansion.md`

## Notes

立案 2026-11-06，源自 P2-12「技能扩展：3 技能两胜全解锁，改 6+ 或每局变异分支」。⚠️ 改 skill-system 须守 sim 确定性；数值需 balance 复测。新增技能机制/数值需在实现中补 Notes。

## Blocker

**2026-11-05T21:26:09.869Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/7，剩余未勾 7）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：42c5dfab-c9b8-4839-8647-a1f573b24df2
