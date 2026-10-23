// 画质设置：只影响表现，不参与战斗模拟。损坏或不可写时回退默认低配。
export const SETTINGS_KEY = 'abyss-tower.settings.v1';

// 云同步：本地最后修改时间、写回节流与单账号设置体积上限（服务端同值校验）。
export const SETTINGS_UPDATED_KEY = 'abyss-tower.settings.v1.updatedAt';
export const SETTINGS_SYNC_DELAY_MS = 2000;
export const SETTINGS_MAX_BYTES = 4096;

// 音量用 0–100 的百分比表示，由音频层换算成总线增益。
export const DEFAULT_SFX_VOLUME = 80;
export const DEFAULT_MUSIC_VOLUME = 50;

// 色弱模式只改表现层配色，不参与战斗模拟。
export const COLOR_BLIND_MODES = ['none', 'deuteranopia', 'protanopia', 'tritanopia'];
export const DEFAULT_COLOR_BLIND_MODE = 'none';
export const DEFAULT_HIGH_CONTRAST = false;

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
    colorBlind: DEFAULT_COLOR_BLIND_MODE,
    highContrast: DEFAULT_HIGH_CONTRAST,
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
    colorBlind: DEFAULT_COLOR_BLIND_MODE,
    highContrast: DEFAULT_HIGH_CONTRAST,
  },
};

export const DEFAULT_SETTINGS = { ...QUALITY_PRESETS.low };

export const SETTING_OPTIONS = {
  fps: [30, 60],
  dpr: [1, 2],
  decorations: ['off', 'light', 'full'],
  floaters: ['off', 'key', 'all'],
  colorBlind: COLOR_BLIND_MODES,
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

// 每个字段的归一化器：第二个参数是回退值，供「逐字段合并」保留本地合法值。
const FIELD_NORMALIZERS = {
  fps: (value, fallback) => pick(Number(value), SETTING_OPTIONS.fps, fallback),
  dpr: (value, fallback) => pick(Number(value), SETTING_OPTIONS.dpr, fallback),
  decorations: (value, fallback) => pick(value, SETTING_OPTIONS.decorations, fallback),
  floaters: (value, fallback) => pick(value, SETTING_OPTIONS.floaters, fallback),
  glow: (value, fallback) => (typeof value === 'boolean' ? value : fallback),
  shake: (value, fallback) => (typeof value === 'boolean' ? value : fallback),
  showFps: (value, fallback) => (typeof value === 'boolean' ? value : fallback),
  music: (value, fallback) => (typeof value === 'boolean' ? value : fallback),
  sfxVolume: (value, fallback) => normalizeVolume(value, fallback),
  musicVolume: (value, fallback) => normalizeVolume(value, fallback),
  colorBlind: (value, fallback) => pick(value, COLOR_BLIND_MODES, fallback),
  highContrast: (value, fallback) => (typeof value === 'boolean' ? value : fallback),
};

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    normalized[key] = FIELD_NORMALIZERS[key](source[key], fallback);
  }
  return normalized;
}

// 合并规则：逐字段以服务端为准，只对服务端携带的键生效；
// 服务端缺失或非法的字段保留本地值，两者都非法时回退默认值。
export function mergeSettings(local, remote) {
  const base = normalizeSettings(local);
  if (!remote || typeof remote !== 'object') return base;
  const merged = { ...base };
  for (const [key, normalizer] of Object.entries(FIELD_NORMALIZERS)) {
    if (Object.prototype.hasOwnProperty.call(remote, key)) {
      merged[key] = normalizer(remote[key], base[key]);
    }
  }
  return merged;
}

// UTF-8 字节数：服务端按同一上限拒绝超大设置。
export function settingsPayloadBytes(value) {
  const text = JSON.stringify(value ?? null);
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(text).length
    : text.length;
}

export function readSettingsUpdatedAt(storage = globalThis.localStorage) {
  try {
    const stamp = Number(storage?.getItem?.(SETTINGS_UPDATED_KEY));
    return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
  } catch {
    return 0;
  }
}

