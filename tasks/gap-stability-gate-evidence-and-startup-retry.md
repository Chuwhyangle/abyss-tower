---
id: gap-stability-gate-evidence-and-startup-retry
title: 稳定性门禁失败证据落盘 + 直接自起服务测试的启动重试收口（AC-007）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --no-warnings --test tests/check-stability.test.mjs
    tests/test-server.test.mjs tests/test-isolation-audit.test.mjs
goal_ac: AC-007
---
## Proposal

**AC-007（criterion `node scripts/check-stability.mjs`，expect `exit 0`）最近一次判定为 fail，而它记下的证据不可诊断。**

2026-10-26T03:54:04.147Z 的 gate 证据原文：

```text
check-stability: 174 个测试文件，3 轮，并发 2
check-stability: 第 1/3 轮 … 20.23s（ok）
check-stability: 第 2/3 轮 … 25.93s（fail）
CAUSE=full suite failed on run 2（7 项失败：同一事件重复写入保持幂等，未读数只增加一次、超过 20 条只保留最新的 20 条、全部已读后未读清零，重复调用不再更新、未读只统计本人，标记已读不影响他人、通知写入失败被吞掉，成就结算仍然完成）
check-stability: 第 3/3 轮 … 20.38s（ok）
```

立案前实测（同一脚本、同一并发、干净工作区）：`node scripts/check-stability.mjs --rounds=3` → 3/3 轮 ok，每轮 1395/1395。属于**偶发**失败，不是确定性红；也意味着「再跑一次看它绿了」不能作为完成标准。

### 诊断 A：那 7 项失败是 `before()` 钩子失败，不是 7 个用例真的坏了

- `tests/notifications.test.mjs` 一共 7 个用例，证据里的「7 项失败」正好等于该文件的全部用例；`CAUSE=` 只列前 5 个名字（`scripts/check-stability.mjs` 的 `MAX_CAUSE_TESTS = 5`）。
- 未被列出的两个用例里有一个是 `客户端铃铛、面板与脚本已接入`：它只对 `public/index.html` 与 `public/js/ui/notifications.js` 做静态字符串匹配，运行期状态不可能让它失败。
- 实测 node v22 TAP reporter：`before()` 抛错时，该文件每个子用例各输出一条 `not ok`，没有额外的文件级条目（3 个用例 → 3 条 `not ok`）。

结论：7 项失败 ⇔ 整个文件 `hookFailed`。把它读成「通知功能有 7 个断言坏了」会把根因引向完全错误的方向——这正是本任务要先修证据、再修根因的原因。

### 诊断 B：门禁丢掉了唯一能定因的证据

`scripts/test-stability.mjs` 的 `runRound()` 只用 `parseTapSummary()` / `parseTapFailures()` 取汇总（用例名），原始 TAP 与子进程 stderr 在 `spawnSync` 返回后即丢弃；`scripts/check-stability.mjs` 的 `causeLine()` 再截到前 5 个用例名。于是 `failureType: 'hookFailed'`、`EADDRINUSE`、`SQLITE_BUSY` 这类唯一定因线索全部不可见，失败轮也无法复跑复现。

### 诊断 C：30 个直接自起服务的测试文件没有启动重试

- `tests/harness.mjs` 的 `startTestServer()` 有 `startAttempts = 8` 的「换端口重试」，约 19 个文件用它。
- 另有 **30 个**文件直接 `spawn(process.execPath, ['--no-warnings', 'server/index.mjs'])` + 一次 `waitForHealth()`，启动失败即抛错（清单见 Touches 段）。
- `tests/test-server.mjs` 的 `allocatePort()` 是「`listen(0)` 取端口 → close → 写租约」，从 `close` 到子进程 `listen()` 之间存在 TOCTOU 窗口。本机 `/proc/sys/net/ipv4/ip_local_port_range` = `1024 65535`（整个非特权区间都是临时端口），内核可以把任何端口发给同机任何进程，**无法靠「挑一个保留端口段」规避**，只能失败后换端口重试。
- `tasks/TEST-001.md` 的 Notes 已用完整日志记下过同一条机制链：端口被占 → 服务 `EADDRINUSE` 退出 → `before()` 抛错 → 整文件 `hookFailed`。

⚠️ 这次失败轮 25.93s，比正常轮次 20–21s 长约 5s，与「先失败一次启动再整文件报错」的形态相符，但**不是决定性证据**。因此第一条 AC 要求先把真实失败证据落盘再定因：若证据指向别的根因（例如某个用例真的断言失败，或 `SQLITE_BUSY`），按证据修，不要硬套端口结论。

<!-- dedup-ref --> 关联但不同机制：`gap-goal-002-exit-condition-stability-gate-coverage`（needs-human）裁定的是 AC-007 这条 AC 该不该存在于目标库（来源审计），不改任何代码；本任务修的是门禁失败本身与它的可诊断性。

### 方案

