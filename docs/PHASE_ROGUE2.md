# 肉鸽养成 2.0 设计重基 · 阶段冻结表（PHASE_ROGUE2）

- 状态：**GOAL-011 / AC-054 设计重基收口**（gap-ac-054-rogue2-design-rebase，2026-10-30；
  口径沿自已退役的 DOCS-002 / AC-032，2026-10-27）
- 定位：本阶段**冻结表的唯一定义处**——派系归属、点数与 4/8/12 阈值、`setMods` 键、
  首领核心 / 契约卡 / 教义 / 觉醒的字段契约与快照口径。
  `docs/PRD.md` 只写玩家可见行为，`docs/TECH_DESIGN.md` 只写运行时不变式并引用本文；
  同一条数值不在两处各写一遍。
- 变更纪律：修改本文任一冻结值，必须**同一提交**改对应实现与测试；只改一处视为漂移。
- 相关正本：`docs/PROGRESSION_DESIGN.md`（v1.7–v1.9 分期与技能系统）、
  `docs/PHASE_FEEL_ART.md`（战斗反馈阶段表）、`docs/BALANCE.md`（平衡读数）。
- 验收判据：AC-054（`test -s docs/PHASE_ROGUE2.md && grep -q '五派系' docs/PHASE_ROGUE2.md &&
  grep -q '首领核心' docs/PHASE_ROGUE2.md`）；本表自身的见证测试是
  `tests/rogue2-design.test.mjs`。

---

## 1. 背景与重基范围

### 1.1 事实盘点（2026-10-27，读数即代码）

| 事实 | 旧稿（`docs/PROGRESSION_DESIGN.md` §3、§8 v1.9） | 当前代码实际 |
|---|---|---|
| 遗物池 | 「22 扩到约 33（+11）」 | **70 件**：普通 29 / 稀有 26 / 史诗 15，见 `public/js/shared/data/relics.js` |
| 遗物分级 | 只按稀有度 | 稀有度 × **Ⅲ 级上限**（基础 ×1 / ×1.6 / ×2.2） |
| 协同轴 | 「用 5 派系替换 6 标签套装」 | 6 个套装标签已上线：hunter / frost / guild / gambit / synergy / reserve，2/4 件档 |
| 主海克斯 | 未计入 | 10 个已实现，`public/js/shared/hexes/` |
| 敌人 | 目标 ≥12 | 12 类（含裂魂/裂生虫/战鼓魔/咒术师/石盾） |
| 首领核心 | 5 类选项、4 条觉醒 | 未实现 |
| 契约 / 教义 | 5 条 / 5 条 | 未实现 |

旧稿的数值和池子假设已经过期：按旧稿派实现任务会拿 33 件的分布去规划 70 件的池子，
并且与已上线的 6 套装加成层撞车。**本任务只做设计重基，不写实现代码。**

### 1.2 本表冻结什么

1. 70 件遗物逐件的派系归属（或中立），以及归属规则本身；
2. 点数公式、4 / 8 / 12 三档阈值、`setMods` 新键清单与各派系三档效果；
3. 首领核心 5 类选项、契约卡 5 条、教义 5 条、觉醒 P0 4 条的字段与事件；
4. 局内状态、事件与快照（v5）的字段契约；
5. 旧稿在 70 件池子上**不成立**的机制及替代口径（§10.1 裁决记录）。

### 1.3 本表不冻结什么

- 具体实现文件的分层与命名（由实现任务决定，但对外导出的符号名见 §8.1）；
- 平衡终值（`npm run balance` 的三档通关率由 GOAL-011 的 balance AC（AC-061）收口）；
- UI 布局与动效（只冻结字段与语义，不冻结像素）。

---

## 2. 派系重基

### 2.1 五个派系与中立

| 派系 id | 显示名 | 玩法身份 | 对应塔/资源 |
|---|---|---|---|
| `fire` | 火力 | **不依赖局势的稳定单发质量**：增伤、射程、弹道、溅射、暴击、破甲 | 弩塔 / 炮台 |
| `frost` | 霜缚 | 控制与易伤：减速强度、减速时长、冻结、被减速目标增伤 | 霜塔 |
| `venom` | 蚀毒 | 持续伤害与扩散：毒 DPS、毒塔增伤、中毒易伤、中毒传播 | 毒雾塔 |
| `storm` | 雷暴 | 每秒频次与连锁：攻速、射程、连锁目标、连锁范围 | 电弧塔 |
| `warden` | 守护 | 以基地生命为赌注：基地生命、波次回复、空位增伤、**低血背水增伤** | 基地 |
| `neutral` | 中立 | 经济与经营：金币、利息、折扣、赏金、满金币条件型 | 商店 |

`neutral` 不是派系：**不计点、不参与信物三选一、不可被「搜寻」指定**。

派系的 id 是英文小写单值，显示名走 i18n（`public/js/shared/i18n/`）。
实现冻结顺序（供开局展示与同 seed 洗牌保持稳定）：

```js
export const FACTION_ORDER = ['fire', 'frost', 'venom', 'storm', 'warden'];
```

### 2.2 点数与阈值

```js
points(faction) = Σ clamp(level, 1, 3)   // 该派系每件已拥有遗物的等级之和
                + bonusPoints(faction)    // 仅由契约写入的加点覆盖层
tier(faction)   = 0 | 1 | 2 | 3          // 4 → 1，8 → 2，12 → 3
```

冻结不变式：

