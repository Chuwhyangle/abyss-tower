// Simulation 拆分守护：状态根 + 9 个系统对象组合、导出面快照、行数上限与同 seed 确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import { CombatSystem } from '../public/js/sim/combat-system.js';
import { DestructibleSystem } from '../public/js/sim/destructible-system.js';
import { EnemySystem } from '../public/js/sim/enemy-system.js';
import { ProjectileSystem } from '../public/js/sim/projectile-system.js';
import { RelicSystem } from '../public/js/sim/relic-system.js';
import { SkillSystem } from '../public/js/sim/skill-system.js';
import { SnapshotMapper } from '../public/js/sim/snapshot-mapper.js';
import { TowerSystem } from '../public/js/sim/tower-system.js';
import { WaveDirector } from '../public/js/sim/wave-director.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SIM_LINE_LIMIT = 800;

const SYSTEMS = [
  ['waveDirector', WaveDirector, 'wave-director.js'],
  ['enemySystem', EnemySystem, 'enemy-system.js'],
  ['towerSystem', TowerSystem, 'tower-system.js'],
  ['combatSystem', CombatSystem, 'combat-system.js'],
  ['projectileSystem', ProjectileSystem, 'projectile-system.js'],
  ['skillSystem', SkillSystem, 'skill-system.js'],
  ['relicSystem', RelicSystem, 'relic-system.js'],
  ['destructibleSystem', DestructibleSystem, 'destructible-system.js'],
  ['snapshotMapper', SnapshotMapper, 'snapshot-mapper.js'],
];

// 导出面快照：Simulation.prototype 的公共方法集合，拆分前后必须完全一致。
const EXPORT_SURFACE = [
  'addCulmination', 'addEffect', 'addFloater', 'addRelic', 'addSkillFx', 'applyDestructibleEffect',
  'applyEventOption',
  'applyOffer', 'applyTowerOverdrive', 'auraBuffFor', 'beginWave', 'buildPath', 'canBuild', 'canEvolve',
  'castAurora', 'castBossSkill', 'castChrono', 'castMeteor', 'castSkill', 'cleanup', 'clearTowerOverdrive',
  'completeWave', 'computeHit', 'computePendingEvent', 'computeTowerStats', 'constructor',
  'createHexContext', 'currentWaveHpMul', 'damage', 'damageTower', 'dealDamage', 'destroyDestructible',
  'destructibleAt', 'destructibleAura', 'destructibleState', 'emberChain', 'endStasis', 'enterBossPhase',
  'evolutionOptions', 'evolveTower', 'findTarget', 'fire', 'flushSplits', 'gameOver', 'getHud',
  'getRelicLevel', 'hexCall', 'hitEnemy', 'impact', 'inRange', 'inheritTowerOverdrive', 'initSkill',
  'isSkillReady', 'isStasisActive', 'killEnemy', 'laneProgressNear', 'leak', 'makeTower',
  'nearestSkillTarget', 'nextWavePreview', 'onSkillKill', 'pickBossSkill', 'pickMeteorPoints', 'placeTower',
  'playSound', 'posAt', 'previewStats', 'queueMeteor', 'recomputeMods', 'recomputeTowerStats',
  'refreshTowerStats', 'removeTower', 'resolveMeteor', 'resolveThaw', 'save', 'savePreWave', 'sellTower',
  'sellValue', 'setVisualQuality', 'skillDamage', 'skillField', 'skillPctDamage', 'skillTargets',
  'spawnAlly', 'spawnDestructibleSwarm', 'spawnDue', 'spawnEnemy', 'spawnEnemyAt', 'statsFor',
  'toSnapshot', 'towerAt', 'towerCost', 'towerDamageMul', 'towerEvolution', 'towerEvolutions',
  'towerMaxLevel', 'update', 'updateAllies', 'updateBoss', 'updateEnemies', 'updateEnemySkillStatus',
  'updateProjectiles', 'updateRanged', 'updateSkill', 'updateTowers', 'updateVisuals', 'upgradeCost',
  'upgradeTower',
];

