// 主动技能 sim 契约：冷却/阶段、三个技能效果与里程碑、快照兼容、确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { SKILLS, skillStats } from '../public/js/shared/data.js';
import { normalizeSnapshot } from '../public/js/shared/save.js';

const EPS = 1e-6;
const near = (actual, expected, message, eps = EPS) =>
  assert.ok(
    Math.abs(actual - expected) < eps,
    `${message || ''} 期望 ${expected}，实际 ${actual}`
  );

function makeSim({ skill = null, skillReadyAt, ...opts } = {}) {
  return new Simulation({
    map: generateMap('skill-test-seed'),
    seed: 'skill-test-seed',
    difficulty: 'standard',
    gold: 1000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    skill,
    skillReadyAt,
    onToast: () => {},
    ...opts,
  });
}

function enterWave(sim, wave = 1) {
  sim.phase = 'wave';
  sim.wave = wave;
  sim.waveTime = 0;
  return sim;
}

// 默认静止（baseSpeed=0），避免测试中位置漂移；需要移动的用例显式覆盖。
function spawn(sim, overrides = {}) {
  const progress = overrides.progress ?? 0;
  sim.spawnEnemy('grunt', 0, null, progress);
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(
    enemy,
    {
      hp: 100000,
      maxHp: 100000,
      armor: 0,
      baseSpeed: 0,
      slowUntil: 0,
      slowAmt: 0,
      poisonUntil: 0,
      poisonDps: 0,
    },
    overrides
  );
  if (overrides.x != null) enemy.x = overrides.x;
  if (overrides.y != null) enemy.y = overrides.y;
  return enemy;
}

function spawnBoss(sim, overrides = {}) {
  const enemy = spawn(sim, { ...overrides });
  enemy.type = 'boss';
  enemy.boss = true;
  enemy.hp = overrides.hp ?? 100000;
  enemy.maxHp = overrides.maxHp ?? 100000;
  return enemy;
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 1, 1, level, 0);
  sim.towers.push(tower);
  sim.refreshTowerStats(tower);
  return tower;
}

function advance(sim, seconds, step = 1 / 60) {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(step, remaining);
    sim.update(dt);
    remaining -= dt;
  }
}

// ---------- 基础契约 ----------

test('无技能：sim.skill 为 null，castSkill 返回 false', () => {
  const sim = makeSim();
  enterWave(sim);
  assert.equal(sim.skill, null);
  assert.equal(sim.castSkill(), false);
});

test('冷却：只有 wave 阶段可释放；暂停/整备不成功；冷却只在 update 递减', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 1 } });
  assert.equal(sim.skill.cooldown, 0, '开局冷却为 0');
  assert.equal(sim.castSkill(), false, '整备阶段不可释放');

  enterWave(sim);
  sim.paused = true;
  assert.equal(sim.castSkill(), false, '暂停时不可释放');
  sim.paused = false;
  assert.equal(sim.castSkill(), true, '战斗阶段可释放');
  const cd1 = skillStats('aurora', 1).cd;
  near(sim.skill.cooldown, cd1, '冷却写入 1 级冷却');
  assert.equal(sim.castSkill(), false, '冷却中不可重复释放');

  sim.updateVisuals(5);
  near(sim.skill.cooldown, cd1, '表现更新不扣冷却');

  sim.paused = true;
  sim.update(5);
  near(sim.skill.cooldown, cd1, '暂停时 update 不走表');
  sim.paused = false;

  sim.phase = 'prep';
  sim.update(5);
  near(sim.skill.cooldown, cd1, '整备阶段 update 不走表');

  enterWave(sim);
  sim.update(0.5);
  near(sim.skill.cooldown, cd1 - 0.5, '战斗 update 扣冷却');
});

