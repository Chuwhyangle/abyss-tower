// 单位精灵覆盖证明（AC-023）：覆盖集与数据表严格相等、状态帧互异、清单可解析、
// 生成器可重复、纯状态选择器与渲染接线。只读数据表与产物，不改变模拟层。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENEMIES, RARITY, RELICS, TOWERS } from '../public/js/shared/data.js';
import { BOSS_VARIANTS } from '../public/js/shared/data/enemies.js';
import { DESTRUCTIBLE_TYPES } from '../public/js/shared/destructibles.js';
import {
  ART_COVERAGE,
  ART_KINDS,
  BASE_ENTITY_ID,
  ENTITY_SPRITES,
  ENTITY_SPRITE_FAMILIES,
  PORTAL_ENTITY_ID,
  SUMMON_KINDS,
  ULTIMATE_TOWER_TYPES,
  ULTIMATE_VISUALS,
  artCoverageGaps,
  baseSpriteId,
  baseSpriteState,
  coverageGaps,
  destructibleSpriteId,
  destructibleSpriteState,
  enemyEntityId,
  enemySpriteId,
  enemySpriteState,
  entityRecords,
  entitySpriteIds,
  portalSpriteId,
  portalSpriteState,
  portraitEntityIds,
  relicIconIds,
  summonSpriteId,
  summonSpriteState,
  towerAppliedEvolutions,
  towerFormId,
  towerSpriteId,
  towerSpriteState,
  towerVisualTier,
  ultimateVisual,
} from '../public/js/render/sprite-coverage.js';
import { drawPortrait, portraitSpec } from '../public/js/render/portrait-draw.js';
import { RELIC_GLYPH_NAMES, drawRelicIcon, relicGlyphName, relicIconSpec } from '../public/js/render/relic-art.js';
import { IMPACT_SHAPES } from '../public/js/render/impact-vfx.js';
import {
  ATLAS_IMAGE_2X_PATH,
  ATLAS_IMAGE_PATH,
  ATLAS_JSON_PATH,
  ATLAS_NAME,
  FRAME_SIZE,
  MANIFEST_PATH,
  buildArtifacts,
} from '../scripts/build-entity-sprites.mjs';
import { decodePng } from '../scripts/lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

const RENDERERS = [
  'public/js/render/tower-renderer.js',
  'public/js/render/enemy-renderer.js',
  'public/js/render/ally-renderer.js',
  'public/js/render/destructible-renderer.js',
  'public/js/render/portal-renderer.js',
];

// 召唤物 kind 的权威来源：海克斯里 ctx.spawnAlly 的调用点。
function hexSummonKinds() {
  const dir = path.join(ROOT, 'public/js/shared/hexes');
  const kinds = new Set();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/kind:\s*'([a-z0-9-]+)'/g)) kinds.add(match[1]);
  }
  return [...kinds].sort();
}

function authoritativeEntities() {
  const towers = [];
  for (const [typeId, def] of Object.entries(TOWERS)) {
    towers.push(`tower.${typeId}`);
    for (const evolution of def.evolutions || []) towers.push(`tower.${evolution.id}`);
  }
  const enemies = [
    ...Object.keys(ENEMIES).map((typeId) => `enemy.${typeId}`),
    ...Object.keys(BOSS_VARIANTS).map((variantId) => `enemy.${variantId}`),
  ];
  return [
    ...towers,
    ...enemies,
    ...hexSummonKinds().map((kind) => `summon.${kind}`),
    ...DESTRUCTIBLE_TYPES.map((type) => `destructible.${type.id}`),
    `portal.${PORTAL_ENTITY_ID}`,
    `base.${BASE_ENTITY_ID}`,
  ].sort();
}

function frameHash(image, frame) {
  const crop = image.crop(frame.x, frame.y, frame.w, frame.h);
  return crypto.createHash('sha256').update(crop.data).digest('hex');
}

