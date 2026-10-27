# 战斗反馈与视觉重制 · 阶段决策（PHASE_FEEL_ART）

- 状态：**GOAL-005 / GOAL-006 文档 lane 收口**（DOCS-001，2026-10-27）
- 定位：本阶段**冻结表的唯一定义处**——命中反馈契约、精灵资源索引与 AC 映射。
  `docs/PRD.md` 只写玩家可见行为，`docs/TECH_DESIGN.md` 只写运行时不变式并引用本文；
  同一条数值/层序不在两处各写一遍。
- 变更纪律：修改本文任一冻结值，必须同时改对应实现与测试；只改一处视为漂移。
- 相关正本：`docs/ART_DIRECTION.md`（风格与令牌）、`docs/ASSET_PIPELINE.md`（资源清单 schema）、
  `docs/FEEL_REVIEW.md`、`docs/ART_REVIEW.md`（语义评审记录）。

---

## 1. 背景

GOAL-005 / GOAL-006 的任务池已经由 goal driver 铺满（命中事件、hitstop、命中特效、命中音效、
飘字、收尾演出、默认画质、精灵管线、单位覆盖、场景接入、背景氛围、UI 字号、i18n、评审记录），
但实际并发只有 1–2 个：几乎每个任务都把 `docs/PRD.md` 与 `docs/TECH_DESIGN.md` 写进 `## Touches`，
调度器的 `touchesDisjointOrAged` 只能串行放行——**文档文件成了全局锁**，再加 worker 只会排队。

本 lane 把「每个任务各自改两份总文档」收口成「一个文档 lane 统一改一次」：

1. 本文件承接本阶段全部设计增量（决策、字段契约、事件分类、资源索引、AC 映射）；
2. 两份总文档只由文档 lane 做一次性增量与交叉引用；
3. 实现类任务把设计增量写进任务 Notes，不再把总文档写进 Touches。

清理前的实测：**13 个 open 任务**声明了 `docs/PRD.md` 或 `docs/TECH_DESIGN.md`；
清理后为 **0 个**（清单与判决见 §2.4，复跑 `node scripts/check-doc-ownership.mjs` 可复核）。

## 2. 范围

### 2.1 本 lane 交付

- 本文档（阶段决策 + 冻结表 + AC 映射）。
- `docs/PRD.md` / `docs/TECH_DESIGN.md` 的一次性增量与交叉引用（只做增量，不重写既有章节）。
- `CLAUDE.md` 的文档所有权约定（见 §2.3）。
- `scripts/check-doc-ownership.mjs`：文档锁热点检测；`tests/docs-phase-sync.test.mjs`：本文件的同步校验。
- open 任务池的 Touches 清理（经任务 ABI 写入，只摘两份总文档并追加 Notes）。

### 2.2 不在范围

- 不实现 AC-011…AC-031 的任何玩法、美术或音频功能；本 lane 不改变任何 AC 的判定口径。
- 不修改其他任务的 Proposal / Plan / AC / DoD，只摘 Touches 并追加一条 Notes。
- 不改变战斗数值、模拟、RNG、存档与计分。

### 2.3 文档所有权规则（与 `CLAUDE.md` 同步）

| 文档 | 谁可以改 | 说明 |
|---|---|---|
| `docs/PRD.md` | 仅文档 lane（`DOCS-*` 任务） | 玩家可见行为；实现任务不直接改 |
| `docs/TECH_DESIGN.md` | 仅文档 lane（`DOCS-*` 任务） | 技术契约与不变式；实现任务不直接改 |
| `docs/PHASE_*.md` | 该阶段的文档 lane | 阶段冻结表与 AC 映射 |
| 实现任务自身的 Notes | 实现任务 | 记录本任务引入的设计增量与偏差 |

- 实现类任务在 Plan 里发现需要写总文档时，改为：**把增量写进任务 Notes**，并在需要冻结契约时
  提醒文档 lane 收口；不得把两份总文档加入 Touches。
- 检查命令：`node scripts/check-doc-ownership.mjs`（exit 1 = 仍有 open 任务声明两份总文档）。
- 例外只有 `DOCS-*` 任务本身；其余任务（含 `todo` / `needs-human`）同样在检测范围内，
  避免任务一晋升 ready 就重新引入锁。

