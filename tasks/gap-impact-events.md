---
id: gap-impact-events
title: 结构化命中事件：每次伤害产出事件且反馈开关不改变模拟与 RNG
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/impact-events.test.mjs
goal_ac: AC-012
---
## Proposal

GOAL-005 退出条件要求「每次伤害都产出结构化命中事件；同一 seed 在反馈开/关、画质高/低下的模拟结果与 RNG 调用序列逐字节一致」，AC-012 以 `node --test tests/impact-events.test.mjs` 见证。当前仓库没有这一事件层，见证文件也不存在：

- `public/js/sim/combat-system.js:38-79` 的 `damage()` 是塔攻击、溅射、连锁、盟友与中毒跳伤的统一伤害汇点，但只返回剩余伤害、写 `hitFlash` 并按 `floatersMode` 生成飘字，不产出任何可被渲染/音频消费的结构化命中数据；护甲吸收（`:41-43`）与护盾吸收（`:59-63`）只体现在最终数值里，事后无法还原。
- `public/js/sim/skill-system.js:481-487` 的 `skillDamage()` 直接扣血并 `killEnemy()`，完全绕过 `CombatSystem.damage()`，是第二条伤害路径；只改 combat-system 会漏掉技能伤害与熔火灼烧跳伤（`skill-system.js:104`）。
- 表现层目前只能读 `enemy.hitFlash`（`public/js/render/enemy-renderer.js:197`）与飘字文本，拿不到武器类型、暴击、护盾/护甲吸收、致死标记，无法支撑后续 GOAL-005 的命中特效/音效/飘字分层（AC-013/014/015/016）。
- 现有视觉降级只通过 `sim.effectsLevel` / `sim.floatersMode`（`public/js/sim.js:83-84,425-441`）影响特效与飘字生成；新事件层必须与之解耦，否则「反馈关」会静默改变模拟观测面。`combatRng`（`sim.js:167`、`wave-director.js:25`）按波次重建，事件层不得新增任何 RNG 调用。

本任务只新增只读事件流与其契约，不改变任何伤害数值、击杀结算、波次结构或 RNG 调用顺序；事件消费者（渲染/音频/飘字/演出）留给 AC-013 起后续任务。

<!-- dedup-ref --> 去重与合并：库内 31 个任务没有任何任务以 `goal_ac: AC-012` 认领本 AC，也没有其他命中事件任务；与唯一 todo 任务 `gap-auto-quality-default`（AC-011，默认画质）只共享 `docs/PRD.md` / `docs/TECH_DESIGN.md` 两个文档文件，机制不同、验收独立，保持分开立案。

## Plan

