// 排行榜仓储的对外面：成绩写入、名次/个人汇总、分页与赛季结算都在这里编排；
// 查询构造（榜单键、排序、筛选、游标参数）在 leaderboard-sql.mjs，入榜校验在 leaderboard-validate.mjs。
import { db, transaction } from './index.mjs';
import { COSMETIC_TITLES } from '../../public/js/shared/achievements.js';
import { AUDIT_ACTIONS, recordAudit } from './audit.mjs';
import { notify } from './notifications.mjs';
import {
  accountEntrySelectSql,
  boardKeyCondition,
  boardKeyFor,
  boardOrderBy,
  boardRowSelectSql,
  boardScope,
  betterCondition,
  betterParams,
  cursorInScope,
  cursorPredicate,
  cursorPredicateParams,
  decodeCursor,
  encodeCursor,
  isSeasonKey,
  scoreRankSql,
  seasonBounds,
  seasonOf,
  waveSql,
} from './leaderboard-sql.mjs';

export function listSeasons() {
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m', created_at / 1000, 'unixepoch', 'localtime') AS season
         FROM leaderboard_entries
        ORDER BY season DESC`
    )
    .all();
  return rows.map((row) => row.season).filter(isSeasonKey);
}

export function recordLeaderboardEntry({
  accountId,
  displayName,
  runId,
  mode,
  day,
  difficulty,
  score,
  durationMs,
  wave,
  kills,
  victory,
  suspect = false,
  contentVersion,
  createdAt = Date.now(),
}) {
  const metricsPayload = {
    wave: Number(wave) || 0,
    kills: Number(kills) || 0,
    victory: victory ? 1 : 0,
  };
  // 只有可疑成绩才写标记，正常记录保持与改动前完全一致。
  if (suspect) metricsPayload.suspect = true;
  const metrics = JSON.stringify(metricsPayload);
  db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    // 成绩按记录时间归属赛季，与赛季过滤使用的 created_at 边界完全一致。
    boardKeyFor(mode, day, { season: seasonOf(createdAt) }),
    accountId,
    displayName,
    runId,
    difficulty,
    Number(score) || 0,
    Number(durationMs) || 0,
    contentVersion || 'v1.4-map2',
    metrics,
    createdAt
  );
  // 新成绩立即对读路径可见，不让 5 秒短期缓存拖慢结算后的刷新。
  clearLeaderboardCache();
}

export function personalBest(accountId, mode, day, { season = null } = {}) {
  const key = boardKeyCondition(mode, day, season);
  const clauses = ['e.account_id = ?', key.sql];
  const params = [accountId, ...key.params];
  // 无尽榜是赛季榜，个人最佳同样只在当前赛季内比较；其余榜保持全历史语义。
  const bounds = mode === 'endless' && season ? seasonBounds(season) : null;
  if (bounds) {
    clauses.push('e.created_at >= ?', 'e.created_at < ?');
    params.push(bounds.start, bounds.end);
  }
  const row = db
    .prepare(`SELECT MAX(e.score) AS s FROM leaderboard_entries e WHERE ${clauses.join(' AND ')}`)
    .get(...params);
  return row?.s || 0;
}

export function rankFor(
  mode,
  day,
  score,
  { includeUnclaimed = false, season = null, wave = null, durationMs = null } = {}
) {
  const key = boardKeyCondition(mode, day, season);
  const clauses = [key.sql, "(? = 1 OR a.kind = 'registered')"];
  const params = [...key.params, includeUnclaimed ? 1 : 0];
  const bounds = mode === 'endless' && season ? seasonBounds(season) : null;
  if (bounds) {
    clauses.push('e.created_at >= ?', 'e.created_at < ?');
    params.push(bounds.start, bounds.end);
  }

  if (mode === 'endless') {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT e.account_id, e.score, e.duration_ms, ${waveSql('e')} AS wave,
                  ROW_NUMBER() OVER (
                    PARTITION BY e.account_id
                    ORDER BY ${boardOrderBy('endless', 'e')}, e.id ASC
                  ) AS rn
             FROM leaderboard_entries e
             JOIN accounts a ON a.id = e.account_id
            WHERE ${clauses.join(' AND ')}
         ) WHERE rn = 1 AND (${betterCondition('endless')})`
      )
      .get(...params, ...betterParams('endless', { wave, score, durationMs }));
    return (row?.c || 0) + 1;
  }

  // 其余榜保持旧行为：只按每个账号的最高分比较，不引入时长或赛季维度。
  const row = db
    .prepare(scoreRankSql(clauses.join(' AND ')))
    .get(...params, Number(score) || 0);
  return (row?.c || 0) + 1;
}

