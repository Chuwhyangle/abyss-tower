// 单位精灵覆盖证明（AC-023）：覆盖集与数据表严格相等、状态帧互异、清单可解析、
// 生成器可重复、纯状态选择器与渲染接线。只读数据表与产物，不改变模拟层。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import { BOSS_VARIANTS } from '../public/js/shared/data/enemies.js';
import { DESTRUCTIBLE_TYPES } from '../public/js/shared/destructibles.js';
import {
  BASE_ENTITY_ID,
  ENTITY_SPRITES,
  ENTITY_SPRITE_FAMILIES,
  PORTAL_ENTITY_ID,
  SUMMON_KINDS,
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
  summonSpriteId,
  summonSpriteState,
  towerFormId,
  towerSpriteId,
  towerSpriteState,
} from '../public/js/render/sprite-coverage.js';
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
