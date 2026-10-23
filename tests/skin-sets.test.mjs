// 皮肤套装：定义完整、解锁进度可计算、默认回退，以及切换套装不改变同种子战斗状态哈希。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIN_SETS,
  SKIN_SET_ORDER,
  SKIN_TARGETS,
  isSkinSetMemberUnlocked,
  resolveSkinSetMember,
  skinColorFor,
  skinSetById,
  skinSetCatalog,
  skinSetColorFor,
  skinSetMember,
  skinSetMembers,
  skinSetProgress,
} from '../public/js/shared/skins.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../public/js/shared/achievements.js';
import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import { Palette } from '../public/js/render/palette.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { startTestServer } from './harness.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const BATTLEFIELD = '#0a1116';
const ALL_ACHIEVEMENTS = ACHIEVEMENTS.map((achievement) => achievement.id);

let server = null;

function api(pathname, { method = 'GET', body, cookie = '' } = {}) {
  return fetch(`${server.base}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function jsonApi(pathname, options) {
  const response = await api(pathname, options);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function register(username) {
  const response = await fetch(`${server.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'rtd-test-password' }),
  });
  const data = await response.json();
  assert.equal(response.status, 201, `注册失败：${JSON.stringify(data)}`);
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return { cookie: setCookie.split(';')[0], accountId: data.profile.accountId };
}

