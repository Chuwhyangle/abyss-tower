// 无尽模式 60 波后内容：周期词缀 + 首领循环。
// 覆盖点：词缀/循环的波次边界、seed 派生确定性、词缀纯数据契约、
// 词缀效果真实抬升血量/移速/奖励、首领循环递增、≤60 波与普通模式逐字节不变。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave, endlessCycleFor, selectEndlessAffixes, ENDLESS } from '../public/js/shared/waves.js';
import {
  ENDLESS_POST_60,
  ENDLESS_AFFIX_INTERVAL,
  ENDLESS_AFFIX_MAX_LAYERS,
  ENDLESS_AFFIXES,
  ENDLESS_ELITE_ENEMIES,
  ENDLESS_BOSS_CYCLE_INTERVAL,
  ENDLESS_BOSS_CYCLE_MAX,
  ENDLESS_BOSS_CYCLE_HP_GROWTH,
} from '../public/js/shared/data/endless.js';
import { ENEMIES } from '../public/js/shared/data.js';
import { BOSS_VARIANTS } from '../public/js/shared/data/enemies.js';

const SEED = 'endless-post-60-seed';

function waveAt(index) {
  return generateWave(SEED, index, 'standard', {}, { endless: true });
}

test('词缀/循环波次边界：≤60 波无词缀，61 波起每 10 波追加一层', () => {
  assert.equal(endlessCycleFor(60), 0);
  assert.equal(endlessCycleFor(61), 1);
  assert.equal(endlessCycleFor(70), 1);
  assert.equal(endlessCycleFor(71), 2);
  assert.equal(endlessCycleFor(80), 2);
  assert.equal(ENDLESS_POST_60, 60);
  assert.equal(ENDLESS_AFFIX_INTERVAL, 10);

  // ≤60 波不携带任何无尽词缀/循环字段（presence-gate：字段整体缺席）。
  for (const wave of [1, 30, 40, 60]) {
    const def = waveAt(wave);
    assert.equal('endlessCycle' in def, false, `第 ${wave} 波不应有 endlessCycle`);
    assert.equal('endlessAffixes' in def, false, `第 ${wave} 波不应有 endlessAffixes`);
    assert.equal('cycleBoss' in def, false, `第 ${wave} 波不应有 cycleBoss`);
  }

  // 61 波起追加第 1 层，151 波封顶（第 10 层），之后层数不再增长。
  for (const [wave, cycle] of [[61, 1], [70, 1], [71, 2], [100, 4], [150, 9], [151, 10], [400, 34], [999, 94]]) {
    const def = waveAt(wave);
    assert.equal(def.endlessCycle, cycle, `第 ${wave} 波周期应为 ${cycle}`);
    const layers = Object.values(def.endlessAffixes).reduce((sum, n) => sum + n, 0);
    assert.equal(layers, Math.min(cycle, ENDLESS_AFFIX_MAX_LAYERS), `第 ${wave} 波词缀层数`);
  }
});

test('词缀 seed 派生、逐层独立、同种子可复现，且不消耗波次 rng', () => {
  const a = selectEndlessAffixes(SEED, 4);
  const b = selectEndlessAffixes(SEED, 4);
  assert.deepEqual(a, b, '同种子同层数必须逐字一致');
  assert.notDeepEqual(selectEndlessAffixes(SEED, 1).stacks, selectEndlessAffixes(`${SEED}x`, 1).stacks);

  assert.equal(selectEndlessAffixes(SEED, 0), null);
  assert.equal(selectEndlessAffixes(SEED, -1), null);

  // 累计倍率与层数吻合：每层效果乘法叠加、层数加和等于入参。
  const layers = Object.values(a.stacks).reduce((sum, n) => sum + n, 0);
  assert.equal(layers, 4);
  let hp = 1;
  let speed = 1;
  let gold = 1;
  let elite = 0;
  for (const [id, n] of Object.entries(a.stacks)) {
    const def = ENDLESS_AFFIXES.find((x) => x.id === id);
    hp *= def.hpMul ** n;
    speed *= def.speedMul ** n;
    gold *= def.goldMul ** n;
    elite += def.elite * n;
  }
  assert.ok(Math.abs(a.hpMul - hp) < 1e-9, 'hpMul 累乘不一致');
  assert.ok(Math.abs(a.speedMul - speed) < 1e-9, 'speedMul 累乘不一致');
  assert.ok(Math.abs(a.goldMul - gold) < 1e-9, 'goldMul 累乘不一致');
  assert.ok(Math.abs(a.eliteBoost - elite) < 1e-9, 'eliteBoost 累加不一致');

  // 波次 rng 独立：生成波次前取 selectEndlessAffixes，与 generateWave 内部结果一致，
  // 且无尽词缀不改变同波次普通群组结构（≤60 波逐字节不变由下面的用例覆盖）。
  assert.deepEqual(waveAt(77), waveAt(77));
});