export const MAX_BOARD_PAGE_SIZE = 50;

// 称号只读展示：与资料页共用“已选择 + 已知称号”语义，未知 id 或坏 JSON 一律按无称号处理。
function displayTitle(valueJson) {
  if (!valueJson) return null;
  let state;
  try {
    state = JSON.parse(valueJson);
  } catch {
    return null;
  }
  const title = state?.title;
  return typeof title === 'string' ? COSMETIC_TITLES[title]?.name || null : null;
}

function publicEntry(row) {
  let metrics = {};
  try {
    metrics = JSON.parse(row.metrics_json) || {};
  } catch {
    metrics = {};
  }
  return {
    name: row.display_name,
    title: displayTitle(row.selected_cosmetics),
    difficulty: row.difficulty || 'standard',
    wave: Number(metrics.wave) || 0,
    score: row.score,
    kills: Number(metrics.kills) || 0,
    victory: !!metrics.victory,
    // 反作弊标记只透出布尔值；具体规则说明由路由层按玩家口径补充，不暴露内部阈值。
    suspect: metrics.suspect === true,
    durationMs: row.duration_ms || 0,
    contentVersion: row.content_version,
    createdAt: row.created_at,
  };
}

// 个人汇总只含自己的成绩，不暴露账号 id、未知昵称或对局 id。
function personalEntry(row) {
  const entry = publicEntry(row);
  return {
    score: entry.score,
    difficulty: entry.difficulty,
    wave: entry.wave,
    victory: entry.victory,
    durationMs: entry.durationMs,
    createdAt: entry.createdAt,
  };
}

export function listBoard(
  mode,
  day,
  {
    includeUnclaimed = false,
    limit = 20,
    offset = 0,
    difficulty = null,
    accountId = null,
    season = null,
  } = {}
) {
  const size = Math.max(1, Math.min(MAX_BOARD_PAGE_SIZE, Math.floor(Number(limit) || 20)));
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const rows = db
    .prepare(
      `${boardRowSelectSql(mode, scope.where)}
       ORDER BY ${boardOrderBy(mode, null)}, created_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(...scope.params, size, start);

  return rows.map((row, index) => ({
    rank: start + index + 1,
    isMe: !!accountId && row.account_id === accountId,
    ...publicEntry(row),
  }));
}

// ---------- 游标分页与短期缓存 ----------

export const LEADERBOARD_CACHE_TTL_MS = 5_000;
export const MAX_CURSOR_PAGE_SIZE = 100;
const CACHE_MAX_PAGES = 500;

const pageCache = new Map();

// 缓存只服务读路径；任何写榜都会整体失效，避免不同榜单之间串页。
function clearLeaderboardCache() {
  pageCache.clear();
}

// 单页查询：取 size + 1 行判断是否还有下一页，绝不依赖总数推断。
function queryCursorPage({ mode, day, season, difficulty, includeUnclaimed, cursor, size }) {
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const clauses = [scope.where];
  const params = [...scope.params];
  if (cursor) {
    clauses.push(cursorPredicate(mode).sql);
    params.push(...cursorPredicateParams(mode, cursor));
  }
  const offset = cursor ? cursor.offset : 0;
  const rows = db
    .prepare(
      `${boardRowSelectSql(mode, scope.where)} AND ${clauses.slice(1).join(' AND ') || '1 = 1'}
       ORDER BY ${boardOrderBy(mode, null)}, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(...params, size + 1);

  const hasMore = rows.length > size;
  const pageRows = hasMore ? rows.slice(0, size) : rows;
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          offset: offset + size,
          mode,
          day,
          difficulty,
          season,
          includeUnclaimed,
          wave: Number(last.wave) || 0,
          score: last.score,
          durationMs: last.duration_ms,
          createdAt: last.created_at,
          id: last.id,
        })
      : null;
  return { rows: pageRows, offset, nextCursor };
}

