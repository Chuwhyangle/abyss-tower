// 投射物视觉：八座塔各自的程序化形态与拖尾、低配/高配预算单调、
// 未知塔型回退安全、每帧零临时对象，以及「画质不改变战斗结果」的同种子哈希回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  PROJECTILE_ART,
  PROJECTILE_KINDS,
  PROJECTILE_PROFILES,
  PROJECTILE_TEMPS_PER_FRAME,
  TOWER_PROJECTILE_FORMS,
  ProjectileRenderer,
  projectileArt,
  projectileDrawCost,
  projectileForm,
  projectileTowerForm,
} from '../public/js/render/projectile-renderer.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { TOWERS, TOWER_ORDER } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SRC = fs.readFileSync(
  new URL('../public/js/render/projectile-renderer.js', import.meta.url),
  'utf8'
);
const LOW = QUALITY_PRESETS.low;
const HIGH = QUALITY_PRESETS.high;
// 高配但关闭光晕：单独验证拖尾成本。
const HIGH_TRAIL_ONLY = { ...QUALITY_PRESETS.high, glow: false };

function kindOf(towerType) {
  return TOWER_PROJECTILE_FORMS[towerType].kind || 'bolt';
}

test('八座塔都有独立的弹道形态定义，并与模拟层 kind 对应', () => {
  assert.deepEqual(
    [...TOWER_ORDER].sort(),
    Object.keys(TOWER_PROJECTILE_FORMS).sort(),
    '每座塔都必须注册弹道形态'
  );

  for (const towerType of TOWER_ORDER) {
    const form = TOWER_PROJECTILE_FORMS[towerType];
    const def = TOWERS[towerType];
    assert.equal(form.id, towerType, `${towerType}.id 与键名不一致`);
    assert.equal(form.kind, def.proj ? def.proj.kind : null, `${towerType}.kind 与塔定义不一致`);
    assert.ok(typeof form.shape === 'string' && form.shape, `${towerType} 缺少 shape 标记`);
    assert.match(form.color, /^#[0-9a-f]{6}$/i, `${towerType}.color 必须是十六进制色`);

    assert.ok(form.body && form.trail, `${towerType} 需要弹体与拖尾定义`);
    for (const layer of ['body', 'trail']) {
      assert.ok(form[layer].w > 0 && form[layer].h > 0, `${towerType}.${layer} 尺寸非法`);
      assert.ok(form[layer].ox >= 0 && form[layer].oy >= 0, `${towerType}.${layer} 中心偏移非法`);
      assert.equal(typeof form[layer].draw, 'function', `${towerType}.${layer}.draw 缺失`);
    }
    assert.ok(form.glow, `${towerType} 缺少光晕定义`);
    assert.ok(form.glow.radius > 0 && form.glow.alpha > 0, `${towerType}.glow 参数非法`);
    assert.match(form.glow.color, /^#[0-9a-f]{6}$/i);
  }
});

test('八种形态可辨识：形状、主色、光晕色两两不同', () => {
  const shapes = new Set();
  const colors = new Set();
  const glows = new Set();
  for (const towerType of TOWER_ORDER) {
    const form = TOWER_PROJECTILE_FORMS[towerType];
    shapes.add(form.shape);
    colors.add(form.color);
    glows.add(form.glow.color);
  }
  assert.equal(shapes.size, TOWER_ORDER.length, '每种塔的形态形状必须不同');
  assert.equal(colors.size, TOWER_ORDER.length, '每种塔的主色必须不同');
  assert.equal(glows.size, TOWER_ORDER.length, '每种塔的光晕色必须不同');
});

test('高速弹道仍可读：拖尾足够长，狙击弹使用长曳光', () => {
  for (const towerType of TOWER_ORDER) {
    const form = TOWER_PROJECTILE_FORMS[towerType];
    assert.ok(form.trail.w >= 16, `${towerType} 拖尾过短，高速下不可读`);
  }
  const sniper = TOWER_PROJECTILE_FORMS.sniper;
  assert.ok(sniper.trail.w >= 32, '狙击弹需要长曳光以体现高速');
  assert.ok(sniper.trail.w > sniper.body.w, '狙击弹曳光应长于弹体');
});

test('画质预算：低配只画弹体，高配加拖尾与光晕，且低配 ≤ 高配', () => {
  assert.equal(PROJECTILE_PROFILES.low.trails, false, '低配必须关闭拖尾');
  assert.equal(PROJECTILE_PROFILES.high.trails, true, '高配保留拖尾');
  assert.ok(PROJECTILE_PROFILES.low.frameBudget <= PROJECTILE_PROFILES.high.frameBudget);

  for (const towerType of TOWER_ORDER) {
    const kind = kindOf(towerType);
    const low = projectileDrawCost(kind, PROJECTILE_PROFILES.low, LOW, towerType);
    const trailOnly = projectileDrawCost(kind, PROJECTILE_PROFILES.high, HIGH_TRAIL_ONLY, towerType);
    const high = projectileDrawCost(kind, PROJECTILE_PROFILES.high, HIGH, towerType);
    assert.equal(low, 1, `${towerType} 低配每帧只画一次弹体`);
    assert.equal(trailOnly, 2, `${towerType} 高配应多画一次拖尾`);
    assert.equal(high, 3, `${towerType} 高配 + 光晕应多画一次光晕`);
    assert.ok(low <= high);
  }
});

test('未知塔型/类型回退安全，不抛错也不误命中原型链', () => {
  assert.equal(projectileTowerForm('mystery'), null);
  assert.equal(projectileTowerForm('__proto__'), null);
  assert.equal(projectileTowerForm('toString'), null);
  assert.equal(projectileTowerForm(null), null);
  assert.equal(projectileTowerForm(42), null);

  assert.equal(projectileForm({ towerType: 'mystery', kind: 'frost' }), PROJECTILE_ART.frost);
  assert.equal(projectileForm({ kind: 'mystery' }), PROJECTILE_ART.bolt);
  assert.equal(projectileForm(null), PROJECTILE_ART.bolt);
  assert.equal(projectileArt('toString'), PROJECTILE_ART.bolt);
  assert.deepEqual(PROJECTILE_KINDS, ['shell', 'frost', 'shock', 'poison', 'bolt']);
});

function makeCtx() {
  const calls = { save: 0, restore: 0, translate: 0, rotate: 0, drawImage: 0 };
  const ctx = {
    calls,
    save() { calls.save++; },
    restore() { calls.restore++; },
    translate() { calls.translate++; },
    rotate() { calls.rotate++; },
    drawImage() { calls.drawImage++; },
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
  };
  return ctx;
}

function makeSpriteFactory() {
  const created = [];
  const factory = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return {
          scale() {}, translate() {},
          beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
          fill() {}, stroke() {},
        };
      },
    };
    created.push(canvas);
    return canvas;
  };
  factory.created = () => created;
  return factory;
}