function makeSim() {
  const seed = 'sim-systems-seed';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 5000,
    baseHp: 50,
    maxBaseHp: 50,
    relics: [{ id: 'crit', level: 2 }],
    skill: { id: 'aurora', level: 5 },
    unlockedTowers: ['arrow', 'cannon', 'frost'],
    onToast: () => {},
  });
  const cells = [];
  for (let r = 0; r < map.rows; r += 1) {
    for (let c = 0; c < map.cols; c += 1) {
      if (sim.canBuild(c, r)) cells.push([c, r]);
    }
  }
  const types = ['arrow', 'cannon', 'frost'];
  for (let i = 0; i < Math.min(4, cells.length); i += 1) {
    sim.placeTower(types[i % types.length], cells[i][0], cells[i][1]);
  }
  return { sim, map, seed };
}

function playScriptedWaves(sim, map, seed, waves = 2) {
  for (let wave = 1; wave <= waves; wave += 1) {
    const def = generateWave(
      seed,
      wave,
      'standard',
      { portalCount: map.meta?.portalCount || 1, modifier: map.meta?.modifier || null },
      { endless: false }
    );
    assert.equal(sim.beginWave(def), true, `第 ${wave} 波应可开始`);
    let steps = 0;
    while (sim.phase === 'wave' && steps < 30 * 240) {
      if (sim.isSkillReady()) sim.castSkill();
      sim.update(1 / 30);
      steps += 1;
    }
  }
}

function normalizedState(sim) {
  const snapshot = sim.toSnapshot();
  delete snapshot.savedAt;
  delete snapshot.startedAt;
  return {
    snapshot,
    hud: sim.getHud(),
    stats: sim.towers.map((tower) => sim.statsFor(tower)),
  };
}

test('sim.js 行数低于 800（状态根 + 委派，不再承载系统实现）', () => {
  const lines = read('public/js/sim.js').trimEnd().split('\n').length;
  assert.ok(lines < SIM_LINE_LIMIT, `sim.js ${lines} 行，超过 ${SIM_LINE_LIMIT} 行上限`);
});

test('9 个系统模块存在且均在 Simulation 构造中被实例化', () => {
  const source = read('public/js/sim.js');
  const { sim } = makeSim();
  for (const [field, Class, file] of SYSTEMS) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/js/sim', file)), `${file} 不存在`);
    assert.match(source, new RegExp(`this\\.${field}\\s*=\\s*new ${Class.name}\\(this\\)`), `${field} 未在构造中实例化`);
    assert.ok(sim[field] instanceof Class, `${field} 不是 ${Class.name} 实例`);
    assert.equal(sim[field].sim, sim, `${field} 必须持有状态根引用`);
  }
});

test('导出面快照与拆分前一致', () => {
  const names = Object.getOwnPropertyNames(Simulation.prototype).sort();
  assert.deepEqual(names, EXPORT_SURFACE);
});

test('sim.js 不再保留已迁出职责的实现', () => {
  const source = read('public/js/sim.js');
  assert.doesNotMatch(source, /enemy\.hp -=/);
  assert.doesNotMatch(source, /this\.projectiles\.push\(/);
  assert.doesNotMatch(source, /this\.destructibles\.find\(/);
  assert.match(source, /this\.enemySystem\.updateEnemies\(dt\)/);
  assert.match(source, /this\.waveDirector\.spawnDue\(\)/);
});

test('同 seed 的两局脚本化对局得到完全一致的快照与塔属性', () => {
  const first = makeSim();
  playScriptedWaves(first.sim, first.map, first.seed);
  const second = makeSim();
  playScriptedWaves(second.sim, second.map, second.seed);
  assert.equal(
    JSON.stringify(normalizedState(first.sim)),
    JSON.stringify(normalizedState(second.sim)),
    '同 seed 的两次对局状态应逐字节一致'
  );
  assert.ok(first.sim.towers.length > 0, '脚本化对局至少应建造一座塔');
});
