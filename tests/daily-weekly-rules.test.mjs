// 每日/每周挑战规则：确定性轮换的单条规则（每日）与复合规则组（每周）。
// 规则复用地图词缀 schema（hpMul/speedMul/goldMul/rangeMul），服务端在选图时叠加到地图候选，
// 因此只改战斗数值、不改开局参数，也不影响正常模式与爬塔。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './test-server.mjs';

import {
  DAILY_RULES,
  WEEKLY_RULE_GROUPS,
  dailyRule,
  weeklyRuleGroup,
} from '../public/js/shared/data/daily-weekly-rules.js';
import {
  dailyChallenge,
  dayKey,
  shiftDay,
  weekKey,
  weeklyChallenge,
} from '../public/js/shared/scoring.js';
import { applySeedModifier } from '../public/js/shared/mapgen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;
let BASE = '';
const DB = path.join(os.tmpdir(), `rtd-daily-weekly-rules-${process.pid}-${Date.now()}.db`);
const TOKEN = 'daily-weekly-rules-token-0001';

let server = null;

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

async function api(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': TOKEN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function startRun(mode, difficulty = 'roam') {
  return api('/api/runs', { method: 'POST', body: { mode, difficulty } });
}

function chooseMap(runId, index) {
  return api(`/api/runs/${runId}/map`, { method: 'POST', body: { index } });
}

function abandon(runId) {
  return api(`/api/runs/${runId}/abandon`, { method: 'POST', body: {} });
}

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    env: { AUTH_ENABLED: '0' },
  });
  PORT = server.port;
  BASE = server.base;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

// ---------- 纯函数：规则派生 ----------

test('每日规则：同一天恒返回同一条，且属于每日规则池', () => {
  const day = '2026-10-23';
  assert.deepEqual(dailyRule(day), dailyRule(day));

  for (const rule of DAILY_RULES) {
    assert.ok(rule.id.startsWith('daily:'), `${rule.id} 应带 daily: 前缀`);
    assert.ok(rule.name && rule.desc, `${rule.id} 应有名称与描述`);
    for (const key of ['hpMul', 'speedMul', 'goldMul', 'rangeMul']) {
      assert.equal(typeof rule[key], 'number', `${rule.id}.${key} 应为数值`);
    }
  }

  const rule = dailyRule(day);
  assert.ok(DAILY_RULES.some((candidate) => candidate.id === rule.id), '未知规则');
});

test('每日规则：跨 14 天轮换出多条规则', () => {
  const ids = new Set();
  for (let offset = 0; offset < 14; offset++) {
    ids.add(dailyRule(shiftDay('2026-10-20', offset)).id);
  }
  assert.ok(ids.size >= 2, '每日规则应在多天内轮换');
  assert.ok(ids.size <= DAILY_RULES.length);
});

test('每周规则组：同一周稳定，复合效果为成员规则逐项相乘', () => {
  const week = '2026-W43';
  assert.deepEqual(weeklyRuleGroup(week), weeklyRuleGroup(week));

  const byBaseId = new Map(DAILY_RULES.map((rule) => [rule.id.slice('daily:'.length), rule]));
  for (const group of WEEKLY_RULE_GROUPS) {
    assert.ok(group.id.startsWith('weekly:'), `${group.id} 应带 weekly: 前缀`);
    assert.ok(group.name && group.desc, `${group.id} 应有名称与描述`);
    const expected = { hpMul: 1, speedMul: 1, goldMul: 1, rangeMul: 1 };
    for (const baseId of group.rules) {
      const member = byBaseId.get(baseId);
      assert.ok(member, `未知成员规则：${baseId}`);
      expected.hpMul *= member.hpMul;
      expected.speedMul *= member.speedMul;
      expected.goldMul *= member.goldMul;
      expected.rangeMul *= member.rangeMul;
    }
    assert.equal(group.hpMul, round3(expected.hpMul), `${group.id}.hpMul`);
    assert.equal(group.speedMul, round3(expected.speedMul), `${group.id}.speedMul`);
    assert.equal(group.goldMul, round3(expected.goldMul), `${group.id}.goldMul`);
    assert.equal(group.rangeMul, round3(expected.rangeMul), `${group.id}.rangeMul`);
  }
});

test('每周规则组：跨多周轮换出多组', () => {
  const ids = new Set();
  for (let weekNumber = 1; weekNumber <= 12; weekNumber++) {
    ids.add(weeklyRuleGroup(`2026-W${String(weekNumber).padStart(2, '0')}`).id);
  }
  assert.ok(ids.size >= 2, '每周规则组应跨周轮换');
  assert.ok(ids.size <= WEEKLY_RULE_GROUPS.length);
});

test('每日/每周挑战派生携带当日/本周规则', () => {
  const day = '2026-10-23';
  const daily = dailyChallenge(day);
  assert.deepEqual(daily.rule, dailyRule(day));

  const weekly = weeklyChallenge(new Date(2026, 9, 21));
  assert.deepEqual(weekly.ruleGroup, weeklyRuleGroup(weekly.week));
});

