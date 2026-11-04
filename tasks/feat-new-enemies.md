---
id: feat-new-enemies
title: 新型怪物：新增 6~8 种敌人，各带独特机制，配合关卡节点主题
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/enemies-depth.test.mjs tests/waves.test.mjs
---
## Proposal

增加敌人多样性（用户「各种新型怪物」）。配合关卡节点化（`docs/PHASE_CHAPTERS.md` 的 6 节点主题），新增 6~8 种敌人、每种一个独特机制，作为各节点的「招牌怪」。复用现有敌人系统：`public/js/shared/data/enemies.js`（数据：hp/speed/armor/gold + 特殊字段 flying/shield/splits/heal/aura/ranged/blink）、`public/js/sim/enemy-system.js`（行为：移动/闪现/远程/光环）、`public/js/sim/wave-director.js`（波次池 minWave）、`public/js/render/enemy-data.js`（程序化形状/颜色）。候选机制（供 worker 定稿，各节点招牌）：节点2 飞行精英（护甲飞怪）、节点3 反弹者（反伤护盾）、节点4 自爆虫（死亡爆炸/分裂）、节点5 潜行者（周期闪现/隐身）+ 光环变体（加速/减速/治疗光环）；另加 1~2 个通用精英（召唤者召小弟、护盾穿透者）。数值按现有 `minWave`/护甲/速度口径，进对应节点主题池；新机制需在 `enemy-system.js` 加对应行为钩子（如反伤、自爆、隐身），**不耗新 RNG、不改 sim 确定性**。程序化形状走 `enemy-data.js`（不新增 sprite kind，留给美术线 TODO-17）。

## AC

- [x] 新增 6~8 种敌人，数据落地 `enemies.js`（hp/speed/armor/gold + 机制字段）
- [x] 每种一个独特机制，行为钩子落地 `enemy-system.js`（反伤/自爆/隐身/光环等），确定性、零新 RNG
- [x] 进 `wave-director.js` 波次池（minWave 与节点主题对齐），`enemy-data.js` 有程序化形状/颜色
- [x] `node --test tests/enemies-depth.test.mjs tests/waves.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/shared/data/enemies.js`、`public/js/sim/enemy-system.js`、`public/js/sim/wave-director.js`、`public/js/render/enemy-data.js`、i18n，零第三方依赖
- [x] 回归测试覆盖每种新敌人的机制与波次池（确定性、不越 RNG 红线）
- [x] `npm test` 全绿；补跑 `node --test tests/enemies-depth.test.mjs tests/waves.test.mjs tests/combat.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/data/enemies.js`
- `public/js/sim/enemy-system.js`
- `public/js/sim/wave-director.js`
- `public/js/shared/waves.js`
- `public/js/render/enemy-data.js`
- `public/js/render/enemy-body.js`
- `public/js/render/art-tokens.js`
- `public/js/shared/i18n/zh-CN.enemies.js`
- `public/js/shared/i18n/en-US.enemies.js`
- `public/assets/sprites/entities/entity-atlas.json`
- `public/assets/sprites/entities/entity-atlas@1x.png`
- `public/assets/sprites/entities/entity-atlas@2x.png`
- `public/assets/sprites/manifest.json`
- `docs/reviews/entity-sprite-coverage-contact-sheet.png`
- `docs/reviews/entity-sprite-states-contact-sheet.png`
- `tests/enemies-depth.test.mjs`
- `tests/data-split.test.mjs`
- `tests/nodes.test.mjs`
- `tests/sprite-coverage.test.mjs`
- `scripts/structure-budget.allow.d/feat-new-enemies.json`
- `tasks/feat-new-enemies.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-16。与美术线（TODO-17）并行：本任务只做机制 + 程序化形状，新怪物的立绘/图集交给美术线。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为敌人内容填充，机制走既有敌人系统，无新玩法文档面，L_D/L_G/L_S 无需量化。

实现落地（2026-11-04）：

- 新增 7 种敌人：skywing（护盾再生）、bastion（反伤脉冲停摆近身塔）、mender（治疗光环）、bomber（逼近基地自爆）、stalker（周期冲刺）、riftcaller（召唤噬虫小弟）、shieldbreaker（漏怪穿透减伤），机制全部为确定性周期行为，零新 RNG，不碰 `sim.js` RNG 调用顺序。
- 波次池 POOL 实际在 `public/js/shared/waves.js`（非 AC 字面的 wave-director.js），Touches 已增补 waves.js；minWave 与 6 节点主题对齐（skywing 6 / bastion 11 / mender 13 / bomber 16 / stalker 21 / riftcaller 26 / shieldbreaker 28）。
- 新敌人类型 id 用 `riftcaller`：原拟 `summoner` 与首领变体 `BOSS_VARIANTS.summoner` 撞名，会使 sprite 覆盖表因同名键去重到 63 实体（覆盖测试红）。中文名仍为「裂隙召唤师」。
- 图集重生成（实体状态帧 164）；无障碍配色蓝黄/红绿两套敌人映射补 7 种（art-tokens.js）。
- enemy-body.js 新增 3 个程序化造型后超 600 行预算，登记债务 `scripts/structure-budget.allow.d/feat-new-enemies.json`（maxLines 700）。
- 合并 develop 后，本任务的 POOL 增补改变了 `tests/nodes.test.mjs` 的「chapters 默认关闭现状快照」（该快照由 feat-chapters-table 立案），已按新现状重生成快照并声明进 Touches。
- `npm test` 2015/2015 全绿；`node --test tests/enemies-depth.test.mjs tests/waves.test.mjs` 26/26 exit 0。

## Blocker

**2026-11-04T04:00:54.247Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging tests/data-split.test.mjs
CONFLICT (content): Merge conflict in tests/data-split.test.mjs
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：5c646135-7b8d-4669-a890-da6a70c1ed17
