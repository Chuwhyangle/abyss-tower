---
id: feat-buildable-mask
title: 开局建塔位重做：三张固定图改用贴路塔位掩码，偏少、固定、贴路
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/mapgen.test.mjs tests/fixed-maps.test.mjs
---
## Proposal

三张固定图（裂谷关隘 canyon / 双牙桥 twin / 环心遗迹 ring）现在 buildable 高达 207~215 格（`public/js/shared/maps/rasterize.js` 的 `buildable[r][c] = !pathSet && !blocked`，近乎全图可建），贴路格也可建，与用户要求「开局可建塔位置**偏少、每图固定、别太离谱、最好贴路**」相反。重做：在 `rasterize.js` 增加「手写塔位掩码」概念——三张图各手写一份固定贴路塔位（每图约 15~25 格，优先路径 1 格邻接，避开岩石与可破坏物占格），取代「全图可建」。旧 legacy 随机图回退路径保持不变。落地后 `npm run balance` 验证难度（塔位变少会变难，若三档通关率明显下坠需回调数量或配合其它补偿）。

## AC

- [ ] 三张固定图各有一份手写塔位掩码（贴路、偏少、固定），不再全图可建
- [ ] `rasterize.js` 支持读取手写掩码；旧 legacy 随机图回退路径不变
- [ ] 每图塔位 15~25 格，以路径 1 格邻接为主，不与岩石/可破坏物占格冲突
- [ ] `node --test tests/mapgen.test.mjs tests/fixed-maps.test.mjs` exit 0（更新断言到新掩码）

## DoD

- [ ] 落地于 `public/js/shared/maps/canyon.js`、`twin.js`、`ring.js`、`rasterize.js`，不引入第三方依赖
- [ ] 回归测试覆盖掩码读取、贴路判定、数量范围、旧图回退
- [ ] `npm test` 全绿；`npm run balance` 复测三档通关率并记录偏移
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/maps/canyon.js`
- `public/js/shared/maps/twin.js`
- `public/js/shared/maps/ring.js`
- `public/js/shared/maps/rasterize.js`
- `tests/fixed-maps.test.mjs`
- `tests/mapgen.test.mjs`
- `tasks/feat-buildable-mask.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-11。每图具体塔位数（15~25）为起始区间，`npm run balance` 复测后再定是否需要回调。若 worker 实际 Touches 与声明有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为地图数据与栅格化改造，无新文档面，L_D/L_G/L_S 无需量化。