async function playOneRun(cookie) {
  const started = await jsonApi('/api/runs', {
    method: 'POST',
    cookie,
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;
  assert.equal((await jsonApi(`/api/runs/${runId}/map`, { method: 'POST', cookie, body: { index: 0 } })).status, 200);
  assert.equal((await jsonApi(`/api/runs/${runId}/wave`, { method: 'POST', cookie, body: {} })).status, 200);
  assert.equal((await jsonApi(`/api/runs/${runId}/clear`, { method: 'POST', cookie, body: { wave: 1 } })).status, 200);
  const finished = await jsonApi(`/api/runs/${runId}/finish`, {
    method: 'POST',
    cookie,
    body: { waveReached: 1, kills: 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  return finished;
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server?.stop();
});

test('套装定义完整：两套各覆盖 3–4 座塔与 2 类敌人', () => {
  assert.deepEqual([...SKIN_SET_ORDER], ['molten', 'frost']);

  for (const id of SKIN_SET_ORDER) {
    const set = SKIN_SETS[id];
    assert.equal(set.id, id);
    assert.ok(set.name && set.name.trim(), `${id} 缺少名称`);
    assert.ok(set.description && set.description.trim(), `${id} 缺少描述`);
    assert.match(set.accent, HEX, `${id} 主题色非法`);
    assert.match(set.glow, HEX, `${id} 辉光色非法`);
    assert.ok(Object.isFrozen(set), `${id} 定义未冻结`);
    assert.ok(Object.isFrozen(set.members), `${id} 成员表未冻结`);

    const towerTypes = Object.keys(set.members.tower);
    const enemyTypes = Object.keys(set.members.enemy);
    assert.ok(towerTypes.length >= 3 && towerTypes.length <= 4, `${id} 塔数量越界：${towerTypes.length}`);
    assert.equal(enemyTypes.length, 2, `${id} 敌人数量应为 2`);

    for (const type of towerTypes) assert.ok(TOWERS[type], `${id} 引用了未知塔 ${type}`);
    for (const type of enemyTypes) assert.ok(ENEMIES[type], `${id} 引用了未知敌人 ${type}`);

    for (const target of SKIN_TARGETS) {
      for (const member of Object.values(set.members[target])) {
        assert.equal(member.setId, id);
        assert.equal(member.target, target);
        assert.equal(member.id, `${id}_${member.type}`);
        assert.ok(member.name && member.name.trim(), `${member.id} 缺少名称`);
        assert.ok(Object.isFrozen(member), `${member.id} 未冻结`);
        assert.equal(member.transform.hueShift !== undefined, true, `${member.id} 缺少色相偏移`);
        assert.ok(member.transform.saturation > 0, `${member.id} 饱和度倍数非法`);
        assert.ok(Number.isFinite(member.transform.lightness), `${member.id} 明度增量非法`);
        assert.match(member.outline.color, HEX, `${member.id} 轮廓颜色非法`);
        assert.ok(member.outline.width > 0, `${member.id} 轮廓宽度必须为正`);
        assert.ok(member.outline.alpha > 0 && member.outline.alpha <= 1, `${member.id} 轮廓透明度越界`);
        assert.ok(
          ACHIEVEMENT_BY_ID[member.unlock.achievement],
          `${member.id} 引用了未知成就 ${member.unlock.achievement}`
        );
      }
    }

    assert.equal(skinSetMembers(set).length, towerTypes.length + enemyTypes.length);
    assert.equal(skinSetMember(id, 'tower', towerTypes[0]).type, towerTypes[0]);
  }

  assert.equal(skinSetById('no_such_set'), null);
  assert.equal(skinSetById(42), null);
  assert.equal(skinSetMember('no_such_set', 'tower', 'arrow'), null);
  assert.equal(skinSetMember('molten', 'tower', 'no_such_tower'), null);
  assert.deepEqual(skinSetMembers('no_such_set'), []);
});

test('解锁条件可计算：按成员成就计数，未知/未解锁成员回退默认', () => {
  for (const id of SKIN_SET_ORDER) {
    const set = SKIN_SETS[id];
    const members = skinSetMembers(set);

    const empty = skinSetProgress(set, []);
    assert.deepEqual(empty, { unlocked: 0, total: members.length, ratio: 0, complete: false });
    assert.equal(skinSetProgress(id, []).total, members.length);

    const first = members[0];
    const expected = members.filter(
      (member) => member.unlock.achievement === first.unlock.achievement
    ).length;
    const partial = skinSetProgress(set, [first.unlock.achievement]);
    assert.equal(partial.unlocked, expected);
    assert.equal(partial.complete, false);
    assert.ok(partial.ratio > 0 && partial.ratio < 1);

    const full = skinSetProgress(set, ALL_ACHIEVEMENTS);
    assert.deepEqual(full, { unlocked: members.length, total: members.length, ratio: 1, complete: true });

    assert.equal(isSkinSetMemberUnlocked(first, []), false);
    assert.equal(isSkinSetMemberUnlocked(first, new Set([first.unlock.achievement])), true);
    assert.equal(isSkinSetMemberUnlocked(null, ALL_ACHIEVEMENTS), false);

    assert.equal(resolveSkinSetMember(id, first.target, first.type, []), null);
    assert.equal(resolveSkinSetMember(id, first.target, first.type, ALL_ACHIEVEMENTS).id, first.id);
    assert.equal(resolveSkinSetMember('no_such_set', first.target, first.type, ALL_ACHIEVEMENTS), null);
    assert.equal(resolveSkinSetMember(id, first.target, 'no_such_type', ALL_ACHIEVEMENTS), null);
  }

  const lockedCatalog = skinSetCatalog([]);
  assert.equal(lockedCatalog.length, SKIN_SET_ORDER.length);
  for (const entry of lockedCatalog) {
    assert.equal(entry.unlocked, false);
    assert.equal(entry.progress.unlocked, 0);
    assert.equal(entry.progress.complete, false);
    assert.ok(entry.requirements.length > 0);
    for (const requirement of entry.requirements) {
      assert.ok(ACHIEVEMENT_BY_ID[requirement.id], `未知获取条件 ${requirement.id}`);
      assert.ok(requirement.title && requirement.title.trim());
    }
    for (const member of entry.members) {
      assert.equal(member.unlocked, false);
      assert.equal(typeof member.achievementId, 'string');
      assert.equal(typeof member.achievementTitle, 'string');
      assert.match(member.outline.color, HEX);
    }
  }

  const fullCatalog = skinSetCatalog(ALL_ACHIEVEMENTS);
  for (const entry of fullCatalog) {
    assert.equal(entry.unlocked, true);
    assert.equal(entry.progress.complete, true);
    assert.equal(entry.progress.ratio, 1);
    assert.equal(entry.members.length, entry.progress.total);
    for (const member of entry.members) {
      assert.equal(member.unlocked, true);
      assert.equal(typeof member.achievementTitle, 'string');
    }
  }
});

test('套装配色可辨，默认回退保持原色', () => {
  for (const id of SKIN_SET_ORDER) {
    const set = SKIN_SETS[id];
    for (const target of SKIN_TARGETS) {
      const defs = target === 'tower' ? TOWERS : ENEMIES;
      for (const member of Object.values(set.members[target])) {
        const base =
          target === 'tower' ? Palette.towerColor(member.type, {}) : Palette.enemyColor(member.type, {});
        const shifted = skinSetColorFor(id, target, member.type, base, ALL_ACHIEVEMENTS);
        assert.match(shifted, HEX, `${member.id} 产出非法颜色`);
        assert.ok(
          Palette.labDistance(base, shifted) >= 8,
          `${member.id} 与原色差异过小：${base} -> ${shifted}`
        );
        assert.ok(
          Palette.contrastRatio(member.outline.color, BATTLEFIELD) >= 3,
          `${member.id} 轮廓在暗场对比不足`
        );
        assert.equal(
          skinSetColorFor(id, target, member.type, base, ALL_ACHIEVEMENTS),
          shifted,
          `${member.id} 上色不确定`
        );
      }
    }
  }

  // 未知套装/类型与未解锁成员都走恒等变换，调用方无需分支。
  assert.equal(skinSetColorFor('no_such_set', 'tower', 'arrow', '#123456'), '#123456');
  assert.equal(skinSetColorFor('molten', 'tower', 'no_such_tower', '#123456'), '#123456');
  const locked = skinSetMember('molten', 'tower', 'arrow');
  assert.equal(skinColorFor(resolveSkinSetMember('molten', 'tower', 'arrow', []), '#123456'), '#123456');
  assert.notEqual(skinColorFor(locked, '#123456'), '#123456');
});

function stateHash(setId) {
  const seed = 'skin-sets-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 300,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow'],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({ effects: 'full', floaters: 'all' });
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);

  for (let i = 0; i < 600; i++) {
    if (setId) {
      // 每帧解析套装成员颜色，证明这条路径只读且不触碰模拟状态。
      for (const target of SKIN_TARGETS) {
        const defs = target === 'tower' ? TOWERS : ENEMIES;
        for (const type of Object.keys(defs)) {
          const base = target === 'tower' ? Palette.towerColor(type, {}) : Palette.enemyColor(type, {});
          skinSetColorFor(setId, target, type, base, ALL_ACHIEVEMENTS);
        }
      }
    }
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }

  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    enemies: sim.enemies.map((enemy) => [
      enemy.type,
      Math.round(enemy.hp * 1e6),
      enemy.x.toFixed(6),
      enemy.y.toFixed(6),
    ]),
  });
}