// ── 覆盖集与数据表严格相等 ──────────────────────────────────────────────────
test('覆盖集与数据表严格相等：32 塔形态 + 14 敌人 + 3 首领变体 + 召唤物 + 5 可破坏物 + 传送门 + 基地', () => {
  const registered = entityRecords().map((record) => record.id).sort();
  const expected = authoritativeEntities();
  assert.equal(registered.length, expected.length, `实体数量不等：注册 ${registered.length} ≠ 数据表 ${expected.length}`);
  assert.deepEqual(registered, expected, '实体 id 集必须与数据表逐一相等（多一个或少一个都失败）');

  const towerForms = registered.filter((id) => id.startsWith('tower.'));
  assert.equal(towerForms.length, 32, '8 型塔 × (1 底座 + 3 进化) = 32 个塔形态');
  const enemyForms = registered.filter((id) => id.startsWith('enemy.'));
  assert.equal(enemyForms.length, Object.keys(ENEMIES).length + Object.keys(BOSS_VARIANTS).length);
  assert.equal(registered.filter((id) => id.startsWith('destructible.')).length, DESTRUCTIBLE_TYPES.length);
  assert.deepEqual(registered.filter((id) => id.startsWith('summon.')), hexSummonKinds().map((kind) => `summon.${kind}`));
  assert.deepEqual([...SUMMON_KINDS].sort(), hexSummonKinds(), 'SUMMON_KINDS 与海克斯源码里的 kind 一致');

  const families = new Set(entityRecords().map((record) => record.family));
  assert.deepEqual([...families].sort(), [...ENTITY_SPRITE_FAMILIES].sort(), '六类实体族都有登记');
  assert.equal(registered.length, 57, '总数 57 个实体');
});

test('覆盖守卫 coverageGaps 对缺失与多余实体双向报警', () => {
  const manifest = readJson(MANIFEST_PATH);
  const gaps = coverageGaps(manifest);
  assert.deepEqual(gaps.missing, [], `清单缺帧：${gaps.missing.slice(0, 5).join(', ')}`);
  assert.deepEqual(gaps.extra, [], `清单多出未登记实体帧：${gaps.extra.slice(0, 5).join(', ')}`);

  const dropped = manifest.entries.filter((entry) => entry.id !== 'enemy.grunt.move');
  const missing = coverageGaps({ entries: dropped });
  assert.deepEqual(missing.missing, ['enemy.grunt.move'], '删掉一个敌人状态帧必须被报缺');

  const extra = coverageGaps({ entries: [...manifest.entries, { id: 'enemy.ghost.move' }] });
  assert.deepEqual(extra.extra, ['enemy.ghost.move'], '多出的实体帧必须被报出');
});

// ── 每实体 ≥2 状态且状态帧互异 ──────────────────────────────────────────────
test('每个实体 ≥2 个状态，状态精灵 id 与图集像素哈希互不相同', () => {
  const atlas = readJson(ATLAS_JSON_PATH);
  const image = decodePng(fs.readFileSync(path.join(ROOT, ATLAS_IMAGE_PATH)));
  for (const record of entityRecords()) {
    const entries = Object.entries(record.states);
    assert.ok(entries.length >= 2, `${record.id} 至少需要两种状态`);
    assert.equal(new Set(entries.map(([, id]) => id)).size, entries.length, `${record.id} 状态精灵 id 必须互不相同`);
    const hashes = entries.map(([, id]) => {
      const frame = atlas.frames[id];
      assert.ok(frame, `${record.id} 的状态帧 ${id} 不在图集里`);
      return frameHash(image, frame);
    });
    assert.equal(new Set(hashes).size, hashes.length, `${record.id} 的各状态帧像素必须不同（不是同一张图换名字）`);
  }
  assert.equal(Object.keys(atlas.frames).length, entitySpriteIds().length, '图集帧数等于状态级精灵 id 数');
});

