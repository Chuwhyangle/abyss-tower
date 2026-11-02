---
id: gap-ac-007-hex-flow-relic-default-flaky-test
title: AC-007 复验：hex-flow 遗物默认值用例随机种子偶发三选一全为遗物钩子海克斯，固定种子消除 flake
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/hex-flow.test.mjs && npm test
goal_ac: AC-007
---
## Proposal

AC-007（GOAL-002「测试稳定性与并发隔离」）的 criterion 逐字为 `node scripts/check-stability.mjs`，expect `exit 0`。本轮第 2/3 轮失败，唯一 not ok 是 `tests/hex-flow.test.mjs:209` 用例「遗物候选与刷新费用走共享海克斯钩子（默认值 3 / 25）」：

```
not ok 627 - 遗物候选与刷新费用走共享海克斯钩子（默认值 3 / 25）
error: '三选一应含一张不改遗物默认值的海克斯：golden_law,gamblers_dice,relic_devourer'
location: '/data/home/wenhao/abyss-tower/tests/hex-flow.test.mjs:209:1'
failureType: 'testCodeFailure'
```

根因是测试自身的非确定性，不是产品 bug。该用例 `createRun(TOKEN)` 以随机 seed 开局，三选一 offers 由 `offerHexes` 对 implemented 池确定性洗牌派生（normal 模式 offer seed = `run:test-<seed>`）。10 个海克斯里只有 3 个带遗物钩子——`golden_law`（relicRerollCost）、`relic_devourer`（onRelicGained/relicOfferCount/relicRerollCost/relicRerollBonus）、`gamblers_dice`（relicRerollBonus）——三者全落入前 3 的概率为 1/C(10,3)=1/120。该轮恰好抽到 `golden_law,gamblers_dice,relic_devourer`，`offers.find(plain)` 返回 undefined，断言失败。第 1/3 轮与第 3/3 轮均通过，印证是偶发 flake 而非回归。

修法：用仓库现成的测试专用种子通道固定该用例种子。`server/routes/runs.mjs` 已支持 `ALLOW_TEST_SEED=1` + `x-test-seed` 头 → `run.seed = test-<seed>`。实测 `x-test-seed: relic-default` 的 offers 为 `overload_grid,glass_cannon,swarm`（三者均为不改遗物默认值的 plain 海克斯）。改动仅限 `tests/hex-flow.test.mjs`：

1. `before` 里 `startServer` 的 env 增加 `ALLOW_TEST_SEED: '1'`；
2. `api` 助手支持可选 `headers`，`createRun` 增加可选 `seed` 参数透传 `x-test-seed`；
3. 该用例改用 `createRun(TOKEN, 'normal', 'roam', 'relic-default')` 固定 seed，保留 `plainHex` 断言——它仍能防御未来海克斯池变化导致固定 seed 不再含 plain 海克斯时的确定性回归。

## AC

- [ ] `node --test tests/hex-flow.test.mjs` exit 0，用例 627 通过
- [ ] `grep -q "ALLOW_TEST_SEED" tests/hex-flow.test.mjs && grep -q "x-test-seed" tests/hex-flow.test.mjs`（固定种子通道已接线）
- [ ] `node scripts/check-stability.mjs` 连续 3 轮 exit 0（AC-007 criterion 原文）

## DoD

- 稳定性门禁 3 轮全绿、无 not ok 627；`npm test` 全绿
- 该用例不再依赖随机 seed：固定 `relic-default` 后 offers 确定含 plain 海克斯，1/120 的 flake 机制被消除
- 改动仅限测试文件，无生产代码改动

## Touches

- tests/hex-flow.test.mjs
- tasks/gap-ac-007-hex-flow-relic-default-flaky-test.md
