---
id: AC-067
title: 传承在模拟、快照与 UI 一致生效
status: draft
kind: criterion
goal: GOAL-012
criterion: test -s public/js/shared/data/meta.js && grep -q 'legacyYield' public/js/shared/data/meta.js &&
  test -s server/services/run-settlement.mjs && grep -q 'legacyYield' server/services/run-settlement.mjs &&
  test -s server/db/legacy.mjs && grep -q 'grantLegacyInTx' server/db/legacy.mjs
expect: exit 0
origin: GOAL-012 退出条件 2：传承在模拟、快照、UI 一致生效
---