// ── 清单可解析、资源真实存在 ────────────────────────────────────────────────
test('清单可解析：文件存在、PNG 尺寸与声明一致、图集帧在边界内、出处字段齐全', () => {
  const manifest = readJson(MANIFEST_PATH);
  const atlas = readJson(ATLAS_JSON_PATH);
  const image1x = decodePng(fs.readFileSync(path.join(ROOT, ATLAS_IMAGE_PATH)));
  const image2x = decodePng(fs.readFileSync(path.join(ROOT, ATLAS_IMAGE_2X_PATH)));

  const spec = manifest.atlases[ATLAS_NAME];
  assert.ok(spec, '清单必须声明 entity-atlas');
  assert.deepEqual(spec.size, atlas.size, '清单里的图集尺寸与 atlas JSON 一致');
  assert.deepEqual({ w: image1x.width, h: image1x.height }, atlas.size, '@1x PNG 尺寸与声明一致');
  assert.deepEqual(
    { w: image2x.width, h: image2x.height },
    { w: atlas.size.w * 2, h: atlas.size.h * 2 },
    '@2x PNG 是 @1x 的两倍'
  );
  assert.ok(atlas.size.w <= 2048 && atlas.size.h <= 2048, '图集不超过 2048×2048');

  const byId = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  for (const spriteId of entitySpriteIds()) {
    const entry = byId.get(spriteId);
    assert.ok(entry, `清单缺少 ${spriteId}`);
    assert.ok(fs.existsSync(path.join(ROOT, entry.path)), `${spriteId} 的 path 不存在：${entry.path}`);
    assert.equal(entry.size.w, FRAME_SIZE);
    assert.equal(entry.size.h, FRAME_SIZE);
    assert.equal(entry.atlas, ATLAS_NAME);
    assert.equal(entry.frame, spriteId);
    assert.equal(entry.status, 'ready');
    for (const key of ['provenance', 'license', 'generator']) {
      assert.ok(entry[key], `${spriteId} 缺少 ${key}`);
    }
    assert.equal(entry.provenance.license, entry.license, `${spriteId} 两处 license 一致`);
    assert.ok(entry.provenance.author && entry.provenance.retrievedAt, `${spriteId} provenance 字段不全`);

    const frame = atlas.frames[spriteId];
    assert.ok(frame, `atlas 缺少帧 ${spriteId}`);
    assert.ok(frame.x >= 0 && frame.y >= 0, `${spriteId} 帧原点越界`);
    assert.ok(frame.x + frame.w <= image1x.width, `${spriteId} 帧横向越界`);
    assert.ok(frame.y + frame.h <= image1x.height, `${spriteId} 帧纵向越界`);
  }

  // 既有 probe 条目必须原样保留（AC-022 的管线自检资源）。
  assert.ok(byId.has('fx/probe'), '合并清单时必须保留 probe 条目');
});