test('castSkill 通过 onSkillCast 立刻给出含冷却的快照', () => {
  let captured = null;
  const sim = makeSim({
    skill: { id: 'meteor', level: 3 },
    onSkillCast: (snapshot) => { captured = snapshot; },
  });
  enterWave(sim);
  assert.equal(sim.castSkill(), true);
  assert.ok(captured, 'onSkillCast 应被调用');
  // 无连锁的技能局仍写 v4；v5 只在存在事件连锁时启用。
  assert.equal(captured.version, 4);
  assert.deepEqual(captured.skill, {
    id: 'meteor',
    level: 3,
    cooldown: SKILLS.meteor.levels[2].cd,
  });
  assert.ok(
    captured.skillReadyAt >= Date.now() - 1000 &&
      captured.skillReadyAt <= Date.now() + SKILLS.meteor.levels[2].cd * 1000,
    '回调快照附带 skillReadyAt（epoch）'
  );
});

// ---------- 霜月·极光 ----------

test('极光：冻结、冻结易伤、解冻减速与碎晶', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 1 } });
  enterWave(sim);
  const enemy = spawn(sim, { progress: 5, hp: 100000, maxHp: 100000 });
  const start = 10;
  sim.time = start;
  sim.waveTime = start;
  assert.equal(sim.castSkill(), true);

  const st1 = skillStats('aurora', 1);
  near(enemy.freezeUntil, start + st1.freeze, '1 级冻结时长');
  near(enemy.freezeVuln, st1.vuln, '冻结易伤');

  // 冻结期间不移动，但受到易伤加成后的伤害。
  const beforeProgress = enemy.progress;
  const hpBefore = enemy.hp;
  sim.damage(enemy, 100);
  near(hpBefore - enemy.hp, 100 * (1 + st1.vuln), '冻结易伤作用于塔伤害');
  advance(sim, 0.5);
  near(enemy.progress, beforeProgress, '冻结期间不移动');

  // 解冻：碎晶 6% 最大生命 + 减速 35% 持续 4s。
  const hpAtThaw = enemy.hp;
  advance(sim, 0.5);
  assert.equal(enemy.freezeUntil, 0, '已解冻');
  near(hpAtThaw - enemy.hp, 100000 * st1.shatter, '碎晶伤害');
  near(enemy.slowAmt, st1.slow, '解冻后减速');
  assert.ok(
    enemy.slowUntil >= start + st1.freeze + st1.slowDur - 0.05 &&
      enemy.slowUntil <= start + st1.freeze + st1.slowDur + EPS,
    `减速持续与数据一致（slowUntil=${enemy.slowUntil}）`
  );
});

test('极光：冻结不打断首领蓄力计时', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 1 } });
  enterWave(sim);
  sim.time = 5;
  const boss = spawnBoss(sim, { progress: 3, hp: 1e6, maxHp: 1e6 });
  boss.stopped = true;
  boss.stopTimer = 1;
  boss.cast = { kind: 'roar', progress: 0 };
  sim.castSkill();
  sim.update(0.2);
  assert.ok(boss.cast && boss.cast.progress > 0, '冻结期间蓄力仍在推进');
  near(boss.stopTimer, 0.8, '停顿时长照常流逝');
  near(boss.progress, 3, '冻结期间不移动');
});

test('技能伤害不吃暴击、不调用 combatRng', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 1 } });
  enterWave(sim);
  sim.time = 2;
  sim.mods.crit = 0.5;
  sim.combatRng = { float: () => { throw new Error('技能不应调用 combatRng'); } };
  const enemy = spawn(sim, { x: 5, y: 5, hp: 100000, maxHp: 100000 });
  sim.resolveMeteor({ type: 'meteor', x: 5, y: 5, r: 1.8, dmgPct: 0.3, burnPct: 0.12, level: 1 });
  near(100000 - enemy.hp, 100000 * 0.3, '无暴击的 30% 最大生命伤害');
});

test('极光：首领碎晶效率 ×0.4', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 1 } });
  enterWave(sim);
  const boss = spawnBoss(sim, { hp: 10000, maxHp: 10000, progress: 4 });
  sim.time = 5;
  sim.castSkill();
  const hpBefore = boss.hp;
  advance(sim, 1);
  near(hpBefore - boss.hp, 10000 * skillStats('aurora', 1).shatter * 0.4, '首领碎晶 ×0.4');
});

