// 赛季通行证：里程碑定义、积分边界、旧数据计入、跨赛季重置、幂等领取与接口接线。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  SEASON_PASS_BY_ID,
  SEASON_PASS_MAX_POINTS,
  SEASON_PASS_MILESTONES,
  seasonPassProgress,
  seasonPassRewardText,
} from '../public/js/shared/season-pass.js';
import { COSMETIC_TITLES } from '../public/js/shared/achievements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-season-pass-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-season-pass-server-${process.pid}-${Date.now()}.db`);
const PORT = 19900 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'season-pass-test-token-01';
const EMPTY_TOKEN = 'season-pass-test-token-02';
const BOUNDARY_TOKEN = 'season-pass-test-token-03';

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX_HTML = read('public/index.html');
const SEASON_PASS_UI = read('public/js/ui/season-pass.js');
const ROUTES_INDEX = read('server/routes/index.mjs');

let db = null;
let createProfile = null;
let getCores = null;
let seasonPassSummary = null;
let claimSeasonPassMilestone = null;
let getSeasonShards = null;
let seasonOf = null;
let seasonBounds = null;
let unlockedCosmetics = null;

let server = null;
let serverLog = '';
let inSeasonAt = 0;
let prevSeasonAt = 0;
let currentSeason = null;

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// 直接写入已完成对局（模拟上线前的旧数据，不经过任何通行证接口）。
function insertFinishedRun({ id, accountId = TOKEN, score = 50000, createdAt = inSeasonAt }) {
  db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, board_key, difficulty, seed, day, content_version,
        ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
        rerolls_used, status, victory, score, wave_reached, kills, duration_ms,
        result_json, created_at, finished_at)
     VALUES (?, ?, 'normal', 'normal', 'standard', ?, '2026-10-24', 'v1.4-map2', ?, 20, 20, -1, '[]', '{}',
             0, 'finished', 1, ?, 20, 100, 60000, ?, ?, ?)`
  ).run(
    id,
    accountId,
    `seed-${id}`,
    JSON.stringify({ meta: { baseHp: 20 } }),
    score,
    JSON.stringify({ baseHp: 20 }),
    createdAt,
    createdAt + 60000
  );
}

function seedAccount(accountId) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  createProfile(accountId);
}

async function api(pathname, { method = 'GET', token = TOKEN, body = null } = {}) {
  const headers = token ? { 'x-player-token': token } : {};
  if (body != null) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile, getCores } = await import('../server/db.mjs'));
  ({ seasonPassSummary, claimSeasonPassMilestone, getSeasonShards } = await import(
    '../server/db/season_pass.mjs'
  ));
  ({ seasonOf, seasonBounds } = await import('../server/db/leaderboard.mjs'));
  ({ unlockedCosmetics } = await import('../server/db/achievements.mjs'));

  currentSeason = seasonOf();
  const bounds = seasonBounds(currentSeason);
  // 固定落在当前赛季内、且早于现在的锚点；跨季数据取上赛季最后一秒。
  inSeasonAt = Math.max(bounds.start + 1, Math.min(Date.now(), bounds.end - 60_000));
  prevSeasonAt = bounds.start - 1000;

  seedAccount(TOKEN);
  seedAccount(EMPTY_TOKEN);
  seedAccount(BOUNDARY_TOKEN);

  // 旧数据：三局本赛季对局（上线前写入），另有一局上赛季高分对局用于验证跨季隔离。
  insertFinishedRun({ id: 'sp-old-1', score: 60000 });
  insertFinishedRun({ id: 'sp-old-2', score: 60000 });
  insertFinishedRun({ id: 'sp-old-3', score: 60000 });
  insertFinishedRun({ id: 'sp-prev-season', score: 900000, createdAt: prevSeasonAt });

  // 阈值边界账号：先差 1 分，再加 1 分跨过首个里程碑。
  insertFinishedRun({ id: 'sp-boundary-a', accountId: BOUNDARY_TOKEN, score: 9999 });

  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: SERVER_DB,
      AUTH_ENABLED: '0',
      DB_BACKUP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });

  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* 等待启动 */
    }
    await sleep(100);
  }
  throw new Error(`测试服务未能启动：${serverLog}`);
});

after(() => {
  if (server) server.kill('SIGTERM');
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  removeDb(UNIT_DB);
  removeDb(SERVER_DB);
});

test('里程碑集中定义：阈值升序、id 唯一、奖励可展示', () => {
  assert.ok(SEASON_PASS_MILESTONES.length >= 3);
  assert.equal(SEASON_PASS_MAX_POINTS, SEASON_PASS_MILESTONES.at(-1).points);

  let previous = 0;
  for (const milestone of SEASON_PASS_MILESTONES) {
    assert.ok(milestone.id);
    assert.equal(SEASON_PASS_BY_ID[milestone.id], milestone);
    assert.ok(milestone.points > previous, `${milestone.id} 阈值未严格递增`);
    previous = milestone.points;
    assert.ok(milestone.name);
    assert.ok(milestone.desc.includes(milestone.points.toLocaleString('en-US')));
    assert.ok(seasonPassRewardText(milestone.reward).length > 0);
    if (milestone.reward.title) {
      assert.ok(COSMETIC_TITLES[milestone.reward.title], '称号奖励必须引用外观目录');
    }
  }

  assert.equal(new Set(SEASON_PASS_MILESTONES.map((item) => item.id)).size, SEASON_PASS_MILESTONES.length);
  assert.equal(seasonPassRewardText({ cores: 20, shards: 5 }), '20 星核 + 5 皮肤碎片');
  assert.equal(seasonPassRewardText({ title: 'season_legend' }), '称号「赛季传奇」');
});

test('进度封顶到各自阈值，领取状态来自已领取集合', () => {
  const [first, second] = SEASON_PASS_MILESTONES;
  const track = seasonPassProgress(second.points - 1, [first.id]);

  assert.equal(track[0].progress, first.points);
  assert.equal(track[0].complete, true);
  assert.equal(track[0].claimed, true);
  assert.equal(track[0].claimable, false);
  assert.equal(track[1].progress, second.points - 1);
  assert.equal(track[1].complete, false);
  assert.equal(track[1].claimable, false);
  assert.equal(track.at(-1).progress, second.points - 1);

  const negative = seasonPassProgress(-500, []);
  assert.equal(negative[0].progress, 0);
  assert.equal(negative[0].complete, false);
});

test('赛季积分由本赛季已完成对局派生，旧数据与跨赛季数据按边界隔离', () => {
  const summary = seasonPassSummary(TOKEN);
  assert.equal(summary.season, currentSeason);
  assert.equal(summary.startsAt, seasonBounds(currentSeason).start);
  assert.equal(summary.endsAt, seasonBounds(currentSeason).end);
  // 三局 60,000 = 180,000；上赛季 900,000 不计入。
  assert.equal(summary.points, 180000);
  assert.equal(summary.milestones.length, SEASON_PASS_MILESTONES.length);
  assert.ok(summary.milestones.every((milestone) => milestone.complete));
  assert.equal(summary.claimableCount, SEASON_PASS_MILESTONES.length);

  const snapshot = db
    .prepare('SELECT points FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(TOKEN, currentSeason);
  assert.equal(Number(snapshot.points), 180000, '积分快照未落库');
});

test('阈值边界：差 1 分不可领取，达到阈值即可领取', () => {
  const first = SEASON_PASS_MILESTONES[0];
  const below = seasonPassSummary(BOUNDARY_TOKEN);
  assert.equal(below.points, first.points - 1);
  assert.equal(below.milestones[0].complete, false);
  assert.equal(below.milestones[0].progress, first.points - 1);

  const before = claimSeasonPassMilestone(BOUNDARY_TOKEN, first.id);
  assert.equal(before.ok, false);
  assert.equal(before.code, 'SEASON_PASS_INCOMPLETE');

  insertFinishedRun({ id: 'sp-boundary-b', accountId: BOUNDARY_TOKEN, score: 1 });
  const exact = seasonPassSummary(BOUNDARY_TOKEN);
  assert.equal(exact.points, first.points);
  assert.equal(exact.milestones[0].complete, true);
  assert.equal(exact.milestones[0].claimable, true);

  const claimed = claimSeasonPassMilestone(BOUNDARY_TOKEN, first.id);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.claimed, true);
});

test('领取发放全部奖励，重复领取不重复发放', () => {
  const [first, shardMilestone, , , finalMilestone] = SEASON_PASS_MILESTONES;
  const startCores = getCores(TOKEN);
  const startShards = getSeasonShards(TOKEN);

  const firstClaim = claimSeasonPassMilestone(TOKEN, first.id);
  assert.equal(firstClaim.ok, true);
  assert.equal(firstClaim.claimed, true);
  assert.equal(firstClaim.alreadyClaimed, false);
  assert.deepEqual(firstClaim.awarded, { ...first.reward });
  assert.equal(getCores(TOKEN), startCores + (first.reward.cores || 0));

  const duplicate = claimSeasonPassMilestone(TOKEN, first.id);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.alreadyClaimed, true);
  assert.equal(duplicate.awarded, null);
  assert.equal(getCores(TOKEN), startCores + (first.reward.cores || 0), '重复领取重复发放了星核');

  const shardClaim = claimSeasonPassMilestone(TOKEN, shardMilestone.id);
  assert.equal(shardClaim.ok, true);
  assert.equal(getSeasonShards(TOKEN), startShards + (shardMilestone.reward.shards || 0));

  const titleClaim = claimSeasonPassMilestone(TOKEN, finalMilestone.id);
  assert.equal(titleClaim.ok, true);
  assert.equal(titleClaim.awarded.title, finalMilestone.reward.title);
  assert.ok(
    unlockedCosmetics(TOKEN).titles.has(finalMilestone.reward.title),
    '称号奖励未写入外观解锁'
  );

  const rows = db
    .prepare(
      'SELECT milestone_id FROM account_season_pass_claims WHERE account_id = ? AND season = ?'
    )
    .all(TOKEN, currentSeason);
  assert.equal(rows.length, 3, '领取行数与首次领取次数不一致');
});

test('跨赛季重置：新赛季进度归零，旧赛季领取不影响新赛季', () => {
  const nextSeasonAt = seasonBounds(currentSeason).end + 1000;
  const next = seasonPassSummary(TOKEN, nextSeasonAt);
  assert.notEqual(next.season, currentSeason);
  assert.equal(next.points, 0);
  assert.ok(next.milestones.every((milestone) => !milestone.claimed));
  assert.equal(next.claimedCount, 0);

  const first = SEASON_PASS_MILESTONES[0];
  const rejected = claimSeasonPassMilestone(TOKEN, first.id, nextSeasonAt);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'SEASON_PASS_INCOMPLETE');

  const oldRows = db
    .prepare(
      'SELECT COUNT(*) AS total FROM account_season_pass_claims WHERE account_id = ? AND season = ?'
    )
    .get(TOKEN, currentSeason);
  assert.ok(Number(oldRows.total) > 0, '旧赛季领取记录被清除');
});

test('未完成与未知里程碑拒绝领取，且不改动钱包', () => {
  const first = SEASON_PASS_MILESTONES[0];
  const beforeCores = getCores(EMPTY_TOKEN);
  const beforeShards = getSeasonShards(EMPTY_TOKEN);

  const incomplete = claimSeasonPassMilestone(EMPTY_TOKEN, first.id);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, 'SEASON_PASS_INCOMPLETE');

  const unknown = claimSeasonPassMilestone(EMPTY_TOKEN, 'not-a-real-milestone');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'UNKNOWN_MILESTONE');

  assert.equal(getCores(EMPTY_TOKEN), beforeCores);
  assert.equal(getSeasonShards(EMPTY_TOKEN), beforeShards);
});

test('接口：未登录 401，登录后返回轨道，非法/未完成领取被拒绝', async () => {
  const anonymous = await api('/api/season-pass', { token: null });
  assert.equal(anonymous.status, 401);

  const listed = await api('/api/season-pass');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.season, currentSeason);
  assert.equal(listed.data.maxPoints, SEASON_PASS_MAX_POINTS);
  assert.equal(listed.data.milestones.length, SEASON_PASS_MILESTONES.length);
  for (const milestone of listed.data.milestones) {
    assert.ok(milestone.name);
    assert.equal(typeof milestone.target, 'number');
    assert.equal(typeof milestone.progress, 'number');
    assert.equal(typeof milestone.claimable, 'boolean');
  }

  const unknown = await api('/api/season-pass/claim', {
    method: 'POST',
    body: { id: 'not-a-real-milestone' },
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.code, 'UNKNOWN_MILESTONE');

  const incomplete = await api('/api/season-pass/claim', {
    method: 'POST',
    body: { id: SEASON_PASS_MILESTONES[0].id },
  });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.data.code, 'SEASON_PASS_INCOMPLETE');

  const again = await api('/api/season-pass');
  assert.deepEqual(
    again.data.milestones.map((milestone) => milestone.id),
    listed.data.milestones.map((milestone) => milestone.id)
  );
});

test('面板与路由接线齐备', () => {
  assert.match(INDEX_HTML, /id="btn-season-pass"/, '大厅缺少通行证入口');
  assert.match(INDEX_HTML, /id="season-pass-panel"/, '缺少通行证面板容器');
  assert.match(INDEX_HTML, /src="\/js\/ui\/season-pass\.js"/, '通行证脚本未加载');

  assert.match(SEASON_PASS_UI, /#season-pass-list|season-pass-list/, '缺少里程碑列表容器');
  assert.match(SEASON_PASS_UI, /function escapeHtml/, '缺少 HTML 转义');
  assert.match(SEASON_PASS_UI, /role="progressbar"/, '进度条缺少可访问性角色');
  assert.match(SEASON_PASS_UI, /data-claim=/, '缺少领取按钮标记');
  assert.match(SEASON_PASS_UI, /\/api\/season-pass\/claim/, '领取未走通行证接口');
  assert.match(SEASON_PASS_UI, /credentials: 'same-origin'/, '请求未携带同源凭据');
  assert.match(SEASON_PASS_UI, /response\.status === 401/, '未处理未登录');
  assert.match(SEASON_PASS_UI, /item\.claimed/, '未展示领取状态');

  assert.match(ROUTES_INDEX, /import \{ SeasonPassRoutes \} from '\.\/season-pass\.mjs'/);
  assert.match(ROUTES_INDEX, /addProtected\(new SeasonPassRoutes\(\)\)/);
});
