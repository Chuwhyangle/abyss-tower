# 局外深度成长 · 阶段决策（PHASE_META）

- 状态：**GOAL-012 设计定稿**（文档 lane，2026-10-30）
- 定位：本阶段**冻结表的唯一定义处**——机制、数值、字段契约与 AC 映射。
  `docs/PRD.md` 只写玩家可见行为，`docs/TECH_DESIGN.md` 只写运行时不变式并引用本文；
  同一条数值/字段不在两处各写一遍。
- 变更纪律：修改本文任一冻结值，必须同时改对应实现与测试；只改一处视为漂移。
- 相关正本：`docs/PROGRESSION_DESIGN.md`（既有局外成长：星核/成就/通行证/悬赏/皮肤）、
  `docs/BALANCE.md`（平衡口径与三档目标区间）、`public/js/shared/snapshot.js`（单局存档版本与迁移）、
  `public/js/shared/data/unlocks.js`（星核解锁，作为「以解锁为主」的分界参照）。

---

## 1. 背景

GOAL-012（局外深度成长）在既有「星核解锁 / 成就 / 赛季通行证 / 悬赏 / 皮肤」之上，补一层账号级
深度成长，让长线玩家有持续投入的目标。既有局外成长偏「条件 → 一次性奖励」的轻量形态；本阶段新增
**天赋树（技能点 → 永久被动）+ 塔/技能永久强化 + 跨局传承（每局结算产出传承材料）**，与星核商店
（以解锁为主）拉开层次。

四节冻结口径：

- **机制**：账号级天赋树、塔/技能永久强化、跨局传承各自做什么、与既有系统如何分界。
- **数值**：增益幅度与难度倍率的克制口径，兼容平衡模拟，不改战斗数值口径与 sim 确定性。
- **字段契约**：账号级成长数据模块（public/js/shared/data/meta.js，实现任务落地）的键族，
  以及快照/UI/旧档兼容字段。
- **AC 映射**：GOAL-012 退出条件 1–4 → AC-062…AC-067 的逐条落点。

## 2. 范围

### 2.1 本 lane 交付

- 本文档（机制 / 数值 / 字段契约 / AC 映射四节）。

### 2.2 不在范围

- 不实现 public/js/shared/data/meta.js（属 AC-063 / AC-064）。
- 不写 `goals/*.md`；不改 `docs/PRD.md` / `docs/TECH_DESIGN.md`（总文档只由文档 lane 更新）。
- 不改 `docs/BALANCE.md`（AC-065 的平衡复测单独执行，不并入本任务）。
- 不改战斗数值口径、模拟、RNG 调用顺序、计分与单局存档结构（`public/js/sim.js` 的确定性不变）。

---

## 3. 机制

### 3.1 天赋树（账号级技能点）

- 技能点来源：账号升级 / 成就里程碑 / 赛季奖励（具体来源由实现任务细化；本表只冻结「投入方向」）。
- 投入方向三类，全部是**永久被动**，不进单局随机、不进遗物池、不进波次内状态：
  - **塔向**：对特定塔或塔类别的基础数值小幅增益（攻击 / 射程 / 造价），全账号生效。
  - **技能向**：对技能冷却 / 效果幅度的小幅增益。
  - **经济向**：每局初始金币、遗物刷新次数、掉落/结算实用性的小幅增益。
- 与星核区分：星核以「解锁」为主（能否建造 / 能否使用，见 `public/js/shared/data/unlocks.js`）；
  天赋树以「强化」为主（已解锁内容的数值微调），两者不共用货币、不互相解锁。

### 3.2 塔/技能永久强化

- 与天赋树同源，但按「塔 / 技能个体」逐项投入，命中同一套数值克制口径（见 §4 数值）。
- 可感知但不碾压：单点增益幅度有上限，叠加后仍低于难度倍率的上升斜率（见 §4 数值）。

### 3.3 跨局传承

- 每局结算按表现产出**传承材料**，用于天赋树 / 永久强化的投入，形成「打局 → 产出 → 投入 → 更强」的循环。
- 与星核区分：星核结算产出以「解锁货币」为主；传承材料只服务于强化 / 天赋，不重复解锁、不与成就 /
  通行证 / 悬赏结算重复（同一次结算只在传承材料口径下计数一次）。

