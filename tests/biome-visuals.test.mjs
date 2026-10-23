// 第六套生物群系与区域过渡：六套调色板/道具定义完整且可辨识、
// 低配/高配预算单调、过渡带只在高画质出现且不遮挡路径与塔位。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BIOME_PALETTE_OVERRIDES,
  BIOME_SCENES,
  REGION_TRANSITION,
  SIXTH_BIOME,
  ambientParticleBudget,
  biomeScene,
  biomeVisualPalette,
  regionTransitionBands,
  sceneTransition,
} from '../public/js/render/background-renderer.js';
import { biomePalette } from '../public/js/render/palette.js';
import { ARCHETYPES } from '../public/js/shared/mapgen.js';

const SRC = fs.readFileSync(
  new URL('../public/js/render/background-renderer.js', import.meta.url),
  'utf8'
);

const PALETTE_KEYS = [
  'grass1', 'grass2', 'grid', 'pathEdge', 'path', 'pathInner',
  'pathLine', 'tuft', 'rock', 'rockEdge', 'accent', 'ambient',
];
const BIOMES = ['canyon', 'twin', 'triple', 'ring', 'cross', SIXTH_BIOME];

function paletteOf(archetype) {
  return biomeVisualPalette({ archetype }, biomePalette({ archetype }));
}

test('第六套生物群系已注册，并与地图原型对应', () => {
  assert.equal(SIXTH_BIOME, 'switchback');
  assert.deepEqual(Object.keys(BIOME_SCENES), BIOMES);
  assert.ok(ARCHETYPES[SIXTH_BIOME], '第六套群系必须对应 mapgen 中的原型');

  const scene = biomeScene({ archetype: SIXTH_BIOME });
  assert.equal(scene, BIOME_SCENES[SIXTH_BIOME]);
  assert.equal(scene.motif, 'highland');
  assert.equal(scene.decor.prop, 'slab');
  // 未知原型仍回退 canyon，渲染不因缺字段中断。
  assert.equal(biomeScene({ archetype: 'unknown' }), BIOME_SCENES.canyon);
});

test('每个群系都有完整调色板与道具定义', () => {
  const props = new Set();
  for (const archetype of BIOMES) {
    const palette = paletteOf(archetype);
    for (const key of PALETTE_KEYS) {
      assert.ok(palette[key], `${archetype}.palette.${key} 缺失`);
    }

    const scene = biomeScene({ archetype });
    assert.equal(scene, BIOME_SCENES[archetype], `${archetype} 分层定义未注册`);
    assert.ok(scene.decor.prop, `${archetype}.decor.prop 缺失`);
    assert.equal(typeof scene.decor.density, 'number');
    props.add(scene.decor.prop);
    assert.ok(scene.particles.max > 0 && scene.particles.size > 0);

    const transition = sceneTransition(scene);
    assert.ok(transition.bands >= 1, `${archetype} 至少一条区域过渡带`);
    assert.ok(transition.alpha > 0 && transition.alpha <= 0.06, `${archetype} 过渡带低对比度`);
    assert.ok(transition.spread > 0);
  }
  assert.equal(props.size, BIOMES.length, '每套群系的地表道具类型必须互不相同');
});

test('六套群系可辨识：强调色与地表互不重复', () => {
  const accents = new Set();
  const grass = new Set();
  for (const archetype of BIOMES) {
    const palette = paletteOf(archetype);
    accents.add(palette.accent);
    grass.add(palette.grass1);
  }
  assert.equal(accents.size, BIOMES.length, '强调色必须两两不同');
  assert.equal(grass.size, BIOMES.length, '地表底色必须两两不同');

  // 第六套来自渲染层覆盖表，而不是回退复用 canyon。
  assert.ok(BIOME_PALETTE_OVERRIDES[SIXTH_BIOME]);
  const sixth = paletteOf(SIXTH_BIOME);
  const canyon = paletteOf('canyon');
  for (const key of PALETTE_KEYS) {
    assert.notEqual(sixth[key], undefined, `第六套 ${key} 缺失`);
  }
  assert.notEqual(sixth.grass1, canyon.grass1);
  assert.notEqual(sixth.accent, canyon.accent);
});

test('低配/高配预算单调：粒子与过渡带', () => {
  const map = { cols: 22, rows: 12 };
  for (const archetype of BIOMES) {
    const scene = biomeScene({ archetype });
    const cap = scene.particles.max;

    assert.equal(ambientParticleBudget('off', cap), 0);
    const light = ambientParticleBudget('light', cap);
    const full = ambientParticleBudget('full', cap);
    assert.ok(light > 0 && light < full, `${archetype} 低配粒子必须少于高配`);
    assert.ok(full <= cap, `${archetype} 粒子不得超过场景上限`);

    // 过渡带属于非关键表现：低配/关闭画质不绘制。
    assert.deepEqual(regionTransitionBands(map, scene, 'off'), []);
    assert.deepEqual(regionTransitionBands(map, scene, 'light'), []);
    const bands = regionTransitionBands(map, scene, 'full');
    assert.ok(bands.length >= 1, `${archetype} 高配应有过渡带`);
    for (const band of bands) {
      assert.ok(band.x > 0 && band.x < map.cols, `${archetype} 过渡带必须落在图内`);
      assert.ok(band.alpha > 0 && band.alpha <= 0.06, `${archetype} 过渡带透明度必须低`);
      assert.ok(band.spread > 0 && band.spread < map.cols, `${archetype} 过渡带不得铺满全图`);
    }
  }
});

test('过渡带边界：小地图、缺字段与主动关闭都不绘制', () => {
  assert.deepEqual(regionTransitionBands({ cols: 0, rows: 0 }, BIOME_SCENES.canyon, 'full'), []);
  assert.deepEqual(regionTransitionBands(null, BIOME_SCENES.canyon, 'full'), []);
  assert.deepEqual(regionTransitionBands({ cols: 22 }, undefined, 'full'), [
    { x: 11, spread: REGION_TRANSITION.spread, alpha: REGION_TRANSITION.alpha },
  ]);
  const optedOut = {
    ...BIOME_SCENES.canyon,
    transition: { bands: 0, alpha: 0.05, spread: 1 },
  };
  assert.deepEqual(regionTransitionBands({ cols: 22 }, optedOut, 'full'), []);
});

test('源码级：过渡在路径之前绘制，且不引入素材文件', () => {
  const depth = SRC.indexOf('this.drawDepthLayers(g, width, height, P, scene, rng)');
  const transition = SRC.indexOf('this.drawRegionTransitions(g, width, height, P, scene, decor)');
  const path = SRC.indexOf('// 路径：逐条绘制');
  assert.ok(depth >= 0, '远景层保持');
  assert.ok(transition > depth, '过渡带绘制在远景之后');
  assert.ok(path > transition, '路径必须后画，覆盖过渡带以保证高对比');

  assert.match(SRC, /biomeVisualPalette\(map, palette\)/, '第六套调色板必须参与烘焙');
  assert.match(SRC, /regionTransitionBands\(this\.game\.map, scene, decorations\)/);
  assert.match(SRC, /excluded\?\.has\(c \* map\.rows \+ r\)/, '地贴仍遵循路径/塔位排除区');
  assert.doesNotMatch(SRC, /\.(?:png|jpe?g|webp|svg|gif)\b|new\s+Image\s*\(|fetch\s*\(/, '不引入素材文件');
});
