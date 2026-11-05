---
id: DOCS-006
title: 文档 lane：迁移 TECH_DESIGN.md 的 styles.css 引用（解锁 refactor-css-partition）
status: ready
labels:
  - docs
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/docs-consistency.test.mjs tests/docs-phase-sync.test.mjs
---
## Proposal

`refactor-css-partition`（并发重构阶段 2）已把 `public/styles.css`（4397 行单体）拆成 `public/css/*`（14 个分区：tokens/base/title/shop/hud/modals/nodes/mobile/skills/achievements/meta/transitions/hex/a11y）并删除单体，但 `docs/TECH_DESIGN.md:354` 仍引用 `public/styles.css`，导致 `tests/docs-consistency.test.mjs` 与 `tests/docs-phase-sync.test.mjs` 各红 1 条，把 `refactor-css-partition` 的 fan-in 全量 suite 打红（2109 例中唯一 2 条失败）。本 DOCS lane 任务迁移该引用，解锁该重构任务落地。

## Plan

1. 迁移 `docs/TECH_DESIGN.md:354` 的 `public/styles.css` → `public/css/tokens.css`（`:root` 变量现居 tokens.css）。
2. ⚠️ 跨 lane 鸡生蛋：`public/css/tokens.css` 在 refactor-css-partition 落地前不存在，直接改路径会在本任务 fan-in 时把 docs-consistency 打红。二选一破环：
   - (a) 用 `docs-consistency:planned-start` / `docs-consistency:planned-end` 块只包住该行（planned 块豁免代码路径存在性检查，本任务与 refactor-css-partition 的 fan-in 都绿）；在 Notes 记「待 refactor-css-partition 落地后由后续 DOCS 任务移除 planned 块」。
   - (b) 改写句子去掉具体文件路径（如「JS 侧 `ui` 令牌与样式表 `:root` 变量互为镜像」），两边都绿且无 planned 块残留。
   优先 (a) 保留准确指向；若 planned 块进总文档语义别扭则用 (b)。
3. `node --test tests/docs-consistency.test.mjs tests/docs-phase-sync.test.mjs` exit 0；`node scripts/check-doc-ownership.mjs` exit 0（DOCS lane 可合法改 TECH_DESIGN.md）。

## AC

- [ ] `node --test tests/docs-consistency.test.mjs tests/docs-phase-sync.test.mjs` exit 0
- [ ] `node scripts/check-doc-ownership.mjs` exit 0
- [ ] `grep -n "public/styles.css" docs/TECH_DESIGN.md` 无命中

## DoD

- [ ] TECH_DESIGN.md 的 styles.css 引用已迁移（或改写去路径），`grep -n "public/styles.css" docs/TECH_DESIGN.md` 无命中
- [ ] 迁移后 docs-consistency / docs-phase-sync 全绿，refactor-css-partition 的 fan-in 不再被 docs 打红
- [ ] 只碰 `docs/TECH_DESIGN.md` 与 `tasks/DOCS-006.md`

## Touches

- `docs/TECH_DESIGN.md`
- `tasks/DOCS-006.md`

## Notes

立案 2026-11-06：解锁 refactor-css-partition 的 docs 红（该任务 worker 已确认 2107/2109 绿、唯 2 红即 TECH_DESIGN.md:354 的 stale `public/styles.css` 引用）。跨 lane 鸡生蛋口径见 Plan §2。