---

## 4. 数值

### 4.1 克制口径（冻结）

| 项 | 口径 | 说明 |
|---|---|---|
| 单点增益上限 | 单项 ≤ +8%，每类投入累计 ≤ +24% | 可感知（能看见差异）但不碾压（不跨难度） |
| 难度倍率斜率 | 漫游 / 远征 / 深渊 `hpMul` = 0.85 / 1.10 / 1.34 | 与 `public/js/shared/data/difficulties.js` 一致 |
| 平衡模拟兼容 | meta 增益作为确定性乘数接入，不新增 RNG 调用 | `public/js/sim.js` 确定性不变 |
| 三档目标区间 | 漫游 70–85% / 远征 25–40% / 深渊 5–12% | 与 `docs/BALANCE.md` 一致，meta 纳入后仍须落在区间内 |

**AC-065 复测取舍（2026-11-02）**：满 meta（全节点满投入）首次复测把远征顶到 52%、深渊顶到 23%
（零 meta 基线 37% / 12%，目标 25–40 / 5–12），越上限；先压到 1/10 仍越上限（远征 45%、深渊 13%）。
按「可感知但不碾压（不跨难度）」最终把 `TALENT_NODES` 每级增量压到表示精度下限、约原值 1/40：
`dmgAll 0.001`、`range 0.01`、`costMul -0.001`、`goldMul 0.001`、`interest 0.001`、`killGold 0.02`
（`skillCd -0.001` / `skillPower 0.001` 未注册折叠，仅 UI 可见）。复测两端点三档回落至目标区间；
深渊零 meta 基线已贴 12% 上界，剩余头寸不足 0.4pp，故满 meta 幅度近乎象征性，若后续要把天赋做得更
「可感知」，须由人重排零 meta 基线或放宽深渊目标区间，本任务不自行为之。

### 4.2 确定性边界

- meta 状态在**对局开始时**一次性读入模拟初始状态（账号级状态在单局内不可变），随后不参与任何 RNG 调用，
  不改变 `public/js/sim.js` 的 RNG 调用顺序。
- 同 seed、同账号 meta 状态的两次模拟，归一化快照与 `combatRng` 序列逐字节一致；
  同 seed、不同 meta 状态的两局只差「确定性乘数」，不引入任何随机漂移。
- 平衡模拟（`tests/balance-sim.mjs`）必须能把 meta 增益纳入输入，复测时给「零 meta」与「满 meta」两个端点，
  以证明三档通关率仍在目标区间（对应 AC-065）。

---

## 5. 字段契约

本节定义 public/js/shared/data/meta.js 的字段契约——该文件是 AC-063 / AC-064 的落地产物，
本文档定稿时**尚不存在**，故整节包裹在 planned 块内（planned 块只豁免代码路径存在性；块内的
相对链接与 npm 脚本照旧校验，结构错误 fail-closed）。

<!-- docs-consistency:planned-start -->

### 5.1 模块定位

`public/js/shared/data/meta.js` 是局外成长的纯数据 / 纯查表模块，与 `public/js/shared/data/` 下既有
`relics.js` / `skills.js` / `unlocks.js` 同级：只含常量与纯函数，不 import 运行时模块
（`public/js/sim.js` / `public/js/render/` / `public/js/ui.js` / `server/`），由 `public/js/shared/data.js`
再导出以保持既有 import 路径不变。

### 5.2 `talent` 键族（AC-063 的 grep 落点）

| 键 | 类型 | 说明 |
|---|---|---|
| `talent` | object | 账号级天赋树状态：`{ points, spent, nodes }` |
| `talent.points` | number | 可分配技能点 |
| `talent.spent` | number | 已投入点数（= 各节点投入之和，机械可检） |
| `talent.nodes` | object | `nodeId -> 投入点数`；nodeId 见 `TALENT_NODES` 定义表 |

导出符号（供实现与测试 grep）：

- `TALENT_NODES`：天赋节点定义表（`{ id, name, cost, maxRank, effects }`）。
- `TALENT_ORDER`：节点顺序。
- `talentEffect(nodeId, rank)`：纯函数，返回该节点在某投入下的增益乘数。
- `normalizeTalent(raw)`：旧档 / 损坏字段收敛到安全默认值（无节点、0 点数）。

