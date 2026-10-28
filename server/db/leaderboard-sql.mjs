// 排行榜查询构造：赛季键/区间、榜单键、排序口径、筛选条件与游标参数。
// 只做纯字符串与参数构造，不碰数据库；执行与结果组装在 leaderboard.mjs。
import { dayKey } from '../../public/js/shared/scoring.js';

// v2：每日挑战使用固定规则集，与 v1（受账号解锁影响）的旧榜分开；旧数据保留不迁移。
// 无尽与本周挑战各自使用独立榜单，不与普通/每日榜合并；day 为周键时按周隔离。
export function boardKeyFor(mode, day, { season = null } = {}) {
  if (mode === 'daily') return `daily:${day}:v2`;
  // 无尽榜按赛季分榜：赛季默认当前自然月；旧数据（board_key='endless'）保持原键不迁移。
  if (mode === 'endless') {
    const key = season || seasonOf();
    return key ? `endless:${key}` : 'endless';
  }
  if (mode === 'weekly') return `weekly:${day}`;
  // 变异榜按规范化后的变异组合隔离：不同组合各自独立，互不混榜。
  if (mode === 'mutated') return `mutated:${day}`;
  return 'normal';
}

export const SEASON_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isSeasonKey(value) {
  return typeof value === 'string' && SEASON_KEY_RE.test(value);
}

// 赛季按服务器本地时区的自然月划分；旧数据按 created_at 自动归入所在赛季。
export function seasonOf(ts = Date.now()) {
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(date).slice(0, 7);
}

// 返回赛季的毫秒区间 [start, end)，边界同样按服务器本地时区。
export function seasonBounds(season) {
  if (!isSeasonKey(season)) return null;
  const [year, month] = season.split('-').map(Number);
  return {
    start: new Date(year, month - 1, 1).getTime(),
    end: new Date(year, month, 1).getTime(),
  };
}

// ---------- 榜单排序（集中定义） ----------

// 无尽榜以「最高波次 → 分数」排序，其余榜单以「分数」排序；并列都先比用时、再比记录先后。
// 这里同时是排序、个人最佳与名次比较的唯一来源，避免各处手写顺序不一致。
const SORT_FIELDS = {
  wave: { sql: (alias) => (alias ? waveSql(alias) : 'wave'), dir: 'DESC' },
  score: { sql: (alias) => (alias ? `${alias}.score` : 'score'), dir: 'DESC' },
  duration: { sql: (alias) => (alias ? `${alias}.duration_ms` : 'duration_ms'), dir: 'ASC' },
};

export const BOARD_SORT = Object.freeze({
  endless: Object.freeze(['wave', 'score', 'duration']),
  normal: Object.freeze(['score', 'duration']),
});

export function boardSort(mode) {
  return mode === 'endless' ? BOARD_SORT.endless : BOARD_SORT.normal;
}

// 无尽榜的波次存放在 metrics_json 中；读取时按整数处理，坏数据回落到 0。
export function waveSql(alias) {
  return `CAST(COALESCE(json_extract(${alias}.metrics_json, '$.wave'), 0) AS INTEGER)`;
}

// alias 为空时用于外层查询（列已在子查询里展开成 wave/score/duration_ms 别名）。
export function boardOrderBy(mode, alias) {
  return boardSort(mode)
    .map((field) => `${SORT_FIELDS[field].sql(alias)} ${SORT_FIELDS[field].dir}`)
    .join(', ');
}

// 与排序规则同序的“严格优于”条件；用于对已选出 wave/score/duration_ms 的子查询再过滤。
export function betterCondition(mode) {
  if (mode === 'endless') {
    return 'wave > ? OR (wave = ? AND (score > ? OR (score = ? AND duration_ms < ?)))';
  }
  return 'score > ? OR (score = ? AND duration_ms < ?)';
}

export function betterParams(mode, { wave = 0, score = 0, durationMs = 0 } = {}) {
  const entry = { wave: Number(wave) || 0, score: Number(score) || 0, durationMs: Number(durationMs) || 0 };
  if (mode === 'endless') {
    return [entry.wave, entry.wave, entry.score, entry.score, entry.durationMs];
  }
  return [entry.score, entry.score, entry.durationMs];
}

// 无尽榜按赛季分榜；旧版 board_key='endless' 的存量数据按 created_at 归入所在赛季继续可见。
export function boardKeyCondition(mode, day, season) {
  if (mode === 'endless') {
    return {
      sql: "(e.board_key = ? OR e.board_key = 'endless')",
      params: [boardKeyFor(mode, day, { season })],
    };
  }
  return { sql: 'e.board_key = ?', params: [boardKeyFor(mode, day)] };
}

// 榜单筛选范围：榜单键 + 注册账号过滤 + 可选难度/赛季边界（赛季边界同样按本地时区）。
export function boardScope(mode, day, { includeUnclaimed = false, difficulty = null, season = null } = {}) {
  const key = boardKeyCondition(mode, day, season);
  const clauses = [key.sql, "(? = 1 OR a.kind = 'registered')"];
  const params = [...key.params, includeUnclaimed ? 1 : 0];
  if (difficulty) {
    clauses.push('e.difficulty = ?');
    params.push(difficulty);
  }
  const bounds = season ? seasonBounds(season) : null;
  if (bounds) {
    clauses.push('e.created_at >= ?', 'e.created_at < ?');
    params.push(bounds.start, bounds.end);
  }
  return { where: clauses.join(' AND '), params };
}

