// 赛季奖励通知：结算写入一次、尊重通知偏好、幂等结算不重复、仅本人可见、写入失败不影响发奖。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  describeNotification,
  isSeasonReward,
  notificationJumpTarget,
  notificationKindLabel,
} from '../public/js/ui/notifications.js';

const DB_PATH = path.join(os.tmpdir(), `rtd-season-notify-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let db = null;
let accounts = null;
let leaderboard = null;
let notifications = null;

let alice = null;
let bob = null;
let rewardSeason = null;
let prefSeason = null;
let failSeason = null;
let drySeason = null;
let visibilitySeason = null;

const now = Date.now();
const suffix = now.toString(36);

function shiftSeason(season, delta) {
  const [year, month] = season.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function seasonMidpoint(season) {
  const bounds = leaderboard.seasonBounds(season);
  return bounds.start + 12 * 60 * 60 * 1000;
}

function makeAccount(name) {
  return accounts.createAccount({
    kind: 'registered',
    username: `${name}${suffix}`,
    passwordHash: 'season-notify-password',
  }).id;
}

function addEntry(accountId, season, score, durationMs = 60000) {
  db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES ('normal', ?, 'tester', NULL, 'standard', ?, ?, 'v1.4-map2', '{}', ?)`
  ).run(accountId, score, durationMs, seasonMidpoint(season));
}

function wallet(accountId) {
  const row = db
    .prepare("SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'")
    .get(accountId);
  return Number(row?.balance) || 0;
}