test('极光 L7：场上 ≥12 敌时冻结延长 0.3s', () => {
  const many = makeSim({ skill: { id: 'aurora', level: 7 } });
  enterWave(many);
  for (let i = 0; i < 12; i++) spawn(many, { progress: i * 0.5 });
  many.time = 3;
  many.castSkill();
  const st7 = skillStats('aurora', 7).freeze;
  near(many.enemies[0].freezeUntil, 3 + st7 + 0.3, '12 敌冻结延长 0.3s');

  const few = makeSim({ skill: { id: 'aurora', level: 7 } });
  enterWave(few);
  for (let i = 0; i < 11; i++) spawn(few, { progress: i * 0.5 });
  few.time = 3;
  few.castSkill();
  near(few.enemies[0].freezeUntil, 3 + st7, '11 敌不延长');
});

test('极光 L4 霜纹：25% 概率波及 0.8 格内另一名敌人（50% 碎晶）', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 4 } });
  enterWave(sim);
  sim.time = 2;
  const source = spawn(sim, { x: 5, y: 5, hp: 10000, maxHp: 10000 });
  const neighbor = spawn(sim, { x: 5.5, y: 5, hp: 10000, maxHp: 10000 });
  source.freezeUntil = 2.1;
  source.freezeVulnUntil = 2.1;
  source.freezeVuln = 0.16;
  source.freezeShatter = 0.08;
  source.freezeSlow = 0.467;
  source.freezeSlowDur = 4;

  sim.skillRng = { float: () => 0 }; // 必中霜纹
  const sourceHp = source.hp;
  const neighborHp = neighbor.hp;
  sim.resolveThaw(source, 2.1);
  near(sourceHp - source.hp, 10000 * 0.08, '本体碎晶 8%');
  near(neighborHp - neighbor.hp, 10000 * 0.08 * 0.5, '霜纹 50% 碎晶');
});

test('极光 L10 极光终章：冻结期间击杀爆出冰晶', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 10 } });
  enterWave(sim);
  sim.time = 4;
  const victim = spawn(sim, { x: 5, y: 5, hp: 1000, maxHp: 1000 });
  const neighbor = spawn(sim, { x: 5.6, y: 5, hp: 10000, maxHp: 10000 });
  victim.freezeUntil = 6;
  const hpBefore = neighbor.hp;

  sim.skillDamage(victim, 2000);
  assert.equal(victim.dead, true);
  near(hpBefore - neighbor.hp, 10000 * 0.04, '冰晶 4% 最大生命');
  near(neighbor.slowAmt, 0.2, '冰晶减速 20%');
  near(neighbor.slowUntil, sim.time + 2, '冰晶减速 2s');
});

// ---------- 星陨·天火 ----------

test('星陨：0.55s 预警后落点伤害 + 灼烧 3s', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 1 } });
  enterWave(sim);
  sim.time = 10;
  const enemy = spawn(sim, { x: 5, y: 5, hp: 100000, maxHp: 100000 });
  sim.castSkill();

  assert.equal(sim.skillPending.length, 3, '1 级 3 颗陨星');
  assert.ok(sim.skillPending.every((ev) => near0(ev.at, 10.55)), '预警 0.55s');
  const hpBefore = enemy.hp;

  sim.time = 10.3;
  sim.updateSkill(0.01);
  near(enemy.hp, hpBefore, '预警期间不结算');

  sim.time = 10.56;
  sim.updateSkill(0.01);
  const m1 = skillStats('meteor', 1);
  near(hpBefore - enemy.hp, 3 * 100000 * m1.dmgPct, '3 颗陨星伤害与数据一致');
  near(enemy.burnDps, (100000 * m1.burnPct) / 3, '灼烧伤害与数据一致');
  near(enemy.burnUntil, 10.56 + 3, '灼烧持续 3s');
});

function near0(actual, expected) {
  return Math.abs(actual - expected) < EPS;
}

test('星陨：首领效率 ×0.3', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 1 } });
  enterWave(sim);
  const boss = spawnBoss(sim, { x: 5, y: 5, hp: 100000, maxHp: 100000 });
  sim.time = 2;
  const hpBefore = boss.hp;
  sim.resolveMeteor({ type: 'meteor', x: 5, y: 5, r: 1.8, dmgPct: 0.3, burnPct: 0.12, level: 1 });
  near(hpBefore - boss.hp, 100000 * 0.3 * 0.3, '首领陨星 ×0.3');
});

