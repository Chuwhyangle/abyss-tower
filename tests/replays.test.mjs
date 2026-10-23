// 最近对局回放：摘要内容、容量上限、只读本人、结算事务一致性。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { registerAndLogin, startTestServer } from './harness.mjs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const REPLAY_UI = read('public/js/replay-ui.js');
const INDEX_HTML = read('public/index.html');

let server = null;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  if (server) await server.stop();
});

function client(cookie) {
  return async function request(pathname, { method = 'GET', body, auth = cookie } = {}) {
    const headers = {};
    if (auth) headers.cookie = auth;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${server.base}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  };
}

async function startRun(request) {
  const started = await request('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  const id = started.data.runId;
  const mapped = await request(`/api/runs/${id}/map`, { method: 'POST', body: { index: 0 } });
  assert.equal(mapped.status, 200);
  return id;
}

async function finishRun(request, id, body = { waveReached: 1, kills: 10, goldLeft: 100, baseHp: 20 }) {
  const finished = await request(`/api/runs/${id}/finish`, { method: 'POST', body });
  assert.equal(finished.status, 200);
  assert.ok(finished.data.replayId, '结算响应应返回 replayId');
  return finished.data;
}

test('结算后写入回放摘要，时间线只含决策与结果', async () => {
  const auth = await registerAndLogin(server.base);
  const request = client(auth.rawCookie);
  const runId = await startRun(request);

  // 第 1 波结算后拿遗物，第 5 波结算后触发事件节点。
  for (let wave = 1; wave <= 5; wave++) {
    const served = await request(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
    assert.equal(served.status, 200);
    const cleared = await request(`/api/runs/${runId}/clear`, {
      method: 'POST',
      body: { wave },
    });
    assert.equal(cleared.status, 200);
    if (wave === 1) {
      const offers = await request(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
      assert.equal(offers.status, 200);
      const picked = await request(`/api/runs/${runId}/relic`, {
        method: 'POST',
        body: { index: 0 },
      });
      assert.equal(picked.status, 200);
    }
  }

  const eventNode = await request(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
  assert.equal(eventNode.status, 200);
  const chosen = await request(`/api/runs/${runId}/event`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(chosen.status, 200);

  const settled = await finishRun(request, runId, {
    waveReached: 5,
    kills: 120,
    goldLeft: 80,
    baseHp: 15,
  });

  const list = await request('/api/replays');
  assert.equal(list.status, 200);
  assert.equal(list.data.limit, 20);
  assert.equal(list.data.replays.length, 1);
  assert.equal(list.data.replays[0].id, settled.replayId);
  assert.equal(list.data.replays[0].runId, runId);
  assert.ok(list.data.replays[0].seed.length > 0);
  assert.equal(list.data.replays[0].relicCount, 1);
  assert.equal(list.data.replays[0].eventCount, 1);

  const detail = await request(`/api/replays/${settled.replayId}`);
  assert.equal(detail.status, 200);
  const replay = detail.data.replay;
  assert.equal(replay.runId, runId);
  assert.ok(replay.seed.length > 0);
  assert.equal(replay.mapChoice, 0);
  assert.ok(replay.map && replay.map.archetype, '摘要应包含地图');
  assert.equal(replay.relics.length, 1, '摘要应包含最终遗物');
  assert.equal(replay.events.length, 1);
  assert.equal(replay.events[0].wave, 5);
  assert.equal(typeof replay.events[0].eventId, 'string');
  assert.equal(typeof replay.events[0].optionId, 'string');
  assert.equal(replay.waves.cleared, 5);
  assert.equal(replay.result.waveReached, 5);
  assert.equal(replay.result.kills, 120);
  // 只存摘要：没有任何逐帧/模拟状态字段。
  for (const forbidden of ['frames', 'snapshot', 'states', 'ticks']) {
    assert.equal(forbidden in replay, false, `回放不应包含 ${forbidden}`);
  }
});

test('容量上限是硬约束：每账号只保留最近 20 局', async () => {
  const auth = await registerAndLogin(server.base);
  const request = client(auth.rawCookie);
  const created = [];

  for (let index = 0; index < 21; index++) {
    const runId = await startRun(request);
    await sleep(2);
    const result = await finishRun(request, runId);
    created.push(result.replayId);
  }

  const list = await request('/api/replays');
  assert.equal(list.status, 200);
  assert.equal(list.data.replays.length, 20, '超过 20 局后必须裁掉最旧的一局');
  assert.equal(list.data.replays.some((entry) => entry.id === created[0]), false, '最旧一局应被清理');
  assert.equal(list.data.replays[0].id, created.at(-1), '最新一局排在首位');

  const times = list.data.replays.map((entry) => entry.finishedAt);
  const sorted = [...times].sort((a, b) => b - a);
  assert.deepEqual(times, sorted, '列表按结算时间倒序');
});

test('未登录 401，他人回放与不存在的回放都是 404', async () => {
  const owner = await registerAndLogin(server.base);
  const ownerRequest = client(owner.rawCookie);
  const runId = await startRun(ownerRequest);
  const settled = await finishRun(ownerRequest, runId);

  const stranger = await registerAndLogin(server.base);
  const strangerRequest = client(stranger.rawCookie);

  const strangerList = await strangerRequest('/api/replays');
  assert.equal(strangerList.status, 200);
  assert.equal(strangerList.data.replays.length, 0, '列表只返回本人回放');

  const strangerDetail = await strangerRequest(`/api/replays/${settled.replayId}`);
  assert.equal(strangerDetail.status, 404);

  const missing = await ownerRequest('/api/replays/does-not-exist');
  assert.equal(missing.status, 404);

  const anonymous = client(null);
  const anonymousList = await anonymous('/api/replays');
  assert.equal(anonymousList.status, 401);
  const anonymousDetail = await anonymous(`/api/replays/${settled.replayId}`);
  assert.equal(anonymousDetail.status, 401);
});

test('结算与回放同事务：一局只产生一条回放，未结算不产生回放', async () => {
  const auth = await registerAndLogin(server.base);
  const request = client(auth.rawCookie);

  const runId = await startRun(request);
  const settled = await finishRun(request, runId);

  // 已结束的远征不能再次结算，也不会再写一条回放。
  const again = await request(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 1, kills: 10, goldLeft: 100, baseHp: 20 },
  });
  assert.equal(again.status, 409);

  const afterDuplicate = await request('/api/replays');
  assert.equal(afterDuplicate.status, 200);
  assert.equal(afterDuplicate.data.replays.length, 1);
  assert.equal(afterDuplicate.data.replays[0].id, settled.replayId);

  // 放弃的远征不写入回放。
  const abandonedRunId = await startRun(request);
  const abandoned = await request(`/api/runs/${abandonedRunId}/abandon`, {
    method: 'POST',
    body: {},
  });
  assert.equal(abandoned.status, 200);

  const final = await request('/api/replays');
  assert.equal(final.status, 200);
  assert.equal(final.data.replays.length, 1);
  assert.equal(final.data.replays.some((entry) => entry.runId === abandonedRunId), false);
});

test('结算页回放面板：脚本接入、摘要拉取、时间线与转义齐备', () => {
  assert.match(INDEX_HTML, /src="\/js\/replay-ui\.js"/, '结算页未加载回放面板脚本');
  assert.match(REPLAY_UI, /\/api\/replays/, '回放面板未走回放接口');
  assert.match(REPLAY_UI, /credentials: 'same-origin'/, '请求未携带同源凭据');
  assert.match(REPLAY_UI, /response\.status === 401/, '未处理未登录');
  assert.match(REPLAY_UI, /function escapeHtml/, '缺少 HTML 转义');
  assert.match(REPLAY_UI, /data-replay-id/, '缺少回放选择项标记');
  assert.match(REPLAY_UI, /\.result-modal \.result/, '未挂载到结算弹窗');
  assert.match(REPLAY_UI, /buildTimeline/, '缺少时间线构建');
});