// 把表现偏好写到根元素，供 CSS 高对比规则使用；无 document 的环境（Node 测试）跳过。
export function applyAccessibilityTheme(
  settings,
  root = globalThis.document?.documentElement
) {
  if (!root?.dataset) return;
  const normalized = normalizeSettings(settings);
  root.dataset.colorblind = normalized.colorBlind;
  root.dataset.contrast = normalized.highContrast ? 'high' : 'normal';
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
  let settings;
  try {
    const raw = storage?.getItem?.(SETTINGS_KEY);
    settings = raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  applyAccessibilityTheme(settings);
  return settings;
}

export function saveSettings(
  settings,
  storage = globalThis.localStorage,
  { updatedAt = Date.now() } = {}
) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const normalized = normalizeSettings(source);
  // 画质面板只提交画质字段：没带的音量/无障碍键沿用已存值，
  // 避免应用预设把音量或色弱设置重置。
  const previous = loadSettings(storage);
  for (const key of ['sfxVolume', 'musicVolume', 'colorBlind', 'highContrast']) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) normalized[key] = previous[key];
  }
  try {
    storage?.setItem?.(SETTINGS_KEY, JSON.stringify(normalized));
    storage?.setItem?.(SETTINGS_UPDATED_KEY, String(updatedAt));
  } catch {
    /* 存储不可用/配额满：本次仍使用内存设置 */
  }
  applyAccessibilityTheme(normalized);
  return normalized;
}

// 合并决策：服务端设置更新（或同样是首次登录）时以服务端为准；
// 本地更新更晚则把本地写回；服务端缺失/损坏时保留本地并写回修复。
export function resolveRemoteSettings({ local, localUpdatedAt = 0, remote = null } = {}) {
  const fallback = normalizeSettings(local);
  const remoteSettings =
    remote && typeof remote === 'object' && remote.settings && typeof remote.settings === 'object'
      ? remote.settings
      : null;
  if (!remoteSettings) {
    return { settings: fallback, updatedAt: localUpdatedAt, action: 'push' };
  }
  const remoteUpdatedAt = Number(remote.updatedAt);
  const remoteAt =
    Number.isFinite(remoteUpdatedAt) && remoteUpdatedAt > 0 ? remoteUpdatedAt : 0;
  if (remoteAt >= localUpdatedAt) {
    return {
      settings: mergeSettings(fallback, remoteSettings),
      updatedAt: remoteAt,
      action: 'pull',
    };
  }
  return { settings: fallback, updatedAt: localUpdatedAt, action: 'push' };
}

// 设置云同步：登录后拉取一次，修改后 2 秒节流写回。
// 任何网络/服务端错误都只影响同步本身，绝不阻塞进入游戏。
export class SettingsSync {
  constructor({
    api = null,
    storage = globalThis.localStorage,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    delayMs = SETTINGS_SYNC_DELAY_MS,
    onChange = null,
  } = {}) {
    this.api = api;
    this.storage = storage;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.delayMs = delayMs;
    this.onChange = onChange;
    this.timer = null;
    this.pending = null;
    this.lastFlush = null;
  }

  async pull() {
    if (!this.api?.settings) return null;
    let remote;
    try {
      remote = await this.api.settings();
    } catch {
      return null;
    }
    const local = loadSettings(this.storage);
    const decision = resolveRemoteSettings({
      local,
      localUpdatedAt: readSettingsUpdatedAt(this.storage),
      remote,
    });
    if (decision.action === 'pull') {
      const merged = saveSettings(decision.settings, this.storage, {
        updatedAt: decision.updatedAt,
      });
      this.onChange?.(merged);
      return merged;
    }
    this.push(decision.settings);
    return decision.settings;
  }

  push(settings) {
    this.pending = normalizeSettings(settings ?? loadSettings(this.storage));
    if (this.timer === null) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.flush();
      }, this.delayMs);
    }
    return this.pending;
  }

  flush() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const settings = this.pending;
    this.pending = null;
    if (!settings || !this.api?.saveSettings) return Promise.resolve(null);
    this.lastFlush = (async () => {
      try {
        const result = await this.api.saveSettings(
          settings,
          readSettingsUpdatedAt(this.storage)
        );
        // 服务端有更晚的修改：以最近修改为准，覆盖本地并把结果播给界面。
        if (result?.conflict && result.settings) {
          const merged = saveSettings(
            mergeSettings(loadSettings(this.storage), result.settings),
            this.storage,
            { updatedAt: Number(result.updatedAt) || 0 }
          );
          this.onChange?.(merged);
          return merged;
        }
        return result;
      } catch {
        return null;
      }
    })();
    return this.lastFlush;
  }

  cancel() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }
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
