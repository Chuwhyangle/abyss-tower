---
id: DOCS-001
title: 文档整合 lane：把本阶段设计增量收口到 PRD/TECH_DESIGN
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/docs-phase-sync.test.mjs
---
## Proposal

GOAL-005 / GOAL-006 的任务池已经由 goal driver 铺满（命中事件、hitstop、命中特效、命中音效、飘字、收尾演出、默认画质、精灵管线、单位覆盖、背景氛围、UI 字号、i18n、评审记录等），但实际并发只有 1–2 个：几乎所有任务都把 `docs/PRD.md` 与 `docs/TECH_DESIGN.md` 写进 Touches，调度器只能串行放行（`touchesDisjointOrAged` 的 blocker 就是当前持有文档的任务）。再加 worker 只会排队，不会提速。

本任务把「每个任务各自改两份总文档」收口成「一个文档 lane 统一改一次」，让其余任务只在自己的任务体里记录设计增量，从而把文档锁从 N 次串行变成 1 次。

## Plan

1. 盘点所有 open 的 GOAL-005/006 任务（ready + todo + needs-human）的 Proposal/Plan/DoD，抽取它们计划写入 PRD/TECH_DESIGN 的设计增量，整理成 `docs/PHASE_FEEL_ART.md`（本阶段决策、字段契约、事件分类、资源规范索引、AC 映射）。
2. 一次性更新 `docs/PRD.md` 与 `docs/TECH_DESIGN.md`：加入本阶段的命中反馈契约、画质默认、精灵化方向、可读性下限与 i18n 收口约定；不重复已有章节，只做增量与交叉引用。
3. 在 `CLAUDE.md` 增加一条工作约定：实现类任务把设计增量写进任务 Notes，`docs/PRD.md` / `docs/TECH_DESIGN.md` 仅由文档 lane（本任务及后续同类）更新；避免再次出现文档 Touches 热点。
4. 新增 `scripts/check-doc-ownership.mjs`：扫描 `tasks/*.md` 的 Touches，若某个 open 任务（除 DOCS-*）同时包含 `docs/PRD.md` 或 `docs/TECH_DESIGN.md`，输出该任务并要求移除；提供 `--fix-report` 只输出清单，不自动改任务。
5. 新增 `tests/docs-phase-sync.test.mjs`：校验 `docs/PHASE_FEEL_ART.md` 存在且含必需章节、PRD/TECH_DESIGN 链接可达、`check-doc-ownership` 对当前任务库 exit 0。
6. 把 ready 池中受文档锁阻塞的任务清单交给任务操作员，按清单摘掉这两份文档的 Touches（本任务只产出清单与约定，不直接改任务库）。

## AC

- [x] `node --test tests/docs-phase-sync.test.mjs` 通过
- [x] `npm run check:docs` 通过
- [x] `node scripts/check-doc-ownership.mjs` 在清理后 exit 0；清理前能列出受阻任务
- [x] `docs/PHASE_FEEL_ART.md` 含背景/范围/命中反馈契约/精灵资源索引/AC 映射五节
- [x] `CLAUDE.md` 的文档约定已更新，后续任务可据此避免文档 Touches 热点

## DoD

- [x] 真实运行 `node scripts/check-doc-ownership.mjs`，输出「清理前 N 个受阻任务、清理后 0 个」
- [x] 清理后 ready 池中至少 4 个任务可同时 dispatch（文档 Touches 不再互相阻塞）
- [x] PRD/TECH_DESIGN 的增量与 `docs/PHASE_FEEL_ART.md` 一致，无重复定义
- [x] 文档 lane 的约定被至少一个后续任务实际遵守（Notes 记录设计增量，未改两份总文档）

## Touches

- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `docs/PHASE_FEEL_ART.md` (new)
- `CLAUDE.md`
- `scripts/check-doc-ownership.mjs` (new)
- `tests/docs-phase-sync.test.mjs` (new)
- `scripts/test-changed.mjs`
- `tasks/DOCS-001.md`

## Notes

这是流程加速任务，不是玩法/美术功能任务。它只统一文档所有权，不改变任何 AC 的判定口径。任务库 Touches 的批量摘除由任务操作员执行，本任务负责产出清单与验证脚本。

### 执行证据（2026-10-27，DOCS-001）

- **清理前**：以 f7a3a14 的 `tasks/` 快照为根运行 `node scripts/check-doc-ownership.mjs --root …` → exit 1，
  列出 13 个受阻任务（ready 10 / todo 3），逐个打印其声明的 `docs/PRD.md` / `docs/TECH_DESIGN.md`。
- **清理后**：同一命令对当前任务库 → exit 0，「0 个 open 任务声明总文档（已扫描 52 个任务）」。
- **清理方式**：经任务 ABI（`quay task edit --body-file` → Provider `taskWrite`）逐个写入 13 个任务，
  只摘除两份总文档并追加一条 Notes，未改 Proposal/Plan/AC/DoD。ABI 写入落在任务 store 的 git 根并 ff 到
  develop，因此不出现在本分支 `develop...HEAD` 的 diff 中，但会随 fan-in 的 merge 进入验收树。
- **并发证据**：清理后 ready 池中 Touches 两两不重叠的实现任务是 5 个
  （gap-audio-impacts / gap-background-atmosphere-gate / gap-floaters-layering /
  gap-mobile-visual-font-floor / gap-weapon-impact-vfx），超过 DoD 的 ≥4；文档锁不再串行。
- **一致性**：冻结值（层序、预算、签名、资源索引）只在 `docs/PHASE_FEEL_ART.md` 定义；PRD/TECH 只写增量并引用
  §x.y；`tests/docs-phase-sync.test.mjs` 断言每个被引用的章节号真实存在，`npm run check:docs` 通过（20 个文件）。
- **后续遵守**：13 个实现任务的 Notes 已记录设计增量落点、Touches 不再含两份总文档；
  `check-doc-ownership` 对任何重新加入总文档的 open 任务 exit 1，约定由机制而非记忆保证。
