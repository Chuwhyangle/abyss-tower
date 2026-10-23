// 塔/敌人皮肤：纯表现配色与轮廓变体，不参与战斗模拟。
// 皮肤在解析后的调色板颜色上做 HSL 偏移（默认皮肤为恒等变换），
// 因此色弱/高对比模式仍然先决定基础色，皮肤只做二次上色。
// 解锁条件引用成就 id；未解锁的皮肤不能被选中，读取时回退默认皮肤。
import { ACHIEVEMENT_BY_ID } from './achievements.js';

export const SKIN_TARGETS = Object.freeze(['tower', 'enemy']);

export const DEFAULT_SKIN_BY_TARGET = Object.freeze({
  tower: 'default_tower',
  enemy: 'default_enemy',
});

// 解锁为 null 表示人人可用；否则需要对应成就已解锁。
export const SKINS = Object.freeze({
  default_tower: Object.freeze({
    id: 'default_tower',
    name: '原生塔体',
    target: 'tower',
    transform: null,
    outline: null,
    unlock: null,
  }),
  default_enemy: Object.freeze({
    id: 'default_enemy',
    name: '原生敌人',
    target: 'enemy',
    transform: null,
    outline: null,
    unlock: null,
  }),
  ember_tower: Object.freeze({
    id: 'ember_tower',
    name: '余烬塔体',
    target: 'tower',
    transform: Object.freeze({ hueShift: -120, saturation: 1.15, lightness: 0.04 }),
    outline: Object.freeze({ color: '#ffe3c2', width: 1.4, alpha: 0.75 }),
    unlock: Object.freeze({ achievement: 'first_run' }),
  }),
  abyss_tower: Object.freeze({
    id: 'abyss_tower',
    name: '深渊塔体',
    target: 'tower',
    transform: Object.freeze({ hueShift: 180, saturation: 1.05, lightness: -0.06 }),
    outline: Object.freeze({ color: '#e6d7ff', width: 1.4, alpha: 0.75 }),
    unlock: Object.freeze({ achievement: 'win_abyss' }),
  }),
  aurora_tower: Object.freeze({
    id: 'aurora_tower',
    name: '极光塔体',
    target: 'tower',
    transform: Object.freeze({ hueShift: 62, saturation: 1.2, lightness: 0.08 }),
    outline: Object.freeze({ color: '#d8fff4', width: 1.4, alpha: 0.75 }),
    unlock: Object.freeze({ achievement: 'wave_10' }),
  }),
  frost_enemy: Object.freeze({
    id: 'frost_enemy',
    name: '霜噬敌群',
    target: 'enemy',
    transform: Object.freeze({ hueShift: 150, saturation: 0.85, lightness: 0.05 }),
    outline: Object.freeze({ color: '#dbf4ff', width: 1.2, alpha: 0.7 }),
    unlock: Object.freeze({ achievement: 'first_run' }),
  }),
  venom_enemy: Object.freeze({
    id: 'venom_enemy',
    name: '蚀毒敌群',
    target: 'enemy',
    transform: Object.freeze({ hueShift: -58, saturation: 1.35, lightness: -0.03 }),
    outline: Object.freeze({ color: '#e6ffcc', width: 1.2, alpha: 0.7 }),
    unlock: Object.freeze({ achievement: 'boss_slayer' }),
  }),
  spectral_enemy: Object.freeze({
    id: 'spectral_enemy',
    name: '幽影敌群',
    target: 'enemy',
    transform: Object.freeze({ hueShift: 180, saturation: 0.5, lightness: 0.12 }),
    outline: Object.freeze({ color: '#f2f6ff', width: 1.2, alpha: 0.7 }),
    unlock: Object.freeze({ achievement: 'flawless_win' }),
  }),
});

export const SKIN_ORDER = Object.freeze(Object.keys(SKINS));

export function skinById(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKINS, id)
    ? SKINS[id]
    : null;
}

export function defaultSkinFor(target) {
  return SKINS[DEFAULT_SKIN_BY_TARGET[target]] || SKINS.default_tower;
}

