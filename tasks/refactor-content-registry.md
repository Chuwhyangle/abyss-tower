---
id: refactor-content-registry
title: 并发重构·阶段4：内容注册表拆分（relics/effects，确定性高危串行）
status: ready
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

- [x] relics 拆成 per-relic 文件 + 注册表，`RELIC_ORDER` 顺序不变（`tests/data-split.test.mjs` 绿）
- [x] effects 的 EFFECT_REGISTRY 拆片段合并，键序/globalModCaps 派生不变
- [x] `node scripts/check-sim-determinism.mjs --check` 通过（确定性零漂移）
- [x] `npm run balance` 前后对比无漂移；`npm test` 全绿

## DoD

- [x] 落地于 `shared/data/relics/*`(新)、`shared/data/relics/index.js`、`shared/effects/`(拆分)、`shared/effects.js`(聚合)，零第三方依赖
- [x] ⛔ 确定性红线：不新增/删除/重排任何 RNG 调用；注册表数组顺序 = 原对象键序
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/js/shared/data/relics.js`
- `public/js/shared/data/relics/index.js` (new)
- `public/js/shared/data/relics/sharp.js` (new)
- `public/js/shared/data/relics/quickdraw.js` (new)
- `public/js/shared/data/relics/eagle.js` (new)
- `public/js/shared/data/relics/bounty.js` (new)
- `public/js/shared/data/relics/thrifty.js` (new)
- `public/js/shared/data/relics/crystal.js` (new)
- `public/js/shared/data/relics/velocity.js` (new)
- `public/js/shared/data/relics/frostglint.js` (new)
- `public/js/shared/data/relics/venomfang.js` (new)
- `public/js/shared/data/relics/sparkplug.js` (new)
- `public/js/shared/data/relics/steadyaim.js` (new)
- `public/js/shared/data/relics/coinpurse.js` (new)
- `public/js/shared/data/relics/sandbag.js` (new)
- `public/js/shared/data/relics/frostedge.js` (new)
- `public/js/shared/data/relics/venomvial.js` (new)
- `public/js/shared/data/relics/spareparts.js` (new)
- `public/js/shared/data/relics/scouthorn.js` (new)
- `public/js/shared/data/relics/bloodpact.js` (new)
- `public/js/shared/data/relics/bloodstake.js` (new)
- `public/js/shared/data/relics/highroller.js` (new)
- `public/js/shared/data/relics/moonwell.js` (new)
- `public/js/shared/data/relics/embertrace.js` (new)
- `public/js/shared/data/relics/desperado.js` (new)
- `public/js/shared/data/relics/goldencoffer.js` (new)
- `public/js/shared/data/relics/openfield.js` (new)
- `public/js/shared/data/relics/harvestsickle.js` (new)
- `public/js/shared/data/relics/emberclock.js` (new)
- `public/js/shared/data/relics/frostlattice.js` (new)
- `public/js/shared/data/relics/gambitseal.js` (new)
- `public/js/shared/data/relics/powder.js` (new)
- `public/js/shared/data/relics/frostheart.js` (new)
- `public/js/shared/data/relics/static.js` (new)
- `public/js/shared/data/relics/toxin.js` (new)
- `public/js/shared/data/relics/usury.js` (new)
- `public/js/shared/data/relics/pierce.js` (new)
- `public/js/shared/data/relics/crit.js` (new)
- `public/js/shared/data/relics/bosslayer.js` (new)
- `public/js/shared/data/relics/alchemy.js` (new)
- `public/js/shared/data/relics/siege.js` (new)
- `public/js/shared/data/relics/cartel.js` (new)
- `public/js/shared/data/relics/auroraveil.js` (new)
- `public/js/shared/data/relics/skyfall.js` (new)
- `public/js/shared/data/relics/gamblerscoin.js` (new)
- `public/js/shared/data/relics/adrenaline.js` (new)
- `public/js/shared/data/relics/martyr.js` (new)
- `public/js/shared/data/relics/cometcore.js` (new)
- `public/js/shared/data/relics/warchest.js` (new)
- `public/js/shared/data/relics/lastbreath.js` (new)
- `public/js/shared/data/relics/bloodybanner.js` (new)
- `public/js/shared/data/relics/lightsentry.js` (new)
- `public/js/shared/data/relics/bloodmoney.js` (new)
- `public/js/shared/data/relics/tideglass.js` (new)
- `public/js/shared/data/relics/metronome.js` (new)
- `public/js/shared/data/relics/starcycle.js` (new)
- `public/js/shared/data/relics/moonlitvault.js` (new)
- `public/js/shared/data/relics/warlord.js` (new)
- `public/js/shared/data/relics/warhorn.js` (new)
- `public/js/shared/data/relics/frostbite.js` (new)
- `public/js/shared/data/relics/laststand.js` (new)
- `public/js/shared/data/relics/greed.js` (new)
- `public/js/shared/data/relics/bastion.js` (new)
- `public/js/shared/data/relics/eclipsehour.js` (new)
- `public/js/shared/data/relics/bloodtide.js` (new)
- `public/js/shared/data/relics/doomclock.js` (new)
- `public/js/shared/data/relics/stasislens.js` (new)
- `public/js/shared/data/relics/starforge.js` (new)
- `public/js/shared/data/relics/midasthrone.js` (new)
- `public/js/shared/data/relics/palaceguard.js` (new)
- `public/js/shared/data/relics/eternalhourglass.js` (new)
- `public/js/shared/data/relics/stormpulse.js` (new)
- `public/js/shared/effects.js`
- `public/js/shared/effects/base.js` (new)
- `public/js/shared/effects/skill.js` (new)
- `public/js/shared/effects/periodic.js` (new)
- `docs/reviews/sim-determinism.json`
- `tests/data-split.test.mjs`
- `tests/effects-registry.test.mjs`
- `tasks/refactor-content-registry.md`

## Notes

立案 2026-11-06，路线图阶段 4（确定性高危）。⚠️ 必须串行 + 单独 owner + 四道门禁（npm test / balance / sweep / sim:determinism）。依赖阶段 0 的安全网（touches-conflict）。这是唯一可能破坏平衡基线的阶段。

实现完成（1beda764）：
- relics 拆 70 件 per-file + index.js 注册表，RELICS 顺序与拆分前逐字一致（70 件 deep-equal）。
- effects 的 EFFECT_REGISTRY 拆 base(22)/skill(2)/periodic(6) 片段合并，30 键序与 globalModCaps 派生不变。
- 四道门禁：npm test 2092 全绿；balance 输出为 develop 严格后缀（无漂移）；sweep exit 0；sim:determinism 零漂移。
- ⚠️ sim:determinism 基线重锚：committed 基线上一次写入 06120518，之后 develop 落地 chapters(09831a76)/talent(965e4153) 改变模拟行为，clean develop 自身 --check 也红；本重构与 clean develop 逐字节一致（3 seed × events/rng/state 哈希相同），故重锚基线至当前行为并补入 Touches，非本重构引入漂移。