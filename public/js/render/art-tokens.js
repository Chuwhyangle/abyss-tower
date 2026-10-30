// 美术运行时令牌：色板、光照、语义、UI、字体与动效的唯一色值定义处。
// 纯数据/纯函数，不接触 Canvas；palette.js 从这里派生，渲染层不得再写字面色值。
// 规范与取值依据见 docs/ART_DIRECTION.md，资源约定见 docs/ASSET_PIPELINE.md。
import { ENEMIES, RARITY, TOWERS } from '../shared/data.js';

// 群系色板：每套群系的静态层取色。ambient 是 "rgba(r, g, b, " 前缀，绘制时拼透明度。
export const PALETTE_TOKENS = Object.freeze({
  canyon: Object.freeze({
    grass1: '#13221a', grass2: '#101c16', grid: 'rgba(110, 190, 140, 0.05)',
    pathEdge: '#19130f', path: '#322619', pathInner: '#463425',
    pathLine: 'rgba(214, 178, 126, 0.22)', tuft: '96, 180, 128',
    rock: '#3c4a4f', rockEdge: '#66777d', accent: '#8fe0a8', ambient: 'rgba(120, 220, 160, ',
  }),
  twin: Object.freeze({
    grass1: '#112228', grass2: '#0e1d22', grid: 'rgba(110, 200, 210, 0.05)',
    pathEdge: '#101b20', path: '#213238', pathInner: '#2e464e',
    pathLine: 'rgba(120, 210, 220, 0.2)', tuft: '80, 170, 180',
    rock: '#3a4c53', rockEdge: '#5f7c86', accent: '#5ce2d0', ambient: 'rgba(90, 210, 220, ',
  }),
  triple: Object.freeze({
    grass1: '#241817', grass2: '#1e1413', grid: 'rgba(220, 120, 100, 0.045)',
    pathEdge: '#1d0f0c', path: '#3a211b', pathInner: '#523026',
    pathLine: 'rgba(255, 150, 110, 0.2)', tuft: '190, 100, 90',
    rock: '#4b3a38', rockEdge: '#76564f', accent: '#ff8a6b', ambient: 'rgba(255, 120, 90, ',
  }),
  ring: Object.freeze({
    grass1: '#1a1630', grass2: '#151228', grid: 'rgba(150, 130, 220, 0.05)',
    pathEdge: '#140f22', path: '#2b2340', pathInner: '#403356',
    pathLine: 'rgba(190, 160, 255, 0.22)', tuft: '130, 110, 200',
    rock: '#413a58', rockEdge: '#6b5f8c', accent: '#b48cff', ambient: 'rgba(170, 130, 255, ',
  }),
  cross: Object.freeze({
    grass1: '#222015', grass2: '#1c1a12', grid: 'rgba(220, 200, 120, 0.05)',
    pathEdge: '#1b160d', path: '#3a3320', pathInner: '#54492e',
    pathLine: 'rgba(255, 220, 130, 0.2)', tuft: '180, 170, 90',
    rock: '#4a4638', rockEdge: '#756c52', accent: '#ffd36b', ambient: 'rgba(255, 210, 110, ',
  }),
});

// 色盲变体：蓝黄色盲保留蓝-黄轴（明度阶梯 + 蓝/黄对立），蓝黄模式被红绿与蓝黄色盲共用。
const BLUE_YELLOW_TOKENS = Object.freeze({
  rarity: Object.freeze({ common: '#455a64', rare: '#1e88e5', epic: '#ffb300' }),
  towers: Object.freeze({
    arrow: '#1a237e',
    cannon: '#4e342e',
    frost: '#1976d2',
    arc: '#827717',
    poison: '#4fc3f7',
    banner: '#ffca28',
    shock: '#f5f5f5',
    sniper: '#ef6c00',
  }),
  enemies: Object.freeze({
    grunt: '#0d47a1',
    runner: '#ffb300',
    swarm: '#64b5f6',
    tank: '#4e342e',
    flyer: '#ffe082',
    healer: '#1a237e',
    boss: '#827717',
    shielder: '#4fc3f7',
    splitter: '#ffca28',
    splitling: '#3e2723',
    herald: '#90caf9',
    caster: '#f5f5f5',
    wraith: '#7986cb',
    golem: '#8d6e63',
  }),
});

