// 赛季通行证：里程碑集中定义，服务端据此判定与发放，客户端只读取展示。
// 进度来自赛季内已完成对局的积分累计（服务端按 runs.score 求和），因此既有账号进度自动计入。
import { COSMETIC_TITLES } from './achievements.js';

// 里程碑按阈值升序排列；调整数值即可改变节奏，不涉及结算或榜单逻辑。
export const SEASON_PASS_MILESTONES = Object.freeze([
  Object.freeze({
    id: 'season_10k',
    name: '初露锋芒',
    points: 10_000,
    desc: '本赛季累计 10,000 积分解锁',
    reward: Object.freeze({ cores: 20 }),
  }),
  Object.freeze({
    id: 'season_30k',
    name: '碎片补给',
    points: 30_000,
    desc: '本赛季累计 30,000 积分解锁',
    reward: Object.freeze({ shards: 5 }),
  }),
  Object.freeze({
    id: 'season_60k',
    name: '深渊回响',
    points: 60_000,
    desc: '本赛季累计 60,000 积分解锁',
    reward: Object.freeze({ cores: 40 }),
  }),
  Object.freeze({
    id: 'season_100k',
    name: '星核洪流',
    points: 100_000,
    desc: '本赛季累计 100,000 积分解锁',
    reward: Object.freeze({ shards: 10 }),
  }),
  Object.freeze({
    id: 'season_150k',
    name: '赛季传奇',
    points: 150_000,
    desc: '本赛季累计 150,000 积分解锁',
    reward: Object.freeze({ cores: 60, title: 'season_legend' }),
  }),
]);

export const SEASON_PASS_BY_ID = Object.freeze(
  Object.fromEntries(SEASON_PASS_MILESTONES.map((milestone) => [milestone.id, milestone]))
);

export const SEASON_PASS_MAX_POINTS = SEASON_PASS_MILESTONES.at(-1).points;

// 积分来源分类：键、顺序与文案集中定义，服务端聚合与客户端展示共用这一份。
export const SEASON_POINT_SOURCES = Object.freeze({
  MATCH: 'match',
  BOUNTY: 'bounty',
  ACHIEVEMENT: 'achievement',
});

export const SEASON_POINT_SOURCE_ORDER = Object.freeze([
  SEASON_POINT_SOURCES.MATCH,
  SEASON_POINT_SOURCES.BOUNTY,
  SEASON_POINT_SOURCES.ACHIEVEMENT,
]);

export const SEASON_POINT_SOURCE_LABELS = Object.freeze({
  [SEASON_POINT_SOURCES.MATCH]: '对局积分',
  [SEASON_POINT_SOURCES.BOUNTY]: '赛季悬赏',
  [SEASON_POINT_SOURCES.ACHIEVEMENT]: '成就奖励',
});

// 额外积分只由来源决定，不改动里程碑阈值与奖励：调整联动强度只改这两张表。
export const SEASON_BOUNTY_POINT_BONUS = Object.freeze({
  normal: 500,
  challenge: 1_000,
  extreme: 2_000,
});

export const SEASON_ACHIEVEMENT_POINT_BONUS = Object.freeze({
  common: 100,
  rare: 300,
  epic: 800,
});

export function seasonBountyPoints(tier) {
  const points = Number(SEASON_BOUNTY_POINT_BONUS[tier]);
  return Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
}

export function seasonAchievementPoints(rarity) {
  const points = Number(SEASON_ACHIEVEMENT_POINT_BONUS[rarity]);
  return Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
}

// 来源明细：入参可以是条目数组、{来源: 分数} 映射，或旧数据的裸总分。
// 缺失/未知来源一律按对局积分处理（上线前的旧数据只有总分，没有来源记录）；
// 返回值始终包含全部来源（无数据的类别以 0 占位），合计即当前赛季积分。
export function pointsBreakdown(input = []) {
  const buckets = new Map(
    SEASON_POINT_SOURCE_ORDER.map((source) => [source, { points: 0, updatedAt: null }])
  );

  const add = (source, rawPoints, rawUpdatedAt) => {
    const key = SEASON_POINT_SOURCE_ORDER.includes(source)
      ? source
      : SEASON_POINT_SOURCES.MATCH;
    const points = Math.floor(Number(rawPoints));
    if (!Number.isFinite(points) || points <= 0) return;
    const bucket = buckets.get(key);
    bucket.points += points;
    const updatedAt = Number(rawUpdatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) {
      bucket.updatedAt = Math.max(bucket.updatedAt || 0, updatedAt);
    }
  };

  if (typeof input === 'number' || typeof input === 'string') {
    add(SEASON_POINT_SOURCES.MATCH, input, null);
  } else if (Array.isArray(input)) {
    for (const entry of input) {
      if (entry && typeof entry === 'object') {
        add(entry.source, entry.points, entry.updatedAt ?? entry.at);
      } else {
        add(SEASON_POINT_SOURCES.MATCH, entry, null);
      }
    }
  } else if (input && typeof input === 'object') {
    for (const [source, value] of Object.entries(input)) {
      if (value && typeof value === 'object') {
        add(source, value.points, value.updatedAt ?? value.at);
      } else {
        add(source, value, null);
      }
    }
  }

  const sources = SEASON_POINT_SOURCE_ORDER.map((source) => ({
    source,
    label: SEASON_POINT_SOURCE_LABELS[source],
    points: buckets.get(source).points,
    updatedAt: buckets.get(source).updatedAt,
  }));
  return {
    total: sources.reduce((sum, item) => sum + item.points, 0),
    sources,
  };
}

export function seasonPassRewardText(reward = {}) {
  const parts = [];
  if (reward.cores) parts.push(`${reward.cores} 星核`);
  if (reward.shards) parts.push(`${reward.shards} 皮肤碎片`);
  if (reward.title) {
    parts.push(`称号「${COSMETIC_TITLES[reward.title]?.name || reward.title}」`);
  }
  return parts.join(' + ');
}

export function seasonPassMilestone(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SEASON_PASS_BY_ID, id)
    ? SEASON_PASS_BY_ID[id]
    : null;
}

// 已完成的赛季对局积分累计；负分或坏数据按 0 处理。
export function seasonPassPoints(runs = []) {
  let total = 0;
  for (const run of runs) {
    const score = Math.floor(Number(run?.score));
    if (Number.isFinite(score) && score > 0) total += score;
  }
  return total;
}

// 里程碑轨道：进度封顶到各自阈值，领取状态由服务端已领取集合决定。
export function seasonPassProgress(points, claimed = []) {
  const value = Math.max(0, Math.floor(Number(points) || 0));
  const claimedSet = new Set(claimed || []);
  return SEASON_PASS_MILESTONES.map((milestone) => {
    const complete = value >= milestone.points;
    const isClaimed = claimedSet.has(milestone.id);
    return {
      id: milestone.id,
      name: milestone.name,
      desc: milestone.desc,
      target: milestone.points,
      progress: Math.min(value, milestone.points),
      reward: { ...milestone.reward },
      rewardText: seasonPassRewardText(milestone.reward),
      complete,
      claimed: isClaimed,
      claimable: complete && !isClaimed,
    };
  });
}