1. **主来源是遗物等级**：没有契约时，点数 ≡ 该派系已拥有遗物的等级之和（accept 仪器按此校验）；
2. `bonusPoints` 单派系上限 **+3**，只由契约卡写入，UI 必须与遗物点数分色显示；
3. 中立遗物不计点，也不产生 `bonusPoints`；
4. 阈值只认下界：4/8/12 三档，超过 12 不再有第四档（Ⅲ 级遗物已到顶）；
5. 每件满级遗物 3 点 ⇒ **任何派系只要有 4 件可升至 Ⅲ 的遗物即可摸到 T3**，与派系规模无关。

| 档位 | 点数 | 语义 |
|---|---|---|
| T1 | 4 | 拿到方向（≈ 两件 Ⅱ 级或一件 Ⅲ + 一件 Ⅰ） |
| T2 | 8 | 流派成型 |
| T3 | 12 | 本派系投入上限 |

### 2.3 70 件遗物逐件归属

依据码见 §2.4；「旧 set」列是当前 `relics.js` 的 `set` 字段，仅作迁移对照，
**不再是加成来源**（退役步骤见 §10.2）。

#### 火力（`fire`）— 11 件

| id | 名称 | 稀有度 | 现有 mods | 旧 set | 依据 |
|---|---|---|---|---|---|
| sharp | 锐利箭簇 | 普通 | dmg.arrow 0.25 | hunter | A1 |
| eagle | 鹰眼徽记 | 普通 | range 1 | hunter | A1 |
| steadyaim | 稳定瞄准 | 普通 | range 0.6 | hunter | A1 |
| velocity | 弹道加速 | 普通 | projSpeed 0.5, dmgAll 0.06 | hunter | A1 |
| powder | 火药桶 | 稀有 | dmg.cannon 0.2, splash 0.35 | — | A1 + A3 |
| siege | 攻城配重 | 稀有 | dmg.cannon 0.3, range 0.6 | — | A1 |
| skyfall | 天火共鸣 | 稀有 | splash 0.25, dmgAll 0.05 | — | A3 |
| crit | 致命一击 | 稀有 | crit 0.2 | hunter | A2 |
| bosslayer | 泰坦杀手 | 稀有 | bossDmg 0.5 | — | A4 |
| pierce | 破甲弹头 | 稀有 | armorPierce 0.5 | — | A4 |
| warlord | 战争领主 | 史诗 | dmgAll 0.18 | — | A1 |

#### 霜缚（`frost`）— 8 件

| id | 名称 | 稀有度 | 现有 mods | 旧 set | 依据 |
|---|---|---|---|---|---|
| frostglint | 霜纹刻印 | 普通 | dmg.frost 0.18 | frost | B2 |
| frostedge | 霜刃磨石 | 普通 | dmg.frost 0.1, slow 0.05 | frost | B1 + B2 |
| frostlattice | 霜晶格栅 | 普通 | dmg.frost 0.12, slow 0.03 | frost | B1 + B2 |
| frostheart | 极寒之心 | 稀有 | slow 0.15, slowDur 0.3 | frost | B1 |
| auroraveil | 极光帷幕 | 稀有 | frostDmgBonus 0.1, slowDur 0.2 | frost | B1 + B2 |
| frostbite | 寒霜易伤 | 史诗 | frostDmgBonus 0.2 | frost | B2 |
| moonwell | 月井之泉 | 普通 | slow 0.04, slowDur 0.1 | synergy | B1 |
| stasislens | 凝时棱镜 | 史诗 | fireRate 0.12, range 0.4, slowDur 0.15 | synergy | B1（主效果 slowDur） |

#### 蚀毒（`venom`）— 7 件

| id | 名称 | 稀有度 | 现有 mods | 旧 set | 依据 |
|---|---|---|---|---|---|
| venomfang | 淬毒护符 | 普通 | dmg.poison 0.18 | — | C1 |
| venomvial | 毒液小瓶 | 普通 | dmg.poison 0.1, dot 0.1 | — | C1 |
| toxin | 毒性催化 | 稀有 | dot 0.45 | — | C1 |
| alchemy | 炼金秘方 | 稀有 | dmg.poison 0.25, dot 0.3 | — | C1 |
| embertrace | 余烬星痕 | 普通 | dot 0.1, splash 0.05 | synergy | C1（主效果 dot） |
| cometcore | 彗星核心 | 稀有 | dot 0.2, splash 0.12 | synergy | C1（主效果 dot） |
| starforge | 星铸炉心 | 史诗 | dmgAll 0.08, dot 0.12, slow 0.03 | synergy | C1（主效果 dot） |

#### 雷暴（`storm`）— 8 件

| id | 名称 | 稀有度 | 现有 mods | 旧 set | 依据 |
|---|---|---|---|---|---|
| sparkplug | 火花塞 | 普通 | dmg.arc 0.15 | — | D1 |
| static | 静电过载 | 稀有 | dmg.arc 0.25, chain 1 | — | D1 |
| stormpulse | 雷暴脉冲 | 史诗 | dmgAll 0.1, fireRate 0.1 | — | D1 + D2 |
| quickdraw | 急速装填 | 普通 | fireRate 0.12 | — | D2 |
| scouthorn | 侦察号角 | 普通 | range 0.4, fireRate 0.05 | — | D2 |
| warhorn | 战争号角 | 史诗 | fireRate 0.25 | — | D2 |
| eclipsehour | 蚀时印记 | 史诗 | fireRate 0.18, range 0.5 | — | D2 |
| adrenaline | 肾上腺素 | 稀有 | fireRate 0.1, lowHpDmg 0.1 | gambit | D2（攻速为主效果） |

