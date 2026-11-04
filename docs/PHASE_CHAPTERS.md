# 关卡节点化 · 阶段冻结表（PHASE_CHAPTERS）

- 状态：**TODO-15 设计落表**（DOCS-005，2026-11-04；源自 `docs/TODO.md` 的 TODO-15「关卡节点化」三路子代理收敛方案，用户已点头开工）
- 定位：本阶段**冻结表的唯一定义处**——6 节点 × 5 波章节契约、难度曲线契约、平衡红线与实现三阶段。后续实现任务（章节表 `chapters.js`、`generateWave` 接线、服务端 presence-gate、replay 版本）的字段契约与 AC 映射以本文为唯一出处；`docs/PRD.md` 只写玩家可见行为，`docs/TECH_DESIGN.md` 只写运行时不变式并引用本文；同一条数值/字段不在两处各写一遍。
- 变更纪律：修改本文任一冻结值，必须**同一提交**改对应实现与测试；只改一处视为漂移。
- 相关正本：`docs/TODO.md`（TODO-15 草案原文）、`docs/BALANCE.md`（平衡读数）、`docs/MAP_DESIGN.md`（地图）。
- 文件名纪律：本文用 **ASCII 文件名** `PHASE_CHAPTERS.md`（避免含中文路径的引用被文档一致性检查截断）。

---

## 1. 背景

### 1.1 现状盘点（读数即代码）

| 事实 | 现状 | 出处 |
|---|---|---|
| 波次推进 | 线性 1..30 波、`MAX_WAVE = 30` | `public/js/shared/data/constants.js` |
| 血量曲线 | `hpGrowth 1.17` 单调涨，每波 `Math.pow(1.17, wave-1)` | `public/js/shared/config.js`、`public/js/shared/waves.js` |
| 移速曲线 | `speedGrowth 0.006` 线性加 | `public/js/shared/config.js` |
| 首领 | 每 5 波一次（`CORE_WAVES = [5,10,15,20,25]`），三变体轮换 | `public/js/shared/boss-core.js`、`public/js/shared/data/enemies.js` |
| 事件 | 每 5 波一次（`EVENT_WAVES = [5,10,15,20,25]`） | `public/js/shared/events.js` |
| 数量上限 | `maxCount = 80` | `public/js/shared/config.js` |

现状痛点：30 波线性、6 个 5 波块**结构完全相同**、重复度高、无亮点——`index % 5 === 0` 只是加个 boss，块与块之间只有数值涨，没有「主题切换」带来的玩法变化。

### 1.2 核心设计

把 30 波切成 **6 节点 × 5 波**，对齐现有 5 波首领/事件/核心节奏（`public/js/shared/events.js` / `public/js/shared/boss-core.js` / `public/js/shared/snapshot.js` 零改动）。每节点 = **主题（敌人池）+ 词缀（hpMul/speedMul）+ 首领变体**，制造「章节感」而不动波次骨架。

| 节点 | 波次 | 主题 | 词缀 | 首领 |
|---|---|---|---|---|
| 石肤荒野 | 1–5 | 近战步兵教学 | 无（基线） | 磐岩 |
| 天穹裂痕 | 6–10 | 飞行怪登场 + 对空分流 | swift 疾风 | 裂隙亲王 |
| 重甲壁垒 | 11–15 | 护甲潮 + 破甲考验 | armored 重甲 | 血怒 |
| 裂潮涌动 | 16–20 | 数量 / 分裂 + AOE 清杂 | surge 涌潮 | 重盾磐岩 |
| 相位风暴 | 21–25 | 位移 / 控制 + 护塔站位 | 相位控制 | 群虫亲王 |
| 深渊终章 | 26–30 | 精英混编 + 最终首领 | 精英强化 | 狂暴终渊主 |

---

## 2. 范围

### 2.1 本表冻结