// 蓝黄色盲保留红-绿轴（明度阶梯 + 红/绿对立）。
const RED_GREEN_TOKENS = Object.freeze({
  rarity: Object.freeze({ common: '#455a64', rare: '#2e7d32', epic: '#c62828' }),
  towers: Object.freeze({
    arrow: '#1b5e20',
    cannon: '#e53935',
    frost: '#66bb6a',
    arc: '#4a148c',
    poison: '#ff8a80',
    banner: '#a5d6a7',
    shock: '#f5f5f5',
    sniper: '#880e4f',
  }),
  enemies: Object.freeze({
    grunt: '#e53935',
    runner: '#1b5e20',
    swarm: '#ff8a80',
    tank: '#4a148c',
    flyer: '#66bb6a',
    healer: '#a5d6a7',
    boss: '#c62828',
    shielder: '#2e7d32',
    splitter: '#ef9a9a',
    splitling: '#7b1fa2',
    herald: '#388e3c',
    caster: '#f5f5f5',
    wraith: '#ce93d8',
    golem: '#455a64',
  }),
});

// 无障碍令牌：两两颜色在 CIE Lab 下的最小距离，以及三套角色重映射。
export const ACCESSIBILITY_TOKENS = Object.freeze({
  minLabDistance: 15,
  blueYellow: BLUE_YELLOW_TOKENS,
  redGreen: RED_GREEN_TOKENS,
});

// 角色身份色：塔/敌人/稀有度的唯一来源是 shared/data.js，这里只做令牌视图。
export const CHARACTER_TOKENS = Object.freeze({
  rarity: Object.freeze(Object.fromEntries(Object.entries(RARITY).map(([id, def]) => [id, def.color]))),
  towers: Object.freeze(Object.fromEntries(Object.entries(TOWERS).map(([id, def]) => [id, def.color]))),
  enemies: Object.freeze(Object.fromEntries(Object.entries(ENEMIES).map(([id, def]) => [id, def.color]))),
});

// 技能预警语义：危险=红橙（环）、控制=蓝（六边）、增益=金（星芒）。
export const SEMANTIC_TOKENS = Object.freeze({
  danger: Object.freeze({ id: 'danger', label: '危险', color: '#ff7a4d', accent: '#ffd2b0', shape: 'ring' }),
  control: Object.freeze({ id: 'control', label: '控制', color: '#5cb8ff', accent: '#d9f1ff', shape: 'hex' }),
  buff: Object.freeze({ id: 'buff', label: '增益', color: '#ffd36b', accent: '#fff3c8', shape: 'star' }),
});

// 技能 id → 语义；玩家三技能与首领三技能都必须在册，未知 id 回退危险。
export const SKILL_SEMANTIC_MAP = Object.freeze({
  aurora: 'control',
  chrono: 'buff',
  meteor: 'danger',
  roar: 'danger',
  summon: 'danger',
  slam: 'danger',
});

// 色盲模式下的语义重映射：与角色调色同一思路（蓝-黄 / 红-绿轴）。
export const SEMANTIC_COLORBLIND_TOKENS = Object.freeze({
  deuteranopia: Object.freeze({ danger: '#ff8f00', control: '#1e88e5', buff: '#fff59d' }),
  protanopia: Object.freeze({ danger: '#ff8f00', control: '#1e88e5', buff: '#fff59d' }),
  tritanopia: Object.freeze({ danger: '#d32f2f', control: '#2e7d32', buff: '#fff8e1' }),
});

// 预警几何：线宽、倒计时环、虚线节奏与填充只在这里定义，所有技能共用。
export const WARNING_TOKENS = Object.freeze({
  lineWidth: 1.8,
  countdownWidth: 2.4,
  dash: Object.freeze([8, 6]),
  fill: 0.1,
  dashScroll: 14,
  countdownColor: '#f4fbff',
});

