// 自检精灵资源与运行时清单的生成器：由声明式 spec 产出 @1x/@2x 图集 PNG、图集 JSON 与 manifest.json。
// 零第三方依赖：PNG 编码复用 scripts/lib/png.mjs（node:zlib + 自写 CRC32）。
// 可重复构建：不写时间戳、不读环境；同一 spec 连跑两次产物字节一致（AC-023 批量出图的前提）。
//
// 用法：node scripts/build-sprite-atlas.mjs [--check]
//   --check 只校验磁盘产物与重新生成的结果是否一致（CI 用），不写文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RgbaImage, blit, encodePng, fillRect, resizeNearest } from './lib/png.mjs';

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

// 清单是多生成器共享的：本脚本只负责自己的 probe 条目与图集声明，其它条目原样保留。
// 条目按 id 排序、图集名按字典序，任一生成器跑完都得到同一份字节（可重复构建）。
export function mergeManifest(previous, own) {
  const base = previous && typeof previous === 'object' ? previous : {};
  const ownIds = new Set(own.entries.map((entry) => entry.id));
  const kept = (Array.isArray(base.entries) ? base.entries : []).filter(
    (entry) => !ownIds.has(String(entry?.id || ''))
  );
  const entries = [...kept, ...own.entries].sort((a, b) => (String(a?.id) < String(b?.id) ? -1 : 1));
  const atlases = { ...(base.atlases || {}), ...own.atlases };
  const orderedAtlases = Object.fromEntries(
    Object.entries(atlases).sort(([a], [b]) => (a < b ? -1 : 1))
  );
  return {
    version: base.version || own.version,
    generator: base.generator || own.generator,
    atlases: orderedAtlases,
    entries,
  };
}

// ── 场景精灵图集（AC-031） ───────────────────────────────────────────────────
// 四个场景（标题 / 选图 / 战斗 / 结算）的美术资源由声明式 spec 定义，
// 与 probe 共用同一份 manifest：本脚本只改自己的条目与图集声明，其它条目原样保留。
// 画面全部由固定算式生成（无随机源、无时间戳），同一 spec 两次执行字节一致。
export const SCENE_DIR = 'public/assets/sprites/scenes';
export const SCENE_ATLAS_NAME = 'scene-atlas';
export const SCENE_IMAGE_PATH = `${SCENE_DIR}/scene-atlas@1x.png`;
export const SCENE_IMAGE_2X_PATH = `${SCENE_DIR}/scene-atlas@2x.png`;
export const SCENE_JSON_PATH = `${SCENE_DIR}/scene-atlas.json`;
// 图集按行排布：单行不超过 1024 逻辑像素，@2x 仍在 2048 上限内。
export const SCENE_SHELF_WIDTH = 1024;

export const SCENE_PROVENANCE = Object.freeze({
  source: '自带程序生成',
  author: 'scripts/build-sprite-atlas.mjs',
  license: 'proprietary-internal',
  url: '-',
  retrievedAt: '2026-10-27',
});

// id 与 docs/PHASE_FEEL_ART.md §4.4 / public/js/shared/scene-sprites.js 一一对应；
// paint 决定画面，pivot 决定 DOM 与 Canvas 的对齐原点。
export const SCENE_SPRITE_SPEC = Object.freeze([
  { id: 'bg/scene-title', frame: 'scene-title', size: { w: 480, h: 270 }, paint: 'titleBackground' },
  { id: 'ui/scene-title-logo', frame: 'scene-title-logo', size: { w: 96, h: 96 }, paint: 'titleLogo' },
  { id: 'ui/scene-map-card', frame: 'scene-map-card', size: { w: 160, h: 64 }, paint: 'mapCard' },
  { id: 'ui/scene-map-thumbnail', frame: 'scene-map-thumbnail', size: { w: 96, h: 96 }, paint: 'mapThumbnail' },
  { id: 'bg/scene-combat', frame: 'scene-combat', size: { w: 480, h: 270 }, paint: 'combatBackground' },
  { id: 'ui/scene-combat-hud', frame: 'scene-combat-hud', size: { w: 96, h: 48 }, paint: 'combatHud' },
  { id: 'ui/scene-result-panel', frame: 'scene-result-panel', size: { w: 240, h: 120 }, paint: 'resultPanel' },
  { id: 'fx/scene-title-particles', frame: 'scene-title-particles', size: { w: 64, h: 64 }, paint: 'titleParticles' },
  { id: 'ui/scene-map-badge', frame: 'scene-map-badge', size: { w: 48, h: 48 }, paint: 'mapBadge' },
  { id: 'fx/scene-combat-ambience', frame: 'scene-combat-ambience', size: { w: 96, h: 48 }, paint: 'combatAmbience' },
  { id: 'ui/scene-result-badge', frame: 'scene-result-badge', size: { w: 48, h: 48 }, paint: 'resultBadge' },
]);

