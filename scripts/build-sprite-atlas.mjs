// 自检精灵资源与运行时清单的生成器：由声明式 spec 产出 @1x/@2x 图集 PNG、图集 JSON 与 manifest.json。
// 零第三方依赖：PNG 编码复用 scripts/lib/png.mjs（node:zlib + 自写 CRC32）。
// 可重复构建：不写时间戳、不读环境；同一 spec 连跑两次产物字节一致（AC-023 批量出图的前提）。
//
// 用法：node scripts/build-sprite-atlas.mjs [--check]
//   --check 只校验磁盘产物与重新生成的结果是否一致（CI 用），不写文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RgbaImage, encodePng, fillRect, resizeNearest } from './lib/png.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 目录与命名遵循 docs/ASSET_PIPELINE.md：DPR 1 不带后缀、@2x 加后缀；
// 图集是构建产物，JSON 记录 frames / pivot / size（逻辑像素，@2x 由倍率推导）。
export const PROBE_DIR = 'public/assets/sprites/probe';
export const MANIFEST_PATH = 'public/assets/sprites/manifest.json';
export const ATLAS_IMAGE_PATH = `${PROBE_DIR}/probe.png`;
export const ATLAS_IMAGE_2X_PATH = `${PROBE_DIR}/probe@2x.png`;
export const ATLAS_JSON_PATH = `${PROBE_DIR}/probe-atlas.json`;

// 两帧覆盖两种打包形态：probe-idle-0 未裁剪，probe-idle-1 裁剪后在源图里有位移。
export const SPRITE_SPEC = Object.freeze({
  entryId: 'fx/probe',
  atlasName: 'probe-atlas',
  size: { w: 32, h: 16 },
  pivot: { x: 0.5, y: 0.5 },
  anchor: 'center',
  states: ['idle'],
  dpr: [1, 2],
  atlas: { w: 48, h: 16 },
  frames: [
    {
      name: 'probe-idle-0',
      rect: { x: 0, y: 0, w: 32, h: 16 },
      offset: { x: 0, y: 0 },
      trimmed: false,
      color: [255, 0, 255, 255],
    },
    {
      name: 'probe-idle-1',
      rect: { x: 32, y: 0, w: 16, h: 12 },
      offset: { x: 8, y: 2 },
      trimmed: true,
      color: [0, 255, 255, 255],
    },
  ],
  provenance: {
    source: '自带程序生成',
    author: 'scripts/build-sprite-atlas.mjs',
    license: 'proprietary-internal',
    url: '-',
    retrievedAt: '2026-10-27',
  },
});

// @1x 图集：每帧一块纯色矩形；再叠一条更亮的对角线，像素读回时能与背景区分。
export function buildAtlasImage(spec = SPRITE_SPEC) {
  const image = new RgbaImage(spec.atlas.w, spec.atlas.h);
  for (const frame of spec.frames) {
    const { x, y, w, h } = frame.rect;
    fillRect(image, x, y, w, h, frame.color);
    const [r, g, b] = frame.color;
    for (let step = 0; step < Math.min(w, h); step++) {
      fillRect(image, x + step, y + step, 1, 1, [255, 255 - r, 255 - b, 255]);
      fillRect(image, x + w - 1 - step, y + step, 1, 1, [r, g, 255, 255]);
    }
  }
  return image;
}

export function buildAtlas2x(spec = SPRITE_SPEC) {
  const base = buildAtlasImage(spec);
  return resizeNearest(base, spec.atlas.w * 2, spec.atlas.h * 2);
}

export function buildAtlasJson(spec = SPRITE_SPEC) {
  const frames = {};
  for (const frame of spec.frames) {
    frames[frame.name] = {
      x: frame.rect.x,
      y: frame.rect.y,
      w: frame.rect.w,
      h: frame.rect.h,
      pivot: { ...spec.pivot },
      sourceSize: { ...spec.size },
      offset: { ...frame.offset },
      trimmed: frame.trimmed,
      rotated: false,
    };
  }
  return {
    name: spec.atlasName,
    image: path.basename(ATLAS_IMAGE_PATH, '.png'),
    size: { ...spec.atlas },
    pivot: { ...spec.pivot },
    frames,
  };
}

export function buildManifest(spec = SPRITE_SPEC) {
  return {
    version: 1,
    generator: 'scripts/build-sprite-atlas.mjs',
    atlases: {
      [spec.atlasName]: {
        json: `/${ATLAS_JSON_PATH.replace(/^public\//, '')}`,
        images: {
          1: `/${ATLAS_IMAGE_PATH.replace(/^public\//, '')}`,
          2: `/${ATLAS_IMAGE_2X_PATH.replace(/^public\//, '')}`,
        },
        size: { ...spec.atlas },
      },
    },
    entries: [
      {
        id: spec.entryId,
        path: ATLAS_IMAGE_PATH,
        src: `/${ATLAS_IMAGE_PATH.replace(/^public\//, '')}`,
        srcs: {
          1: `/${ATLAS_IMAGE_PATH.replace(/^public\//, '')}`,
          2: `/${ATLAS_IMAGE_2X_PATH.replace(/^public\//, '')}`,
        },
        size: { ...spec.size },
        anchor: spec.anchor,
        pivot: { ...spec.pivot },
        frames: spec.frames.length,
        states: [...spec.states],
        status: 'ready',
        dpr: [...spec.dpr],
        atlas: spec.atlasName,
        frame: spec.frames[0].name,
        compression: 'lossless',
        provenance: { ...spec.provenance },
        license: spec.provenance.license,
        generator: 'procedural-canvas2d',
      },
    ],
  };
}

// 产物清单：路径相对仓库根 → Buffer。顺序固定，便于比较。
export function buildArtifacts(spec = SPRITE_SPEC) {
  const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return [
    { path: ATLAS_IMAGE_PATH, data: encodePng(buildAtlasImage(spec)) },
    { path: ATLAS_IMAGE_2X_PATH, data: encodePng(buildAtlas2x(spec)) },
    { path: ATLAS_JSON_PATH, data: json(buildAtlasJson(spec)) },
    { path: MANIFEST_PATH, data: json(buildManifest(spec)) },
  ];
}

// 写出全部产物；返回写入的路径。--check 只比对不写。
export function writeArtifacts({ root = ROOT, check = false, spec = SPRITE_SPEC } = {}) {
  const artifacts = buildArtifacts(spec);
  const changed = [];
  for (const artifact of artifacts) {
    const target = path.join(root, artifact.path);
    if (check) {
      let current = null;
      try {
        current = fs.readFileSync(target);
      } catch {
        current = null;
      }
      if (!current || !current.equals(artifact.data)) changed.push(artifact.path);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, artifact.data);
  }
  return { artifacts, changed };
}

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const { changed } = writeArtifacts({ check: true });
    if (changed.length) {
      console.error(`精灵资源与生成器不一致（${changed.length} 个文件）：`);
      for (const file of changed) console.error(`  ✗ ${file}`);
      return 1;
    }
    console.log('精灵自检资源与生成器一致');
    return 0;
  }
  const { artifacts } = writeArtifacts();
  for (const artifact of artifacts) {
    console.log(`写入 ${artifact.path}（${artifact.data.length} 字节）`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