test('星陨：陨星之间强制分簇（最小间距 2.5 格）', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 10 } });
  enterWave(sim);
  const xs = [2, 6, 10, 14, 18, 21];
  for (const x of xs) spawn(sim, { x, y: 2 });
  const points = sim.pickMeteorPoints(skillStats('meteor', 10), 6, 10);
  assert.equal(points.length, 6, '6 颗全部落地');
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      assert.ok(d >= 2.5 - EPS, `第 ${i}/${j} 颗间距 ${d}`);
    }
  }
});

test('星陨 L4 星轨：优先锁定未灼烧群落', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 4 } });
  enterWave(sim);
  sim.time = 5;
  for (let i = 0; i < 3; i++) {
    spawn(sim, { x: 3 + i * 0.1, y: 3, burnUntil: 8, burnDps: 10 });
  }
  for (let i = 0; i < 3; i++) spawn(sim, { x: 12 + i * 0.1, y: 3 });
  const [first] = sim.pickMeteorPoints(skillStats('meteor', 4), 1, 4);
  assert.ok(Math.abs(first.x - 12) < 0.2, `首颗落在未灼烧群落（x=${first.x}）`);
});

test('星陨 L7 流火：单次落点命中 ≥10 敌额外落 1 颗（每次释放最多 1 颗）', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 7 } });
  enterWave(sim);
  sim.time = 10;
  for (let i = 0; i < 12; i++) spawn(sim, { x: 5, y: 5, hp: 1e7, maxHp: 1e7 });
  sim.castSkill();
  const initial = sim.skillPending.length;
  assert.equal(initial, skillStats('meteor', 7).meteors);

  sim.time = 10.56;
  sim.updateSkill(0.01);
  assert.equal(sim.skillPending.length, 1, '额外 1 颗陨星已排队');
  near(sim.skillPending[0].at, sim.time + 0.55, '额外陨星同样有 0.55s 预警');
});

test('星陨 L10 天火终章：命中已灼烧目标触发余烬连锁（35%，最多 4 个）', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 10 } });
  enterWave(sim);
  sim.time = 3;
  // 两个已灼烧目标落在落点内。
  for (let i = 0; i < 2; i++) spawn(sim, { x: 5 + i * 0.2, y: 5, burnUntil: 10, burnDps: 1 });
  // 5 个落点外、连锁范围内的目标，最多 4 个被余烬命中。
  const chain = [];
  for (let i = 0; i < 5; i++) chain.push(spawn(sim, { x: 5 + i * 0.05, y: 7 }));

  sim.resolveMeteor({ type: 'meteor', x: 5, y: 5, r: 1.8, dmgPct: 0.3, burnPct: 0.12, level: 10 });
  const hit = chain.filter((enemy) => enemy.hp < 100000);
  assert.equal(hit.length, 4, '余烬连锁最多 4 个');
  for (const enemy of hit) near(100000 - enemy.hp, 100000 * 0.3 * 0.35, '余烬为 35% 陨星伤害');
});

// ---------- 时之终章 ----------

test('终章：全场星辉伤害 + 星痕易伤 + 时停停止移动', () => {
  const sim = makeSim({ skill: { id: 'chrono', level: 1 } });
  enterWave(sim);
  sim.time = 8;
  const enemy = spawn(sim, { progress: 6, hp: 100000, maxHp: 100000, baseSpeed: 1.4 });
  const hpBefore = enemy.hp;
  assert.equal(sim.castSkill(), true);

  const c1 = skillStats('chrono', 1);
  near(hpBefore - enemy.hp, 100000 * c1.novaPct, '星辉伤害与数据一致');
  near(enemy.skillVuln, c1.vuln, '星痕易伤');
  near(enemy.skillVulnUntil, 8 + c1.vulnDur, '1 级星痕时长');

  const vulnHp = enemy.hp;
  sim.damage(enemy, 100);
  near(vulnHp - enemy.hp, 100 * (1 + c1.vuln), '星痕易伤作用于塔伤害');

  const progressBefore = enemy.progress;
  advance(sim, 1);
  near(enemy.progress, progressBefore, '时停期间敌人不移动');
  assert.equal(sim.isStasisActive(), true);
});

