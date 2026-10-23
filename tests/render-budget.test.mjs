// 渲染预算：投射物分桶批量绘制/贴图缓存/低配降级/零临时对象，以及技能特效的粒子预算。
// 断言的是渲染层自身的预算函数与绘制次数，不改变模拟、伤害或随机数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { skillStats } from '../public/js/shared/data.js';
import { GlowRenderer } from '../public/js/render/glow-renderer.js';
import { SkillRenderer } from '../public/js/render/skill-renderer.js';
import {
  PROJECTILE_ART,
  PROJECTILE_KINDS,
  PROJECTILE_PROFILES,
  PROJECTILE_TEMPS_PER_FRAME,
  ProjectileRenderer,
  frameDrawCalls,
  projectileArt,
  projectileDrawCost,
  projectileProfile,
} from '../public/js/render/projectile-renderer.js';

const SRC = fs.readFileSync(
  new URL('../public/js/render/projectile-renderer.js', import.meta.url),
  'utf8'
);
const SKILL_SRC = fs.readFileSync(
  new URL('../public/js/render/skill-renderer.js', import.meta.url),
  'utf8'
);

// 技能渲染在 Node 下不碰 document（纹理预烘焙在无 DOM 时跳过），可直接实例化。
function makeSkillGame(overrides = {}) {
  return {
    seed: 'budget:1',
    time: 0,
    skill: null,
    skillFx: [],
    stasis: null,
    map: { cols: 20, rows: 12, base: { x: 10, y: 6 } },
    enemies: [],
    towers: [],
    ...overrides,
  };
}

function makeSkill(settings) {
  return new SkillRenderer(makeSkillGame(), { settings });
}

// 宽松 Canvas 2D 替身：任何未显式定义的方法都是空操作，属性可读写。
function makeAnyCtx() {
  const calls = { drawImage: 0, fill: 0, stroke: 0, fillRect: 0, arc: 0 };
  const overrides = {};
  for (const key of Object.keys(calls)) overrides[key] = () => { calls[key]++; };
  return new Proxy(calls, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

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
  let created = 0;
  const factory = () => {
    created++;
    return {
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
  };
  factory.created = () => created;
  return factory;
}

function makeGlow() {
  return new GlowRenderer({ createSprite: (color) => ({ color }), capacity: 24 });
}

function makeProjectiles(perKind = 2) {
  const list = [];
  let n = 0;
  for (const kind of PROJECTILE_KINDS) {
    for (let i = 0; i < perKind; i++) {
      list.push({ id: ++n, kind, x: 1 + n * 0.25, y: 2 + n * 0.1, angle: n * 0.3 });
    }
  }
  return list;
}

const LOW = QUALITY_PRESETS.low;
const HIGH = QUALITY_PRESETS.high;
// 高配但关闭光晕：单独验证拖尾成本。
const HIGH_BASIC = { ...QUALITY_PRESETS.high, glow: false };

test('画质档位：低配关闭拖尾，绘制预算不高于高配', () => {
  const low = projectileProfile(LOW);
  const high = projectileProfile(HIGH);
  assert.equal(low, PROJECTILE_PROFILES.low);
  assert.equal(high, PROJECTILE_PROFILES.high);
  assert.equal(projectileProfile(undefined), PROJECTILE_PROFILES.low);
  assert.equal(projectileProfile({}), PROJECTILE_PROFILES.low);
  assert.equal(projectileProfile({ decorations: 'light', glow: true, dpr: 1 }).tier, 'low');
  assert.equal(projectileProfile({ decorations: 'light', glow: true, dpr: 2 }).tier, 'high');

  assert.equal(low.trails, false, '低配必须关闭拖尾');
  assert.equal(high.trails, true, '高配保留拖尾');
  assert.ok(low.frameBudget <= high.frameBudget);
  assert.ok(low.layers < high.layers);
});

test('单弹绘制成本：低配 ≤ 高配，光晕只给有光晕的形态', () => {
  for (const kind of PROJECTILE_KINDS) {
    for (const settings of [LOW, HIGH, { glow: false }, { glow: true, decorations: 'light' }]) {
      const low = projectileDrawCost(kind, PROJECTILE_PROFILES.low, settings);
      const high = projectileDrawCost(kind, PROJECTILE_PROFILES.high, settings);
      assert.ok(low >= 1, `${kind} 至少画一次弹体`);
      assert.ok(low <= high, `${kind} 低配绘制成本 ${low} 不应高于高配 ${high}`);
    }
    // 低配只画弹体贴图；高配再加一次拖尾。
    assert.equal(projectileDrawCost(kind, PROJECTILE_PROFILES.low, LOW), 1);
    assert.equal(projectileDrawCost(kind, PROJECTILE_PROFILES.high, HIGH_BASIC), 2);
  }
  // 高配 + 光晕：除箭矢外每个形态多一次光晕贴图。
  assert.equal(projectileDrawCost('shell', PROJECTILE_PROFILES.high, HIGH), 3);
  assert.equal(projectileDrawCost('bolt', PROJECTILE_PROFILES.high, HIGH), 2);
  assert.equal(projectileDrawCost('unknown-kind', PROJECTILE_PROFILES.high, HIGH), 2);
});

test('每帧绘制调用预算函数：求和、忽略非法值、低配不超过高配', () => {
  const counts = { shell: 3, frost: 2, shock: 1, poison: 4, bolt: 5 };
  const low = frameDrawCalls(counts, PROJECTILE_PROFILES.low, LOW);
  const high = frameDrawCalls(counts, PROJECTILE_PROFILES.high, HIGH_BASIC);
  assert.equal(low, 3 + 2 + 1 + 4 + 5);
  assert.equal(high, (3 + 2 + 1 + 4 + 5) * 2);
  assert.ok(low <= high);

  const withGlow = frameDrawCalls(counts, PROJECTILE_PROFILES.high, HIGH);
  assert.equal(withGlow, high + 3 + 2 + 1 + 4, '箭矢没有光晕贴图');

  assert.equal(frameDrawCalls({ shell: -2, frost: NaN, shock: '3' }, PROJECTILE_PROFILES.high, HIGH_BASIC), 0);
  assert.equal(frameDrawCalls(null, PROJECTILE_PROFILES.high, HIGH_BASIC), 0);
});

test('渲染循环：低配每弹一次绘制，高配轨迹+弹体两次', () => {
  const projectiles = makeProjectiles(2);
  const spriteFactory = makeSpriteFactory();
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: spriteFactory });

  const lowCtx = makeCtx();
  renderer.render(lowCtx, LOW);
  assert.equal(renderer.drawn, projectiles.length);
  assert.equal(lowCtx.calls.drawImage, projectiles.length, '低配每弹只画弹体贴图');
  assert.equal(renderer.sprites.size, PROJECTILE_KINDS.length, '低配不创建拖尾贴图');

  const highCtx = makeCtx();
  renderer.render(highCtx, HIGH);
  assert.equal(renderer.drawn, projectiles.length);
  assert.equal(highCtx.calls.drawImage, projectiles.length * 2, '高配每弹画拖尾与弹体');
  assert.equal(renderer.sprites.size, PROJECTILE_KINDS.length * 2);

  assert.equal(lowCtx.calls.drawImage <= highCtx.calls.drawImage, true);
  assert.equal(renderer.drawCalls, highCtx.calls.drawImage);
});

