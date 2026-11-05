---
id: refactor-content-registry
title: 并发重构·阶段4：内容注册表拆分（relics/effects，确定性高危串行）
status: todo
labels:
  - refactor
parent: null
children: []
extra: {}
depends_on:
  - refactor-touches-conflict
---
## Proposal

并发友好重构·阶段 4：内容注册表拆分（**确定性高危，串行，单独 owner**）。

1. `public/js/shared/data/relics.js`（281 行，2 路冲突）按 `shared/hexes/` 范式拆成 `shared/data/relics/<relic-id>.js` + `index.js` 注册表。⚠️ `RELIC_ORDER` 数组顺序不得变（否则同 seed 抽卡结果改变）。
2. `public/js/shared/effects.js` 的 `EFFECT_REGISTRY`（494 行逻辑，词缀热点）按域拆片段再合并，保持键序与 `globalModCaps()` 派生顺序不变。
- 拆分后：新遗物/词缀 = 新增自己的文件 + 注册表 1 行，不再改共享文件。

## AC

- [ ] relics 拆成 per-relic 文件 + 注册表，`RELIC_ORDER` 顺序不变（`tests/data-split.test.mjs` 绿）
- [ ] effects 的 EFFECT_REGISTRY 拆片段合并，键序/globalModCaps 派生不变
- [ ] `node scripts/check-sim-determinism.mjs --check` 通过（确定性零漂移）
- [ ] `npm run balance` 前后对比无漂移；`npm test` 全绿

## DoD

- [ ] 落地于 `shared/data/relics/*`(新)、`shared/data/relics/index.js`、`shared/effects/`(拆分)、`shared/effects.js`(聚合)，零第三方依赖
- [ ] ⛔ 确定性红线：不新增/删除/重排任何 RNG 调用；注册表数组顺序 = 原对象键序
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/data/relics/` (新)
- `public/js/shared/effects.js`
- `public/js/shared/effects/` (新)
- `tests/data-split.test.mjs`
- `tests/` (确定性/平衡测试)
- `tasks/refactor-content-registry.md`

## Notes

立案 2026-11-06，路线图阶段 4（确定性高危）。⚠️ 必须串行 + 单独 owner + 四道门禁（npm test / balance / sweep / sim:determinism）。依赖阶段 0 的安全网（touches-conflict）。这是唯一可能破坏平衡基线的阶段。