test('终章：暂停首领 stopTimer/cast.progress/cooldowns 与中毒/灼烧计时', () => {
  const sim = makeSim({ skill: { id: 'chrono', level: 1 } });
  enterWave(sim);
  sim.time = 4;
  const boss = spawnBoss(sim, { progress: 3, hp: 1e6, maxHp: 1e6 });
  boss.stopped = true;
  boss.stopTimer = 1;
  boss.cast = { kind: 'roar', progress: 0.2 };
  boss.cooldowns = { roar: 5, summon: 0, slam: 0 };
  const add = spawn(sim, { progress: 1, hp: 1e6, maxHp: 1e6 });
  add.burnUntil = 10;
  add.burnDps = 500;
  add.poisonUntil = 10;
  add.poisonDps = 500;

  sim.castSkill();
  const hpAfterNova = add.hp;
  sim.update(0.5);

  near(boss.stopTimer, 1, 'stopTimer 暂停');
  near(boss.cast.progress, 0.2, '蓄力进度暂停');
  near(boss.cooldowns.roar, 5, '首领技能冷却暂停');
  near(add.burnUntil, 10 + 0.5, '灼烧计时暂停（结束时间顺延）');
  near(add.poisonUntil, 10 + 0.5, '中毒计时暂停（结束时间顺延）');
  near(add.hp, hpAfterNova, '暂停期间不吃灼烧/中毒伤害');
});

test('终章：时停后全塔过载；L4 时停期间攻速额外 +20%', () => {
  const sim = makeSim({ skill: { id: 'chrono', level: 4 } });
  enterWave(sim);
  sim.time = 10;
  const tower = addTower(sim, 'arrow');
  const base = sim.statsFor(tower);
  near(base.rate, 1.15, '基础攻速');
  near(base.range, 3.2, '基础射程');

  sim.castSkill();
  const c4 = skillStats('chrono', 4);
  near(sim.statsFor(tower).rate, 1.15 * (1 + c4.atkSpeed + 0.2), '时停期间攻速（基础+20%）');
  near(sim.statsFor(tower).range, 4.2, '时停期间射程 +1');

  sim.time = sim.stasis.until;
  sim.updateSkill(0.01);
  assert.equal(sim.stasis, null, '时停结束');
  near(sim.statsFor(tower).rate, 1.15 * (1 + c4.atkSpeed), '过载攻速与数据一致');
  near(sim.statsFor(tower).range, 4.2, '过载射程 +1');
  near(tower.skillOverdriveUntil, sim.time + skillStats('chrono', 4).overdrive, '过载时长');

  sim.time += skillStats('chrono', 4).overdrive + 1;
  sim.updateSkill(0.01);
  near(sim.statsFor(tower).rate, 1.15, '过载结束后自动刷新恢复');
  near(sim.statsFor(tower).range, 3.2, '过载结束后射程恢复');
});

test('终章 L10：时停期间每击杀 +0.1s，最多 +1s', () => {
  const sim = makeSim({ skill: { id: 'chrono', level: 10 } });
  enterWave(sim);
  sim.time = 20;
  sim.castSkill();
  const baseUntil = sim.stasis.baseUntil;
  for (let i = 0; i < 15; i++) {
    const enemy = spawn(sim, { progress: i });
    sim.skillDamage(enemy, enemy.hp + 1);
  }
  near(sim.stasis.bonus, 1, '延长上限 1s');
  near(sim.stasis.until, baseUntil + 1, '时停结束时间 +1s');
});

test('终章 L7：星痕时长 9s（数据已包含里程碑）', () => {
  const sim = makeSim({ skill: { id: 'chrono', level: 7 } });
  enterWave(sim);
  sim.time = 3;
  const enemy = spawn(sim, { progress: 1, hp: 1e6, maxHp: 1e6 });
  sim.castSkill();
  near(enemy.skillVulnUntil, 3 + 9, '7 级星痕 9s');
});

