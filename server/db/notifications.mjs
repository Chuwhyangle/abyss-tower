// 通知中心持久化：写入保持幂等，读取按游标分页，90 天前的明细按周归档。
// 写入失败不阻断结算等主流程；归档同样只影响通知本身。
import crypto from 'node:crypto';
import { db, transaction } from './index.mjs';
import { weekKey } from '../../public/js/shared/scoring.js';

export const NOTIFICATION_LIMIT = 20;
// 分页上限：单次最多返回 50 条，避免客户端用超大 limit 拉全表。
export const DEFAULT_NOTIFICATION_PAGE = 20;
export const MAX_NOTIFICATION_PAGE = 50;
export const NOTIFICATION_ARCHIVE_DAYS = 90;
// 批量已读的单批上限：路由与客户端都引用这里，避免两处各自定义。
export const NOTIFICATION_READ_BATCH_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_NAMESPACE = 'notifications';
const ARCHIVE_KEY = 'archive';

// 通知类型 → 偏好键的唯一映射。新增类型只改这里，读写两侧不会各自漂移。
// 公告偏好键用复数 announcements，避免与 kind 同名混淆。
export const NOTIFICATION_PREF_KEYS = Object.freeze({
  achievement: 'achievement',
  bounty: 'bounty',
  season: 'season',
  announcement: 'announcements',
});
export const NOTIFICATION_KINDS = Object.freeze(Object.keys(NOTIFICATION_PREF_KEYS));
export const DEFAULT_NOTIFICATION_PREFS = Object.freeze(
  Object.fromEntries(Object.values(NOTIFICATION_PREF_KEYS).map((key) => [key, true]))
);

// 重要公告（维护、停服等）不受偏好开关影响，必须送达。
export function isImportantAnnouncement({ kind, payload, important = false } = {}) {
  if (kind !== 'announcement') return false;
  return important === true || payload?.important === true;
}
const PREFS_NAMESPACE = 'notifications';
const PREFS_KEY = 'prefs';
const PREF_KEYS = Object.freeze(Object.values(NOTIFICATION_PREF_KEYS));

function parsePayload(text) {
  try {
    return JSON.parse(text || '{}') ?? {};
  } catch {
    return {};
  }
}

// 超过上限时删除最旧的记录；同毫秒写入用 id 作为稳定次序。
function prune(accountId) {
  db.prepare(
    `DELETE FROM account_notifications
      WHERE account_id = ?
        AND id NOT IN (
          SELECT id FROM account_notifications
           WHERE account_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
        )`
  ).run(accountId, accountId, NOTIFICATION_LIMIT);
}

// 只接受已知类型 + 布尔值；非法项回退该类型默认值并记录警告，未知字段忽略。
export function normalizePrefs(raw, warn = console.warn) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const prefs = {};
  const invalid = [];
  for (const [key, value] of Object.entries(source)) {
    if (!PREF_KEYS.includes(key)) {
      invalid.push(key);
      if (typeof warn === 'function') {
        warn(`[notifications] 忽略未知偏好 ${key}`);
      }
      continue;
    }
    if (typeof value !== 'boolean') {
      invalid.push(key);
      prefs[key] = DEFAULT_NOTIFICATION_PREFS[key];
      if (typeof warn === 'function') {
        warn(
          `[notifications] 偏好 ${key}=${JSON.stringify(value)} 非法，回退默认 ${DEFAULT_NOTIFICATION_PREFS[key]}`
        );
      }
      continue;
    }
    prefs[key] = value;
  }
  return { prefs, invalid };
}

