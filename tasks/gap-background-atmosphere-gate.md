---
id: gap-background-atmosphere-gate
title: 背景与氛围机械闸：让 art 套件见证氛围层与分带层次，并证明它会变红
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/visual-check.mjs --suite art
depends_on:
  - VIS-001
goal_ac: AC-024
---
## Proposal

GOAL-006 退出条件要求「背景与氛围的机械视觉检查通过」，AC-024 以 `node scripts/visual-check.mjs --suite art` 见证。今天这条 criterion 在 main 上不是失败、而是**无法成立**：证据逐字为 `criterion-capability-unevaluable: uncertifiable-executed-artifact: scripts/visual-check.mjs (does not resolve under the criterion's cwd, so its capability cannot be established …)`。

**已有什么（实测，2026-10-27，分支 c6e233d，Chrome，1440×900，quality high）**：视觉验收基建已交付 `--suite art`，在真实采集上通过：

| 指标 | 实测 | 阈值 |
| --- | --- | --- |
| 单位与背景 ΔE | 18.20 | ≥ 12 |
| 防御塔与背景 ΔE | 25.29 | ≥ 10 |
| 剪影像素覆盖 | 0.60 | ≥ 0.32 |
| 背景亮度层次数 | 15 | ≥ 6 |
| 背景亮度跨度 | 10.70 | ≥ 8 |

并实测确认剪影指标**不是**被背景纹理刷出来的：同一组敌人包围盒在纯背景图上得 0.0000（真实帧 0.5989）。所以本任务不重做已经成立的单位可读性度量，也不重写采集器。

**缺什么（本任务的增量，均有实测依据）**：

1. **五项里没有一项见证「氛围层」——而且实测证明它不会红。** 天气粒子、生物群系道具、氛围光点都烘焙在 `BackgroundRenderer.build()` 内（`public/js/render/background-renderer.js:410-445`），受 `decorations` 档位控制（`weatherParticleBudget`：off=0 / light≈40% / full=上限）。我在探针 worktree 里把 `drawWeather()` 首行改成 `return`（整层天气粒子消失）后重跑，art 套件仍然 **PASS**：层次 15→14、跨度 10.70→10.69，其余不变，全部高于阈值。也就是说，「雾/余烬/光池等氛围层」（GOAL-006 明列）在机械层**没有任何见证**，删掉它闸门也不会响。
2. **「背景层次」只是一个全图亮度桶数。** 远景/雾霭/地面/装饰/粒子五层由 `BACKGROUND_LAYERS`（`background-renderer.js:11`）声明，却没有任何分带结构检查：画面塌成上中下三段同亮度时，全图桶数仍可能达标。
3. **没有任何「真实渲染回归会让 art 变红」的证明。** `INJECTIONS` 只有 `no-feedback` / `effects-invisible`（表现层注入，服务 feel 套件）；art 的失败证明只有 `evaluateArt({ ...GOOD_ART, backgroundLevels: 2 })` 这类合成对象单测。闸门既是选手又是裁判——没红过的闸门不算闸门。
4. **阈值是魔数、且可被悄悄放宽。** `THRESHOLDS.art` 五个值没有任何文档依据，也没有守卫；AC-024 的见证可以靠一次 12→2 的改动满足。

<!-- dedup-ref -->
去重与分工：本任务与 VIS-001（AC-018）不重复——VIS-001 的验收面是「套件能跑、能输出每项指标」（`node --test tests/visual-check.test.mjs`、采集可用），本任务的验收面是 AC-024 本身：art 这一支成为背景与氛围的**可信**见证（分带层次、氛围层贡献、三档真实失败注入、阈值文档化）。因此 `depends_on: [VIS-001]`，复用其 `tests/visual-scenes.mjs` 采集与 `scripts/lib/visual-metrics.mjs` 判定框架，不新建脚本体、不重写采集器。与 ART-001（AC-021）的交集仅在阈值依据的来源，不改其文档、令牌与 manifest 规范。与 AC-029（语义评审记录）的正交边界：本任务只管机械层，不产出 `docs/ART_REVIEW.md` 的评审结论。

