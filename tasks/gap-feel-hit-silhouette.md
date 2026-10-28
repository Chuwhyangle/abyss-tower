---
id: gap-feel-hit-silhouette
title: 恢复命中锐利层且不糊掉敌人剪影
status: done
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

- [x] 新测试量出命中帧剪影覆盖率 ≥ 基线（输出基线与当前数值）
- [x] 命中帧存在可测的锐利高频边缘层（边缘/高频指标 ≥ 基线）
- [x] `node scripts/visual-check.mjs --suite feel` PASS（反馈覆盖、命中特效覆盖、ΔE、特效预算不回归）
- [x] reduced-motion 下命中仍有非运动反馈（测试或固定帧见证）

## DoD

- [x] `npm test` 全绿
- [x] 命中反馈在静帧上锐利、可辨识，敌人剪影不被洗掉
- [x] 不改变模拟结果与 RNG

## Touches

- `public/js/render/enemy-renderer.js`
- `public/js/render/effect-renderer.js`
- `tests/render-visuals.test.mjs`
- `tests/effect-variants.test.mjs`
- `tests/hitstop.test.mjs`
- `tasks/gap-feel-hit-silhouette.md`

## Notes

与飘字对比度任务（`gap-feel-floater-contrast`）文件不相交，可并行。评审原始观察见 `docs/FEEL_REVIEW.md`（分支 `task/gap-feel-review-record`）。

### 实现增量（2026-10-28）

- 受击层（`enemy-renderer.js`）：删除整身白圆，改为 `drawHitHighlight` —— 外沿细环（1.22×，宽 1.4）+ 贴边亮环（1.08×，宽 3.6）+ 内侧细环（0.66×，宽 1）+ 极小接触核；**内部不刷色**。强度 `hitHighlightAlpha = hitFlashAlpha × variant.hitFlash.alpha`（full 0.95 / light 0.8 / off 关闭），窗口仍是 duration×decay = 0.08s。
- 命中层（`effect-renderer.js`）：新增 `SHARP_HIT_STAR` / `drawSharpHitStar`，武器命中在武器形态之上叠回六向白色星芒（射线取 weapon accent）；无 weapon 的旧火花走同一实现并沿用历史的档位线数缩放（`scaledCount`），既有「低配预算单调」契约不变。
- 命中事件消费、hitstop/震屏预算、模拟与 RNG 均未改（`camera-feedback.js`、`public/js/sim/**` 无改动）。

### 证据（2026-10-28，本 worktree 实测）

- 单元：`node --test tests/render-visuals.test.mjs tests/effect-variants.test.mjs tests/hitstop.test.mjs` → 31 pass / 0 fail。命中帧诊断：剪影覆盖率 基线 0.5494 → 当前 0.6795；锐利边缘密度 基线 0.1537 → 当前 0.2927；内部 ΔE 基线 38.95 → 当前 14.20。
- 端到端（combat 桌面指标帧，`LANG=zh_CN.UTF-8`）：`3b8e1fd` 合成帧剪影 0.5989 / 受击层剪影 0.5827 / 命中区边缘密度 0.2257 / 全画布 0.0346；当前 0.5953 / 0.5832 / 0.2443 / 0.0355。合成帧差 -0.0036 不是剪影被洗：受击层单独量 0.5832 ≥ 0.5827，差异来自恢复的白星芒落进 `silhouetteCoverage` 的 4px 背景采样环（把局部背景估亮）；命中区与全画布边缘密度都高于基线。
- `node scripts/visual-check.mjs --suite feel`：PASS —— 反馈覆盖 0.0024（阈值 0.002）、命中特效覆盖 0.0007（≥0.0003）、受击闪白 0.0014（≥0.0004）、飘字覆盖 0.0003、敌人与背景 ΔE 19.59（≥10）、特效预算 7（≤320）。
- `npm test`（合并 develop 后）：1664 pass / 0 fail。

### 边界

- 只改表现层，未改模拟、RNG 与事件契约；`tests/hitstop.test.mjs` 只补了一条「降级只关运动、受击高光仍开启」的护栏断言。
- 锐利度与剪影可读性由上述机械指标见证；审美结论仍由 `docs/FEEL_REVIEW.md` 的复评流程给出，本任务不代为判定「通过」。
