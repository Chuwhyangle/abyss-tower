---
id: gap-i18n-split-per-domain
title: i18n 词典按域拆分：解除内容任务串行热点
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-map-difficulty-spread-compensation
---
## Proposal

i18n 词典（`zh-CN.js`/`en-US.js`）是所有内容任务的串行热点：每个新敌人/遗物/meta 都要写这两份文件，而 `touches_relax.shared_files` 只白名单了 `docs/*.md`，代码文件重叠照样阻塞，实际并发被压到 1。拆成 per-domain 词典、加载时聚合，让不同域任务 Touches 不相交、能真并发。

<!-- dedup-ref --> 结构性重构：只拆词典 + 改加载器 + 同步引用，不改任何文案、不改变量名语义；`tests/i18n-coverage.test.mjs` 零缺译门禁必须不回归。

## Plan

1. 把 `zh-CN.js` / `en-US.js` 拆成 per-domain（如 `zh-CN.enemies.js`、`zh-CN.relics.js`、`zh-CN.meta.js`、`zh-CN.ui.js` 等），按域划分现有键。
2. `public/js/i18n.js` 加载器改为聚合加载（import 所有 domain 文件并合并成同一词典对象）。
3. 同步所有 `import` 引用；保证 `tData()`/`data-i18n` 行为不变。
4. `node --test tests/i18n-coverage.test.mjs` + `npm test` 全绿（零缺译、零裸键不回归）。

## AC

- [ ] `ls public/js/shared/i18n/ | wc -l` ≥ 4（per-domain 词典已拆出）
- [ ] `node --test tests/i18n-coverage.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 词典按域拆分、加载器聚合、双语零缺译不回归；不同域内容任务不再共享同一词典文件
- [ ] 拆分后文案与拆分前逐字节一致（无新增/删改键，只搬位置）

## Touches

- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `public/js/i18n.js`
- `tests/i18n-coverage.test.mjs`
- `tasks/gap-i18n-split-per-domain.md`
