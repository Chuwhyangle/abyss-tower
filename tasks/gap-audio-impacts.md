---
id: gap-audio-impacts
title: 八种武器命中音效：可区分音色、并发限流与压缩限幅总线
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/audio-impacts.test.mjs
depends_on:
  - gap-impact-events
goal_ac: AC-014
---
## Proposal

GOAL-005 退出条件要求「八种武器都有可区分的命中音效，并受并发限流约束」，AC-014 以 `node --test tests/audio-impacts.test.mjs` 见证。当前仓库只有「开火音」，没有任何「命中音」；见证文件也不存在（AC 现为 `criterion-capability-unevaluable`：criterion 指向的 `tests/audio-impacts.test.mjs` 在仓库中不存在）。证据：

- `public/js/audio.js:913-940` 的 8 个 `shoot_*` case 是**发射瞬间**的音色，由 `public/js/sim/projectile-system.js:12` 的 `playSound(``shoot_${tower.type}``)` 触发；命中时刻没有任何音频事件——`public/js/sim/combat-system.js` 的 `damage()` 只写 `hitFlash` 与飘字，不发声。
- 唯一音效派发口 `sim.playSound`（`public/js/sim.js:442-449`）按同名 40ms 静默丢事件；音频层 `AudioFX.play`（`public/js/audio.js:906`）没有第二道并发预算。36 敌混战时一帧最多推进 24 个模拟步（`public/js/game-app.js:100`），多塔多目标可同帧叠出数十个振荡器。
- 音效总线 `sfxGain` 直连 `masterGain`（`public/js/audio.js:356-358`），全仓 `grep -rn DynamicsCompressor public/js` 0 命中：没有压缩/限幅，叠音即削波。
- 结构化命中事件由 AC-012（`gap-impact-events`，status `ready`）新增 `sim.impactEvents`（weapon / crit / shieldAbsorbed / armorAbsorbed / lethal / x / y / t / target）。本任务是它的下游消费者，已在结构化 `depends_on` 声明；命中层需要武器类型与暴击/致死标记来分音色、定优先级，没有事件流只能退回按 `shoot_*` 猜测，故不重复造第二套伤害钩子。
- 战旗塔 `support: true`、`dmg: 0`（`public/js/shared/data.js` 的 `TOWERS.banner`），永不参战，因此不会产出命中事件。AC 要求「八种武器」，本任务把战旗的命中层定义为**光环脉冲**（Plan 第 2 步），而不是把它排除在八种之外。
- 现有测试只覆盖到「事件有实现」与「三条总线存在」：`tests/audio-events.test.mjs` 校验 `sim.js` 的 `playSound` 事件在 `audio.js` 有 case；`tests/audio-mix.test.mjs:159-176` 用源码正则校验 `sfxGain.connect(masterGain)`，其假上下文没有 `createDynamicsCompressor`。两者都不涉及命中音、限流或压缩。

<!-- dedup-ref --> 去重与合并：库内 36 个任务没有任何任务以 `goal_ac: AC-014` 认领本 AC，也没有第二个命中音效任务（`HEX-004` / `MAP-005` 已 done，只是历史上改过 `audio.js` 的音色，机制不同）。与 `gap-impact-events`（AC-012）是上下游关系，已由结构化 `depends_on` 表达；与 `gap-hitstop-camera-feedback`（AC-013）和 `FEEL-001`（AC-011）只共享 `public/js/game-app.js`（granularity 工具 `peers[]` 实测），机制与验收彼此独立，保持分开立案；本任务在该文件只加一个构造器字段与一处 tick 调用。

## Plan

1. 文档先行（CLAUDE.md 约定）：`docs/TECH_DESIGN.md` §14.3 增「命中音效层」小节——音色表、`IMPACT_LIMITS` 限流语义、压缩/限幅链路与参数、`sim.impactEvents` 消费契约（只读、不改模拟、不进存档）、战旗光环脉冲定义；`docs/PRD.md` §7「音频」补「八种武器命中音各有可区分音色，受并发限流与压缩总线约束」，§4.12「关键约束」补一句「音效限流/压缩只作用于表现，不改变模拟与结算」。

