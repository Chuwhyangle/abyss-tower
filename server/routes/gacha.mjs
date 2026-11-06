// 抽卡接口：池视图 / 单事务抽卡 / 抽卡历史（冻结表 docs/PHASE_抽卡.md §5）。
// 路由只做 HTTP 适配：参数校验、调用 db 层事务原语、组装契约字段；SQL 一律留在 db 层。
// 随机源在这里用 node:crypto 播种——抽卡是账号级永久养成，绝不进入 sim.js 的单局确定性流。
import crypto from 'node:crypto';

import { GACHA_PRICE, GACHA_RATES } from '../../public/js/shared/data/gacha.js';
import { unlockedTowerIds } from '../../public/js/shared/data.js';
import { RNG } from '../../public/js/shared/rng.js';
import {
  drawGachaInTx,
  getCores,
  readGachaHistory,
  readGachaHistoryByRequest,
  readGachaPity6,
  readGachaShards,
} from '../db.mjs';

// count 只接受单抽/十连（十连有独立定价与保底），其余一律拒绝，避免出现「抽 7 次按单抽价」的灰区。
const VALID_COUNTS = new Set([1, 10]);
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_REQUEST_ID_LENGTH = 128;

// 历史行（DB snake_case）→ 对外契约（camelCase）；不下发 account_id / request_id。
function toHistoryEntry(row) {
  return {
    towerId: row.tower_id,
    rarity: row.rarity,
    isNew: Boolean(row.is_new),
    shards: row.shards,
    drawnAt: row.drawn_at,
  };
}

// 重放首次结果：同一 request_id 的落库行按插入顺序还原成 results，形状与首次响应一致。
function toReplayResult(row) {
  return {
    towerId: row.tower_id,
    rarity: row.rarity,
    isNew: Boolean(row.is_new),
    shards: row.shards,
  };
}

// 首次抽取的 results（rollGacha 输出）→ 对外契约字段，不下发内部 star。
function toDrawResult(entry) {
  return {
    towerId: entry.towerId,
    rarity: entry.rarity,
    isNew: Boolean(entry.isNew),
    shards: entry.shards,
  };
}

// 校验客户端幂等键：缺省时由服务端生成一次性 id（客户端没带 request_id 时没有跨请求去重语义），
// 带了就必须是合法的短字符串，避免超长键污染历史表。
function normalizeRequestId(raw) {
  if (raw == null || raw === '') return crypto.randomUUID();
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_REQUEST_ID_LENGTH) return null;
  return trimmed;
}

export class GachaRoutes {
  register(router) {
    router.add('GET', '/api/gacha/pool', (ctx) => this.pool(ctx));
    router.add('POST', '/api/gacha/draw', (ctx) => this.draw(ctx));
    router.add('GET', '/api/gacha/history', (ctx) => this.history(ctx));
  }

  // 池视图：价格/概率直接引用 gacha.js 常量（UI 概率公示与这里同源），附带余额、保底、拥有与碎片。
  pool(ctx) {
    const accountId = ctx.token;
    return ctx.json(200, {
      currency: 'cores',
      balance: getCores(accountId),
      price: { ...GACHA_PRICE },
      rates: { ...GACHA_RATES },
      pity6: readGachaPity6(accountId),
      owned: unlockedTowerIds(ctx.profile.unlocks),
      shards: readGachaShards(accountId),
    });
  }

  async draw(ctx) {
    const accountId = ctx.token;
    const body = await ctx.readJson();
    const count = Math.floor(Number(body.count));
    if (!VALID_COUNTS.has(count)) return ctx.fail(400, '抽卡次数无效', 'INVALID_COUNT');

    const requestId = normalizeRequestId(body.request_id);
    if (requestId === null) return ctx.fail(400, 'request_id 无效', 'INVALID_REQUEST_ID');

    // 幂等重放：该 request_id 已落过历史就直接返回首次结果，不二次扣费、不二次抽取。
    // drawGachaInTx 全程同步执行，Node 单线程下「查重 → 扣费 → 落库」之间不会插入其他请求，
    // 因此同一 request_id 的并发重试也只有第一个会真正扣费。
    const replayed = readGachaHistoryByRequest(accountId, requestId);
    if (replayed.length > 0) {
      return ctx.json(200, {
        results: replayed.map(toReplayResult),
        balance: getCores(accountId),
        pity6: readGachaPity6(accountId),
      });
    }

    const result = drawGachaInTx(accountId, {
      count,
      requestId,
      rng: new RNG(crypto.randomBytes(16).toString('hex')),
    });
    if (!result.ok) return ctx.fail(400, '星核不足', 'INSUFFICIENT_CORES');

    return ctx.json(200, {
      results: result.results.map(toDrawResult),
      balance: result.balance,
      pity6: result.pity6,
    });
  }

  // 最近 N 条历史，按时间倒序（db 层按自增 id 倒序，同一毫秒内也保证先后稳定）。
  history(ctx) {
    const requested = ctx.url.searchParams.get('limit');
    const limit = requested == null ? DEFAULT_HISTORY_LIMIT : Math.floor(Number(requested));
    const rows = readGachaHistory(
      ctx.token,
      Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_HISTORY_LIMIT
    );
    return ctx.json(200, { history: rows.map(toHistoryEntry) });
  }
}