// 确定性噪声：与坐标绑定的整数哈希，返回 [0, 1)。不使用 Math.random。
function noise01(x, y, seed = 0) {
  let value = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function blendPixel(image, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || a <= 0) return;
  const i = (y * image.width + x) * 4;
  const alpha = a / 255;
  const keep = 1 - alpha;
  image.data[i] = Math.round(r * alpha + image.data[i] * keep);
  image.data[i + 1] = Math.round(g * alpha + image.data[i + 1] * keep);
  image.data[i + 2] = Math.round(b * alpha + image.data[i + 2] * keep);
  image.data[i + 3] = Math.min(255, Math.round(255 * alpha + image.data[i + 3] * keep));
}

function blendRect(image, x, y, width, height, color) {
  for (let row = Math.max(0, y); row < Math.min(image.height, y + height); row++) {
    for (let col = Math.max(0, x); col < Math.min(image.width, x + width); col++) {
      blendPixel(image, col, row, color);
    }
  }
}

function strokeRect(image, x, y, width, height, color, thickness = 1) {
  blendRect(image, x, y, width, thickness, color);
  blendRect(image, x, y + height - thickness, width, thickness, color);
  blendRect(image, x, y, thickness, height, color);
  blendRect(image, x + width - thickness, y, thickness, height, color);
}

function blendDisc(image, cx, cy, radius, color) {
  for (let row = Math.floor(cy - radius); row <= Math.ceil(cy + radius); row++) {
    for (let col = Math.floor(cx - radius); col <= Math.ceil(cx + radius); col++) {
      const dx = col + 0.5 - cx;
      const dy = row + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) blendPixel(image, col, row, color);
    }
  }
}

function verticalGradient(image, top, bottom) {
  for (let row = 0; row < image.height; row++) {
    const t = image.height > 1 ? row / (image.height - 1) : 0;
    const color = top.map((value, index) => Math.round(value + (bottom[index] - value) * t));
    blendRect(image, 0, row, image.width, 1, color);
  }
}

