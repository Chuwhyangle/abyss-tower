// 塔/敌人皮肤：纯表现配色与轮廓变体，不参与战斗模拟。
// 皮肤在解析后的调色板颜色上做 HSL 偏移（默认皮肤为恒等变换），
// 因此色弱/高对比模式仍然先决定基础色，皮肤只做二次上色。
// 解锁条件引用成就 id；未解锁的皮肤不能被选中，读取时回退默认皮肤。
import { ACHIEVEMENT_BY_ID } from './achievements.js';
import { ENEMIES, TOWERS } from './data.js';

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

// 皮肤套装：同主题的塔/敌人分类型配色，用于收集画廊与解锁进度。
// 套装只描述表现，不写入 active 选择，也不被 sim 读取。
const SKIN_SET_DEFS = Object.freeze({
  molten: Object.freeze({
    name: '熔火',
    description: '熔岩浇筑的塔身与被灼烧的敌群',
    accent: '#ff7a45',
    glow: '#ffd0a3',
    tower: Object.freeze({
      arrow: Object.freeze({
        transform: Object.freeze({ hueShift: -118, saturation: 1.3, lightness: 0.04 }),
        outline: Object.freeze({ color: '#ffd0a3', width: 1.6, alpha: 0.8 }),
        unlock: 'first_run',
      }),
      cannon: Object.freeze({
        transform: Object.freeze({ hueShift: -132, saturation: 1.35, lightness: 0.02 }),
        outline: Object.freeze({ color: '#ffc08a', width: 1.6, alpha: 0.8 }),
        unlock: 'wave_5',
      }),
      poison: Object.freeze({
        transform: Object.freeze({ hueShift: -106, saturation: 1.28, lightness: 0.01 }),
        outline: Object.freeze({ color: '#ffb27a', width: 1.6, alpha: 0.78 }),
        unlock: 'wave_10',
      }),
      shock: Object.freeze({
        transform: Object.freeze({ hueShift: -145, saturation: 1.32, lightness: 0.05 }),
        outline: Object.freeze({ color: '#ffe3c2', width: 1.6, alpha: 0.82 }),
        unlock: 'boss_slayer',
      }),
    }),
    enemy: Object.freeze({
      grunt: Object.freeze({
        transform: Object.freeze({ hueShift: -100, saturation: 1.4, lightness: -0.01 }),
        outline: Object.freeze({ color: '#ffb27a', width: 1.3, alpha: 0.75 }),
        unlock: 'first_run',
      }),
      tank: Object.freeze({
        transform: Object.freeze({ hueShift: -124, saturation: 1.45, lightness: 0.02 }),
        outline: Object.freeze({ color: '#ffc99a', width: 1.3, alpha: 0.75 }),
        unlock: 'wave_5',
      }),
    }),
  }),
  frost: Object.freeze({
    name: '霜寂',
    description: '永冻塔群与踏雪而来的霜裔',
    accent: '#5bc8ff',
    glow: '#dbf4ff',
    tower: Object.freeze({
      frost: Object.freeze({
        transform: Object.freeze({ hueShift: 156, saturation: 0.84, lightness: 0.1 }),
        outline: Object.freeze({ color: '#dbf4ff', width: 1.5, alpha: 0.78 }),
        unlock: 'first_win',
      }),
      arc: Object.freeze({
        transform: Object.freeze({ hueShift: 168, saturation: 0.8, lightness: 0.09 }),
        outline: Object.freeze({ color: '#c9ecff', width: 1.5, alpha: 0.78 }),
        unlock: 'wave_10',
      }),
      sniper: Object.freeze({
        transform: Object.freeze({ hueShift: 148, saturation: 0.78, lightness: 0.11 }),
        outline: Object.freeze({ color: '#e2f7ff', width: 1.5, alpha: 0.8 }),
        unlock: 'boss_slayer',
      }),
      banner: Object.freeze({
        transform: Object.freeze({ hueShift: 162, saturation: 0.86, lightness: 0.08 }),
        outline: Object.freeze({ color: '#d2f0ff', width: 1.5, alpha: 0.76 }),
        unlock: 'win_standard',
      }),
    }),
    enemy: Object.freeze({
      runner: Object.freeze({
        transform: Object.freeze({ hueShift: 172, saturation: 0.72, lightness: 0.08 }),
        outline: Object.freeze({ color: '#c9ecff', width: 1.2, alpha: 0.72 }),
        unlock: 'first_run',
      }),
      flyer: Object.freeze({
        transform: Object.freeze({ hueShift: 158, saturation: 0.76, lightness: 0.1 }),
        outline: Object.freeze({ color: '#e2f7ff', width: 1.2, alpha: 0.72 }),
        unlock: 'wave_5',
      }),
    }),
  }),
});

