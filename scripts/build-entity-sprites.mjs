// 单位精灵图集生成器：由覆盖表（sprite-coverage.js）与静态数据生成六类实体的 @1x/@2x 图集、
// 图集 JSON，并把实体条目合并进运行时清单（保留 AC-022 的 probe 条目不动）。
// 零第三方依赖：PNG 编码复用 scripts/lib/png.mjs（node:zlib + 自写 CRC32）。
// 可重复构建：不写时间戳、不读环境、不用随机数；同一表连跑两次产物字节一致。
//
// 用法：node scripts/build-entity-sprites.mjs [--check]
//   --check 只校验磁盘产物与重新生成的结果是否一致（CI 用），不写文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENEMIES, TOWERS } from '../public/js/shared/data.js';
import { BOSS_VARIANTS } from '../public/js/shared/data/enemies.js';
import { DESTRUCTIBLE_BY_ID } from '../public/js/shared/destructibles.js';
import {
  ENEMY_SPRITE_RADIUS,
  ENTITY_SPRITE_FAMILIES,
  ENTITY_STATE_TOKENS,
  SUMMON_SPRITE_RADIUS,
  entityRecords,
  entitySpriteIds,
} from '../public/js/render/sprite-coverage.js';
import { RgbaImage, blit, encodePng, fillRect as fillImageRect, resizeNearest } from './lib/png.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ENTITY_DIR = 'public/assets/sprites/entities';
export const ATLAS_NAME = 'entity-atlas';
export const ATLAS_IMAGE_PATH = `${ENTITY_DIR}/${ATLAS_NAME}@1x.png`;
export const ATLAS_IMAGE_2X_PATH = `${ENTITY_DIR}/${ATLAS_NAME}@2x.png`;
export const ATLAS_JSON_PATH = `${ENTITY_DIR}/entity-atlas.json`;
export const MANIFEST_PATH = 'public/assets/sprites/manifest.json';
export const CONTACT_SHEET_PRIMARY = 'docs/reviews/entity-sprite-coverage-contact-sheet.png';
export const CONTACT_SHEET_STATES = 'docs/reviews/entity-sprite-states-contact-sheet.png';

// 帧是 48×48（= 1 格）：单位锚点在画布中心，不同状态帧因此不会漂移。
export const FRAME_SIZE = 48;
export const ATLAS_COLUMNS = 21;
export const ENTITY_GENERATOR = 'scripts/build-entity-sprites.mjs';
export const ENTITY_PROVENANCE_DATE = '2026-10-27';

// ── 位图工具（只在本脚本内使用；产出确定性纯像素图） ────────────────────────
function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return [204, 204, 204];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const rgba = (hex, alpha = 255) => [...hexToRgb(hex), alpha];

function blendPixel(image, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || a <= 0) return;
  const i = (y * image.width + x) * 4;
  const alpha = a / 255;
  const keep = 1 - alpha;
  image.data[i] = Math.round(r * alpha + image.data[i] * keep);
  image.data[i + 1] = Math.round(g * alpha + image.data[i + 1] * keep);
  image.data[i + 2] = Math.round(b * alpha + image.data[i + 2] * keep);
  image.data[i + 3] = Math.round(255 * alpha + image.data[i + 3] * keep);
}

function fillCircle(image, cx, cy, radius, color) {
  const r = Math.max(0, radius);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) blendPixel(image, x, y, color);
    }
  }
}

function strokeCircle(image, cx, cy, radius, width, color) {
  const outer = radius + width / 2;
  const inner = Math.max(0, radius - width / 2);
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y += 1) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= outer && distance >= inner) blendPixel(image, x, y, color);
    }
  }
}

function drawLine(image, x0, y0, x1, y1, width, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
  const half = Math.max(0.5, width / 2);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    for (let dy = -half; dy <= half; dy += 1) {
      for (let dx = -half; dx <= half; dx += 1) blendPixel(image, Math.round(cx + dx), Math.round(cy + dy), color);
    }
  }
}

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fillPolygon(image, points, color) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(image.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(image.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (inPolygon(x + 0.5, y + 0.5, points)) blendPixel(image, x, y, color);
    }
  }
}