// 每个绘制函数只写一块 w×h 的局部画布，排版由图集打包统一负责。
const SCENE_PAINTERS = {
  titleBackground(w, h) {
    const image = new RgbaImage(w, h);
    verticalGradient(image, [6, 12, 22, 255], [13, 35, 45, 255]);
    // 地平线暖光：越靠近 y=0.74h 越亮，向上下衰减。
    const horizon = Math.round(h * 0.74);
    for (let row = 0; row < h; row++) {
      const distance = Math.abs(row - horizon);
      const alpha = Math.max(0, Math.round(52 - distance * 0.5));
      if (alpha > 0) blendRect(image, 0, row, w, 1, [255, 196, 108, alpha]);
    }
    // 星点：7×7 网格上的哈希取样，密度稳定且可复现。
    for (let y = 4; y < horizon; y += 7) {
      for (let x = 4; x < w; x += 7) {
        const pick = noise01(x, y, 17);
        if (pick > 0.82) blendPixel(image, x, y, [214, 240, 255, 120 + Math.round(pick * 80)]);
      }
    }
    // 远景剪影：三座塔的轮廓，底部压暗以托住标题卡。
    const base = h - 8;
    for (const [cx, tw, th] of [[76, 26, 74], [232, 34, 96], [398, 22, 60]]) {
      const top = base - th;
      blendRect(image, cx - tw / 2, top, tw, th, [4, 9, 15, 230]);
      blendRect(image, cx - tw / 2 - 6, top - 10, tw + 12, 12, [4, 9, 15, 230]);
      blendDisc(image, cx, top - 15, tw / 3, [92, 226, 208, 150]);
    }
    blendRect(image, 0, h - 8, w, 8, [3, 7, 12, 240]);
    return image;
  },

  titleLogo(w, h) {
    const image = new RgbaImage(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.36;
    // 菱形晶体：先画外发光，再画描边与内芯。
    blendDisc(image, cx, cy, radius * 1.35, [255, 211, 107, 26]);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const nx = Math.abs(col + 0.5 - cx);
        const ny = Math.abs(row + 0.5 - cy);
        const edge = nx / radius + ny / radius;
        if (edge > 0.86 && edge <= 1) blendPixel(image, col, row, [255, 211, 107, 255]);
        else if (edge <= 0.86 && edge > 0.5) blendPixel(image, col, row, [92, 226, 208, 190]);
        else if (edge <= 0.5) blendPixel(image, col, row, [255, 246, 216, 230]);
      }
    }
    blendRect(image, Math.round(cx - 2), Math.round(cy - radius * 0.55), 4, Math.round(radius * 1.1), [10, 22, 30, 220]);
    return image;
  },

  mapCard(w, h) {
    const image = new RgbaImage(w, h);
    blendRect(image, 0, 0, w, h, [11, 21, 32, 235]);
    strokeRect(image, 0, 0, w, h, [92, 226, 208, 190], 2);
    // 三条候选路线：高度由固定比例决定，不按地图数据变化。
    for (const [index, ratio] of [0.28, 0.5, 0.74].entries()) {
      const y = Math.round(h * ratio);
      for (let x = 6; x < w - 6; x++) blendPixel(image, x, y, [92, 226, 208, 70 + index * 20]);
    }
    blendDisc(image, w - 14, Math.round(h * 0.5), 5, [255, 211, 107, 235]);
    blendDisc(image, 14, Math.round(h * 0.28), 4, [214, 240, 255, 220]);
    return image;
  },

  mapThumbnail(w, h) {
    const image = new RgbaImage(w, h);
    blendRect(image, 0, 0, w, h, [7, 15, 24, 220]);
    strokeRect(image, 0, 0, w, h, [64, 120, 140, 180], 1);
    const cell = Math.floor(w / 6);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        const shade = 26 + Math.round(noise01(col, row, 5) * 26);
        blendRect(image, col * cell + 1, row * cell + 1, cell - 2, cell - 2, [18, shade, shade + 8, 160]);
      }
    }
    // 主路线：折线段，坐标固定。
    const path = [[cell * 0.5, h - 4], [cell * 2.5, cell * 4], [cell * 4, cell * 2], [w - 6, cell * 0.8]];
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        blendDisc(image, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1.4, [255, 211, 107, 200]);
      }
    }
    blendDisc(image, w - 8, 8, 3.5, [92, 226, 208, 235]);
    return image;
  },

  // 战斗景观层：**全透明底 + 只加光**。地形（路径 / 塔位 / 网格）由程序化背景承载，
  // 这一层不得压暗它，否则会违反「信息优先」；缺这层时画面与接入前逐像素一致。
  combatBackground(w, h) {
    const image = new RgbaImage(w, h);
    // 战场网格：每 24 逻辑像素一条，青蓝光带，只提亮不遮挡。
    for (let x = 0; x < w; x += 24) blendRect(image, x, 0, 1, h, [92, 226, 208, 26]);
    for (let y = 0; y < h; y += 24) blendRect(image, 0, y, w, 1, [92, 226, 208, 20]);
    // 地平线暖光：中央一条，向上下淡出。
    for (let row = 0; row < h; row++) {
      const distance = Math.abs(row - h / 2);
      const alpha = Math.max(0, Math.round(24 - distance * 0.18));
      if (alpha > 0) blendRect(image, 0, row, w, 1, [255, 211, 107, alpha]);
    }
    // 能量微粒：固定网格上的稀疏亮点，用于「战斗氛围」的可辨识细节。
    for (let y = 12; y < h; y += 36) {
      for (let x = 18; x < w; x += 42) {
        if (noise01(x, y, 29) > 0.6) blendDisc(image, x, y, 1.6, [180, 240, 255, 170]);
      }
    }
    // 四角冷光：给屏幕边缘一个收拢的光晕，不改变地明亮度。
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      for (let step = 5; step > 0; step--) {
        blendDisc(image, cx, cy, step * 9, [92, 226, 208, 8]);
      }
    }
    return image;
  },

  combatHud(w, h) {
    const image = new RgbaImage(w, h);
    blendRect(image, 0, 0, w, h, [9, 18, 27, 215]);
    strokeRect(image, 0, 0, w, h, [130, 170, 190, 170], 1);
    // 四角括号：HUD 皮肤的识别特征。
    const corner = 12;
    for (const [x, y, sx, sy] of [[2, 2, 1, 1], [w - 3, 2, -1, 1], [2, h - 3, 1, -1], [w - 3, h - 3, -1, -1]]) {
      for (let i = 0; i < corner; i++) {
        blendPixel(image, x + sx * i, y, [255, 211, 107, 220]);
        blendPixel(image, x, y + sy * i, [255, 211, 107, 220]);
      }
    }
    blendRect(image, 14, Math.round(h / 2) - 2, w - 52, 4, [92, 226, 208, 190]);
    blendRect(image, w - 28, Math.round(h / 2) - 6, 12, 12, [255, 211, 107, 220]);
    return image;
  },

  resultPanel(w, h) {
    const image = new RgbaImage(w, h);
    blendRect(image, 2, 2, w - 4, h - 4, [10, 20, 30, 225]);
    strokeRect(image, 1, 1, w - 2, h - 2, [255, 211, 107, 200], 2);
    strokeRect(image, 6, 6, w - 12, h - 12, [92, 226, 208, 90], 1);
    for (const [cx, cy] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) {
      blendDisc(image, cx, cy, 4, [255, 211, 107, 230]);
    }
    blendRect(image, 24, Math.round(h * 0.22), w - 48, 2, [255, 211, 107, 120]);
    blendRect(image, 24, Math.round(h * 0.78), w - 48, 2, [92, 226, 208, 120]);
    return image;
  },

  titleParticles(w, h) {
    const image = new RgbaImage(w, h);
    for (let y = 4; y < h; y += 8) {
      for (let x = 4; x < w; x += 8) {
        if (noise01(x, y, 41) > 0.68) blendDisc(image, x, y, 1.5, [214, 240, 255, 170]);
      }
    }
    return image;
  },

  mapBadge(w, h) {
    const image = new RgbaImage(w, h);
    blendDisc(image, w / 2, h / 2, Math.min(w, h) * 0.34, [92, 226, 208, 210]);
    blendDisc(image, w / 2, h / 2, Math.min(w, h) * 0.2, [10, 22, 30, 255]);
    blendRect(image, w / 2 - 2, 10, 4, h - 20, [255, 211, 107, 230]);
    return image;
  },

  combatAmbience(w, h) {
    const image = new RgbaImage(w, h);
    for (let band = 0; band < 3; band++) {
      const y = Math.round(h * (0.3 + band * 0.2));
      for (let x = 0; x < w; x++) {
        const wave = Math.sin((x / w) * Math.PI * 2 + band) * 3;
        blendPixel(image, x, Math.round(y + wave), [120, 200, 230, 70]);
        blendPixel(image, x, Math.round(y + wave) + 1, [120, 200, 230, 40]);
      }
    }
    return image;
  },

  resultBadge(w, h) {
    const image = new RgbaImage(w, h);
    const cx = w / 2;
    const cy = h / 2;
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const x = cx + Math.cos(angle) * Math.min(w, h) * 0.36;
      const y = cy + Math.sin(angle) * Math.min(w, h) * 0.36;
      blendDisc(image, x, y, 4, [255, 211, 107, 235]);
      for (let t = 0; t < 0.7; t += 0.05) {
        blendPixel(image, cx + (x - cx) * t, cy + (y - cy) * t, [255, 211, 107, 130]);
      }
    }
    blendDisc(image, cx, cy, 5, [255, 246, 216, 240]);
    return image;
  },
};

