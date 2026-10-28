---
id: gap-feel-floater-contrast
title: 修复伤害飘字对比度回归（混战可读性）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/floaters.test.mjs
goal_ac: AC-020
---
## Proposal

FEEL-001 的阻塞项 1：after 的 contact/mixed 帧里伤害飘字「20」由近白变灰，混战中更难读。飘字分层与合并由 `public/js/shared/floaters.js` 裁决、由 `public/js/render/floater-renderer.js` 绘制；当前颜色/阴影在合并与降饱和后对比度不足。

本任务只修飘字可读性，不改三档语义（全部/仅关键/关闭）、不改合并半径与时间窗、不改伤害数值。

## Plan

1. 用 `scripts/lib/visual-metrics.mjs` 的对比度/ΔE 工具，在固定 seed 的 combat-mixed 帧上量出伤害数字区域与背景的对比度，记录基线与当前值。
2. 调整 `floater-renderer.js` 的绘制（颜色、描边、阴影、字重），必要时在 `shared/floaters.js` 的分层颜色表里提高普通伤害层的亮度/边缘分离。
3. 保持三档过滤与合并行为不变：`floaters-all/key/off` 的可见集合只由既有逻辑决定。
4. 加测试：对比度不低于基线；三档语义与合并行为不回归。

## AC

- [ ] 新测试量出 combat-mixed 帧伤害数字区域对比度 ≥ 基线（测试输出基线与当前数值）
- [ ] `node --test tests/floaters.test.mjs` 全绿
- [ ] `node scripts/visual-check.mjs --suite feel` PASS（反馈覆盖、飘字覆盖、特效预算不回归）
- [ ] 三档飘字（全部/仅关键/关闭）可见集合与合并行为不变（测试断言）

## DoD

- [ ] `npm test` 全绿
- [ ] 飘字在混战帧可读，且不靠字号膨胀或刷屏实现
- [ ] 变更不影响模拟与 RNG（`node scripts/visual-check.mjs --suite feel` 与确定性测试见证）

## Touches

- `public/js/render/floater-renderer.js`
- `public/js/shared/floaters.js`
- `tests/floaters.test.mjs`
- `tasks/gap-feel-floater-contrast.md`

## Notes

评审记录 FEEL-001 的原始观察见 `docs/FEEL_REVIEW.md`（分支 `task/gap-feel-review-record`）。这是可见回归，不是风格偏好：修复后由复评任务重新采集确认。