#### 守护（`warden`）— 19 件

| id | 名称 | 稀有度 | 现有 mods | 旧 set | 依据 |
|---|---|---|---|---|---|
| crystal | 生命结晶 | 普通 | baseHp 5 | — | E1 |
| sandbag | 沙袋工事 | 普通 | baseHp 3 | — | E1 |
| bastion | 钢铁壁垒 | 史诗 | baseHp 10 | — | E1 |
| emberclock | 余烬节拍 | 普通 | waveHeal3 1 | — | E2 |
| metronome | 战律节拍 | 稀有 | waveHeal4 2 | — | E2 |
| starcycle | 星轨轮转 | 稀有 | waveHeal5 3 | synergy | E2 |
| openfield | 旷野火力 | 普通 | emptySlotDmg 0.08 | reserve | E3 |
| lightsentry | 轻装哨戒 | 稀有 | emptySlotDmg 0.14 | — | E3 |
| palaceguard | 空庭守卫 | 史诗 | emptySlotDmg 0.24 | — | E3 |
| bloodpact | 血誓木牌 | 普通 | lowHpDmg 0.12, crit 0.05 | — | E4 |
| bloodstake | 血脉赌注 | 普通 | lowHpDmg 0.08 | gambit | E4 |
| gambitseal | 赌誓封印 | 普通 | lowHpDmg 0.09 | gambit | E4 |
| desperado | 亡命之徒 | 普通 | lowHpDmg 0.1 | reserve | E4 |
| martyr | 殉道誓约 | 稀有 | lowHpDmg 0.12, crit 0.06 | gambit | E4 |
| lastbreath | 残喘之息 | 稀有 | lowHpDmg 0.16 | — | E4 |
| bloodybanner | 血色战旗 | 稀有 | lowHpDmg 0.17 | — | E4 |
| laststand | 背水一战 | 史诗 | lowHpDmg 0.35 | — | E4 |
| bloodtide | 血潮契约 | 史诗 | lowHpDmg 0.3, killGold 2 | — | E4 |
| doomclock | 末日时钟 | 史诗 | lowHpDmg 0.2, crit 0.1 | gambit | E4 |

#### 中立（`neutral`）— 17 件

| id | 名称 | 稀有度 | 现有 mods | 旧 set | 依据 |
|---|---|---|---|---|---|
| bounty | 赏金猎人 | 普通 | killGold 2 | hunter | N1 |
| thrifty | 精打细算 | 普通 | costMul -0.08 | guild | N1 |
| coinpurse | 鼓胀钱袋 | 普通 | killGold 1 | guild | N1 |
| spareparts | 备用零件 | 普通 | costMul -0.05, killGold 1 | guild | N1 |
| usury | 利滚利 | 稀有 | interest 0.05 | guild | N1 |
| cartel | 黑市商会 | 稀有 | goldMul 0.15, costMul -0.05 | guild | N1 |
| greed | 贪婪之神 | 史诗 | goldMul 0.3 | guild | N1 |
| gamblerscoin | 赌徒金币 | 稀有 | crit 0.12, interest 0.03 | — | N1（赌徒=经济） |
| goldencoffer | 黄金宝库 | 普通 | richDmg 0.07 | reserve | N2 |
| warchest | 战争金库 | 稀有 | richDmg 0.13 | reserve | N2 |
| midasthrone | 迈达斯王座 | 史诗 | richDmg 0.22 | reserve | N2 |
| highroller | 孤注一掷 | 普通 | lowHpDmg 0.06, killGold 1 | gambit | N3 |
| bloodmoney | 血色财富 | 稀有 | lowHpDmg 0.1, richDmg 0.1 | — | N3 |
| harvestsickle | 收割镰刀 | 普通 | waveGold2 6 | — | N1 |
| tideglass | 潮汐沙漏 | 稀有 | waveGold3 14 | — | N1 |
| moonlitvault | 月影金库 | 稀有 | waveGold5 18 | — | N1 |
| eternalhourglass | 永恒沙漏 | 史诗 | waveGold5 35 | — | N1 |

**覆盖核对**：11 + 8 + 7 + 8 + 19 + 17 = **70**，与 `RELICS.length` 逐件相等，无重复、无遗漏。
测试以 `data/relics.js` 的 live 数组反查（§11），不维护第二份手写清单。

### 2.4 归属规则（先定规则，再逐件套用）

按优先级从高到低，一条遗物命中即停：

1. **N3 经济红线**：只要带任何经济效果（`killGold` / `goldMul` / `interest` / `costMul` /
   `waveGold*` ），**一律中立**。理由：经济遗物进战斗派系会把金币复利变成派系点数，形成滚雪球。
2. **N2 金币条件型**（`richDmg`）归中立：条件是经济状态，身份也是经济。
3. **E4 低血条件型**（`lowHpDmg`）归守护：条件型遗物的身份由**触发资源**决定，
   而低血条件的触发资源是「基地生命」——守护派的资源轴。这同时让守护派拥有
   「撑住基地 → 触发背水 → 反杀」的完整叙事，而火力派保持**不依赖局势**的稳定质量。
4. **C1 毒**、**B1/B2 减速与霜**、**D1 电弧与连锁**：按主效果所属塔轴归属。
5. **D2 攻速 / 射程**归雷暴：雷暴的独特资源是「每秒命中频次与连锁次数」，与火力的「单发质量」互斥。
6. **A 系列**（增伤、溅射、暴击、破甲、对首领）归火力。
7. **E1/E2/E3**（基地生命、波次回复、空位增伤）归守护。
8. 混合型按**主效果**归属；主效果等权时按第 1–3 条的触发资源判定。

