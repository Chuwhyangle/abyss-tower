---
id: AC-075
title: 抽卡服务端落地（gacha.mjs 已落地且非空）
status: draft
kind: criterion
goal: GOAL-015
criterion: test -s server/routes/gacha.mjs || { echo "抽卡服务端 gacha.mjs 未落地" >&2; exit 1; }
expect: exit 0
origin: GOAL-015 退出条件 2：服务端 draw/pool/history 三端点 + request_id 幂等
---
