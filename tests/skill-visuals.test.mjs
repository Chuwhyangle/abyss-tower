// 技能视觉打磨：三技能前摇预警配置、画质预算分级、预警绘制，以及
// "画质不改变战斗结果"的同种子回归。断言纯函数 + 源码级契约，不依赖 Canvas 像素。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SKILL_QUALITY_PROFILES,
  SKILL_WARNING_PROFILES,
  SkillRenderer,
  qualityProfile,
  warningCountdown,
  warningProfile,
} from '../public/js/render/skill-renderer.js';
import { SKILL_ORDER, TILE, skillStats } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const SRC = fs.readFileSync(
  new URL('../public/js/render/skill-renderer.js', import.meta.url),
  'utf8'
);
const RENDER_SRC = fs.readFileSync(new URL('../public/js/render.js', import.meta.url), 'utf8');

const SHAPES = ['ring', 'hex', 'star'];

function makeCtx() {
  const counts = { arc: 0, lineTo: 0, stroke: 0, fill: 0, drawImage: 0, fillText: 0, setLineDash: 0 };
  const gradient = { addColorStop() {} };
  return {
    counts,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineDashOffset: 0,
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    lineJoin: '',
    lineCap: '',
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() { counts.lineTo += 1; },
    arc() { counts.arc += 1; },
    ellipse() {},
    fill() { counts.fill += 1; },
    stroke() { counts.stroke += 1; },
    fillRect() {},
    clearRect() {},
    drawImage() { counts.drawImage += 1; },
    fillText() { counts.fillText += 1; },
    strokeText() {},
    setLineDash() { counts.setLineDash += 1; },
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
  };
}

function makeGame(id) {
  const stats = skillStats(id, 1);
  return {
    map: { cols: 22, rows: 12, base: { x: 11, y: 6 } },
    seed: 'skill-visuals',
    time: 0,
    skill: { id, level: 1, stats, cooldown: 0 },
    skillFx: [],
    enemies: [],
    towers: [],
  };
}

test('三种技能都有完整的预警配置（地面标记 + 倒计时环）', () => {
  assert.deepEqual(
    [...SKILL_ORDER].sort(),
    Object.keys(SKILL_WARNING_PROFILES).sort(),
    '预警配置必须与技能清单一一对应'
  );
  for (const id of SKILL_ORDER) {
    const profile = warningProfile(id);
    assert.equal(profile, SKILL_WARNING_PROFILES[id]);
    assert.ok(SHAPES.includes(profile.shape), `${id} 地面标记形状未知`);
    assert.ok(profile.ttl > 0 && profile.ttl <= 1.2, `${id} 预警时长不合理`);
    assert.ok(profile.radius > 0, `${id} 预警半径缺失`);
    assert.equal(profile.ring, true, `${id} 缺少倒计时环`);
    assert.ok(Array.isArray(profile.dash) && profile.dash.length === 2, `${id} 虚线节奏缺失`);
    assert.ok(profile.fill > 0 && profile.fill < 0.2, `${id} 填充过重，会遮挡路径信息`);
    assert.ok(profile.source === 'cast' || profile.source === 'event', `${id} 预警来源未知`);
  }
  // 流星沿用模拟层的逐落点事件，其余技能由渲染层起搏。
  assert.equal(warningProfile('meteor').source, 'event');
  assert.equal(warningProfile('aurora').source, 'cast');
  assert.equal(warningProfile('chrono').source, 'cast');
});

test('未知技能回退安全：预警与画质都返回默认配置', () => {
  const fallback = warningProfile('unknown-skill');
  assert.ok(fallback);
  assert.equal(fallback, warningProfile(undefined));
  assert.equal(fallback, warningProfile(null));
  assert.ok(SHAPES.includes(fallback.shape));
  assert.equal(fallback.ring, true);

  assert.equal(qualityProfile('bogus'), qualityProfile('standard'));
  assert.equal(qualityProfile(undefined), SKILL_QUALITY_PROFILES.standard);
});

test('画质分级：低配粒子预算 ≤ 高配，且只保留预警与命中闪光', () => {
  const minimal = qualityProfile('minimal');
  const standard = qualityProfile('standard');
  const full = qualityProfile('full');
  assert.ok(minimal.particles <= standard.particles);
  assert.ok(standard.particles <= full.particles);
  assert.ok(minimal.particles < full.particles);
  assert.ok(full.particles <= 180, '高配粒子预算不得超过系统上限');

  assert.equal(minimal.glow, false, '低配应关闭光晕');
  assert.equal(minimal.afterglow, false, '低配应关闭余韵');
  assert.equal(minimal.ambient, false, '低配应关闭氛围粒子');
  assert.equal(full.glow, true);
  assert.equal(full.afterglow, true);
  assert.ok(minimal.tint < standard.tint && standard.tint < full.tint, '屏幕色层随时长递增');
});

test('倒计时环比例：剩余/总时长，非法输入回退 0', () => {
  assert.equal(warningCountdown(0.55, 0.55), 1);
  assert.equal(warningCountdown(0, 0.55), 0);
  assert.equal(warningCountdown(0.275, 0.55), 0.5);
  assert.equal(warningCountdown(2, 1), 1, '剩余超过总时长时钳到 1');
  assert.equal(warningCountdown(-1, 1), 0);
  assert.equal(warningCountdown(NaN, 1), 0);
  assert.equal(warningCountdown(1, 0), 0);
  assert.equal(warningCountdown(1, NaN), 0);
  assert.equal(warningCountdown(1), 0);
  assert.equal(warningCountdown(0.3, 0.6), warningCountdown(0.3, 0.6), '必须确定性');
});