function makeProjectiles() {
  return TOWER_ORDER.map((towerType, i) => ({
    id: i + 1,
    kind: kindOf(towerType),
    towerType,
    x: 1 + i * 0.25,
    y: 2 + (i % 3) * 0.2,
    angle: i * 0.3,
  }));
}

test('渲染循环：每种塔形态各建一次贴图，跨帧复用且绘制次数符合预算', () => {
  const projectiles = makeProjectiles();
  const factory = makeSpriteFactory();
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: factory });

  const lowCtx = makeCtx();
  renderer.render(lowCtx, LOW);
  assert.equal(renderer.drawn, projectiles.length);
  assert.equal(lowCtx.calls.drawImage, projectiles.length, '低配每弹只画弹体');
  assert.equal(factory.created().length, TOWER_ORDER.length, '低配每种塔只光栅化弹体');
  assert.equal(renderer._towerSlots.size, TOWER_ORDER.length);

  // 高配：追加每塔的拖尾贴图，且不重复创建。
  const highCtx = makeCtx();
  renderer.render(highCtx, HIGH_TRAIL_ONLY);
  assert.equal(highCtx.calls.drawImage, projectiles.length * 2, '高配每弹画拖尾与弹体');
  assert.equal(factory.created().length, TOWER_ORDER.length * 2, '高配每种塔再光栅化一次拖尾');

  renderer.render(lowCtx, LOW);
  renderer.render(highCtx, HIGH_TRAIL_ONLY);
  assert.equal(factory.created().length, TOWER_ORDER.length * 2, '跨帧不得重复创建贴图');

  // 每种塔的弹体贴图互不相同（形态确实按塔型区分）。
  const bodies = factory.created().slice(0, TOWER_ORDER.length);
  assert.equal(new Set(bodies).size, TOWER_ORDER.length, '不同塔型不得共用弹体贴图');
});

test('渲染循环：塔型层的绘制次数与单弹预算函数一致（含光晕）', () => {
  const projectiles = makeProjectiles();
  const renderer = new ProjectileRenderer(
    { projectiles },
    { glow: makeGlow(), createCanvas: makeSpriteFactory() }
  );
  const ctx = makeCtx();
  renderer.render(ctx, HIGH);

  let expected = 0;
  for (const proj of projectiles) {
    expected += projectileDrawCost(proj.kind, PROJECTILE_PROFILES.high, HIGH, proj.towerType);
  }
  assert.equal(ctx.calls.drawImage, expected);
  assert.equal(renderer.drawCalls, expected);
});

