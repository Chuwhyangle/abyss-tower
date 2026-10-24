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