// ---------- 快照 ----------

test('快照：v4 含 skill；无技能仍写 v3；normalize 兼容 v2/v3/v4/v5', () => {
  const sim = makeSim({ skill: { id: 'meteor', level: 5 } });
  enterWave(sim);
  const snapshot = sim.toSnapshot();
  assert.equal(snapshot.version, 4);
  assert.deepEqual(snapshot.skill, { id: 'meteor', level: 5, cooldown: 0 });

  const plain = makeSim().toSnapshot();
  assert.equal(plain.version, 3, '无技能局保持 v3 旧格式');
  assert.equal(plain.skill, null);

  const v2 = normalizeSnapshot({ version: 2, wave: 4, relics: ['sharp'] });
  assert.equal(v2.version, 5);
  assert.equal(v2.skill, null);
  assert.deepEqual(v2.relics, [{ id: 'sharp', level: 1 }]);

  const v3 = normalizeSnapshot({
    version: 3,
    wave: 4,
    relics: [],
    skill: { id: 'meteor', level: 99, cooldown: 9999 },
  });
  assert.equal(v3.version, 5);
  assert.equal(v3.skill.level, 10, '等级钳到 1..10');
  assert.ok(v3.skill.cooldown <= SKILLS.meteor.levels[9].cd, '冷却钳到 ≤ 冷却上限');

  const v4 = normalizeSnapshot({
    version: 4,
    wave: 2,
    relics: [],
    skill: { id: 'chrono', level: '7', cooldown: 12 },
  });
  assert.deepEqual(v4.skill, { id: 'chrono', level: 7, cooldown: 12 });

  assert.equal(normalizeSnapshot({ version: 1 }), null, '未知版本拒绝');
  const badSkill = normalizeSnapshot({ version: 4, relics: [], skill: { id: 'nope', level: 3 } });
  assert.equal(badSkill.skill, null, '未知技能归一化为 null');
});

test('恢复：按 skill.cooldown / skillReadyAt（真实时间）恢复并钳制', () => {
  const direct = makeSim({ skill: { id: 'aurora', level: 3, cooldown: 12.5 } });
  near(direct.skill.cooldown, 12.5, '直接恢复剩余冷却');

  const clamped = makeSim({ skill: { id: 'aurora', level: 1, cooldown: 999 } });
  near(clamped.skill.cooldown, skillStats('aurora', 1).cd, '冷却钳到 ≤ 冷却');

  const future = makeSim({ skill: { id: 'aurora', level: 1 }, skillReadyAt: Date.now() + 5000 });
  assert.ok(future.skill.cooldown > 4.8 && future.skill.cooldown <= 5.0001, '按 epoch 扣减');

  const scaled = makeSim({
    skill: { id: 'aurora', level: 1 },
    skillReadyAt: Date.now() + 2000,
    skillSpeed: 3,
  });
  assert.ok(scaled.skill.cooldown > 5.8 && scaled.skill.cooldown <= 6.0001, '按倍速换算回模拟秒');

  const readyInSkill = makeSim({ skill: { id: 'aurora', level: 1, readyAt: Date.now() + 3000 } });
  assert.ok(
    readyInSkill.skill.cooldown > 2.8 && readyInSkill.skill.cooldown <= 3.0001,
    '兼容 skill.readyAt'
  );

  const past = makeSim({ skill: { id: 'aurora', level: 1 }, skillReadyAt: Date.now() - 5000 });
  near(past.skill.cooldown, 0, '过期即冷却好');

  const overflow = makeSim({ skill: { id: 'aurora', level: 1 }, skillReadyAt: Date.now() + 999999 });
  near(overflow.skill.cooldown, skillStats('aurora', 1).cd, 'epoch 超出冷却时钳制');
});

// ---------- 确定性 ----------

