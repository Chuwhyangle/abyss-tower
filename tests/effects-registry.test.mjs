// 效果注册表：遗物 mod 键的集中声明与审计。
// 覆盖三件事：所有遗物键都已登记、未登记键明确报错、重构前后固定种子结算逐字一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  GLOBAL_MOD_CAPS,
  RELICS,
  RELIC_BY_ID,
  relicEffectText,
  relicModsAtLevel,
} from '../public/js/shared/data.js';
import {
  EFFECT_REGISTRY,
  globalModCaps,
} from '../public/js/shared/effects.js';

const SEED = 'effects-registry-seed';

function makeSim(relics = [], opts = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 5000,
    baseHp: 40,
    maxBaseHp: 40,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'sniper', 'banner'],
    onToast: () => {},
    onSave: () => {},
    ...opts,
  });
}

// 测试期内临时注入的遗物/键必须在 finally 中移除，不污染正式数据。
function withInjectedRelic(relic, effects, fn) {
  RELICS.push(relic);
  RELIC_BY_ID[relic.id] = relic;
  Object.assign(EFFECT_REGISTRY, effects);
  try {
    return fn();
  } finally {
    RELICS.pop();
    delete RELIC_BY_ID[relic.id];
    for (const key of Object.keys(effects)) delete EFFECT_REGISTRY[key];
  }
}

test('全部遗物的每个 mod 键都在效果注册表中登记', () => {
  for (const relic of RELICS) {
    for (const key of Object.keys(relic.mods || {})) {
      assert.ok(EFFECT_REGISTRY[key], `遗物 ${relic.id} 使用了未注册的 mod 键 ${key}`);
    }
  }
});

test('注册表每项都声明了上限、文案与平衡权重', () => {
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    assert.equal(typeof entry.cap, 'number', `${key} 缺少 cap`);
    assert.equal(typeof entry.globalCap, 'number', `${key} 缺少 globalCap`);
    assert.equal(typeof entry.text, 'function', `${key} 缺少 text`);
    assert.equal(typeof entry.balanceWeight, 'number', `${key} 缺少 balanceWeight`);
  }
});

test('全局上限由注册表派生，GLOBAL_MOD_CAPS 不再是第二份来源', () => {
  assert.deepEqual(GLOBAL_MOD_CAPS, globalModCaps());
  assert.equal(GLOBAL_MOD_CAPS.dmgType, EFFECT_REGISTRY.dmg.globalCap);
});

test('未注册的 mod 键会明确报错，而不是被静默忽略', () => {
  const rogue = {
    id: 'rogue-mod', name: '未登记效果', rarity: 'common', desc: '', mods: { ghost: 1 },
  };
  RELICS.push(rogue);
  RELIC_BY_ID[rogue.id] = rogue;
  try {
    assert.throws(() => relicModsAtLevel('rogue-mod', 1), /未注册的 mod 键: ghost/);
    assert.throws(() => relicEffectText('rogue-mod', 1), /未注册的 mod 键: ghost/);
    assert.throws(() => makeSim([{ id: 'rogue-mod', level: 1 }]), /未注册的 mod 键: ghost/);
  } finally {
    RELICS.pop();
    delete RELIC_BY_ID[rogue.id];
  }
});

test('注入只含新键的样例遗物后，sim 生效且文案正确', () => {
  const sample = {
    id: 'test-execute', name: '测试处决', rarity: 'common', desc: '', mods: { execute: 0.5 },
  };
  withInjectedRelic(sample, {
    execute: {
      cap: 1,
      globalCap: 1,
      balanceWeight: 5,
      text: (value) => `处决伤害 +${Math.round(value * 100)}%`,
      hitCondition: (sim, enemy) => enemy.execute === true,
    },
  }, () => {
    const sim = makeSim([{ id: 'test-execute', level: 1 }]);
    assert.equal(sim.mods.execute, 0.5);
    assert.equal(sim.computeHit(100, 'arrow', { execute: true }, { noCrit: true }).dmg, 150);
    assert.equal(sim.computeHit(100, 'arrow', { execute: false }, { noCrit: true }).dmg, 100);
    assert.equal(relicEffectText('test-execute', 1), '处决伤害 +50%');
  });
  assert.equal(EFFECT_REGISTRY.execute, undefined);
  assert.equal(RELIC_BY_ID['test-execute'], undefined);
});

test('固定种子结算哈希与重构前逐字一致', () => {
  const map = generateMap(SEED);
  const buildable = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) if (map.buildable[r][c]) buildable.push({ c, r });
  }
  const types = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'sniper', 'banner'];
  const towers = types.map((type, i) => ({ ...buildable[i * 3], type, level: 2 }));

  const sim = makeSim(RELICS.map((r) => ({ id: r.id, level: 3 })), {
    gold: 5000,
    baseHp: 40,
    maxBaseHp: 40,
    towers,
  });

  const parts = [snap(sim)];
  for (let wave = 1; wave <= 3; wave++) {
    sim.beginWave(generateWave(SEED, wave, 'standard', map.meta || {}));
    let steps = 0;
    while (sim.phase === 'wave' && steps < 60 * 120) {
      sim.update(1 / 60);
      steps++;
    }
    parts.push({ wave, steps, state: snap(sim) });
  }

  const json = JSON.stringify(canonicalize(parts));
  const hash = createHash('sha256').update(json).digest('hex');
  // V26-001：遗物扩容到 40 件，全遗物结算基线随内容更新。
  // V34-001：遗物扩容到 50 件并新增 2 套套装，全遗物结算基线随内容更新。
  // V41-004：遗物扩容到 60 件并新增条件型效果，全遗物结算基线随内容更新。
  // V50-003：遗物扩容到 70 件并新增回合型效果（mods 新增键、波末结算金币/生命），
  // 全遗物配置的 mods 与第 2/3 波结算结果变化，基线随内容更新。
  assert.equal(hash, 'f2dd2b71b36f1b94a007fdc90fe459281d3a85ac513f2e1e44c10ac699b3f9e0');
});

function round(n) {
  return typeof n === 'number' ? Math.round(n * 1e9) / 1e9 : n;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
  }
  return value;
}

function snap(sim) {
  return {
    gold: round(sim.gold),
    baseHp: round(sim.baseHp),
    maxBaseHp: round(sim.maxBaseHp),
    kills: sim.kills,
    wave: sim.wave,
    clearedWave: sim.clearedWave,
    phase: sim.phase,
    time: round(sim.time),
    mods: sim.mods,
    towers: sim.towers.map((t) => ({ type: t.type, c: t.c, r: t.r, level: t.level, stats: t.stats })),
    enemies: sim.enemies.map((e) => ({
      type: e.type, hp: round(e.hp), maxHp: round(e.maxHp), progress: round(e.progress),
      x: round(e.x), y: round(e.y), slowUntil: round(e.slowUntil), poisonUntil: round(e.poisonUntil),
      bossPhase: e.bossPhase, enraged: e.enraged,
    })),
    projectiles: sim.projectiles.length,
  };
}