**不可归类项记录**：`stasislens`（攻速 + 射程 + 减速时长，三轴等权）按「持续性控制」归霜缚；
`embertrace` / `cometcore`（毒 + 溅射）按主效果 dot 归蚀毒；`gamblerscoin`（暴击 + 利息）
按经济红线归中立——这三类共 4 件是本池里唯一需要人工裁决的，其余 66 件规则唯一确定。

### 2.5 规模分布与补偿口径

| 派系 | 火力 | 霜缚 | 蚀毒 | 雷暴 | 守护 | 中立 |
|---|---|---|---|---|---|---|
| 件数 | 11 | 8 | 7 | 8 | 19 | 17 |
| 拿满 12 点所需件数 | 4 | 4 | 4 | 4 | 4 | 不适用 |

- 分布不均**不影响阈值可达性**：每派系 ≥4 件即可满 12 点（4 × Ⅲ 级）；
- 普通三选一按**稀有度权重**抽取、不按派系加权，因此派系规模只影响「搜寻」「信物」的选择面，
  不改变每波的遗物分布；
- 守护偏厚（19 件含全部低血遗物）与蚀毒偏薄（7 件）是当前池子的既成事实，
  记入 P1 补池方向：**下一步优先补蚀毒/雷暴向遗物**，不通过挪动归属来凑数。
- `neutral` 17 件不参与信物与搜寻，等价于「经济不构成流派方向」。

---

## 3. `setMods` 契约

### 3.1 分层与乘区

`setMods` 是**派系三档效果的唯一落点**，与遗物 `mods` 是两层：

```
最终增伤乘区 = (1 + cappedRelicBonus) × (1 + setMods.allDamage)
```

- **不写入 `mods`**：派系层不调用 `applyEffect` / `clampMods`；
- **不参与旧上限**：`setMods` 的值**绝不**塞进 `GLOBAL_MOD_CAPS` / `PER_RELIC_CAPS`，
  因为三档效果是按「4/8/12 点的构筑承诺」定价的，被单件上限裁剪会直接失效；
- **0 档返回 `{}`**：`factionSetMods({})` 必须是空对象；
- 未知键**必须报错**（与 `EFFECT_REGISTRY` 一致的不静默原则），注册表放在新的 `setMods` 命名空间。

### 3.2 新键清单

| 键 | 类型 | 派系/档 | 语义 | 结算点 |
|---|---|---|---|---|
| `allDamage` | number | 火力 T1 | 独立增伤乘区（与遗物增伤相乘） | 伤害入口 |
| `critDamage` | number | 火力 T2 | 暴击额外倍率（默认 0；暴击总倍率 2.0 + 值） | 暴击判定 |
| `killExplosion` | `{ratio, radius}` | 火力 T3 | 击杀时对半径内敌人造成 ratio × 本次伤害 | 击杀钩子 |
| `slowDuration` | number | 霜缚 T1 | 减速时长倍率加成 | 施加减速 |
| `frostFreeze` | `{hits, duration}` | 霜缚 T2 | 每 N 次冰霜命中冻结 duration 秒 | 霜塔命中 |
| `freezeVulnerable` | `{mult, duration}` | 霜缚 T3 | 解冻后 duration 秒内受伤 +mult | 解冻结算 |
| `poisonSlow` | number | 蚀毒 T1 | 中毒目标移速 −值 | 敌人移动 |
| `poisonVulnerable` | number | 蚀毒 T2 | 中毒目标受到的所有伤害 +值 | 伤害入口 |
| `poisonSpread` | `{radius, targets, layers}` | 蚀毒 T3 | 中毒死亡向半径内 targets 个敌人传播 | 击杀钩子 |
| `chainExtra` | number | 雷暴 T1 | 连锁目标 +N | 电弧开火 |
| `chainRange` | number | 雷暴 T2 | 连锁跳转范围 +N 格 | 电弧开火 |
| `chainCrit` | boolean | 雷暴 T3 | 连锁可以暴击 | 连锁伤害 |
| `leakIgnoreChance` | number | 守护 T1 | 漏怪时按概率免伤 | 漏怪结算 |
| `leakDamageReduction` | number | 守护 T2 | 漏怪伤害 −N（下限 1） | 漏怪结算 |
| `setWaveHeal` | `{every, amount, capPerRun}` | 守护 T3 | 每 every 波回复 amount 点，每局上限 capPerRun | 波末结算 |

**同键加算**：不同来源的同名键（例如雷暴 T1 的 `chainExtra` 与「电弧塔·过载」教义的连锁 +1）
按数值相加，不相乘；布尔键取或。

### 3.3 各派系 4/8/12 效果表（唯一数值表）