2. 新增 `public/js/audio-impacts.js`（ui 层纯数据 + 纯逻辑；不 import `sim*`、不碰 DOM；可 import `shared/data.js` 的 `TOWERS`）：
   - `IMPACT_SIGNATURES`：键集合必须与 `Object.keys(TOWERS)` 完全一致（8 个），每项 `{ type, freq, slide, duration, gain, noise: { filter, cutoff, duration, gain } | null }`。初值（实现时可微调，但必须守住可分辨性）：

     | 武器 | 波形 | 基频 | 滑音 | 时长 | 噪声 |
     |---|---|---|---|---|---|
     | arrow | square | 1180 | -520 | 0.06 | — |
     | cannon | sine | 92 | -38 | 0.20 | lowpass 620 / 0.16 |
     | frost | triangle | 1760 | +260 | 0.09 | highpass 3400 / 0.06 |
     | arc | sawtooth | 560 | -340 | 0.11 | bandpass 2600 / 0.10 |
     | poison | sine | 268 | -70 | 0.12 | lowpass 480 / 0.12 |
     | banner | triangle | 720 | +210 | 0.13 | — |
     | shock | square | 180 | -60 | 0.16 | lowpass 1100 / 0.12 |
     | sniper | sawtooth | 140 | -170 | 0.22 | highpass 2200 / 0.09 |

   - `IMPACT_LIMITS = { windowMs: 120, maxVoicesPerWindow: 4, perWeaponGapMs: 60, globalGapMs: 16, maxPerFrame: 3, jitterCents: 18, clusterStep: 0.12, clusterCap: 5 }`。
   - `pitchCentsFor(event)`：由 `weapon + target.id + t` 的字符串哈希派生 ±`jitterCents` 的确定性变调（同一事件重放同音高；**不使用 `Math.random`**，避免不可复现）。
   - `class ImpactMixer`：构造参数 `{ limits, voice }`，`voice(signature, opts)` 是注入的发声回调。`handle(events, nowMs)`：
     - 用 `WeakSet` 按对象身份去重（`sim.impactEvents` 是环形缓冲，不能用下标做游标；缓冲缩水时清空重来）；
     - 过滤 `perWeaponGapMs` / `globalGapMs` / `maxPerFrame` / `maxVoicesPerWindow`；
     - 超额时按 `lethal > crit > 普通`（同优先级按 `hpLost` 降序、再按 `t` 降序）保留，其余抑制并计数；
     - 同武器同窗口的连续事件合并为一次「簇音」：增益 `×(1 + clusterStep·min(n-1, clusterCap-1))`，只发一次；
     - 暴击追加高频亮度层（`freq×2.2`、0.05s、增益 0.012），致死追加 60Hz 低频层（0.18s、增益 0.02），都计入同一声预算；
     - 返回 `{ played, suppressed, plans }` 供测试与统计。
   - `supportAuraPulse(sim, nowMs, state)`：战旗命中层。条件 `sim.phase === 'wave'`、存在 `TOWERS[t.type].support` 的塔、其 `stats.range` 内至少一座非支援塔、距 `state.lastAt` ≥ 1200ms；命中返回 `{ weapon: 'banner', source: 'aura', t, x, y }`，否则 `null`。只读 `sim.towers` / `sim.phase`，不写回模拟。

3. `public/js/audio.js`：
   - `ensure()`（:337）新增 `this.impactGain`（增益 1）与 `this.impactCompressor = ctx.createDynamicsCompressor()`，链路 `impactGain → impactCompressor → sfxGain`；**保持 `sfxGain.connect(masterGain)` 不变**，`tests/audio-mix.test.mjs` 的现有断言不破。参数：`threshold=-16, knee=10, ratio=12, attack=0.003, release=0.25`（WebAudio 没有专用限幅器，用高压缩比 + 快速启动实现限幅）。
   - 无 `createDynamicsCompressor` 时降级为 `impactGain → sfxGain` 直连、`this.impactCompressor = null`；测试覆盖有/无两条路径。
   - `tone()`（:1064）与 `noise()`（:1082）增加可选输出目标与噪声滤波类型参数（默认仍是 `sfxGain` / `lowpass`，既有调用不变）；命中层统一接 `impactGain`。
   - 新增 `impactVoice(signature, { gainMul, pitchCents, accent, lethal })`：按签名合成一次命中声（振荡器 + 可选噪声 + 可选暴击/致死层），只有它走 `impactGain`。
   - 新增 `followCombatImpacts(sim, nowMs)`：`if (!this.enabled) return { played: 0 }`；确保上下文；`this.impactMixer.handle(sim.impactEvents || [], nowMs)`；再让 `supportAuraPulse` 走同一 mixer（同样计预算）。
   - 构造器创建 `this.impactMixer = new ImpactMixer({ voice: (sig, opts) => this.impactVoice(sig, opts) })`。

4. `public/js/game-app.js`：`tick()` 在模拟步进之后、`updateVisuals` 之前加一行 `audio.followCombatImpacts(this.sim, performance.now());`（:100-109 之间）。改动限定这一处（以及必要时构造器一个时钟字段），避免与 `gap-hitstop-camera-feedback`（同文件）冲突。

