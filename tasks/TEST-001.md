---
id: TEST-001
title: 复现并定位全量测试的不稳定失败
status: done
labels: []
parent: null
children: []
extra:
  acceptance: node --test tests/*.test.mjs
goal_ac: AC-002
---
## 背景

2026-10-24 一次 `npm test` 出现 4 个失败（其中可见「每日挑战开局参数可复现，每日次数上限生效」），随后 1 次干净重跑与 3 路并发重跑均为 1183/1183 全绿。失败发生在另一个进程同时运行浏览器测试的时间窗内。

## 要求

- 复现：构造并发/负载条件，收集失败用例名、完整日志与运行环境。
- 定位根因：端口分配、临时 DB 路径、全局状态、时间依赖、共享文件、测试间串扰。
- 把复现命令、失败日志片段与根因结论写入本任务正文的 Notes 段，供 TEST-002 使用。

## Touches

- `tests/daily-challenge.test.mjs`
- `tests/harness.mjs`
- `server/index.mjs`

## Acceptance Criteria

- [x] 至少复现一次不稳定失败；若无法复现，给出 N 次运行（N≥5，含并发）的量化依据
- [x] 根因有证据（日志片段或代码位置）

## Definition of Done

- [x] 全量测试通过
- [x] Notes 段记录复现方法与根因

## Notes

### 结论（根因）

**测试服务的端口不是独占的，而且「启动成功」没有被真正验证。** 每个测试文件用 `Math.random()` 在很窄的固定段里取端口（如 `PORT = 18700 + Math.floor(Math.random()*200)`），这些段互相重叠、也重叠本机长期驻留的服务；当该端口已被别的进程占用时，被测服务 `server/index.mjs` 绑定失败（EADDRINUSE）退出，但测试的启动轮询把**任意** 200 响应当成「自己的服务已就绪」，于是后续请求全部打到别人的进程上，产生看起来与测试主题无关的断言失败。

机制链（以每日挑战为例）：

1. `tests/daily-challenge.test.mjs:23`：`const PORT = 18700 + Math.floor(Math.random() * 200)`。
2. `tests/daily-challenge.test.mjs:50-80`：`spawn` 服务后轮询 `GET /api/health`，`if (response.ok) return;` —— 不校验 `server.exitCode`、不识别 EADDRINUSE，也不验证响应来自**本进程启动的服务**。
3. 端口被他人占用时：服务进程崩溃（日志 `[uncaughtException] Error: listen EADDRINUSE ...`）；若占用者在 `/api/health` 返回 200，测试直接进入用例并对别人的进程发请求。
4. 断言因此在 `tests/daily-challenge.test.mjs:176` 起失败（实测 401 或 404），与「每日挑战参数可复现」毫无关系。

同一模式（启动轮询接受首个 200 / 不检查子进程退出）存在于全部 28 个自起服务的测试文件；另有 `tests/notification-paging.test.mjs:129-137` 的轮询**不在超时后抛错**，服务没起来也会继续跑。

### 环境

- Node v22.23.2，Linux 6.8，128 核**共享主机**（同一 uid/其他 uid 长期驻留着多个 node 服务与其他项目的测试进程）。
- 时间窗：2026-10-24 19:00–19:40。工作区：`/data/home/wenhao/abyss-tower-worktrees/TEST-001`（分支 `task/TEST-001`）。
- 结论与负载无关：**单次无并发**全量运行也会失败（见证据 1）。

### 证据 1：单次无并发全量运行即复现（完整 EADDRINUSE 日志）

命令：`node --no-warnings --test --test-concurrency=2 --test-reporter=tap tests/*.test.mjs`

```text
not ok 225 - 同一日期派生结果稳定
  ---
  duration_ms: 8208.243293
  failureType: 'hookFailed'
  error: |-
    测试服务未能启动：[db] 已应用迁移 1：accounts_player_data
    [db] 已应用迁移 2：account_achievements
    ...
    [db] 已应用迁移 11：notifications_announcement
    [uncaughtException] Error: listen EADDRINUSE: address already in use 127.0.0.1:18879
      code: 'EADDRINUSE',
      syscall: 'listen',
      address: '127.0.0.1',
      port: 18879
```

结果：`tests/daily-challenge.test.mjs` 全部 6 个用例 `hookFailed`；整轮 1183 个用例 1177 通过 / 6 失败。

端口 18879 的占用者不是本仓库进程：`/proc/net/tcp` 显示 uid `0x1004`（另一系统用户），`GET /api/health` 返回 **404**、`GET /` 返回 200 —— 所以健康轮询 8 秒都拿不到 200，`before` 抛错，整个文件全挂。

### 证据 2：并发/负载条件下的 5 轮量化结果

条件：每轮并行 N 份全量 suite（`--test-concurrency=2`）+ M 个浏览器验收（`node tests/browser-smoke.mjs`），并用 `NODE_OPTIONS=--import` 注入探针记录每次 TCP bind。

| 轮次 | 条件 | 失败用例数 | 捕获到的 EADDRINUSE | 失败文件 |
| --- | --- | --- | --- | --- |
| R1 | 3 suite + 1 browser | 8 | 未埋点 | `leaderboard-titles`（两个 suite 各 4 个） |
| R2 | 4 suite + 2 browser | 19 | 6 | `endless-leaderboard`(8)、`notification-paging`(8)、`weekly-challenge`(3) |
| R3 | 4 suite + 2 browser | 12 | 1 | **`daily-challenge`(1)**、`api`(3)、`bounties-depth`(8) |
| R4 | 4 suite + 2 browser | 7 | 3 | `achievements-skills`(7) |
| R5 | 4 suite + 2 browser | 0 | 1 | （harness 自带重试，碰撞被吸收） |

R2 的 pid→端口→文件一一对应（探针日志）：

```text
pid=4084511 want=20654 code=EADDRINUSE   # DB_PATH=...rtd-endless-lb-...
  → tests/endless-leaderboard.test.mjs 的 8 个用例全部 failureType: hookFailed
pid=4092630 want=20481 code=EADDRINUSE   # DB_PATH=...rtd-notif-paging-server-...
  → tests/notification-paging.test.mjs 8 个用例
     error: 'Provided value cannot be bound to SQLite parameter 1.'
     stack: notification-paging.test.mjs:157 (accountId(ALICE) 为 undefined)
     解释：/api/notifications 打到了别的服务，别名只写进别人的库；本地 serverDb 查不到该 token → undefined
pid=4115063 want=18980 code=EADDRINUSE   # DB_PATH=...rtd-weekly-test-...
  → tests/weekly-challenge.test.mjs 3 个用例（Cannot read properties of null (reading 'mode') 等）
pid=4076493/4079372/4087525 → harness（浏览器）服务；harness 重试 8 次后自愈
```

R3 精确复现了报告里那条用例：

```text
not ok 230 - 每日挑战开局参数可复现，每日次数上限生效
  error: |-
    Expected values to be strictly equal:
    401 !== 200
  stack: daily-challenge.test.mjs:176:10
```

探针日志：该文件的被测服务 `pid=1481311 PORT=18787`；而 18787 被本仓库一个**残留的 `npm start`** 长期占用（PID 1927687，`PORT=18787 HOST=127.0.0.1`，cwd=`/data/home/wenhao/abyss-tower`，16:12 启动，已运行 3+ 小时；`GET /api/health`→200 `{"ok":true,"uptime":...}`，`POST /api/session`→401）。测试的启动轮询接受了它的 health 200，进入用例后拿到 401。

### 证据 3：端口段本身已被长期占用（扫描，19:2x 实测）

对测试声明的端口段逐端口做 bind 探测（EADDRINUSE 即「被占用」）：

| 段 | 基址+宽度 | 已占用 |
| --- | --- | --- |
| `harness.mjs`（浏览器验收） | 20000–29999 | **112 / 10000** |
| `notifications/season-pass/stats` | 19900+300 | 9 / 300 |
| `api.test` | 18600+300 | 9 / 300 |
| `leaderboard-titles` | 20000+500 | 8 / 500 |
| `daily-challenge` | 18700+200 | **7 / 200**（含 18787 残留 `npm start`、18879 他人进程） |
| `achievements-skills` / `endless` / `leaderboard` … | — | 各 1–4 |

声明的段之间存在硬重叠，例如 `daily-challenge 18700–18899 ⊂ api 18600–18899`；`daily-history` 与 `weekly-challenge` 都是 18900–19099；harness 的 20000–29999 覆盖 8 个测试文件的段。`scripts/test-isolation-audit.mjs` 只断言「端口表达式是随机的」，不检查段不相交、也不检查运行期归属，因此审计恒绿。

### 证据 4：确定性复现（钉死端口，证明「把别人的服务当自己的」）

1. 用 preload 把**测试进程**的 `Math.random` 固定为 0 → `PORT = 18700 + 0 = 18700`（被测服务进程不受影响）。
2. 在 `127.0.0.1:18700` 起一个「外来」HTTP 服务：`/api/health`→200，其余→404。
3. 运行 `tests/daily-challenge.test.mjs`。

结果：`# tests 6 / # pass 5 / # fail 1`

```text
not ok 6 - 每日挑战开局参数可复现，每日次数上限生效
  error: |-
    Expected values to be strictly equal:
    404 !== 200
  stack: daily-challenge.test.mjs:176:10
```

即：健康轮询接受了外来服务的 200，随后 `/api/session` 落到外来服务并返回 404。

### 失败签名谱（为什么看起来与主题无关）

- `failureType: hookFailed` + 完整 `EADDRINUSE` 日志（服务起不来）。
- `401 / 404 / 409 !== 200`（请求被外来进程应答）。
- `fetch failed`（外来服务在测试中途被其主人回收）。
- `Provided value cannot be bound to SQLite parameter 1`（测试直连自己的库，但请求被外来服务处理，数据写进了别人的库）。
- 挂起（外来监听接受连接但不应答；本地压测中出现过一次 >180s 未结束）。

### 建议的修复方向（供 TEST-002）

1. **首选：由系统分配端口。** `server/index.mjs` 支持 `PORT=0`，把实际端口以一行固定格式写到 stdout（或 `--port-file`），`tests/harness.mjs` 与各测试的 `before` 读取该行后再发请求；彻底消除「猜端口」。
2. 次选：统一端口分配器（如 `tests/port-allocator.mjs`），在进程内先 `listen(0)` 拿到空闲端口再释放给子进程，或对候选端口做 bind 探测 + 冲突重试；所有测试文件的段改为不相交。
3. 启动校验必须闭环：`before` 轮询期间检查 `server.exitCode`/stderr 中的 EADDRINUSE 并立即失败重试；不能把「任意 200」当作自己的服务（可要求一个每次运行唯一的 nonce，例如自定义 header 或 health 返回 run-id）。
4. 扩展 `scripts/test-isolation-audit.mjs`：段重叠、缺少 `server.exitCode` 检查、健康轮询不校验归属，均判为违规。
5. 环境侧：清理/迁移残留的 `npm start`（本次占用 18787，正常默认是 8787）；共享主机上建议给测试段划出固定预留区间并与运维约定。

### 复现命令（自包含）

```bash
# (a) 看某个段当前被谁占用
node -e '
const net=require("node:net");
(async()=>{for(let p=18700;p<=18899;p++){
  const s=net.createServer();
  const r=await new Promise(res=>{s.once("error",e=>res(e.code));s.listen(p,"127.0.0.1",()=>s.close(()=>res("free")))});
  if(r!=="free")console.log(p,r);
}})();'

# (b) 确定性复现：钉死端口 + 外来 /api/health=200 服务
cat > /tmp/pin-random.mjs <<'EOF'
if (!process.argv.some(a => a.endsWith('server/index.mjs'))) Math.random = () => 0;
EOF
node -e 'require("http").createServer((q,s)=>{const ok=q.url==="/api/health";s.writeHead(ok?200:404,{"content-type":"application/json"});s.end(ok?"{\"ok\":true}":"{}")}).listen(18700,"127.0.0.1")' &
NODE_OPTIONS="--import /tmp/pin-random.mjs" \
  node --no-warnings --test --test-reporter=tap tests/daily-challenge.test.mjs
# 期望：not ok 6 - 每日挑战开局参数可复现，每日次数上限生效；404 !== 200

# (c) 并发负载（复现整类失败）
for i in 1 2 3 4; do
  ( node --no-warnings --test --test-concurrency=2 tests/*.test.mjs > /tmp/suite-$i.tap 2>&1 ) &
done
node tests/browser-smoke.mjs &
wait
grep -h "^not ok" /tmp/suite-*.tap
```

### 验证

- 本轮无代码写入（诊断任务）；工作树与 `develop` 无差异，anti-drift Touches 检查通过。
- 清理负载后单轮全量：`# tests 1183 / # pass 1183 / # fail 0`（约 20.5s），DoD「全量测试通过」满足；但同一主机状态下该轮仍有约 3.5%（7/200）概率在 `daily-challenge` 段抽到被占端口，故修复前不稳定会继续复现。
