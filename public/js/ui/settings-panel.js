// 设置面板：画面/音频/辅助/账号四个分区，逐项说明与重置，语言即时切换。
import {
  COLOR_BLIND_MODES,
  DEFAULT_SETTINGS,
  SETTING_OPTIONS,
  detectPreset,
  normalizeSettings,
  presetSettings,
} from '../settings.js';
import { DEFAULT_LOCALE, LOCALES, getLocale, setLocale, t, tOr } from '../i18n.js';
import { audio } from '../audio.js';
import { escapeHtml } from './shared.js';

// 设置项元数据：类型、控件 id 与文案 key。账号/通知是只读信息行，没有可重置的量。
const ITEM_META = {
  fps: { type: 'select', id: 'set-fps', label: 'settings.targetFps', desc: 'settings.desc.fps' },
  dpr: { type: 'select', id: 'set-dpr', label: 'settings.resolution', desc: 'settings.desc.dpr' },
  decorations: {
    type: 'select',
    id: 'set-decorations',
    label: 'settings.decorations',
    desc: 'settings.desc.decorations',
  },
  floaters: {
    type: 'select',
    id: 'set-floaters',
    label: 'settings.floaters',
    desc: 'settings.desc.floaters',
  },
  glow: { type: 'toggle', id: 'set-glow', label: 'settings.glow', desc: 'settings.desc.glow' },
  shake: { type: 'toggle', id: 'set-shake', label: 'settings.shake', desc: 'settings.desc.shake' },
  showFps: {
    type: 'toggle',
    id: 'set-showfps',
    label: 'settings.showFps',
    desc: 'settings.desc.showFps',
  },
  // 音乐/音效开关的 id 以字面量保留：浏览器脚本与源码级测试都依赖它们。
  music: {
    type: 'toggle',
    id: 'set-music',
    attr: 'id="set-music"',
    label: 'settings.music',
    desc: 'settings.desc.music',
  },
  sound: {
    type: 'toggle',
    id: 'set-sound',
    attr: 'id="set-sound"',
    label: 'settings.sound',
    desc: 'settings.desc.sound',
  },
  sfxVolume: {
    type: 'range',
    id: 'set-sfx-volume',
    label: 'settings.sfxVolume',
    desc: 'settings.desc.sfxVolume',
  },
  musicVolume: {
    type: 'range',
    id: 'set-music-volume',
    label: 'settings.musicVolume',
    desc: 'settings.desc.musicVolume',
  },
  colorBlind: {
    type: 'select',
    id: 'set-colorblind',
    label: 'settings.colorBlind',
    desc: 'settings.desc.colorBlind',
  },
  highContrast: {
    type: 'toggle',
    id: 'set-contrast',
    label: 'settings.highContrast',
    desc: 'settings.desc.highContrast',
  },
  language: {
    type: 'select',
    id: 'set-locale',
    label: 'settings.language',
    desc: 'settings.desc.language',
  },
  notifications: {
    type: 'static',
    label: 'settings.notifications',
    desc: 'settings.desc.notifications',
  },
  account: { type: 'static', label: 'settings.accountName', desc: 'settings.desc.account' },
};

const SECTIONS = [
  {
    id: 'display',
    title: 'settings.sectionDisplay',
    items: ['fps', 'dpr', 'decorations', 'floaters', 'glow', 'shake', 'showFps'],
  },
  {
    id: 'audio',
    title: 'settings.sectionAudio',
    items: ['music', 'sound', 'sfxVolume', 'musicVolume'],
  },
  {
    id: 'accessibility',
    title: 'settings.sectionAccessibility',
    items: ['colorBlind', 'highContrast'],
  },
  {
    id: 'account',
    title: 'settings.sectionAccount',
    items: ['language', 'notifications', 'account'],
  },
];

// 新增文案不写进词典，按当前语言就地回退，避免为两个按钮扩大 i18n 改动面。
const LOCAL_FALLBACK = {
  'settings.exportAudit': { zh: '导出审计日志', en: 'Export audit log' },
};

function textFor(key) {
  const entry = LOCAL_FALLBACK[key];
  const fallback = entry ? (getLocale() === 'en-US' ? entry.en : entry.zh) : key;
  return tOr(key, fallback);
}

// 重置只回到设置默认值；声音开关与语言不在 settings.js 的持久化对象里。
function resetValue(key) {
  if (key === 'sound') return true;
  if (key === 'language') return DEFAULT_LOCALE;
  return DEFAULT_SETTINGS[key];
}

