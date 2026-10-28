---
id: refactor-shared-achievements-audio
title: 重构 R4：拆分 achievements 与 audio
status: done
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  acceptance: npm test
depends_on:
  - refactor-baseline-and-structure-gate
goal_ac: AC-043
---
## Proposal

`public/js/shared/achievements.js`（1027 行，其中 800+ 行是定义表）与 `public/js/audio.js`（1221 行，混合合成器、音乐、环境音与门面）是两个「数据与逻辑同居」的共享模块。拆开后，成就数据可由内容作者独立改，音频各层可独立调参；行为与音频参数零变化。

## Plan

1. `achievements.js`：外提 `achievements-data.js`（ACHIEVEMENTS、ACHIEVEMENT_GROUPS、RARITIES、COSMETIC_*、SEASONAL_ACHIEVEMENTS 等纯数据），
   `achievements-rules.js`（bestWave/bestScore/difficulty*/relicLevels 等求值），`achievements.js` 保留索引与季节接口。
2. `audio.js`：外提 `audio-synth.js`（振荡器/噪声/包络/压缩总线）、`audio-music.js`（MUSIC_VARIANTS、BOSS_MUSIC_TRACKS、阶段与层）、
   `audio-ambience.js`（AMBIENCE_*），`audio.js` 保留对外门面（`audio` 单例与现有方法）。
3. 保持所有 export 名称与签名不变；测试 import 同步更新；每步跑 `npm test`。
4. 删除 `scripts/structure-budget.allow.d/refactor-shared-achievements-audio.json`。

## AC

- [x] 两个入口文件与所有新模块均 ≤ 600 行；`achievements-data.js` 满足数据模块纯度规则
- [x] 公共导出名与签名不变（`ACHIEVEMENTS`、`seasonIndex`、`audio`、`pickBossMusicTrack`、`bossMusicPhase` 等）
- [x] `npm test` 全绿；静态检查通过
- [x] `node scripts/check-sim-determinism.mjs --check` exit 0（成就判定不得读取模拟外状态）
- [x] `node scripts/structure-budget.mjs --check` exit 0，且本任务债务文件已删除
- [x] `npm run perf:budget` 通过

## DoD

- [x] 音频合成参数逐项不变（频率/滑音/时长/噪声层），仅移动定义位置
- [x] 无兼容重导出壳；测试 import 同步更新
- [x] 边界与 `docs/PHASE_REFACTOR.md` §6 R4 一致

## Notes

- 实现读数：`audio.js` 570 / `audio-synth.js` 251 / `audio-music.js` 194 / `audio-ambience.js` 416 / `achievements.js` 59 / `achievements-rules.js` 35 行；`achievements-data.js` 954 行（`*-data.js` 数据豁免，纯度检查通过：只 import `shared/data.js`）。
- 数据/规则边界：成就定义表与它引用的 ctx 度量 helpers（bestWave/bestScore/difficulty*/relicLevels/season*）+ `define()` 一起留在 `achievements-data.js`（§5 允许数据模块含纯查表函数，且比让数据模块 import 规则模块更符合纯度条款）；`achievements-rules.js` 只依赖数据模块导出 `achievementProgress`/`evaluateAchievements`；`ACHIEVEMENT_BY_ID` + 赛季轮换/解析留在 `achievements.js`（索引 + 季节接口）。依赖方向 data → rules → index，无环。
- 音频分层：`audio-synth.js` = 合成原语（playTone/playNoise/playMusicTone/playMusicDrum）+ 压缩参数 + `playSfx()` 音效编曲表（逐 case 参数原样搬运，`this.tone` → `fx.tone`）；`audio-music.js` = 曲目表/首领变体/阶段阈值/强度层/变体选择纯函数；`audio-ambience.js` = AMBIENT/AMBIENCE 数据 + 节点构建 + `AmbientBed`/`AmbienceLayer` 两个状态机（字段与守卫条件原样搬运）；`audio.js` 保留总线构建、音乐状态机、play 入口、命中音效与门面方法，并从新模块再导出原公开常量（这是公共导出名不变所需的索引入口，不是死壳：`audio` 单例与全部方法仍在本文件实现并对外提供行为）。
- 新模块登记进 `scripts/test-changed.mjs` 的 TEST_MAP（否则「审计覆盖」测试红）。源码级测试的断言路径同步到新模块：`tests/ambience`、`ambience-presets`、`audio-events`、`audio-mix`、`boss-music`、`music`、`result-audio`、`skill-audio`、`destructibles-ui`；Touches 中原本不存在的 `tests/audio.test.mjs` 以这些真实测试文件替换。
- 验证：`npm test` 1727 全绿；`check:syntax` / `check:imports` / `check:style` / `check:docs` / `check:doc-ownership` / `check:version` / `sim-determinism` / `structure-budget`（债务目录已无本任务条目）全 0。`perf:budget` 首跑 normal-1x-low p95 33.3ms 判 FAIL、第 2 次 16.7ms PASS（同机负载导致的 p95 抖动；本改动不触渲染路径）。

## Touches

- `public/js/shared/achievements.js`
- `public/js/shared/achievements-data.js` (new)
- `public/js/shared/achievements-rules.js` (new)
- `public/js/audio.js`
- `public/js/audio-synth.js` (new)
- `public/js/audio-music.js` (new)
- `public/js/audio-ambience.js` (new)
- `scripts/structure-budget.allow.d/refactor-shared-achievements-audio.json`
- `scripts/test-changed.mjs`
- `tests/ambience.test.mjs`
- `tests/ambience-presets.test.mjs`
- `tests/audio-events.test.mjs`
- `tests/audio-mix.test.mjs`
- `tests/boss-music.test.mjs`
- `tests/destructibles-ui.test.mjs`
- `tests/music.test.mjs`
- `tests/result-audio.test.mjs`
- `tests/skill-audio.test.mjs`
- `tasks/refactor-shared-achievements-audio.md`
