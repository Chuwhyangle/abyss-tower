// 场景精灵接入矩阵的单元测试：id 集、计划/回退语义、清单可解析性、源码接线与图集可复现。
// 浏览器侧的实跑证据在 tests/browser-sprite-scenes.mjs（AC-031 的 criterion）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCENE_KEYS,
  SCENE_SPRITES,
  SCENE_SPRITE_IDS,
  applySceneSpriteElement,
  missingSceneSprites,
  sceneSprite,
  sceneSpriteIds,
  sceneSpritePlan,
} from '../public/js/shared/scene-sprites.js';
import { SpritePipeline } from '../public/js/render/sprite-pipeline.js';
import {
  SCENE_JSON_PATH,
  SCENE_IMAGE_2X_PATH,
  SCENE_IMAGE_PATH,
  buildArtifacts,
  buildSceneAtlasImage,
  layoutSceneAtlas,
} from '../scripts/build-sprite-atlas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = 'public/assets/sprites/manifest.json';

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

function manifestEntries() {
  return readJson(MANIFEST_PATH).entries;
}

function fakeElement() {
  const attributes = new Map();
  const properties = new Map();
  return {
    attributes,
    properties,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      },
    },
  };
}

test('SCENE_SPRITES 恰为四场景，必需集非空且全部冻结', () => {
  assert.deepEqual(Object.keys(SCENE_SPRITES).sort(), [...SCENE_KEYS].sort());
  assert.deepEqual(SCENE_KEYS, ['title', 'map', 'combat', 'result']);
  for (const scene of SCENE_KEYS) {
    const spec = SCENE_SPRITES[scene];
    assert.ok(Array.isArray(spec.required) && spec.required.length > 0, `${scene} 必需集为空`);
    assert.ok(spec.required.every((id) => typeof id === 'string' && id.includes('/')), `${scene} 必需 id 命名不合规`);
    assert.equal(spec.fallback, 'programmatic', `${scene} 回退语言必须是程序化绘制`);
    assert.ok(Object.isFrozen(spec), `${scene} 条目必须深冻结`);
    assert.ok(Object.isFrozen(spec.required), `${scene}.required 必须冻结`);
    // 必需与可选互不重叠：一个 id 不能既是必需又是可选。
    for (const id of spec.optional) assert.ok(!spec.required.includes(id), `${scene}：${id} 同时出现在必需与可选集`);
  }
  assert.ok(Object.isFrozen(SCENE_SPRITES));
});

test('每个场景 id 都能在 manifest 中解析为 ready 场景图集条目', () => {
  const entries = new Map(manifestEntries().map((entry) => [entry.id, entry]));
  for (const scene of SCENE_KEYS) {
    const spec = SCENE_SPRITES[scene];
    for (const id of [...spec.required, ...spec.optional]) {
      const entry = entries.get(id);
      assert.ok(entry, `${scene}：清单缺少 ${id}`);
      assert.equal(entry.status, 'ready', `${id} 必须可加载`);
      assert.equal(entry.atlas, 'scene-atlas', `${id} 应来自场景图集`);
      assert.equal(entry.generator, 'procedural-canvas2d', `${id} 生成方式必须可复现`);
      assert.ok(entry.provenance?.author, `${id} 缺 provenance.author`);
      assert.equal(entry.provenance?.license, entry.license, `${id} 授权两处不一致`);
    }
  }
});

test('sceneSpriteIds / sceneSprite 对未知场景返回 null，不抛错', () => {
  assert.equal(sceneSprite('unknown'), null);
  assert.equal(sceneSpriteIds('unknown'), null);
  assert.equal(sceneSpritePlan('unknown'), null);
  assert.equal(missingSceneSprites('unknown', []), null);
  assert.ok(sceneSprite('title'));
  assert.deepEqual(sceneSpriteIds('title'), [...SCENE_SPRITES.title.required]);
  assert.deepEqual(sceneSpriteIds('title', { includeOptional: true }), [
    ...SCENE_SPRITES.title.required,
    ...SCENE_SPRITES.title.optional,
  ]);
});

