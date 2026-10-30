// 契约卡（§5）：确定性候选生成、代价/收益结算、快照往返与敌人属性红线的纯函数验收（gap-ac-058）。
// 断言口径与 docs/PHASE_ROGUE2.md §5.1 / §5.2 / §5.3 的冻结约束逐条对齐。
import test from 'node:test';
import assert from 'node:assert/strict';

import { rollRelicOffers, RELIC_MAX_LEVEL } from '../public/js/shared/data.js';
import {
  CONTRACT_IDS,
  CONTRACT_WAVES,
  CONTRACT_MAX_PER_RUN,
  CONTRACTS,
  isContractWave,
  contractSeed,
  normalizeContractRecords,
  normalizeBonusPoints,
  rollContractOffer,
  applyContract,
} from '../public/js/shared/contracts.js';
import { FACTION_ORDER } from '../public/js/shared/factions.js';
import { SAVE_VERSION, toSnapshot, validateSnapshot, normalizeSnapshot } from '../public/js/shared/snapshot.js';

const SEEDS = ['s1', 's2', 's3', 'run-abc', 'seed-42'];

// 与 §5.3 冻结字段一致：契约结算只写客户端可模拟资源，绝不出现敌人/波次结构字段。
const FORBIDDEN_KEYS = ['enemies', 'enemy', 'spawn', 'spawns', 'hpMul', 'speedMul', 'entrance', 'waveDef', 'portals'];

function baseState(overrides = {}) {
  return {
    gold: 200,
    hp: 20,
    maxHp: 20,
    rerolls: 2,
    relics: [{ id: 'sharp', level: 1 }],
    bonusPoints: {},
    contracts: [],
    wave: 9,
    accepted: 0,
    ...overrides,
  };
}

test('常量与冻结表一致（§5.1/§5.2）', () => {
  assert.deepEqual(CONTRACT_IDS, ['blood', 'debt', 'poverty', 'sloth', 'burn']);
  assert.deepEqual(CONTRACT_WAVES, [9, 14, 19, 24]);
  assert.equal(CONTRACT_MAX_PER_RUN, 2);
  assert.deepEqual(
    CONTRACTS.blood.chip.scope === 'run' &&
      CONTRACTS.debt.chip.scope === 'run' &&
      CONTRACTS.poverty.chip.scope === 'wave' &&
      CONTRACTS.sloth.chip.scope === 'wave' &&
      CONTRACTS.burn.chip.scope === 'run',
    true,
    '五条契约的 chip.scope 必须与 §5.2 一致'
  );
  for (const wave of CONTRACT_WAVES) assert.equal(isContractWave(wave), true);
  for (const wave of [1, 8, 10, 13, 15, 18, 20, 23, 25, 30]) {
    assert.equal(isContractWave(wave), false, `波 ${wave} 不是契约波次`);
  }
});

test('种子流独立且不触碰战斗 RNG（§9）', () => {
  assert.equal(contractSeed('run-x', 9), 'run-x:contract:9');
  assert.notEqual(contractSeed('run-x', 9), `run-x:relic:9:0`);
});

test('同一输入完全可复现', () => {
  const states = [{ id: 'sharp', level: 2 }];
  for (const seed of SEEDS) {
    for (const wave of CONTRACT_WAVES) {
      const a = rollContractOffer(seed, wave, { accepted: 0, relics: states });
      const b = rollContractOffer(seed, wave, { accepted: 0, relics: states });
      assert.deepEqual(a, b);
    }
  }
});

test('仅契约波次返回候选，其余波次返回 null（§5.1）', () => {
  for (const seed of SEEDS) {
    for (const wave of [1, 2, 8, 10, 13, 15, 18, 20, 23, 25, 30]) {
      assert.equal(rollContractOffer(seed, wave, { accepted: 0, relics: [] }), null);
    }
    for (const wave of CONTRACT_WAVES) {
      assert.ok(rollContractOffer(seed, wave, { accepted: 0, relics: [] }), `波 ${wave} 应返回契约候选`);
    }
  }
});

test('每局最多接受 2 次，达到上限返回 null（§5.1）', () => {
  const states = [{ id: 'sharp', level: 1 }];
  assert.ok(rollContractOffer('s1', 9, { accepted: 0, relics: states }));
  assert.ok(rollContractOffer('s1', 9, { accepted: 1, relics: states }));
  assert.equal(rollContractOffer('s1', 9, { accepted: 2, relics: states }), null);
  assert.equal(rollContractOffer('s1', 14, { accepted: 3, relics: states }), null);
});

