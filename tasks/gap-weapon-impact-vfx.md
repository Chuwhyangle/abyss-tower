---
id: gap-weapon-impact-vfx
title: 八种武器命中特效：可辨识形态与粒子预算约束
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/impact-vfx.test.mjs
goal_ac: AC-015
---
## Proposal

GOAL-005 退出条件要求「八种武器都有可区分的命中音效与命中特效，暴击、击杀、首领命中、破盾各有独立反馈层，并受并发限流与粒子预算约束」，AC-015 以 `node --test tests/impact-vfx.test.mjs` 见证；该文件当前不存在（AC 证据为 `criterion-capability-unevaluable`）。当前实现有四处结构性缺口：

- **命中层与武器无关**：`public/js/sim/projectile-system.js:142` 把所有非溅射命中都发成同一个 `spark`（固定 `#ffe4b0`、0.15s、6 条放射线）；溅射命中统一是一个 `ring`（`:113-119`）；电弧是 `bolt`（`:35`）。8 种塔里只有**开火瞬间**的枪口色（`muzzle` 用 `def.color`）与开火音不同，命中瞬间完全不可区分。
- **特效对象不携带武器类型**：`impact()` 里 `proj.towerType` 只用于伤害结算，写进特效对象时被丢弃，渲染层没有任何依据按武器分派。
- **只有「每事件」与「每帧条数」两层预算，没有「命中层粒子总量」语义**：`EFFECT_PROFILES`（`public/js/render/effect-renderer.js:129-148`）的 `maxParticles / frameBudget / poolBudget` 约束的是单事件与特效条数；36 敌混战时 36 个命中各自申请粒子，互相之间没有并发上限，也没有耗尽后的降级路径——当前 `acquire()` 返回 `null` 就直接 `break`，该命中的粒子层整块消失，只剩微弱底色。
- **战旗没有可定义的命中语义**：`banner` 不参与攻击（`public/js/shared/data/towers.js:200` 的 desc「不参与攻击」），它的签名只能按光环脉冲定义，而现有特效层没有任何光环脉冲表现。

<!-- dedup-ref -->
相邻但不重叠的任务：gap-impact-events（AC-012 结构化命中事件）、gap-audio-impacts（AC-014 命中音效）、gap-hitstop-camera-feedback（AC-013 hitstop/震屏）。三者分别改事件层、音频层、镜头层；本任务只做渲染层的武器命中签名表与粒子预算，验收面独立，Touches 无源码重叠（仅共享 `docs/TECH_DESIGN.md`）。

## Plan

1. 新模块 `public/js/render/impact-vfx.js`（纯数据 + 纯函数，不 import 模拟层、不含 `Math.random`）：
   - `IMPACT_VFX` 以 `TOWER_ORDER` 的 8 个键为索引：`arrow / cannon / frost / arc / poison / banner / shock / sniper`。每项 `{ color, accent, shape, particles, spread, duration, size, ring, spin }`；shape 取 8 个互不相同的值（`needle / burst / crystal / arc / motes / aura / wave / lance`），color 取 8 个唯一 hex。
   - `impactVariant(weapon, profile)`：按 `profile.particleScale` 缩放、用本档 `maxParticles` 钳制；low / high 两档在模块加载时预生成并冻结（查表，不在渲染循环新建对象）。未知 weapon 回退到 `IMPACT_VFX.fallback`，回退项同样受上限约束。
   - `impactBudget(profile)`：命中层每帧粒子总预算，`low ≤ 32`、`high ≤ 128`，且不超过 `profile.poolBudget`。
   - `ImpactVfxPool`：固定容量的粒子槽复用池，`reset(limit)` / `acquire()` 语义与既有 `ParticlePool` 一致（构造时一次性分配，跨帧复用）。
