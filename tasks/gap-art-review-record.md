---
id: gap-art-review-record
title: 美术语义评审记录：四场景 × 两视口真实采集 + 全新上下文评审结论（AC-029）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/art-review.mjs --check
depends_on:
  - VIS-001
  - ART-001
  - gap-ui-readability-font-floor
  - gap-mobile-visual-font-floor
goal_ac: AC-029
---
## Proposal

GOAL-006 退出条件要求「四场景 × 两视口的语义评审结论写入 `docs/ART_REVIEW.md`」，AC-029 以 `node scripts/art-review.mjs --check`（expect exit 0）见证。检查器、`docs/ART_REVIEW.md` 骨架与确定性采集基建已由 VIS-001 落地，但记录区仍是空壳。main 上实测（2026-10-27）：

```
$ node scripts/art-review.mjs --check
美术评审 · docs/ART_REVIEW.md

覆盖场景：—
覆盖视口：—

问题：
  - 缺少评审条目（需要至少一条 `### 标题` + 场景 / 日期 / 评审者 / 结论 / 分数 的记录）
  - 评审记录未覆盖场景：title / map / combat / result
  - 评审记录未覆盖视口：desktop / mobile

结论：未通过
exit=1
```

所以 AC-029 今天不是「能力缺失」，而是一次真实失败读数：被检查的记录不存在。缺的不是检查器（`scripts/art-review.mjs` 与 `scripts/lib/review-record.mjs` 已在位，且会拒绝缺字段 / 结论非「通过」的坏记录），也不是采集器（`tests/visual-scenes.mjs --scene all` 已能产出 title/map/combat/result × desktop/mobile 的真实截图），而是**真实的评审本身**：有人真的看过四场景两视口的画面，并把结论与依据写下来。

本任务只做这一件事：对真实采集图做一次全新上下文的语义评审，把结论原样写入记录，让 AC-029 成为可自证的证据。它不改检查器、不改采集阈值、不改任何产品渲染代码。

<!-- dedup-ref -->
机制分工：检查器与采集基建归 VIS-001（done；它故意在缺记录时 exit 1，并明确「语义评审待 ART-001 完成后由全新上下文评审填写」），美术方向与令牌归 ART-001（AC-021），机械层（背景与氛围、UI 可读性、移动视口）分别归 AC-024 / AC-025 / AC-027 对应的任务，本任务与它们正交：任何机械套件通过都不蕴含有人看过四张场景图并给出结论。同族但不同机制的 gap-feel-review-record（AC-020，`docs/FEEL_REVIEW.md`，打击感语义层）与本任务共享 `scripts/lib/review-record.mjs` 的格式与「全新上下文评审」方法，但评审对象、记录文件与 AC 完全不同，判定 separate、不合并。`docs/ART_REVIEW.md` 的 Touches 与 gap-background-atmosphere-gate 无重叠（后者明确只做机械层、不产出评审结论）。

## Plan

1. **起点读数**：在 worktree 内跑 `node scripts/art-review.mjs --check`，确认 exit 1（缺记录），把命令与输出原样记入记录的「评审过程」节，作为「记录起初不存在」的证据。
2. **真实采集 after**：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/visual-scenes.mjs --scene all --quality high --out /tmp/art-after`。确认 manifest 覆盖 title / map / combat / result 与 desktop 视口，且 title/map 有 mobile（390×844 竖屏）、combat/result 有 mobile-landscape（844×390 横屏）——这是本仓库 `SCENE_VIEWPORTS` 的既有定义，不要为凑评审改采集器。
3. **入库对照图**：把 `/tmp/art-after/contact-sheet.png` 与 `manifest.json` 复制到 `docs/reviews/art-after/`（完整逐场景帧留在 /tmp，路径写进记录）；before 侧引用 VIS-001 已入库的 `docs/reviews/baseline-contact-sheet.png`，构成同 seed 的前后对照。
4. **全新上下文评审**：启动一个独立 subagent 作为评审者，只给它 before/after contact sheet（必要时给单场景帧）、GOAL-006 的视觉退出条件原文、`docs/ART_DIRECTION.md` 的风格支柱与 `docs/ART_REVIEW.md` 里的评审问题清单；**不给**本任务的实现过程、预期结论或任何「应当通过」的暗示。记录其 agent 标识与上下文隔离方式；执行者只原样转写它的逐项观察、扣分理由、结论与 0–10 分数，不得改写。
5. **写记录**：把 `docs/ART_REVIEW.md` 的「## 评审记录」空壳说明替换为真实条目——至少四条（title / map / combat / result 各一条），每条 `视口：desktop、mobile` 且分别写两视口观察；必填字段齐全：`场景`、`视口`、`日期`（YYYY-MM-DD）、`评审者`、`结论`、`分数`（n/10）。另在「## 评审过程」写采集命令、两侧 commit、日期、评审者身份与隔离方式、起点失败读数。⚠️ 解析器把评审区内任何 `### ` 标题都当作条目，因此该区不得出现非条目的三级标题；格式模板必须留在围栏代码块内。
6. **诚实收口**：若评审者判定某场景不通过，保持「未通过」并立案修复（新 gap 任务，id 写进记录），不得为关 AC 改写结论；只有真实整改并复评通过后，记录才可写成「通过」。
7. **回归护栏**：新增 `tests/art-review-record.test.mjs`，用 `scripts/lib/review-record.mjs` 与 `checkArtReview` 解析真实记录，断言 `ok:true`、覆盖四场景与两视口、每条 `reviewer` 非空且 `score` 为 n/10；断言记录引用的 PNG 存在且 >1KB；反向断言——临时副本删掉条目、或把结论改成「未通过」时 `checkArtReview` 返回 `ok:false`，证明检查不是空转。
8. **自检**：`node scripts/art-review.mjs --check` exit 0、`node --test tests/art-review-record.test.mjs`、`npm test` 全绿；`git status` 只含本任务 Touches 内文件。本任务不新增 `scripts/` 源文件；若最终确需新增，必须同步 `scripts/test-changed.mjs` 的 `TEST_MAP` 并把它加进 Touches。

