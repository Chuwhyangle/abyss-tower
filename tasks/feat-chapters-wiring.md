---
id: feat-chapters-wiring
title: 关卡节点化·阶段1接线：服务端 presence-gate + 客户端透传 + replay 版本
status: done
labels:
  - feat
parent: null
children: []
depends_on:
  - feat-chapters-table
extra:
  schema: execution
  acceptance: node --test tests/nodes.test.mjs tests/replay.test.mjs
    tests/run-lifecycle.test.mjs
---
## Proposal

关卡节点化阶段 0（`feat-chapters-table` done）已落地 `chapters.js` 章节表 + `generateWave` 的 `chapters` 开关（默认关闭、字节不变）。本任务是**阶段 1 接线**，把章节实际送进游戏：① 服务端 presence-gate——`server/services/run-rules.mjs` 的 `planRunStart` 对非 tower 模式写 `ruleset.chapters = { v:1 }`（老 run 无此字段 → chapters=false → 旧波次）；`server/services/run-service.mjs` 的 `serveWave` 读 `run.ruleset?.chapters` 透传给 `generateWave`；② 客户端透传——`public/js/sim.js` 构造器读 `opts.ruleset?.chapters` 置 `this.chapters`，`public/js/sim/wave-director.js` 与 `public/js/sim/snapshot-mapper.js` 的 `generateWave` 调用传 `chapters`；③ `public/js/shared/replay.js` 升 `REPLAY_VERSION 3→4` + payload `c`（chapters 布尔）+ `PAYLOAD_KEYS`/编解码同步（旧 v1-v3 码 c 缺省 → 关闭）；④ `server/config.mjs` 的 `CONTENT_VERSION` +1（新旧客户端波次不一致不混榜）。确定性红线：`chapterForWave` 纯函数、无新 RNG；`chapters=false` 路径逐字节不变。

## AC

- [x] 服务端 `ruleset.chapters` presence-gate 落地，`serveWave` 透传 chapters
- [x] 客户端 `sim.js`/`wave-director`/`snapshot-mapper` 透传 chapters
- [x] `replay.js` REPLAY_VERSION 4 + `c` 字段编解码，旧码兼容
- [x] `CONTENT_VERSION` +1
- [x] `node --test tests/nodes.test.mjs tests/replay.test.mjs tests/run-lifecycle.test.mjs` exit 0

## DoD

- [x] 落地于服务端 run-rules/run-service、客户端 sim/wave-director/snapshot-mapper、replay.js、config.mjs，零第三方依赖
- [x] 回归测试：chapters 开/关字节一致、旧 run 缺 ruleset.chapters 走线性、replay v3 旧码兼容
- [x] `npm test` 全绿；补跑 `node --test tests/nodes.test.mjs tests/replay.test.mjs tests/run-lifecycle.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `server/services/run-rules.mjs`
- `server/services/run-service.mjs`
- `public/js/sim.js`
- `public/js/sim/wave-director.js`
- `public/js/sim/snapshot-mapper.js`
- `public/js/shared/replay.js`
- `server/config.mjs`
- `tests/replay.test.mjs`
- `tests/hex-flow.test.mjs`
- `scripts/structure-budget.allow.d/gap-ac-058-contract-card.json`
- `scripts/structure-budget.allow.d/gap-ac-063-meta-talent-tree.json`
- `tasks/feat-chapters-wiring.md`

## Notes

立案 2026-11-04，源自 `docs/PHASE_CHAPTERS.md` §6 + `docs/TODO.md` TODO-15。依赖 `feat-chapters-table`（depends_on，done）。阶段 2（CONTENT_VERSION 已含本任务 + 浏览器验收）在阶段 1 落地后收尾。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为章节接线，契约已冻结，无新玩法文档面，L_D/L_G/L_S 无需量化。

- 续做 2026-11-04：AC 5/5 已勾，补勾 DoD 4/4；`npm test` 2017/2017 全绿，`node --test tests/nodes.test.mjs tests/replay.test.mjs tests/run-lifecycle.test.mjs` 32/32 exit 0；anti-drift Touches 11 文件全在声明内；清除未落地原因（已落地）。
