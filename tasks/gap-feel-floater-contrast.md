---
id: gap-feel-floater-contrast
title: 修复伤害飘字对比度回归（混战可读性）
status: done
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

- [x] 新测试量出 combat-mixed 帧伤害数字区域对比度 ≥ 基线（测试输出基线与当前数值）
- [x] `node --test tests/floaters.test.mjs` 全绿
- [x] `node scripts/visual-check.mjs --suite feel` PASS（反馈覆盖、飘字覆盖、特效预算不回归）
- [x] 三档飘字（全部/仅关键/关闭）可见集合与合并行为不变（测试断言）

## DoD

- [x] `npm test` 全绿
- [x] 飘字在混战帧可读，且不靠字号膨胀或刷屏实现
- [x] 变更不影响模拟与 RNG（`node scripts/visual-check.mjs --suite feel` 与确定性测试见证）

## Touches

- `public/js/render/floater-renderer.js`
- `public/js/shared/floaters.js`
- `tests/floaters.test.mjs`
- `tasks/gap-feel-floater-contrast.md`

## Notes

评审记录 FEEL-001 的原始观察见 `docs/FEEL_REVIEW.md`（分支 `task/gap-feel-review-record`）。这是可见回归，不是风格偏好：修复后由复评任务重新采集确认。

### 2026-10-28 设计增量（实现任务不改阶段总文档，增量为本文正本；待文档 lane 收口到 `docs/PHASE_FEEL_ART.md` §3.2）

- **淡出下限** `FLOATER_FADE_FLOOR = 0.6`，`floaterAlpha(floater) = 0.6 + 0.4 × ttl/maxTtl`。伤害数字寿命只有 0.65s，旧行为尾段可掉到 0.2 不透明度 —— 混战帧里就是「近白变灰」。下限只作用于**绘制不透明度**：ttl 衰减、可见集合、帧预算、合并半径/窗口全部不变。
- **描边（casing）** `FLOATER_CASING = rgba(0, 0, 0, 0.85) / 3px`（原 0.75）：黑描边作为「数字区域」的紧邻对照面，与数字同受 globalAlpha 影响。
- **damage 层字重 600 → 700**：分层改造（2303dc2）把旧 700 降到 600，13px 数字笔画被抗锯齿摊薄；回到 700 是**恢复**而非字号膨胀（字号仍 13px、预算仍 28/12/0）。
- 颜色、字号、三档语义、合并参数（0.3 格 / 0.12s / 聚类 0.22 / 错位 0.16）一律未动；阶段文档 §3.2 表格里的 damage 字重 600 需文档 lane 同步为 700。

### 度量口径与数值（`node --test tests/floaters.test.mjs` 会打印）

- 伤害数字区域对比度 = 数字核心（层色）与紧邻描边在**同一 globalAlpha 合成后**的 WCAG 对比度；背景取 Canyon 战斗地表调色板两档（`grass1` / `pathInner`），取较差值。基线由同一函数以修复前样式算出，并与记录值 2.30 比对以防口径漂移。
- 基线（修复前样式 #eef3f8 / rgba(0,0,0,0.75) / 无下限 @ 不透明度 0.25）= **2.30**。
- 当前（下限 0.6 + 描边 0.85）逐档采样：1.00 → 17.92 / 0.90 → 14.66 / 0.80 → 11.79 / 0.70 → 9.28 / 0.60 → **7.11**；测试断言最差值 ≥ 基线且 ≥ WCAG 常规文本 4.5:1。

### 真实混战帧见证（固定 seed 采集，非单测路径）

`node tests/visual-scenes.mjs --scene combat --quality high --out <dir>` 的 `combat-desktop-combat-mixed-high.png`，同一「20」数字框内实测（luma / contrastRatio）：

- before：数字核心均值 L=79（灰），与局部背景对比度 **1.93**，最亮像素 L=93
- after：数字核心均值 L=143（近白），对比度 **5.06**，最亮像素 L=171

### 验证

- `node --test tests/floaters.test.mjs`：21/21 全绿（新增 4 例：对比度、淡出下限、渲染层 stub 实测、三档/合并冻结）。
- `node scripts/visual-check.mjs --suite feel`：PASS（反馈覆盖 0.0027、特效覆盖 0.0007、飘字覆盖 0.0004→0.0006、敌人 ΔE 19.6、特效预算 7）。
- `npm test`：1668/1668 全绿（合并 develop 后）。
- `node scripts/coverage.mjs --check-changed develop`：两个实现文件行覆盖 100%；`anti-drift-touches-check` 通过。