function fillRect(image, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) blendPixel(image, col, row, color);
  }
}

function regularPolygon(cx, cy, radius, sides, rotation = 0) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function strokePolygon(image, points, width, color) {
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    drawLine(image, x0, y0, x1, y1, width, color);
  }
}

// ── 实体配色（全部来自静态数据，不新增色板） ────────────────────────────────
function towerColor(entityId) {
  if (TOWERS[entityId]) return TOWERS[entityId].color;
  for (const def of Object.values(TOWERS)) {
    const evolution = def.evolutions?.find((entry) => entry.id === entityId);
    if (evolution) return evolution.color;
  }
  return '#cccccc';
}

function enemyColor(entityId) {
  return ENEMIES[entityId]?.color || BOSS_VARIANTS[entityId]?.color || '#cccccc';
}

function entityColor(record) {
  switch (record.family) {
    case 'tower':
      return towerColor(record.entityId);
    case 'enemy':
      return enemyColor(record.entityId);
    case 'summon':
      return '#22d3ee';
    case 'destructible':
      return DESTRUCTIBLE_BY_ID[record.entityId]?.color || '#cccccc';
    case 'portal':
      return '#c9a8ff';
    default:
      return '#5ce2b0';
  }
}

// 状态标识色：同实体的不同状态在小徽标上就有可见差异，同时是像素哈希互异的保证。
const STATE_MARKS = Object.freeze({
  idle: '#7ce38b',
  attack: '#ffd36b',
  disabled: '#ef5f5f',
  move: '#7ce38b',
  hit: '#ffffff',
  cast: '#e2609e',
  alive: '#7ce38b',
  ruined: '#8a8f98',
  charge: '#63e6ff',
  hurt: '#ef5f5f',
});

// ── 各族形体：先画轮廓，再按状态叠姿态差异 ─────────────────────────────────
const CENTER = FRAME_SIZE / 2;

function drawTower(image, record, state) {
  const color = rgba(entityColor(record), 235);
  const dark = rgba('#0a1116');
  const inner = rgba('#121d24');
  const recoil = state === 'attack' ? 3 : 0;
  fillPolygon(image, regularPolygon(CENTER, CENTER, 20, 8, Math.PI / 8), dark);
  strokePolygon(image, regularPolygon(CENTER, CENTER, 20, 8, Math.PI / 8), 2, color);
  fillPolygon(image, regularPolygon(CENTER, CENTER, 14, 8, Math.PI / 8), inner);
  strokeCircle(image, CENTER, CENTER, 12, 1.2, rgba(entityColor(record), 90));
  fillRect(image, CENTER - 5 - recoil, CENTER - 4, 17, 8, color);
  fillCircle(image, CENTER + 13 - recoil, CENTER, 4, rgba('#1b1c1b'));
  strokeCircle(image, CENTER + 13 - recoil, CENTER, 5, 1.2, color);
  fillCircle(image, CENTER, CENTER, 3, rgba('#ffffff', 200));
  if (state === 'attack') {
    const muzzle = CENTER + 19 - recoil;
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      drawLine(image, muzzle, CENTER, muzzle + Math.cos(angle) * 5, CENTER + Math.sin(angle) * 5, 1.4, rgba('#ffe6a0', 220));
    }
  }
  if (state === 'disabled') {
    fillCircle(image, CENTER, CENTER, 20, rgba('#06090c', 140));
    drawLine(image, CENTER - 12, CENTER - 12, CENTER + 12, CENTER + 12, 1.4, rgba('#ff8a6b', 200));
  }
}

// 敌人轮廓按静态数据的 shape 分派；未知 shape 回退圆形体。
function enemySilhouette(shape, cx, cy, r) {
  switch (shape) {
    case 'dart':
      return [[cx - r, cy - r * 0.7], [cx + r * 1.2, cy], [cx - r, cy + r * 0.7]];
    case 'hex':
    case 'shield':
      return regularPolygon(cx, cy, r, 6, Math.PI / 6);
    case 'bug':
      return regularPolygon(cx, cy, r * 0.8, 6, 0);
    case 'boss':
    case 'boss-armored':
    case 'boss-summoner':
    case 'boss-berserk':
      return regularPolygon(cx, cy, r * 1.2, 6, Math.PI / 6);
    case 'wing':
      return regularPolygon(cx, cy, r * 0.85, 8, Math.PI / 8);
    default:
      return regularPolygon(cx, cy, r, 10, 0);
  }
}