test('极光/星海：释放瞬间起搏地面标记与倒计时环（低配同样保留）', () => {
  for (const id of ['aurora', 'chrono']) {
    const game = makeGame(id);
    const settings = { decorations: 'off' };
    const renderer = new SkillRenderer(game, {
      width: game.map.cols * TILE,
      height: game.map.rows * TILE,
      settings,
    });
    const ctx = makeCtx();
    renderer.renderWarnings(ctx, 0, settings);
    // 冷却从 0 跳回满值 = 刚释放。
    game.skill.cooldown = skillStats(id, 1).cd;
    renderer.renderWarnings(ctx, 0.016, settings);

    assert.ok(ctx.counts.stroke >= 2, `${id} 未绘制地面标记 + 倒计时环`);
    assert.ok(ctx.counts.setLineDash > 0, `${id} 未绘制虚线预警`);
    assert.ok(ctx.counts.arc >= 1, `${id} 缺少倒计时环`);
    assert.ok(ctx.counts.lineTo >= 5, `${id} 地面标记形状未闭合`);
    assert.ok(ctx.counts.fill >= 1, `${id} 缺少低透明地面填充`);
  }
});

test('流星：预警事件绘制倒计时环，低配不画余韵焦痕', () => {
  const game = makeGame('meteor');
  game.skill.cooldown = skillStats('meteor', 1).cd;
  game.skillFx = [
    { kind: 'meteorWarn', x: 4, y: 3, r: 1.8, ttl: 0.3, maxTtl: 0.55, color: '#ffb066' },
    { kind: 'meteor', x: 4, y: 3, r: 1.8, ttl: 0.5, maxTtl: 0.55, color: '#ffb066' },
  ];
  const settings = { decorations: 'off' };
  const renderer = new SkillRenderer(game, {
    width: game.map.cols * TILE,
    height: game.map.rows * TILE,
    settings,
  });
  const ctx = makeCtx();
  renderer.renderL1(ctx, 0.1, settings);
  assert.ok(ctx.counts.arc >= 3, '预警应包含进度填充、虚线外圈与倒计时环');
  assert.ok(ctx.counts.setLineDash > 0);
  // 无 document 时纹理未烘焙，焦痕不会绘制；源码层再断言低配门控。
  assert.match(SRC, /this\.profile\.afterglow && \(kind === 'meteor'/, '焦痕必须受余韵档位控制');
});

test('源码级：预警入口接线、低配由画质档位驱动、逐帧零分配', () => {
  assert.match(RENDER_SRC, /skillRenderer\.renderWarnings\(g, this\.time, this\.settings\)/);
  assert.match(SRC, /renderWarnings\(g, time, settings\)/);
  assert.match(SRC, /_drawTelegraph\(g, time\)/);
  assert.match(SRC, /warningProfile\(id\)/);
  assert.match(SRC, /warningCountdown\(/);
  assert.match(SRC, /qualityProfile\(/);
  assert.match(SRC, /this\.profile\.glow/);
  assert.match(SRC, /this\.profile\.afterglow/);
  // 命中高光走预烘焙纹理，禁止每帧滤镜/读取像素。
  assert.match(SRC, /this\._textures\.flash/);
  assert.match(SRC, /_drawHitFlash\(g, x, y, r/);
  // 禁止每帧滤镜/读取像素（顶部注释里的禁用说明不算实现）。
  assert.doesNotMatch(SRC, /\.filter\s*=[^=]|\.shadowBlur\s*=|getImageData\s*\(/);
  // 渲染层只读模拟状态，不依赖模拟模块。
  assert.doesNotMatch(SRC, /from\s+'\.\.\/sim\.js'/);

  // renderWarnings..L3 之间不得在逐帧路径里分配数组/对象。
  const frameBody = SRC.slice(SRC.indexOf('  renderWarnings('), SRC.indexOf('  // ---------- 同步'));
  assert.doesNotMatch(frameBody, /\.push\(|\.map\(|\.filter\(|Array\.from|new\s+[A-Z]/, '逐帧绘制不得分配');
});

function runBattle(tier) {
  const seed = 'skill-visuals-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 400,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    skill: { id: 'meteor', level: 10 },
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({ effects: tier === 'minimal' ? 'off' : 'full', floaters: tier === 'minimal' ? 'off' : 'all' });
  const settings = { decorations: tier === 'minimal' ? 'off' : 'full' };
  const renderer = new SkillRenderer(sim, {
    width: map.cols * TILE,
    height: map.rows * TILE,
    settings,
  });
  const ctx = makeCtx();
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);

  let cast = false;
  for (let i = 0; i < 900; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
    if (!cast && i === 240) cast = sim.castSkill();
    const time = i / 60;
    renderer.renderL0(ctx, time, settings);
    renderer.renderWarnings(ctx, time, settings);
    renderer.renderL1(ctx, time, settings);
    renderer.renderL2(ctx, time, settings);
    renderer.renderL3(ctx, time, settings);
  }

  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    cooldown: Number((sim.skill?.cooldown ?? 0).toFixed(6)),
    enemies: sim.enemies.map((enemy) => [
      enemy.type,
      Math.round(enemy.hp * 1e6),
      enemy.x.toFixed(6),
      enemy.y.toFixed(6),
      enemy.burnUntil ? enemy.burnUntil.toFixed(6) : 0,
    ]),
  });
}

test('同种子同技能：低配/高配战斗状态哈希一致', () => {
  const full = runBattle('full');
  const minimal = runBattle('minimal');
  assert.equal(minimal, full);
});
