// 赛季成就面板与通知：面板分组、剩余天数、解锁写入通知，以及偏好关闭时不写新未读。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { seasonPanelView } from '../public/js/ui/panels.js';
import {
  describeNotification,
  isSeasonalAchievement,
  notificationKindLabel,
} from '../public/js/ui/notifications.js';
import {
  parseSeasonalAchievementId,
  seasonalAchievementsFor,
} from '../public/js/shared/achievements.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const DB_PATH = path.join(os.tmpdir(), `rtd-seasonal-ui-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const ACHIEVEMENTS_UI = read('public/js/achievements-ui.js');

let deps = null;

before(async () => {
  const { db } = await import('../server/db/index.mjs');
  const accounts = await import('../server/db/accounts.mjs');
  const achievements = await import('../server/db/achievements.mjs');
  const notifications = await import('../server/db/notifications.mjs');
  const { seasonOf, seasonBounds } = await import('../server/db/leaderboard.mjs');

  const season = seasonOf();
  const bounds = seasonBounds(season);
  assert.ok(season && bounds, '当前赛季应可派生');

  // 15 局分散在 15 个日期：无论本赛季轮换出哪 5 个模板，都至少有赛季成就可以解锁。
  const seed = (prefix) => {
    const account = accounts.createAccount({
      kind: 'registered',
      username: `${prefix}${Date.now().toString(36)}`,
      passwordHash: 'seasonal-ui-test-password',
    });
    const insert = db.prepare(
      `INSERT INTO runs
         (id, account_id, mode, difficulty, seed, day, status, victory, score,
          wave_reached, kills, duration_ms, created_at, finished_at)
       VALUES (?, ?, 'normal', 'standard', ?, ?, 'finished', 1, ?, 30, 100, 60000, ?, ?)`
    );
    for (let i = 0; i < 15; i += 1) {
      const day = `${season}-${String(i + 1).padStart(2, '0')}`;
      const createdAt = bounds.start + i * 3600 * 1000;
      insert.run(`${prefix}-${i}`, account.id, `s${i}`, day, 12000, createdAt, createdAt);
    }
    return account;
  };

  deps = {
    db,
    achievements,
    notifications,
    season,
    alice: seed('seasonui-a'),
    bob: seed('seasonui-b'),
  };
});

