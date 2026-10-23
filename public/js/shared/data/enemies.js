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
};

// 首领技能：名称/颜色/预警半径由服务端与渲染层共用。
export const BOSS_SKILLS = {
  roar: { id: 'roar', name: '深渊咆哮', color: '#ff8a6b', radiusKey: 'bossRoarRadius', unlockWave: 5 },
  summon: { id: 'summon', name: '裂隙召唤', color: '#e2609e', unlockWave: 10 },
  slam: { id: 'slam', name: '地脉震击', color: '#ffb066', radiusKey: 'bossSlamRadius', unlockWave: 15 },
};