1. 章节契约：6 节点表（§3），字段 `{ id, name, waves:[start,end], theme:{hpMul,speedMul}, enemyPool[], bossVariant }`；
2. 难度曲线契约（§4）：`hpGrowth 1.17` 拆「节点内 1.13 + 边界 ×1.22」，首领「1.55 单调台阶 + final ×2.0」；
3. 平衡红线（§5）：5 条硬判据；
4. 实现三阶段拆分（§6）与确定性红线。

### 2.2 本表不冻结

- 具体实现文件的分层与命名（阶段 0 章节表文件 `chapters.js` 的落点见 §6.1，可被实现任务微调，但对外符号名 `chapterForWave` / `CHAPTERS` 不变）；
- 平衡终值（红线之外的 theme hpMul/speedMul 初值由 `npm run balance` 收口，回写 `docs/BALANCE.md`）；
- 敌人池内具体权重与数量（只冻结 id 集合，不冻结 weight/count）。

---

## 3. 章节契约

### 3.1 字段契约

每节点一个纯数据对象，字段如下（全部冻结，实现不得增删语义字段）：

```
{
  id, name, waves: [start, end],
  theme: { hpMul, speedMul },   // 词缀：作用于本节点所有敌人
  enemyPool: [],                // 主题敌人 id 集合（节点主打）
  bossVariant,                  // 首领变体 id：armored | summoner | berserk
}
```

- `waves` 闭区间，6 节点恰好覆盖 1..30、无重叠；
- `theme.hpMul` / `theme.speedMul` 是**节点级倍率**，乘在难度曲线（§4）之上，不替代曲线；
- `bossVariant` 对齐现有 `selectBossVariant` 的每 5 波轮换（`armored → summoner → berserk`），保证同种子同首领不变。

### 3.2 六节点表

| id | name | waves | theme.hpMul | theme.speedMul | enemyPool | bossVariant |
|---|---|---|---|---|---|---|
| ch1 | 石肤荒野 | [1, 5] | 1.00 | 1.00 | grunt, runner, swarm, tank | armored（磐岩） |
| ch2 | 天穹裂痕 | [6, 10] | 0.95 | 1.05 | flyer, shielder, healer, splitter | summoner（裂隙亲王） |
| ch3 | 重甲壁垒 | [11, 15] | 1.15 | 0.95 | herald, caster, golem, tank, shielder | berserk（血怒） |
| ch4 | 裂潮涌动 | [16, 20] | 0.90 | 1.05 | splitter, swarm, wraith, runner | armored（重盾磐岩） |
| ch5 | 相位风暴 | [21, 25] | 1.10 | 1.00 | wraith, caster, herald, flyer | summoner（群虫亲王） |
| ch6 | 深渊终章 | [26, 30] | 1.20 | 1.00 | golem, herald, caster, wraith, tank, shielder, flyer | berserk（狂暴终渊主） |

> theme hpMul/speedMul 为**初值**，实现任务落地前由 `npm run balance` 验证并收口（红线见 §5），初值只保证「有差异、方向对」。
> `enemyPool` 是主题主打敌人 id；基线 grunt/runner/swarm 在所有节点继续做填充，不重复列。
> `bossVariant` 括号内为首领显示名；字段值仍是现有三变体 id，不动 `BOSS_VARIANTS` 表。

### 3.3 纯函数契约

`chapterForWave(wave)`：给定波次返回所属章节对象；纯函数、无 RNG、无 IO，同输入必同输出。`CHAPTERS` 常量按 §3.2 表顺序导出。

---

## 4. 难度曲线契约

### 4.1 普通敌人：节点内 + 边界

现状 `hpGrowth 1.17` 单参数单调涨 → 拆成两个参数：

- 节点内 `r = 1.13`/波（5 波节点内血量按 1.13 指数涨）；
- 边界 `×1.22`（跨节点首波在上一节点末波基础上再乘 1.22）。

推导（相对第 1 波基线 1.0）：

- 节点内末波 vs 首波：`1.13^4 ≈ 1.63`；
- 边界跳变（波 5 → 波 6）：`1.13 × 1.22 ≈ 1.38`（红线区间 1.30~1.45，见 §5）；
- 第 30 波收敛：`1.13^29 × 1.22^5 ≈ 93.6×`（≈现值，三档通关率 +2~4pp 可接受）。

