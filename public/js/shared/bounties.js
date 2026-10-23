// 悬赏任务：周期派生、目标池与进度计算（服务端判定，客户端只展示）。
// 目标只从既有对局数据（runs 表）派生，不新增任何埋点；周期边界按服务器本地时区。
import { RNG } from './rng.js';
import { dayKey, weekKey } from './scoring.js';

export const BOUNTY_PERIODS = ['daily', 'weekly', 'season'];
export const BOUNTIES_PER_PERIOD = 3;

export const BOUNTY_PERIOD_LABELS = {
  daily: '每日悬赏',
  weekly: '每周悬赏',
  season: '赛季悬赏',
};

// 三档难度：目标值按难度放大；奖励由「周期基础奖励 × 难度系数」集中计算。
export const BOUNTY_TIERS = ['normal', 'challenge', 'extreme'];

export const BOUNTY_TIER_LABELS = {
  normal: '普通',
  challenge: '挑战',
  extreme: '极限',
};

export const BOUNTY_TIER_TARGET_SCALE = {
  normal: 1,
  challenge: 2,
  extreme: 3,
};

export const BOUNTY_TIER_REWARD_SCALE = {
  normal: 1,
  challenge: 1.5,
  extreme: 2.5,
};

// 每个周期的普通难度基础奖励：调整数值只改这里，派生、接口与 UI 都以此为准。
export const BOUNTY_REWARDS = {
  daily: 30,
  weekly: 80,
  season: 200,
};

// 每周一次免费刷新：刷新代数只作用于周悬赏，记录键为 ISO 周键。
export const BOUNTY_REFRESH_LIMIT = 1;
export const BOUNTY_REFRESH_PERIOD = 'weekly';

export function bountyReward(period, tier) {
  const base = Number(BOUNTY_REWARDS[period]);
  const scale = Number(BOUNTY_TIER_REWARD_SCALE[tier]);
  if (!Number.isFinite(base) || !Number.isFinite(scale) || base <= 0 || scale <= 0) return 0;
  return Math.max(1, Math.round(base * scale));
}

// 目标模板：一个模板 × 三档难度 = 三条池子条目（14 × 3 = 42）。
// targets 为普通难度在各周期的门槛，挑战/极限按 BOUNTY_TIER_TARGET_SCALE 放大。
export const BOUNTY_TEMPLATES = [
  {
    key: 'veteran',
    title: '身经百战',
    metric: 'runs',
    targets: { daily: 3, weekly: 8, season: 20 },
    desc: (target) => `在周期内完成 ${target} 局远征`,
  },
  {
    key: 'first_win',
    title: '稳住阵线',
    metric: 'wins',
    targets: { daily: 1, weekly: 2, season: 4 },
    desc: (target) => `在周期内通关 ${target} 局`,
  },
  {
    key: 'slayer',
    title: '歼灭者',
    metric: 'maxKills',
    targets: { daily: 120, weekly: 200, season: 300 },
    desc: (target) => `单局击杀达到 ${target}`,
  },
  {
    key: 'wave_rider',
    title: '逐浪者',
    metric: 'maxWave',
    targets: { daily: 12, weekly: 20, season: 25 },
    desc: (target) => `单局抵达第 ${target} 波`,
  },
  {
    key: 'high_score',
    title: '高分纪录',
    metric: 'maxScore',
    targets: { daily: 15000, weekly: 25000, season: 40000 },
    desc: (target) => `单局得分达到 ${target}`,
  },
  {
    key: 'flawless',
    title: '毫发无伤',
    metric: 'flawlessWins',
    targets: { daily: 1, weekly: 1, season: 2 },
    desc: (target) => `无伤通关 ${target} 局`,
  },
  {
    key: 'abyss_win',
    title: '深渊行者',
    metric: 'abyssWins',
    targets: { daily: 1, weekly: 2, season: 3 },
    desc: (target) => `通关深渊难度 ${target} 局`,
  },
  {
    key: 'endurance',
    title: '持久战',
    metric: 'totalKills',
    targets: { daily: 300, weekly: 800, season: 2000 },
    desc: (target) => `在周期内累计击杀 ${target}`,
  },
  {
    key: 'abyss_run',
    title: '深渊常客',
    metric: 'abyssRuns',
    targets: { daily: 1, weekly: 2, season: 3 },
    desc: (target) => `在深渊难度完成 ${target} 局`,
  },
  {
    key: 'big_score',
    title: '大额进账',
    metric: 'bigScoreRuns',
    targets: { daily: 1, weekly: 2, season: 4 },
    desc: (target) => `单局得分超过 30000 的对局达到 ${target} 局`,
  },
  {
    key: 'deep_run',
    title: '深处足迹',
    metric: 'deepRuns',
    targets: { daily: 1, weekly: 3, season: 5 },
    desc: (target) => `单局抵达第 20 波以上的对局达到 ${target} 局`,
  },
  {
    key: 'total_score',
    title: '积分积累',
    metric: 'totalScore',
    targets: { daily: 20000, weekly: 60000, season: 150000 },
    desc: (target) => `在周期内累计得分 ${target}`,
  },
  {
    key: 'total_wave',
    title: '波次积累',
    metric: 'totalWaves',
    targets: { daily: 20, weekly: 60, season: 150 },
    desc: (target) => `在周期内累计推进 ${target} 波`,
  },
  {
    key: 'standard_win',
    title: '远征常胜',
    metric: 'standardWins',
    targets: { daily: 1, weekly: 3, season: 6 },
    desc: (target) => `通关远征难度 ${target} 局`,
  },
];

