# 测试体系契约（TODO-13）

本文件冻结「无头模拟场景 + 正交轴/接缝/不变量」测试体系的契约与接缝声明约定，来源 `docs/TODO.md` 的 TODO-13。目标：**M+N+Z 加法级复用，不 M×N×Z 笛卡尔积**——加一个新维度，测试数 +1（轴）或 +1（缝声明），不 ×N；不变量自动把新东西卷进去，付「组合覆盖」不付「组合代价」。

## 1. 场景构造器契约（`tests/lib/scenario.mjs`）

`buildScenario(spec)` 声明式构造一个就绪的 `Simulation` + 驱动 helper，零 DOM / 零美术 / 零第三方依赖，复用 `public/js/sim.js` 的确定性。

spec 字段（可组合，缺省安全）：

- `seed` 种子（缺省 `scenario-default-seed`）
- `map` 地图对象（缺省 `generateMap(seed)`）
- `difficulty` `roam` / `standard` / `abyss`（缺省 `standard`）
- `mode` `normal` / `daily` / `endless` / `tower`（缺省 `normal`）
- `gold` / `baseHp` / `maxBaseHp` / `kills` / `clearedWave` / `runId` / `startedAt` 经济与基地初值
- `relics` 遗物 id 或 `{id, level}` 数组
- `towers` 预置塔数组（走 `public/js/sim.js` 的读档回填路径）
- `hex` / `hexState` 主海克斯 id 与每局状态
- `skill` 主动技能 `{id, level[, cooldown]}`
- `unlockedTowers` 已解锁塔类型（缺省 `['arrow','cannon','frost']`）
- `onSave` / `onGameOver` / `onWaveClear` 可选回调（`onToast` 自动收集）
- `sim` 其余字段透传（兜底覆盖）

返回场景 `{ sim, toasts, rngLog, waves, ...驱动 helper }`，驱动 helper 覆盖塔生命周期（`place` / `build` / `upgrade` / `evolve` / `sell`）、波次（`startWave` / `step` / `runWave` / `spawnEnemy`）、技能与遗物（`castSkill` / `buyRelic`）、读状态（`read`）与建格（`buildableCells`）。

**确定性红线**：`buildScenario` 固定 `startedAt`（避免 `0` 退化成墙钟），RNG tap 只读记录、值原样透传，不新增 RNG 调用、不改 `public/js/sim.js` 的 `combatRng` 顺序。

## 2. 复用断言与不变量（`tests/lib/assertions.mjs`）

- 数值近似 `assertStatsClose`
- 确定性哈希三件套 `hashesOf`（events / rng / state）
- 快照 round-trip `assertSnapshotRoundTrip`（`toSnapshot` → `validateSnapshot` → 重建 → 逐字段一致）
- 无崩溃 `assertNoCrash`
- 确定性 `assertDeterministic`（同 seed 两次运行逐值一致）
- 不变量全家桶 `assertInvariants`（确定性 + RNG 顺序 + 快照 round-trip + 无崩溃）

## 3. 轴/缝/不变量分类法

- **轴**（`tests/lib/axes.mjs`）：正交维度（塔/海克斯/遗物/技能/地图/难度/波次/模式），每条轴 = 变体枚举 + `specFor(variant)`（最小 `buildScenario` spec）+ `run(sc, variant)`（只做本轴该做的断言）+ 声明的缝。
- **缝**（`tests/lib/seams.mjs`）：跨维度接口（加成聚合/海克斯钩子×塔生命周期/快照往返/回放往返/mode 分支/经济），每条缝 = 一个接口 + 一个变体无关断言 `assert(sc, axis, variant)`。缝只写一次，遍历「声明了该缝的轴」的每个变体。
- **覆盖矩阵**（`scripts/test-matrix.mjs`）：交叉轴/缝，报告未覆盖接缝与空缺格。

## 4. 新功能接缝声明约定（核心纪律）

新功能测试必须走 `tests/lib/scenario.mjs` 的 `buildScenario`，禁止 ad-hoc 手拼 `Simulation`（纯数据/序列化测试除外）。落地新功能时：

1. 在 `tests/lib/axes.mjs` 登记 **1 条轴**：变体枚举 + `specFor(variant)` + `run(sc, variant)`。
2. 在轴里声明 **k 条已有缝**（`seams` 数组），新维度自动被这些缝的遍历卷进去。
3. 只有出现**新的跨维度接口**时，才在 `tests/lib/seams.mjs` 加 **1 条缝**并为其写最小断言。
4. 不变量自动把新东西卷进：任意 `buildScenario` 场景都能跑 `assertInvariants` 落证。

## 5. 迁移示范（本任务落地的三组）

- 海克斯走**轴注册表参数化**：`tests/hexes.test.mjs`（一条 `hex` 轴遍历全部海克斯 + 不变量）。
- 遗物走**场景构造器**：`tests/relics-turnbased.test.mjs`（`makeSim` 改为 `buildScenario` 薄封装 + 不变量）。
- 快照走**缝注册表**：`tests/snapshot.test.mjs`（`snapshot` 缝 + `assertSnapshotRoundTrip`）。

地基自证与示范见 `tests/scenario.test.mjs`，分类法自证与示范见 `tests/test-matrix.test.mjs`。

## 6. 校验

- `npm test` 全绿。
- `npm run check:docs` 不红（本文引用的文件均真实存在）。
- `node scripts/test-matrix.mjs` 报告「未覆盖接缝：无」「未知缝引用：无」。