## Plan

1. **采集侧（`tests/visual-scenes.mjs`，只加能力、不改默认输出）**
   - `capture()` 增加 `decorations: 'off' | 'light' | 'full'` 选项（默认 `full`），在建立背景前作用于渲染器设置；同一场景可按三档各采一次。
   - `payload` 增加 `seed` 与 `mapMeta`（供 Node 侧用 `weatherLayer(mapMeta, seed, decorations)` 这个纯函数推出期望的 `weather` / `phase` / 期望粒子数，报告里写明「期望 rain/fog/meteor 与粒子预算」）。
   - 新增三个注入，全部沿用既有 `window.__visual.setInjection` 机制，实现只存在于本测试 shim，**不改产品代码的默认渲染路径**：
     - `units-hidden`：渲染前把 `app.renderer.enemies.render` 换成空函数，采完复原——用来证明剪影与单位 ΔE 真的在量单位；
     - `flat-background`：把 `app.renderer.bg` 整张填成单一色；
     - `decor-noop`：让「full 档」的背景烘焙实际按 `off` 档执行（氛围层贡献归零）。
2. **判定侧（`scripts/lib/visual-metrics.mjs`）**
   - `bandStats(image, rect, bands)`：上/中/下三段（按 `payload.canvas` 等比切分）各自的 `levels` / `stdLuma`，用于「分带层次」。
   - `decorationDelta(fullImage, offImage, rect)`：氛围层贡献 = 两张背景烘焙的像素差异占比（ΔE > 阈值的像素占比）；`decorationMonotonic(off, light, full)` 断言 off ≤ light ≤ full。
   - `evaluateArt` 增加三项：`background-bands`（每带 levels ≥ 阈值）、`atmosphere-contribution`（full vs off ≥ 阈值）、`decor-monotonic`；原五项保留不变。
   - 新阈值写进 `THRESHOLDS.art`，**先实测再定值**：取真实读数留出可解释余量，且必须满足「注入对应回归时跌破」。不得为了转绿下调任何已有阈值。
3. **CLI（`scripts/visual-check.mjs`）**
   - `--suite art` 一次采集三档（full / light / off）并计算 8 项；`--json` 输出稳定 schema `{ suite, ok, checks: [{ id, name, value, threshold, ok, detail }] }`。
   - `--inject` 白名单加入 `units-hidden | flat-background | decor-noop`，与既有 feel 注入并列；注入只影响它该影响的指标。
   - 退出码：判定不通过 1；采集/解码/环境异常 2（有明确报错，不静默通过）。
4. **文档（`docs/TECH_DESIGN.md` 新增 §8.6「机械视觉验收（art 套件）」）**
   - 8 项指标表：id / 中文名 / 阈值 / 含义 / 失败模式 / 依据（GOAL-006 退出条件与实测余量）。
   - 一次真实读数：日期、commit、8 项实测值与余量。
   - 约定一句话：**改阈值必须同时改本节**，否则单测变红（见下条）。
5. **单测（`tests/visual-check.test.mjs`）**
   - 解析 §8.6 指标表并与 `THRESHOLDS.art` 逐项比对，任一处放宽即红；
   - `bandStats` / `decorationDelta` / `decorationMonotonic` 的边界（空带、单色图、全同图）；
   - `evaluateArt` 对三项新指标的红/绿；
   - 注入 → 预期红灯的映射表（`units-hidden` → silhouette 与 unit-background；`flat-background` → 层次/跨度/分带；`decor-noop` → atmosphere-contribution）。
6. **真实复跑**：三种注入在真实 Chrome + 测试服务器下各跑一次，红/绿归属与 AC 一致；无注入连跑两次，8 项数值一致。
7. **若某项真实未达标**：先修 `background-renderer.js` 的氛围层（保持 `decorExclusion` 对路径与塔位的保护），不得以调阈值代替；修完重采，三种注入仍必须红。若不改渲染器则该文件不出现在 diff 里。