test('渲染循环：绘制次数与预算函数一致（含光晕）', () => {
  const projectiles = makeProjectiles(3);
  const renderer = new ProjectileRenderer(
    { projectiles },
    { glow: makeGlow(), createCanvas: makeSpriteFactory() }
  );
  const ctx = makeCtx();
  renderer.render(ctx, HIGH);
  const counts = {};
  for (const proj of projectiles) counts[proj.kind] = (counts[proj.kind] || 0) + 1;
  assert.equal(ctx.calls.drawImage, frameDrawCalls(counts, PROJECTILE_PROFILES.high, HIGH));
  assert.equal(renderer.drawCalls, ctx.calls.drawImage);

  const lowCtx = makeCtx();
  renderer.render(lowCtx, LOW);
  assert.equal(lowCtx.calls.drawImage, frameDrawCalls(counts, PROJECTILE_PROFILES.low, LOW));
  assert.ok(lowCtx.calls.drawImage < ctx.calls.drawImage);
});

test('贴图缓存：同类型只光栅化一次，跨帧复用', () => {
  const projectiles = makeProjectiles(4);
  const spriteFactory = makeSpriteFactory();
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: spriteFactory });
  const ctx = makeCtx();

  renderer.render(ctx, HIGH);
  const first = spriteFactory.created();
  assert.equal(first, PROJECTILE_KINDS.length * 2);
  renderer.render(ctx, HIGH);
  renderer.render(ctx, LOW);
  renderer.render(ctx, HIGH);
  assert.equal(spriteFactory.created(), first, '跨帧不重复创建贴图');
});