function fieldOptions(key, current) {
  const pairs = (() => {
    switch (key) {
      case 'fps':
        return SETTING_OPTIONS.fps.map((value) => [value, `${value} FPS`]);
      case 'dpr':
        return SETTING_OPTIONS.dpr.map((value) => [
          value,
          t(value === 1 ? 'settings.dprStandard' : 'settings.dprHigh'),
        ]);
      case 'decorations':
        return SETTING_OPTIONS.decorations.map((value) => [value, t(`settings.decor.${value}`)]);
      case 'floaters':
        return SETTING_OPTIONS.floaters.map((value) => [value, t(`settings.floater.${value}`)]);
      case 'colorBlind':
        return COLOR_BLIND_MODES.map((value) => [value, t(`settings.colorBlind.${value}`)]);
      case 'language':
        return LOCALES.map((value) => [
          value,
          t(value === 'zh-CN' ? 'settings.languageZh' : 'settings.languageEn'),
        ]);
      default:
        return [];
    }
  })();
  return pairs
    .map(
      ([value, label]) =>
        `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${label}</option>`
    )
    .join('');
}

function controlHtml(key, value) {
  const meta = ITEM_META[key];
  if (meta.type === 'select') return `<select id="${meta.id}">${fieldOptions(key, value)}</select>`;
  if (meta.type === 'toggle') {
    const idAttr = meta.attr || `id="${meta.id}"`;
    return `<input type="checkbox" ${idAttr} ${value ? 'checked' : ''} aria-label="${t(meta.label)}" />`;
  }
  if (meta.type === 'range') {
    return `<input type="range" id="${meta.id}" min="0" max="100" step="1" value="${value}" /><output class="setting-range-value" data-output="${key}">${value}</output>`;
  }
  return '';
}

function exportLinksHtml() {
  return `
        <div class="setting-export">
          <span class="muted">${textFor('settings.exportAudit')}</span>
          <a class="btn small" href="/api/profile/audit/export?format=json" download>JSON</a>
          <a class="btn small ghost" href="/api/profile/audit/export?format=csv" download>CSV</a>
        </div>`;
}

function rowHtml(key, value, canExportAudit = false) {
  const meta = ITEM_META[key];
  const label = textFor(meta.label);
  const isStatic = meta.type === 'static';
  const labelTag = isStatic ? 'span' : 'label';
  const forAttr = isStatic ? '' : ` for="${meta.id}"`;
  const control = isStatic
    ? `<div class="setting-control"><span class="setting-static">${escapeHtml(value)}</span>${
        key === 'account' && canExportAudit ? exportLinksHtml() : ''
      }</div>`
    : `<div class="setting-control">${controlHtml(key, value)}</div>`;
  const reset = isStatic
    ? ''
    : `<button type="button" class="setting-reset" data-reset="${key}" title="${t('settings.reset')}" aria-label="${t('settings.resetAria')}: ${label}">↺</button>`;
  return `
    <div class="setting-row" data-setting="${key}">
      <div class="setting-copy">
        <${labelTag} class="setting-label"${forAttr}>${label}</${labelTag}>
        <span class="setting-desc">${t(meta.desc)}</span>
      </div>
      ${control}
      ${reset}
    </div>`;
}