function drawEnemy(image, record, state) {
  const def = ENEMIES[record.entityId];
  const variant = BOSS_VARIANTS[record.entityId];
  const shape = variant?.shape || def?.shape || 'blob';
  const hex = entityColor(record);
  const color = rgba(hex, 235);
  const boss = Boolean(def?.boss || variant);
  // 帧内统一标称半径：渲染器按实体模拟半径等比缩放，图集本身不预设体型差。
  const radius = ENEMY_SPRITE_RADIUS;
  const cy = CENTER - (boss ? 2 : 1);
  const body = enemySilhouette(shape, CENTER, cy, radius);
  // 地面阴影：所有状态都有，保证脚底锚点在帧内稳定。
  fillCircle(image, CENTER, CENTER + 16, radius * 0.8, rgba('#000000', 70));
  fillPolygon(image, body, rgba(hex, 60));
  strokePolygon(image, body, 2, color);
  fillCircle(image, CENTER, cy, radius * 0.32, color);

  if (shape === 'bug' || shape === 'dart') {
    for (let i = -1; i <= 1; i += 1) {
      drawLine(image, CENTER - radius * 0.6, cy + i * 5, CENTER - radius * 1.2, cy + i * 7, 1, color);
      drawLine(image, CENTER + radius * 0.6, cy + i * 5, CENTER + radius * 1.2, cy + i * 7, 1, color);
    }
  }
  if (shape === 'wing') {
    drawLine(image, CENTER - radius, cy - 4, CENTER - radius * 1.6, cy + 6, 2, color);
    drawLine(image, CENTER + radius, cy - 4, CENTER + radius * 1.6, cy + 6, 2, color);
  }
  if (shape === 'priest') {
    strokeCircle(image, CENTER, cy - radius - 5, 4, 1.4, rgba('#eafff6', 200));
  }
  if (shape === 'shield') {
    strokeCircle(image, CENTER, cy, radius + 3, 2, rgba('#96d6ff', 200));
  }
  if (shape === 'split') {
    drawLine(image, CENTER - 4, cy - radius, CENTER + 2, cy, 1.2, rgba('#ffffff', 160));
    drawLine(image, CENTER + 2, cy, CENTER - 5, cy + radius, 1.2, rgba('#ffffff', 160));
  }
  if (shape === 'drum') {
    fillRect(image, CENTER - radius, cy - 4, radius * 2, 8, rgba('#2a2318', 160));
  }
  if (shape === 'caster') {
    drawLine(image, CENTER + radius * 0.4, cy, CENTER + radius * 1.3, cy - radius, 1.6, rgba('#e8ff9a', 200));
  }
  if (shape === 'boss' || shape?.startsWith('boss-')) {
    for (let i = 0; i < 3; i += 1) {
      const angle = -Math.PI / 2 + (i - 1) * 0.5;
      drawLine(
        image,
        CENTER + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        CENTER + Math.cos(angle) * (radius + 6),
        cy + Math.sin(angle) * (radius + 6),
        1.6,
        color
      );
    }
  }
  if (shape === 'boss-armored') {
    strokeCircle(image, CENTER, cy, radius * 0.78, 2.4, rgba('#8fa3bf', 220));
    strokeCircle(image, CENTER, cy, radius * 0.5, 1.4, rgba('#8fa3bf', 160));
  }
  if (shape === 'boss-summoner') {
    for (let i = 0; i < 3; i += 1) fillCircle(image, CENTER - 8 + i * 8, cy + radius + 4, 2, rgba('#d75bd0', 220));
  }
  if (shape === 'boss-berserk') {
    for (let i = 0; i < 5; i += 1) {
      const angle = -Math.PI / 2 + (i - 2) * 0.42;
      drawLine(image, CENTER, cy, CENTER + Math.cos(angle) * (radius + 7), cy + Math.sin(angle) * (radius + 7), 1.2, rgba('#ff5533', 220));
    }
  }

  if (state === 'move') {
    fillCircle(image, CENTER - radius * 0.6, CENTER + 17, 1.8, rgba('#ffffff', 70));
    fillCircle(image, CENTER + radius * 0.6, CENTER + 17, 1.8, rgba('#ffffff', 70));
  }
  if (state === 'hit') {
    fillPolygon(image, body, rgba('#ffffff', 90));
    drawLine(image, CENTER - 8, cy - 8, CENTER + 8, cy + 8, 1.2, rgba('#ffffff', 210));
  }
  if (state === 'cast') {
    strokeCircle(image, CENTER, cy, radius + 5, 1.6, rgba('#e2609e', 220));
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      fillCircle(image, CENTER + Math.cos(angle) * (radius + 8), cy + Math.sin(angle) * (radius + 8), 1.8, rgba('#ff8ad0', 240));
    }
  }
}