// 读取偏好：无记录、数据损坏或查询失败都回退默认全开，保证主流程不受影响。
export function readPrefs(accountId) {
  if (!accountId) return { ...DEFAULT_NOTIFICATION_PREFS };
  try {
    const row = db
      .prepare(
        'SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?'
      )
      .get(accountId, PREFS_NAMESPACE, PREFS_KEY);
    if (!row) return { ...DEFAULT_NOTIFICATION_PREFS };
    let parsed;
    try {
      parsed = JSON.parse(row.value_json);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('[notifications] 偏好数据损坏，已回退默认值');
      return { ...DEFAULT_NOTIFICATION_PREFS };
    }
    return { ...DEFAULT_NOTIFICATION_PREFS, ...normalizePrefs(parsed).prefs };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

// 合并写入：只更新给出的类型，非法值回退默认；返回最终偏好与被忽略的字段。
export function writePrefs(accountId, patch, now = Date.now()) {
  const { prefs: incoming, invalid } = normalizePrefs(patch);
  const prefs = { ...readPrefs(accountId), ...incoming };
  try {
    db.prepare(
      `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, namespace, key) DO UPDATE SET
         value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(accountId, PREFS_NAMESPACE, PREFS_KEY, JSON.stringify(prefs), now);
  } catch {
    // 偏好写入失败不应阻断通知本身；内存中的默认值仍然生效。
  }
  return { prefs, invalid };
}

function isKindEnabled(accountId, kind) {
  const prefKey = NOTIFICATION_PREF_KEYS[kind];
  if (!prefKey) return true;
  return readPrefs(accountId)[prefKey] !== false;
}

// 通知是附加反馈：缺表、约束冲突、锁等待等任何失败都只吞掉，返回 null。
// 同一 (kind, dedupeKey) 重复写入保持幂等，不会新增未读。
export function notify(
  accountId,
  { kind, dedupeKey, payload = {}, important = false },
  now = Date.now()
) {
  if (!accountId || !kind || !dedupeKey) return null;
  const importantAnnouncement = isImportantAnnouncement({ kind, payload, important });
  // 关闭的类型只停止产生新的未读，历史记录保持可读；重要公告是维护信息，不受偏好影响。
  if (!importantAnnouncement && !isKindEnabled(accountId, kind)) return null;
  const basePayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const storedPayload = importantAnnouncement ? { ...basePayload, important: true } : payload ?? {};
  try {
    const result = db
      .prepare(
        `INSERT INTO account_notifications
           (account_id, kind, dedupe_key, payload, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(account_id, kind, dedupe_key) DO NOTHING`
      )
      .run(accountId, kind, dedupeKey, JSON.stringify(storedPayload), now);
    if (result.changes !== 1) return null;
    prune(accountId);
    return { kind, dedupeKey };
  } catch {
    return null;
  }
}

function mapRow(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    payload: parsePayload(row.payload),
    createdAt: Number(row.created_at),
    readAt: row.read_at == null ? null : Number(row.read_at),
  };
}

function countUnread(accountId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM account_notifications
        WHERE account_id = ? AND read_at IS NULL`
    )
    .get(accountId);
  return Math.max(0, Number(row?.c) || 0);
}

// 游标只暴露「上一页最后一条的时间 + id」，不含账号信息，且查询始终按 account_id 收窄。
function encodeCursor(row) {
  return Buffer.from(
    JSON.stringify({ createdAt: Number(row.created_at), id: Number(row.id) })
  ).toString('base64url');
}

function decodeCursor(raw) {
  try {
    const value = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!value || !Number.isFinite(value.createdAt) || !Number.isFinite(value.id)) return null;
    return { createdAt: Number(value.createdAt), id: Number(value.id) };
  } catch {
    return null;
  }
}

function emptyArchive() {
  return { weeks: [], totalArchived: 0, updatedAt: null };
}

function readArchiveRaw(accountId) {
  try {
    const row = db
      .prepare(
        'SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?'
      )
      .get(accountId, ARCHIVE_NAMESPACE, ARCHIVE_KEY);
    if (!row) return { weeks: {}, updatedAt: null };
    const parsed = JSON.parse(row.value_json);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.weeks ||
      typeof parsed.weeks !== 'object' ||
      Array.isArray(parsed.weeks)
    ) {
      return { weeks: {}, updatedAt: null };
    }
    return { weeks: parsed.weeks, updatedAt: parsed.updatedAt ?? null };
  } catch {
    return { weeks: {}, updatedAt: null };
  }
}

function writeArchiveRaw(accountId, raw, now) {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(accountId, ARCHIVE_NAMESPACE, ARCHIVE_KEY, JSON.stringify(raw), now);
}

// 归档摘要：按周倒序返回，供客户端展示长期通知的聚合结果。
export function readArchive(accountId) {
  if (!accountId) return emptyArchive();
  const raw = readArchiveRaw(accountId);
  const weeks = Object.entries(raw.weeks)
    .map(([week, value]) => ({
      week,
      total: Math.max(0, Number(value?.total) || 0),
      unread: Math.max(0, Number(value?.unread) || 0),
      kinds: { ...(value?.kinds && typeof value.kinds === 'object' ? value.kinds : {}) },
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
  return {
    weeks,
    totalArchived: weeks.reduce((sum, entry) => sum + entry.total, 0),
    updatedAt: raw.updatedAt == null ? null : Number(raw.updatedAt),
  };
}

// 游标分页：以 (created_at, id) 为键，非法游标返回 null（路由层转 400，绝不静默回首页）。
export function list(accountId, { cursor: rawCursor = null, limit = DEFAULT_NOTIFICATION_PAGE } = {}) {
  if (!accountId) return { items: [], nextCursor: null, unread: 0, archive: emptyArchive() };
  let cursor = null;
  if (rawCursor != null && rawCursor !== '') {
    cursor = decodeCursor(rawCursor);
    if (!cursor) return null;
  }
  const size = Math.max(
    1,
    Math.min(MAX_NOTIFICATION_PAGE, Math.floor(Number(limit)) || DEFAULT_NOTIFICATION_PAGE)
  );
  const clauses = ['account_id = ?'];
  const params = [accountId];
  if (cursor) {
    clauses.push('(created_at, id) < (?, ?)');
    params.push(cursor.createdAt, cursor.id);
  }
  const rows = db
    .prepare(
      `SELECT id, kind, payload, created_at, read_at
         FROM account_notifications
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    )
    .all(...params, size + 1);
  const hasMore = rows.length > size;
  const pageRows = hasMore ? rows.slice(0, size) : rows;
  return {
    items: pageRows.map(mapRow),
    nextCursor: hasMore ? encodeCursor(pageRows.at(-1)) : null,
    unread: countUnread(accountId),
    archive: readArchive(accountId),
  };
}

// 返回最近 20 条与未读数；保留旧调用方的响应形状。
export function notificationSummary(accountId) {
  const page = list(accountId, { limit: NOTIFICATION_LIMIT });
  return { unread: page.unread, items: page.items };
}

// 90 天前的明细按 ISO 周聚合后删除；聚合结果累加进 player_kv，重复调用是幂等的。
export function archiveOld(accountId, days = NOTIFICATION_ARCHIVE_DAYS, now = Date.now()) {
  if (!accountId) return { archived: 0, unreadArchived: 0, archive: emptyArchive() };
  const span = Number(days);
  const windowDays = Number.isFinite(span) && span > 0 ? span : NOTIFICATION_ARCHIVE_DAYS;
  const cutoff = now - windowDays * DAY_MS;
  const rows = db
    .prepare(
      `SELECT id, kind, created_at, read_at
         FROM account_notifications
        WHERE account_id = ? AND created_at < ?
        ORDER BY created_at ASC, id ASC`
    )
    .all(accountId, cutoff);
  // 没有可归档的明细时不进入写事务：读取路径每轮都会调用，避免白拿写锁。
  if (!rows.length) return { archived: 0, unreadArchived: 0, archive: readArchive(accountId) };
  return transaction(() => {
    const buckets = new Map();
    let unreadArchived = 0;
    for (const row of rows) {
      const week = weekKey(new Date(Number(row.created_at)));
      let bucket = buckets.get(week);
      if (!bucket) {
        bucket = { total: 0, unread: 0, kinds: {} };
        buckets.set(week, bucket);
      }
      bucket.total += 1;
      if (row.read_at == null) {
        bucket.unread += 1;
        unreadArchived += 1;
      }
      bucket.kinds[row.kind] = (bucket.kinds[row.kind] || 0) + 1;
    }

    const raw = readArchiveRaw(accountId);
    for (const [week, bucket] of buckets) {
      const target =
        raw.weeks[week] && typeof raw.weeks[week] === 'object'
          ? raw.weeks[week]
          : { total: 0, unread: 0, kinds: {} };
      target.total = (Number(target.total) || 0) + bucket.total;
      target.unread = (Number(target.unread) || 0) + bucket.unread;
      target.kinds =
        target.kinds && typeof target.kinds === 'object' ? target.kinds : {};
      for (const [kind, count] of Object.entries(bucket.kinds)) {
        target.kinds[kind] = (Number(target.kinds[kind]) || 0) + count;
      }
      raw.weeks[week] = target;
    }
    writeArchiveRaw(accountId, { weeks: raw.weeks, updatedAt: now }, now);

    const placeholders = rows.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM account_notifications WHERE account_id = ? AND id IN (${placeholders})`
    ).run(accountId, ...rows.map((row) => Number(row.id)));

    return { archived: rows.length, unreadArchived, archive: readArchive(accountId) };
  });
}

function normalizeBatchSize(limit) {
  const size = Math.floor(Number(limit));
  return Number.isFinite(size) && size > 0 ? size : NOTIFICATION_READ_BATCH_SIZE;
}

// 单批已读：只挑本人最旧的未读记录更新，返回本批条数与剩余未读数。
// 批次边界用 read_at IS NULL 收窄，重复或并发调用都不会重复计数。
export function markReadBatch(accountId, limit = NOTIFICATION_READ_BATCH_SIZE, now = Date.now()) {
  if (!accountId) return { updated: 0, remaining: 0 };
  const result = db
    .prepare(
      `UPDATE account_notifications SET read_at = ?
        WHERE id IN (
          SELECT id FROM account_notifications
           WHERE account_id = ? AND read_at IS NULL
           ORDER BY created_at ASC, id ASC
           LIMIT ?
        )`
    )
    .run(now, accountId, normalizeBatchSize(limit));
  return { updated: Number(result.changes) || 0, remaining: countUnread(accountId) };
}

// 全部标记已读：按批循环直到未读清零，返回累计更新条数（保留旧调用方的响应形状）。
export function markAllRead(accountId, now = Date.now()) {
  let updated = 0;
  let state = { updated: 0, remaining: 0 };
  // 上限防御：理论上每轮至少更新一条，异常数据下也不会无限循环。
  for (let round = 0; round < 100_000; round++) {
    state = markReadBatch(accountId, NOTIFICATION_READ_BATCH_SIZE, now);
    updated += state.updated;
    if (state.remaining === 0 || state.updated === 0) break;
  }
  return { ok: true, updated, unread: state.remaining, remaining: state.remaining };
}

// ---------- 公告管理 ----------
// 公告没有独立表：发布时按 (kind='announcement', dedupe_key=公告 id) 扇出成
// 每个账号一条通知，因此天然复用已读/未读与偏好逻辑，读取接口无需改动。
// 撤回只把对应记录标记已读并写入 revokedAt，历史保留但不再计入未读。

const ANNOUNCEMENT_KIND = 'announcement';
const ANNOUNCEMENT_ID_PREFIX = 'announcement:';

function announcementText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`公告${label}不能为空`);
  return text;
}

function announcementId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error('缺少公告 ID');
  return text;
}

