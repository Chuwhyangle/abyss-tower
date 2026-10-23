// 主动技能（玩家）：每级数值直接列出，服务端/客户端/渲染层共用同一份真源。
// 10 级：效果为 1 级的 2 倍、冷却为 0.5 倍；攻击速度/射程这类乘法因子固定。
// 每级数值直接列出，服务端/客户端/渲染层共用同一份真源。
// 10 级：效果为 1 级的 2 倍、冷却为 0.5 倍；攻击速度/射程这类乘法因子固定。
export const SKILL_LEVEL_COSTS = [10, 15, 20, 30, 45, 65, 90, 120, 220]; // 1→2 … 9→10

export const SKILLS = {
  aurora: {
    id: 'aurora',
    name: '霜月·极光',
    role: 'control',
    color: '#7cd4f5',
    unlock: 'default',
    desc: '极光帘幕扫过战场，冻结并减速全场敌人。',
    bossFactor: 0.4,
    milestones: {
      4: { id: 'frostTrace', name: '霜纹', desc: '解冻碎晶有 25% 概率波及 0.8 格内另一名敌人（50% 伤害）。' },
      7: { id: 'eclipse', name: '月蚀', desc: '释放时场上敌人 ≥12，冻结延长 0.3 秒。' },
      10: { id: 'auroraFinale', name: '极光终章', desc: '冻结期间被击杀的敌人爆成冰晶（1 格内 4% 最大生命 + 20% 减速 2 秒）。' },
    },
    levels: [
      { freeze: 0.7, vuln: 0.08, slow: 0.25, slowDur: 3.5, shatter: 0.04, cd: 55 },
      { freeze: 0.778, vuln: 0.0889, slow: 0.2778, slowDur: 3.5, shatter: 0.0444, cd: 51.94 },
      { freeze: 0.856, vuln: 0.0978, slow: 0.3056, slowDur: 3.5, shatter: 0.0489, cd: 48.89 },
      { freeze: 0.933, vuln: 0.1067, slow: 0.3333, slowDur: 3.5, shatter: 0.0533, cd: 45.83 },
      { freeze: 1.011, vuln: 0.1156, slow: 0.3611, slowDur: 3.5, shatter: 0.0578, cd: 42.78 },
      { freeze: 1.089, vuln: 0.1244, slow: 0.3889, slowDur: 3.5, shatter: 0.0622, cd: 39.72 },
      { freeze: 1.167, vuln: 0.1333, slow: 0.4167, slowDur: 3.5, shatter: 0.0667, cd: 36.67 },
      { freeze: 1.244, vuln: 0.1422, slow: 0.4444, slowDur: 3.5, shatter: 0.0711, cd: 33.61 },
      { freeze: 1.322, vuln: 0.1511, slow: 0.4722, slowDur: 3.5, shatter: 0.0756, cd: 30.56 },
      { freeze: 1.4, vuln: 0.16, slow: 0.5, slowDur: 3.5, shatter: 0.08, cd: 27.5 },
    ],
  },
  meteor: {
    id: 'meteor',
    name: '星陨·天火',
    role: 'burst',
    color: '#ffb066',
    unlock: 'win_roam',
    desc: '锁定最密集的敌群，召唤流星雨。',
    bossFactor: 0.3,
    milestones: {
      4: { id: 'starTrack', name: '星轨', desc: '优先锁定未被灼烧的群落。' },
      7: { id: 'fireflow', name: '流火', desc: '单次命中 ≥10 名敌人时额外落 1 颗陨星。' },
      10: { id: 'meteorFinale', name: '天火终章', desc: '命中已灼烧目标触发余烬连锁（35% 伤害，最多 4 个）。' },
    },
    levels: [
      { meteors: 3, dmgPct: 0.12, burnPct: 0.05, radius: 1.8, cd: 60 },
      { meteors: 3, dmgPct: 0.1333, burnPct: 0.0556, radius: 1.844, cd: 56.67 },
      { meteors: 3, dmgPct: 0.1467, burnPct: 0.0611, radius: 1.889, cd: 53.33 },
      { meteors: 4, dmgPct: 0.16, burnPct: 0.0667, radius: 1.933, cd: 50 },
      { meteors: 4, dmgPct: 0.1733, burnPct: 0.0722, radius: 1.978, cd: 46.67 },
      { meteors: 4, dmgPct: 0.1867, burnPct: 0.0778, radius: 2.022, cd: 43.33 },
      { meteors: 5, dmgPct: 0.2, burnPct: 0.0833, radius: 2.067, cd: 40 },
      { meteors: 5, dmgPct: 0.2133, burnPct: 0.0889, radius: 2.111, cd: 36.67 },
      { meteors: 5, dmgPct: 0.2267, burnPct: 0.0944, radius: 2.156, cd: 33.33 },
      { meteors: 5, dmgPct: 0.24, burnPct: 0.1, radius: 2.2, cd: 30 },
    ],
  },
  chrono: {
    id: 'chrono',
    name: '时之终章·星海回响',
    role: 'ultimate',
    color: '#b48cff',
    unlock: 'win_standard',
    desc: '时间停滞，星海降临，所有防御塔过载。',
    bossFactor: 0.5,
    milestones: {
      4: { id: 'stasis', name: '迟滞', desc: '时停期间防御塔攻速额外 +20%。' },
      7: { id: 'echo', name: '回声', desc: '星痕易伤持续时间 +3 秒。' },
      10: { id: 'finale', name: '终章', desc: '时停期间每击杀 1 名敌人，时停 +0.1 秒（最多 +1 秒）。' },
    },
    levels: [
      { stop: 1.2, overdrive: 3.5, atkSpeed: 0.5, range: 1, novaPct: 0.08, vuln: 0.12, vulnDur: 6, cd: 100 },
      { stop: 1.333, overdrive: 3.889, atkSpeed: 0.5, range: 1, novaPct: 0.0889, vuln: 0.12, vulnDur: 6, cd: 94.44 },
      { stop: 1.467, overdrive: 4.278, atkSpeed: 0.5, range: 1, novaPct: 0.0978, vuln: 0.12, vulnDur: 6, cd: 88.89 },
      { stop: 1.6, overdrive: 4.667, atkSpeed: 0.5, range: 1, novaPct: 0.1067, vuln: 0.12, vulnDur: 6, cd: 83.33 },
      { stop: 1.733, overdrive: 5.056, atkSpeed: 0.5, range: 1, novaPct: 0.1156, vuln: 0.12, vulnDur: 6, cd: 77.78 },
      { stop: 1.867, overdrive: 5.444, atkSpeed: 0.5, range: 1, novaPct: 0.1244, vuln: 0.12, vulnDur: 6, cd: 72.22 },
      { stop: 2, overdrive: 5.833, atkSpeed: 0.5, range: 1, novaPct: 0.1333, vuln: 0.12, vulnDur: 9, cd: 66.67 },
      { stop: 2.133, overdrive: 6.222, atkSpeed: 0.5, range: 1, novaPct: 0.1422, vuln: 0.12, vulnDur: 9, cd: 61.11 },
      { stop: 2.267, overdrive: 6.611, atkSpeed: 0.5, range: 1, novaPct: 0.1511, vuln: 0.12, vulnDur: 9, cd: 55.56 },
      { stop: 2.4, overdrive: 7, atkSpeed: 0.5, range: 1, novaPct: 0.16, vuln: 0.12, vulnDur: 9, cd: 50 },
    ],
  },
};

export const SKILL_ORDER = ['aurora', 'meteor', 'chrono'];

export function skillStats(id, level = 1) {
  const def = SKILLS[id];
  if (!def) return null;
  const lv = Math.max(1, Math.min(def.levels.length, Math.floor(Number(level) || 1)));
  return def.levels[lv - 1];
}

export function skillUpgradeCost(level) {
  const lv = Math.floor(Number(level) || 1);
  if (lv < 1 || lv >= SKILLS.aurora.levels.length) return null;
  return SKILL_LEVEL_COSTS[lv - 1];
}

export function skillUnlockText(id) {
  const def = SKILLS[id];
  if (!def) return '';
  if (def.unlock === 'default') return '初始拥有';
  if (def.unlock === 'win_roam') return '首次通关「漫游」';
  if (def.unlock === 'win_standard') return '首次通关「远征」';
  return '';
}

export function isSkillUnlocked(id, profile) {
  const def = SKILLS[id];
  if (!def) return false;
  if (def.unlock === 'default') return true;
  const wins = profile?.stats?.byDifficulty || {};
  if (def.unlock === 'win_roam') return (wins.roam?.wins || 0) > 0;
  if (def.unlock === 'win_standard') return (wins.standard?.wins || 0) > 0;
  return false;
}