export function skinsForTarget(target) {
  return Object.values(SKINS).filter((skin) => skin.target === target);
}

function unlockSet(unlocked) {
  if (unlocked instanceof Set) return unlocked;
  if (Array.isArray(unlocked)) return new Set(unlocked);
  if (unlocked && typeof unlocked === 'object') return new Set(Object.keys(unlocked));
  return new Set();
}

export function isSkinUnlocked(skin, unlocked = []) {
  if (!skin) return false;
  if (!skin.unlock) return true;
  return unlockSet(unlocked).has(skin.unlock.achievement);
}

// 读取路径的统一入口：未知 id、对象不匹配、未解锁都回退默认皮肤。
export function resolveSkin(target, id, unlocked = []) {
  const skin = skinById(id);
  if (!skin || skin.target !== target || !isSkinUnlocked(skin, unlocked)) {
    return defaultSkinFor(target);
  }
  return skin;
}

export function normalizeSkinSelection(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const selection = {};
  for (const target of SKIN_TARGETS) {
    const skin = skinById(source[target]);
    selection[target] = skin && skin.target === target ? skin.id : DEFAULT_SKIN_BY_TARGET[target];
  }
  return selection;
}

const colorCache = new Map();

function parseHex(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map((offset) => parseInt(value.slice(1 + offset, 3 + offset), 16));
}

function rgbToHsl([r, g, b]) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]) {
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)].map((value) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
  );
}

function toHex(rgb) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// 皮肤只接受色相偏移/饱和度倍数/明度增量，保证各类型间的相对差异不被抹平。
export function shiftSkinColor(skin, color) {
  const transform = skin?.transform;
  const rgb = parseHex(color);
  if (!transform || !rgb) return color;
  const key = `${skin.id}|${color}`;
  const cached = colorCache.get(key);
  if (cached) return cached;
  const [hue, saturation, lightness] = rgbToHsl(rgb);
  const nextHue = (hue + transform.hueShift + 360) % 360;
  const nextSaturation = Math.max(0, Math.min(1, saturation * transform.saturation));
  const nextLightness = Math.max(0.08, Math.min(0.92, lightness + transform.lightness));
  const shifted = toHex(hslToRgb([nextHue, nextSaturation, nextLightness]));
  colorCache.set(key, shifted);
  return shifted;
}

// 默认皮肤返回原色，调用方无需分支。
export function skinColorFor(skin, color) {
  return shiftSkinColor(skin, color);
}

// 目录视图：服务端按已解锁成就标注 unlocked，客户端只负责展示与选择。
export function skinCatalog(unlocked = []) {
  return SKIN_ORDER.map((id) => {
    const skin = SKINS[id];
    const source = skin.unlock ? ACHIEVEMENT_BY_ID[skin.unlock.achievement] || null : null;
    return {
      id: skin.id,
      name: skin.name,
      target: skin.target,
      outline: skin.outline ? { ...skin.outline } : null,
      unlocked: isSkinUnlocked(skin, unlocked),
      achievementId: source?.id || null,
      achievementTitle: source?.title || null,
    };
  });
}

// 运行时选择：渲染层只读，选择动作由外观面板在服务端确认后写入。
let activeByTarget = Object.freeze({
  tower: DEFAULT_SKIN_BY_TARGET.tower,
  enemy: DEFAULT_SKIN_BY_TARGET.enemy,
});

export function activeSkin(target) {
  const id = activeByTarget[target];
  return SKINS[id] || defaultSkinFor(target);
}

export function setActiveSkins(selection) {
  if (!selection || typeof selection !== 'object') return activeSkin('tower');
  const next = {};
  for (const target of SKIN_TARGETS) {
    const skin = skinById(selection[target]);
    next[target] =
      skin && skin.target === target ? skin.id : DEFAULT_SKIN_BY_TARGET[target];
  }
  activeByTarget = Object.freeze(next);
  return activeSkin('tower');
}

export function resetActiveSkins() {
  activeByTarget = Object.freeze({
    tower: DEFAULT_SKIN_BY_TARGET.tower,
    enemy: DEFAULT_SKIN_BY_TARGET.enemy,
  });
}
