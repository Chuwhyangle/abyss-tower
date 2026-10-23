// 成就定义与判定规则：服务端据此判定并落库，客户端只读取展示。
// 判定上下文：
//   run       —— 本局结算信息（mode/difficulty/victory/waveReached/kills/score/durationMs/relics）
//   stats     —— 结算后的账号统计（runs/kills/wins/byDifficulty）
//   dailyRuns —— 已完成的每日挑战局数
//   dailyWins —— 已通关的每日挑战局数
//   unlocked  —— 当前已解锁成就 id 集合（用于成就猎人等组合成就）
//   skills    —— 技能养成状态（levels/unlocked/selected，服务端从 player_progress 读取）
//   skillAbyssWins —— 携带主动技能通关深渊的次数
//   noDamageWins    —— 无伤通关次数（服务端从 runs 的结算前后基地生命比对）
//   abyssFlawlessWins —— 其中深渊难度的无伤通关次数
//   season    —— 当前赛季（自然月）统计（key/runs/wins/bestScore/days/rank）
import { DIFFICULTY_ORDER, RELIC_MAX_LEVEL, SKILLS, SKILL_ORDER } from './data.js';

export const ACHIEVEMENT_GROUPS = [
  { id: 'clear', name: '通关' },
  { id: 'build', name: '构筑' },
  { id: 'challenge', name: '挑战' },
  { id: 'collect', name: '收集' },
];

export const ACHIEVEMENT_RARITIES = {
  common: { id: 'common', name: '普通', color: '#9fb0c3' },
  rare: { id: 'rare', name: '稀有', color: '#5bc8ff' },
  epic: { id: 'epic', name: '史诗', color: '#c88bff' },
};

// 成就奖励目录：成就只引用这里的 id，展示文案与配色集中维护。
export const COSMETIC_TITLES = {
  wanderer: { id: 'wanderer', name: '初行者' },
  recruit: { id: 'recruit', name: '塔下新兵' },
  commander: { id: 'commander', name: '全能指挥官' },
  abyss_conqueror: { id: 'abyss_conqueror', name: '深渊征服者' },
  tower_dawn: { id: 'tower_dawn', name: '塔顶守望' },
  gale: { id: 'gale', name: '疾风行者' },
  soul_lord: { id: 'soul_lord', name: '万魂之主' },
  collector: { id: 'collector', name: '遗物收藏家' },
  iron_daily: { id: 'iron_daily', name: '每日铁人' },
  achievement_master: { id: 'achievement_master', name: '成就宗师' },
  season_legend: { id: 'season_legend', name: '赛季传奇' },
};

export const COSMETIC_FRAMES = {
  bronze: { id: 'bronze', name: '青铜边框', color: '#b87333' },
  abyss: { id: 'abyss', name: '深渊边框', color: '#8b5cf6' },
  gold: { id: 'gold', name: '鎏金边框', color: '#f5c451' },
  storm: { id: 'storm', name: '风暴边框', color: '#5bc8ff' },
  emerald: { id: 'emerald', name: '翡翠边框', color: '#34d399' },
  ember: { id: 'ember', name: '余烬边框', color: '#ff7a45' },
  prism: { id: 'prism', name: '棱彩边框', color: '#c88bff' },
};

const totalRuns = (ctx) => Number(ctx.stats?.runs) || 0;
const totalWins = (ctx) => Number(ctx.stats?.wins) || 0;
const totalKills = (ctx) => Number(ctx.stats?.kills) || 0;
const totalDailyRuns = (ctx) => Number(ctx.dailyRuns) || 0;
const totalDailyWins = (ctx) => Number(ctx.dailyWins) || 0;
const unlockedCount = (ctx) => ctx.unlocked?.size || 0;

function bestWave(ctx) {
  return Math.max(
    0,
    ...DIFFICULTY_ORDER.map((id) => Number(ctx.stats?.byDifficulty?.[id]?.bestWave) || 0)
  );
}