| 派系 | T1（4 点） | T2（8 点） | T3（12 点） |
|---|---|---|---|
| 火力 | 全体伤害 **+6%**（`allDamage` 0.06） | 暴击伤害 **+40%**（`critDamage` 0.4；暴击倍率 2.0 → 2.4） | 击杀爆炸：0.9 格内 **50%** 本次伤害（`killExplosion` `{ratio:0.5, radius:0.9}`） |
| 霜缚 | 减速持续 **+15%**（`slowDuration` 0.15） | 每 **10** 次冰霜命中冻结 **0.6s**（`frostFreeze` `{hits:10, duration:0.6}`） | 解冻后 **2s** 内受伤 **+25%**（`freezeVulnerable` `{mult:0.25, duration:2}`） |
| 蚀毒 | 中毒目标移速 **−8%**（`poisonSlow` 0.08） | 中毒目标受到的所有伤害 **+12%**（`poisonVulnerable` 0.12） | 中毒死亡向 **1.5 格**内 **2** 个目标传播 **1 层**（`poisonSpread`） |
| 雷暴 | 连锁目标 **+1**（`chainExtra` 1） | 连锁范围 **+0.4 格**（`chainRange` 0.4） | 连锁**可以暴击**（`chainCrit` true） |
| 守护 | 漏怪 **20%** 概率免伤（`leakIgnoreChance` 0.2） | 漏怪伤害 **−1**，最低 1（`leakDamageReduction` 1） | 每 **3** 波回复 **1** 点，每局上限 **5**（`setWaveHeal` `{every:3, amount:1, capPerRun:5}`） |

### 3.4 与旧 caps 的关系（红线）

1. `setMods` 不进入 `relicMods`，`recomputeMods` 的产物不变；
2. 新增的任何 `setMods` 键都**不得**出现在 `PER_RELIC_CAPS` / `GLOBAL_MOD_CAPS` 里；
3. 旧 caps 仍然裁剪遗物 `mods`（这套上限是 70 件池子的防爆阀，不动）；
4. 若某个 `setMods` 效果需要复用既有状态（冻结复用 `freezeUntil` / `freezeVuln` /
   `freezeVulnUntil`，中毒复用 `poisonDps` / `poisonUntil`），**只读既有字段的语义，不改字段结构**；
   需要扩展状态时在 §8.2 登记后方可实现。

---

## 4. 首领核心

### 4.1 波次与选择规则

- 固定波次：**`CORE_WAVES = [5, 10, 15, 20, 25]`**，清波后发放；第 30 波改为结算展示构筑。
- 每次 **3 选 1，不可刷新**（刷新按钮在核心弹窗内禁用，不消耗刷新次数）。
- 与现有 `offers` 存储复用：同一弹窗顶部展示核心条，不新增弹窗层级。
- 发放口径：服务端能验证「首领波已清」，**不能**验证「是否真的击杀首领」；
  文档与 UI 一律按「清波即发放」。

### 4.2 五类选项字段表

| `kind` | 可用波次 | 载荷字段 | 行为 |
|---|---|---|---|
| `upgrade` | 5 / 10 / 15 / 20 / 25（**始终出现**） | `{ kind, targetMax: 3 }` | 列出全部未满级遗物，选 1 件 +1 级 |
| `search` | 5 起 | `{ kind, faction, options: [{ id, toLevel }] }` | 先选非中立派系，再从 3 件该派系遗物中选 1（15 波起候选中可出现史诗） |
| `awakening` | **10 起** | `{ kind, options: [{ relicId, awakeningId }] }` | 从已拥有 Ⅲ 级遗物中选 1 件授予觉醒；无 Ⅲ 级遗物时该选项不出现 |
| `doctrine` | **10 起**，每局上限 2 | `{ kind, doctrineId, options: [doctrineId ×3] }` | 从 3 条未选教义中选 1，不可逆 |
| `supply` | **仅第 5 波**兜底 | `{ kind, options: [{ type:'maxHp', amount:2 }, { type:'gold', amount:80 }, { type:'reroll', amount:1 }] }` | 资源补给，避免第 5 波空窗 |

`rollCoreOffers(seedKey, wave, relicStates, opts)` 的确定性约束（accept 仪器逐条校验）：

1. 返回**恰好 3 个**选项，`kind` 互不重复；
2. **每次都含 `upgrade`**；
3. `wave < 10` 时不得出现 `awakening` / `doctrine`（即使 `opts` 传 true）；
4. `wave === 5` 时 `supply` 可出现，其他波次不出现；
5. `wave >= 10` 时 `awakening` / `doctrine` 必须能进入候选（跨 seed 至少各出现一次）；
6. 同一 `(seedKey, wave, relicStates, opts)` 输出完全一致。

### 4.3 `applyCore`

```js
applyCore(state, choice) → { state, event }
// state: 局内肉鸽状态（§8.2）
// choice: { kind, ...载荷 }，必须来自本次 offers
// event:  §8.3 的 core_taken 事件
```

副作用只允许改客户端可模拟的资源：遗物等级、派系 `bonusPoints`、金币、基地生命、刷新次数、
教义集合、觉醒集合。**不得**改敌人 HP / 速度 / 入口（服务端波次生成是红线）。

---

## 5. 契约卡

### 5.1 出现规则

- 波次：**9 / 14 / 19 / 24**（`wave % 5 === 4` 且 `wave >= 9`）。
- 表现：用 1 张契约卡**替换**三选一里的 1 张遗物卡；同一弹窗、仍是 3 张卡。
- 每局最多接受 **2** 次；达到上限后 `rollContractOffer` 返回 `null`。
- 契约卡是整组三选一的一部分，**可随整组刷新掉**（消耗正常刷新次数）；
  与核心的「不可刷新」是两条独立规则，不冲突。
- 只改客户端可模拟的资源，**绝不改敌人 HP / 速度 / 入口**。

### 5.2 五条契约表