### 2.4 Touches 清理清单（实测：清理前 13 → 清理后 0）

| 任务 | 原状态 | 摘除的文档 | 现设计增量落点 |
|---|---|---|---|
| gap-audio-impacts | ready | PRD、TECH | 任务 Notes + 本文 §3.5 |
| gap-background-atmosphere-gate | ready | TECH | 任务 Notes + 本文 §4.5 |
| gap-culmination-shows | ready | PRD、TECH | 任务 Notes + 本文 §3.6 |
| gap-entity-sprite-coverage | todo | TECH | 任务 Notes + 本文 §4.3 |
| gap-floaters-layering | ready | PRD、TECH | 任务 Notes + 本文 §3.3 |
| gap-hitstop-camera-feedback | ready | PRD、TECH | 任务 Notes + 本文 §3.4 |
| gap-i18n-coverage-zero-hardcode | ready | PRD、TECH | 任务 Notes + 本文 §2.3 |
| gap-impact-class-feedback | todo | PRD、TECH | 任务 Notes + 本文 §3.2 |
| gap-mobile-visual-font-floor | ready | TECH | 任务 Notes + 本文 §4.5 |
| gap-scene-sprite-adoption | todo | TECH | 任务 Notes + 本文 §4.4 |
| gap-sprite-pipeline | ready | TECH | 任务 Notes + 本文 §4.2 |
| gap-ui-readability-font-floor | ready | TECH | 任务 Notes + 本文 §4.5 |
| gap-weapon-impact-vfx | ready | TECH | 任务 Notes + 本文 §3.2 |

清理后，`ready` 池里至少 4 个任务（hitstop / 命中音效 / 命中特效 / 飘字）的 Touches 两两不重叠，
可以同时 dispatch；文档锁从 N 次串行变成 1 次。

---

## 3. 命中反馈契约

### 3.1 事件源（AC-012，已落地）

每次实际扣血都在两个伤害汇点产出**只读**事件，写入 `sim.impactEvents`（环形上限 240）：

- 汇点一 `CombatSystem.damage()`；汇点二 `SkillSystem.skillDamage()`。
- 字段与语义的权威定义在 `docs/TECH_DESIGN.md` §4.6「结构化命中事件」，本文不复制。
- 本阶段所有消费端（飘字、特效、音效、镜头、类别层、高潮演出）**只读**该数组：
  不新增 RNG 调用、不修改模拟状态、不进存档/HUD 快照。
- 关闭反馈时事件仍逐次产出，只是消费者表现不同；同 seed「全开」「全关」两局的
  快照与 `combatRng` 序列逐字节一致。

### 3.2 命中层总表（z 序与预算优先级）

飘字层（`FLOATER_LAYERS`）冻结为九层；`z` 越大越在上层，预算裁剪时按「重要性」从高到低保留：

| 层 | 触发 | z | 基础字号 | 字重 | 颜色 | 后缀 | 重要性 |
|---|---|---|---|---|---|---|---|
| `damage` | 普通伤害数字 | 10 | 层默认 | 600 | 伤害色 | — | 9（最低） |
| `heal` | 治疗 `#7ef0a5` / 以 `+` 开头的数值 | 20 | 同上 | 600 | `#7ef0a5` | — | 8 |
| `reward` | 金币/奖励 | 30 | 同上 | 700 | 奖励色 | `+` | 7 |
| `status` | 首领技能名等非数字文案 | 40 | 同上 | 700 | 状态色 | — | 6 |
| `penalty` | 漏怪/基地受损 | 50 | 同上 | 700 | 危险色 | `-` | 5 |
| `armor` | 护甲吸收（AC-030） | 60 | 同上 | 700 | 护甲色 | `甲` | 4 |
| `bossHit` | 首领命中（AC-030） | 70 | 同上 | 800 | 首领色 | — | 3 |
| `shield` | 破盾（AC-030） | 80 | 同上 | 800 | 护盾色 | `破盾` | 2 |
| `crit` | 暴击（`big && 文本以 ! 结尾`） | 90 | 同上 + `big` 加成 | 800 | 暴击色 | `!` | 1（最高） |