function bestScore(ctx) {
  return Math.max(
    0,
    ...DIFFICULTY_ORDER.map((id) => Number(ctx.stats?.byDifficulty?.[id]?.bestScore) || 0)
  );
}

function difficultyWins(ctx, id) {
  return Number(ctx.stats?.byDifficulty?.[id]?.wins) || 0;
}

function difficultyBestScore(ctx, id) {
  return Number(ctx.stats?.byDifficulty?.[id]?.bestScore) || 0;
}

function difficultyWinsCount(ctx) {
  return DIFFICULTY_ORDER.filter((id) => difficultyWins(ctx, id) >= 1).length;
}

function relicLevels(ctx) {
  return (ctx.run?.relics || []).map((relic) => Number(relic?.level) || 0);
}

const maxRelicLevel = (ctx) => Math.max(0, ...relicLevels(ctx));
const maxRelicCount = (ctx) =>
  relicLevels(ctx).filter((level) => level >= RELIC_MAX_LEVEL).length;
const relicCount = (ctx) => (ctx.run?.relics || []).length;

const MAX_SKILL_LEVEL = SKILLS.aurora.levels.length;
const maxSkillLevel = (ctx) =>
  Math.max(0, ...SKILL_ORDER.map((id) => Number(ctx.skills?.levels?.[id]) || 0));
const unlockedSkillCount = (ctx) =>
  SKILL_ORDER.filter((id) => !!ctx.skills?.unlocked?.[id]).length;
const maxedSkillCount = (ctx) =>
  SKILL_ORDER.filter((id) => (Number(ctx.skills?.levels?.[id]) || 0) >= MAX_SKILL_LEVEL).length;
const totalSkillLevels = (ctx) =>
  SKILL_ORDER.reduce((sum, id) => sum + (Number(ctx.skills?.levels?.[id]) || 0), 0);
const skillAbyssWinCount = (ctx) => Number(ctx.skillAbyssWins) || 0;

const seasonValue = (ctx, key) => Number(ctx.season?.[key]) || 0;
const seasonRuns = (ctx) => seasonValue(ctx, 'runs');
const seasonWins = (ctx) => seasonValue(ctx, 'wins');
const seasonBestScore = (ctx) => seasonValue(ctx, 'bestScore');
const seasonDays = (ctx) => seasonValue(ctx, 'days');

const noDamageWins = (ctx) => Number(ctx.noDamageWins) || 0;
const abyssNoDamageWins = (ctx) => Number(ctx.abyssFlawlessWins) || 0;

// 带 target/progress 的成就自动由进度判定；其余成就自行提供 check。
// reward 引用 COSMETIC_TITLES / COSMETIC_FRAMES 中的 id，解锁成就即解锁对应外观。
function define({
  id,
  title,
  desc,
  condition,
  group,
  rarity,
  hidden = false,
  target,
  progress,
  check,
  reward,
}) {
  const item = { id, title, desc, condition, group, rarity, hidden };
  if (reward) item.reward = reward;
  if (Number.isInteger(target) && target > 0 && typeof progress === 'function') {
    item.target = target;
    item.progress = progress;
    item.check = (ctx) => Number(progress(ctx)) >= target;
  } else {
    item.check = check;
  }
  return item;
}