function drawSummon(image, record, state) {
  const skull = '#dff6ff';
  const cyan = entityColor(record);
  fillCircle(image, CENTER, CENTER + 16, 9, rgba('#000000', 70));
  fillCircle(image, CENTER, CENTER - 2, SUMMON_SPRITE_RADIUS + 1, rgba(skull, 230));
  strokeCircle(image, CENTER, CENTER - 2, SUMMON_SPRITE_RADIUS + 1, 1.6, rgba(cyan, 230));
  fillCircle(image, CENTER - 5, CENTER - 5, 3, rgba('#0a1116', 240));
  fillCircle(image, CENTER + 5, CENTER - 5, 3, rgba('#0a1116', 240));
  fillRect(image, CENTER - 5, CENTER + 6, 10, 3, rgba('#0a1116', 220));
  if (state === 'attack') {
    fillCircle(image, CENTER - 5, CENTER - 5, 1.4, rgba('#22d3ee'));
    fillCircle(image, CENTER + 5, CENTER - 5, 1.4, rgba('#22d3ee'));
    drawLine(image, CENTER + 12, CENTER - 2, CENTER + 19, CENTER - 2, 2, rgba('#7ef0ff', 230));
  } else {
    strokeCircle(image, CENTER, CENTER - 2, 17, 1, rgba(cyan, 80));
  }
}

function destructibleSilhouette(typeId, cx, cy) {
  switch (typeId) {
    case 'vein':
      return [[cx, cy - 13], [cx + 13, cy], [cx, cy + 13], [cx - 13, cy]];
    case 'obelisk':
      return [[cx - 9, cy + 14], [cx - 6, cy - 14], [cx + 6, cy - 14], [cx + 9, cy + 14]];
    case 'cache':
      return [[cx - 13, cy - 11], [cx + 13, cy - 11], [cx + 13, cy + 11], [cx - 13, cy + 11]];
    case 'nest':
      return regularPolygon(cx, cy + 1, 14, 12, 0);
    default:
      return regularPolygon(cx, cy, 12, 12, 0);
  }
}

function drawDestructible(image, record, state) {
  const hex = entityColor(record);
  const alpha = state === 'ruined' ? 110 : 235;
  const color = rgba(hex, alpha);
  const body = destructibleSilhouette(record.entityId, CENTER, CENTER);
  fillPolygon(image, body, rgba(hex, state === 'ruined' ? 24 : 66));
  strokePolygon(image, body, state === 'ruined' ? 1.2 : 2, color);
  if (record.entityId === 'totem') {
    strokeCircle(image, CENTER, CENTER, 12, 2.4, color);
    for (let i = 0; i < 4; i += 1) {
      const angle = (i * Math.PI) / 2;
      drawLine(image, CENTER + Math.cos(angle) * 7, CENTER + Math.sin(angle) * 7, CENTER + Math.cos(angle) * 15, CENTER + Math.sin(angle) * 15, 1.6, color);
    }
    fillCircle(image, CENTER, CENTER, 4, color);
  }
  if (record.entityId === 'nest') {
    for (let i = 0; i < 3; i += 1) fillCircle(image, CENTER - 6 + i * 6, CENTER + 1, 2.2, rgba('#ffffff', state === 'ruined' ? 70 : 180));
  }
  if (record.entityId === 'cache') {
    drawLine(image, CENTER - 13, CENTER, CENTER + 13, CENTER, 1.2, rgba('#ffffff', 110));
    drawLine(image, CENTER, CENTER - 11, CENTER, CENTER + 11, 1.2, rgba('#ffffff', 110));
  }
  if (record.entityId === 'obelisk') {
    drawLine(image, CENTER, CENTER - 9, CENTER, CENTER + 8, 1.2, rgba('#ffffff', 120));
  }
  if (record.entityId === 'vein') {
    fillPolygon(image, [[CENTER - 13, CENTER - 10], [CENTER - 8, CENTER - 10], [CENTER - 13, CENTER - 5], [CENTER - 18, CENTER - 5]], rgba(hex, 160));
  }
  if (state === 'ruined') {
    for (let i = 0; i < 3; i += 1) {
      fillCircle(image, CENTER - 8 + i * 8, CENTER + 12 - i * 3, 1.6 + (i % 2), rgba(hex, 140));
    }
    drawLine(image, CENTER - 14, CENTER - 10, CENTER + 10, CENTER + 12, 1, rgba('#8a8f98', 120));
  }
}