## AC

- [ ] `node scripts/art-review.mjs --check` exit 0
- [ ] `node scripts/art-review.mjs --check --json` 的 `coverage.missingScenes` 与 `coverage.missingViewports` 均为 `[]`，且至少四条条目的 `verdict` 为 `pass`、`reviewer` 非空、`score` 形如 `n/10`
- [ ] `node --test tests/art-review-record.test.mjs` exit 0，且含「删条目 / 改结论为未通过后检查失败」的反向用例
- [ ] `test -s docs/reviews/art-after/contact-sheet.png && test -s docs/reviews/art-after/manifest.json && test -s docs/reviews/baseline-contact-sheet.png` exit 0
- [ ] `grep -qE '^## 评审过程' docs/ART_REVIEW.md` exit 0，且该节写明采集命令、两侧 commit、日期、评审者与上下文隔离方式
- [ ] `npm test` exit 0

## DoD

- [ ] 真实跑过一次 `--scene all --quality high` 采集；before（baseline）与 after（art-after）两张 contact sheet 能被人直接打开并看清四场景两视口，不是占位图，也不是同一张图复制两次
- [ ] 评审结论确实来自全新上下文：记录保留评审者 agent 标识 / 隔离方式与逐项扣分理由，执行者未改写结论
- [ ] 记录对 GOAL-006 的视觉退出条件逐场景给出可见判断；未达标项写明归属任务并已立案
- [ ] 没有为了关 AC 把不通过写成通过：`docs/ART_REVIEW.md` 的结论与评审者原始输出一致，原始输出摘要存入本任务 Notes
- [ ] `docs/ART_REVIEW.md` 的「待评审（…）」占位文字已删除，评审记录区不再是空壳
- [ ] 产品代码零改动：本任务 diff 不含 `public/`、`scripts/art-review.mjs`、`scripts/lib/review-record.mjs`

## Touches

- `docs/ART_REVIEW.md`
- `docs/reviews/art-after/contact-sheet.png` (new)
- `docs/reviews/art-after/manifest.json` (new)
- `tests/art-review-record.test.mjs` (new)
- `tasks/gap-art-review-record.md`

## Notes

评审记录是语义层证据，不能替代 `scripts/visual-check.mjs --suite art|ui|mobile` 的机械指标；两者同时成立才支撑 GOAL-006。记录必须诚实：如果画面仍不达标，宁可把结论写成不通过并立案修复，也不要为了关 AC 写通过——那会让 AC-029 重新退化成一条无法自证的证据。格式与判定以 VIS-001 落地的 `scripts/lib/review-record.mjs` 为准，不另发明格式。
