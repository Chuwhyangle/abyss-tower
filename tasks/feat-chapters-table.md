---
id: feat-chapters-table
title: 关卡节点化·阶段0：chapters.js 章节表 + generateWave 默认关闭开关
status: done
labels:
  - feat
parent: null
children: []
depends_on:
  - DOCS-005
extra:
  schema: execution
  acceptance: node --test tests/nodes.test.mjs
---
## Proposal

关卡节点化 PHASE 冻结表 `docs/PHASE_CHAPTERS.md`（DOCS-005）定稿后，本任务是**阶段 0（串行契约层）**：① 新增 `public/js/shared/chapters.js`——`CHAPTERS` 6 节点表（每节点 `{ id, name, waves:[start,end], theme:{hpMul,speedMul}, enemyPool[], bossVariant }`）+ `chapterForWave(wave)` 纯函数（按区间反查、无 RNG）；② `generateWave`（`waves.js`）加第 5 参 `{ endless, chapters }` 默认 `chapters=false`——`chapters=true` 时按 `chapterForWave(index)` 把 theme 的 hpMul/speedMul 乘进既有折叠点、enemyPool 过滤敌人池（每个生效波次 ≥3 类型）、bossVariant 覆盖（最终波 30 仍强制 berserk），返回追加 `chapterId`；`chapters=false` 时与现状字节一致（旧存档/回放/分享码不变）。确定性红线：`chapterForWave` 纯函数、theme 固定表值、敌人池过滤不增删 RNG 调用。

## AC

- [x] `public/js/shared/chapters.js` 存在：6 节点表 + `chapterForWave` 区间反查纯函数
- [x] `generateWave` 加 `chapters` 开关（默认 false）；false 时与现状逐字节一致
- [x] true 时：theme hpMul/speedMul 折叠、enemyPool 过滤（每节点生效波 ≥3 类型）、bossVariant 覆盖、返回 chapterId
- [x] 确定性：无新 RNG 调用，`${seed}:wave:${index}` 顺序不变
- [x] `node --test tests/nodes.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/shared/chapters.js`（新）、`public/js/shared/waves.js`，零第三方依赖
- [x] 回归测试：chapterForWave 区间、chapters=false 字节一致、true 主题折叠/池过滤/首领覆盖/确定性
- [x] 新文件 `chapters.js` 登记 `scripts/test-changed.mjs` 的 TEST_MAP；`npm test` 全绿
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/shared/chapters.js` (new)
- `public/js/shared/waves.js`
- `scripts/test-changed.mjs`
- `tests/nodes.test.mjs` (new)
- `tasks/feat-chapters-table.md`

## Notes

立案 2026-11-04，源自 `docs/PHASE_CHAPTERS.md` §6（阶段 0）+ `docs/TODO.md` TODO-15。依赖 DOCS-005（depends_on）。阶段 1（waves 接线已是本任务、服务端 presence-gate、replay 版本）依赖本任务落地后拆。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

实现 2026-11-04：落 `public/js/shared/chapters.js`（`CHAPTERS` 6 节点表 + `chapterForWave` 区间反查 + `normalizeTheme` 归一化 + `BASELINE_ENEMIES` 基线填充），`generateWave` 加 `{ chapters }` 默认 false 开关（theme hpMul/speedMul 折叠进既有乘点、敌人池过滤到基线∪主题、bossVariant 覆盖且最终波仍 berserk、返回 chapterId），`chapters.js` 登记 `scripts/test-changed.mjs` TEST_MAP，新增 `tests/nodes.test.mjs` 9 例。验证：acceptance `node --test tests/nodes.test.mjs` exit 0、`npm test` 2002 例全绿。

该轴仍暗,理由:本任务为共享契约层，无新玩法文档面，L_D/L_G/L_S 无需量化。