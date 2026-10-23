// 敌人定义。
export const ENEMIES = {
  grunt: {
    id: 'grunt', name: '游魂', hp: 46, speed: 1.45, armor: 0, gold: 6, dmg: 1,
    r: 0.30, color: '#d1717b', shape: 'blob',
  },
  runner: {
    id: 'runner', name: '疾影', hp: 30, speed: 2.65, armor: 0, gold: 5, dmg: 1,
    r: 0.24, color: '#e3b34d', shape: 'dart',
  },
  swarm: {
    id: 'swarm', name: '噬虫', hp: 17, speed: 2.05, armor: 0, gold: 3, dmg: 1,
    r: 0.17, color: '#a97be0', shape: 'bug',
  },
  tank: {
    id: 'tank', name: '石卫', hp: 230, speed: 0.82, armor: 5, gold: 17, dmg: 2,
    r: 0.42, color: '#8893a8', shape: 'hex',
  },
  flyer: {
    id: 'flyer', name: '翼魔', hp: 44, speed: 1.95, armor: 1, gold: 9, dmg: 1,
    r: 0.27, color: '#5fb6ea', shape: 'wing', flying: true,
  },
  healer: {
    id: 'healer', name: '祭司', hp: 95, speed: 1.05, armor: 2, gold: 13, dmg: 1,
    r: 0.32, color: '#66dbaa', shape: 'priest', heal: 0.035, healRange: 2.6,
  },
  boss: {
    id: 'boss', name: '渊主', hp: 900, speed: 0.72, armor: 5, gold: 100, dmg: 3,
    r: 0.58, color: '#e2609e', shape: 'boss', boss: true,
  },
  shielder: {
    id: 'shielder', name: '石盾', hp: 130, speed: 0.95, armor: 6, gold: 17, dmg: 2,
    r: 0.40, color: '#6f9fc8', shape: 'shield', shield: 60,
    desc: '护盾优先吸收伤害，破盾前本体不掉血。',
  },
  splitter: {
    id: 'splitter', name: '裂魂', hp: 95, speed: 1.3, armor: 1, gold: 11, dmg: 1,
    r: 0.34, color: '#c46bd6', shape: 'split',
    splits: { type: 'splitling', count: 2 },
    desc: '死亡时裂成 2 只裂生虫。',
  },
  splitling: {
    id: 'splitling', name: '裂生虫', hp: 20, speed: 2.3, armor: 0, gold: 2, dmg: 1,
    r: 0.18, color: '#e79ae8', shape: 'bug',
    desc: '裂魂死亡后留下的碎片，速度快但脆弱。',
  },
  herald: {
    id: 'herald', name: '战鼓魔', hp: 100, speed: 1.15, armor: 2, gold: 14, dmg: 1,
    r: 0.33, color: '#e08b3c', shape: 'drum',
    aura: { speed: 0.3, range: 3.0 },
    desc: '光环内的其他敌人移速 +30%。',
  },
  caster: {
    id: 'caster', name: '咒术师', hp: 80, speed: 1.25, armor: 1, gold: 13, dmg: 1,
    r: 0.31, color: '#b5c94a', shape: 'caster',
    ranged: { range: 3.2, interval: 2.4, disable: 1.2, dmg: 2, baseRange: 1.8 },
    desc: '远程轰击防御塔使其短暂停摆，逼近基地时直接轰击基地。',
  },
};

// 首领技能：名称/颜色/预警半径由服务端与渲染层共用。
export const BOSS_SKILLS = {
  roar: { id: 'roar', name: '深渊咆哮', color: '#ff8a6b', radiusKey: 'bossRoarRadius', unlockWave: 5 },
  summon: { id: 'summon', name: '裂隙召唤', color: '#e2609e', unlockWave: 10 },
  slam: { id: 'slam', name: '地脉震击', color: '#ffb066', radiusKey: 'bossSlamRadius', unlockWave: 15 },
};

// 首领变体纯数据：波次只负责挑选，sim 只按 skillWeights 选技能并套用属性修正。
// skillWeights 为整数权重，决定技能轮转序列中的出现次数。
export const BOSS_VARIANTS = {
  armored: {
    id: 'armored',
    name: '磐岩渊主',
    desc: '重甲高血、移速迟缓，地脉震击权重远高于其它技能。',
    shape: 'boss-armored',
    color: '#8fa3bf',
    hpMul: 1.2,
    armorBonus: 6,
    speedMul: 0.88,
    skillWeights: { roar: 1, summon: 1, slam: 4 },
  },
  summoner: {
    id: 'summoner',
    name: '裂隙亲王',
    desc: '本体脆弱，持续撕开裂隙召唤噬虫，裂隙召唤权重最高。',
    shape: 'boss-summoner',
    color: '#d75bd0',
    hpMul: 0.9,
    armorBonus: 0,
    speedMul: 1.0,
    skillWeights: { roar: 1, summon: 4, slam: 1 },
  },
  berserk: {
    id: 'berserk',
    name: '血怒渊主',
    desc: '移速更快、血怒咆哮不断，深渊咆哮权重最高。',
    shape: 'boss-berserk',
    color: '#ff5533',
    hpMul: 0.95,
    armorBonus: 0,
    speedMul: 1.12,
    skillWeights: { roar: 4, summon: 1, slam: 1 },
  },
};

// 普通首领波按此顺序每 5 波轮换；最终波固定为 berserk。
export const BOSS_VARIANT_ROTATION = ['armored', 'summoner', 'berserk'];