// ---------- 服务端接线：规则落库并叠加到地图候选 ----------

test('每日挑战建局携带当日规则，选图后规则词缀叠加到地图', async () => {
  const started = await startRun('daily');
  assert.equal(started.status, 200);

  const rule = started.data.daily.rule;
  assert.ok(rule, '每日挑战应返回当日规则');
  assert.deepEqual(rule, dailyRule(dayKey()));
  assert.deepEqual(started.data.ruleset.daily.rules, [rule]);
  assert.equal(started.data.ruleset.daily.date, dayKey());

  // 选带 trait 的地图（twin），规则词缀在「trait × 随机词缀」之后再叠加一层。
  const base = started.data.candidates.find((candidate) => candidate.modifier);
  assert.ok(base, '候选地图应至少有一张带 trait');
  const withSeed = applySeedModifier(base, started.data.mapModifier);
  const expected = {
    hpMul: round3(withSeed.modifier.hpMul * rule.hpMul),
    speedMul: round3(withSeed.modifier.speedMul * rule.speedMul),
    goldMul: round3(withSeed.modifier.goldMul * rule.goldMul),
    rangeMul: round3(withSeed.modifier.rangeMul * rule.rangeMul),
  };

  const index = started.data.candidates.indexOf(base);
  const chose = await chooseMap(started.data.runId, index);
  assert.equal(chose.status, 200);
  const modifier = chose.data.mapMeta.modifier;
  assert.equal(modifier.id, base.modifier.id, 'trait 身份不变');
  assert.equal(modifier.hpMul, expected.hpMul);
  assert.equal(modifier.speedMul, expected.speedMul);
  assert.equal(modifier.goldMul, expected.goldMul);
  assert.equal(modifier.rangeMul, expected.rangeMul);

  assert.equal((await abandon(started.data.runId)).status, 200);
});

test('每周挑战建局携带复合规则组，选图后复合词缀叠加到地图', async () => {
  const started = await startRun('weekly');
  assert.equal(started.status, 200);

  const group = started.data.weekly.ruleGroup;
  assert.ok(group, '每周挑战应返回本周规则组');
  assert.deepEqual(group, weeklyRuleGroup(weekKey()));
  assert.deepEqual(started.data.ruleset.weekly.rules, [group]);
  assert.equal(started.data.ruleset.weekly.week, weekKey());

  const base = started.data.candidates.find((candidate) => candidate.modifier);
  assert.ok(base, '候选地图应至少有一张带 trait');
  const withSeed = applySeedModifier(base, started.data.mapModifier);
  const expected = {
    hpMul: round3(withSeed.modifier.hpMul * group.hpMul),
    speedMul: round3(withSeed.modifier.speedMul * group.speedMul),
    goldMul: round3(withSeed.modifier.goldMul * group.goldMul),
    rangeMul: round3(withSeed.modifier.rangeMul * group.rangeMul),
  };

  const index = started.data.candidates.indexOf(base);
  const chose = await chooseMap(started.data.runId, index);
  assert.equal(chose.status, 200);
  const modifier = chose.data.mapMeta.modifier;
  assert.equal(modifier.id, base.modifier.id, 'trait 身份不变');
  assert.equal(modifier.hpMul, expected.hpMul);
  assert.equal(modifier.speedMul, expected.speedMul);
  assert.equal(modifier.goldMul, expected.goldMul);
  assert.equal(modifier.rangeMul, expected.rangeMul);

  assert.equal((await abandon(started.data.runId)).status, 200);
});

test('普通模式不写入每日/每周规则，选图词缀不含规则层', async () => {
  const started = await startRun('normal');
  assert.equal(started.status, 200);

  assert.equal(started.data.ruleset.daily, undefined);
  assert.equal(started.data.ruleset.weekly, undefined);
  assert.equal(started.data.daily, null);
  assert.equal(started.data.weekly, null);

  const base = started.data.candidates.find((candidate) => candidate.modifier);
  assert.ok(base, '候选地图应至少有一张带 trait');
  const withSeed = applySeedModifier(base, started.data.mapModifier);

  const index = started.data.candidates.indexOf(base);
  const chose = await chooseMap(started.data.runId, index);
  assert.equal(chose.status, 200);
  const modifier = chose.data.mapMeta.modifier;
  // 普通模式只有「trait × 随机词缀」，没有每日/每周规则层。
  assert.equal(modifier.hpMul, withSeed.modifier.hpMul);
  assert.equal(modifier.speedMul, withSeed.modifier.speedMul);
  assert.equal(modifier.goldMul, withSeed.modifier.goldMul);
  assert.equal(modifier.rangeMul, withSeed.modifier.rangeMul);

  assert.equal((await abandon(started.data.runId)).status, 200);
});
