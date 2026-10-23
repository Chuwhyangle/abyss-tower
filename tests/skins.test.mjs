// 塔/敌人皮肤：定义完整、未解锁不可选、默认回退，以及换肤不改变同种子战斗状态哈希。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_SKIN_BY_TARGET,
  SKINS,
  SKIN_ORDER,
  SKIN_TARGETS,
  activeSkin,
  isSkinUnlocked,
  normalizeSkinSelection,
  resetActiveSkins,
  resolveSkin,
  setActiveSkins,
  shiftSkinColor,
  skinById,
  skinCatalog,
  skinColorFor,
} from '../public/js/shared/skins.js';
import { ACHIEVEMENT_BY_ID } from '../public/js/shared/achievements.js';
import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import { Palette } from '../public/js/render/palette.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { startTestServer } from './harness.mjs';

const BATTLEFIELD = '#0a1116';
const HEX = /^#[0-9a-f]{6}$/i;

let server = null;
let cookie = '';
let accountId = '';

function api(pathname, { method = 'GET', body } = {}) {
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

async function playOneRun() {
  const started = await jsonApi('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;
  assert.equal((await jsonApi(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } })).status, 200);
  assert.equal((await jsonApi(`/api/runs/${runId}/wave`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await jsonApi(`/api/runs/${runId}/clear`, { method: 'POST', body: { wave: 1 } })).status, 200);
  const finished = await jsonApi(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 1, kills: 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  return finished;
}

function openDb() {
  const db = new DatabaseSync(server.dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  resetActiveSkins();
  await server?.stop();
});

test('皮肤定义完整：适用对象、配色参数、轮廓与解锁条件齐全', () => {
  for (const id of SKIN_ORDER) {
    const skin = SKINS[id];
    assert.equal(skin.id, id);
    assert.ok(skin.name && skin.name.trim(), `${id} 缺少名称`);
    assert.ok(SKIN_TARGETS.includes(skin.target), `${id} 适用对象非法：${skin.target}`);
    assert.ok(Object.isFrozen(skin), `${id} 定义未冻结`);
  }

  for (const target of SKIN_TARGETS) {
    const def = SKINS[DEFAULT_SKIN_BY_TARGET[target]];
    assert.ok(def, `${target} 缺少默认皮肤`);
    assert.equal(def.target, target);
    assert.equal(def.transform, null, `${target} 默认皮肤必须是恒等变换`);
    assert.equal(def.outline, null, `${target} 默认皮肤不应附加轮廓`);
    assert.equal(def.unlock, null, `${target} 默认皮肤必须人人可用`);
  }

  for (const skin of Object.values(SKINS)) {
    if (!skin.transform) continue;
    const { hueShift, saturation, lightness } = skin.transform;
    assert.ok(Number.isFinite(hueShift), `${skin.id} 色相偏移非法`);
    assert.ok(Number.isFinite(saturation) && saturation > 0, `${skin.id} 饱和度倍数非法`);
    assert.ok(Number.isFinite(lightness), `${skin.id} 明度增量非法`);
    assert.ok(skin.outline, `${skin.id} 缺少轮廓参数`);
    assert.match(skin.outline.color, HEX, `${skin.id} 轮廓颜色非法`);
    assert.ok(skin.outline.width > 0, `${skin.id} 轮廓宽度必须为正`);
    assert.ok(skin.outline.alpha > 0 && skin.outline.alpha <= 1, `${skin.id} 轮廓透明度越界`);
    assert.ok(skin.unlock?.achievement, `${skin.id} 缺少解锁成就`);
    assert.ok(
      ACHIEVEMENT_BY_ID[skin.unlock.achievement],
      `${skin.id} 引用了未知成就 ${skin.unlock.achievement}`
    );
  }

  assert.equal(skinById('no_such_skin'), null);
  assert.equal(skinById(42), null);
});

test('换肤配色可辨：每种非默认皮肤都明显偏离原色，轮廓在暗场清晰', () => {
  for (const skin of Object.values(SKINS)) {
    const defs = skin.target === 'tower' ? TOWERS : ENEMIES;
    if (!skin.transform) {
      for (const type of Object.keys(defs)) {
        const base = skin.target === 'tower'
          ? Palette.towerColor(type, {})
          : Palette.enemyColor(type, {});
        assert.equal(skinColorFor(skin, base), base, `${skin.id} 默认皮肤必须保持原色`);
      }
      continue;
    }

    for (const type of Object.keys(defs)) {
      const base = skin.target === 'tower'
        ? Palette.towerColor(type, {})
        : Palette.enemyColor(type, {});
      const shifted = skinColorFor(skin, base);
      assert.match(shifted, HEX, `${skin.id}/${type} 产出非法颜色`);
      assert.ok(
        Palette.labDistance(base, shifted) >= 8,
        `${skin.id}/${type} 与原色差异过小：${base} -> ${shifted}`
      );
      assert.equal(skinColorFor(skin, base), shifted, `${skin.id}/${type} 上色不确定`);
    }

    // 皮肤轮廓不随画质档位消失：低配暗场下仍保持足够对比。
    assert.ok(
      Palette.contrastRatio(skin.outline.color, BATTLEFIELD) >= 3,
      `${skin.id} 轮廓在暗场对比不足`
    );
  }
});

test('选择解析与默认回退：未解锁/错对象/未知 id 一律回退默认皮肤', () => {
  assert.equal(resolveSkin('tower', 'ember_tower', []).id, DEFAULT_SKIN_BY_TARGET.tower);
  assert.equal(resolveSkin('tower', 'ember_tower', ['first_run']).id, 'ember_tower');
  assert.equal(resolveSkin('tower', 'ember_tower', new Set(['first_run'])).id, 'ember_tower');
  assert.equal(resolveSkin('tower', 'frost_enemy', ['first_run']).id, DEFAULT_SKIN_BY_TARGET.tower);
  assert.equal(resolveSkin('enemy', 'no_such_skin', ['first_run']).id, DEFAULT_SKIN_BY_TARGET.enemy);
  assert.equal(isSkinUnlocked(SKINS.default_tower, []), true);
  assert.equal(isSkinUnlocked(SKINS.ember_tower, []), false);
  assert.equal(isSkinUnlocked(SKINS.ember_tower, ['first_run']), true);

  assert.deepEqual(normalizeSkinSelection(null), { ...DEFAULT_SKIN_BY_TARGET });
  // 归一化只校验 id 与适用对象；解锁状态由 resolveSkin 在读取时判定。
  assert.deepEqual(normalizeSkinSelection({ tower: 'frost_enemy', enemy: 'venom_enemy' }), {
    tower: DEFAULT_SKIN_BY_TARGET.tower,
    enemy: 'venom_enemy',
  });
  assert.deepEqual(normalizeSkinSelection({ tower: 'ember_tower', enemy: 7 }), {
    tower: 'ember_tower',
    enemy: DEFAULT_SKIN_BY_TARGET.enemy,
  });

  const catalog = skinCatalog(['first_run']);
  assert.equal(catalog.length, SKIN_ORDER.length);
  assert.equal(catalog.find((item) => item.id === 'ember_tower').unlocked, true);
  assert.equal(catalog.find((item) => item.id === 'abyss_tower').unlocked, false);
  assert.equal(catalog.find((item) => item.id === 'ember_tower').achievementId, 'first_run');
});

function stateHash(selection) {
  if (selection) setActiveSkins(selection);
  else resetActiveSkins();

  const seed = 'skins-determinism';
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

  const towerSkin = activeSkin('tower');
  const enemySkin = activeSkin('enemy');
  for (let i = 0; i < 600; i++) {
    // 每帧解析皮肤颜色，证明这条路径只读且不触碰模拟状态。
    for (const type of Object.keys(TOWERS)) skinColorFor(towerSkin, Palette.towerColor(type, {}));
    for (const type of Object.keys(ENEMIES)) skinColorFor(enemySkin, Palette.enemyColor(type, {}));
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

test('同种子战斗状态哈希不受皮肤选择影响', () => {
  const baseline = stateHash(null);
  assert.equal(stateHash({ tower: 'ember_tower', enemy: 'venom_enemy' }), baseline);
  assert.equal(stateHash({ tower: 'abyss_tower', enemy: 'spectral_enemy' }), baseline);
  assert.equal(stateHash({ tower: 'aurora_tower', enemy: 'frost_enemy' }), baseline);
  resetActiveSkins();
});

test('未登录不能读取或修改皮肤', async () => {
  assert.equal((await api('/api/profile/skins')).status, 401);
  assert.equal(
    (await api('/api/profile/skins', { method: 'PUT', body: { tower: 'default_tower' } })).status,
    401
  );
});

test('新账号默认皮肤可用，其余皮肤锁定且不可选', async () => {
  const username = `skin${Date.now().toString(36).slice(-8)}`;
  const registered = await register(username);
  cookie = registered.cookie;
  accountId = registered.accountId;
  assert.ok(accountId);

  const { status, data } = await jsonApi('/api/profile/skins');
  assert.equal(status, 200);
  assert.deepEqual(data.selected, { tower: 'default_tower', enemy: 'default_enemy' });
  assert.equal(data.skins.length, SKIN_ORDER.length);
  for (const item of data.skins) {
    assert.ok(SKIN_TARGETS.includes(item.target));
    assert.equal(typeof item.unlocked, 'boolean');
    if (!item.id.startsWith('default_')) {
      assert.equal(item.unlocked, false, `${item.id} 不应在新账号解锁`);
      assert.equal(typeof item.achievementId, 'string');
    } else {
      assert.equal(item.unlocked, true, `${item.id} 应默认解锁`);
    }
  }

  const locked = await jsonApi('/api/profile/skins', { method: 'PUT', body: { tower: 'ember_tower' } });
  assert.equal(locked.status, 403);
  assert.equal(locked.data.code, 'SKIN_LOCKED');

  const unknown = await jsonApi('/api/profile/skins', { method: 'PUT', body: { tower: 'no_such_skin' } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.code, 'UNKNOWN_SKIN');

  const mismatch = await jsonApi('/api/profile/skins', { method: 'PUT', body: { enemy: 'ember_tower' } });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.data.code, 'SKIN_TARGET_MISMATCH');

  const invalid = await jsonApi('/api/profile/skins', { method: 'PUT', body: { tower: 42 } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_SKIN');

  const empty = await jsonApi('/api/profile/skins', { method: 'PUT', body: {} });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.code, 'NO_SKIN_CHANGES');

  const after = await jsonApi('/api/profile/skins');
  assert.deepEqual(after.data.selected, { tower: 'default_tower', enemy: 'default_enemy' });

  const explicitDefault = await jsonApi('/api/profile/skins', {
    method: 'PUT',
    body: { tower: 'default_tower' },
  });
  assert.equal(explicitDefault.status, 200);
  assert.deepEqual(explicitDefault.data.selected, {
    tower: 'default_tower',
    enemy: 'default_enemy',
  });
});

test('解锁成就后皮肤可选，选择写入 cosmetics 存储并可回退默认', async () => {
  await playOneRun();

  const listed = await jsonApi('/api/profile/skins');
  const ember = listed.data.skins.find((item) => item.id === 'ember_tower');
  assert.equal(ember.unlocked, true, '首次远征应解锁余烬塔体');
  const frost = listed.data.skins.find((item) => item.id === 'frost_enemy');
  assert.equal(frost.unlocked, true, '首次远征应解锁霜噬敌群');

  const selected = await jsonApi('/api/profile/skins', {
    method: 'PUT',
    body: { tower: 'ember_tower', enemy: 'frost_enemy' },
  });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.data.selected, { tower: 'ember_tower', enemy: 'frost_enemy' });

  const reread = await jsonApi('/api/profile/skins');
  assert.deepEqual(reread.data.selected, { tower: 'ember_tower', enemy: 'frost_enemy' });

  const db = openDb();
  try {
    const row = db
      .prepare('SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?')
      .get(accountId, 'cosmetics', 'selected_skin');
    assert.ok(row, 'player_kv 缺少 selected_skin 记录');
    assert.deepEqual(JSON.parse(row.value_json), { tower: 'ember_tower', enemy: 'frost_enemy' });
  } finally {
    db.close();
  }

  const unequipped = await jsonApi('/api/profile/skins', { method: 'PUT', body: { tower: null } });
  assert.equal(unequipped.status, 200);
  assert.deepEqual(unequipped.data.selected, {
    tower: 'default_tower',
    enemy: 'frost_enemy',
  });

  // 损坏的选择记录回退默认，而不是让接口报错。
  const corrupt = openDb();
  try {
    corrupt
      .prepare('UPDATE player_kv SET value_json = ? WHERE account_id = ? AND namespace = ? AND key = ?')
      .run('not-json', accountId, 'cosmetics', 'selected_skin');
  } finally {
    corrupt.close();
  }
  const fallback = await jsonApi('/api/profile/skins');
  assert.equal(fallback.status, 200);
  assert.deepEqual(fallback.data.selected, { tower: 'default_tower', enemy: 'default_enemy' });
});
