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

- [ ] 新增 6~8 种敌人，数据落地 `enemies.js`（hp/speed/armor/gold + 机制字段）
- [ ] 每种一个独特机制，行为钩子落地 `enemy-system.js`（反伤/自爆/隐身/光环等），确定性、零新 RNG
- [ ] 进 `wave-director.js` 波次池（minWave 与节点主题对齐），`enemy-data.js` 有程序化形状/颜色
- [ ] `node --test tests/enemies-depth.test.mjs tests/waves.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/js/shared/data/enemies.js`、`public/js/sim/enemy-system.js`、`public/js/sim/wave-director.js`、`public/js/render/enemy-data.js`、i18n，零第三方依赖
- [ ] 回归测试覆盖每种新敌人的机制与波次池（确定性、不越 RNG 红线）
- [ ] `npm test` 全绿；补跑 `node --test tests/enemies-depth.test.mjs tests/waves.test.mjs tests/combat.test.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/data/enemies.js`
- `public/js/sim/enemy-system.js`
- `public/js/sim/wave-director.js`
- `public/js/render/enemy-data.js`
- `public/js/shared/i18n/zh-CN.enemies.js`
- `public/js/shared/i18n/en-US.enemies.js`
- `tests/enemies-depth.test.mjs`
- `tasks/feat-new-enemies.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-16。与美术线（TODO-17）并行：本任务只做机制 + 程序化形状，新怪物的立绘/图集交给美术线。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为敌人内容填充，机制走既有敌人系统，无新玩法文档面，L_D/L_G/L_S 无需量化。
