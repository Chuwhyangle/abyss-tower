---
id: gap-feel-review-rereview
title: 打击感复评：重合成对照证据 + 全新上下文复评 + 落记录
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/feel-review.mjs --check
depends_on:
  - gap-feel-capture-scenarios
  - gap-feel-floater-contrast
  - gap-feel-hit-silhouette
  - gap-feel-sim-diff-evidence
goal_ac: AC-020
---
## Proposal

承接 FEEL-001（2026-10-28，全新上下文评审判不通过 4/10）。前四个叶子任务分别补齐证据采集能力、飘字对比度、命中剪影、模拟一致性证据；本任务负责把这些证据组织成一次完整的、可被人直接查看的评审材料，交给**新的**全新上下文评审者复评，并原样落记录。

⛔ 不得复用评审者 `ac6c9e7b5c403f466`；不得为了让 AC-020 通过而修改评审结论。

## Plan

1. 用 `gap-feel-capture-scenarios` 落地的采集器，产出评审 E.1–E.9 要求的全部证据：8 武器帧序列、暴击/击杀/首领/破盾触发帧、飘字三档、漏怪/清波/首领死亡、reduced-motion 开关、自动档/low/high 画质、桌面与移动两视口。
2. 重新合成 before/after 对照图（左 before / 右 after，标注两侧 commit、日期、seed、画质），确认两半像素不同。
3. 检查采集 manifest 的时间断言全部成立（同 t 对照），移动端不得再有漂移。
4. 启动**新的**全新上下文评审者：只给证据图/序列 + GOAL-005 退出条件 + 逐项问题清单；禁止读取仓库；看不到实现过程与预期结论。
5. 原样转写评审结论到 `docs/FEEL_REVIEW.md`：通过则落记录；不通过则保持不通过并立案（不靠改记录通过）。
6. 通过后把记录任务收口，AC-020 的见证 `node scripts/feel-review.mjs --check` 必须 exit 0。

## AC

- [ ] 证据集覆盖 E.1–E.9 全部条目，路径与命令写入 `docs/FEEL_REVIEW.md` 的「评审过程」
- [ ] 新评审者（非 `ac6c9e7b5c403f466`）的 agent 标识与隔离方式写入记录
- [ ] `docs/reviews/feel-review-before-after.png` 存在且两侧像素不同，覆盖桌面与移动视口
- [ ] `node scripts/feel-review.mjs --check` exit 0
- [ ] `node --test tests/feel-review-record.test.mjs` 全绿
- [ ] `node scripts/visual-check.mjs --suite feel` PASS

## DoD

- [ ] 评审结论确实来自全新上下文，逐项扣分理由原样保留
- [ ] 若复评仍不通过：记录保持不通过，并新立案整改任务，id 写进记录
- [ ] `npm test` 全绿
- [ ] AC-020 在复评通过后成立，GOAL-005 的语义退出条件可被见证

## Touches

- `docs/FEEL_REVIEW.md`
- `docs/reviews/feel-review-before-after.png` (new)
- `docs/reviews/feel-after/contact-sheet.png` (new)
- `docs/reviews/feel-after/manifest.json` (new)
- `tests/feel-review-record.test.mjs` (new)
- `tasks/gap-feel-review-rereview.md`

## Notes

依赖 `gap-feel-capture-scenarios`、`gap-feel-floater-contrast`、`gap-feel-hit-silhouette`、`gap-feel-sim-diff-evidence` 全部 done 后才能开始——四者任一未落地，证据集都不完整，复评没有意义。