// UI 色板：JS 侧镜像 public/styles.css 的 :root 变量；两处必须一致（tests/art-spec 会拦漂移）。
export const UI_TOKENS = Object.freeze({
  bg: '#070b0e',
  surfaceDeep: '#0a1116',
  surface1: '#0d151b',
  surface2: '#111d25',
  line: '#22333f',
  text: '#e7eef4',
  textStrong: '#eef5fa',
  textBody: '#c6d5df',
  textSoft: '#a9bcc9',
  muted: '#8fa3b2',
  gold: '#ffd36b',
  goldBright: '#ffe391',
  goldDeep: '#e0a93c',
  dangerText: '#ffb3bd',
  green: '#6fe0a8',
  red: '#ff6b7d',
  cyan: '#5ce2d0',
  purple: '#b48cff',
});

// 角色令牌：背景 / 地形 / 塔 / 敌人 / 友方 / 危险 / 奖励 / UI 的美术口径入口。
export const ROLE_TOKENS = Object.freeze({
  background: Object.freeze({ id: 'background', color: UI_TOKENS.bg, deep: UI_TOKENS.surfaceDeep }),
  terrain: Object.freeze({
    id: 'terrain',
    edge: PALETTE_TOKENS.canyon.pathEdge,
    surface: PALETTE_TOKENS.canyon.path,
    inner: PALETTE_TOKENS.canyon.pathInner,
  }),
  tower: Object.freeze({ id: 'tower', colors: CHARACTER_TOKENS.towers }),
  enemy: Object.freeze({ id: 'enemy', colors: CHARACTER_TOKENS.enemies }),
  friendly: Object.freeze({ id: 'friendly', color: '#cfe8ff' }),
  hazard: Object.freeze({ id: 'hazard', color: SEMANTIC_TOKENS.danger.color, accent: SEMANTIC_TOKENS.danger.accent }),
  reward: Object.freeze({ id: 'reward', color: SEMANTIC_TOKENS.buff.color, accent: SEMANTIC_TOKENS.buff.accent }),
  ui: UI_TOKENS,
});

// 光照与投影：主光在左上（方位角 135°），投影统一向右下偏移，发光是叠加层而非模糊滤镜。
export const LIGHT_TOKENS = Object.freeze({
  key: Object.freeze({ azimuth: 135, elevation: 52, color: '#fff3d6', intensity: 1 }),
  fill: Object.freeze({ color: '#5cb8ff', intensity: 0.18 }),
  rim: Object.freeze({ color: '#dff6ff', width: 1.5, opacity: 0.55 }),
  shadow: Object.freeze({ color: 'rgba(3, 6, 8, 0.55)', offsetX: 3, offsetY: 5, blur: 8, skew: 0.4 }),
  glow: Object.freeze({ core: '#ffffff', halo: 1.9, falloff: 0.55, maxAlpha: 0.85 }),
});

// 字号阶梯：与 public/styles.css 的 --text-* 同级，贴图时代的 UI 文字仍走这套。
export const TYPE_TOKENS = Object.freeze({
  xxs: 10,
  xs: 11,
  sm: 12.5,
  md: 14,
  lg: 17,
  xl: 22,
  xxl: 26,
  xxxl: 30,
});

// 动效语言：每个状态的帧数与播放节奏；manifest 的 states 只能取这里的键。
export const MOTION_TOKENS = Object.freeze({
  idle: Object.freeze({ frames: 4, fps: 8, loop: true }),
  attack: Object.freeze({ frames: 5, fps: 14, loop: false }),
  hit: Object.freeze({ frames: 2, fps: 18, loop: false }),
  death: Object.freeze({ frames: 6, fps: 12, loop: false }),
  easing: 'ease-out',
});

// 缺省色：输入非法时的兜底（历史行为是纯白半透明，保持不变）。
export const FALLBACK_TOKENS = Object.freeze({ color: '#ffffff' });

// 聚合视图：测试与文档按路径取值，例如 role.ui.text、palette.canyon.path。
export const ART_TOKENS = Object.freeze({
  palette: PALETTE_TOKENS,
  accessibility: ACCESSIBILITY_TOKENS,
  character: CHARACTER_TOKENS,
  semantic: SEMANTIC_TOKENS,
  semanticColorblind: SEMANTIC_COLORBLIND_TOKENS,
  warning: WARNING_TOKENS,
  ui: UI_TOKENS,
  role: ROLE_TOKENS,
  light: LIGHT_TOKENS,
  type: TYPE_TOKENS,
  motion: MOTION_TOKENS,
  fallback: FALLBACK_TOKENS,
});
