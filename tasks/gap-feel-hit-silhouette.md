---
id: gap-feel-hit-silhouette
title: 恢复命中锐利层且不糊掉敌人剪影
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/render-visuals.test.mjs tests/effect-variants.test.mjs
goal_ac: AC-020
---
## Proposal

FEEL-001 的观感回归：命中从「锐利白色六芒星火花 + 柔和粉晕」变成「整身刷白/去饱和」，闪白面积更大但敌人轮廓被糊掉，锐利切分感与剪影可读性下降（评审列为非阻塞，但直接削弱「重量感」）。相关绘制在 `public/js/render/enemy-renderer.js`（受击闪白）与 `public/js/render/effect-renderer.js`（命中特效/火花）。

本任务恢复可辨识的锐利命中层，同时保留 after 引入的方向性/命中事件消费，不改模拟数值。

## Plan

1. 用 `scripts/lib/visual-metrics.mjs` 的剪影覆盖率/边缘指标量出 before（`3b8e1fd`）与当前命中帧的数值，记录基线。
2. 调整受击表现：闪白不再整身覆盖剪影，改为轮廓/边缘优先的短时高光；恢复可辨识的锐利命中特效层（星芒或等价的锐利几何），颜色语言与现有武器特效一致。
3. 保持命中事件（`impact-events`）消费方式与 hitstop/震屏护栏不变，reduced-motion 下仍保留非运动反馈。
4. 加测试：剪影覆盖率与锐利边缘指标不低于基线；reduced-motion 下命中仍可见。

## AC

- [ ] 新测试量出命中帧剪影覆盖率 ≥ 基线（输出基线与当前数值）
- [ ] 命中帧存在可测的锐利高频边缘层（边缘/高频指标 ≥ 基线）
- [ ] `node scripts/visual-check.mjs --suite feel` PASS（反馈覆盖、命中特效覆盖、ΔE、特效预算不回归）
- [ ] reduced-motion 下命中仍有非运动反馈（测试或固定帧见证）

## DoD

- [ ] `npm test` 全绿
- [ ] 命中反馈在静帧上锐利、可辨识，敌人剪影不被洗掉
- [ ] 不改变模拟结果与 RNG

## Touches

- `public/js/render/enemy-renderer.js`
- `public/js/render/effect-renderer.js`
- `tests/render-visuals.test.mjs`
- `tests/effect-variants.test.mjs`
- `tests/hitstop.test.mjs`
- `tasks/gap-feel-hit-silhouette.md`

## Notes

与飘字对比度任务（`gap-feel-floater-contrast`）文件不相交，可并行。评审原始观察见 `docs/FEEL_REVIEW.md`（分支 `task/gap-feel-review-record`）。