1. 文档先行（CLAUDE.md 约定）：`docs/TECH_DESIGN.md` §4.6 补「结构化命中事件」契约——事件字段表、唯一汇点（`CombatSystem.damage` + `SkillSystem.skillDamage`）、环形上限、不入存档、不读设置、不消耗 RNG；`docs/PRD.md` §4.12「关键约束」补一句：命中事件在反馈/画质关闭时仍逐次产出，只是消费者的表现不同。
2. 新增 `public/js/shared/impact-events.js`（纯函数模块）：`IMPACT_EVENT_LIMIT`（240）、`makeImpactEvent(fields)` 归一化字段、`pushImpactEvent(sim, event)` 推入 `sim.impactEvents` 并裁掉最旧。不新增 `Simulation.prototype` 方法——`tests/sim-systems.test.mjs:135` 对导出面做 `deepEqual`，公共方法集合必须完全一致。
3. `public/js/sim.js` 构造器初始化 `this.impactEvents = []`（与 `skillFx` 同级）；确认 `toSnapshot()` 不序列化该字段（快照是显式字段清单，`public/js/shared/snapshot.js:176-221`）。
4. `public/js/sim/combat-system.js`：`dealDamage()` 把 `weapon`（塔类型 / ally.kind / 'arc'）、`source`（默认 `'tower'`）与 `towerId` 透传给 `damage()`；`damage()` 在扣血前记录 `armorAbsorbed` 与 `shieldAbsorbed`、扣血后记录 `hpLost`、`killEnemy()` 后确定 `lethal`，统一 `pushImpactEvent`。事件与 `silent` / `dot` / `floatersMode` / `effectsLevel` 完全解耦。
5. `public/js/sim/enemy-system.js`：中毒跳伤调用传 `source: 'dot', weapon: 'poison'`；盟友攻击调用传 `source: 'ally'`。
6. `public/js/sim/skill-system.js`：`skillDamage()` 产出事件（`source: dot ? 'burn' : 'skill'`、`weapon: this.sim.skill?.id ?? 'skill'`，护甲/护盾吸收为 0、`crit: false`、`lethal` 按扣血后判定），不改变扣血与击杀顺序。
7. 新增 `tests/impact-events.test.mjs`（沿用 `tests/combat.test.mjs` 的 `makeSim/addEnemy` 手法）：
   - 塔命中 / 暴击 / 溅射每目标 / 连锁电弧 / 盟友攻击 / 技能 / 灼烧 / 中毒跳伤各至少一条事件，校验 `weapon`、`crit`、`armorAbsorbed`、`shieldAbsorbed`、`hpLost`、`lethal`、`t`、`x/y`、`target.id/type`；
   - 护盾未破时 `hpLost === 0` 且 `shieldAbsorbed > 0`；致死一击 `lethal === true` 且目标 `dead`；
   - 确定性：同一 seed 两局分别 `setVisualQuality({ effects: 'full', floaters: 'all' })` 与 `{ effects: 'off', floaters: 'off' }`，逐次 `update(1/30)` 后快照去掉 `savedAt/startedAt` 逐字节相等，`combatRng.float()` 序列逐项相等；并以「事件条数/字段相同」证明事件层不推进 RNG、不受反馈开关影响。
8. 跑 `node --test tests/impact-events.test.mjs`、`node --test tests/combat.test.mjs tests/sim-systems.test.mjs tests/sim-skills.test.mjs tests/snapshot.test.mjs tests/save-compat.test.mjs`、`npm test`。

## AC

- [ ] `node --test tests/impact-events.test.mjs` exit 0，且该文件覆盖：塔命中/溅射每目标/连锁电弧/盟友攻击/技能/灼烧/中毒跳伤各至少一条事件；暴击、护甲吸收、护盾吸收、致死、位置与目标字段数值正确
- [ ] 事件在 `setVisualQuality({ effects: 'off', floaters: 'off' })` 下仍逐次伤害产出：同一 seed 场景「全开」与「全关」两次运行的事件条数与逐条字段相同
- [ ] `node --test tests/sim-systems.test.mjs tests/combat.test.mjs tests/sim-skills.test.mjs tests/snapshot.test.mjs tests/save-compat.test.mjs` exit 0（公共方法集合与存档结构不变）
- [ ] `grep -rn "impactEvents" public/js/shared/snapshot.js public/js/sim/snapshot-mapper.js` 0 命中（事件流不入存档/HUD 快照）
- [ ] `npm test` exit 0

## DoD

- [ ] 真实对局驱动：固定 seed 建塔自动战斗跑到至少 2 波结束，`sim.impactEvents` 累计 >100 条；抽样中塔命中、溅射、暴击、护盾吸收、致死、中毒/灼烧至少各 1 条且字段完整（记录驱动脚本与输出摘要）
- [ ] 同一 seed「反馈全开」与「关闭飘字 + 精简特效」两局，波次/金币/击杀/基地血量/`combatRng` 序列逐项一致（脚本对比，不以肉眼代替）
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` exit 0（表现层无回归）
- [ ] `docs/TECH_DESIGN.md` §4.6 与 `docs/PRD.md` §4.12 的契约与实现一致；Notes 记录事件字段表、环形上限与两条伤害路径覆盖清单

## Touches

- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `public/js/sim.js`
- `public/js/sim/combat-system.js`
- `public/js/sim/skill-system.js`
- `public/js/sim/enemy-system.js`
- `public/js/shared/impact-events.js`
- `tests/impact-events.test.mjs`
- `tasks/gap-impact-events.md`