function buildSkinSet(id) {
  const def = SKIN_SET_DEFS[id];
  const members = {};
  for (const target of SKIN_TARGETS) {
    const catalog = target === 'tower' ? TOWERS : ENEMIES;
    const group = {};
    for (const [type, entry] of Object.entries(def[target])) {
      group[type] = Object.freeze({
        id: `${id}_${type}`,
        setId: id,
        target,
        type,
        name: catalog[type].name,
        transform: entry.transform,
        outline: entry.outline,
        unlock: Object.freeze({ achievement: entry.unlock }),
      });
    }
    members[target] = Object.freeze(group);
  }
  return Object.freeze({
    id,
    name: def.name,
    description: def.description,
    accent: def.accent,
    glow: def.glow,
    members: Object.freeze(members),
  });
}

export const SKIN_SETS = Object.freeze(
  Object.fromEntries(Object.keys(SKIN_SET_DEFS).map((id) => [id, buildSkinSet(id)]))
);

export const SKIN_SET_ORDER = Object.freeze(Object.keys(SKIN_SETS));

export function skinSetById(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKIN_SETS, id)
    ? SKIN_SETS[id]
    : null;
}

function asSkinSet(setOrId) {
  return typeof setOrId === 'string' ? skinSetById(setOrId) : setOrId || null;
}

export function skinSetMember(setOrId, target, type) {
  const set = asSkinSet(setOrId);
  return set?.members?.[target]?.[type] || null;
}

export function skinSetMembers(setOrId) {
  const set = asSkinSet(setOrId);
  if (!set) return [];
  return SKIN_TARGETS.flatMap((target) => Object.values(set.members[target] || {}));
}

export function isSkinSetMemberUnlocked(member, unlocked = []) {
  if (!member) return false;
  if (!member.unlock) return true;
  return unlockSet(unlocked).has(member.unlock.achievement);
}

// 套装进度按成员成就计算；集齐全部成员即视为套装解锁。
export function skinSetProgress(setOrId, unlocked = []) {
  const members = skinSetMembers(setOrId);
  const total = members.length;
  const count = members.filter((member) => isSkinSetMemberUnlocked(member, unlocked)).length;
  return {
    unlocked: count,
    total,
    ratio: total ? count / total : 0,
    complete: total > 0 && count === total,
  };
}

// 未解锁/未知成员返回 null，调用方沿用基础配色（默认回退）。
export function resolveSkinSetMember(setOrId, target, type, unlocked = []) {
  const member = skinSetMember(setOrId, target, type);
  return member && isSkinSetMemberUnlocked(member, unlocked) ? member : null;
}

export function skinSetColorFor(setOrId, target, type, color, unlocked = []) {
  return skinColorFor(resolveSkinSetMember(setOrId, target, type, unlocked), color);
}

export function skinSetCatalog(unlocked = []) {
  return SKIN_SET_ORDER.map((id) => {
    const set = SKIN_SETS[id];
    const progress = skinSetProgress(set, unlocked);
    const members = skinSetMembers(set).map((member) => {
      const source = member.unlock ? ACHIEVEMENT_BY_ID[member.unlock.achievement] || null : null;
      return {
        id: member.id,
        setId: id,
        name: member.name,
        target: member.target,
        type: member.type,
        outline: { ...member.outline },
        unlocked: isSkinSetMemberUnlocked(member, unlocked),
        achievementId: source?.id || null,
        achievementTitle: source?.title || null,
      };
    });
    const requirements = [];
    for (const member of members) {
      if (!member.achievementId) continue;
      if (!requirements.some((item) => item.id === member.achievementId)) {
        requirements.push({ id: member.achievementId, title: member.achievementTitle });
      }
    }
    return {
      id,
      name: set.name,
      description: set.description,
      accent: set.accent,
      glow: set.glow,
      unlocked: progress.complete,
      progress,
      requirements,
      members,
    };
  });
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
