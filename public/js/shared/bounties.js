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

// 奖励集中定义：调整数值只改这里，派生、接口与 UI 都以此为准。
export const BOUNTY_REWARDS = {
  daily: 30,
  weekly: 80,
  season: 200,
};

// 目标池：每个周期按周期键确定性抽取 BOUNTIES_PER_PERIOD 个。
// metric 引用 BOUNTY_METRICS，targets 为各周期的完成门槛。
export const BOUNTY_POOL = [
  {
    id: 'veteran',
    title: '身经百战',
    desc: (target) => `在周期内完成 ${target} 局远征`,
    metric: 'runs',
    targets: { daily: 3, weekly: 8, season: 20 },
  },
  {
    id: 'first_win',
    title: '稳住阵线',
    desc: (target) => `在周期内通关 ${target} 局`,
    metric: 'wins',
    targets: { daily: 1, weekly: 2, season: 4 },
  },
  {
    id: 'slayer',
    title: '歼灭者',
    desc: (target) => `单局击杀达到 ${target}`,
    metric: 'maxKills',
    targets: { daily: 120, weekly: 200, season: 300 },
  },
  {
    id: 'wave_rider',
    title: '逐浪者',
    desc: (target) => `单局抵达第 ${target} 波`,
    metric: 'maxWave',
    targets: { daily: 12, weekly: 20, season: 25 },
  },
  {
    id: 'high_score',
    title: '高分纪录',
    desc: (target) => `单局得分达到 ${target}`,
    metric: 'maxScore',
    targets: { daily: 15000, weekly: 25000, season: 40000 },
  },
  {
    id: 'flawless',
    title: '毫发无伤',
    desc: (target) => `无伤通关 ${target} 局`,
    metric: 'flawlessWins',
    targets: { daily: 1, weekly: 1, season: 2 },
  },
  {
    id: 'abyss_win',
    title: '深渊行者',
    desc: (target) => `通关深渊难度 ${target} 局`,
    metric: 'abyssWins',
    targets: { daily: 1, weekly: 2, season: 3 },
  },
  {
    id: 'endurance',
    title: '持久战',
    desc: (target) => `在周期内累计击杀 ${target}`,
    metric: 'totalKills',
    targets: { daily: 300, weekly: 800, season: 2000 },
  },
];

export const BOUNTY_BY_ID = Object.fromEntries(BOUNTY_POOL.map((item) => [item.id, item]));

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
  flawlessWins: (runs) =>
    runs.filter(
      (run) =>
        run.victory &&
        Number(run.baseHpStart) > 0 &&
        Number(run.baseHpLeft) >= Number(run.baseHpStart)
    ).length,
  abyssWins: (runs) =>
    runs.filter((run) => run.victory && run.difficulty === 'abyss').length,
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

// 同一周期键在服务端与客户端派生完全一致的结果。
export function deriveBounties(period, periodKey) {
  if (!isBountyPeriod(period) || !periodKey) return [];
  const rng = new RNG(`bounty:${period}:${periodKey}`);
  return rng
    .shuffle(BOUNTY_POOL)
    .slice(0, BOUNTIES_PER_PERIOD)
    .map((definition) => {
      const target = definition.targets[period];
      return {
        id: definition.id,
        title: definition.title,
        desc: definition.desc(target),
        metric: definition.metric,
        target,
        reward: BOUNTY_REWARDS[period],
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
