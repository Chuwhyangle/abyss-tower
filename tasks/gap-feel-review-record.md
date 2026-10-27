---
id: gap-feel-review-record
title: 打击感语义评审记录：前后对照 contact sheet + 全新上下文评审结论
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/feel-review.mjs --check
depends_on:
  - VIS-001
  - gap-auto-quality-default
  - gap-impact-events
  - gap-hitstop-camera-feedback
  - gap-audio-impacts
  - gap-weapon-impact-vfx
  - gap-floaters-layering
  - gap-culmination-shows
goal_ac: AC-020
---
## Proposal

GOAL-005 退出条件要求「至少一组前后对照 contact sheet 与全新上下文的语义评审结论写入 `docs/FEEL_REVIEW.md`」，AC-020 以 `node scripts/feel-review.mjs --check` 见证。当前该 criterion 的证据是 `criterion-capability-unevaluable`：`scripts/feel-review.mjs` 与 `docs/FEEL_REVIEW.md` 在 main 上都不存在，命令无法被当成一次读数，AC 自然无从判定。

<!-- dedup-ref -->
机制分工：检查器本体（`scripts/feel-review.mjs`、`scripts/lib/review-record.mjs`）、确定性采集（`tests/visual-scenes.mjs`、`scripts/visual-check.mjs`）与 before 基线（`docs/reviews/baseline-contact-sheet.png`）由 VIS-001 落地，且 VIS-001 故意在缺少评审记录时 exit 1、不写空壳记录；本任务只负责产生被检查的真实记录与前后对照图，与 VIS-001、AC-011..AC-017 对应的战斗反馈任务分离（独立验收：VIS-001 验「检查器会拒绝坏记录」，本任务验「真实记录能通过」）。

评审记录要回答的不是「测试绿了」，而是「人看着有没有重量」：命中是否可辨识、八种武器是否可区分、暴击/破盾/击杀/首领命中是否有独立层、飘字是否分层且不刷屏、漏怪/清波/首领死亡是否各有演出、reduced-motion 下是否仍有非运动反馈。这些只有拿同一确定性场景的前后对照图、交给不知道实现细节的全新上下文评审者，才能避免「实现者自评通过」。本任务产物是记录与图，不改任何表现代码。

## Plan

1. 起点：VIS-001 与 AC-011..AC-017 对应的战斗反馈任务已在 develop 落地（`depends_on` 已声明）。先在 worktree 内跑一次 `node scripts/feel-review.mjs --check`，确认它因缺记录而 exit 1，把这条失败读数原样写进记录的评审过程，作为「记录一开始不存在」的证据。
2. 采集 after：`node tests/visual-scenes.mjs --scene combat --quality high --out docs/reviews/feel-after`，并补一次 390×844 移动视口；保留 `contact-sheet.png` 与 `manifest.json`（seed / commit / 视口 / 画质 / 像素哈希）。
3. 生成并排对照：把 VIS-001 的 before 基线 `docs/reviews/baseline-contact-sheet.png` 与 after contact sheet 合成 `docs/reviews/feel-review-before-after.png`（左 before / 右 after，同场景同视口，标注两侧 commit 与日期），并确认两半像素不同（不是复制同一张图）。
4. 全新上下文评审：启动一个只拿到「before/after 对照图 + GOAL-005 退出条件 + 逐项评审问题清单」、拿不到本任务实现过程与预期结论的全新上下文评审者（独立 subagent，记录其 agent 标识与上下文隔离方式），由它独立给出逐项判断、结论与 0–10 分数。执行者原样转写其结论与扣分理由，不得改写结论、不得把不通过改成通过。
5. 写 `docs/FEEL_REVIEW.md`：
   - 前言：评审目的、方法（确定性场景 + 前后对照 + 全新上下文），以及「机械层由 `scripts/visual-check.mjs --suite feel` 独立负责，本记录只承担语义层」的边界。
   - `## 评审过程`：采集命令、两侧 commit、日期、视口、评审者身份与上下文隔离方式、以及第 1 步的失败读数。
   - 至少一条 `### ` 条目，字段齐全：`场景`（含 `combat`）、`视口`、`日期`（YYYY-MM-DD）、`评审者`、`结论`、`分数`（n/10）；正文写逐项观察、扣分理由，并内嵌 before/after 图引用。
   - 未达标项写明是阻塞还是非阻塞、归属哪个任务；若结论为不通过，保持不通过并立案修复项，不靠改记录通过。
6. 加 `tests/feel-review-record.test.mjs`：用 `scripts/lib/review-record.mjs` 解析真实记录，断言存在通过条目且覆盖 `combat`；断言记录引用的 before/after PNG 存在且非空（>1KB）；反向断言——在临时副本上删掉条目后 `checkFeelReview` 返回 `ok:false`，防止空壳记录空转通过。
7. 自检：`node scripts/feel-review.mjs --check` exit 0、`node --test tests/feel-review-record.test.mjs`、`npm test` 全绿。

## AC

- [ ] `node scripts/feel-review.mjs --check` exit 0
- [ ] `node --test tests/feel-review-record.test.mjs` 通过
- [ ] `node scripts/feel-review.mjs --check --json` 的 `entries` 中至少一条 `scene` 含 `combat`、`verdict` 为 `pass`、`reviewer` 非空、`score` 为 n/10
- [ ] `grep -qE "^## 评审过程" docs/FEEL_REVIEW.md` exit 0，且该节写明采集命令、两侧 commit、日期、评审者与上下文隔离方式
- [ ] `test -s docs/reviews/feel-review-before-after.png && test -s docs/reviews/feel-after/contact-sheet.png && test -s docs/reviews/feel-after/manifest.json` exit 0
- [ ] 反向断言：`node --test tests/feel-review-record.test.mjs` 内含「缺条目 / 缺图时检查失败」的断言，证明检查不是空转通过

## DoD

- [ ] 真实跑过 before 与 after 两次采集：`docs/reviews/feel-review-before-after.png` 可被人直接打开看清两侧差异，不是占位图，也不是同一张图复制两次
- [ ] 评审结论确实来自全新上下文：记录保留其 agent 标识/隔离方式与逐项扣分理由，执行者没有改写结论
- [ ] `docs/FEEL_REVIEW.md` 对 GOAL-005 的六条退出条件逐条给出可见 / 不可见判断，不可见项写清由哪个机制（机械测试或音频验收）覆盖
- [ ] 存在未达标项时已立案（新 gap 任务，id 写在记录里），没有为了关 AC 把不通过写成通过
- [ ] `npm test` 全绿，`node scripts/feel-review.mjs --check` 在 CI 上 exit 0

## Touches

- `docs/FEEL_REVIEW.md` (new)
- `docs/reviews/feel-review-before-after.png` (new)
- `docs/reviews/feel-after/contact-sheet.png` (new)
- `docs/reviews/feel-after/manifest.json` (new)
- `tests/feel-review-record.test.mjs` (new)
- `tasks/gap-feel-review-record.md`

## Notes

评审记录是语义层证据，不能替代 `scripts/visual-check.mjs --suite feel` 的机械指标；两者同时成立才支撑 AC-018/AC-020。记录必须诚实：如果 after 仍不够「有重量」，宁可把结论写成不通过并立案修复，也不要为了关 AC 而写通过——那会让 AC-020 重新退化成一条无法自证的证据。检查器与记录格式（`### 标题` + 场景/日期/评审者/结论/分数）以 VIS-001 落地的 `scripts/lib/review-record.mjs` 为准，本任务不另发明格式。