// ── 生成器确定性 ───────────────────────────────────────────────────────────
test('生成器确定性：两次生成字节一致，且与磁盘产物一致（不含时间戳/随机量）', () => {
  const first = buildArtifacts();
  const second = buildArtifacts();
  assert.equal(first.length, second.length);
  first.forEach((artifact, index) => {
    assert.equal(artifact.path, second[index].path);
    assert.ok(artifact.data.equals(second[index].data), `${artifact.path} 两次生成不一致`);
    const onDisk = fs.readFileSync(path.join(ROOT, artifact.path));
    assert.ok(onDisk.equals(artifact.data), `${artifact.path} 与生成器不一致（跑 node scripts/build-entity-sprites.mjs）`);
  });

  const source = read('scripts/build-entity-sprites.mjs');
  assert.doesNotMatch(source, /Math\.random/, '生成器不得使用随机数');
  assert.doesNotMatch(source, /Date\.now|new Date\(/, '生成器不得写时间戳');
});

// ── 纯状态选择器 ───────────────────────────────────────────────────────────
test('towerSpriteState：disabled > attack > idle，且进化形态取最后一个已应用形态', () => {
  const base = { type: 'arrow', evolutions: [], evolution: null, recoil: 0, disabledUntil: 0 };
  assert.equal(towerSpriteState(base, 0), 'idle');
  assert.equal(towerSpriteState({ ...base, recoil: 0.6 }, 0), 'attack');
  assert.equal(towerSpriteState({ ...base, disabledUntil: 5, recoil: 0.6 }, 3), 'disabled', '停摆优先于后坐');
  assert.equal(towerSpriteState({ ...base, disabledUntil: 5 }, 6), 'idle', '停摆结束后回到待机');

  const evolved = { ...base, evolutions: ['arrow-longbow', 'arrow-rapid'] };
  assert.equal(towerFormId(evolved), 'arrow-rapid', '多选时取最后一个已应用形态');
  assert.equal(towerSpriteId(evolved, 0), 'tower.arrow-rapid.idle');
  assert.equal(towerSpriteId({ ...base, evolutions: ['arrow-nope'] }, 0), 'tower.arrow.idle', '未知进化回退底座形态');

  assert.equal(towerSpriteState(null, 0), null);
  assert.equal(towerSpriteState({ type: 'unknown-tower' }, 0), null);
  assert.equal(towerSpriteId({ type: 'unknown-tower' }, 0), null);
});

test('独塔视觉分层：3/6/9/10 级档位、已应用进化与八塔大招形态注册表', () => {
  // tower.level 是 0 起索引：3/6/9/10 级 = 索引 2/5/8/9。
  assert.equal(towerVisualTier(-1), 0);
  assert.equal(towerVisualTier(0), 0);
  assert.equal(towerVisualTier(1), 0);
  assert.equal(towerVisualTier(2), 1, '3 级进入第一层进化');
  assert.equal(towerVisualTier(4), 1);
  assert.equal(towerVisualTier(5), 2, '6 级进入第二层进化');
  assert.equal(towerVisualTier(7), 2);
  assert.equal(towerVisualTier(8), 3, '9 级进入第三层进化');
  assert.equal(towerVisualTier(9), 4, '10 级解锁大招');
  assert.equal(towerVisualTier(11), 4);
  assert.equal(towerVisualTier(Number.NaN), 0);
  assert.equal(towerVisualTier(undefined), 0);

  // 已应用进化：plural 列表优先，singular 旧字段兼容，只保留真实路线。
  assert.deepEqual(towerAppliedEvolutions(null), []);
  assert.deepEqual(towerAppliedEvolutions({ type: 'unknown' }), []);
  assert.deepEqual(towerAppliedEvolutions({ type: 'arrow', evolution: 'arrow-rapid' }), ['arrow-rapid']);
  assert.deepEqual(
    towerAppliedEvolutions({ type: 'arrow', evolutions: ['arrow-longbow', 'arrow-rapid', 'arrow-nope'] }),
    ['arrow-longbow', 'arrow-rapid'],
    '只保留该塔真实存在的进化'
  );

  // 八塔大招形态：覆盖全部塔型、shape/accent 两两不同、都是命中签名已登记的形态。
  assert.deepEqual(ULTIMATE_TOWER_TYPES, Object.keys(TOWERS).sort(), '大招形态覆盖全部塔型');
  assert.equal(Object.keys(ULTIMATE_VISUALS).length, 8);
  assert.equal(new Set(Object.values(ULTIMATE_VISUALS).map((v) => v.shape)).size, 8, '八塔大招形态两两不同');
  assert.equal(new Set(Object.values(ULTIMATE_VISUALS).map((v) => v.accent)).size, 8, '八塔大招强调色两两不同');
  for (const [type, spec] of Object.entries(ULTIMATE_VISUALS)) {
    assert.ok(Object.isFrozen(spec), `${type} 大招形态应冻结`);
    assert.ok(IMPACT_SHAPES.includes(spec.shape), `${type} 大招形态未登记：${spec.shape}`);
    assert.match(spec.color, /^#[0-9a-f]{6}$/i);
    assert.match(spec.accent, /^#[0-9a-f]{6}$/i);
    assert.ok(spec.particles > 0 && Number.isFinite(spec.particles));
    assert.ok(spec.ring > 0 && Number.isFinite(spec.ring));
  }
  assert.equal(ultimateVisual('cannon').shape, 'burst');
  assert.equal(ultimateVisual('unknown'), null);
  assert.equal(ultimateVisual(null), null);
});

test('enemySpriteState：cast > hit > move，首领变体按 enemy.variant 解析', () => {
  assert.equal(enemySpriteState({ type: 'grunt', variant: null, hitFlash: 0 }), 'move');
  assert.equal(enemySpriteState({ type: 'grunt', hitFlash: 0.5 }), 'hit');
  assert.equal(enemySpriteState({ type: 'grunt', hitFlash: 0, cast: { kind: 'roar' } }), 'move', '杂兵没有吟唱帧，向下降级');

  assert.equal(enemySpriteState({ type: 'boss', variant: null, hitFlash: 0 }), 'move');
  assert.equal(enemySpriteState({ type: 'boss', hitFlash: 0.5, cast: { kind: 'roar' } }), 'cast', '吟唱优先于受击');
  assert.equal(enemyEntityId({ type: 'boss', variant: 'armored' }), 'armored');
  assert.equal(enemySpriteId({ type: 'boss', variant: 'berserk', hitFlash: 0 }), 'enemy.berserk.move');
  assert.equal(enemySpriteId({ type: 'boss', variant: 'ghost', hitFlash: 0 }), 'enemy.boss.move', '未知变体回退通用首领');
  assert.equal(enemySpriteState({ type: 'ghost' }), null);
  assert.equal(enemySpriteId(null), null);
});

test('summonSpriteState：出手帧 > 待机帧，未知 kind 返回 null', () => {
  assert.equal(summonSpriteState({ kind: 'skeleton', recoil: 0 }), 'idle');
  assert.equal(summonSpriteState({ kind: 'skeleton', recoil: 1 }), 'attack');
  assert.equal(summonSpriteId({ kind: 'skeleton', recoil: 1 }), 'summon.skeleton.attack');
  assert.equal(summonSpriteState({ kind: 'dragon' }), null);
  assert.equal(summonSpriteId({ kind: 'dragon' }), null);
  assert.equal(summonSpriteState(null), null);
});

test('destructibleSpriteState：存活/已毁两态，未知类型返回 null', () => {
  assert.equal(destructibleSpriteState({ type: 'vein', destroyed: false }), 'alive');
  assert.equal(destructibleSpriteState({ type: 'vein', destroyed: true }), 'ruined');
  assert.equal(destructibleSpriteId({ type: 'totem', destroyed: true }), 'destructible.totem.ruined');
  assert.equal(destructibleSpriteState({ type: 'unknown' }), null);
  assert.equal(destructibleSpriteId(null), null);
});

test('portalSpriteState：波次充能、整备呼吸两帧、其余相位返回 null', () => {
  assert.equal(portalSpriteState('wave', 0), 'charge');
  assert.equal(portalSpriteState('prep', 0), 'idle');
  assert.equal(portalSpriteState('prep', Math.PI / 2 / 2.4 + 0.01), 'charge', '整备蓄能的正半周切到充能帧');
  assert.equal(portalSpriteState('result', 0), null);
  assert.equal(portalSpriteId('wave', 0), 'portal.spawn.charge');
  assert.equal(portalSpriteId('result', 0), null);
  assert.equal(portalSpriteId('prep', 2), 'portal.spawn.idle');
});

test('baseSpriteState：受击/低血为受损帧，非法血量比返回 null', () => {
  assert.equal(baseSpriteState(1, 0), 'idle');
  assert.equal(baseSpriteState(0.2, 0), 'hurt', '低血常驻受损帧');
  assert.equal(baseSpriteState(1, 0.4), 'hurt', '受击闪白优先');
  assert.equal(baseSpriteState(Number.NaN, 0), null);
  assert.equal(baseSpriteState(undefined, 0), null);
  assert.equal(baseSpriteId(0.2, 0), 'base.crystal.hurt');
  assert.equal(baseSpriteId(Number.NaN, 0), null);
});

test('注册表只读且结构完整：状态帧 id 形如 <family>.<entity>.<state>', () => {
  assert.ok(Object.isFrozen(ENTITY_SPRITES));
  for (const record of entityRecords()) {
    assert.ok(Object.isFrozen(record.states), `${record.id} 的状态表必须冻结`);
    assert.ok(ENTITY_SPRITE_FAMILIES.includes(record.family));
    for (const [state, spriteId] of Object.entries(record.states)) {
      assert.equal(spriteId, `${record.id}.${state}`, `${record.id}.${state} 命名不符合约定`);
    }
  }
});

// ── 渲染接线与源码约束 ─────────────────────────────────────────────────────
test('渲染接线：render.js 注入管线，五个实体渲染器按注册表 id 调用 sprites.draw', () => {
  const renderSrc = read('public/js/render.js');
  assert.equal((renderSrc.match(/sprites: this\.sprites/g) || []).length, 2, '塔与敌人经构造参数注入');
  assert.equal((renderSrc.match(/setSprites\(this\.sprites\)/g) || []).length, 3, '传送门/盟友/可破坏物经 setter 注入');

  for (const file of RENDERERS) {
    const source = read(file);
    assert.match(source, /sprite-coverage\.js/, `${file} 必须引用覆盖表`);
    assert.match(source, /\.draw\(/, `${file} 必须调用注入管线的 draw`);
    assert.match(source, /this\.sprites/, `${file} 必须使用注入的精灵管线`);
    assert.doesNotMatch(source, /\bnew Image\b/, `${file} 仍不得自己加载图片`);
  }

  const coverage = read('public/js/render/sprite-coverage.js');
  assert.doesNotMatch(coverage, /Math\.random/, '覆盖表不得使用随机数');
  assert.doesNotMatch(coverage, /\bnew Image\b|\bdocument\.|\bwindow\./, '覆盖表导入期不得触碰 DOM');
  const imports = [...coverage.matchAll(/^import .* from '([^']+)';/gm)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /\/sim(?:\.js|\/)/, '覆盖表不得 import 模拟层');
    assert.doesNotMatch(specifier, /\/render(?:\.js|\/)/, '覆盖表不得 import 渲染层');
  }
});

// ── 程序化美术内容（立绘 + 遗物图标）────────────────────────────────────────

// 记录型 2D 上下文替身：任何方法调用与属性赋值都按序记录，用于证明绘制确定性。
function recordingCtx() {
  const calls = [];
  const recorder = {
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...args) => calls.push(['translate', ...args]),
    beginPath: () => calls.push(['beginPath']),
    closePath: () => calls.push(['closePath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    ellipse: (...args) => calls.push(['ellipse', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
  };
  const ctx = new Proxy(recorder, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => calls.push([String(prop)]);
    },
    set(target, prop, value) {
      calls.push(['set', String(prop), value]);
      return true;
    },
  });
  Object.defineProperty(ctx, 'calls', { value: calls });
  return ctx;
}

test('美术覆盖登记：立绘覆盖 8 塔 + 敌人 + 3 首领变体，遗物图标覆盖全部遗物', () => {
  assert.deepEqual(ART_KINDS, ['portrait', 'relic-icon']);
  assert.deepEqual(portraitEntityIds(), [
    ...Object.keys(TOWERS).map((id) => `tower.${id}`),
    ...Object.keys(ENEMIES).map((id) => `enemy.${id}`),
    ...Object.keys(BOSS_VARIANTS).map((id) => `enemy.${id}`),
  ]);
  assert.equal(portraitEntityIds().length, 8 + Object.keys(ENEMIES).length + Object.keys(BOSS_VARIANTS).length);
  assert.deepEqual(relicIconIds(), RELICS.map((relic) => `relic.${relic.id}`));
  assert.equal(relicIconIds().length, RELICS.length);

  assert.deepEqual(ART_COVERAGE.portrait, portraitEntityIds());
  assert.deepEqual(ART_COVERAGE['relic-icon'], relicIconIds());
  assert.ok(Object.isFrozen(ART_COVERAGE));
  assert.ok(Object.isFrozen(ART_COVERAGE.portrait));
  assert.ok(Object.isFrozen(ART_COVERAGE['relic-icon']));

  assert.deepEqual(artCoverageGaps(portraitEntityIds(), 'portrait'), { kind: 'portrait', missing: [], extra: [], valid: true });
  assert.deepEqual(artCoverageGaps(relicIconIds(), 'relic-icon'), { kind: 'relic-icon', missing: [], extra: [], valid: true });
  assert.equal(artCoverageGaps([], 'unknown-kind').valid, false);
});

test('立绘确定性：portraitSpec 按实体 id 稳定、可解析、未知 id 返回 null', () => {
  for (const id of portraitEntityIds()) {
    const first = portraitSpec(id);
    const second = portraitSpec(id);
    assert.ok(first, `${id} 缺少立绘规格`);
    assert.deepEqual(first, second, `${id} 的立绘规格必须确定`);
    assert.equal(first.id, id);
    assert.ok(['tower', 'enemy', 'boss'].includes(first.family), `${id} 家族未知`);
    assert.match(first.color, /^#[0-9a-f]{6}$/i);
    assert.ok(first.sides >= 4 && first.sides <= 7, `${id} 边数越界`);
    assert.ok(first.bulk > 0.5 && first.bulk < 1, `${id} 占宽比越界`);
    assert.equal(first.jitter.length, first.sides);
    assert.ok(first.jitter.every((value) => Number.isFinite(value)));
    assert.ok(Number.isFinite(first.spikeCount));
  }
  assert.equal(portraitSpec('nope.nope'), null);
  assert.equal(portraitSpec(null), null);
  assert.equal(portraitSpec('tower.arrow').color, TOWERS.arrow.color, '塔立绘配色来自塔定义');
  assert.equal(portraitSpec('enemy.grunt').color, ENEMIES.grunt.color, '敌人立绘配色来自敌人定义');
  assert.equal(portraitSpec('enemy.armored').color, BOSS_VARIANTS.armored.color, '首领变体立绘配色来自变体定义');
});

test('遗物图标确定性：relicIconSpec 按遗物 id 稳定、稀有度配色正确、未知 id 返回 null', () => {
  assert.equal(RELIC_GLYPH_NAMES.length, 10);
  assert.equal(new Set(RELIC_GLYPH_NAMES).size, RELIC_GLYPH_NAMES.length, 'glyph 表不得重复');
  for (const relic of RELICS) {
    const first = relicIconSpec(relic.id);
    const second = relicIconSpec(relic.id);
    assert.ok(first, `relic.${relic.id} 缺少图标规格`);
    assert.deepEqual(first, second, `relic.${relic.id} 的图标规格必须确定`);
    assert.equal(first.color, RARITY[relic.rarity].color, `relic.${relic.id} 稀有度配色必须来自 RARITY`);
    assert.ok(RELIC_GLYPH_NAMES.includes(first.glyph), `relic.${relic.id} glyph 必须来自 glyph 表`);
    assert.equal(relicGlyphName(relic.id), first.glyph);
  }
  assert.equal(relicIconSpec('nope'), null);
  assert.equal(relicIconSpec(null), null);
  assert.equal(relicIconSpec('warlord').color, RARITY.epic.color);
  assert.equal(relicIconSpec('sharp').color, RARITY.common.color);
});

test('立绘与遗物图标绘制确定性：两次绘制产生相同指令序列', () => {
  const portraitIds = [
    portraitEntityIds()[0],
    portraitEntityIds()[8],
    portraitEntityIds()[portraitEntityIds().length - 1],
  ];
  for (const id of portraitIds) {
    const a = recordingCtx();
    const b = recordingCtx();
    assert.equal(drawPortrait(a, id, 96), true, `${id} 立绘应成功绘制`);
    assert.equal(drawPortrait(b, id, 96), true);
    assert.deepEqual(a.calls, b.calls, `${id} 立绘两次绘制必须一致`);
    assert.ok(a.calls.length > 0, `${id} 立绘应产生绘制指令`);
  }
  for (const relic of RELICS.slice(0, 3)) {
    const a = recordingCtx();
    const b = recordingCtx();
    assert.equal(drawRelicIcon(a, relic.id, 32), true, `relic.${relic.id} 图标应成功绘制`);
    assert.equal(drawRelicIcon(b, relic.id, 32), true);
    assert.deepEqual(a.calls, b.calls, `relic.${relic.id} 图标两次绘制必须一致`);
    assert.ok(a.calls.length > 0);
  }
  assert.equal(drawPortrait(recordingCtx(), 'nope.nope', 96), false);
  assert.equal(drawRelicIcon(recordingCtx(), 'nope', 32), false);
});

test('立绘/图标源码：零随机、零 DOM、不 import 模拟层', () => {
  for (const file of ['public/js/render/portrait-draw.js', 'public/js/render/relic-art.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /Math\.random/, `${file} 不得使用随机数`);
    assert.doesNotMatch(source, /\bnew Image\b|\bdocument\.|\bwindow\./, `${file} 导入期不得触碰 DOM`);
    assert.doesNotMatch(source, /from\s+'\.\.\/sim\.js'/, `${file} 不得依赖模拟模块`);
  }
});
