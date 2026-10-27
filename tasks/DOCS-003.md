---
id: DOCS-003
title: v2.0.0 版本收口：CONTENT_VERSION / CHANGELOG / PRD / RELEASE 对齐
status: todo
labels:
  - docs
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/release-consistency.test.mjs
depends_on:
  - gap-rogue2-balance
  - QA-004
  - gap-scene-sprite-adoption
  - gap-art-review-record
  - gap-culmination-shows
  - gap-feel-review-record
goal_ac: AC-040
---
## Proposal

当前版本面停在 `CONTENT_VERSION = v1.31.0`，`CHANGELOG.md` 顶部只有「Unreleased：地图 2.0 与主海克斯总验收」，而今天的打击感 2.0、视觉重制与即将落地的肉鸽养成 2.0 都没有版本号承接。仓库已有 `scripts/release.mjs`（默认 dry-run）与 `scripts/check-version.mjs`，但版本面仍需要一次显式收口，否则「代码已合、线上与 tag 还是旧版本」。本任务只做版本收口与发布文案，不改玩法与数值。

## Plan

1. 等依赖任务全部落地后，在最新 develop 上跑 `node scripts/release.mjs prepare 2.0.0 --date <发布日期>`（先 dry-run，再 `--yes`）。
2. 手工补全 `CHANGELOG.md` 的 v2.0.0 正文：地图 2.0 / 主海克斯、战斗反馈 2.0、视觉重制、肉鸽养成 2.0（派系/信物/核心/契约/教义/觉醒）与平衡回调，按玩家可见变化写，不堆任务 id。
3. 更新 `docs/PRD.md` 的修订记录与 `docs/RELEASE.md`：写清 v2.0.0 的回滚方式（回退到上一 tag 的可执行命令）与发布哈希占位。
4. 新增 `scripts/playtest-check.mjs` 与 `tests/playtest-record.test.mjs`：读取 `docs/PLAYTEST.md`，拒绝空表、缺字段、样本量不足；该检查器供 AC-042 与真人试玩任务复用。
5. 新增 `tests/release-consistency.test.mjs`：CONTENT_VERSION / CHANGELOG 顶部 / PRD 修订 / package.json / RELEASE.md 的 v2.0.0 一致，且 CHANGELOG 覆盖 005/006/007 的玩家可见变化。
6. tag 与 push 不在本任务自动执行；在 `docs/RELEASE.md` 写明由人确认后执行的确切命令（待外部）。

## AC

- [ ] `node --test tests/release-consistency.test.mjs` exit 0
- [ ] `npm run check:version` exit 0
- [ ] `node --test tests/playtest-record.test.mjs` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] `CONTENT_VERSION`、CHANGELOG 顶部、PRD 修订记录、package.json、RELEASE.md 全部指向 v2.0.0
- [ ] CHANGELOG 的 v2.0.0 段落覆盖 GOAL-005/006/007 的玩家可见变化，不遗漏地图 2.0 与主海克斯
- [ ] RELEASE.md 写明回滚命令与发布哈希占位；实际 tag/push 由人确认后执行（待外部）
- [ ] playtest 检查器能拒绝空表、缺字段与样本量不足，并在合法记录上 exit 0

## Touches

- `server/config.mjs`
- `package.json`
- `CHANGELOG.md`
- `docs/PRD.md`
- `docs/RELEASE.md`
- `scripts/playtest-check.mjs` (new)
- `tests/release-consistency.test.mjs` (new)
- `tests/playtest-record.test.mjs` (new)
- `tasks/DOCS-003.md`

## Notes

本任务走 `DOCS-*` lane 才能合法改 `docs/PRD.md`（`scripts/check-doc-ownership.mjs` 对非 DOCS 的 open 任务 fail-closed）。版本号是唯一事实来源组合：`server/config.mjs` 的 `CONTENT_VERSION`、CHANGELOG 顶部、PRD 修订记录、git tag；package.json 的 version 只要求合法 semver，但本任务一并改成 2.0.0 以免误读。不要自动 push/tag。