function prunePageCache(now) {
  for (const [key, item] of pageCache) {
    if (item.expiresAt <= now) pageCache.delete(key);
  }
  while (pageCache.size >= CACHE_MAX_PAGES) {
    pageCache.delete(pageCache.keys().next().value);
  }
}

function cachedCursorPage(key, compute) {
  const now = Date.now();
  const hit = pageCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (hit) pageCache.delete(key);
  const value = compute();
  prunePageCache(now);
  pageCache.set(key, { value, expiresAt: now + LEADERBOARD_CACHE_TTL_MS });
  return value;
}

// 游标分页入口：非法游标返回 null，由路由层转成 400，而不是静默回退到首页。
export function listEntries({
  mode,
  day,
  season = null,
  difficulty = null,
  includeUnclaimed = false,
  cursor = null,
  limit = 20,
  accountId = null,
} = {}) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (
    cursor &&
    (!decoded || !cursorInScope(decoded, { mode, day, difficulty, season, includeUnclaimed }))
  ) {
    return null;
  }

  const size = Math.max(1, Math.min(MAX_CURSOR_PAGE_SIZE, Math.floor(Number(limit) || 20)));
  // 缓存键包含赛季/模式/难度/游标，同一页面在不同榜单之间绝不复用。
  const key = JSON.stringify([
    mode,
    day,
    season || '',
    difficulty || '',
    includeUnclaimed ? 1 : 0,
    cursor || '',
    size,
  ]);
  const page = cachedCursorPage(key, () =>
    queryCursorPage({ mode, day, season, difficulty, includeUnclaimed, cursor: decoded, size })
  );

  return {
    offset: page.offset,
    size,
    nextCursor: page.nextCursor,
    entries: page.rows.map((row, index) => ({
      rank: page.offset + index + 1,
      isMe: !!accountId && row.account_id === accountId,
      ...publicEntry(row),
    })),
  };
}

export function countBoard(
  mode,
  day,
  { includeUnclaimed = false, difficulty = null, season = null } = {}
) {
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT e.account_id) AS c
         FROM leaderboard_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE ${scope.where}`
    )
    .get(...scope.params);
  return row?.c || 0;
}

export function accountBoardSummary(
  accountId,
  mode,
  day,
  { includeUnclaimed = false, difficulty = null, season = null } = {}
) {
  const empty = { rank: null, best: null, latest: null };
  if (!accountId) return empty;

  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const mine = `e.account_id = ? AND ${scope.where}`;
  const mineParams = [accountId, ...scope.params];

  const bestRow = db
    .prepare(
      `${accountEntrySelectSql(mine)}
        ORDER BY ${boardOrderBy(mode, 'e')}, e.id ASC
        LIMIT 1`
    )
    .get(...mineParams);
  if (!bestRow) return empty;

  const latestRow = db
    .prepare(
      `${accountEntrySelectSql(mine)}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1`
    )
    .get(...mineParams);

  const better = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT e.account_id, e.score, e.duration_ms, ${waveSql('e')} AS wave,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY ${boardOrderBy(mode, 'e')}, e.id ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE ${scope.where}
       ) WHERE rn = 1 AND (${betterCondition(mode)})`
    )
    .get(
      ...scope.params,
      ...betterParams(mode, {
        wave: publicEntry(bestRow).wave,
        score: bestRow.score,
        durationMs: bestRow.duration_ms,
      })
    );

  return {
    rank: (better?.c || 0) + 1,
    best: personalEntry(bestRow),
    latest: personalEntry(latestRow),
  };
}

// ---------- 赛季结算 ----------

// 名次区间与奖励集中定义：结算、CLI 展示与测试都以这里为准。
export const SEASON_REWARD_TIERS = [
  { from: 1, to: 1, cores: 300 },
  { from: 2, to: 3, cores: 180 },
  { from: 4, to: 10, cores: 100 },
  { from: 11, to: 50, cores: 40 },
];

export const SEASON_REWARD_LIMIT = SEASON_REWARD_TIERS.at(-1).to;

export function seasonRewardForRank(rank) {
  const value = Math.floor(Number(rank));
  if (!Number.isFinite(value) || value < 1) return 0;
  return SEASON_REWARD_TIERS.find((tier) => value >= tier.from && value <= tier.to)?.cores || 0;
}