- 「关键」档判据冻结为既有 `key || big`，**不扩大**到其他事件类别。
- 同层合并：同层 + 世界坐标 0.3 格内 + 0.12s 窗口内累加数字；不可合并的重复项丢弃。
- 帧内聚类：同层 0.22 格内聚类合并，按层重要性 → ttl 降序 → 原始下标升序稳定排序，
  截到预算，同层近邻按 0.16 格垂直错位。
- 每帧绘制预算：**关闭 0 / 仅关键 12 / 全部 28** 条。关闭与关键档在**生成侧**就减少对象，
  不是生成后隐藏。

### 3.3 飘字三档语义（AC-016）

| 档位 | 可见范围 | 帧预算 |
|---|---|---|
| `off` | 不生成 | 0 |
| `key` | 仅 `key || big`（暴击、关键伤害、金币、治疗、漏怪/基地受损、首领状态等） | 12 |
| `all` | 全部伤害，但必须合并、受帧预算约束 | 28 |

未知档位按 `all` 处理；裸飘字（无 `layer`/`key` 字段的旧数据）按既有签名推导层，不抛错。

### 3.4 镜头反馈（AC-013）

| 常量 | 值 | 含义 |
|---|---|---|
| `hitstopMin` / `hitstopMax` | 0.018s / 0.09s | 单次冻结时长上下限 |
| `shakeMax` | 7 | 震屏位移上限（逻辑像素） |
| `zoomMax` | 0.035 | 镜头缩放冲击上限 |
| `window` | 0.22s | 冲量衰减窗口 |
| `maxImpulses` | 6 | 同帧并发冲量上限 |

- 运动预算：`motion = !reducedMotion && settings.shake === true && settings.decorations !== 'off'`。
  `motion` 为假时 `shakeScale = zoomScale = 0`、`hitstopScale = 0.5`（冻结不是位移，保留但减半）、
  `flashScale = 1`（命中闪光与非运动染色照常绘制）。
- `hitstop`：`source === 'dot'` 为 0；其余按 `hpLost` 分级叠加 `crit` / `lethal` / 破盾，
  clamp 到上下限后乘 `hitstopScale`。冻结期模拟步进 `timeScale = 0.05`，渲染照常。
- 震屏方向：命中点 → 屏幕中心（镜头被推离命中点），±8° 播种抖动，幅度按 `hpLost/crit/lethal` 分级。
- 确定性：抖动用注入的种子 PRNG（同 seed 同序列），表现模块**不得**出现 `Math.random`，
  不得触碰 `sim.combatRng`。

### 3.5 命中音效（AC-014）

八种武器的命中音必须可区分；战旗不参战，其命中层定义为**光环脉冲**（`supportAuraPulse`），
同样计入声预算。

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

- 限流语义（`IMPACT_LIMITS`）：窗口 120ms 内最多 4 声；同武器间隔 60ms、全局间隔 16ms、
  每帧最多 3 声。超额按 `lethal > crit > 普通`（同级按 `hpLost`、再按 `t` 降序）保留。
- 簇音：同武器同窗口的连续命中合并为一次，增益 `×(1 + 0.12·min(n-1, 4))`；暴击与致死追加
  一个高频/低频装饰层，均计入同一声预算。
- 变调：由 `weapon + target.id + t` 的字符串哈希派生 ±18 音分的**确定性**变调，
  同一事件重放同音高；不得使用 `Math.random`。
- 总线：`impactGain → DynamicsCompressor → sfxGain → masterGain`；压缩参数
  `threshold=-16, knee=10, ratio=12, attack=0.003, release=0.25`（WebAudio 无专用限幅器，
  以高压缩比 + 快速启动实现限幅）。环境无 `createDynamicsCompressor` 时降级为
  `impactGain → sfxGain` 直连。
- 现有 `sfxGain.connect(masterGain)` 保持不变；限流/压缩只作用于表现，不改变模拟与结算。

### 3.6 高潮演出（AC-017）

| kind | 触发 | 横幅键 | 闪光 | 脉冲形态 | 时长 | timeScale |
|---|---|---|---|---|---|---|
| `leak` | 漏怪 | `feel.culmination.leak.*` | 红色边框 + 基地脉冲 | 以基地为中心的同心环 | 短 | 1 |
| `waveClear` | 清波 | `feel.culmination.waveClear.*` | 金色横扫 | 水平扫光 | 中 | 慢动作 |
| `bossKill` | 首领死亡 | `feel.culmination.bossKill.*` | 白闪 | 多层扩散环 | 长 | 慢动作 |