| id | 名称 | 代价 | 收益 | chip 作用域 |
|---|---|---|---|---|
| `blood` | 血契 | −2 最大生命（当前生命同步扣减，最低 1） | 指定派系 1 件**稀有以上**遗物 | 本局 |
| `debt` | 债契 | −35% 当前金币（最低保留 60）、−1 刷新 | 1 件**随机史诗** | 本局 |
| `poverty` | 贫契 | 下一波三选一只有 2 张 | 目标派系 **+2** `bonusPoints` | 本波 |
| `sloth` | 惰契 | 下一波全体塔攻速 −12% | +150 金币、+2 生命 | 本波 |
| `burn` | 焚契 | 焚毁 1 件未满级遗物 | 目标派系 **+3** `bonusPoints` | 本局 |

### 5.3 字段与 chip

```js
// 定义
{ id, nameKey, cost: { kind, ... }, benefit: { kind, ... }, chip: { scope: 'wave'|'run' } }
// 局内记录（快照）
{ id, wave, scope, untilWave }   // 本波 chip 记 untilWave = 当前波 +1；本局 chip 记 untilWave = null
```

- `rollContractOffer(seedKey, wave, state)`：仅在 §5.1 波次返回非 `null`；其他波次返回 `null`。
- `state` 只读字段冻结为：`accepted`（已接受数）、`gold`、`hp`、`maxHp`、`rerolls`、
  `relics`（已拥有遗物状态）、`nextOfferCount`（下一波卡数）。
- `applyContract(state, contractId)` 返回 `{ state, event }`；**代价先于收益结算**，
  代价不成立（如金币不足且不足下限）时整张卡不可用（UI 置灰，不消耗选择）。

---

## 6. 教义

### 6.1 规则

- 每局上限 **2** 次，只通过首领核心的 `doctrine` 选项获得，**不可逆**。
- 对**某一种塔的全部塔**生效（已建与后续新建都生效），塔身加徽记。
- 与派系 `setMods` 的同类键**加算**（§3.2「同键加算」）。

### 6.2 五条教义表

| id | 塔 | 名称 | 效果 | 结算点 |
|---|---|---|---|---|
| `bolt` | 弩塔 | 穿透 | 箭矢穿透 1 个目标（第 2 个目标承受 60% 伤害） | 投射物命中 |
| `cannon` | 炮台 | 燃烧 | 落点附加 2s 燃烧，每秒造成 15% 攻击力 | 溅射落点 |
| `frost` | 霜塔 | 冰封 | 对**已减速**目标的伤害 +25% | 霜塔伤害 |
| `arc` | 电弧塔 | 过载 | 连锁目标 +1、连锁范围 +0.8 格 | 电弧开火 |
| `poison` | 毒雾塔 | 疫病 | 命中时向 0.8 格内最多 2 个敌人扩散 60% 毒伤（不叠层） | 毒雾命中 |

```js
export const DOCTRINE_IDS = ['bolt', 'cannon', 'frost', 'arc', 'poison'];
applyDoctrine(state, doctrineId) → { state, event }
```

---

## 7. 觉醒

### 7.1 规则

- 只通过首领核心 `awakening` 选项获得（第 10 波起），目标必须是一件**已拥有且 Ⅲ 级**的遗物；
  **不消耗原遗物**，觉醒是一次附加行为词条。
- 每件遗物最多 1 条觉醒；同一遗物重复出现时从候选中剔除。

### 7.2 P0 四条（本阶段实现）

| id | 遗物 | 觉醒词条 |
|---|---|---|
| `sharp-pierce` | sharp 锐利箭簇 | 弩塔每第 6 发穿透 2 个目标（穿透目标承受 60% 伤害） |
| `powder-ignite` | powder 火药桶 | 炮台命中同一目标 5 次后，落点燃烧 2s（每秒 20% 攻击力） |
| `frostheart-shatter` | frostheart 极寒之心 | 被减速目标死亡时 1.2 格霜爆冻结 0.4s |
| `toxin-spread` | toxin 毒性催化 | 中毒死亡传播 1 层，最多 3 跳 |

```js
export const AWAKENING_IDS = ['sharp-pierce', 'powder-ignite', 'frostheart-shatter', 'toxin-spread'];
awakeningFor(relicId) → 定义 | null
```

### 7.3 P1 四条（顺延，不在本阶段验收）

| id | 遗物 | 觉醒词条 |
|---|---|---|
| `static-chain` | static 静电过载 | 连锁目标 +1 且不衰减（原稿「连锁可暴击」与雷暴 T3 重复，已裁决改口径，见 §10.1） |
| `crit-splash` | crit 致命一击 | 暴击对 1 格内溅射 50% |
| `laststand-fury` | laststand 背水一战 | 基地 < 50% 时攻速 +80% |
| `bastion-retaliate` | bastion 钢铁壁垒 | 漏怪后 3s 内全体伤害 +50% |

---

## 8. 数据、事件与快照契约

### 8.1 模块导出契约（实现任务必须逐符号对齐）

`public/js/shared/` 下新建五个模块；**导出名是本表与 accept 仪器的共同契约，不得改名**：

| 模块（位于 `public/js/shared/`） | 必需导出 |
|---|---|
| `factions.js` | `FACTION_ORDER`（5 项）、`FACTION_NAMES`、`factionPoints(states)`、`factionTiers(states)`、`factionSetMods(tierByFaction)`、`relicFaction(id)` |
| `relics.js`（既有，增量） | 每件遗物新增 `faction` 字段；`rollStarterOffers(seedKey, mode)`；`rollRelicOffers` 增加第 3 波保底升级卡 |
| `cores.js` | `CORE_WAVES`、`CORE_KINDS`、`rollCoreOffers(seedKey, wave, relicStates, opts)`、`applyCore(state, choice)` |
| `contracts.js` | `CONTRACT_IDS`（5 项）、`rollContractOffer(seedKey, wave, state)`、`applyContract(state, contractId)` |
| `doctrines.js` | `DOCTRINE_IDS`（5 项）、`applyDoctrine(state, doctrineId)` |
| `awakenings.js` | `AWAKENING_IDS`（4 项）、`awakeningFor(relicId)`、`applyAwakening(state, relicId)` |