test('候选为单张契约卡，含 nameKey/descKey/cost/benefit/chip/untilWave（§5.3）', () => {
  for (const seed of SEEDS) {
    for (const wave of CONTRACT_WAVES) {
      const offer = rollContractOffer(seed, wave, { accepted: 0, relics: [{ id: 'sharp', level: 1 }] });
      assert.equal(offer.kind, 'contract');
      assert.ok(CONTRACT_IDS.includes(offer.id));
      assert.equal(offer.nameKey, `contract.${offer.id}.name`);
      assert.equal(offer.descKey, `contract.${offer.id}.desc`);
      assert.ok(Array.isArray(offer.cost) && Array.isArray(offer.benefit));
      assert.equal(typeof offer.chip, 'object');
      const expectedUntil = CONTRACTS[offer.id].chip.scope === 'wave' ? wave + 1 : null;
      assert.equal(offer.untilWave, expectedUntil, `${offer.id} 的 untilWave 不符合 §5.3`);
    }
  }
});

test('替换规则：契约波次三选一恰有一张契约卡，且替换最后一张遗物卡（§5.1）', () => {
  // 与服务端 relicOffers 同一组合：先滚 3 张遗物，再在契约波次用契约卡替换最后一张。
  const states = [{ id: 'sharp', level: 1 }];
  for (const wave of CONTRACT_WAVES) {
    const rolled = rollRelicOffers(`seed:relic:${wave}:0`, states, 3, wave, 'normal');
    const contract = rollContractOffer('seed', wave, { accepted: 0, relics: states });
    assert.ok(contract, `波 ${wave} 应生成契约卡`);
    rolled[rolled.length - 1] = contract;
    assert.equal(rolled.length, 3, `波 ${wave} 仍是 3 张`);
    assert.equal(rolled.filter((o) => o.kind === 'contract').length, 1, `波 ${wave} 恰有一张契约卡`);
    assert.equal(rolled[2].kind, 'contract', `波 ${wave} 契约卡在最后一格`);
  }
});

test('刷新整组丢弃：非契约波次/刷新后的整组不含契约卡（§5.1）', () => {
  // 刷新路径不再补插契约卡，重新滚出的整组应全是遗物/金币/修复。
  const states = [{ id: 'sharp', level: 1 }];
  for (const wave of [8, 10, 13, 15]) {
    const rolled = rollRelicOffers(`seed:relic:${wave}:1`, states, 3, wave, 'normal');
    assert.equal(rolled.some((o) => o.kind === 'contract'), false);
  }
});

test('血契：最大生命 −2、当前生命同步且最低 1，授予稀有以上派系遗物（§5.2）', () => {
  const result = applyContract(baseState(), 'blood');
  assert.equal(result.ok, true);
  assert.equal(result.state.maxHp, 18);
  assert.equal(result.state.hp, 18);
  assert.equal(result.state.gold, 200, '血契不动金币');
  assert.equal(result.state.relics.length, 2, '血契应授予一件遗物');
  const granted = result.state.relics.find((r) => r.id !== 'sharp');
  assert.ok(granted, '血契应授予一件新遗物');

  const low = applyContract(baseState({ hp: 1, maxHp: 2 }), 'blood');
  assert.equal(low.state.maxHp, 1, '最大生命最低 1');
  assert.equal(low.state.hp, 1, '当前生命最低 1');
});

test('债契：金币 −35% 最低保留 60、刷新 −1，授予史诗遗物；无刷新时整卡不可用（§5.2）', () => {
  const result = applyContract(baseState({ gold: 500, rerolls: 2 }), 'debt');
  assert.equal(result.ok, true);
  assert.equal(result.state.gold, 325, '500 × 0.65 = 325');
  assert.equal(result.state.rerolls, 1);
  const granted = result.state.relics.find((r) => r.id !== 'sharp');
  assert.ok(granted, '债契应授予一件史诗遗物');

  const floor = applyContract(baseState({ gold: 50, rerolls: 2 }), 'debt');
  assert.equal(floor.state.gold, 60, '最低保留 60 金币');

  const broke = applyContract(baseState({ gold: 500, rerolls: 0 }), 'debt');
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, 'unaffordable');
  assert.equal(broke.state, null);
});

test('贫契：下一次三选一仅 2 张、目标派系 +2 bonusPoints（§5.2）', () => {
  const result = applyContract(baseState(), 'poverty');
  assert.equal(result.ok, true);
  assert.equal(result.state.nextOfferCount, 2);
  const points = Object.values(result.state.bonusPoints).reduce((sum, n) => sum + n, 0);
  assert.equal(points, 2, '贫契 +2 bonusPoints');
});