- 事件来源 `Simulation.addCulmination(kind, meta)`：只记录（环形上限 16），不调用 RNG、
  不读写结算、不播声音；`recordCulminations === false` 时关闭记录。
- 绘制层级：受击暗角之后、FPS 面板之前；未知 kind 跳过并计数，不抛错。
- 降级：`reducedMotion || !shake` 时 `timeScale = 1`、位移/缩放/扩散环归零，
  **保留静态横幅、色块与边框**（非运动反馈不降级）。
- 慢动作只缩放 `updateVisuals` 的视觉 dt，模拟步进不受影响。

### 3.7 设置降级矩阵

| 来源 | 运动（hitstop/震屏/缩放/扩散） | 飘字 | 特效粒子 | 音频 | 必须保留 |
|---|---|---|---|---|---|
| 系统 `prefers-reduced-motion` | 归零（hitstop 减半） | 按档位 | 保留最低 1 粒或「核心闪白 + 色环」 | 正常 | 横幅、色块、边框、命中闪光、类别飘字 |
| `settings.shake = false` | 位移/缩放归零 | 不变 | 不变 | 不变 | 同上 |
| `decorations = 'off'` | 运动归零 | 不变 | 装饰层关闭 | 不变 | 正文可读性、攻击提示 |
| `quality = low` | 运动按自动解析 | 不变 | 降至低档预算 | 不变 | 反馈类别可辨识 |
| `effects = 'off'` | 不变 | 不变 | 不生成 | 不变 | 飘字与横幅 |
| `floaters = 'off'` | 不变 | 不生成 | 不变 | 不变 | 特效与音效 |
| 静音 | 不变 | 不变 | 不变 | 不发声 | 视觉反馈完整 |

### 3.8 不变式（本阶段全部反馈层共用）

1. **只读事件**：`sim.impactEvents` / `sim.culminations` 只被消费，不被回写。
2. **确定性**：同 seed 的「全反馈」与「零反馈」两局，归一化快照与 `combatRng` 序列逐字节一致。
3. **无随机源**：表现模块（飘字、镜头、音效、特效、演出）不得出现 `Math.random`；
   需要抖动时用注入的种子 PRNG。
4. **生成侧减量**：关闭档减少对象生成/绘制，而不是先建后隐。
5. **不改变结算**：任何反馈层都不得修改伤害、敌人数、攻速、掉落、计分或 RNG 调用顺序。
6. **预算**：飘字 0/12/28；命中粒子 low ≤ 32 / high ≤ 128；音频每帧 ≤ 3 声、窗口 ≤ 4 声。

---

## 4. 精灵资源索引

### 4.1 清单与命名（ART-001 已定稿）

- 清单 schema、目录、图集、DPR、压缩、占位、授权与出处：`docs/ASSET_PIPELINE.md`（正本，本文不复制）。
- 实体命名：`<family>.<entity-id>.<state>`，如 `enemy.grunt.move`、`tower.arrow-longbow.attack`、
  `portal.spawn.charge`；`family` 取 `tower / enemy / summon / destructible / portal / base`。
- 锚点：单位固定脚底、塔固定塔基，保证不同帧不漂移；图集按 family 分组。
- 加载边界：只有 `status: "ready"` 的清单条目可被渲染层加载；`placeholder` 期间沿用程序化绘制，
  因此贴图迁移可以逐资源进行，不需要一次性切换渲染路径。
- 运行时色值与字号令牌的唯一来源仍是 `public/js/render/art-tokens.js`；
  风格、光照、剪影与对比度依据见 `docs/ART_DIRECTION.md`。

### 4.2 运行时管线契约（AC-022，规划中）

实现文件（尚未创建）：public/js/render/sprite-manifest.js、public/js/render/sprite-pipeline.js。