test('切换套装不改变同种子战斗状态哈希', () => {
  const baseline = stateHash(null);
  for (const id of SKIN_SET_ORDER) {
    assert.equal(stateHash(id), baseline, `套装 ${id} 改变了战斗状态`);
  }
});

test('皮肤接口下发套装画廊数据，解锁进度随成就更新', async () => {
  const username = `sets${Date.now().toString(36).slice(-8)}`;
  const registered = await register(username);
  assert.ok(registered.accountId);

  const listed = await jsonApi('/api/profile/skins', { cookie: registered.cookie });
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.data.sets), '响应缺少 sets 字段');
  assert.equal(listed.data.sets.length, SKIN_SET_ORDER.length);
  for (const entry of listed.data.sets) {
    assert.equal(entry.unlocked, false);
    assert.equal(entry.progress.unlocked, 0);
    assert.ok(entry.members.length >= 5);
    for (const member of entry.members) {
      assert.equal(member.unlocked, false);
      assert.equal(typeof member.achievementTitle, 'string');
    }
  }

  await playOneRun(registered.cookie);

  const unlocked = await jsonApi('/api/profile/skins', { cookie: registered.cookie });
  assert.equal(unlocked.status, 200);
  const molten = unlocked.data.sets.find((entry) => entry.id === 'molten');
  const arrow = molten.members.find((member) => member.type === 'arrow');
  assert.equal(arrow.unlocked, true, '首次远征应解锁熔火·弩塔');
  assert.ok(molten.progress.unlocked >= 1);
  assert.equal(molten.progress.complete, false);
});
