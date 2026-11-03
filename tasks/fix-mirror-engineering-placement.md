---
id: fix-mirror-engineering-placement
title: 镜像工程重做：对称自动镜像改玩家自选落位（手放连体镜像）
status: ready
labels:
  - fix
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-mirror-engineering.test.mjs
---
## Proposal

镜像工程（`public/js/shared/hexes/mirror-engineering.js`）现在「建塔时在中心对称格自动生成 60% 镜像」，但三张固定图非中心对称，实测对称格可建率 canyon 0/25、twin 4/25、ring 0/25，导致镜像「跑歪」（8 邻兜底）或「不生成」（twin 9/25、ring 14/25）。三路论证收敛到「手放连体镜像」（方案 A 收窄版），本任务落地：① 建本体塔后**玩家自选位置**放镜像（同类型、0 造价、60% 属性、随本体升级/消失、不可单独升级/出售），复用现有「选塔→点格子」手感；② `mirrorOf` 直接写进快照（presence-gated，不 bump `SAVE_VERSION`），**删掉** `mirrorSites`/`repairMirrorIdentity`/`restoreSoldMirror`/`findMirrorSite`/`CLOCKWISE` 整套身份修复；③ 平衡：造价 ×1.35→**×1.45**，补 `dot`/`slow` 等次要属性的 0.6 折扣（现 `modifyTowerStats` 只乘 dmg/rate/range/buffDmg/buffRate，漏乘 dot/slow/splash/chain）；④ 镜像被单独出售 0 金消失（删 `restoreSoldMirror`）。确定性不变（玩家动作 + 纯 ×0.6，不消耗 RNG、不改 sim RNG 顺序）。

## AC

- [x] 建本体塔后进入镜像落位模式（同类型强制、0 金、幽灵预览染色），玩家点空位落镜像；Esc 暂存不丢弃（一次一个待落位槽）
- [x] 镜像 60% 属性**含 dot/slow 等次要属性**、随本体升级/消失、不可单独升级/出售
- [x] `mirrorOf` 写入快照并读档回填；`mirrorSites`/`repairMirrorIdentity`/`restoreSoldMirror`/`findMirrorSite` 删除
- [x] 造价 ×1.45；镜像被单独出售 0 金消失
- [x] `node --test tests/hex-mirror-engineering.test.mjs` exit 0（整组重写）

## DoD

- [x] 落地于 `public/js/shared/hexes/mirror-engineering.js`、`public/js/sim/tower-system.js`、`public/js/sim.js`、`public/js/app/input.js`、`public/js/render/tower-renderer.js`、`public/js/shared/snapshot.js`、i18n（zh/en），不引入第三方依赖
- [x] 回归测试覆盖落位/取消/暂存、60% 含次要属性、随本体升级/消失、快照 mirrorOf 往返、不可单独升级/出售
- [x] `npm test` 全绿；补跑 `node --test tests/hex-mirror-engineering.test.mjs tests/snapshot.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/hexes/mirror-engineering.js`
- `public/js/sim/tower-system.js`
- `public/js/sim.js`
- `public/js/app/input.js`
- `public/js/render.js`
- `public/js/render/tower-renderer.js`
- `public/js/shared/snapshot.js`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tests/hex-mirror-engineering.test.mjs`
- `tests/sim-systems.test.mjs`
- `tasks/fix-mirror-engineering-placement.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-16（三路收敛方案）。⚠️ 本 hex 从「只改钩子」升级为「需 sim+input+render 协作」的一等机制，打破 `mirror-engineering.js:1-7` 的自述约束，设计增量已记 TODO-16，不在本任务写 docs/PRD/TECH_DESIGN。快照 `mirrorOf` 是 presence-gated 可选字段，旧档镜像会掉 60% 属性（瞬态单局存档，接受，不写迁移）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为海克斯机制重做，方案已定稿，无新文档面，L_D/L_G/L_S 无需量化。

worker 落地补充（2026-11-03）：镜像落位逻辑收敛进 `public/js/sim/tower-system.js`（`setPendingMirror`/`clearPendingMirror`/`pendingMirrorBody`/`cancelMirrorPlacement`/`resumeMirrorPlacement`/`restoreMirrorIdentities`），`sim.js` 只留 `pendingMirror`/`mirrorPlacing` 两个瞬态字段 + 一行委派，保证不超结构预算（699 行 ≤ 700 债务上限）。因渲染入口 `public/js/render.js` 加一行 `renderMirrorPlacement` 调用、导出面快照测试 `tests/sim-systems.test.mjs` 需同步新增 7 个 sim 公开方法，两文件补进 Touches。