after(() => {
  try {
    deps?.db?.close();
  } catch {
    /* 已关闭 */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
});

test('赛季面板剩余天数：进行中、服务端 endsAt 与已结束三种读法', () => {
  const noon = new Date(2026, 9, 26, 12).getTime();
  const active = seasonPanelView({ season: '2026-10' }, noon);
  assert.equal(active.endsAt, new Date(2026, 10, 1).getTime(), '缺省 endsAt 按赛季月末推导');
  assert.equal(active.ended, false);
  assert.equal(active.daysLeft, 6, '最后一天之前向上取整到整天');

  const fromServer = seasonPanelView(
    { season: '2026-10', endsAt: new Date(2026, 9, 30).getTime() },
    noon
  );
  assert.equal(fromServer.daysLeft, 4, '优先使用服务端返回的 endsAt');

  const ended = seasonPanelView({ season: '2026-10' }, new Date(2026, 10, 1).getTime());
  assert.equal(ended.ended, true);
  assert.equal(ended.daysLeft, 0, '赛季结束后剩余天数为 0');

  assert.deepEqual(seasonPanelView({}), {
    season: null,
    endsAt: null,
    daysLeft: null,
    ended: true,
  });
  assert.equal(seasonPanelView({ season: '2026-13' }).endsAt, null, '非法赛季不推导时间轴');
});

test('成就摘要携带本赛季分组、进度与剩余天数', () => {
  const summary = deps.achievements.achievementSummary(deps.alice.id);
  const seasonal = summary.seasonal;
  assert.equal(seasonal.season, deps.season);
  assert.equal(seasonal.achievements.length, seasonalAchievementsFor(deps.season).length);
  assert.equal(typeof seasonal.endsAt, 'number');
  assert.equal(seasonal.ended, false);
  assert.ok(seasonal.daysLeft >= 1 && seasonal.daysLeft <= 31, '剩余天数落在当月区间内');
  for (const item of seasonal.achievements) {
    assert.equal(item.group, 'season');
    assert.equal(item.groupName, '本赛季');
  }
});

test('成就页渲染本赛季区块的剩余天数与结束状态', () => {
  assert.match(ACHIEVEMENTS_UI, /seasonPanelView/, '面板必须复用剩余天数计算');
  assert.match(ACHIEVEMENTS_UI, /achievement-season-meta/, '本赛季区块需要状态行');
  assert.match(ACHIEVEMENTS_UI, /剩余 \{days\} 天 \/ \{days\} days left/, '进行中状态中英双语');
  assert.match(ACHIEVEMENTS_UI, /本赛季已结束 \/ Season ended/, '结束状态中英双语');

  // tOr 只对字典命中项做插值 ⇒ 新文案必须真正落进中英字典，否则界面上会残留 {days}。
  for (const key of [
    'achievements.seasonCurrent',
    'achievements.seasonHistory',
    'achievements.seasonDaysLeft',
    'achievements.seasonEnded',
  ]) {
    assert.equal(typeof zhCN[key], 'string', `中文缺文案：${key}`);
    assert.equal(typeof enUS[key], 'string', `英文缺文案：${key}`);
  }
  assert.match(zhCN['achievements.seasonDaysLeft'], /\{days\}/);
  assert.match(enUS['achievements.seasonDaysLeft'], /\{days\}/);
});

test('赛季成就解锁写入通知中心，并使用独立的赛季成就文案', () => {
  const added = deps.achievements.unlockAchievements(deps.alice.id, {});
  const seasonalAdded = added.filter((id) => parseSeasonalAchievementId(id));
  assert.ok(seasonalAdded.length > 0, `应解锁赛季成就，实际：${added.join(',')}`);

  const summary = deps.notifications.notificationSummary(deps.alice.id);
  assert.ok(summary.unread > 0, '解锁后应有未读通知');

  const seasonalItems = summary.items.filter(isSeasonalAchievement);
  assert.ok(seasonalItems.length > 0, '赛季成就应进入通知中心');
  for (const item of seasonalItems) {
    assert.equal(item.kind, 'achievement');
    assert.equal(item.payload.season, deps.season);
    assert.match(item.payload.achievementId, /^seasonal:/);
    assert.equal(notificationKindLabel(item), '赛季成就');
    assert.match(describeNotification(item), /解锁赛季成就「.+」（\d{4}-\d{2} 赛季）/);
  }

  const regular = summary.items.find((item) => item.kind === 'achievement' && !item.payload.seasonal);
  assert.ok(regular, '普通成就仍然写入通知');
  assert.equal(notificationKindLabel(regular), '成就解锁');
  assert.equal(describeNotification(regular).startsWith('解锁成就「'), true);

  // 重复结算同样保持幂等，不再新增通知。
  const before = summary.unread;
  deps.achievements.unlockAchievements(deps.alice.id, {});
  assert.equal(deps.notifications.notificationSummary(deps.alice.id).unread, before);
});

test('关闭成就通知偏好后，赛季成就仍解锁但不产生新未读', () => {
  deps.notifications.writePrefs(deps.bob.id, { achievement: false });

  const added = deps.achievements.unlockAchievements(deps.bob.id, {});
  assert.ok(added.length > 0, '成就本身仍然解锁');
  assert.ok(
    added.some((id) => parseSeasonalAchievementId(id)),
    '赛季成就本身仍然解锁'
  );
  assert.equal(
    deps.notifications.notificationSummary(deps.bob.id).unread,
    0,
    '偏好关闭时只拦通知，不拦解锁'
  );
});
