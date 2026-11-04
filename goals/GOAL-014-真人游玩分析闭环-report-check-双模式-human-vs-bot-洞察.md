---
id: GOAL-014
title: 真人游玩分析闭环：report/check 双模式 + human-vs-bot 洞察
status: active
kind: goal
origin: 人 2026-11-04：真人游玩数据要反哺设计，建分析闭环替代「机器人自嗨」
activatedAt: 2026-11-04T09:42:24.180Z
---
## 背景

每局 run 已落库但没聚合分析，真人游玩数据「存了没被用」；balance 全是机器人（用户已判「bot 数据不可靠，重玩法不重平衡」）。本 goal 建「真人游玩分析闭环」：让产品 owner 的真人游玩数据反哺设计迭代。

## 范围

1. **脚本双模式** `scripts/play-analytics.mjs`：`report`（读 runs/replays → 5 段 markdown 报告，分 `content_version` 隔离）＋ `check <insight-id>`（单条洞察求值 exit 0/1，作 goal AC 的 criterion）。
2. **报告段**（MVP 零迁移）：总体（难度×mode 局数/通关率/波次/时长/余金/剩血）、主海克斯选取率/胜率、遗物选取率/胜率差、失败波次分布、mode 使用量。
3. **洞察触发器**（样本 floor + content_version 隔离 + 连续两期）：`human-vs-bot`、`hex-winrate`、`relic-dead/unpicked`、`wave-death`、`mode-cold`、`abandon-rate`、`duration-outlier`。绝大多数路由到玩法/内容/UX（重玩法不重平衡），数值类只作触发器交机器人 balance 执行。

## 非目标

- 不碰 `sim.js` 确定性、不在 HTTP 请求路径跑全表 JSON 解析（离线脚本）。
- 不产出含 `account_id`/`display_name` 的公开报告（默认脱敏）。
- MVP 不做塔编成/逐波 baseHp 打点（v2），不建 analytics 表/视图（直读 runs 聚合）。

## 退出条件

- AC-072 分析脚本落地：`node --test tests/play-analytics.test.mjs` exit 0。
- AC-073 human-vs-bot 洞察可评估：`node scripts/play-analytics.mjs check human-vs-bot` exit 0（样本不足时按 floor exit 0，超阈值才红）。