## AC

- [ ] `node scripts/visual-check.mjs --suite art` exit 0，报告逐项打印 8 项（单位 ΔE / 塔 ΔE / 剪影 / 层次 / 跨度 / 分带层次 / 氛围层贡献 / 装饰档位单调）与对应阈值
- [ ] `node scripts/visual-check.mjs --suite art --inject units-hidden --json` exit 1，且 `silhouette` 与 `unit-background` 为 false，`background-levels`、`background-spread`、`atmosphere-contribution` 仍为 true
- [ ] `node scripts/visual-check.mjs --suite art --inject flat-background --json` exit 1，且 `background-levels`、`background-spread`、`background-bands` 为 false
- [ ] `node scripts/visual-check.mjs --suite art --inject decor-noop --json` exit 1，且 `atmosphere-contribution` 为 false，`background-levels`、`background-spread`、`background-bands` 仍为 true
- [ ] 同 HEAD 连跑两次 `node scripts/visual-check.mjs --suite art --json`，8 项 `value` 完全相等（按报告精度）
- [ ] `node --test tests/visual-check.test.mjs` exit 0，且包含「`THRESHOLDS.art` 与 `docs/TECH_DESIGN.md` §8.6 表格逐项一致」用例
- [ ] `npm test` exit 0；`npm run check:syntax`、`npm run check:style`、`npm run check:imports`、`npm run check:docs` 均 exit 0

## DoD

- [ ] 三种注入在真实浏览器下复跑，红/绿归属符合 AC（命令 + 输出摘要写入本任务 Notes）
- [ ] `docs/TECH_DESIGN.md` §8.6 落盘：8 项阈值表 + 一次真实读数（日期 / commit / 实测值 / 余量）
- [ ] 阈值守卫实证：临时把 `THRESHOLDS.art` 任一项改低 → `node --test tests/visual-check.test.mjs` 变红；还原后全绿（两次命令与结果写入 Notes）
- [ ] 人工可复核：一次真实采集的背景图/contact sheet 落盘，肉眼可见天气粒子、氛围光点与地形层次（临时路径 + 采集命令记录在 Notes，图不入库）
- [ ] 若某项真实读数未达标：修正氛围层后重采，记录前后两组读数；不得以调低阈值收口
- [ ] 产品默认画面不变：`tests/render-visuals.test.mjs`、`tests/biome-visuals.test.mjs`、`tests/weather-visuals.test.mjs` 全绿

## Touches

- `scripts/visual-check.mjs`
- `scripts/lib/visual-metrics.mjs`
- `tests/visual-scenes.mjs`
- `tests/visual-check.test.mjs`
- `public/js/render/background-renderer.js`
- `docs/TECH_DESIGN.md`
- `tasks/gap-background-atmosphere-gate.md`

## Notes

- 探针实测（2026-10-27）：在分支 c6e233d 的临时 worktree 上，把 `drawWeather()` 首行改为 `return` 后，art 套件仍 `PASS`（层次 14、跨度 10.69）——这是本任务存在的最硬依据：今天的闸门无法发现氛围层被整体删除。
- 剪影指标的对照读数：纯背景图 0.0000 / 真实帧 0.5989，说明局部采样法本身是有效的，**不要**改成对背景图的整图差分（背景画布是 1056×576，帧是 1440×900，尺度不同，会引入重采样误差）。
- 注入全部落在测试 shim；`ART-001` 与精灵管线任务都要求「默认画面看起来没变」，因此不得为通过检查改动默认渲染输出。
- 若最终需要新增 `scripts/` 源文件（本 Plan 预期不需要），必须同步 `scripts/test-changed.mjs` 的 `TEST_MAP` 并把该文件加进 Touches。