| 能力 | 契约 |
|---|---|
| 状态机 | `missing / pending / ready / failed / skipped`；`preload()` 永不 reject，单条失败只影响该 id |
| 帧解析 | `frame(id)` → `{ image, sx, sy, sw, sh, dw, dh, ax, ay }`；未知/未就绪/失败返回 `null` |
| 绘制 | `draw(ctx, id, x, y, {...})` 返回 `false` 时**不发起任何绘制**，渲染器据此走既有程序化绘制；就绪时恰好一次 `drawImage` |
| DPR | `configure({ dpr })` 只重选变体，不重复下载；DPR 仍以 `applyDpr()` 为唯一权威 |
| 内存 | `maxBytes` 超限时先丢 @2x，仍超则标记 `skipped`；`stats()` 暴露 `{ total, ready, failed, skipped, pending, bytes, inFlight }` |
| 失效 | `invalidate(id)` 递增 generation，过期回包丢弃；`dispose()` 后 `draw` 恒为 `false` |
| 回退 | 缺资源每个 id 只告警一次；实体/场景渲染器仍不得 `new Image`，只使用注入的管线 |

### 4.3 单位覆盖矩阵（AC-023，规划中）

| family | 权威 id 来源 | 数量 | 状态选择优先级 | 缺资源 |
|---|---|---|---|---|
| tower | `TOWERS` 8 型 + 每型 3 条进化 | 8 + 24 | `disabled > recoil > idle` | 程序化塔身 |
| enemy | `ENEMIES` 12 型 + `BOSS_VARIANTS` 3 变体 | 12 + 3 | `cast > hit > move` | 程序化敌人 |
| summon | 盟友 `kind`（当前 `skeleton`） | 1 | 攻击 > 移动 > 待机 | 程序化盟友 |
| destructible | `DESTRUCTIBLE_TYPES` | 5 | 存活 > 拆除中 > 已毁 | 程序化图形 |
| portal | 地图传送门 | 1 | 相位驱动 | 程序化传送门 |
| base | 地图基地 | 1 | 低血/受击闪白 | 程序化基地 |

- 进化形态：`tower.evolutions` 多选时取**最后一个已应用形态**作为主体，其余以挂饰精灵叠加或忽略
  （规则冻结）。
- 覆盖守卫：`entitySpriteIds()` / `coverageGaps(manifest)` 供测试枚举，新增实体忘记出图即红。
- 每实体 ≥2 状态、状态精灵 id 互不相同；新增 id 必须同时进清单与覆盖测试。

### 4.4 场景接入矩阵（AC-031，规划中）

| 场景 | 必需组 | 可选组 | 宿主 | 缺资源回退 |
|---|---|---|---|---|
| `title` | 标题背景、logo | 装饰粒子 | DOM（`<img>` / CSS 变量） | 既有程序化标题背景 |
| `map` | 选图卡片、地图缩略 | 徽标 | DOM | 既有卡片样式 |
| `combat` | 战斗背景、HUD 皮肤 | 氛围层 | Canvas（注入 `SpritePipeline`）+ DOM | 既有程序化背景与 HUD |
| `result` | 结算面板 | 徽章 | DOM | 既有结算面板样式 |

- 两个视口下的 id 集必须一致（DPR 变体可不同）；DOM 场景通过管线暴露的 URL 设置资源，
  Canvas 场景只用注入的管线绘制。
- 标记约定：命中精灵的元素带 `data-sprite-id="<id>"`；回退时带 `data-sprite-fallback="1"`。
- DOM 模块内不得 `new Image`；资源不可用时不抛错、不刷屏。

### 4.5 规范、验收与评审索引

| 主题 | 正本 / 命令 | 说明 |
|---|---|---|
| 风格、色板、光照、剪影、VFX 语言、字号阶梯 | `docs/ART_DIRECTION.md` | 令牌对比度报告由测试逐行重算 |
| 清单 schema、目录、图集、DPR、授权 | `docs/ASSET_PIPELINE.md` | 任何图片进渲染层前必须有合法条目 |
| 运行时令牌单源 | `public/js/render/art-tokens.js` | 渲染代码不得写裸色值 |
| 机械视觉验收（feel / art / ui / mobile） | `npm run visual:check`、`scripts/visual-check.mjs` | 阈值先实测再定值，注入必须能变红 |
| 确定性场景采集 | `tests/visual-scenes.mjs` | 同 seed 同视口可复现 |
| 语义评审记录 | `docs/FEEL_REVIEW.md`、`docs/ART_REVIEW.md` | 全新上下文评审，结论不可由执行者改写 |
| 可读性下限 | `docs/TECH_DESIGN.md` §14.4 | 可见文本 ≥12px；白名单仅 `.key` / `.glyph` |
| 背景与氛围 | `public/js/render/background-renderer.js` 与 art 套件 | 分带层次、氛围贡献、装饰单调性 |