function seasonNotifications(accountId) {
  return db
    .prepare(
      `SELECT id, kind, dedupe_key AS dedupeKey, payload, created_at AS createdAt, read_at AS readAt
         FROM account_notifications
        WHERE account_id = ? AND kind = 'season'
        ORDER BY id ASC`
    )
    .all(accountId)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

before(async () => {
  const index = await import('../server/db/index.mjs');
  db = index.db;
  accounts = await import('../server/db/accounts.mjs');
  leaderboard = await import('../server/db/leaderboard.mjs');
  notifications = await import('../server/db/notifications.mjs');

  const currentSeason = leaderboard.seasonOf(now);
  rewardSeason = shiftSeason(currentSeason, -1);
  prefSeason = shiftSeason(currentSeason, -2);
  failSeason = shiftSeason(currentSeason, -3);
  drySeason = shiftSeason(currentSeason, -4);
  visibilitySeason = shiftSeason(currentSeason, -5);

  alice = makeAccount('notify-alice');
  bob = makeAccount('notify-bob');
  addEntry(alice, rewardSeason, 5000, 90000);
  addEntry(bob, rewardSeason, 3000, 60000);
});

after(() => {
  try {
    db?.close();
  } catch {
    /* 已关闭 */
  }
  for (const part of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_PATH}${part}`, { force: true });
  }
});

test('结算发奖后写入一条赛季奖励通知，附名次与奖励摘要', () => {
  const result = leaderboard.settleSeason(rewardSeason);
  assert.equal(result.alreadySettled, false);
  assert.equal(result.settledCount, 2);

  const aliceNotes = seasonNotifications(alice);
  assert.equal(aliceNotes.length, 1, '每个受奖账号只写一条赛季通知');
  assert.equal(aliceNotes[0].kind, 'season');
  assert.equal(aliceNotes[0].dedupeKey, `season:${rewardSeason}`);
  assert.deepEqual(aliceNotes[0].payload, { season: rewardSeason, rank: 1, cores: 300 });
  assert.equal(aliceNotes[0].readAt, null, '新通知应为未读');

  const bobNotes = seasonNotifications(bob);
  assert.equal(bobNotes.length, 1);
  assert.deepEqual(bobNotes[0].payload, { season: rewardSeason, rank: 2, cores: 180 });

  assert.equal(notifications.notificationSummary(alice).unread, 1);
  assert.equal(notifications.notificationSummary(bob).unread, 1);

  const item = { kind: 'season', payload: aliceNotes[0].payload };
  assert.equal(notificationKindLabel(item), '赛季奖励');
  assert.equal(isSeasonReward(item), true);
  assert.equal(notificationJumpTarget(item), 'season');
  assert.match(describeNotification(item), /第 1 名/);
  assert.match(describeNotification(item), /300 星核/);

  // 非赛季奖励不显示跳转，样式判断也不误命中。
  const achievement = { kind: 'achievement', payload: { title: 'x' } };
  assert.equal(isSeasonReward(achievement), false);
  assert.equal(notificationJumpTarget(achievement), null);
});

test('重复结算不重复通知', () => {
  const beforeNotes = seasonNotifications(alice);
  const beforeUnread = notifications.notificationSummary(alice).unread;

  const again = leaderboard.settleSeason(rewardSeason);
  assert.equal(again.alreadySettled, true);

  assert.deepEqual(seasonNotifications(alice), beforeNotes);
  assert.deepEqual(seasonNotifications(bob).length, 1);
  assert.equal(notifications.notificationSummary(alice).unread, beforeUnread, '重复结算不新增未读');

  // 即使绕过已有结果、直接用同一幂等键写入，也不会新增记录。
  const dedupeKey = `season:${rewardSeason}`;
  notifications.notify(alice, {
    kind: 'season',
    dedupeKey,
    payload: { season: rewardSeason, rank: 1, cores: 300 },
  });
  notifications.notify(alice, {
    kind: 'season',
    dedupeKey,
    payload: { season: rewardSeason, rank: 1, cores: 300 },
  });
  assert.deepEqual(seasonNotifications(alice), beforeNotes);
});

test('偏好关闭时只停止写入新未读，奖励照发且历史通知仍可查', () => {
  const carol = makeAccount('notify-carol');
  // 偏好开启时先留一条历史通知，用于验证关闭偏好后历史仍可读。
  notifications.notify(carol, {
    kind: 'season',
    dedupeKey: 'season:2020-01',
    payload: { season: '2020-01', rank: 9, cores: 40 },
  });
  notifications.writePrefs(carol, { season: false });

  addEntry(carol, prefSeason, 4200);
  const result = leaderboard.settleSeason(prefSeason);
  assert.equal(result.settledCount, 1);
  assert.equal(wallet(carol), 300, '关闭偏好不应影响奖励发放');

  const rows = seasonNotifications(carol);
  assert.equal(rows.length, 1, '偏好关闭后不再写入新的赛季通知');
  assert.equal(rows[0].dedupeKey, 'season:2020-01');

  const page = notifications.list(carol);
  assert.equal(page.items.length, 1, '历史通知仍可查询');
  assert.equal(page.unread, 1, '历史未读仍保留');
});

test('通知写入失败不影响发奖（best-effort）', () => {
  const dave = makeAccount('notify-dave');
  addEntry(dave, failSeason, 3900);

  db.exec(`
    CREATE TRIGGER fail_season_notify
    BEFORE INSERT ON account_notifications
    WHEN NEW.account_id = '${dave}'
    BEGIN
      SELECT RAISE(ABORT, 'notify down');
    END;
  `);
  try {
    const result = leaderboard.settleSeason(failSeason);
    assert.equal(result.settledCount, 1, '通知写入失败不应中断结算');
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_season_notify');
  }

  assert.equal(wallet(dave), 300, '奖励仍然发放');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM season_results WHERE season = ?').get(failSeason).c,
    1,
    '结算结果仍然入库'
  );
  assert.equal(seasonNotifications(dave).length, 0);
  assert.equal(notifications.notificationSummary(dave).unread, 0);
});

test('赛季奖励通知只对本人可见', () => {
  const erin = makeAccount('notify-erin');
  const frank = makeAccount('notify-frank');
  const ghost = makeAccount('notify-ghost');
  addEntry(erin, visibilitySeason, 5000);
  addEntry(frank, visibilitySeason, 4000);

  leaderboard.settleSeason(visibilitySeason);

  const erinItems = notifications.list(erin).items;
  const frankItems = notifications.list(frank).items;
  assert.equal(erinItems.length, 1);
  assert.equal(frankItems.length, 1);
  assert.equal(erinItems[0].payload.rank, 1);
  assert.equal(frankItems[0].payload.rank, 2);
  assert.equal(
    erinItems.some((item) => JSON.stringify(item.payload) === JSON.stringify(frankItems[0].payload)),
    false,
    '不能读到他人的赛季通知'
  );
  assert.equal(notifications.list(ghost).items.length, 0, '未上榜账号没有赛季通知');
});

test('dry-run 结算不写通知也不发奖', () => {
  const gina = makeAccount('notify-gina');
  addEntry(gina, drySeason, 4100);

  const preview = leaderboard.settleSeason(drySeason, { dryRun: true });
  assert.equal(preview.settledCount, 1);
  assert.equal(wallet(gina), 0);
  assert.equal(seasonNotifications(gina).length, 0);
  assert.equal(notifications.notificationSummary(gina).unread, 0);
});