export const settingsPanelMethods = {
  showSettings({ settings, inGame = false, onApply, onCancel, onQuit = null }) {
    const current = normalizeSettings(settings);
    const presetLabel = (name) =>
      name === 'custom'
        ? t('settings.presetCustom')
        : name === 'low'
          ? t('settings.presetLowName')
          : t('settings.presetHighName');
    const accountName = this.profile?.name || this.profile?.username;
    const accountText = accountName
      ? [
          accountName,
          this.profile?.username && this.profile.username !== accountName
            ? `@${this.profile.username}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : t('settings.accountGuest');
    const values = {
      ...current,
      sound: audio.enabled,
      language: getLocale(),
      account: accountText,
      notifications: '',
    };
    const canExportAudit = Boolean(this.profile?.username);
    const sections = SECTIONS.map((section) => {
      const rows = section.items
        .map((key) => rowHtml(key, values[key], canExportAudit))
        .join('');
      const count = section.items.filter((key) => ITEM_META[key].type !== 'static').length;
      return `
        <details class="settings-section" data-section="${section.id}" open>
          <summary>
            <span class="settings-section-title">${t(section.title)}</span>
            <span class="settings-section-count">${t('settings.itemCount', { n: count })}</span>
          </summary>
          <div class="settings-grid">${rows}</div>
        </details>`;
    }).join('');

    const modal = this.openModal(
      `
        <div class="settings">
          <p class="eyebrow">${t('settings.eyebrow')}</p>
          <h2>${t('settings.title')}</h2>
          <p class="muted">${t(inGame ? 'settings.noteInGame' : 'settings.note')}</p>
          <div class="settings-sections">${sections}</div>
          <div class="settings-presets">
            <button class="btn small" id="preset-low">${t('settings.presetLow')}</button>
            <button class="btn small" id="preset-high">${t('settings.presetHigh')}</button>
            <button class="btn small ghost" id="settings-reset-all">${t('settings.resetAll')}</button>
            <span class="muted" id="preset-label">${t('settings.currentPreset', { preset: presetLabel(detectPreset(current)) })}</span>
          </div>
          <div class="modal-actions">
            ${inGame && onQuit ? `<button class="btn danger settings-quit" id="settings-quit">${t('settings.quitRun')}</button>` : ''}
            <button class="btn primary" id="settings-apply">${t('common.apply')}</button>
            <button class="btn ghost" id="settings-cancel">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      {
        className: 'settings-modal',
        closable: true,
        onClose: () => onCancel?.(),
      }
    );

    const control = (id) => modal.querySelector(`#${id}`);
    const read = () => ({
      fps: Number(control('set-fps').value),
      dpr: Number(control('set-dpr').value),
      decorations: control('set-decorations').value,
      floaters: control('set-floaters').value,
      glow: control('set-glow').checked,
      shake: control('set-shake').checked,
      showFps: control('set-showfps').checked,
      music: control('set-music').checked,
      sfxVolume: Number(control('set-sfx-volume').value),
      musicVolume: Number(control('set-music-volume').value),
      colorBlind: control('set-colorblind').value,
      highContrast: control('set-contrast').checked,
    });

    const setControl = (key, value) => {
      const meta = ITEM_META[key];
      if (!meta || meta.type === 'static') return;
      const input = control(meta.id);
      if (!input) return;
      if (meta.type === 'toggle') input.checked = !!value;
      else input.value = String(value);
      if (meta.type === 'range') {
        const output = modal.querySelector(`[data-output="${key}"]`);
        if (output) output.textContent = String(value);
      }
    };

    const updateLabel = () => {
      const detected = detectPreset(read());
      control('preset-label').textContent = t('settings.currentPreset', {
        preset: presetLabel(detected),
      });
    };

    const fill = (next) => {
      const normalized = normalizeSettings(next);
      for (const key of Object.keys(DEFAULT_SETTINGS)) setControl(key, normalized[key]);
      updateLabel();
    };

    modal.querySelectorAll('select, input').forEach((input) => {
      input.addEventListener('change', updateLabel);
    });
    const rangeOutputs = { 'set-sfx-volume': 'sfxVolume', 'set-music-volume': 'musicVolume' };
    modal.querySelectorAll('input[type="range"]').forEach((input) => {
      input.addEventListener('input', () => {
        const output = modal.querySelector(`[data-output="${rangeOutputs[input.id]}"]`);
        if (output) output.textContent = input.value;
        updateLabel();
      });
    });
    modal.querySelectorAll('[data-reset]').forEach((button) => {
      button.onclick = () => {
        setControl(button.dataset.reset, resetValue(button.dataset.reset));
        updateLabel();
      };
    });
    // 语言即时生效：保留未提交的其他改动并重建面板，让面板自身也切换文案。
    control('set-locale').addEventListener('change', (event) => {
      const draft = read();
      setLocale(event.target.value);
      this.showSettings({ settings: draft, inGame, onApply, onCancel, onQuit });
    });
    // 画质预设不覆盖用户单独选择的音乐、音量与无障碍偏好。
    const applyPreset = (name) => {
      const preset = presetSettings(name);
      const draft = read();
      fill({
        fps: preset.fps,
        dpr: preset.dpr,
        decorations: preset.decorations,
        floaters: preset.floaters,
        glow: preset.glow,
        shake: preset.shake,
        showFps: preset.showFps,
        music: draft.music,
        sfxVolume: draft.sfxVolume,
        musicVolume: draft.musicVolume,
        colorBlind: draft.colorBlind,
        highContrast: draft.highContrast,
      });
    };
    control('preset-low').onclick = () => applyPreset('low');
    control('preset-high').onclick = () => applyPreset('high');
    // 全部重置只作用于设置项，账号信息与云端进度不在设置对象里。
    control('settings-reset-all').onclick = () => {
      for (const key of Object.keys(DEFAULT_SETTINGS)) setControl(key, DEFAULT_SETTINGS[key]);
      setControl('sound', true);
      setControl('language', DEFAULT_LOCALE);
      updateLabel();
    };
    control('settings-apply').onclick = () => {
      const next = read();
      const locale = control('set-locale').value;
      if (locale !== getLocale()) setLocale(locale);
      audio.setEnabled(control('set-sound').checked);
      audio.setMusicEnabled(next.music);
      audio.setSfxVolume(next.sfxVolume);
      audio.setMusicVolume(next.musicVolume);
      this.updateSoundIcon();
      this._modalOnClose = null;
      this.closeModal();
      onApply?.(next);
    };
    control('settings-cancel').onclick = () => this.closeModal();
    // 局内退出入口：设置面板本身就是"暂停时的菜单"，退出放在这里比 HUD 角落更显眼。
    const quitButton = control('settings-quit');
    if (quitButton) {
      quitButton.onclick = () => {
        this.closeModal();
        onQuit?.();
      };
    }
  },
};