function drawPortal(image, record, state) {
  const cyan = entityColor(record);
  const charge = state === 'charge';
  fillCircle(image, CENTER, CENTER, charge ? 10 : 8, rgba(cyan, charge ? 120 : 60));
  strokeCircle(image, CENTER, CENTER, 14, 2.2, rgba(cyan, charge ? 240 : 160));
  strokeCircle(image, CENTER, CENTER, 9, 1.4, rgba(cyan, charge ? 200 : 110));
  if (charge) {
    strokeCircle(image, CENTER, CENTER, 19, 1.6, rgba(cyan, 220));
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      fillCircle(image, CENTER + Math.cos(angle) * 19, CENTER + Math.sin(angle) * 19, 1.4, rgba('#eaffff', 240));
    }
  } else {
    strokeCircle(image, CENTER, CENTER, 16, 1, rgba(cyan, 70));
  }
  fillCircle(image, CENTER, CENTER, 3, rgba('#ffffff', charge ? 230 : 150));
}

function drawBase(image, record, state) {
  const teal = entityColor(record);
  const hurt = state === 'hurt';
  const crystal = [
    [CENTER, CENTER - 19],
    [CENTER + 12, CENTER - 5],
    [CENTER + 8, CENTER + 14],
    [CENTER, CENTER + 19],
    [CENTER - 8, CENTER + 14],
    [CENTER - 12, CENTER - 5],
  ];
  strokeCircle(image, CENTER, CENTER, 25, hurt ? 3 : 2, rgba(hurt ? '#ef5f5f' : teal, 200));
  fillPolygon(image, crystal, rgba(hurt ? '#8a3b3b' : '#2f9c92', 220));
  strokePolygon(image, crystal, 1.4, rgba(hurt ? '#ffb3b3' : '#c8fff5', 220));
  drawLine(image, CENTER, CENTER - 19, CENTER, CENTER + 17, 1, rgba('#ffffff', 110));
  if (hurt) {
    drawLine(image, CENTER - 9, CENTER - 11, CENTER + 4, CENTER - 2, 1.6, rgba('#ff5f5f', 230));
    drawLine(image, CENTER + 4, CENTER - 2, CENTER - 3, CENTER + 9, 1.6, rgba('#ff5f5f', 230));
    fillCircle(image, CENTER, CENTER, 26, rgba('#ef5f5f', 26));
  } else {
    strokeCircle(image, CENTER, CENTER, 21, 1, rgba(teal, 90));
  }
}

const FAMILY_DRAWERS = Object.freeze({
  tower: drawTower,
  enemy: drawEnemy,
  summon: drawSummon,
  destructible: drawDestructible,
  portal: drawPortal,
  base: drawBase,
});

// 单帧渲染：族形体 + 状态徽标（同实体的状态帧因此在像素上必然不同）。
function drawEntityFrame(record, state) {
  const image = new RgbaImage(FRAME_SIZE, FRAME_SIZE);
  const drawer = FAMILY_DRAWERS[record.family];
  if (!drawer) throw new Error(`未知实体族：${record.family}`);
  drawer(image, record, state);
  const mark = STATE_MARKS[state] || '#ffffff';
  fillRect(image, FRAME_SIZE - 5, FRAME_SIZE - 5, 3, 3, rgba(mark, 230));
  return image;
}