1. **失败证据落盘（确定性缺口，必做）**
   - `runRound()` 在任一轮非 ok 时把该轮原始 TAP（stdout）与 stderr 落盘，默认 `.quay/stability/round-<n>-<ISO 时间戳>.tap`，返回值带上 `evidencePath` 与 `failureTypes`。
   - `failureTypes` 从 TAP 的 `failureType:` 字段聚合（如 `hookFailed`）。
   - `causeLine()` 在 `CAUSE=` 行附 failureType 摘要与证据路径，保留 `MAX_CAUSE_TESTS` 截断。
   - 判定语义不变：任一轮失败仍然 exit 1。**禁止**用「失败轮重跑一次」之类的重试掩盖不稳定。
2. **启动重试收口（结构性缺口）**
   - 把 `harness.startTestServer()` 里 allocate→spawn→waitForHealth→换端口重试的循环抽成 `tests/test-server.mjs` 的共享起动器（返回 `{ port, base, dbPath, log, stop() }`）；`tests/harness.mjs` 改为委托它，超时/重试参数保持可配置且默认值不变。
   - 30 个直接自起服务的测试文件改用该共享起动器：`PORT` / `BASE` 由模块级常量改为 `before()` 内赋值（`let`），断言内容一个字都不改。
   - 重试必须能被确定地验证：起动器提供测试钩子（如 `stealFirstAttempt` / `onAttempt`）或环境变量，让第一次尝试的端口在子进程 bind 前被占，用来证明换端口真的生效——不接受「多跑几轮没再复现」当证据。
3. **防回流**：给 `scripts/test-isolation-audit.mjs` 加一条规则禁止测试裸 spawn `server/index.mjs`，并在 `tests/test-isolation-audit.test.mjs` 补正/负例，避免这类文件再长回来。
4. 不改产品行为、玩法、数值，不改任何既有用例的断言。

## Touches

- `scripts/check-stability.mjs`
- `scripts/test-stability.mjs`
- `scripts/test-isolation-audit.mjs`
- `tests/check-stability.test.mjs`
- `tests/test-server.mjs`
- `tests/test-server.test.mjs`
- `tests/test-isolation-audit.test.mjs`
- `tests/harness.mjs`
- `tests/achievements-skills.test.mjs`
- `tests/achievements.test.mjs`
- `tests/announcement-notifications.test.mjs`
- `tests/api.test.mjs`
- `tests/bounties-depth.test.mjs`
- `tests/bounties.test.mjs`
- `tests/daily-challenge.test.mjs`
- `tests/daily-history.test.mjs`
- `tests/endless-leaderboard.test.mjs`
- `tests/endless.test.mjs`
- `tests/fixed-maps-server.test.mjs`
- `tests/hex-flow.test.mjs`
- `tests/hex-gamblers-dice.test.mjs`
- `tests/hex-relic-devourer.test.mjs`
- `tests/leaderboard-guard.test.mjs`
- `tests/leaderboard-paging.test.mjs`
- `tests/leaderboard-season.test.mjs`
- `tests/leaderboard-suspect-ui.test.mjs`
- `tests/leaderboard.test.mjs`
- `tests/leaderboard-titles.test.mjs`
- `tests/mutations.test.mjs`
- `tests/notification-batch.test.mjs`
- `tests/notification-paging.test.mjs`
- `tests/notification-prefs.test.mjs`
- `tests/notifications.test.mjs`
- `tests/season-pass-claim-all.test.mjs`
- `tests/season-pass.test.mjs`
- `tests/skills.test.mjs`
- `tests/stats.test.mjs`
- `tests/weekly-challenge.test.mjs`
- `tasks/gap-stability-gate-evidence-and-startup-retry.md`

## Acceptance Criteria

- [ ] 构造一个含抛错 `before()` 的夹具，`node scripts/check-stability.mjs --rounds=1 --root=<tmp> --files=<夹具>` 退出码为 1，stderr 的 `CAUSE=` 行含 `hookFailed` 与该轮证据文件路径，且该 `.tap` 文件确实落盘（可 grep 到 `failureType: 'hookFailed'`）
- [ ] `tests/check-stability.test.mjs` 新增用例覆盖「失败轮落盘 + failureType 进 CAUSE」，`node --no-warnings --test tests/check-stability.test.mjs` 通过
- [ ] 注入「第一次尝试端口被占」后共享起动器仍能成功启动（换到新端口），`node --no-warnings --test tests/test-server.test.mjs` 通过
- [ ] `node scripts/test-isolation-audit.mjs` 对 `tests/` 输出 0 条 `raw-server-spawn` 违规，`node --no-warnings --test tests/test-isolation-audit.test.mjs` 的正/负例通过
- [ ] 30 个直接自起服务的测试文件全部改用共享起动器：`grep -rn "spawn(process.execPath, \['--no-warnings', 'server/index.mjs'\]" tests/*.test.mjs` 无输出
- [ ] `node scripts/check-stability.mjs --rounds=3` 连续 3 次 exit 0（共 9 轮，无 `CAUSE=`）
- [ ] `npm test` 全绿

## Definition of Done

- [ ] 下一次门禁失败时，只看 `.quay/stability/*.tap` 就能定位到具体文件、用例与 `failureType`，无需重跑
- [ ] 「端口被抢」有可注入的自动化证据，不依赖概率；任一直启文件在首次端口丢失时仍能正常跑完
- [ ] 门禁判定没有被放宽：仍然「任一轮失败 → exit 1」，且没有轮级重跑
- [ ] 9 轮全量无失败、无 `CAUSE=`