### 5.3 `legacy` 键族（AC-064 的 grep 落点）

| 键 | 类型 | 说明 |
|---|---|---|
| `legacy` | object | 跨局传承状态：`{ materials, bank }` |
| `legacy.materials` | object | `materialId -> 数量`；materialId 见 `LEGACY_MATERIALS` |
| `legacy.bank` | number | 累计传承材料（与 materials 求和一致，机械可检） |

导出符号：

- `LEGACY_MATERIALS`：传承材料定义表（`{ id, name, source, sink }`）。
- `legacyYield(runResult)`：纯函数，按结算表现计算本局产出（确定性，无 RNG）。
- `normalizeLegacy(raw)`：旧档 / 损坏字段收敛到安全默认值（零材料）。

### 5.4 快照 / UI / 旧档兼容字段

- 快照：`public/js/shared/snapshot.js` 的 `toSnapshot` **不写** meta——meta 是账号级状态，不随单局存档；
  账号级持久化字段走 `server/db/` 的账号表，与单局快照分离。
- UI：`public/js/ui.js` 读取上述纯函数渲染天赋树 / 传承面板；不把 meta 状态塞进单局 `relics` / `towers`。
- 旧档兼容：`normalizeTalent` / `normalizeLegacy` 对缺失字段返回空状态（0 点数 / 零材料），
  旧账号首次加载不报错、不强制迁移；单局 `SAVE_VERSION` 不因 meta 新增而提升（单局存档结构不变）。

<!-- docs-consistency:planned-end -->

---

## 6. AC 映射

状态口径：**done** = 已落地并有见证；**ready / todo** = 已立案、待实现；**goal** = goal 级退出条件，
按退出条件复跑见证；**待立案** = 本表冻结后由 goal driver 派发实现任务。

| 退出条件 | AC | 判据 | 任务 | 文档落点 |
|---|---|---|---|---|
| 1. `docs/PHASE_META.md` 定稿，字段契约与 AC 映射完整 | AC-062 设计定稿 | test -s docs/PHASE_META.md && grep -q '字段契约' docs/PHASE_META.md && grep -q 'AC 映射' docs/PHASE_META.md && grep -q 'GOAL-012' docs/PHASE_META.md | gap-phase-meta-design-freeze | 本文 |
| 2a. 天赋树/永久强化在模拟、快照、UI 一致生效 | AC-063 talent 一致生效 | test -s public/js/shared/data/meta.js && grep -q 'talent' public/js/shared/data/meta.js | gap-ac-063-meta-talent-tree | 本文 §5.2 |
| 2b. 传承在模拟、快照、UI 一致生效 | AC-067 传承一致生效 | test -s public/js/shared/data/meta.js && grep -q 'legacyYield' public/js/shared/data/meta.js && test -s server/services/run-settlement.mjs && grep -q 'legacyYield' server/services/run-settlement.mjs && test -s server/db/legacy.mjs && grep -q 'grantLegacyInTx' server/db/legacy.mjs | —（goal 级见证） | 本文 §5.3 |
| 2c. 数值克制（可感知但不碾压） | AC-066 数值克制 | test -s public/js/shared/data/meta.js && grep -q 'maxRank' public/js/shared/data/meta.js | gap-ac-066-meta-maxrank | 本文 §5.2 |
| 3. 与星核/成就/通行证/悬赏分层清晰，无重复结算 | AC-064 legacy 分层清晰 | test -s public/js/shared/data/meta.js && grep -q 'legacy' public/js/shared/data/meta.js | gap-ac-064-meta-legacy | 本文 §5.3 |
| 4. 平衡复测：meta 增益纳入后三档通关率仍在目标区间，全量测试与确定性不回归 | AC-065 平衡复测不回归 | ! grep -qE '低于目标|高于目标' docs/BALANCE.md | gap-ac-065-meta-balance-retest | `docs/BALANCE.md`、本文 §4.2 |

GOAL-012 退出条件 1–4 与 AC-062…AC-067 一一对应；AC-062 由本文档直接满足（文档落地即 exit 0），
AC-063 / AC-064 / AC-066 / AC-067 的实现任务以本文 §5 为字段契约的唯一定义处，AC-065 以本文 §4 数值为复测输入口径。