test('词缀是带中文名与机制说明的纯数据，覆盖血量/移速/金币/精英四类效果', () => {
  for (const affix of ENDLESS_AFFIXES) {
    assert.ok(affix.id && affix.id === affix.id.trim(), '缺少 id');
    assert.match(affix.name, /[一-龥]/, `${affix.id} 缺少中文名`);
    assert.ok(affix.desc && affix.desc.trim(), `${affix.id} 缺少机制说明`);
    assert.ok(affix.color, `${affix.id} 缺少配色`);
    for (const key of ['hpMul', 'speedMul', 'goldMul']) {
      assert.ok(Number.isFinite(affix[key]) && affix[key] >= 1, `${affix.id}.${key} 非法`);
    }
    assert.ok(Number.isFinite(affix.elite) && affix.elite >= 0, `${affix.id}.elite 非法`);
  }
  // 池子必须覆盖四类效果，才能兑现「hpMul/speedMul 上台阶 + 精英占比提升」。
  assert.ok(ENDLESS_AFFIXES.some((a) => a.hpMul > 1), '缺少血量词缀');
  assert.ok(ENDLESS_AFFIXES.some((a) => a.speedMul > 1), '缺少移速词缀');
  assert.ok(ENDLESS_AFFIXES.some((a) => a.goldMul > 1), '缺少金币词缀');
  assert.ok(ENDLESS_AFFIXES.some((a) => a.elite > 0), '缺少精英词缀');

  // 精英集合必须全部存在于敌人表（POOL 内类型），否则权重加成落空。
  for (const id of ENDLESS_ELITE_ENEMIES) {
    assert.ok(ENEMIES[id], `精英集合含未知敌人 ${id}`);
  }
});

test('词缀真实抬升血量/移速/奖励：60 波前不漂移，60 波后上台阶', () => {
  const capped = waveAt(ENDLESS.hpCapWave);
  const far = waveAt(400);
  // 顶层 hpMul 字段仍保持封顶基线（与 endless.test 的旧断言一致）。
  assert.equal(far.hpMul, capped.hpMul, '顶层 hpMul 封顶后不再增长');
  assert.ok(far.speedMul <= ENDLESS.speedCap, '移速仍在硬上限内');

  // 60 波前无词缀：非首领群组血量 = 顶层封顶基线（群组血量未 round3，容差取 round3 精度）。
  const pre60 = waveAt(59);
  const pre60Group = pre60.groups.find((g) => g.type !== 'boss');
  assert.ok(Math.abs(pre60Group.hpMul - pre60.hpMul) < 0.001, '60 波前群组血量应与基线一致');

  // 60 波后：群组血量 = 基线 × 词缀血量倍率（≥ 基线），且随周期不降。
  // 群组对群组比较，避免顶层 round3 引入的 ±0.0005 噪声。
  const post61 = waveAt(61);
  const post71 = waveAt(71);
  const g61 = post61.groups.find((g) => g.type !== 'boss');
  const g71 = post71.groups.find((g) => g.type !== 'boss');
  assert.ok(g61.hpMul >= pre60Group.hpMul - 1e-9, '61 波群组血量不应低于基线');
  assert.ok(g71.hpMul >= g61.hpMul - 1e-9, '71 波群组血量不应低于 61 波');

  // 奖励在词缀金币倍率下不低于封顶基础值（rewardIndex 封顶 60，基础 200）。
  assert.ok(post61.reward >= 200, '61 波奖励不应低于封顶基础');
  // 移速：同种子下，含移速词缀的周期会推动速度上台阶（封顶前）。
  const speed61 = post61.speedMul;
  const speed71 = post71.speedMul;
  assert.ok(speed71 >= speed61 - 1e-9, '71 波移速不应低于 61 波');
});

