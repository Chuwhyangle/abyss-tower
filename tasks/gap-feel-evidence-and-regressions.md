---
id: gap-feel-evidence-and-regressions
title: 打击感评审整改：补齐事件触发证据 + 修复飘字对比度与命中剪影
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/feel-review.mjs --check
goal_ac: AC-020
---
## Proposal

AC-020 的首次语义评审（2026-10-28，全新上下文 subagent `ac6c9e7b5c403f466`）判**不通过 4/10**，记录见 `docs/FEEL_REVIEW.md`（分支 `task/gap-feel-review-record`）。失败分两类：

1. **证据覆盖不足**：交付的 6 张静态对照图只覆盖 combat 的桌面三帧与一张放大裁切，无法验收 GOAL-005 的多数退出条件——八种武器区分、暴击/击杀/首领命中/破盾的独立反馈层、飘字「全部/仅关键/关闭」三档、漏怪/清波/首领死亡演出、reduced-motion 非运动反馈、默认自动档与低画质完整性。评审者对上述各项只能写「静态图不可判 / 无证据」。
2. **两条可见回归**：伤害飘字在 contact/mixed 帧对比度下降（近白→偏灰，混战中更难读）；命中锐利星芒被整身刷白取代，敌人剪影被糊掉，锐利切分感与命中轮廓可读性下降。

另有两条证据质量缺陷需一并修：移动端 after 采集的模拟时间漂移（combat-impact 采到 t=12s 而非 8s、combat-mixed 采到 t=8s 而非 4.5s），移动帧不可作对照；评审只纳入 6 张中的 4 张（图 4 移动、图 6 全景未纳入）。

评审者已经明确指出：飘字 30/30 → 68 由 after 的飘字合并层（`public/js/shared/floaters.js:119` `mergeFloaterText` 求和）解释，桌面 t=8s 快照敌人数量一致，但**仍需伤害事件日志 + RNG 序列 diff 定论**（评审 E.8）。

## Plan

1. 扩展确定性采集：给 `tests/visual-scenes.mjs` 增加按事件触发取帧的能力（命中/暴击/击杀/首领命中/破盾/漏怪/清波/首领死亡），并在同一 seed 下产出 8 种武器各自开火的帧序列。
2. 采集三档飘字（全部/仅关键/关闭）、reduced-motion 开关、默认自动档与 low 画质、桌面与移动两视口的同 t 帧。
3. 修复 after 采集的时间漂移：采集器必须等到目标模拟时间再取帧，并在 manifest 里断言 `time` 与请求一致；不一致即失败，不产出可被当成对照的帧。
4. 修飘字对比度：混战帧伤害数字恢复到不低于基线的对比度（用 `scripts/visual-check.mjs` 的对比度/ΔE 指标做机械见证）。
5. 修命中辨识：恢复可辨识的锐利命中层（星芒/边缘切分），受击刷白不得吃掉敌人剪影。
6. 产出伤害事件日志与 RNG 调用序列 diff，证明同一 seed 在 before/after 间逐字节一致，或给出真实分叉并立案。
7. 重新合成 before/after 对照图，按 `docs/FEEL_REVIEW.md` 的格式重写评审条目，交给全新上下文评审者复评。

## AC

- [ ] 采集器在 manifest 中断言每帧 `time` 与请求一致：`node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/feel-time-check` 后，`manifest.json` 中三帧 `snapshot.time` 分别等于 8 / 4.5 / 2（移动视口同样成立）
- [ ] 存在 8 种武器各自开火的同 seed 帧序列，且每两种武器至少一条可区分证据（帧或帧序列）
- [ ] 存在暴击、击杀、首领命中、破盾各自的事件触发帧序列
- [ ] 存在漏怪、清波、首领死亡各自的事件触发帧序列或录制视频
- [ ] 存在「全部/仅关键/关闭」三档同 seed 同 t 的同帧截图
- [ ] 存在 reduced-motion 开/关的同一事件帧对比，证明非运动反馈保留
- [ ] 存在首次进入自动档（桌面/移动）与 low 画质的同 seed 帧，证明反馈链完整
- [ ] 混战帧伤害飘字对比度不低于基线（`node scripts/visual-check.mjs --suite feel` 的对比度指标见证）
- [ ] 命中帧的敌人剪影可辨识（剪影覆盖率/边缘指标不低于基线）
- [ ] 伤害事件日志与 RNG 序列 diff 落盘（`docs/reviews/feel-sim-diff.md` 或等价产物），证明同 seed 逐字节一致
- [ ] 新评审记录在 `docs/FEEL_REVIEW.md` 中通过，`node scripts/feel-review.mjs --check` exit 0

## DoD

- [ ] 全新上下文评审者复评通过，记录保留其 agent 标识、隔离方式与逐项评分
- [ ] before/after 对照图覆盖桌面与移动两视口，可被人直接打开看清两侧差异
- [ ] `node --test tests/feel-review-record.test.mjs` 与 `npm test` 全绿
- [ ] 所有新增/修改的采集能力有测试覆盖，且不消耗战斗 RNG

## Touches

- `docs/FEEL_REVIEW.md`
- `docs/reviews/feel-review-before-after.png`
- `docs/reviews/feel-after/contact-sheet.png`
- `docs/reviews/feel-after/manifest.json`
- `tests/visual-scenes.mjs`
- `tests/feel-review-record.test.mjs`
- `public/js/render/floater-renderer.js`
- `public/js/shared/floaters.js`
- `public/js/render/enemy-renderer.js`
- `public/js/render/effect-renderer.js`
- `tasks/gap-feel-evidence-and-regressions.md`

## Notes

立案依据是不通过记录 FEEL-001（4/10），原始评审输出见 `docs/FEEL_REVIEW.md` 的「评审记录」与「执行者核对」。⛔ 不得为了让 AC-020 通过而修改评审记录里的结论。整改完成后必须由**新的**全新上下文评审者复评，不能复用本次评审者。