test('每帧零临时对象：分桶数组跨帧复用，投射物列表保持不变', () => {
  assert.equal(PROJECTILE_TEMPS_PER_FRAME, 0);
  const projectiles = makeProjectiles(3);
  const order = projectiles.map((p) => p.id);
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: makeSpriteFactory() });
  const bucketsBefore = PROJECTILE_KINDS.map((kind) => renderer._buckets.get(kind));
  const ctx = makeCtx();

  for (let frame = 0; frame < 10; frame++) renderer.render(ctx, frame % 2 ? HIGH : LOW);

  PROJECTILE_KINDS.forEach((kind, i) => {
    assert.equal(renderer._buckets.get(kind), bucketsBefore[i], '分桶数组对象必须复用');
    assert.equal(renderer._buckets.get(kind).length, 3);
  });
  assert.deepEqual(projectiles.map((p) => p.id), order, '渲染不得重排/修改投射物列表');
});

test('每帧绘制上限：超出预算的投射物不再进入绘制', () => {
  const projectiles = [];
  for (let i = 0; i < 500; i++) {
    projectiles.push({ id: i, kind: PROJECTILE_KINDS[i % PROJECTILE_KINDS.length], x: i, y: 0, angle: 0 });
  }
  const renderer = new ProjectileRenderer({ projectiles }, { createCanvas: makeSpriteFactory() });
  const lowCtx = makeCtx();
  renderer.render(lowCtx, LOW);
  assert.equal(renderer.drawn, PROJECTILE_PROFILES.low.frameBudget);
  assert.equal(lowCtx.calls.drawImage, PROJECTILE_PROFILES.low.frameBudget);

  const highCtx = makeCtx();
  renderer.render(highCtx, HIGH);
  assert.equal(renderer.drawn, PROJECTILE_PROFILES.high.frameBudget);
  assert.equal(highCtx.calls.drawImage, PROJECTILE_PROFILES.high.frameBudget * 2);
});

test('视觉语义：五种投射物形态仍可区分', () => {
  assert.deepEqual(PROJECTILE_KINDS, ['shell', 'frost', 'shock', 'poison', 'bolt']);
  const glows = new Set();
  for (const kind of PROJECTILE_KINDS) {
    const art = projectileArt(kind);
    assert.ok(art.body && art.trail, `${kind} 需要弹体与拖尾定义`);
    assert.ok(art.body.w > 0 && art.body.h > 0);
    assert.equal(typeof art.body.draw, 'function');
    if (art.glow) {
      assert.ok(!glows.has(art.glow.color), `${kind} 的光晕颜色必须与其他形态不同`);
      glows.add(art.glow.color);
    }
  }
  assert.equal(projectileArt('mystery'), PROJECTILE_ART.bolt, '未知类型回退为箭矢');
  assert.equal(PROJECTILE_ART.bolt.glow, null);
});

