// 阶段 5：sim 战斗 hook 总线（shared/hooks.js）的运行时自证 + 总线接线回归。
// (a) HookBus 纯运行时：注册顺序调度 / 缺失跳过 / 非法回退；
// (b) 接线回归：遗物行为走 onProjectileHit/onKillSettle、海克斯副作用钩子走总线。
import test from 'node:test';
import assert from 'node:assert/strict';

import { HookBus, HOOK_NAMES } from '../public/js/shared/hooks.js';
import { buildScenario } from './lib/scenario.mjs';

const EPS = 1e-9;

// 复用 scenario 驱动 helper 生成可精确控制状态/位置的敌人（不手拼 Simulation）。
function addEnemy(sc, overrides = {}) {
  sc.spawnEnemy('grunt');
  const enemy = sc.sim.enemies[sc.sim.enemies.length - 1];
  Object.assign(
    enemy,
    {
      hp: 100000,
      maxHp: 100000,
      armor: 0,
      boss: false,
      dead: false,
      slowUntil: 0,
      freezeUntil: 0,
      poisonUntil: 0,
      poisonDps: 0,
      poisonHop: 0,
    },
    overrides
  );
  return enemy;
}

test('HOOK_NAMES：固定数组顺序即调度顺序，覆盖战斗钩子名单', () => {
  assert.equal(Array.isArray(HOOK_NAMES), true);
  assert.equal(Object.isFrozen(HOOK_NAMES), true, 'hook 名单应冻结，杜绝运行时改序');
  assert.deepEqual(HOOK_NAMES, [
    'onHit',
    'onProjectileHit',
    'onEnemyKilled',
    'onKillSettle',
    'onLeak',
    'onRelicGained',
  ]);
});

test('HookBus.emit：按注册顺序调度、缺失跳过、返回值忽略', () => {
  const bus = new HookBus();
  const order = [];
  bus.register({ name: 'a', onHit() { order.push('a'); } });
  bus.register({ name: 'b' }); // 不处理 onHit，应被跳过
  bus.register({ name: 'c', onHit() { order.push('c'); } });
  bus.emit('onHit');
  assert.deepEqual(order, ['a', 'c'], '按注册顺序调度并跳过缺失 provider');
  assert.doesNotThrow(() => bus.emit('__unknown__', 1), '未知 hook 安全跳过');
  assert.equal(bus.has('onHit'), true);
  assert.equal(bus.has('__unknown__'), false);
});

test('HookBus.fold：非法返回（undefined/null）回退上一手值', () => {
  const bus = new HookBus();
  bus.register({ name: 'x', scale(v) { return v * 2; } });
  bus.register({ name: 'y', scale() { return undefined; } }); // 非法 → 保留当前
  bus.register({ name: 'z', scale() { return null; } });      // 非法 → 保留当前
  assert.equal(bus.fold('scale', 3), 6, '合法返回变换、非法返回回退');
  assert.equal(bus.fold('__missing__', 9), 9, '无任何 provider 处理时回退默认');
});

test('接线回归：遗物命中词条 poisonHitSpread 走 onProjectileHit', () => {
  const sc = buildScenario({
    seed: 'sim-hooks-hit',
    gold: 100000,
    relics: [{ id: 'venomfang', level: 2 }],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
  });
  const { sim } = sc;
  sim.time = 0;
  const target = addEnemy(sc, { x: 0, y: 0 });
  const near = addEnemy(sc, { x: 0.5, y: 0 });
  const far = addEnemy(sc, { x: 5, y: 0 });
  const proj = { towerType: 'poison', dmg: 0, ignoreArmor: false, tower: null, slow: 0, slowDur: 0, dot: 20, dotDur: 3, knockback: 0 };

  sim.hitEnemy(target, proj);
  assert.ok(Math.abs(near.poisonDps - 20 * 0.3) < EPS, '命中传播 30% 毒伤');
  assert.equal(near.poisonUntil, 3, '传播毒层时长沿用 dotDur');
  assert.equal(far.poisonDps, 0, '半径外不传播');
});

test('接线回归：遗物击杀词条 cannonKillBurst 走 onKillSettle', () => {
  const sc = buildScenario({
    seed: 'sim-hooks-kill',
    gold: 100000,
    relics: [{ id: 'siege', level: 3 }],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
  });
  const { sim } = sc;
  sim.time = 10;
  const dying = addEnemy(sc, { x: 0, y: 0 });
  const near = addEnemy(sc, { x: 0.5, y: 0 });
  const before = near.hp;

  sim.killEnemy(dying, 100);
  assert.ok(Math.abs(before - near.hp - 100 * 0.5) < EPS, '击杀对半径内造成 50% 击杀伤害');
});

test('接线回归：海克斯副作用钩子 onHit 走总线', () => {
  const hits = [];
  const sc = buildScenario({
    seed: 'sim-hooks-hex',
    gold: 100000,
    hex: {
      id: 'spy_hex',
      name: 'spy',
      hooks: {
        onHit(enemy, tower, damage) {
          hits.push({ damage });
        },
      },
    },
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
  });
  const { sim } = sc;
  const [cell] = sc.buildableCells(1);
  const tower = sc.build('arrow', cell.c, cell.r, 0);
  const enemy = addEnemy(sc, { x: 0, y: 0 });

  sim.dealDamage(enemy, 30, 'arrow', { tower });
  assert.deepEqual(hits.map((h) => h.damage), [30], '命中伤害经总线透传给海克斯 onHit');
});