// 固定顺序的货架式打包：每行从左到右，行高取该行最高帧；结果只取决于 spec 顺序。
export function layoutSceneAtlas(spec = SCENE_SPRITE_SPEC, maxWidth = SCENE_SHELF_WIDTH) {
  const frames = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let atlasWidth = 0;
  for (const entry of spec) {
    if (x > 0 && x + entry.size.w > maxWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    frames.push({ entry, rect: { x, y, w: entry.size.w, h: entry.size.h } });
    x += entry.size.w;
    rowHeight = Math.max(rowHeight, entry.size.h);
    atlasWidth = Math.max(atlasWidth, x);
  }
  return { frames, width: atlasWidth, height: y + rowHeight };
}

export function buildSceneAtlasImage(spec = SCENE_SPRITE_SPEC, layout = layoutSceneAtlas(spec)) {
  const image = new RgbaImage(layout.width, layout.height);
  for (const { entry, rect } of layout.frames) {
    const painter = SCENE_PAINTERS[entry.paint];
    if (!painter) throw new Error(`场景精灵缺少绘制函数：${entry.id} → ${entry.paint}`);
    blit(image, painter(rect.w, rect.h), rect.x, rect.y);
  }
  return image;
}

export function buildSceneAtlas2x(spec = SCENE_SPRITE_SPEC, layout = layoutSceneAtlas(spec)) {
  const base = buildSceneAtlasImage(spec, layout);
  return resizeNearest(base, layout.width * 2, layout.height * 2);
}

export function buildSceneAtlasJson(spec = SCENE_SPRITE_SPEC, layout = layoutSceneAtlas(spec)) {
  const frames = {};
  for (const { entry, rect } of layout.frames) {
    frames[entry.frame] = {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      pivot: { x: 0.5, y: 0.5 },
      sourceSize: { ...entry.size },
      offset: { x: 0, y: 0 },
      trimmed: false,
      rotated: false,
      spriteId: entry.id,
    };
  }
  return {
    name: SCENE_ATLAS_NAME,
    image: path.basename(SCENE_IMAGE_PATH, '.png'),
    size: { w: layout.width, h: layout.height },
    pivot: { x: 0.5, y: 0.5 },
    frames,
  };
}

export function buildSceneManifest(spec = SCENE_SPRITE_SPEC, layout = layoutSceneAtlas(spec)) {
  const src = `/${SCENE_IMAGE_PATH.replace(/^public\//, '')}`;
  const srcs = { 1: src, 2: `/${SCENE_IMAGE_2X_PATH.replace(/^public\//, '')}` };
  return {
    version: 1,
    generator: 'scripts/build-sprite-atlas.mjs',
    atlases: {
      [SCENE_ATLAS_NAME]: {
        json: `/${SCENE_JSON_PATH.replace(/^public\//, '')}`,
        images: { ...srcs },
        size: { w: layout.width, h: layout.height },
      },
    },
    entries: spec.map((entry) => ({
      id: entry.id,
      path: SCENE_IMAGE_PATH,
      src,
      srcs: { ...srcs },
      size: { ...entry.size },
      anchor: 'center',
      pivot: { x: 0.5, y: 0.5 },
      frames: 1,
      states: ['idle'],
      status: 'ready',
      dpr: [1, 2],
      atlas: SCENE_ATLAS_NAME,
      frame: entry.frame,
      compression: 'lossless',
      provenance: { ...SCENE_PROVENANCE },
      license: SCENE_PROVENANCE.license,
      generator: 'procedural-canvas2d',
    })),
  };
}

function readDiskManifest(root = ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
  } catch {
    return null;
  }
}

