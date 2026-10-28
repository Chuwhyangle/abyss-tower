# 同 seed 模拟一致性：伤害事件日志 + RNG 序列 diff

任务：`gap-feel-sim-diff-evidence`（AC-020 证据面）· 工具：`scripts/feel-sim-diff.mjs`
· 对比基线：`3b8e1fd`（feat(visual): 确定性场景与视觉/手感验收基建）↔ 本任务提交时的 HEAD。

## 结论

**同一 seed 下，`3b8e1fd` 与当前 HEAD 的模拟逐项一致：伤害事件序列、RNG 调用序列、
终局状态三份产物完全相同（哈希逐字节相等），没有分叉。**

FEEL-001 评审（E.8）把「同 seed 一致性」列为阻塞点，其证据缺口到此关闭：

- 飘字里看到的 `30 / 30 → 68` 是**展示层求和**，不是模拟分叉。`public/js/shared/floaters.js:119`
  的 `mergeFloaterText` 会把同一位置、同一窗口内的相邻飘字合并成一条，
  `30 + 38 = 68` 是两条伤害事件在飘字合并后的结果；底下的两条独立伤害事件在事件日志里都是分开的。
- 模拟事件与 RNG 本身在 before/after 之间没有任何差异（见下方哈希表）。

## 工具体验证契约

`node scripts/feel-sim-diff.mjs` 在固定 seed 下无头重跑 `combat` 场景，落盘三份**无时间戳**产物
（同输入逐字节可复现）：

| 产物 | 内容 |
|---|---|
| `events.json` | 结构化命中事件序列：`damage` / `skillDamage` 两个扣血汇点的时间、目标、入参、扣血前后、暴击 / 持续伤害 / 致死标记 |
| `rng.json` | 全部 RNG 实例的调用序列（值级）+ 逐流摘要（调用数、首末值、逐流哈希） |
| `state.json` | 终局状态：存档快照（剔除唯一读墙钟的 `savedAt`）+ 活体状态（塔 / 敌人 / 金币 / 生命 / 击杀）+ 状态哈希 |

场景定义（同 seed 同定义即同输入）：标准难度、`crit` 遗物（20% 暴击，保证 `combatRng` 真被消耗）、
6 座塔（塔位由地图覆盖评分确定性推导，不写死坐标）、跑 5 波后停在事件阶段的确定性边界。

接线只做旁路观测：`RNG` 的 `_next` 与 `sim.damage` / `sim.skillDamage` 被包一层记录器，
底层返回值原样透传，**不产生任何随机数**、不改变调用顺序，也不写 `public/js/**`
（`tests/feel-sim-diff.test.mjs` 里有一条 mtime 断言守着这一点）。

事件字段只记物理可观测的量，不记 `weapon` / `source` 这类纯标注字段 —— 版本间新增标注
（`3b8e1fd` 之后命中事件才开始透传 `weapon`）不该被算成模拟分叉；扣血、暴击、致死这几项变了才算。

`--diff <左> <右>` 对两个产物目录逐项比对：一致 exit 0；任何差异 exit 1，并打印第一处差异
（JSON 路径 + 两侧取值）。产物缺失 / 无法解析按「不一致」处理，fail-closed。

## 复现命令

```bash
# 1) 取出对比基线源码树（不注册 worktree，纯解包）
rm -rf /tmp/feel-sim-diff && mkdir -p /tmp/feel-sim-diff/before-src
git archive 3b8e1fd | tar -x -C /tmp/feel-sim-diff/before-src

# 2) before：对旧源码树跑同一场景
node scripts/feel-sim-diff.mjs --scene combat --seed visual-fixed-seed \
  --root /tmp/feel-sim-diff/before-src --out /tmp/feel-sim-diff/before

# 3) after：对当前工作树跑同一场景
node scripts/feel-sim-diff.mjs --scene combat --seed visual-fixed-seed \
  --out /tmp/feel-sim-diff/after

# 4) 逐项 diff（一致 exit 0，任何差异 exit 1 并打印第一处）
node scripts/feel-sim-diff.mjs --diff /tmp/feel-sim-diff/before /tmp/feel-sim-diff/after
```

`--root` 让同一份工具跑任意源码树（含历史 commit 的检出），因此 before/after 用的是**同一条采集代码**，
不存在「两边跑的不是一个工具」的嫌疑。

## 结果

三个 seed 各自跑 before / after，`--diff` 全部 exit 0。下表的哈希 before 与 after **完全相同**，
所以每种只有一列：

| seed | 命中事件 | RNG 调用 / 流 | events 哈希 | rng 哈希 | state 哈希 | 清波 |
|---|---|---|---|---|---|---|
| `visual-fixed-seed` | 294 | 326 / 10 | `6f359fcd698666498888d706e87994b5c6e100a87d382380c1eb0990121396f6` | `f1132faf84371dc6a38cbe941776e94d278401c0d4d31ce9dc3b5e3d46c96853` | `b7925572cc366548fb00e9ac021d4e580ce043044a0c16f2e3b6abdec2b3e0f9` | 5/5 |
| `feel-sim-diff-seed-b` | 284 | 310 / 10 | `1bbc60b6132d7399…` | `9279f849f5fd2f12…` | `a15ec83a2f3688c0…` | 5/5 |
| `feel-sim-diff-seed-c` | 279 | 305 / 10 | `fd4e3b0b7f5eb683…` | `60a0493398910d97…` | `60b84f22e3952361…` | 5/5 |

`visual-fixed-seed` 的终局摘要：`phase=event`、`time=136.85s`、`gold=1452`、`baseHp=17/20`、
`kills=42`、`towers=6`。三个 seed 的哈希互不相同 —— 工具对输入敏感，不是「怎么跑都绿灯」的空转。

## 反向断言：证据是真的会红

绿灯只有在「红得起来」时才有意义。把 after 的 `rng.json` 最后一个随机数改掉 0.25 再 diff：

```
$ node scripts/feel-sim-diff.mjs --diff /tmp/feel-sim-diff/before /tmp/feel-sim-diff/tampered
[feel-sim-diff] 发现 1 处差异（首个：rng.json.sequence[325].value）
[feel-sim-diff] rng.json.sequence[325].value: 左 0.17567903245799243 / 右 0.42567903245799243
EXIT=1
```

`tests/feel-sim-diff.test.mjs` 把这条反向断言固化成用例（RNG 值、事件扣血、终局状态各一条），
另外覆盖「产物缺失」「参数错误 exit 2」「同树两跑 byte-identical」「跑完不改 `public/js/**`」。

## 局限

- 覆盖的是**模拟层**：一个场景（`combat`）、5 波、3 个 seed。渲染层像素差异归 `visual-check.mjs` 的套件管。
- 表现层里 `Math.random()` 驱动的纯装饰（毒雾小特效等）不入证：它不进状态、不进事件、不进随机流。
- 事件日志不含 `weapon` / `source` 标注字段（理由见上）；若将来要审「标注是否也一致」，那是另一个维度。
- 服务端与浏览器的差异（时区、帧率、输入时序）不在本工具范围内：这里比的是**同一输入下的纯模拟**。

## 后续

若将来出现分叉：`--diff` 会给出第一个差异的 JSON 路径与两侧取值，照此立案即可（区块 = 事件 / 随机流 / 状态）。
本任务不修任何战斗数值，也不改任何表现。
