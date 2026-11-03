---
id: fix-victory-final-wave-not-recorded
title: 通关无法记录：最终波（30）清波未同步服务端，waveReached 被钳到 29
status: done
labels:
  - fix
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/scoring.test.mjs tests/run-lifecycle.test.mjs
---
## Proposal

玩家永远通关不了、记录只记到 29 关。根因链路：`public/js/sim/wave-director.js:203` 的 `completeWave` 清第 30 波时，`cleared >= MAX_WAVE` 直接 `this.sim.gameOver(true)` 并 `return`，**跳过了末尾的 `onWaveClear` 回调**；而 `public/js/app/combat.js` 的 `handleWaveClear`（`onWaveClear` 回调）才是真正调 `api.clearWave(id, wave)` 同步服务端清波的地方。于是第 30 波从不 `clearWave(30)`，服务端 `run.clearedWaves` 停在 29；`handleGameOver` 里 `api.finishRun(id, { waveReached: stats.clearedWave=30 })` 到服务端 `settleRunOutcome` 时，`clampFinishPayload(body, run.clearedWaves=29)` 把 `waveReached` 钳到 `min(30, 29)=29`（`public/js/shared/scoring.js:220`），`isVictory(29)` 为 false → 永不通关、记录 29。修法：`handleGameOver` 里 `finishRun` 之前，若 `stats.victory` 先补一次 `api.clearWave(state.run.id, stats.clearedWave)`，把最终波同步上去再结算（`stats.clearedWave` 在 victory 时是 `finalWave=MAX_WAVE=30`，见 `sim.js:389-390`）。

## AC

- [x] 通关第 30 波时，服务端 `clearedWaves` 同步到 30（`clearWave(30)` 被调用）
- [x] `finishRun` 的 `waveReached=30` 不被钳到 29，`victory=true`、记录显示 30 关
- [x] 非通关（死亡/放弃）路径不受影响（不误同步最终波）
- [x] `node --test tests/scoring.test.mjs tests/run-lifecycle.test.mjs` exit 0

## DoD

- [x] 落地于 `public/js/app/combat.js`（`handleGameOver` 补最终波清波同步），不引入第三方依赖
- [x] 回归测试覆盖「最终波清波 → victory 结算 waveReached=30」与「非通关不误同步」
- [x] `npm test` 全绿；补跑 `node --test tests/scoring.test.mjs tests/run-lifecycle.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/js/app/combat.js`
- `tests/run-lifecycle.test.mjs`
- `tasks/fix-victory-final-wave-not-recorded.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-17（用户报告「永远通关不了、记录只到 29」）。这是 P0 体验硬伤——玩家打到第 30 波却永远拿不到胜利结算。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为结算链路 bug 修复，无新文档面，L_D/L_G/L_S 无需量化。