test('源码级：渲染层只读模拟状态，不碰 DOM 与随机数', () => {
  assert.doesNotMatch(SRC, /projectiles\.(push|splice|pop|shift|sort)\s*\(/, '不得修改投射物列表');
  assert.doesNotMatch(SRC, /from\s+'\.\.\/sim\.js'/, '不得依赖模拟模块');
  assert.doesNotMatch(SRC, /Math\.random/, '渲染不得引入随机数');
  assert.doesNotMatch(SRC, /querySelector|innerHTML/, '只画在 Canvas 上');
  assert.match(SRC, /PROJECTILE_PROFILES/);
  assert.match(SRC, /this\._buckets/);
  assert.match(SRC, /drawImage/);
});

test('技能渲染：画质档位对应粒子上限，低配不超过高配', () => {
  const minimal = makeSkill({ decorations: 'off' });
  const standard = makeSkill({ decorations: 'light' });
  const full = makeSkill({ decorations: 'full' });

  assert.equal(minimal.quality, 'minimal');
  assert.equal(standard.quality, 'standard');
  assert.equal(full.quality, 'full');
  assert.equal(minimal.cap, 48, 'minimal 粒子上限');
  assert.equal(standard.cap, 120, 'standard 粒子上限');
  assert.equal(full.cap, 180, 'full 粒子上限');
  assert.ok(minimal.cap < standard.cap && standard.cap < full.cap);

  // 降档立即裁剪已存在的粒子，不允许保留高配规模。
  const downgraded = makeSkill({ decorations: 'full' });
  for (let i = 0; i < downgraded.cap; i++) downgraded._spawn('ember', 1, 1, { ttl: 5 });
  assert.equal(downgraded.particles.length, 180);
  downgraded.configure({ settings: { decorations: 'light' } });
  assert.equal(downgraded.quality, 'standard');
  assert.equal(downgraded.particles.length, downgraded.cap, '降档后裁剪到新上限');

  // 升档不补造粒子。
  downgraded.configure({ settings: { decorations: 'full' } });
  assert.equal(downgraded.particles.length, 120);
});

test('技能特效：事件粒子数按画质分档，minimal 不生成装饰粒子', () => {
  const expected = {
    full: { aurora: 9, meteor: 10, chrono: 7 },
    light: { aurora: 5, meteor: 6, chrono: 4 },
    off: { aurora: 0, meteor: 0, chrono: 0 },
  };
  const events = {
    aurora: { kind: 'shatter', x: 2, y: 2 },
    meteor: { kind: 'meteor', x: 3, y: 3 },
    chrono: { kind: 'chronoNova', x: 4, y: 4 },
  };
  for (const [decorations, counts] of Object.entries(expected)) {
    for (const [id, count] of Object.entries(counts)) {
      const renderer = makeSkill({ decorations });
      renderer._spawnFromEvent(id, events[id]);
      assert.equal(renderer.particles.length, count, `${decorations}/${id} 事件粒子数`);
      assert.ok(renderer.particles.length <= renderer.cap);
    }
  }
});

test('技能粒子：达到上限后不再生成，连续事件不会突破预算', () => {
  const renderer = makeSkill({ decorations: 'full' });
  for (let i = 0; i < renderer.cap - 2; i++) renderer._spawn('shard', 1, 1, { ttl: 5 });
  assert.equal(renderer.particles.length, renderer.cap - 2);

  renderer._spawnFromEvent('meteor', { kind: 'meteor', x: 3, y: 3 });
  assert.equal(renderer.particles.length, renderer.cap, '只补到上限');
  for (let i = 0; i < 5; i++) renderer._spawnFromEvent('meteor', { kind: 'meteor', x: 3, y: 3 });
  assert.equal(renderer.particles.length, renderer.cap, '满额后不再生成');
  assert.equal(renderer._spawn('ember', 1, 1, { ttl: 1 }), null, '超预算时 _spawn 返回 null');
});

test('技能粒子：对象池跨帧复用，粒子数不无限增长', () => {
  const renderer = makeSkill({ decorations: 'full' });
  for (let i = 0; i < 20; i++) renderer._spawn('ember', 1, 1, { ttl: 0.1 });
  const spawned = renderer.particles.slice();
  assert.equal(spawned.length, 20);

  renderer._updateParticles(0.2);
  assert.equal(renderer.particles.length, 0, '过期粒子全部移除');
  assert.ok(renderer._pool.length >= 20, '过期粒子回收进池');

  const reused = renderer._spawn('ember', 2, 2, { ttl: 1 });
  assert.ok(spawned.includes(reused), '复用已回收的粒子对象');
  assert.ok(renderer._pool.length < 20);
  assert.ok(renderer.particles.length <= renderer.cap);
});

test('技能渲染：只读模拟状态，不修改敌人与塔列表', () => {
  const enemy = { id: 1, x: 2, y: 3, r: 0.3, dead: false, hp: 10, freezeUntil: 0 };
  const tower = { id: 1, x: 3, y: 3, skillOverdriveUntil: 10 };
  const game = makeSkillGame({
    time: 1,
    skill: { id: 'chrono', level: 7, stats: skillStats('chrono', 7), cooldown: 0 },
    stasis: { until: 10, baseUntil: 10, bonus: 0 },
    enemies: [enemy],
    towers: [tower],
  });
  const renderer = new SkillRenderer(game, { settings: { decorations: 'full' } });
  const ctx = makeAnyCtx();

  renderer.renderL2(ctx, 1, { decorations: 'full' });

  assert.equal(game.enemies.length, 1, '敌人列表长度不变');
  assert.equal(game.enemies[0], enemy, '敌人对象引用不变');
  assert.equal(game.towers.length, 1, '塔列表长度不变');
  assert.equal(game.towers[0], tower, '塔对象引用不变');
  assert.equal(game.skill.id, 'chrono');
  assert.ok(renderer.particles.length <= renderer.cap, '氛围粒子不突破上限');
});

test('技能渲染源码：不依赖模拟模块，不使用滤镜/像素回读', () => {
  assert.doesNotMatch(SKILL_SRC, /from\s+'\.\.\/sim\.js'/, '不得依赖模拟模块');
  assert.doesNotMatch(
    SKILL_SRC,
    /(?:g|ctx)\.shadowBlur\s*=|(?:g|ctx)\.filter\s*=|getImageData\s*\(/,
    '不使用高成本滤镜与像素回读'
  );
  assert.doesNotMatch(SKILL_SRC, /enemies\.(push|splice|pop|shift|sort)\s*\(/, '不得修改敌人列表');
  assert.doesNotMatch(SKILL_SRC, /towers\.(push|splice|pop|shift|sort)\s*\(/, '不得修改塔列表');
  assert.match(SKILL_SRC, /QUALITY_CAPS/, '粒子上限必须显式声明');
  assert.match(SKILL_SRC, /this\._pool/, '粒子对象池');
  assert.match(SKILL_SRC, /drawImage/, '预烘焙纹理走 drawImage');
});