export const ACHIEVEMENTS = [
  // ── 通关 ──────────────────────────────────────────────────────────
  define({
    id: 'first_run',
    title: '首次远征',
    desc: '完成任意一局远征。',
    condition: '累计完成 1 局远征',
    group: 'clear',
    rarity: 'common',
    reward: { title: 'wanderer' },
    target: 1,
    progress: totalRuns,
  }),
  define({
    id: 'first_win',
    title: '首胜',
    desc: '首次守住第 30 波。',
    condition: '累计通关 1 次',
    group: 'clear',
    rarity: 'common',
    reward: { title: 'recruit', frame: 'bronze' },
    target: 1,
    progress: totalWins,
  }),
  define({
    id: 'win_roam',
    title: '漫游者',
    desc: '在「漫游」难度完成通关。',
    condition: '漫游难度通关 1 次',
    group: 'clear',
    rarity: 'common',
    target: 1,
    progress: (ctx) => difficultyWins(ctx, 'roam'),
  }),
  define({
    id: 'win_standard',
    title: '远征者',
    desc: '在「远征」难度完成通关。',
    condition: '远征难度通关 1 次',
    group: 'clear',
    rarity: 'rare',
    target: 1,
    progress: (ctx) => difficultyWins(ctx, 'standard'),
  }),
  define({
    id: 'win_abyss',
    title: '深渊征服',
    desc: '在「深渊」难度完成通关。',
    condition: '深渊难度通关 1 次',
    group: 'clear',
    rarity: 'epic',
    reward: { title: 'abyss_conqueror', frame: 'abyss' },
    target: 1,
    progress: (ctx) => difficultyWins(ctx, 'abyss'),
  }),
  define({
    id: 'all_difficulties',
    title: '全能指挥官',
    desc: '三档难度全部完成通关。',
    condition: '漫游、远征、深渊各通关 1 次',
    group: 'clear',
    rarity: 'epic',
    reward: { title: 'commander', frame: 'gold' },
    target: DIFFICULTY_ORDER.length,
    progress: difficultyWinsCount,
  }),
  define({
    id: 'boss_slayer',
    title: '深渊领主',
    desc: '击败最终波的首领。',
    condition: '完成任意难度通关',
    group: 'clear',
    rarity: 'rare',
    check: (ctx) => !!ctx.run?.victory,
  }),
  define({
    id: 'wave_5',
    title: '初入塔中',
    desc: '单局抵达第 5 波。',
    condition: '任意难度最高抵达第 5 波',
    group: 'clear',
    rarity: 'common',
    target: 5,
    progress: bestWave,
  }),
  define({
    id: 'wave_10',
    title: '十层回响',
    desc: '单局抵达第 10 波。',
    condition: '任意难度最高抵达第 10 波',
    group: 'clear',
    rarity: 'common',
    target: 10,
    progress: bestWave,
  }),
  define({
    id: 'wave_20',
    title: '二十层的风',
    desc: '单局抵达第 20 波。',
    condition: '任意难度最高抵达第 20 波',
    group: 'clear',
    rarity: 'rare',
    target: 20,
    progress: bestWave,
  }),
  define({
    id: 'wave_30',
    title: '塔顶的黎明',
    desc: '单局抵达第 30 波。',
    condition: '任意难度最高抵达第 30 波',
    group: 'clear',
    rarity: 'epic',
    reward: { title: 'tower_dawn' },
    target: 30,
    progress: bestWave,
  }),
  define({
    id: 'speedrun',
    title: '疾风远征',
    desc: '在 15 分钟内完成一次通关。',
    condition: '通关用时不超过 15 分钟',
    group: 'clear',
    rarity: 'rare',
    reward: { title: 'gale', frame: 'storm' },
    check: (ctx) =>
      !!ctx.run?.victory && (Number(ctx.run?.durationMs) || 0) <= 15 * 60 * 1000,
  }),
  define({
    id: 'flawless_win',
    title: '滴水不漏',
    desc: '在基地生命毫发无损的情况下完成一次通关。',
    condition: '无伤通关任意难度 1 次',
    group: 'clear',
    rarity: 'rare',
    target: 1,
    progress: noDamageWins,
  }),
  define({
    id: 'flawless_win_3',
    title: '完美守备',
    desc: '累计无伤通关 3 次。',
    condition: '无伤通关任意难度 3 次',
    group: 'clear',
    rarity: 'epic',
    reward: { frame: 'emerald' },
    target: 3,
    progress: noDamageWins,
  }),
  define({
    id: 'abyss_speedrun',
    title: '深渊疾行',
    desc: '在 20 分钟内通关深渊难度。',
    condition: '深渊难度通关用时不超过 20 分钟',
    group: 'clear',
    rarity: 'epic',
    check: (ctx) =>
      !!ctx.run?.victory &&
      ctx.run?.difficulty === 'abyss' &&
      (Number(ctx.run?.durationMs) || 0) <= 20 * 60 * 1000,
  }),
  define({
    id: 'hidden_abyss_flawless',
    title: '无瑕深渊',
    desc: '在深渊难度完成一次无伤通关。',
    condition: '深渊难度无伤通关 1 次',
    group: 'clear',
    rarity: 'epic',
    hidden: true,
    check: (ctx) => abyssNoDamageWins(ctx) >= 1,
  }),

  // ── 构筑 ──────────────────────────────────────────────────────────
  define({
    id: 'relic_level_2',
    title: '遗物初鸣',
    desc: '把一件遗物强化到 2 级。',
    condition: '单局内任意遗物达到 2 级',
    group: 'build',
    rarity: 'common',
    target: 2,
    progress: maxRelicLevel,
  }),
  define({
    id: 'relic_max',
    title: '遗物满级',
    desc: '把一件遗物强化到满级。',
    condition: `单局内任意遗物达到 ${RELIC_MAX_LEVEL} 级`,
    group: 'build',
    rarity: 'rare',
    target: RELIC_MAX_LEVEL,
    progress: maxRelicLevel,
  }),
  define({
    id: 'relic_max_3',
    title: '三件满级',
    desc: '单局内把三件遗物强化到满级。',
    condition: `单局内 3 件遗物达到 ${RELIC_MAX_LEVEL} 级`,
    group: 'build',
    rarity: 'epic',
    target: 3,
    progress: maxRelicCount,
  }),
  define({
    id: 'relic_collector',
    title: '遗物收藏家',
    desc: '单局内集齐 5 件遗物。',
    condition: '单局持有 5 件遗物',
    group: 'build',
    rarity: 'common',
    reward: { title: 'collector' },
    target: 5,
    progress: relicCount,
  }),
  define({
    id: 'hidden_no_relic_win',
    title: '赤手空拳',
    desc: '不依赖任何遗物完成一次通关。',
    condition: '单局不持有遗物并完成通关',
    group: 'build',
    rarity: 'rare',
    hidden: true,
    check: (ctx) => !!ctx.run?.victory && relicCount(ctx) === 0,
  }),

  // ── 挑战 ──────────────────────────────────────────────────────────
  define({
    id: 'kills_100',
    title: '百人斩',
    desc: '累计击杀 100 个敌人。',
    condition: '累计击杀 100',
    group: 'challenge',
    rarity: 'common',
    target: 100,
    progress: totalKills,
  }),
  define({
    id: 'kills_250',
    title: '战场收割',
    desc: '累计击杀 250 个敌人。',
    condition: '累计击杀 250',
    group: 'challenge',
    rarity: 'common',
    target: 250,
    progress: totalKills,
  }),
  define({
    id: 'kills_1000',
    title: '千人斩',
    desc: '累计击杀 1000 个敌人。',
    condition: '累计击杀 1000',
    group: 'challenge',
    rarity: 'rare',
    target: 1000,
    progress: totalKills,
  }),
  define({
    id: 'kills_5000',
    title: '深渊屠夫',
    desc: '累计击杀 5000 个敌人。',
    condition: '累计击杀 5000',
    group: 'challenge',
    rarity: 'epic',
    target: 5000,
    progress: totalKills,
  }),
  define({
    id: 'kills_10000',
    title: '万魂之主',
    desc: '累计击杀 10000 个敌人。',
    condition: '累计击杀 10000',
    group: 'challenge',
    rarity: 'epic',
    reward: { title: 'soul_lord', frame: 'ember' },
    target: 10000,
    progress: totalKills,
  }),
  define({
    id: 'runs_10',
    title: '老练指挥官',
    desc: '累计完成 10 局远征。',
    condition: '累计完成 10 局',
    group: 'challenge',
    rarity: 'common',
    target: 10,
    progress: totalRuns,
  }),
  define({
    id: 'runs_25',
    title: '百战之身',
    desc: '累计完成 25 局远征。',
    condition: '累计完成 25 局',
    group: 'challenge',
    rarity: 'rare',
    target: 25,
    progress: totalRuns,
  }),
  define({
    id: 'runs_50',
    title: '远征老兵',
    desc: '累计完成 50 局远征。',
    condition: '累计完成 50 局',
    group: 'challenge',
    rarity: 'epic',
    target: 50,
    progress: totalRuns,
  }),
  define({
    id: 'runs_100',
    title: '塔下常客',
    desc: '累计完成 100 局远征。',
    condition: '累计完成 100 局',
    group: 'challenge',
    rarity: 'epic',
    target: 100,
    progress: totalRuns,
  }),
  define({
    id: 'wins_5',
    title: '五度凯旋',
    desc: '累计通关 5 次。',
    condition: '累计通关 5 次',
    group: 'challenge',
    rarity: 'common',
    target: 5,
    progress: totalWins,
  }),
  define({
    id: 'wins_10',
    title: '十战十胜',
    desc: '累计通关 10 次。',
    condition: '累计通关 10 次',
    group: 'challenge',
    rarity: 'rare',
    target: 10,
    progress: totalWins,
  }),
  define({
    id: 'wins_20',
    title: '常胜将军',
    desc: '累计通关 20 次。',
    condition: '累计通关 20 次',
    group: 'challenge',
    rarity: 'epic',
    target: 20,
    progress: totalWins,
  }),
  define({
    id: 'wins_50',
    title: '深渊之王',
    desc: '累计通关 50 次。',
    condition: '累计通关 50 次',
    group: 'challenge',
    rarity: 'epic',
    target: 50,
    progress: totalWins,
  }),
  define({
    id: 'score_2000',
    title: '崭露头角',
    desc: '单局得分达到 2000。',
    condition: '任意难度最高得分 2000',
    group: 'challenge',
    rarity: 'common',
    target: 2000,
    progress: bestScore,
  }),
  define({
    id: 'score_5000',
    title: '高分纪录',
    desc: '单局得分达到 5000。',
    condition: '任意难度最高得分 5000',
    group: 'challenge',
    rarity: 'rare',
    target: 5000,
    progress: bestScore,
  }),
  define({
    id: 'score_10000',
    title: '万分传奇',
    desc: '单局得分达到 10000。',
    condition: '任意难度最高得分 10000',
    group: 'challenge',
    rarity: 'epic',
    target: 10000,
    progress: bestScore,
  }),
  define({
    id: 'score_20000',
    title: '二十万分之上',
    desc: '单局得分达到 20000。',
    condition: '任意难度最高得分 20000',
    group: 'challenge',
    rarity: 'epic',
    target: 20000,
    progress: bestScore,
  }),
  define({
    id: 'hidden_perfect_run',
    title: '完美履历',
    desc: '累计完成至少 5 局且从未失败。',
    condition: '完成 ≥5 局且全部通关',
    group: 'challenge',
    rarity: 'epic',
    hidden: true,
    check: (ctx) => totalRuns(ctx) >= 5 && totalWins(ctx) === totalRuns(ctx),
  }),
  define({
    id: 'abyss_score_12000',
    title: '深渊高分',
    desc: '单局深渊难度得分达到 12000。',
    condition: '深渊难度最高得分 12000',
    group: 'challenge',
    rarity: 'epic',
    target: 12000,
    progress: (ctx) => difficultyBestScore(ctx, 'abyss'),
  }),

  // ── 赛季（自然月） ────────────────────────────────────────────────
  define({
    id: 'season_runs_10',
    title: '赛季常客',
    desc: '在单个赛季内完成 10 局远征。',
    condition: '单赛季完成 10 局',
    group: 'challenge',
    rarity: 'common',
    target: 10,
    progress: seasonRuns,
  }),
  define({
    id: 'season_wins_5',
    title: '赛季凯旋',
    desc: '在单个赛季内通关 5 次。',
    condition: '单赛季通关 5 次',
    group: 'challenge',
    rarity: 'rare',
    target: 5,
    progress: seasonWins,
  }),
  define({
    id: 'season_score_5000',
    title: '赛季高分',
    desc: '在单个赛季内单局得分达到 5000。',
    condition: '单赛季最高得分 5000',
    group: 'challenge',
    rarity: 'rare',
    target: 5000,
    progress: seasonBestScore,
  }),
  define({
    id: 'season_score_12000',
    title: '赛季传奇',
    desc: '在单个赛季内单局得分达到 12000。',
    condition: '单赛季最高得分 12000',
    group: 'challenge',
    rarity: 'epic',
    reward: { title: 'season_legend' },
    target: 12000,
    progress: seasonBestScore,
  }),
  define({
    id: 'season_days_7',
    title: '赛季常驻',
    desc: '在单个赛季的 7 个不同日期完成对局。',
    condition: '单赛季活跃 7 天',
    group: 'challenge',
    rarity: 'rare',
    target: 7,
    progress: seasonDays,
  }),
  define({
    id: 'season_top_10',
    title: '赛季前十',
    desc: '在单个赛季的任意榜单进入前 10 名。',
    condition: '单赛季任意榜单排名前 10',
    group: 'collect',
    rarity: 'epic',
    check: (ctx) => {
      const rank = Number(ctx.season?.rank);
      return Number.isInteger(rank) && rank >= 1 && rank <= 10;
    },
  }),

  // ── 收集 ──────────────────────────────────────────────────────────
  define({
    id: 'daily_first',
    title: '每日首战',
    desc: '完成一次每日挑战。',
    condition: '完成 1 次每日挑战',
    group: 'collect',
    rarity: 'common',
    target: 1,
    progress: totalDailyRuns,
  }),
  define({
    id: 'daily_win',
    title: '每日征服',
    desc: '在每日挑战中完成通关。',
    condition: '每日挑战通关 1 次',
    group: 'collect',
    rarity: 'rare',
    target: 1,
    progress: totalDailyWins,
  }),
  define({
    id: 'daily_5',
    title: '每日常客',
    desc: '累计完成 5 次每日挑战。',
    condition: '完成 5 次每日挑战',
    group: 'collect',
    rarity: 'rare',
    target: 5,
    progress: totalDailyRuns,
  }),
  define({
    id: 'daily_10',
    title: '每日铁人',
    desc: '累计完成 10 次每日挑战。',
    condition: '完成 10 次每日挑战',
    group: 'collect',
    rarity: 'epic',
    reward: { title: 'iron_daily' },
    target: 10,
    progress: totalDailyRuns,
  }),
  define({
    id: 'achievement_10',
    title: '成就猎人',
    desc: '解锁 10 个成就。',
    condition: '解锁 10 个成就',
    group: 'collect',
    rarity: 'rare',
    target: 10,
    progress: unlockedCount,
  }),
  define({
    id: 'achievement_20',
    title: '成就大师',
    desc: '解锁 20 个成就。',
    condition: '解锁 20 个成就',
    group: 'collect',
    rarity: 'epic',
    target: 20,
    progress: unlockedCount,
  }),
  define({
    id: 'achievement_30',
    title: '成就宗师',
    desc: '解锁 30 个成就。',
    condition: '解锁 30 个成就',
    group: 'collect',
    rarity: 'epic',
    reward: { title: 'achievement_master', frame: 'prism' },
    target: 30,
    progress: unlockedCount,
  }),

  // ── 技能（归入「构筑」分组：遗物与主动技能同属养成构筑） ──────────
  define({
    id: 'skill_select',
    title: '技能初装',
    desc: '首次装备一个主动技能。',
    condition: '选择任意主动技能',
    group: 'build',
    rarity: 'common',
    check: (ctx) => !!ctx.skills?.selected,
  }),
  define({
    id: 'skill_unlock_meteor',
    title: '星陨归来',
    desc: '解锁主动技能「星陨·天火」。',
    condition: '解锁星陨',
    group: 'build',
    rarity: 'rare',
    check: (ctx) => !!ctx.skills?.unlocked?.meteor,
  }),
  define({
    id: 'skill_unlock_chrono',
    title: '时间的主人',
    desc: '解锁主动技能「时之终章·星海回响」。',
    condition: '解锁终章',
    group: 'build',
    rarity: 'rare',
    check: (ctx) => !!ctx.skills?.unlocked?.chrono,
  }),
  define({
    id: 'skill_all_unlocked',
    title: '三式齐备',
    desc: '解锁全部主动技能。',
    condition: `解锁全部 ${SKILL_ORDER.length} 个主动技能`,
    group: 'build',
    rarity: 'epic',
    target: SKILL_ORDER.length,
    progress: unlockedSkillCount,
  }),
  define({
    id: 'skill_level_3',
    title: '融会贯通',
    desc: '把任意主动技能提升到 3 级。',
    condition: '任意技能达到 3 级',
    group: 'build',
    rarity: 'common',
    target: 3,
    progress: maxSkillLevel,
  }),
  define({
    id: 'skill_level_5',
    title: '渐入佳境',
    desc: '把任意主动技能提升到 5 级。',
    condition: '任意技能达到 5 级',
    group: 'build',
    rarity: 'common',
    target: 5,
    progress: maxSkillLevel,
  }),
  define({
    id: 'skill_max',
    title: '极尽升华',
    desc: '把任意主动技能提升到满级。',
    condition: `任意技能达到 ${MAX_SKILL_LEVEL} 级`,
    group: 'build',
    rarity: 'epic',
    target: MAX_SKILL_LEVEL,
    progress: maxSkillLevel,
  }),
  define({
    id: 'skill_abyss_win',
    title: '深渊演武',
    desc: '携带主动技能通关深渊。',
    condition: '带技能通关深渊 1 次',
    group: 'build',
    rarity: 'epic',
    target: 1,
    progress: skillAbyssWinCount,
  }),
  define({
    id: 'skill_abyss_win_5',
    title: '深渊演武·五',
    desc: '携带主动技能通关深渊 5 次。',
    condition: '带技能通关深渊 5 次',
    group: 'build',
    rarity: 'rare',
    target: 5,
    progress: skillAbyssWinCount,
  }),
  define({
    id: 'skill_levels_20',
    title: '养成有方',
    desc: '主动技能等级总和达到 20 级。',
    condition: '技能等级总和 20',
    group: 'build',
    rarity: 'rare',
    target: 20,
    progress: totalSkillLevels,
  }),
  define({
    id: 'skill_all_max',
    title: '万法归一',
    desc: '把全部主动技能提升到满级。',
    condition: `全部 ${SKILL_ORDER.length} 个技能达到 ${MAX_SKILL_LEVEL} 级`,
    group: 'build',
    rarity: 'epic',
    target: SKILL_ORDER.length,
    progress: maxedSkillCount,
  }),
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(
  ACHIEVEMENTS.map((item) => [item.id, item])
);

// 返回 { current, target }；非进度型成就返回 null。current 不超过 target，便于直接画进度条。
export function achievementProgress(achievement, ctx) {
  if (!achievement || !achievement.target || typeof achievement.progress !== 'function') {
    return null;
  }
  const raw = Number(achievement.progress(ctx));
  const current = Math.max(
    0,
    Math.min(achievement.target, Math.floor(Number.isFinite(raw) ? raw : 0))
  );
  return { current, target: achievement.target };
}

// 反复扫描直到不再有新成就，保证「解锁 10 个成就」这类组合成就能在同一次结算内成立。
export function evaluateAchievements(ctx) {
  const unlocked = new Set(ctx.unlocked || []);
  const added = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const achievement of ACHIEVEMENTS) {
      if (unlocked.has(achievement.id)) continue;
      if (achievement.check({ ...ctx, unlocked })) {
        unlocked.add(achievement.id);
        added.push(achievement.id);
        changed = true;
      }
    }
  }
  return added;
}