---

## 5. AC 映射

状态口径：**done** = 已落地并有见证；**ready / todo** = 已立案、待实现；**goal** = goal 级退出条件，
无独立任务，按退出条件复跑见证；**superseded** = 已被其他任务覆盖。

| AC | 任务 | 状态 | 见证 | 文档落点 |
|---|---|---|---|---|
| AC-011 默认自动画质 | gap-auto-quality-default | done | 既有验收 | PRD §4.12、TECH §5.6 |
| AC-012 结构化命中事件 | gap-impact-events | done | `node --test tests/impact-events.test.mjs` | TECH §4.6、本文 §3.1 |
| AC-013 hitstop / 定向震屏 | gap-hitstop-camera-feedback | ready | node --test tests/hitstop.test.mjs | PRD §4.12、TECH §5.5、本文 §3.4 |
| AC-014 命中音效 | gap-audio-impacts | ready | node --test tests/audio-impacts.test.mjs | PRD §7、TECH §14.3、本文 §3.5 |
| AC-015 命中特效 | gap-weapon-impact-vfx | ready | 该任务验收测试 | 本文 §3.2、TECH §5.5 |
| AC-016 飘字分层 | gap-floaters-layering | ready | 该任务验收测试 | PRD §4.12、TECH §5.5、本文 §3.3 |
| AC-017 高潮演出 | gap-culmination-shows | ready | node --test tests/feel-culmination.test.mjs | PRD §4.14、TECH §5.5、本文 §3.6 |
| AC-018 场景机械指标 | VIS-001 | done | feel / art 套件 | TECH §8、本文 §4.5 |
| AC-019 打击感性能不回归 | —（goal 级） | goal | `npm run perf:budget` | PRD §9、TECH §8.4 |
| AC-020 打击感评审记录 | gap-feel-review-record | todo | `node scripts/feel-review.mjs --check` | `docs/FEEL_REVIEW.md` |
| AC-021 美术方向与资源规范 | ART-001 | done | `node --test tests/art-spec.test.mjs` | ART_DIRECTION、ASSET_PIPELINE、本文 §4.1 |
| AC-022 精灵管线 | gap-sprite-pipeline | ready | node --test tests/sprite-pipeline.test.mjs | TECH §5.5.3、本文 §4.2 |
| AC-023 单位精灵覆盖 | gap-entity-sprite-coverage | todo | node --test tests/sprite-coverage.test.mjs | TECH §5.5.3、本文 §4.3 |
| AC-024 背景与氛围指标 | gap-background-atmosphere-gate | ready | art 套件 + 注入红/绿 | TECH §8.3、本文 §4.5 |
| AC-025 UI 字号下限 | gap-ui-readability-font-floor | ready | `node scripts/visual-check.mjs --suite ui` | TECH §14.4、本文 §4.5 |
| AC-026 双语零缺译/零硬编码 | gap-i18n-coverage-zero-hardcode | ready | node --test tests/i18n-coverage.test.mjs | PRD §7、TECH §5.9、本文 §2.3 |
| AC-027 移动端字号下限 | gap-mobile-visual-font-floor | ready | `node scripts/visual-check.mjs --suite mobile` | TECH §14.4、本文 §4.5 |
| AC-028 视觉重制性能不回归 | —（goal 级） | goal | `npm run perf:budget` | PRD §9、TECH §8.4 |
| AC-029 美术语义评审记录 | gap-art-review-record | todo | `node scripts/art-review.mjs --check` | `docs/ART_REVIEW.md` |
| AC-030 命中类别层 | gap-impact-class-feedback | todo | node --test tests/impact-class-feedback.test.mjs | PRD §4.12、TECH §4.6、本文 §3.2 |
| AC-031 场景精灵接入 | gap-scene-sprite-adoption | todo | node --test tests/scene-sprites.test.mjs | TECH §5.5.3、本文 §4.4 |