test('每帧零临时对象：槽位/贴图缓存跨帧稳定，投射物列表不被修改', () => {
  assert.equal(PROJECTILE_TEMPS_PER_FRAME, 0);
  const projectiles = makeProjectiles();
  const order = projectiles.map((p) => p.id);
  const factory = makeSpriteFactory();
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: factory });
  const ctx = makeCtx();

  renderer.render(ctx, HIGH_TRAIL_ONLY);
  const slotsBefore = [...renderer._towerSlots.entries()];
  const createdBefore = factory.created().length;

  for (let frame = 0; frame < 12; frame++) renderer.render(ctx, frame % 2 ? HIGH_TRAIL_ONLY : LOW);

  assert.equal(factory.created().length, createdBefore, '跨帧不得新建贴图');
  const slotsAfter = [...renderer._towerSlots.entries()];
  assert.equal(slotsAfter.length, slotsBefore.length);
  slotsAfter.forEach(([towerType, slot], i) => {
    assert.equal(towerType, slotsBefore[i][0]);
    assert.equal(slot, slotsBefore[i][1], '槽位对象必须复用');
  });
  assert.deepEqual(projectiles.map((p) => p.id), order, '渲染不得重排/修改投射物列表');
});

test('未知塔型投射物按 kind 兜底渲染，不抛错', () => {
  const projectiles = [
    { id: 1, kind: 'frost', towerType: 'mystery', x: 2, y: 2, angle: 0 },
    { id: 2, kind: 'mystery', towerType: 'unknown', x: 3, y: 2, angle: 0 },
    { id: 3, kind: 'mystery', x: 4, y: 2, angle: 0 },
  ];
  const factory = makeSpriteFactory();
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: factory });
  const ctx = makeCtx();
  assert.doesNotThrow(() => renderer.render(ctx, HIGH_TRAIL_ONLY));
  assert.equal(renderer.drawn, projectiles.length);
  assert.equal(ctx.calls.drawImage, projectiles.length * 2);
});

test('源码级：只依赖相对模块，不引入素材文件或随机数', () => {
  const imports = [...SRC.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const spec of imports) {
    assert.match(spec, /^\.\.?\//, `渲染层引入了第三方依赖：${spec}`);
  }
  assert.doesNotMatch(SRC, /\.(?:png|jpe?g|webp|svg|gif)\b|new\s+Image\s*\(|fetch\s*\(/, '不引入素材文件');
  assert.doesNotMatch(SRC, /Math\.random/, '渲染不得引入随机数');
  assert.doesNotMatch(SRC, /projectiles\.(push|splice|pop|shift|sort)\s*\(/, '不得修改投射物列表');
  assert.match(SRC, /TOWER_PROJECTILE_FORMS/);
  assert.match(SRC, /projectileTowerForm\(towerType\)/);
});

function makeGlow() {
  return {
    configure() {},
    // 光晕走 drawImage，计入同一帧的绘制次数。
    draw(g) {
      g.drawImage(null, 0, 0, 1, 1);
      return true;
    },
  };
}

function makeSim(visual) {
  const seed = 'projectile-visuals-determinism';
  const sim = new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: [...TOWER_ORDER],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality(visual);

  const types = ['arrow', 'cannon', 'frost', 'poison', 'shock', 'sniper'];
  let placed = 0;
  for (let r = 0; r < sim.map.rows && placed < types.length; r++) {
    for (let c = 0; c < sim.map.cols && placed < types.length; c++) {
      if (sim.canBuild(c, r) && sim.placeTower(types[placed], c, r)) placed++;
    }
  }
  assert.equal(placed, types.length, '地图上可建造格不足');

  const meta = sim.map.meta || {};
  sim.beginWave(generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  }));
  for (let i = 0; i < 900; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }
  return sim;
}

function stateHash(sim) {
  const json = JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    towers: sim.towers.map((tower) => [tower.type, tower.level, Math.round(tower.cd * 1e6), Math.round(tower.angle * 1e6)]),
    enemies: sim.enemies.map((enemy) => [
      enemy.type, Math.round(enemy.hp * 1e6), enemy.x.toFixed(6), enemy.y.toFixed(6),
    ]),
    projectiles: sim.projectiles.map((proj) => [
      proj.kind, proj.towerType, Math.round(proj.x * 1e6), Math.round(proj.y * 1e6),
    ]),
  });
  return createHash('sha256').update(json).digest('hex');
}

test('同种子下低配/高配战斗状态哈希一致', () => {
  const low = makeSim({ effects: 'off', floaters: 'off' });
  const high = makeSim({ effects: 'full', floaters: 'all' });
  assert.ok(low.projectiles.length >= 0);
  assert.equal(stateHash(low), stateHash(high), '画质档位不得改变战斗结果');
});