function scaledTargets(targets, scale) {
  return Object.fromEntries(
    BOUNTY_PERIODS.map((period) => [period, Math.max(1, Math.ceil(targets[period] * scale))])
  );
}

// 目标池：普通难度沿用旧 id，挑战/极限以「:tier」后缀区分，保证旧领取记录可继续对上。
export const BOUNTY_POOL = BOUNTY_TEMPLATES.flatMap((template) =>
  BOUNTY_TIERS.map((tier) => ({
    id: tier === 'normal' ? template.key : `${template.key}:${tier}`,
    key: template.key,
    tier,
    title: template.title,
    metric: template.metric,
    desc: template.desc,
    targets: scaledTargets(template.targets, BOUNTY_TIER_TARGET_SCALE[tier]),
  }))
);

export const BOUNTY_BY_ID = Object.fromEntries(BOUNTY_POOL.map((item) => [item.id, item]));

const BOUNTY_BY_TIER = Object.fromEntries(
  BOUNTY_TIERS.map((tier) => [tier, BOUNTY_POOL.filter((item) => item.tier === tier)])
);

function toCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 进度指标：入参为周期内的已完成对局（服务端已归一化）。
export const BOUNTY_METRICS = {
  runs: (runs) => runs.length,
  wins: (runs) => runs.filter((run) => run.victory).length,
  maxKills: (runs) => Math.max(0, ...runs.map((run) => toCount(run.kills))),
  maxWave: (runs) => Math.max(0, ...runs.map((run) => toCount(run.waveReached))),
  maxScore: (runs) => Math.max(0, ...runs.map((run) => toCount(run.score))),
  totalKills: (runs) => runs.reduce((sum, run) => sum + toCount(run.kills), 0),
  totalScore: (runs) => runs.reduce((sum, run) => sum + toCount(run.score), 0),
  totalWaves: (runs) => runs.reduce((sum, run) => sum + toCount(run.waveReached), 0),
  flawlessWins: (runs) =>
    runs.filter(
      (run) =>
        run.victory &&
        Number(run.baseHpStart) > 0 &&
        Number(run.baseHpLeft) >= Number(run.baseHpStart)
    ).length,
  abyssWins: (runs) =>
    runs.filter((run) => run.victory && run.difficulty === 'abyss').length,
  abyssRuns: (runs) => runs.filter((run) => run.difficulty === 'abyss').length,
  standardWins: (runs) =>
    runs.filter((run) => run.victory && run.difficulty === 'standard').length,
  bigScoreRuns: (runs) => runs.filter((run) => toCount(run.score) >= 30000).length,
  deepRuns: (runs) => runs.filter((run) => toCount(run.waveReached) >= 20).length,
};

export const isBountyPeriod = (period) => BOUNTY_PERIODS.includes(period);

// 周期键：日 = YYYY-MM-DD，周 = ISO 周键，赛季 = 本地自然月 YYYY-MM。
export function bountyPeriodKey(period, ts = Date.now()) {
  if (!isBountyPeriod(period)) return null;
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return null;
  if (period === 'daily') return dayKey(date);
  if (period === 'weekly') return weekKey(date);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// 周期区间 [start, end)：全部用本地日历构造，跨时区/跨年由 Date 自行处理。
export function bountyPeriodBounds(period, ts = Date.now()) {
  if (!isBountyPeriod(period)) return null;
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = date.getMonth();
  if (period === 'daily') {
    return {
      start: new Date(year, month, date.getDate()).getTime(),
      end: new Date(year, month, date.getDate() + 1).getTime(),
    };
  }
  if (period === 'weekly') {
    const monday = new Date(year, month, date.getDate());
    // getDay(): 周日为 0；换算成以周一为一周开始。
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const end = new Date(monday);
    end.setDate(end.getDate() + 7);
    return { start: monday.getTime(), end: end.getTime() };
  }
  return {
    start: new Date(year, month, 1).getTime(),
    end: new Date(year, month + 1, 1).getTime(),
  };
}

// 同一周期键 + 同一刷新代数在服务端与客户端派生完全一致的结果。
// 每档难度从各自候选集中取一条；刷新代数整体后移一个候选，保证刷新后集合必不同。
export function deriveBounties(period, periodKey, generation = 0) {
  if (!isBountyPeriod(period) || !periodKey) return [];
  const gen = Math.max(0, Math.floor(Number(generation) || 0));
  const rng = new RNG(`bounty:${period}:${periodKey}`);
  return BOUNTY_TIERS.map((tier) => {
    const candidates = BOUNTY_BY_TIER[tier];
    const offset = rng.int(candidates.length);
    const definition = candidates[(offset + gen) % candidates.length];
    const target = definition.targets[period];
    return {
      id: definition.id,
      title: definition.title,
      desc: definition.desc(target),
      metric: definition.metric,
      tier,
      tierLabel: BOUNTY_TIER_LABELS[tier],
      target,
      reward: bountyReward(period, tier),
      period,
      periodKey,
    };
  });
}

export function bountyProgress(bounty, runs) {
  const target = Math.max(0, Math.floor(Number(bounty?.target) || 0));
  const metric = BOUNTY_METRICS[bounty?.metric];
  if (typeof metric !== 'function') return { current: 0, target };
  const raw = Number(metric(Array.isArray(runs) ? runs : []));
  const current = Math.max(0, Math.min(target, Math.floor(Number.isFinite(raw) ? raw : 0)));
  return { current, target };
}