### 4.2 首领：单调台阶 + final

- 普通首领波（5/10/15/20/25）：每 5 波一「台阶」，`bossHpMul` 按 **1.55 单调台阶**涨（替代现状「1.26 平 + 3.56 悬崖」）；
- 最终波（30）：额外 `final ×2.0`；
- **拉平变体 hpMul**：`BOSS_VARIANTS` 三变体 hpMul（1.2 / 0.9 / 0.95）在章节曲线下不再用于区分血量，统一视为 1.0——变体只保留技能权重 / 护甲 / 移速差异。

### 4.3 移速

`speedGrowth 0.006` 不动（红线 §5）；`theme.speedMul` 只做节点级微调。

---

## 5. 平衡红线

| # | 红线 | 判据 | 现状 / 初值 |
|---|---|---|---|
| 1 | 边界跳变区间 | 1.30 ~ 1.45 | `1.13 × 1.22 = 1.38` ✓ |
| 2 | 节点内增长率 | `r ≥ 1.10` | 1.13 ✓ |
| 3 | 移速增长 | `speedGrowth ≤ 0.008` | 0.006 ✓ |
| 4 | 数量上限 | `maxCount = 80`，不指望靠数量堆难度 | 80 |
| 5 | 最终首领倍率 | `bossFinalMul ≤ 2.6` | 2.0 ✓ |

---

## 6. 实现三阶段

### 6.1 三阶段拆分（落地顺序）

<!-- docs-consistency:planned-start -->
- **阶段 0（串行）章节表契约**：新增 `public/js/shared/chapters.js`（`CHAPTERS` 常量 + `chapterForWave` 纯函数 + `theme` 归一化），并补 `tests/chapters.test.mjs`（六节点覆盖、无重叠、纯函数确定性、§3.2 表逐条断言）。
- **阶段 1（并行，按文件所有权拆最多 3 个子代理）**：
  - waves：`public/js/shared/waves.js` 的 `generateWave` 加默认关闭的 `chapters` 开关（theme=hpMul/speedMul + 敌人池 + 首领变体）；
  - 服务端：`server/services/run-rules.mjs` / `server/services/run-service.mjs` 的 `ruleset.chapters` presence-gate（旧行为字节不变）；
  - replay：`public/js/shared/replay.js` REPLAY_VERSION 3→4。
- **阶段 2（集成）**：串起全链路 + CONTENT_VERSION +1 + `npm test` 全绿。
<!-- docs-consistency:planned-end -->

### 6.2 确定性红线

1. `chapterForWave` 纯函数、无新 RNG：新章节不引入随机流，RNG 调用顺序不变（`public/js/sim.js` / `public/js/shared/events.js` 确定性不动）；
2. 旧行为 presence-gate 字节不变：`ruleset.chapters` 缺省时（旧存档/回放）快照/回放字节与现状逐字节一致；
3. `SAVE_VERSION` 不动、`REPLAY_VERSION` 3→4（分享码/回放版本升一位）；
4. `CONTENT_VERSION` +1（`server/config.mjs`）；
5. 首领轮换不变：`selectBossVariant` 每 5 波轮换序列不动，§3.2 的 bossVariant 与之对齐。

### 6.3 AC 映射

后续实现任务的 AC 以本节为唯一出处（立案时把 AC id 与任务挂到 `goal_ac`）：

| 阶段 | AC 候选 | 判据 |
|---|---|---|
| 阶段 0 | 章节表契约 | §3.2 六节点表逐条落地，`chapterForWave` 纯函数无 RNG，`chapters.test.mjs` 全绿 |
| 阶段 1 | waves / 服务端 / replay | `generateWave` 开关默认关闭；presence-gate 字节不变；REPLAY_VERSION=4 |
| 阶段 2 | 集成 | CONTENT_VERSION+1、`npm test` 全绿、`npm run balance` 红线全过 |