test('sceneSpritePlan：两视口 id 集一致、变体缺省不同、回退只看必需集', () => {
  const desktop = sceneSpritePlan('combat', { viewport: 'desktop' });
  const mobile = sceneSpritePlan('combat', { viewport: 'mobile' });
  assert.deepEqual(desktop.ids, mobile.ids, '两视口 id 集必须一致');
  assert.deepEqual(desktop.ids, [...SCENE_SPRITES.combat.required]);
  assert.equal(desktop.variant, 1);
  assert.equal(mobile.variant, 2);
  assert.equal(sceneSpritePlan('combat', { viewport: 'mobile', dpr: 1 }).variant, 1, '显式 dpr 优先于视口缺省');
  // assetsReady 未知（null）时不判回退，避免首帧误标。
  assert.equal(desktop.useFallback, false);
  assert.deepEqual(desktop.missing, []);

  const allReady = sceneSpritePlan('combat', { assetsReady: [...SCENE_SPRITES.combat.required] });
  assert.equal(allReady.useFallback, false);

  const missingOne = sceneSpritePlan('combat', {
    assetsReady: [SCENE_SPRITES.combat.required[0]],
  });
  assert.equal(missingOne.useFallback, true);
  assert.deepEqual(missingOne.missing, [SCENE_SPRITES.combat.required[1]]);

  // 可选 id 缺失不影响回退判定。
  const onlyOptionalMissing = sceneSpritePlan('title', {
    assetsReady: [...SCENE_SPRITES.title.required],
  });
  assert.equal(onlyOptionalMissing.useFallback, false);

  // assetsReady 支持数组 / Set / Map / 普通对象四种输入形态。
  const asSet = sceneSpritePlan('result', { assetsReady: new Set(SCENE_SPRITES.result.required) });
  const asMap = sceneSpritePlan('result', { assetsReady: new Map(SCENE_SPRITES.result.required.map((id) => [id, 1])) });
  const asObject = sceneSpritePlan('result', {
    assetsReady: Object.fromEntries(SCENE_SPRITES.result.required.map((id) => [id, 1])),
  });
  assert.equal(asSet.useFallback || asMap.useFallback || asObject.useFallback, false);
});

test('missingSceneSprites 只报必需集缺口', () => {
  const required = SCENE_SPRITES.map.required;
  assert.deepEqual(missingSceneSprites('map', []), required);
  assert.deepEqual(missingSceneSprites('map', [required[0]]), required.slice(1));
  assert.deepEqual(missingSceneSprites('map', required), []);
  assert.deepEqual(missingSceneSprites('map', [...required, ...SCENE_SPRITES.map.optional]), []);
});

test('战斗场景 id 顺序锁定：背景在前、HUD 皮肤在后', () => {
  assert.deepEqual([...SCENE_SPRITES.combat.required], [
    SCENE_SPRITE_IDS.combatBackground,
    SCENE_SPRITE_IDS.combatHud,
  ]);
});

test('applySceneSpriteElement：就绪写 CSS 变量，缺资源只标回退', () => {
  const id = SCENE_SPRITE_IDS.titleBackground;
  const sprites = {
    spriteStyle: () => ({
      id,
      url: '/assets/sprites/scenes/scene-atlas@1x.png',
      width: 480,
      height: 270,
      backgroundImage: 'url("/assets/sprites/scenes/scene-atlas@1x.png")',
      backgroundPosition: '-0px -0px',
      backgroundSize: '1008px 540px',
    }),
  };
  const element = fakeElement();
  assert.equal(applySceneSpriteElement(element, sprites, id), true);
  assert.equal(element.getAttribute('data-sprite-id'), id);
  assert.equal(element.getAttribute('data-sprite-fallback'), null);
  assert.equal(element.style.backgroundImage, 'var(--sprite-bg-scene-title)');
  assert.equal(element.properties.get('--sprite-bg-scene-title'), 'url("/assets/sprites/scenes/scene-atlas@1x.png")');
  assert.equal(element.properties.get('--sprite-bg-scene-title').includes('/assets/sprites/'), true);

  const fallback = fakeElement();
  const dead = { spriteStyle: () => null };
  assert.equal(applySceneSpriteElement(fallback, dead, id), false);
  assert.equal(fallback.getAttribute('data-sprite-id'), id);
  assert.equal(fallback.getAttribute('data-sprite-fallback'), '1');

  // 没有管线（Renderer 未创建）同样走回退，而不是抛错。
  const noPipeline = fakeElement();
  assert.equal(applySceneSpriteElement(noPipeline, null, id), false);
  assert.equal(noPipeline.getAttribute('data-sprite-fallback'), '1');
});