函数签名细节：

```js
factionPoints(states)      // [{id, level}] → { fire, frost, venom, storm, warden }（中立不出键）
factionTiers(states)       // 同上 → 同键，值 0..3
factionSetMods(tierByFaction) // { fire: 3 } → setMods 对象；0 档/空输入返回 {}
rollStarterOffers(seedKey, mode) // → [{ kind:'relic', id, fromLevel:0, toLevel:1 } × 3]
```

**信物三选一冻结**：3 张卡必须来自**三个不同派系**、不含中立、都是 Ⅰ 级新遗物；
同一 `(seedKey, mode)` 可复现。

**第 3 波保底升级卡冻结**：`wave >= 3` 且存在「已拥有但未满级」遗物时，
`rollRelicOffers` 的三张卡里**必须有一张**是该遗物（`fromLevel >= 1`）的升级卡。
池子扩到 70 件后新卡占比更高，升级更难发生，因此**保留**这条保底（见 §10.1）。

### 8.2 局内状态字段

```js
sim.factions = {
  points: { fire, frost, venom, storm, warden },
  bonusPoints: { fire, frost, venom, storm, warden },   // 仅契约写入，单派系 <= 3
  tiers: { fire, frost, venom, storm, warden },         // 0..3
  setMods: {},                                          // §3.2 扁平对象
}
sim.rogue2 = {
  starter: { offers: [id × 3], picked: id | null },
  coreTaken: [{ wave, kind, choice }],
  contracts: [{ id, wave, scope, untilWave }],
  doctrines: [doctrineId],
  awakenings: [{ relicId, id }],
}
```

不变式：

1. `points` / `tiers` / `setMods` 在**遗物变化、契约结算、核心结算**后由 `recomputeFactions()` 统一重算，
   模拟步内不重建对象（与塔属性缓存同一纪律）；
2. `bonusPoints` 变更必须触发重算；`bonusPoints` 永不写入 `points`（分色显示靠它）；
3. 旧局（无 `faction` 数据的存档）按 `neutral` 处理，点数为 0，行为与无 2.0 一致。

### 8.3 事件字段

新增四类事件，写入既有的 run 事件流（与 `sim.events` 分离，属服务端/回放侧）：

| `type` | 字段 |
|---|---|
| `core_taken` | `{ type, wave, kind, choice, seedKey }` |
| `contract_accepted` | `{ type, wave, id, cost, benefit }` |
| `doctrine_chosen` | `{ type, wave, id, towerType }` |
| `awakening_gained` | `{ type, wave, relicId, id }` |

### 8.4 快照 v5

快照升到 **v5**，新增 `rogue2` 块；v2–v4 快照照常读取，缺失 `rogue2` 时按 §8.2 的空值处理：

```json
{
  "v": 5,
  "rogue2": {
    "starter": { "offers": ["sharp", "frostglint", "sparkplug"], "picked": "sharp" },
    "points": { "fire": 4, "frost": 0, "venom": 0, "storm": 1, "warden": 0 },
    "bonusPoints": { "fire": 0, "frost": 0, "venom": 0, "storm": 0, "warden": 0 },
    "coreTaken": [{ "wave": 5, "kind": "upgrade", "choice": { "relicId": "sharp" } }],
    "contracts": [],
    "doctrines": [],
    "awakenings": []
  }
}
```

`tiers` 与 `setMods` **不进快照**（可由 `points` 纯函数重算），避免快照里出现两份可能不一致的读数。

---

## 9. 确定性与反作弊

1. 所有抽取用**独立种子流**，不触碰 `combatRng`：
   - 信物 `${seed}:starter:${mode}`
   - 核心 `${seed}:core:${wave}`；`search` 用 `${seed}:core:${wave}:search`
   - 契约 `${seed}:contract:${wave}`
2. `sim` 内**不抽卡**：核心/契约/教义的候选都由服务端按种子生成，与现有遗物三选一同口径。
3. 服务端只做粗校验：核心波次与 `CORE_WAVES` 对齐、契约次数 ≤ 2、教义次数 ≤ 2、
   觉醒目标遗物等级 = Ⅲ；不信任客户端上报的等级与点数。
4. 回放：`coreTaken` / `contracts` / `doctrines` / `awakenings` 是回放的重放输入，
   由 `seedKey` 校验候选一致；不一致即判回放失效。

---

## 10. 迁移清单与旧稿裁决记录

### 10.1 旧稿在 70 件池子上不成立的机制（裁决）

