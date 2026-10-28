---
id: refactor-shared-achievements-audio
title: 重构 R4：拆分 achievements 与 audio
status: todo
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

- [ ] 两个入口文件与所有新模块均 ≤ 600 行；`achievements-data.js` 满足数据模块纯度规则
- [ ] 公共导出名与签名不变（`ACHIEVEMENTS`、`seasonIndex`、`audio`、`pickBossMusicTrack`、`bossMusicPhase` 等）
- [ ] `npm test` 全绿；静态检查通过
- [ ] `node scripts/check-sim-determinism.mjs --check` exit 0（成就判定不得读取模拟外状态）
- [ ] `node scripts/structure-budget.mjs --check` exit 0，且本任务债务文件已删除
- [ ] `npm run perf:budget` 通过

## DoD

- [ ] 音频合成参数逐项不变（频率/滑音/时长/噪声层），仅移动定义位置
- [ ] 无兼容重导出壳；测试 import 同步更新
- [ ] 边界与 `docs/PHASE_REFACTOR.md` §6 R4 一致

## Touches

- `public/js/shared/achievements.js`
- `public/js/shared/achievements-data.js` (new)
- `public/js/shared/achievements-rules.js` (new)
- `public/js/audio.js`
- `public/js/audio-synth.js` (new)
- `public/js/audio-music.js` (new)
- `public/js/audio-ambience.js` (new)
- `scripts/structure-budget.allow.d/refactor-shared-achievements-audio.json`
- `tests/audio.test.mjs`
- `tasks/refactor-shared-achievements-audio.md`