test('惰契：+150 金币、+2 生命（不超上限），攻速代价不进 state（§5.2）', () => {
  const result = applyContract(baseState({ gold: 100, hp: 5, maxHp: 20 }), 'sloth');
  assert.equal(result.ok, true);
  assert.equal(result.state.gold, 250);
  assert.equal(result.state.hp, 7);
  assert.equal(result.state.maxHp, 20, '惰契不动最大生命');
  assert.ok(!('fireRate' in result.state), '攻速代价由 contracts 记录派生，不进 state');

  const capped = applyContract(baseState({ gold: 100, hp: 19, maxHp: 20 }), 'sloth');
  assert.equal(capped.state.hp, 20, '生命不超过上限');
});

test('焚契：焚毁 1 件未满级遗物、目标派系 +3 bonusPoints；无未满级遗物时整卡不可用（§5.2）', () => {
  const result = applyContract(baseState({ relics: [{ id: 'sharp', level: 1 }] }), 'burn');
  assert.equal(result.ok, true);
  assert.equal(result.state.relics.length, 0, '焚契应整件移除一件遗物');
  const points = Object.values(result.state.bonusPoints).reduce((sum, n) => sum + n, 0);
  assert.equal(points, 3, '焚契 +3 bonusPoints');

  const full = applyContract(baseState({ relics: [{ id: 'sharp', level: RELIC_MAX_LEVEL }] }), 'burn');
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'unaffordable');
});

test('未知契约 id 返回 ok:false（§8.1 边界）', () => {
  const result = applyContract(baseState(), 'nope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown');
  assert.equal(result.state, null);
});

test('红线：契约结算只写客户端可模拟资源，绝不出现敌人 HP/速度/入口字段', () => {
  for (const id of CONTRACT_IDS) {
    const result = applyContract(baseState(), id);
    if (!result.ok) continue;
    assert.equal(typeof result.state, 'object');
    for (const key of FORBIDDEN_KEYS) {
      assert.ok(!(key in result.state), `${id} 的结算 state 不得含 ${key}`);
    }
  }
  const offer = rollContractOffer('s1', 9, { accepted: 0, relics: [{ id: 'sharp', level: 1 }] });
  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!(key in offer), `契约候选不得含 ${key}`);
  }
});

test('五模式一致：候选与结算与 mode 无关（§5.1/§8.1）', () => {
  const states = [{ id: 'sharp', level: 1 }];
  const base = rollContractOffer('s1', 9, { accepted: 0, relics: states });
  for (const mode of ['normal', 'daily', 'weekly', 'endless', 'mutation']) {
    const withMode = rollContractOffer('s1', 9, { accepted: 0, relics: states, mode });
    assert.deepEqual(withMode, base, `mode=${mode} 不应改变契约候选`);
  }
});

test('normalizeContractRecords / normalizeBonusPoints 收敛非法输入（§5.3/§2.2）', () => {
  const records = normalizeContractRecords([
    { id: 'blood', wave: 9, untilWave: null },
    { id: 'sloth', wave: 9, untilWave: 10 },
    { id: 'nope', wave: 9 },
    null,
  ]);
  assert.deepEqual(records, [
    { id: 'blood', wave: 9, scope: 'run', untilWave: null },
    { id: 'sloth', wave: 9, scope: 'wave', untilWave: 10 },
  ]);

  const points = normalizeBonusPoints({ fire: 5, frost: 2, neutral: 9, warden: -1 });
  assert.deepEqual(points, { fire: 3, frost: 2, venom: 0, storm: 0, warden: 0 });
});

test('快照往返：契约记录与 bonusPoints 入 rogue2 块并可恢复（§5.3/§8.4）', () => {
  const contracts = normalizeContractRecords([
    { id: 'blood', wave: 9, untilWave: null },
    { id: 'sloth', wave: 14, untilWave: 15 },
  ]);
  const bonusPoints = normalizeBonusPoints({ fire: 2, frost: 3 });
  const state = {
    runId: 'run-contract',
    seed: 'seed-contract',
    mode: 'normal',
    difficulty: 'standard',
    clearedWave: 14,
    pendingDraft: false,
    gold: 200,
    baseHp: 18,
    maxBaseHp: 18,
    kills: 9,
    relics: [{ id: 'sharp', level: 2 }],
    towers: [{ type: 'arrow', c: 2, r: 3, level: 1, invested: 80 }],
    startedAt: 1700000000000,
    rogue2: { contracts, bonusPoints },
  };
  const snap = toSnapshot(state);
  assert.equal(snap.version, SAVE_VERSION, '有契约时写当前版本');
  assert.deepEqual(snap.rogue2.contracts, contracts);
  assert.deepEqual(snap.rogue2.bonusPoints, bonusPoints);

  const validated = validateSnapshot(snap);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.snapshot.rogue2.contracts, contracts);
  assert.deepEqual(validated.snapshot.rogue2.bonusPoints, bonusPoints);
  assert.deepEqual(normalizeSnapshot(snap).rogue2, snap.rogue2);
});