// ── 画布布局与产物 ─────────────────────────────────────────────────────────
// 每个状态一帧，按实体顺序紧密排布；帧名即精灵 id（<family>.<entity>.<state>）。
export function frameLayout(records = entityRecords()) {
  const slots = [];
  for (const record of records) {
    for (const [state, spriteId] of Object.entries(record.states)) slots.push({ record, state, spriteId });
  }
  const rows = Math.max(1, Math.ceil(slots.length / ATLAS_COLUMNS));
  return { columns: ATLAS_COLUMNS, rows, size: { w: ATLAS_COLUMNS * FRAME_SIZE, h: rows * FRAME_SIZE }, slots };
}

export function buildAtlas() {
  const layout = frameLayout();
  const image = new RgbaImage(layout.size.w, layout.size.h);
  const frames = {};
  layout.slots.forEach((slot, index) => {
    const x = (index % layout.columns) * FRAME_SIZE;
    const y = Math.floor(index / layout.columns) * FRAME_SIZE;
    const tile = drawEntityFrame(slot.record, slot.state);
    for (let row = 0; row < FRAME_SIZE; row += 1) {
      const from = row * FRAME_SIZE * 4;
      const to = ((y + row) * image.width + x) * 4;
      tile.data.copy(image.data, to, from, from + FRAME_SIZE * 4);
    }
    frames[slot.spriteId] = {
      x,
      y,
      w: FRAME_SIZE,
      h: FRAME_SIZE,
      pivot: { x: 0.5, y: 0.5 },
      sourceSize: { w: FRAME_SIZE, h: FRAME_SIZE },
      offset: { x: 0, y: 0 },
      trimmed: false,
      rotated: false,
    };
  });
  return { image, frames, size: layout.size };
}

export function buildAtlasJson(atlas = buildAtlas()) {
  return {
    name: ATLAS_NAME,
    image: `${ATLAS_NAME}@1x`,
    size: { ...atlas.size },
    pivot: { x: 0.5, y: 0.5 },
    frames: atlas.frames,
  };
}

const SRC_1X = '/assets/sprites/entities/entity-atlas@1x.png';
const SRC_2X = '/assets/sprites/entities/entity-atlas@2x.png';

function entityEntry(record, state, spriteId) {
  return {
    id: spriteId,
    path: ATLAS_IMAGE_PATH,
    src: SRC_1X,
    srcs: { 1: SRC_1X, 2: SRC_2X },
    size: { w: FRAME_SIZE, h: FRAME_SIZE },
    anchor: record.anchor,
    pivot: { x: 0.5, y: 0.5 },
    frames: 1,
    states: [ENTITY_STATE_TOKENS[state] || 'idle'],
    status: 'ready',
    dpr: [1, 2],
    atlas: ATLAS_NAME,
    frame: spriteId,
    compression: 'lossless',
    provenance: {
      source: '自带程序生成',
      author: ENTITY_GENERATOR,
      license: 'proprietary-internal',
      url: '-',
      retrievedAt: ENTITY_PROVENANCE_DATE,
    },
    license: 'proprietary-internal',
    generator: 'procedural-canvas2d',
  };
}

export function buildEntityEntries() {
  const entries = [];
  for (const record of entityRecords()) {
    for (const [state, spriteId] of Object.entries(record.states)) entries.push(entityEntry(record, state, spriteId));
  }
  return entries;
}

const ENTITY_ENTRY_PATTERN = new RegExp(`^(?:${ENTITY_SPRITE_FAMILIES.join('|')})\\.`);