// ---------- 语句文本构造 ----------

// 榜单行视图（每个账号只留排序最优的一行）：offset 分页与游标分页共用同一份内层查询，
// 两张榜的差异只在尾部的 WHERE/ORDER BY/LIMIT，由调用方拼接。
export function boardRowSelectSql(mode, where) {
  return `SELECT * FROM (
         SELECT e.id, e.account_id, e.display_name, e.difficulty, e.score,
                e.duration_ms, e.metrics_json, e.content_version, e.created_at,
                ${waveSql('e')} AS wave,
                s.value_json AS selected_cosmetics,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY ${boardOrderBy(mode, 'e')}, e.id ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
           LEFT JOIN player_kv s
             ON s.account_id = e.account_id
            AND s.namespace = 'cosmetics'
            AND s.key = 'selected'
          WHERE ${where}
       ) WHERE rn = 1`;
}

// 个人榜单单行（最佳/最近各取一行，排序由调用方决定）。
export function accountEntrySelectSql(where) {
  return `SELECT e.difficulty, e.score, e.duration_ms, e.metrics_json, e.content_version, e.created_at
         FROM leaderboard_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE ${where}`;
}

// 非无尽榜名次：只按每个账号的最高分比较。
export function scoreRankSql(where) {
  return `SELECT COUNT(*) AS c FROM (
         SELECT e.account_id, MAX(e.score) AS s
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE ${where}
          GROUP BY e.account_id
       ) WHERE s > ?`;
}

// ---------- 游标参数构造 ----------

const CURSOR_VERSION = 1;

// 游标只携带定位用的排序键，不携带权限信息：查询范围始终由请求参数重新推导并校验，
// 因此伪造游标最多只能在本就有权看到的榜单内跳页，无法借此读到越权数据。
export function encodeCursor({
  offset = 0,
  mode,
  day,
  difficulty = null,
  season = null,
  includeUnclaimed = false,
  wave = 0,
  score = 0,
  durationMs = 0,
  createdAt = 0,
  id = 0,
} = {}) {
  const payload = {
    v: CURSOR_VERSION,
    o: Math.max(0, Math.floor(Number(offset) || 0)),
    m: mode,
    d: day,
    f: difficulty || '',
    s: season || '',
    u: includeUnclaimed ? 1 : 0,
    w: Math.max(0, Math.floor(Number(wave) || 0)),
    c: Math.max(0, Math.floor(Number(score) || 0)),
    t: Math.max(0, Math.floor(Number(durationMs) || 0)),
    a: Math.max(0, Math.floor(Number(createdAt) || 0)),
    i: Math.max(0, Math.floor(Number(id) || 0)),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.v !== CURSOR_VERSION) return null;
  if (typeof data.m !== 'string' || data.m.length > 16) return null;
  if (typeof data.d !== 'string' || data.d.length > 32) return null;
  if (typeof data.f !== 'string' || data.f.length > 32) return null;
  if (typeof data.s !== 'string' || data.s.length > 16) return null;
  if (data.u !== 0 && data.u !== 1) return null;
  const numbers = {
    offset: data.o,
    wave: data.w,
    score: data.c,
    durationMs: data.t,
    createdAt: data.a,
    id: data.i,
  };
  for (const value of Object.values(numbers)) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
  }
  return {
    ...numbers,
    mode: data.m,
    day: data.d,
    difficulty: data.f || null,
    season: data.s || null,
    includeUnclaimed: data.u === 1,
  };
}

// 游标必须与本次请求的榜单维度完全一致，否则视为非法，绝不复用到别的榜。
export function cursorInScope(cursor, { mode, day, difficulty, season, includeUnclaimed }) {
  return (
    cursor.mode === mode &&
    cursor.day === day &&
    (cursor.difficulty || '') === (difficulty || '') &&
    (cursor.season || '') === (season || '') &&
    cursor.includeUnclaimed === !!includeUnclaimed
  );
}

// 与 ORDER BY 严格同序的 keyset 条件：分数/波次 DESC、用时 ASC、记录时间 ASC、id ASC。
// 用行值比较表达，避免手写多层 OR 括号出错。
export function cursorPredicate(mode) {
  return mode === 'endless'
    ? { sql: '(wave, score, -duration_ms, created_at, id) < (?, ?, ?, ?, ?)' }
    : { sql: '(score, -duration_ms, created_at, id) < (?, ?, ?, ?)' };
}

export function cursorPredicateParams(mode, cursor) {
  return mode === 'endless'
    ? [cursor.wave, cursor.score, -cursor.durationMs, cursor.createdAt, cursor.id]
    : [cursor.score, -cursor.durationMs, cursor.createdAt, cursor.id];
}