function newAnnouncementId(now) {
  return `${ANNOUNCEMENT_ID_PREFIX}${now.toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function announcementRecipients() {
  return db
    .prepare("SELECT id FROM accounts WHERE status <> 'deleted' ORDER BY created_at, id")
    .all()
    .map((row) => row.id);
}

// 发布公告：普通公告尊重 announcements 偏好，重要公告强制送达（同 notify 的语义）。
// dryRun 时只统计接收人，不写任何记录。
export function createAnnouncement(
  { title, body, important = false, id = null } = {},
  { dryRun = false, now = Date.now() } = {}
) {
  const safeTitle = announcementText(title, '标题');
  const safeBody = announcementText(body, '正文');
  const announcementKey = id == null ? newAnnouncementId(now) : announcementId(id);
  const recipients = announcementRecipients();
  const summary = {
    id: announcementKey,
    title: safeTitle,
    body: safeBody,
    important: important === true,
    recipients: recipients.length,
  };
  if (dryRun) return { ...summary, dryRun: true, delivered: 0 };

  let delivered = 0;
  transaction(() => {
    for (const accountId of recipients) {
      const written = notify(
        accountId,
        {
          kind: ANNOUNCEMENT_KIND,
          dedupeKey: announcementKey,
          payload: { announcementId: announcementKey, title: safeTitle, body: safeBody },
          important: important === true,
        },
        now
      );
      if (written) delivered += 1;
    }
  });
  return { ...summary, dryRun: false, delivered };
}

// 撤回公告：标记已读（未读清零）+ payload.revokedAt，记录保留在通知历史里。
export function revokeAnnouncement(id, { dryRun = false, now = Date.now() } = {}) {
  const announcementKey = announcementId(id);
  const rows = db
    .prepare(
      `SELECT id, payload, read_at
         FROM account_notifications
        WHERE kind = ? AND dedupe_key = ?
        ORDER BY id`
    )
    .all(ANNOUNCEMENT_KIND, announcementKey);
  const result = {
    id: announcementKey,
    dryRun,
    affected: rows.length,
    unreadCleared: rows.filter((row) => row.read_at == null).length,
  };
  if (dryRun || rows.length === 0) return result;

  transaction(() => {
    const update = db.prepare(
      `UPDATE account_notifications
          SET payload = ?, read_at = COALESCE(read_at, ?)
        WHERE id = ?`
    );
    for (const row of rows) {
      const payload = { ...parsePayload(row.payload), revokedAt: now };
      update.run(JSON.stringify(payload), now, row.id);
    }
  });
  return result;
}

// 公告列表：按公告 id 聚合各账号通知，默认只返回未撤回的公告。
export function listAnnouncements({ includeRevoked = false } = {}) {
  const rows = db
    .prepare(
      `SELECT dedupe_key, payload, created_at, read_at
         FROM account_notifications
        WHERE kind = ?
        ORDER BY created_at DESC, id DESC`
    )
    .all(ANNOUNCEMENT_KIND);

  const announcements = new Map();
  for (const row of rows) {
    const key = row.dedupe_key;
    let entry = announcements.get(key);
    if (!entry) {
      entry = {
        id: key,
        title: '',
        body: '',
        important: false,
        createdAt: Number(row.created_at),
        recipients: 0,
        unread: 0,
        revokedAt: null,
      };
      announcements.set(key, entry);
    }
    const payload = parsePayload(row.payload);
    if (!entry.title && typeof payload.title === 'string') entry.title = payload.title;
    if (!entry.body && typeof payload.body === 'string') entry.body = payload.body;
    if (payload.important === true) entry.important = true;
    if (payload.revokedAt != null && entry.revokedAt == null) {
      entry.revokedAt = Number(payload.revokedAt);
    }
    entry.recipients += 1;
    if (row.read_at == null) entry.unread += 1;
  }

  return [...announcements.values()]
    .map((entry) => ({ ...entry, revoked: entry.revokedAt != null }))
    .filter((entry) => includeRevoked || !entry.revoked)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