| # | 旧稿口径 | 为什么不成立 | 替代口径（本表冻结） |
|---|---|---|---|
| R1 | 「遗物池从 22 扩到约 33（+11），每派系约 5 件」 | 实际已是 70 件，再加 11 件会与现有强度曲线打架，且没有内容缺口 | **不新增遗物**；改用 §2.3 的归属重基，规模分布见 §2.5 |
| R2 | 雷暴 T1「连锁衰减 0.75 → 0.82」 | `public/js/sim/projectile-system.js` 的电弧连锁**当前无衰减**：每跳都按全额 `stats.dmg` 结算。落地「0.75」等于凭空加一层减伤，拿 T1 反而变弱 | T1 改为**连锁目标 +1**（`chainExtra`）；衰减机制整体撤销 |
| R3 | 蚀毒 T2「毒可叠 2 层」 | 当前中毒是单槽模型：`combat-system.js` 取**最高 DPS + 刷新时长**（`poisonDps` / `poisonUntil`），没有层概念；叠层要改每帧结算与快照 | T2 改为**中毒目标受伤 +12%**（`poisonVulnerable`）；叠层降为 P1 并注明需要改状态模型 |
| R4 | 觉醒「静电过载：连锁可以暴击」 | 与雷暴 T3「连锁可以暴击」完全重复，等于白送一条觉醒 | P1 觉醒改口径为「连锁目标 +1 且不衰减」（§7.3） |
| R5 | 契约「目标派系 +2 / +3 点」 | 与「点数 = 遗物等级之和」的定义冲突：凭空加点会让点数脱离构筑 | 引入 `bonusPoints` 覆盖层（单派系 ≤ +3），与遗物点数分色显示（§2.2） |
| R6 | 「第 3 波起必含升级卡」是否保留 | 池子从 33 扩到 70 后新卡占比更高，升级更难发生——这条**更该保留**，不是过期项 | 保留并冻结为 `rollRelicOffers` 的硬约束（§8.1）；固定种子的三选一序列会变一次，相关快照断言同步更新 |
| R7 | 核心「不可刷新」 vs 契约「可被刷新掉」 | 两条规则看似冲突：核心弹窗禁用刷新，契约卡却在三选一里 | 两者作用域不同：**核心弹窗**禁用刷新；**契约卡**随三选一整组刷新（消耗正常次数） |
| R8 | 守护 T2「漏怪伤害 −1（最低 1）」 | 普通敌人漏怪伤害就是 1，扣到下限没有收益，容易被读成 bug | 明确语义：**只对 dmg ≥ 2 的敌人有效**（重甲 2 / 首领 3），这是「守强攻弱」定位的有意设计，UI 文案必须写「对重甲/首领生效」 |

### 10.2 6 套装层退役（两步，均随派系层上线）

旧稿已拍板「派系替换 6 标签套装」。当前 6 套装的 **2/4 件加成层**已在 `relic-system.js` 生效，
与新派系层叠加会形成双协同轴（4 件档 + 4 点档同时触发），强度不可归因。退役分两步：

| 步骤 | 动作 | 影响面 |
|---|---|---|
| M1 | `recomputeMods` 停止累加 `RELIC_SET_BONUSES`；常量与 `relicSetTierBonuses` **保留导出**（图鉴分组与旧测试夹具继续可用），但不再参与计算 | `public/js/sim/relic-system.js`；`relic-sets` / `relics-depth-v3` / `relics-conditional` 三个测试改为断言「set 层已退役、不再改变 mods」 |
| M2 | 图鉴从 `set` 分组切到 `faction` 分组；随后删除 `set` 字段与 `RELIC_SET_BONUSES` | `public/js/relic-codex-ui.js`、`public/js/shared/data/relics.js`、i18n |

**M1 与派系层必须同一提交**：否则玩家会同时吃到两层加成或被静默削弱；
**M2 可紧随其后独立提交**。在 M2 完成前，`set` 字段只作历史标签，任何新逻辑不得读取它。

### 10.3 文件与测试影响（实现任务照此排期）

- 新增模块五个（§8.1），新增测试：`factions.test.mjs`、`starter-relic.test.mjs`、
  `boss-cores.test.mjs`、`contracts.test.mjs`、`doctrines.test.mjs`、`awakenings.test.mjs`（均在 `tests/` 下）。
- 需要改动：`public/js/shared/data/relics.js`（`faction` 字段 + 信物 + 保底卡）、
  `public/js/sim/relic-system.js`（M1）、`public/js/sim/combat-system.js`（暴伤/易伤）、
  `public/js/sim/projectile-system.js`（连锁）、`public/js/sim/enemy-system.js`（中毒/漏怪/移速）、
  `public/js/sim/tower-system.js`（教义与缓存失效）、快照映射（v5）。
- `tests/relics-depth-v3.test.mjs` 里「每件遗物都必须有已注册 set」的断言，
  在 `set` 字段删除（M2）时必须同步移除。
- 平衡复测：`npm run balance`，三档通关率回到 `BALANCE_TARGETS`，
  结果写 `docs/BALANCE.md`，不在本表里重复数值。

---

## 11. AC 映射与验收

| 验收项 | 判据 | 见证 |
|---|---|---|
| 70 件遗物全覆盖 | 本表 id 集合 = `RELICS` 的 id 集合，无重复/遗漏 | `tests/rogue2-design.test.mjs` 读 live 数组反查 |
| 5 派系 + 4/8/12 阈值表 | §2.1 / §2.2 / §3.3 齐全且自洽 | 同上（解析表格断言行数、档位键） |
| 核心 / 契约 / 教义 / 觉醒字段表 | §4.2 / §5.2 / §6.2 / §7.2 的 id 数量 = 5 / 5 / 5 / 4 | 同上 |
| AC-054 本体判据 | 本表含「五派系」「首领核心」字样 | `tests/rogue2-design.test.mjs` |
| 总验收 | `node --test tests/rogue2-design.test.mjs` exit 0 且 `npm test` 不回归 | GOAL-011 / AC-054 |

本表与实现的漂移检测：任何一条冻结值改动，必须同时改本文与对应测试，否则视为失败。