2. `public/js/sim/projectile-system.js`：给 `spark`、溅射 `ring`、`bolt` 三个特效对象加 `weapon: proj.towerType`（bolt 固定 `'arc'`）。**只加表现字段**：不新增 RNG 调用、不改结算与事件顺序。
3. `public/js/render/effect-renderer.js`：
   - `spark` 分支按 `effect.weapon` 取 `impactVariant`，按 shape 分派绘制（针形 / 爆裂 / 晶体 / 电弧 / 毒雾 / 波环 / 枪刺）。
   - 溅射 `ring` 与 `bolt` 使用对应武器的 accent 与线宽，与通用光环拉开差异。
   - 每帧 `impactPool.reset(impactBudget(profile))`；粒子耗尽时降级为「核心闪白 + 武器色环」，命中表现不整块消失。
   - 新增 `renderAuraPulses`：遍历 `this.game.towers` 中 `type === 'banner'` 的塔，按 `(time * 0.6) % 1` 的相位画战旗签名的扩散光环（纯渲染层，不新增模拟事件）。
4. 向后兼容：缺 `weapon` 的旧特效（含所有非塔来源的 `spark`/`ring`）保持既有通用外观，不抛错、不改变既有测试期望。
5. `docs/TECH_DESIGN.md` §5.5 补记 8 种武器签名表、每档粒子预算与降级路径。

## AC

- [ ] `node --test tests/impact-vfx.test.mjs` exit 0，且测试文件覆盖下列全部断言
- [ ] `Object.keys(IMPACT_VFX)`（除 `fallback` 外的 8 个武器键）与 `TOWER_ORDER` 完全一致；每项 `color/accent/shape/particles/spread/duration/size/ring/spin` 均为有限值，且 `particles ≥ 1`（低档也不得为 0，任何画质档位命中链都可见）
- [ ] 可分辨性：8 个 `color` 两两不同（`new Set(color).size === 8`）、8 个 `shape` 两两不同，且 `(shape, particles, spread)` 三元组两两不同 → 任意两种武器至少 2 维可分辨
- [ ] 预算钳制：逐武器 `impactVariant(w, EFFECT_PROFILES.low|high).particles ≤ EFFECT_PROFILES[tier].maxParticles`；逐武器 `low < high` 严格成立；`impactVariant('no-such-weapon')` 返回 fallback 且同样受上限约束、不抛错
- [ ] 并发预算：`ImpactVfxPool` 容量固定、跨帧复用同一槽位对象；`reset(impactBudget(profile))` 后注入 36 个同时命中，累计 `acquire()` 成功数 ≤ `impactBudget(profile)`；耗尽后渲染分支返回降级标记（`{ degraded: true }`）且不抛错
- [ ] 接线源码断言：`public/js/render/effect-renderer.js` 的 `spark` 分支调用 `impactVariant`、渲染循环中执行 `impactPool.reset(impactBudget(...))`，并存在 `type === 'banner'` 的光环脉冲分支；`public/js/sim/projectile-system.js` 的 `spark`/`ring`/`bolt` 事件对象都带 `weapon`
- [ ] 表现零接触模拟：`public/js/render/impact-vfx.js` 不含 `Math.random`、不 import `sim`/`shared/rng`；同 seed 两局（命中特效开 / 关）序列化 `gold / baseHp / kills / wave / enemies` 逐字节一致
- [ ] `npm test` exit 0

## DoD

- [ ] 真实对局驱动：用 `tests/harness.mjs` 的 `launchBrowser` 建 8 塔（战旗仅光环）跑满 2 波，在渲染层注入计数钩子，统计 7 种攻击塔的命中签名各绘制 ≥1 次、战旗光环脉冲 ≥1 次、单帧命中粒子峰值 ≤ `impactBudget(high)`，页面 `window.__bootErrors` 为空；输出统计摘要（记录驱动脚本与输出）
- [ ] 36 敌混战压测：单帧命中粒子峰值不超预算，降级路径被触发时无未捕获异常、无整块命中表现消失（记录峰值与降级次数）
- [ ] 同一 seed 实测两局（命中层开 / 关），结算面板的金币 / 生命 / 击杀 / 波次一致（实跑对比，不以单元测试代替）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（表现层无回归）
- [ ] `docs/TECH_DESIGN.md` §5.5 的签名表、预算参数与降级路径与实现一致，Notes 记录 8 种签名的视觉差异点与战旗光环脉冲的触发条件

## Touches

- `docs/TECH_DESIGN.md`
- `public/js/render/impact-vfx.js`
- `public/js/render/effect-renderer.js`
- `public/js/sim/projectile-system.js`
- `tests/impact-vfx.test.mjs`
- `tasks/gap-weapon-impact-vfx.md`