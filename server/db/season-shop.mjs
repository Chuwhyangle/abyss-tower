// 赛季商店持久化：用溢出赛季积分重复兑换皮肤碎片（赛季长期消耗出口）。
// 积分派生与已兑换账本复用 season_pass.mjs，这里只做兑换事务，避免把该文件撑爆行数预算。
import { getCores, transaction } from '../db.mjs';
import { seasonBounds, seasonOf } from './leaderboard-sql.mjs';
import { seasonShopAvailable, seasonShopOffer } from '../../public/js/shared/season-pass.js';
import { getSeasonShards, grantShardsInTx } from './shards.mjs';
import { getSeasonSpent, seasonSources, writeSeasonSpentInTx } from './season_pass.mjs';

// 兑换：同事务内校验可用余额 → 累加已兑换 → 发放奖励，余额不足则整段回滚。
export function buySeasonShopOffer(accountId, offerId, now = Date.now()) {
  const offer = seasonShopOffer(offerId);
  if (!offer) return { ok: false, code: 'UNKNOWN_OFFER' };

  const season = seasonOf(now);
  if (!season) return { ok: false, code: 'SEASON_UNAVAILABLE' };

  return transaction(() => {
    const bounds = seasonBounds(season);
    const points = seasonSources(accountId, season, bounds).total;
    const spent = getSeasonSpent(accountId, season);
    const available = seasonShopAvailable(points, spent);
    if (available < offer.costPoints) {
      return {
        ok: false,
        code: 'SEASON_SHOP_INSUFFICIENT',
        season,
        points,
        spent,
        available,
        cost: offer.costPoints,
      };
    }

    writeSeasonSpentInTx(accountId, season, spent + offer.costPoints, now);
    const { shards = 0 } = offer.reward || {};
    if (shards > 0) grantShardsInTx(accountId, shards, now);

    return {
      ok: true,
      offerId,
      season,
      points,
      spent: spent + offer.costPoints,
      available: seasonShopAvailable(points, spent + offer.costPoints),
      awarded: { ...(offer.reward || {}) },
      wallet: { cores: getCores(accountId), shards: getSeasonShards(accountId) },
    };
  });
}