// 产物清单：路径相对仓库根 → Buffer。顺序固定，便于比较。
// 本脚本同时拥有 probe 与场景两组产物；manifest 依次合并两组自有条目，
// 其它生成器（实体图集）的条目原样保留。
export function buildArtifacts(
  spec = SPRITE_SPEC,
  { root = ROOT, previous = readDiskManifest(root), sceneSpec = SCENE_SPRITE_SPEC } = {}
) {
  const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const layout = layoutSceneAtlas(sceneSpec);
  const manifest = mergeManifest(mergeManifest(previous, buildManifest(spec)), buildSceneManifest(sceneSpec, layout));
  return [
    { path: ATLAS_IMAGE_PATH, data: encodePng(buildAtlasImage(spec)) },
    { path: ATLAS_IMAGE_2X_PATH, data: encodePng(buildAtlas2x(spec)) },
    { path: ATLAS_JSON_PATH, data: json(buildAtlasJson(spec)) },
    { path: SCENE_IMAGE_PATH, data: encodePng(buildSceneAtlasImage(sceneSpec, layout)) },
    { path: SCENE_IMAGE_2X_PATH, data: encodePng(buildSceneAtlas2x(sceneSpec, layout)) },
    { path: SCENE_JSON_PATH, data: json(buildSceneAtlasJson(sceneSpec, layout)) },
    { path: MANIFEST_PATH, data: json(manifest) },
  ];
}

// 写出全部产物；返回写入的路径。--check 只比对不写。
export function writeArtifacts({ root = ROOT, check = false, spec = SPRITE_SPEC } = {}) {
  const artifacts = buildArtifacts(spec, { root });
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
