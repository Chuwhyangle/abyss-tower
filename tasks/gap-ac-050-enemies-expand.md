---
id: gap-ac-050-enemies-expand
title: 敌人扩充：新增 wraith（相位幽魂）与 golem（岩石魔像）到 14 类并进波次/渲染/i18n（AC-050）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-050
---
## Proposal

AC-050（敌人总数 ≥14 且新敌人行为有区分度并进波次）已激活，criterion `grep -q 'wraith' public/js/shared/data/enemies.js && grep -q 'golem' public/js/shared/data/enemies.js` 当前 exit 1（wraith/golem 均不存在）。当前 `ENEMIES` 有 12 类（游魂/疾影/噬虫/石卫/翼魔/祭司/渊主 + 护盾兵/分裂体/分裂仔/传令官/施法者），全部进波次且被 `tests/enemies-depth.test.mjs` 覆盖。

本任务扩 2 类到 14 类：**wraith（相位幽魂）**——中速、周期性短距离闪烁穿行、可穿越塔位但受击正常；**golem（岩石魔像）**——高护甲慢速、死亡时分裂为 2 个小石卫（splitling 复用或新增轻量分裂体）。行为有区分度，接入波次/渲染/i18n。

<!-- dedup-ref --> 无任务以 `goal_ac: AC-050` 认领；AC-051（覆盖门禁）与 AC-052（平衡）各自独立认领，本任务只落 2 个新敌人的内容，不碰平衡。

## Plan

1. `public/js/shared/data/enemies.js` 加 wraith/golem 定义（hp/speed/armor/gold/dmg + 行为字段），`MAX_WAVE` 与计数口径不变。
2. `public/js/shared/waves.js` 加权重（weight/countMult/minWave/interval），保证两敌人随波次出现且能被打断。
3. `public/js/sim/enemy-system.js` 落行为：wraith 周期性闪烁（位置瞬移不改变路径/lane）、golem 死亡分裂小石卫；保持 RNG 调用序确定。
4. `public/js/render/enemy-body.js` + `enemy-data.js` 加渲染/精灵分派（缺资源回退程序化绘制，不崩）。
5. i18n 中英成对加键（`data.enemy.wraith.name` / `data.enemy.golem.name` 等）。
6. 扩展 `tests/enemies-depth.test.mjs`：2 新敌人的行为（闪烁/分裂）、波次接入、渲染分派、确定性哈希。

## AC

- [x] `grep -q 'wraith' public/js/shared/data/enemies.js && grep -q 'golem' public/js/shared/data/enemies.js` exit 0（AC-050 本体判据）
- [x] `node --test tests/enemies-depth.test.mjs` exit 0
- [x] `node --test tests/i18n-coverage.test.mjs` exit 0
- [x] `npm test` exit 0

## DoD

- [x] 同一 seed 的确定性模拟里，wraith 的闪烁与 golem 的分裂真实发生、可复现（RNG 调用序不漂移），且 0 改动前同一 seed 逐字节一致
- [x] wraith/golem 在对应 minWave 起随波次出现，渲染分派正确、桌面与移动视口不破版
- [x] 两个新敌人 i18n 中英成对、无裸键；`tests/enemies-depth.test.mjs` 覆盖其行为与波次接入

## Touches

- `public/js/shared/data/enemies.js`
- `public/js/shared/waves.js`
- `public/js/sim/enemy-system.js`
- `public/js/render/enemy-body.js`
- `public/js/render/enemy-data.js`
- `public/js/render/art-tokens.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/enemies-depth.test.mjs`
- `tests/data-split.test.mjs`
- `tests/sprite-coverage.test.mjs`
- `scripts/build-entity-sprites.mjs`
- `public/assets/sprites/entities/entity-atlas.json`
- `public/assets/sprites/entities/entity-atlas@1x.png`
- `public/assets/sprites/entities/entity-atlas@2x.png`
- `public/assets/sprites/manifest.json`
- `docs/reviews/entity-sprite-coverage-contact-sheet.png`
- `docs/reviews/entity-sprite-states-contact-sheet.png`
- `tasks/gap-ac-050-enemies-expand.md`

## Blocker

**2026-10-30T09:31:12.486Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 4/7，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：ad16ccb7-65b2-4132-a3ef-cc73ae40aca2