5. 新增 `tests/audio-impacts.test.mjs`（自带最小假 WebAudio，仿 `tests/audio-mix.test.mjs` 的 `FakeContext`，**补 `createDynamicsCompressor`**），覆盖见 AC。

6. 跑 `node --test tests/audio-impacts.test.mjs`、`node --test tests/audio-events.test.mjs tests/audio-mix.test.mjs tests/music.test.mjs tests/ambience.test.mjs tests/result-audio.test.mjs tests/skill-audio.test.mjs`、`npm run check:imports`（新文件在 ui 层，只能 import shared）、`npm test`。

## AC

- [ ] `node --test tests/audio-impacts.test.mjs` exit 0，且测试文件覆盖下列全部断言
- [ ] 签名表键集合与 `Object.keys(TOWERS)` 完全一致（8 个，含战旗）；逐对可分辨：波形 / 基频比 ≥1.2 / 噪声滤波类型 / 截止频率比 ≥1.4 / 时长比 ≥1.5 五维中至少 2 项不同；每条签名 `gain ≤ 0.06` 且 `duration ≤ 0.3`
- [ ] 限流：同一 120ms 窗口注入 200 条事件，实际发声 ≤ `IMPACT_LIMITS.maxVoicesPerWindow`；同武器 60ms 内重复被抑制；单帧 `maxPerFrame` 生效；超额时保留集合按 `lethal > crit > 普通` 可预期（断言保留的 weapon 列表）
- [ ] 压缩总线：`ensure()` 后 `impactGain.outputs` 含 `impactCompressor`、`impactCompressor.outputs` 含 `sfxGain`、`sfxGain.connect(masterGain)` 仍直连；`threshold ∈ [-40,-6]`、`ratio ≥ 4`、`attack ≤ 0.01`、`release ∈ [0.1,1]`；播放一次命中后新建振荡器的输出链最终到达 `impactGain`；无 `createDynamicsCompressor` 的假上下文下退化为 `impactGain → sfxGain` 且不抛错
- [ ] 变调确定性：同一事件两次 `pitchCentsFor` 相等且落在 ±`jitterCents`；不同 `target.id` 至少产生 3 种取值
- [ ] 战旗光环脉冲：假 sim 在 0ms 发声、600ms 不发声、1300ms 再发声；`phase !== 'wave'` 或范围内无非支援塔时永不发声
- [ ] 关闭音效（`localStorage` 的 `abyss-tower.sound=off`）时 `followCombatImpacts` 返回 `played: 0` 且不创建任何振荡器/噪声节点
- [ ] 模拟零接触：`grep -rn "from '\./\?sim\|sim\.js" public/js/audio-impacts.js` 0 命中；`public/js/audio-impacts.js` 不含 `Math.random`；`node --test tests/audio-events.test.mjs` exit 0（`sim.js` 未新增 `playSound` 调用）
- [ ] `npm test` exit 0

## DoD

- [ ] 真实对局驱动：固定 seed 建 8 塔（含战旗）跑满 2 波，收集 `sim.impactEvents`（覆盖 ≥7 种攻击塔）与战旗光环脉冲，按 60fps 的 `nowMs` 序列回放 `ImpactMixer`；统计 8/8 种签名各至少发声 1 次、任一 120ms 窗口发声 ≤ `maxVoicesPerWindow`，输出统计摘要（记录驱动脚本与输出）
- [ ] 同一 seed「挂 `followCombatImpacts`」与「不挂」两局，波次 / 金币 / 击杀 / 基地血量 / `combatRng` 序列逐项一致（脚本对比，不以肉眼代替）
- [ ] 无头浏览器实测：用 `tests/harness.mjs` 的 `launchBrowser` 注入振荡器/噪声创建计数，建塔开波 ≥30s，命中层在任一 120ms 窗口内创建的节点数 ≤ `maxVoicesPerWindow × 2`，`audio.impactCompressor` 非空，页面 `window.__bootErrors` 为空（记录输出摘要）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（表现层无回归）
- [ ] `docs/TECH_DESIGN.md` §14.3 与 `docs/PRD.md` §4.12 / §7 的记录与实现一致；Notes 写明音色表、限流参数、压缩参数、降级路径，以及「战旗命中层 = 光环脉冲」的定义与触发条件

## Touches

- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `public/js/audio-impacts.js`
- `public/js/audio.js`
- `public/js/game-app.js`
- `tests/audio-impacts.test.mjs`
- `tasks/gap-audio-impacts.md`
