---
id: gap-feel-capture-scenarios
title: 打击感证据采集：时间断言 + 事件触发帧与全档位场景
status: done
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

- [x] `node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/feel-time-check` 后，`manifest.json` 三个 combat 帧的 `snapshot.time` 分别等于 8 / 4.5 / 2；人为制造漂移时采集器 exit≠0
- [x] `--scenario weapons` 产出 8 组帧，manifest 中每组都有 `towerType`，且 8 个 towerType 互不相同
- [x] crit / kill / boss / shield / leak / waveclear / bossdeath 七个 scenario 各自产出事件前后帧序列（每个至少 2 帧）
- [x] floaters-all / floaters-key / floaters-off 三档同 seed 同 t 各产出一帧
- [x] reduced-motion-on / reduced-motion-off 各产出一帧
- [x] quality-auto / quality-low / quality-high 各产出一帧，manifest 记录实际画质档
- [x] `node --test tests/visual-check.test.mjs` 全绿
- [x] 同一 seed 连续两次采集的对应帧指纹一致（测试断言）

## DoD

- [x] 新增 scenario 全部有测试覆盖，且采集过程不调用战斗 RNG
- [x] `npm test` 全绿
- [x] 采集器在漂移时不产出「看似可用」的帧，失败信息写明 requested vs actual time

## Touches

- `tests/visual-scenes.mjs`
- `tests/visual-check.test.mjs`
- `tests/visual-scenarios.mjs`
- `tasks/gap-feel-capture-scenarios.md`

## Notes

这是其余证据任务的前置：本任务不评判画面，只保证「能按需、可按时间断言地取到帧」。⛔ 不要在本任务里改 `public/js/**`。

### 实现增量（2026-10-28）

**帧时间断言**

- combat 三帧改为固定时刻精确步进：t=2 / 4.5 / 8s（120 / 270 / 480 步，1/60 步长）。旧的「等到条件满足」在移动端会漂到 6/8/12s。
- 每帧 manifest 记录 `requestedTime` 与 `snapshot.time`；`checkFrameTimes()` 容差 0.005s。
- 漂移：CLI **exit 3**，只写一份 `{ok:false,error:"time-drift",drifts[]}` 的 manifest，**不写任何 PNG / contact sheet**；信息写明「请求 t=Xs，实际 t=Ys」。验收钩子 `--drift-test` 让 combat 首帧多走 30 步，可复现 exit 3（实测只留 manifest.json）。
- manifest 的 combat `frames[]` 按**对照顺序** impact(8s) → mixed(4.5s) → contact(2s)，所以三帧 `snapshot.time` 依次是 8 / 4.5 / 2；contact sheet 保持时间顺序，方便人看。

**场景（`--scenario`）**

- 目录：`weapons` / `crit,kill,boss,shield,leak,waveclear,bossdeath` / `floaters-all,key,off` / `reduced-motion-on,off` / `quality-auto,low,high`。可与 `--scene/--quality/--viewport` 组合；只点名 `--scenario` 时不再顺带跑五个基础场景。
- 计划是纯数据（`tests/visual-scenarios.mjs` 的 `scenarioPlan()`）：每组 `setup` 动作 + 每帧 `steps`（`{sim:n}` 模拟步 / `{visual:ms}` 视觉推进 / 带 `type` 的注入动作），`requestedTime` 由 `planGroupFrames()` 组内累加。采集前先跑 `validateScenarioPlans()` 自检，计划不成立就不启动浏览器。
- 事件场景：事件前 t=1s → 事件后 0 / 250 / 500ms 共 4 帧。清波后 `sim.phase` 离开 wave、模拟时钟停表，后续帧改用**视觉时钟**、`requestedTime` 保持不变（漂移断言因此同样生效）。
- weapons：8 种塔（`Object.keys(TOWERS)`）各一组 6 帧（t=0.5…3.0s，0.5s 步长），四只静止重甲敌人提供靶子。战旗塔 `support:true` 不攻击，组内同时放一座弩塔（光环 + 被增益后开火），manifest 如实标注，不伪造弹道。
- 每组另记逐步累计的 `trace`（特效 kind、`kind:weapon` 归属、弹道/特效/飘字峰值）：特效 ttl 只有 0.1–0.25s，固定时刻采样会漏掉命中瞬间，`weaponSignatures`（如 `spark:arrow`、`ring:cannon`、`bolt:arc`）才是「这把武器确实打过」的机械证据。
- 实测 `--scenario all --out /tmp/feel-scenarios`：16 个场景 / 84 帧，约 20s。

**确定性 / 不消耗战斗 RNG**

- 注入只走确定性入口：`sim.damage()`（不经 `computeHit`，因此不消耗 `combatRng`）、`sim.leak()`、`sim.completeWave()`、`sim.spawnEnemy()`、`sim.placeTower()`；注入代码本身不调用 `Math.random`（单测用 `/Math\.random\s*\(/` 对运行时源码做断言）。
- 每组 reset 时按 seed 重播 `Math.random`（毒雾粒子等模拟侧随机消费因此逐次一致）并重建 `combatRng`；combat 场景接管时钟时同样重播。
- 实测 `--repeat 2`：combat + crit + weapons + floaters-key + quality-auto + reduced-motion-off 共 61 帧逐帧 `pixelHash` 完全一致（`determinism.json` 全部 `exact:true`）。
- 边界：weapons/quality 组里塔正常开火，模拟自身的 `combatRng` 按固定种子消费——那是「同 seed 两次一致」的被验证对象，不是注入引入的随机。

**画质**

- `--quality auto` 走与首次进入同一条 `loadSettings → applyAutoQuality` 路径；显式档位现在标 `qualityMode:'manual'`（否则 `loadSettings` 会把 `--quality low` 再按设备解析成 high——旧的采集器实际有这个缺陷）。
- manifest 记录 `quality`（请求）与 `qualityActual`（`detectPreset` 实测档）+ 帧内 `snapshot.quality{actual,fps,dpr,decorations,floaters,glow,shake}`。实测：auto@desktop → high，auto@mobile-landscape（触控）→ low，low → low，high → high。
- 飘字档位覆盖会让 `qualityActual` 记为 `custom`（不匹配任何预设），`floaters` 字段如实记录 all/key/off。

**manifest 结构**

- `manifest.scenarios[]`：`scenario / scene / seed / commit / viewport / quality / qualityActual / floaters / reducedMotion / description / notes / elapsedMs / groups[] / frames[]`；采集目录仍是 `contact-sheet.png` + `contact-sheet.html` + `manifest.json`（成功时 `ok:true`）。
- `groups[]`：`key / towerType / support / event / frameIds / fired / weaponSignatures / effectKinds / effectSignatures / culminations / 峰值`。
- `frames[]`：`id / group / towerType / role / event / offsetMs / requestedTime / timeDriven(sim|visual) / visualMs / file / 指纹 / snapshot`。

**已知边界**

- 场景帧不套用镜头震屏（`composeCameraTransform` 由 GameApp 时钟驱动）；静止帧本来就判不了运动分量。reduced-motion 的对比用高潮演出层（扩散环 vs 静态边框 + 横幅），这正是需要证明的「非运动层保留」：实测同事件 +250ms 两帧像素差异 59.5%。
