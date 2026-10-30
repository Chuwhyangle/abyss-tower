---
id: gap-ac-051-sprite-i18n-coverage
title: 敌人覆盖门禁：wraith/golem i18n 双语键 + 精灵图集重建 + sprite-coverage 计数更新（AC-051）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac-050-enemies-expand
goal_ac: AC-051
---
## Proposal

AC-051（GOAL-010「新敌人精灵/渲染/i18n 覆盖通过既有门禁」）criterion 逐字为 `grep -q 'data.enemy.wraith.name' public/js/shared/i18n/zh-CN.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/zh-CN.js`，expect `exit 0`。当前 exit 1：zh-CN.js 只有 12 类敌人名键（grunt/runner/swarm/tank/flyer/healer/boss/shielder/splitter/splitling/herald/caster），无 wraith/golem。

「既有门禁」不止这条 grep，另有两处会在 wraith/golem 进数据表后自动打红，都在本任务的覆盖范围内：
- `tests/i18n-coverage.test.mjs` D 数据层零缺译：按 `Object.keys(ENEMIES)` 自动枚举 `data.enemy.<id>.name`（:613），敌人进表后缺键即红；
- `tests/sprite-coverage.test.mjs`：覆盖集与数据表严格相等，硬编码「12 敌人」与「总数 55 个实体」（:97/:113），并要求图集里每个实体 ≥2 状态帧且像素哈希互异；wraith/golem 进表后须重建图集并把计数改到 14/57。

<!-- dedup-ref --> 机制去重与边界：`gap-ac-050-enemies-expand`（ready，`goal_ac: AC-050`）拥有敌人内容 lane（enemies.js/waves.js/sim/enemy-system.js/render 内容与行为）；本任务拥有覆盖门禁 lane（i18n 双语键 + 精灵图集重建 + sprite-coverage 计数更新），两者机制不同、`goal_ac` 单值标量不可折叠，故独立立案。本任务以顶层 `depends_on` 依赖 AC-050 先落地——i18n 键与图集帧都引用 ENEMIES 里才存在的敌人条目。i18n 两文件（zh-CN.js/en-US.js）同时被 AC-055/056/063/064 等在飞任务 Touches 声明，属该文件的常规共享，调度器按 Touches 串行、本任务又在 AC-050 之后，无并发编辑冲突。

## Plan

1. 核验 AC-050 落地后 `public/js/shared/data/enemies.js` 含 wraith/golem；在 zh-CN.js 与 en-US.js 成对补 `data.enemy.wraith.name`（相位幽魂）与 `data.enemy.golem.name`（岩石魔像）。若 AC-050 已加键，则只核验存在与双语成对、不重复堆键。英文名须避开 en-US.js 里 `data.enemy.grunt.name` 已占用的 "Wraith"（可译 Phase Wraith / Specter 之类）。
2. 重建精灵图集与清单：`node scripts/build-entity-sprites.mjs`（按 ENEMIES 的 color/shape 程序化生成两实体 move+hit 帧），提交 `entity-atlas@1x/@2x.png`、`entity-atlas.json`、`manifest.json`。
3. 更新 `tests/sprite-coverage.test.mjs` 硬编码计数：标题「12 敌人」→「14 敌人」、`:113`「总数 55 个实体」→「57」。
4. 跑覆盖门禁与全量：`node --test tests/sprite-coverage.test.mjs`、`node --test tests/i18n-coverage.test.mjs`、`npm test`，读数写进 Notes。

## AC

- [x] `grep -q 'data.enemy.wraith.name' public/js/shared/i18n/zh-CN.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/zh-CN.js` exit 0（AC-051 本体判据）
- [x] `grep -q 'data.enemy.wraith.name' public/js/shared/i18n/en-US.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/en-US.js` exit 0（双语成对、无裸键）
- [x] `node --test tests/sprite-coverage.test.mjs` exit 0（覆盖集 57 实体、wraith/golem 各 ≥2 状态帧且像素哈希互异、无 missing/extra）
- [x] `node --test tests/i18n-coverage.test.mjs` exit 0（D 数据层零缺译、无硬编码中文回退）
- [x] `npm test` exit 0

## DoD

- [x] 图集重建后 enemy.wraith / enemy.golem 的 move+hit 帧真实存在于 entity-atlas.json 且像素哈希互异——靠重建图集 + 更新计数达标，不是删断言/放宽计数
- [x] wraith/golem 的 i18n 中英键成对、无裸键、无英文界面落中文回退；i18n-coverage 门禁绿
- [x] 本任务 diff 只含 Touches 列出的文件；无产品数值/玩法/波次改动（归 AC-050 / AC-052）

## Notes

依赖 `gap-ac-050-enemies-expand`（done）的 commit `72759d4 feat(enemies): 新增相位幽魂与岩石魔像至 14 类并接入波次/渲染/i18n` 已把本任务覆盖门禁 lane 的全部工作一并落地：zh-CN.js/en-US.js 双语键、entity-atlas 重建（wraith/golem move+hit 帧）、sprite-coverage 计数改到 14/57。本任务在 develop 基线（7675f64）上核验为零增量：AC 逐条复验全绿，无需再改代码，DoD「diff 只含 Touches」由零代码改动满足。

核验读数（worktree @ develop 7675f64）：
- AC1/AC2 grep：zh-CN.js 含 `data.enemy.wraith.name`(`相位幽魂`)/`data.enemy.golem.name`(`岩石魔像`)，en-US.js 含 `Phase Wraith`/`Rock Golem`，exit 0
- AC3 `node --test tests/sprite-coverage.test.mjs`：13 pass 0 fail（覆盖集 57 实体、wraith/golem 各 ≥2 状态帧且像素哈希互异、无 missing/extra）
- AC4 `node --test tests/i18n-coverage.test.mjs`：19 pass 0 fail（D 数据层零缺译）
- AC5 `npm test`：1778 pass 0 fail

## Touches

- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `public/assets/sprites/entities/entity-atlas.json`
- `public/assets/sprites/entities/entity-atlas@1x.png`
- `public/assets/sprites/entities/entity-atlas@2x.png`
- `public/assets/sprites/manifest.json`
- `tests/sprite-coverage.test.mjs`
- `tasks/gap-ac-051-sprite-i18n-coverage.md`
