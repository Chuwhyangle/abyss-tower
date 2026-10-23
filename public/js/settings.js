// 画质设置：只影响表现，不参与战斗模拟。损坏或不可写时回退默认低配。
export const SETTINGS_KEY = 'abyss-tower.settings.v1';

// 音量用 0–100 的百分比表示，由音频层换算成总线增益。
export const DEFAULT_SFX_VOLUME = 80;
export const DEFAULT_MUSIC_VOLUME = 50;

export const QUALITY_PRESETS = {
  low: {
    fps: 30,
    dpr: 1,
    decorations: 'light',
    floaters: 'key',
    glow: false,
    shake: false,
    showFps: false,
    music: true,
    sfxVolume: DEFAULT_SFX_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
  },
  high: {
    fps: 60,
    dpr: 2,
    decorations: 'full',
    floaters: 'all',
    glow: true,
    shake: true,
    showFps: false,
    music: true,
    sfxVolume: DEFAULT_SFX_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
  },
};

export const DEFAULT_SETTINGS = { ...QUALITY_PRESETS.low };

export const SETTING_OPTIONS = {
  fps: [30, 60],
  dpr: [1, 2],
  decorations: ['off', 'light', 'full'],
  floaters: ['off', 'key', 'all'],
};

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// 数值音量：合法数字夹到 0–100；缺失或非数字回退默认值。
export function normalizeVolume(value, fallback) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(100, Math.max(0, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.min(100, Math.max(0, Math.round(parsed)));
  }
  return fallback;
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    fps: pick(Number(source.fps), SETTING_OPTIONS.fps, DEFAULT_SETTINGS.fps),
    dpr: pick(Number(source.dpr), SETTING_OPTIONS.dpr, DEFAULT_SETTINGS.dpr),
    decorations: pick(source.decorations, SETTING_OPTIONS.decorations, DEFAULT_SETTINGS.decorations),
    floaters: pick(source.floaters, SETTING_OPTIONS.floaters, DEFAULT_SETTINGS.floaters),
    glow: typeof source.glow === 'boolean' ? source.glow : DEFAULT_SETTINGS.glow,
    shake: typeof source.shake === 'boolean' ? source.shake : DEFAULT_SETTINGS.shake,
    showFps: typeof source.showFps === 'boolean' ? source.showFps : DEFAULT_SETTINGS.showFps,
    music: typeof source.music === 'boolean' ? source.music : DEFAULT_SETTINGS.music,
    sfxVolume: normalizeVolume(source.sfxVolume, DEFAULT_SFX_VOLUME),
    musicVolume: normalizeVolume(source.musicVolume, DEFAULT_MUSIC_VOLUME),
  };
}

export function settingsEqual(a, b) {
  const left = normalizeSettings(a);
  const right = normalizeSettings(b);
  return Object.keys(left).every((key) => left[key] === right[key]);
}

export function detectPreset(settings) {
  const normalized = normalizeSettings(settings);
  for (const [name, preset] of Object.entries(QUALITY_PRESETS)) {
    if (settingsEqual(normalized, preset)) return name;
  }
  return 'custom';
}

export function presetSettings(name) {
  const preset = QUALITY_PRESETS[name] || QUALITY_PRESETS.low;
  return { ...preset };
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const normalized = normalizeSettings(source);
  // 画质面板只提交画质字段：没带的音量键沿用已存值，避免应用预设把音量重置。
  const previous = loadSettings(storage);
  for (const key of ['sfxVolume', 'musicVolume']) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) normalized[key] = previous[key];
  }
  try {
    storage?.setItem?.(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    /* 存储不可用/配额满：本次仍使用内存设置 */
  }
  return normalized;
}

export const DECORATION_LABELS = {
  off: '关闭',
  light: '精简',
  full: '完整',
};

export const FLOATER_LABELS = {
  off: '关闭',
  key: '仅暴击与关键伤害',
  all: '全部',
};