// 合并清单：保留既有非实体条目（probe）与图集声明，实体段整体替换为本次生成结果。
export function buildManifest(previous = readManifest()) {
  const base = previous && typeof previous === 'object' ? previous : {};
  const atlases = { ...(base.atlases || {}) };
  atlases[ATLAS_NAME] = {
    json: `/${ATLAS_JSON_PATH.replace(/^public\//, '')}`,
    images: { 1: SRC_1X, 2: SRC_2X },
    size: buildAtlasJson().size,
  };
  const kept = (Array.isArray(base.entries) ? base.entries : []).filter(
    (entry) => !ENTITY_ENTRY_PATTERN.test(String(entry?.id || ''))
  );
  // 与 scripts/build-sprite-atlas.mjs 共用同一排序策略：条目按 id、图集名按字典序，
  // 任一生成器跑完都得到同一份字节。
  const entries = [...kept, ...buildEntityEntries()].sort((a, b) => (String(a?.id) < String(b?.id) ? -1 : 1));
  const orderedAtlases = Object.fromEntries(Object.entries(atlases).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    version: base.version || 1,
    generator: base.generator || ENTITY_GENERATOR,
    atlases: orderedAtlases,
    entries,
  };
}

function readManifest(root = ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
  } catch {
    return null;
  }
}


// ── 评审用对照表（DoD）：人眼确认「形体来自图集贴图」而不是纯程序化 ────────
export const PRIMARY_STATES = Object.freeze({
  tower: 'idle',
  enemy: 'move',
  summon: 'idle',
  destructible: 'alive',
  portal: 'idle',
  base: 'idle',
});

const SHEET_COLUMNS = 11;
const SHEET_SCALE = 2;
const SHEET_GAP = 2;
const SHEET_BG = [10, 17, 22, 255];

// 每帧按最近邻放大 2 倍后紧密排布；不含文字，顺序与 entityRecords() 一致。
function buildContactSheet(slots) {
  const cell = FRAME_SIZE * SHEET_SCALE;
  const rows = Math.max(1, Math.ceil(slots.length / SHEET_COLUMNS));
  const width = SHEET_COLUMNS * (cell + SHEET_GAP) + SHEET_GAP;
  const height = rows * (cell + SHEET_GAP) + SHEET_GAP;
  const image = new RgbaImage(width, height);
  fillImageRect(image, 0, 0, width, height, SHEET_BG);
  slots.forEach((slot, index) => {
    const tile = drawEntityFrame(slot.record, slot.state);
    const x = SHEET_GAP + (index % SHEET_COLUMNS) * (cell + SHEET_GAP);
    const y = SHEET_GAP + Math.floor(index / SHEET_COLUMNS) * (cell + SHEET_GAP);
    blit(image, tile, x, y, cell, cell);
  });
  return image;
}

export function buildContactSheets() {
  const primary = [];
  const states = [];
  for (const record of entityRecords()) {
    const primaryState = PRIMARY_STATES[record.family];
    for (const state of Object.keys(record.states)) {
      const slot = { record, state };
      if (state === primaryState) primary.push(slot);
      else states.push(slot);
    }
  }
  return [
    { path: CONTACT_SHEET_PRIMARY, data: encodePng(buildContactSheet(primary)) },
    { path: CONTACT_SHEET_STATES, data: encodePng(buildContactSheet(states)) },
  ];
}

export function buildArtifacts({ root = ROOT } = {}) {
  const atlas = buildAtlas();
  const toJson = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return [
    { path: ATLAS_IMAGE_PATH, data: encodePng(atlas.image) },
    { path: ATLAS_IMAGE_2X_PATH, data: encodePng(resizeNearest(atlas.image, atlas.size.w * 2, atlas.size.h * 2)) },
    { path: ATLAS_JSON_PATH, data: toJson(buildAtlasJson(atlas)) },
    { path: MANIFEST_PATH, data: toJson(buildManifest(readManifest(root))) },
    ...buildContactSheets(),
  ];
}

export function writeArtifacts({ root = ROOT, check = false } = {}) {
  const artifacts = buildArtifacts({ root });
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
  const { artifacts, changed } = writeArtifacts({ check });
  if (check) {
    if (changed.length) {
      console.error(`实体精灵与生成器不一致（${changed.length} 个文件）：`);
      for (const file of changed) console.error(`  ✗ ${file}`);
      return 1;
    }
    console.log('实体精灵与生成器一致');
    return 0;
  }
  for (const artifact of artifacts) console.log(`写入 ${artifact.path}（${artifact.data.length} 字节）`);
  console.log(`实体状态帧 ${entitySpriteIds().length} 个`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
