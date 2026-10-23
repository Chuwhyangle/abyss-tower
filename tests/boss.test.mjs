// 首领机制回归：独立血量曲线、走走停停、破绽窗口、三系技能与阶段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { BALANCE } from '../public/js/shared/config.js';
import { ENEMIES } from '../public/js/shared/data.js';

const STEP = 1 / 60;

function makeSim(waveIndex = 10) {
  const map = generateMap('boss-test-seed');
  const sim = new Simulation({
    map,
    seed: 'boss-test-seed',
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
  });
  sim.waveDef = {
    index: waveIndex,
    hpMul: BALANCE.bossHpGrowth ** (waveIndex - 1) * 1.1,
    speedMul: 1,
    reward: 0,
    groups: [],
    boss: true,
    finalBoss: false,
  };
  sim.wave = waveIndex;
  sim.phase = 'wave';
  sim.spawnQueue = [];
  return sim;
}

function spawnBoss(sim) {
  sim.spawnEnemy('boss', 0, sim.waveDef.hpMul);
  return sim.enemies[sim.enemies.length - 1];
}

function advance(sim, seconds) {
  const steps = Math.ceil(seconds / STEP);
  for (let i = 0; i < steps; i++) sim.update(STEP);
}

test('首领使用独立血量曲线，最终首领不再失控', () => {
  const wave5 = generateWave('boss-curve', 5, 'standard');
  const boss5 = wave5.groups.find((group) => group.type === 'boss');
  const expect5 = BALANCE.bossHpGrowth ** 4 * 1.1;
  assert.ok(Math.abs(boss5.hpMul - expect5) < 0.01, '第 5 波首领倍率');

  const wave30 = generateWave('boss-curve', 30, 'standard');
  const boss30 = wave30.groups.find((group) => group.type === 'boss');
  const expect30 = BALANCE.bossHpGrowth ** 29 * 1.1 * BALANCE.bossFinalMul;
  assert.ok(Math.abs(boss30.hpMul - expect30) < 0.1, '第 30 波首领倍率');
  // 旧曲线（1.165^29）约为 8.3 万；新曲线应显著低于此。
  assert.ok(boss30.hpMul * ENEMIES.boss.hp < 50000, '最终首领血量上限');
});

test('首领走走停停：停顿期间不前进且进入破绽', () => {
  const sim = makeSim(10);
  const boss = spawnBoss(sim);
  advance(sim, BALANCE.bossStopInterval + 0.2);
  assert.equal(boss.stopped, true, '到点应停顿');
  const progress = boss.progress;
  advance(sim, 0.5);
  assert.equal(boss.progress, progress, '停顿期间不前进');
  assert.ok(boss.vulnUntil > sim.time, '停顿期间处于破绽');
});

test('破绽窗口伤害提升，结束后恢复', () => {
  const sim = makeSim(10);
  const boss = spawnBoss(sim);
  boss.stopped = true;
  boss.stopTimer = 5;
  boss.vulnUntil = sim.time + 5;

  let before = boss.hp;
  sim.damage(boss, 100, { ignoreArmor: true, silent: true });
  const vulnerable = before - boss.hp;
  assert.ok(Math.abs(vulnerable - 100 * BALANCE.bossVulnMul) < 0.01, '破绽增伤');

  boss.vulnUntil = 0;
  before = boss.hp;
  sim.damage(boss, 100, { ignoreArmor: true, silent: true });
  assert.ok(Math.abs(before - boss.hp - 100) < 0.01, '非破绽无增伤');
});

test('深渊咆哮给范围内敌人加速', () => {
  const sim = makeSim(10);
  const boss = spawnBoss(sim);
  sim.spawnEnemyAt('grunt', 0, boss.progress);
  const grunt = sim.enemies[sim.enemies.length - 1];
  sim.castBossSkill(boss, 'roar', sim.time);
  assert.ok(grunt.speedBuffUntil > sim.time, '获得加速窗口');
  assert.equal(grunt.speedBuff, BALANCE.bossRoarSpeed);
});

test('裂隙召唤按波次生成噬虫', () => {
  const sim = makeSim(20);
  const boss = spawnBoss(sim);
  const before = sim.enemies.length;
  sim.castBossSkill(boss, 'summon', sim.time);
  const expected = Math.min(
    BALANCE.bossSummonMax,
    Math.round(BALANCE.bossSummonBase + 20 * BALANCE.bossSummonPerWave)
  );
  assert.equal(sim.enemies.length, before + expected);
  assert.ok(sim.enemies.slice(before).every((enemy) => enemy.type === 'swarm'));
});

test('地脉震击让范围内防御塔停摆，停摆期间不开火', () => {
  const sim = makeSim(20);
  const boss = spawnBoss(sim);
  const tower = sim.makeTower('arrow', Math.floor(boss.x), Math.floor(boss.y));
  sim.towers.push(tower);
  sim.refreshTowerStats(tower);

  sim.castBossSkill(boss, 'slam', sim.time);
  assert.ok(tower.disabledUntil > sim.time, '塔被停摆');

  tower.cd = 0;
  const before = sim.projectiles.length;
  sim.updateTowers(STEP);
  assert.equal(sim.projectiles.length, before, '停摆期间不产生弹道');
});

test('首领在 66%/33%/25% 进入阶段与狂怒', () => {
  const sim = makeSim(20);
  const boss = spawnBoss(sim);
  boss.hp = boss.maxHp * 0.6;
  sim.updateBoss(boss, STEP, boss.baseSpeed, sim.time);
  assert.equal(boss.bossPhase, 2);

  boss.hp = boss.maxHp * 0.3;
  sim.updateBoss(boss, STEP, boss.baseSpeed, sim.time);
  assert.equal(boss.bossPhase, 3);

  boss.hp = boss.maxHp * 0.2;
  sim.updateBoss(boss, STEP, boss.baseSpeed, sim.time);
  assert.equal(boss.enraged, true);
});

test('开局放怪按群组血量倍率生成（首领独立曲线生效）', () => {
  const sim = makeSim(15);
  sim.phase = 'prep';
  sim.wave = 0;
  const def = {
    index: 15,
    hpMul: 10,
    speedMul: 1,
    reward: 0,
    boss: true,
    portals: [0],
    groups: [
      { type: 'boss', count: 1, interval: 3, delay: 0, portal: 0, hpMul: 5 },
      { type: 'grunt', count: 1, interval: 1, delay: 0, portal: 0, hpMul: 10 },
    ],
  };
  assert.equal(sim.beginWave(def), true);
  sim.waveTime = 10;
  sim.spawnDue();

  const boss = sim.enemies.find((enemy) => enemy.boss);
  const grunt = sim.enemies.find((enemy) => enemy.type === 'grunt');
  assert.ok(boss, '首领已生成');
  assert.equal(boss.maxHp, Math.round(ENEMIES.boss.hp * 5));
  assert.equal(grunt.maxHp, Math.round(ENEMIES.grunt.hp * 10));
});

test('拥有多个首领时各自独立停摆', () => {
  const sim = makeSim(20);
  const a = spawnBoss(sim);
  const b = spawnBoss(sim);
  advance(sim, BALANCE.bossStopInterval + 0.2);
  assert.equal(a.stopped, true);
  assert.equal(b.stopped, true);
  assert.ok(a.stopTimer > 0 && b.stopTimer > 0);
});