test('管线提供场景接线所需的只读能力，且仍不含 Math.random', () => {
  const source = read('public/js/render/sprite-pipeline.js');
  for (const method of ['url(id)', 'image(id)', 'readyIds()', 'spriteStyle(id)', 'drawRect(ctx', 'drawCount(id)']) {
    assert.ok(source.includes(method), `sprite-pipeline.js 缺少 ${method}`);
  }
  assert.doesNotMatch(source, /Math\.random/);
  const pipeline = new SpritePipeline({ dpr: 1 });
  assert.equal(pipeline.url('bg/scene-title'), null);
  assert.equal(pipeline.image('bg/scene-title'), null);
  assert.equal(pipeline.spriteStyle('bg/scene-title'), null);
  assert.deepEqual(pipeline.readyIds(), []);
  assert.equal(pipeline.drawCount('bg/scene-title'), 0);
  assert.equal(pipeline.draw({}, 'bg/scene-title', 0, 0), false);
});

test('源码接线：三个 DOM 场景带 data-sprite-id 且不 new Image，画布场景引用 SCENE_SPRITES.combat', () => {
  for (const file of ['public/js/ui/title.js', 'public/js/ui/modals.js', 'public/js/ui/result.js']) {
    const source = read(file);
    assert.match(source, /data-sprite-id/, `${file} 缺少 data-sprite-id 标记`);
    assert.doesNotMatch(source, /\bnew Image\b/, `${file} 不得自己加载图片`);
  }
  const renderer = read('public/js/render.js');
  assert.match(renderer, /SCENE_SPRITES\.combat/, 'render.js 必须引用 SCENE_SPRITES.combat');
  assert.match(renderer, /data-sprite-fallback|spriteFallback/, 'render.js 必须写场景回退标记');

  const shared = read('public/js/shared/scene-sprites.js');
  assert.doesNotMatch(shared, /from ['"][^'"]*\/?(?:sim|render)(?:\.js|\/)/, 'scene-sprites.js 不得 import 模拟/渲染层');
  assert.doesNotMatch(shared, /Math\.random/, 'scene-sprites.js 不得使用 Math.random');
  assert.doesNotMatch(shared, /devicePixelRatio/, 'DPR 的唯一权威是 Renderer.applyDpr()');
});

test('场景图集可复现：同输入两次字节一致，且磁盘产物与生成器一致', () => {
  const layout = layoutSceneAtlas();
  assert.ok(layout.width > 0 && layout.height > 0);
  assert.ok(layout.width <= 2048 && layout.height <= 2048, '场景图集超出 2048 上限');
  assert.ok(layout.width * 2 <= 2048 && layout.height * 2 <= 2048, '场景图集 @2x 超出 2048 上限');

  const first = buildSceneAtlasImage();
  const second = buildSceneAtlasImage();
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  assert.ok(first.data.equals(second.data), '场景图集两次生成不一致');

  const artifacts = buildArtifacts();
  const scenePaths = [SCENE_IMAGE_PATH, SCENE_IMAGE_2X_PATH, SCENE_JSON_PATH];
  for (const relative of scenePaths) {
    const artifact = artifacts.find((item) => item.path === relative);
    assert.ok(artifact, `产物清单缺少 ${relative}`);
    const onDisk = fs.readFileSync(path.join(ROOT, relative));
    assert.ok(onDisk.equals(artifact.data), `${relative} 与生成器不一致（跑 node scripts/build-sprite-atlas.mjs）`);
  }

  const atlas = readJson(SCENE_JSON_PATH);
  for (const scene of SCENE_KEYS) {
    for (const id of SCENE_SPRITES[scene].required) {
      const frame = Object.values(atlas.frames).find((item) => item.spriteId === id);
      assert.ok(frame, `场景图集缺少 ${id} 的帧`);
      assert.ok(frame.w > 0 && frame.h > 0);
    }
  }
});