function skillFingerprint(sim) {
  return {
    time: Number(sim.time.toFixed(6)),
    cooldown: Number(sim.skill.cooldown.toFixed(6)),
    kills: sim.kills,
    gold: Math.floor(sim.gold),
    enemies: sim.enemies.map((enemy) => ({
      id: enemy.id,
      hp: Number(enemy.hp.toFixed(6)),
      progress: Number(enemy.progress.toFixed(6)),
      freezeUntil: Number((enemy.freezeUntil || 0).toFixed(6)),
      burnUntil: Number((enemy.burnUntil || 0).toFixed(6)),
    })),
  };
}

function deterministicScenario(id, level) {
  const sim = makeSim({ skill: { id, level } });
  enterWave(sim);
  sim.time = 6;
  for (let i = 0; i < 16; i++) {
    const enemy = spawn(sim, { progress: 2 + (i % 8) * 1.3, hp: 50000, maxHp: 50000 });
    enemy.baseSpeed = 1.2;
  }
  sim.castSkill();
  for (let step = 0; step < 180; step++) sim.update(1 / 60);
  return skillFingerprint(sim);
}

test('确定性：同 seed 两次结果一致（三技能）', () => {
  for (const id of ['aurora', 'meteor', 'chrono']) {
    assert.deepEqual(
      deterministicScenario(id, 10),
      deterministicScenario(id, 10),
      `${id} 同种子结果一致`
    );
  }
});

test('表现事件：skillFx 独立于画质过滤，并由 updateVisuals 递减', () => {
  const sim = makeSim({ skill: { id: 'aurora', level: 1 } });
  sim.setVisualQuality({ effects: 'off', floaters: 'off' });
  enterWave(sim);
  const enemy = spawn(sim, { progress: 3 });
  sim.castSkill();
  assert.ok(sim.skillFx.length > 0, '低画质下技能事件仍保留');
  assert.ok(sim.skillFx.every((fx) => fx.maxTtl === fx.ttl), 'maxTtl 已记录');
  assert.equal(sim.effects.some((e) => e.kind === 'aurora'), false, '不走 sim.effects');

  const ttl = sim.skillFx[0].ttl;
  sim.updateVisuals(0.1);
  near(sim.skillFx[0].ttl, ttl - 0.1, '按真实时间递减');
  sim.updateVisuals(10);
  assert.equal(sim.skillFx.length, 0, '过期后移除');
  assert.ok(enemy.freezeUntil > sim.time, '视觉更新不影响玩法状态');
});

test('技能不消耗 combatRng', () => {
  const withSkill = makeSim({ skill: { id: 'aurora', level: 10 } });
  const without = makeSim();
  enterWave(withSkill);
  enterWave(without);
  withSkill.castSkill();
  for (let i = 0; i < 8; i++) {
    assert.equal(withSkill.combatRng.float(), without.combatRng.float(), '战斗随机序列不变');
  }
});

// 无技能 30 波：固定建塔/升级策略，两次同 seed 必须完全一致（回归基线）。
function noSkillRun(seed) {
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 260,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost'],
  });
  const cells = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) if (map.buildable[r][c]) cells.push({ c, r });
  }
  const order = ['arrow', 'cannon', 'frost'];
  for (let i = 0; i < 9 && i < cells.length; i++) {
    sim.placeTower(order[i % order.length], cells[i].c, cells[i].r);
  }
  for (let wave = 1; wave <= 30; wave++) {
    sim.beginWave(generateWave(seed, wave, 'standard', map.meta));
    let steps = 0;
    while (sim.phase === 'wave' && steps < 3600) {
      sim.update(1 / 20);
      steps++;
    }
    if (sim.phase !== 'prep') break;
  }
  return {
    clearedWave: sim.clearedWave,
    wave: sim.wave,
    kills: sim.kills,
    gold: Math.floor(sim.gold),
    baseHp: Math.ceil(sim.baseHp),
    towers: sim.towers.length,
    skill: sim.skill,
  };
}

test('无技能 30 波：同 seed 两次结果一致且 skill 为 null', () => {
  const first = noSkillRun('regression-skill-off');
  const second = noSkillRun('regression-skill-off');
  assert.deepEqual(first, second);
  assert.equal(first.skill, null);
});
