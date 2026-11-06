// 解锁商店接口：事务内条件扣费 + 幂等授予；塔升星：消耗星核逐级升星（星核长期消耗出口）。
// 解锁不再走 updateProfile({ unlocks }) 的 DELETE-all 全量重写——那会清掉抽卡授予的塔（lost-update 地雷）。
import { purchaseUnlock, getProfile, getCores, spendCoresInTx, transaction } from '../db.mjs';
import { readPlayerKv, writePlayerKv } from '../db/accounts.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import { TOWERS, UNLOCK_BY_ID, unlockedTowerIds } from '../../public/js/shared/data.js';
import {
  TOWER_STAR_MAX,
  normalizeTowerStars,
  towerStarOf,
  towerStarTowerIds,
  towerStarUpCost,
} from '../../public/js/shared/data/unlocks.js';

const TOWER_STAR_NAMESPACE = 'tower_star';
const TOWER_STAR_KEY = 'state';

function readTowerStars(accountId) {
  const row = readPlayerKv(accountId, TOWER_STAR_NAMESPACE, TOWER_STAR_KEY);
  let parsed = null;
  try {
    parsed = JSON.parse(row?.value_json || 'null');
  } catch {
    parsed = null;
  }
  return normalizeTowerStars(parsed);
}

function writeTowerStars(accountId, state) {
  const normalized = normalizeTowerStars(state);
  writePlayerKv(accountId, TOWER_STAR_NAMESPACE, TOWER_STAR_KEY, JSON.stringify(normalized));
  return normalized;
}

export class UnlockRoutes {
  register(router) {
    router.add('POST', '/api/unlock', (ctx) => this.unlock(ctx));
    router.add('GET', '/api/tower-star', (ctx) => this.towerStarList(ctx));
    router.add('POST', '/api/tower-star/upgrade', (ctx) => this.towerStarUpgrade(ctx));
  }

  async unlock(ctx) {
    const token = ctx.token;
    const profile = ctx.profile;
    const body = await ctx.readJson();
    const unlock = UNLOCK_BY_ID[String(body.unlockId || '')];
    if (!unlock) return ctx.fail(404, '未知解锁项');
    if (profile.unlocks.includes(unlock.id)) return ctx.fail(409, '已经解锁');
    if (profile.cores < unlock.cost) return ctx.fail(400, '星核不足');
    const result = purchaseUnlock(token, unlock.id, unlock.cost);
    if (result.status === 'ALREADY_UNLOCKED') return ctx.fail(409, '已经解锁');
    if (result.status === 'INSUFFICIENT_CORES') return ctx.fail(400, '星核不足');
    recordPlayerEvent(token, 'unlock_bought', {
      unlockId: unlock.id,
      cost: unlock.cost,
    });
    return ctx.json(200, { profile: getProfile(token) });
  }

  // 塔升星视图：账号星级 + 可升星塔清单（含当前星级/拥有/升星花费/可否升星）。
  towerStarList(ctx) {
    const profile = ctx.profile;
    const stars = readTowerStars(ctx.token);
    const owned = unlockedTowerIds(profile.unlocks);
    const towers = towerStarTowerIds().map((id) => {
      const star = towerStarOf(stars, id);
      const cost = towerStarUpCost(star);
      return {
        id,
        name: TOWERS[id].name,
        owned: owned.includes(id),
        star,
        maxStar: TOWER_STAR_MAX,
        cost,
        canUpgrade: owned.includes(id) && cost != null && profile.cores >= cost,
      };
    });
    return ctx.json(200, { stars: stars.stars, cores: profile.cores, towers });
  }

  async towerStarUpgrade(ctx) {
    const token = ctx.token;
    const profile = ctx.profile;
    const body = await ctx.readJson();
    const towerId = String(body.towerId || '');
    if (!towerStarTowerIds().includes(towerId)) return ctx.fail(400, '该塔不可升星', 'INVALID_TOWER');
    if (!unlockedTowerIds(profile.unlocks).includes(towerId)) {
      return ctx.fail(403, '尚未拥有该塔', 'TOWER_LOCKED');
    }

    const stars = readTowerStars(token);
    const current = towerStarOf(stars, towerId);
    const cost = towerStarUpCost(current);
    if (cost == null) return ctx.fail(409, '已达最高星级', 'TOWER_STAR_MAXED');

    const result = transaction(() => {
      // 先扣星核：余额不足返回 false 且一行不改，整段回滚，绝不白扣。
      if (!spendCoresInTx(token, cost)) return { ok: false };
      const next = writeTowerStars(token, { stars: { ...stars.stars, [towerId]: current + 1 } });
      return { ok: true, state: next };
    });
    if (!result.ok) return ctx.fail(400, '星核不足', 'INSUFFICIENT_CORES');

    recordPlayerEvent(token, 'tower_star_up', {
      towerId,
      from: current,
      to: current + 1,
      cost,
    });
    return ctx.json(200, {
      stars: result.state.stars,
      cores: getCores(token),
      upgraded: { towerId, from: current, to: current + 1, cost },
    });
  }
}