// 赛季名次：注册账号在赛季区间内所有榜单的最高分（同分比时长，再比记录先后）。
// 无尽榜（含赛季化后的 endless:<season> 与旧版 endless）与变异榜各自独立，
// 不参与赛季排名：前者防止高波次压榜，后者按组合分榜。
function seasonStandings(season) {
  const bounds = seasonBounds(season);
  if (!bounds) return [];
  return db
    .prepare(
      `SELECT account_id, score, duration_ms, created_at, id FROM (
         SELECT e.account_id, e.score, e.duration_ms, e.created_at, e.id,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY e.score DESC, e.duration_ms ASC, e.id ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE a.kind = 'registered'
            AND e.board_key NOT LIKE 'endless%'
            AND e.board_key NOT LIKE 'mutated:%'
            AND e.created_at >= ? AND e.created_at < ?
       ) WHERE rn = 1
       ORDER BY score DESC, duration_ms ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(bounds.start, bounds.end, SEASON_REWARD_LIMIT);
}

function settledRows(season) {
  return db
    .prepare(
      'SELECT account_id, rank, cores, settled_at FROM season_results WHERE season = ? ORDER BY rank ASC'
    )
    .all(season);
}

function settledSummary(season, rows, dryRun) {
  return {
    season,
    dryRun,
    alreadySettled: true,
    settledCount: rows.length,
    totalCores: rows.reduce((sum, row) => sum + (Number(row.cores) || 0), 0),
    rewards: rows.map((row) => ({
      accountId: row.account_id,
      rank: Number(row.rank),
      cores: Number(row.cores),
      settledAt: Number(row.settled_at),
    })),
  };
}

function planRewards(season) {
  return seasonStandings(season).map((row, index) => ({
    accountId: row.account_id,
    rank: index + 1,
    cores: seasonRewardForRank(index + 1),
  }));
}

// 幂等结算：已有结果的赛季直接返回既存结果，绝不重复发放。
// 奖励写入与结果记录在同一事务内，中途失败整体回滚。
export function settleSeason(season, { dryRun = false } = {}) {
  if (!isSeasonKey(season)) throw new Error(`非法赛季：${season}`);

  if (dryRun) {
    const existing = settledRows(season);
    if (existing.length) return settledSummary(season, existing, true);
    const rewards = planRewards(season);
    return {
      season,
      dryRun: true,
      alreadySettled: false,
      settledCount: rewards.length,
      totalCores: rewards.reduce((sum, item) => sum + item.cores, 0),
      rewards,
    };
  }

  return transaction(() => {
    const existing = settledRows(season);
    if (existing.length) return settledSummary(season, existing, false);

    const rewards = planRewards(season);
    const settledAt = Date.now();
    const insertResult = db.prepare(
      `INSERT INTO season_results (account_id, season, rank, cores, settled_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const grantCores = db.prepare(
      `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
       VALUES (?, 'cores', ?, ?)
       ON CONFLICT(account_id, currency_id) DO UPDATE SET
         balance = balance + excluded.balance,
         updated_at = excluded.updated_at`
    );
    for (const item of rewards) {
      insertResult.run(item.accountId, season, item.rank, item.cores, settledAt);
      if (item.cores > 0) grantCores.run(item.accountId, item.cores, settledAt);
      // 通知与审计都是附加动作，失败也不影响结算事务。
      notify(item.accountId, {
        kind: 'season',
        dedupeKey: `season:${season}`,
        payload: { season, rank: item.rank, cores: item.cores },
      }, settledAt);
      recordAudit(item.accountId, AUDIT_ACTIONS.SEASON_SETTLE, {
        season,
        rank: item.rank,
        cores: item.cores,
      }, settledAt);
    }
    return {
      season,
      dryRun: false,
      alreadySettled: false,
      settledCount: rewards.length,
      totalCores: rewards.reduce((sum, item) => sum + item.cores, 0),
      rewards: rewards.map((item) => ({ ...item, settledAt })),
    };
  });
}

// 个人赛季结果：只返回本人，未结算或未上榜返回 null。
export function seasonResultFor(accountId, season) {
  if (!accountId || !isSeasonKey(season)) return null;
  const row = db
    .prepare('SELECT season, rank, cores, settled_at FROM season_results WHERE account_id = ? AND season = ?')
    .get(accountId, season);
  if (!row) return null;
  return {
    season: row.season,
    rank: Number(row.rank),
    cores: Number(row.cores),
    settledAt: Number(row.settled_at),
  };
}
