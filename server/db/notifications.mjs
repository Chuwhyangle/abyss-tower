// 通知中心持久化：写入保持幂等，读取按游标分页，90 天前的明细按周归档。
// 写入失败不阻断结算等主流程；归档同样只影响通知本身。
import { db, transaction } from './index.mjs';
import { weekKey } from '../../public/js/shared/scoring.js';

export const NOTIFICATION_LIMIT = 20;
// 分页上限：单次最多返回 50 条，避免客户端用超大 limit 拉全表。
export const DEFAULT_NOTIFICATION_PAGE = 20;
export const MAX_NOTIFICATION_PAGE = 50;
export const NOTIFICATION_ARCHIVE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_NAMESPACE = 'notifications';
const ARCHIVE_KEY = 'archive';

// 通知偏好：成就 / 悬赏 / 赛季三类，默认全部接收。
export const NOTIFICATION_KINDS = ['achievement', 'bounty', 'season'];
export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  achievement: true,
  bounty: true,
  season: true,
});
const PREFS_NAMESPACE = 'notifications';
const PREFS_KEY = 'prefs';

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
    if (!NOTIFICATION_KINDS.includes(key)) {
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
  if (!NOTIFICATION_KINDS.includes(kind)) return true;
  return readPrefs(accountId)[kind] !== false;
}

// 通知是附加反馈：缺表、约束冲突、锁等待等任何失败都只吞掉，返回 null。
// 同一 (kind, dedupeKey) 重复写入保持幂等，不会新增未读。
export function notify(accountId, { kind, dedupeKey, payload = {} }, now = Date.now()) {
  if (!accountId || !kind || !dedupeKey) return null;
  // 关闭的类型只停止产生新的未读，历史记录保持可读。
  if (!isKindEnabled(accountId, kind)) return null;
  try {
    const result = db
      .prepare(
        `INSERT INTO account_notifications
           (account_id, kind, dedupe_key, payload, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(account_id, kind, dedupe_key) DO NOTHING`
      )
      .run(accountId, kind, dedupeKey, JSON.stringify(payload ?? {}), now);
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

// 全部标记已读：只影响本人未读记录，返回实际更新条数。
export function markAllRead(accountId, now = Date.now()) {
  const result = db
    .prepare(
      `UPDATE account_notifications SET read_at = ?
        WHERE account_id = ? AND read_at IS NULL`
    )
    .run(now, accountId);
  return { ok: true, updated: Number(result.changes) || 0, unread: 0 };
}