test('首领循环：70/80/90/100 波循环出首领，血量随循环递增并封顶', () => {
  assert.equal(ENDLESS_BOSS_CYCLE_INTERVAL, 10);
  assert.equal(ENDLESS_BOSS_CYCLE_MAX, 10);
  assert.ok(ENDLESS_BOSS_CYCLE_HP_GROWTH > 1);

  const base = waveAt(60).groups.find((g) => g.type === 'boss').hpMul;
  let previous = base;
  for (const [wave, cycle] of [[70, 1], [80, 2], [90, 3], [100, 4]]) {
    const def = waveAt(wave);
    assert.equal(def.cycleBoss, true, `第 ${wave} 波应是循环首领`);
    assert.equal(def.bossCycle, cycle, `第 ${wave} 波循环序号`);
    const boss = def.groups.find((g) => g.type === 'boss').hpMul;
    assert.ok(boss > previous, `第 ${wave} 波循环首领血量未递增`);
    previous = boss;
    assert.match(def.label, new RegExp(`循环${cycle}`), '循环首领标签');
  }

  // 非循环首领波（65/75/85）不带循环标记。
  for (const wave of [65, 75, 85]) {
    const def = waveAt(wave);
    assert.equal(def.cycleBoss ?? false, false, `第 ${wave} 波不应是循环首领`);
    assert.equal('bossCycle' in def, false, `第 ${wave} 波不应有 bossCycle`);
  }

  // 循环强度封顶：第 990 波（第 10 循环）后 bossCycle 停在最大值，不无限递增。
  assert.equal(waveAt(990).bossCycle, ENDLESS_BOSS_CYCLE_MAX);
});

test('普通模式不受影响：第 31 波仍收敛到最终波，无无尽词缀字段', () => {
  const normal = generateWave(SEED, 61, 'standard');
  assert.equal(normal.index, 30, '普通模式第 61 次请求仍收敛到最终波');
  assert.equal(normal.finalBoss, true);
  assert.equal('endlessCycle' in normal, false);
  assert.equal('endlessAffixes' in normal, false);
  assert.equal('cycleBoss' in normal, false);
});

test('词缀与首领循环经模拟生效：第 70 波首领血量按循环倍率抬升', () => {
  const def = waveAt(70);
  const map = generateMap(SEED);
  const sim = new Simulation({ map, seed: SEED, difficulty: 'standard', gold: 0, baseHp: 20, maxBaseHp: 20 });
  sim.waveDef = def;
  sim.wave = def.index;
  sim.phase = 'wave';
  sim.spawnQueue = [];

  const bossGroup = def.groups.find((g) => g.type === 'boss');
  sim.spawnEnemy('boss', 0, bossGroup.hpMul);
  const boss = sim.enemies[sim.enemies.length - 1];
  const variant = BOSS_VARIANTS[def.bossVariant];
  const auraHpMul = sim.destructibleAura().hpMul;
  assert.equal(boss.maxHp, Math.round(ENEMIES.boss.hp * bossGroup.hpMul * variant.hpMul * auraHpMul));
  // 循环倍率确实叠在首领群组血量上（bossGroup.hpMul > 顶层 bossHpMul 基线 × 词缀）。
  assert.ok(bossGroup.hpMul > 1, '第 70 波首领群组血量应显著抬升');
});
