---
id: gap-feel-capture-scenarios
title: 打击感证据采集：时间断言 + 事件触发帧与全档位场景
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/visual-check.test.mjs
goal_ac: AC-020
---
## Proposal

FEEL-001（4/10，不通过）列出的证据缺口（E.1–E.7）全部卡在同一个地方：`tests/visual-scenes.mjs` 只会按固定 `t=2/4.5/8s` 抓 combat 的三帧，无法产出「八种武器各自开火」「暴击/击杀/首领命中/破盾」「飘字三档」「reduced-motion」「自动档/low 画质」这些场景；而且 after 采集已经出现时间漂移——移动端请求 t=8s/4.5s/2s，实际采到 12s/8s/8s，导致移动帧不能作为同 t 对照。

本任务只改采集器与它的测试，不改渲染、不改模拟数值、不消耗战斗 RNG。

## Plan

1. 在 manifest 的每一帧记录 `requestedTime` 与 `snapshot.time`；两者不一致时采集器非零退出，不产出可被当成对照的帧。
2. 增加 `--scenario` 支持（可与 `--scene/--quality/--viewport` 组合）：
   - `weapons`：8 种塔在同一 seed 下各自开火，每塔产出一组帧并在 manifest 标注 `towerType`；
   - 事件触发：`crit` / `kill` / `boss` / `shield` / `leak` / `waveclear` / `bossdeath`，各产出事件前后 0–500ms 的帧序列；
   - `floaters-all` / `floaters-key` / `floaters-off`：三档飘字，同 seed 同 t 各一帧；
   - `reduced-motion-on` / `reduced-motion-off`：同一事件各一帧；
   - `quality-auto` / `quality-low` / `quality-high`：同 seed 各一帧。
3. 事件触发用确定性的场景注入（固定 seed、固定步长），注入不得调用 `Math.random`；同一 seed 两次采集的帧指纹必须一致。
4. 所有 scenario 写进 manifest（`scenario`、`seed`、`commit`、`frames[]`），采集目录结构保持 `contact-sheet.png` + `manifest.json`。

## AC

- [ ] `node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/feel-time-check` 后，`manifest.json` 三个 combat 帧的 `snapshot.time` 分别等于 8 / 4.5 / 2；人为制造漂移时采集器 exit≠0
- [ ] `--scenario weapons` 产出 8 组帧，manifest 中每组都有 `towerType`，且 8 个 towerType 互不相同
- [ ] crit / kill / boss / shield / leak / waveclear / bossdeath 七个 scenario 各自产出事件前后帧序列（每个至少 2 帧）
- [ ] floaters-all / floaters-key / floaters-off 三档同 seed 同 t 各产出一帧
- [ ] reduced-motion-on / reduced-motion-off 各产出一帧
- [ ] quality-auto / quality-low / quality-high 各产出一帧，manifest 记录实际画质档
- [ ] `node --test tests/visual-check.test.mjs` 全绿
- [ ] 同一 seed 连续两次采集的对应帧指纹一致（测试断言）

## DoD

- [ ] 新增 scenario 全部有测试覆盖，且采集过程不调用战斗 RNG
- [ ] `npm test` 全绿
- [ ] 采集器在漂移时不产出「看似可用」的帧，失败信息写明 requested vs actual time

## Touches

- `tests/visual-scenes.mjs`
- `tests/visual-check.test.mjs`
- `tasks/gap-feel-capture-scenarios.md`

## Notes

这是其余证据任务的前置：本任务不评判画面，只保证「能按需、可按时间断言地取到帧」。⛔ 不要在本任务里改 `public/js/**`。
