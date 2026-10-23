// 设置面板：画质、音量、语言即时切换与预设。
import { normalizeSettings, detectPreset, presetSettings } from '../settings.js';
import { t, getLocale, setLocale, LOCALES } from '../i18n.js';
import { audio } from '../audio.js';

export const settingsPanelMethods = {
  showSettings({ settings, inGame = false, onApply, onCancel }) {
    const current = normalizeSettings(settings);
    const option = (value, label, selected) =>
      `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`;
    const presetLabel = (name) =>
      name === 'custom'
        ? t('settings.presetCustom')
        : name === 'low'
          ? t('settings.presetLowName')
          : t('settings.presetHighName');
    const toOption = (value, label, selected) =>
      `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`;
    const currentLocale = getLocale();

    const modal = this.openModal(
      `
        <div class="settings">
          <p class="eyebrow">${t('settings.eyebrow')}</p>
          <h2>${t('settings.title')}</h2>
          <p class="muted">${t(inGame ? 'settings.noteInGame' : 'settings.note')}</p>
          <div class="settings-grid">
            <label class="setting-field"><span>${t('settings.targetFps')}</span>
              <select id="set-fps">${option(30, '30 FPS', current.fps)}${option(60, '60 FPS', current.fps)}</select>
            </label>
            <label class="setting-field"><span>${t('settings.resolution')}</span>
              <select id="set-dpr">${option(1, t('settings.dprStandard'), current.dpr)}${option(2, t('settings.dprHigh'), current.dpr)}</select>
            </label>
            <label class="setting-field"><span>${t('settings.decorations')}</span>
              <select id="set-decorations">${['off', 'light', 'full']
                .map((value) => option(value, t(`settings.decor.${value}`), current.decorations))
                .join('')}</select>
            </label>
            <label class="setting-field"><span>${t('settings.floaters')}</span>
              <select id="set-floaters">${['off', 'key', 'all']
                .map((value) => option(value, t(`settings.floater.${value}`), current.floaters))
                .join('')}</select>
            </label>
            <label class="setting-check"><input type="checkbox" id="set-glow" ${current.glow ? 'checked' : ''} /> ${t('settings.glow')}</label>
            <label class="setting-check"><input type="checkbox" id="set-shake" ${current.shake ? 'checked' : ''} /> ${t('settings.shake')}</label>
            <label class="setting-check"><input type="checkbox" id="set-showfps" ${current.showFps ? 'checked' : ''} /> ${t('settings.showFps')}</label>
            <label class="setting-check"><input type="checkbox" id="set-music" ${current.music ? 'checked' : ''} /> ${t('settings.music')}</label>
            <label class="setting-check"><input type="checkbox" id="set-sound" ${audio.enabled ? 'checked' : ''} /> ${t('settings.sound')}</label>
            <label class="setting-field"><span>${t('settings.language')}</span>
              <select id="set-locale">${LOCALES.map((locale) =>
                toOption(locale, t(locale === 'zh-CN' ? 'settings.languageZh' : 'settings.languageEn'), currentLocale)
              ).join('')}</select>
            </label>
          </div>
          <div class="settings-presets">
            <button class="btn small" id="preset-low">${t('settings.presetLow')}</button>
            <button class="btn small" id="preset-high">${t('settings.presetHigh')}</button>
            <span class="muted" id="preset-label">${t('settings.currentPreset', { preset: presetLabel(detectPreset(current)) })}</span>
          </div>
          <div class="modal-actions">
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

    const read = () => ({
      fps: Number(modal.querySelector('#set-fps').value),
      dpr: Number(modal.querySelector('#set-dpr').value),
      decorations: modal.querySelector('#set-decorations').value,
      floaters: modal.querySelector('#set-floaters').value,
      glow: modal.querySelector('#set-glow').checked,
      shake: modal.querySelector('#set-shake').checked,
      showFps: modal.querySelector('#set-showfps').checked,
      music: modal.querySelector('#set-music').checked,
    });

    const fill = (values) => {
      const next = normalizeSettings(values);
      modal.querySelector('#set-fps').value = String(next.fps);
      modal.querySelector('#set-dpr').value = String(next.dpr);
      modal.querySelector('#set-decorations').value = next.decorations;
      modal.querySelector('#set-floaters').value = next.floaters;
      modal.querySelector('#set-glow').checked = next.glow;
      modal.querySelector('#set-shake').checked = next.shake;
      modal.querySelector('#set-showfps').checked = next.showFps;
      modal.querySelector('#set-music').checked = next.music;
      modal.querySelector('#set-sound').checked = audio.enabled;
      updateLabel();
    };

    const updateLabel = () => {
      const detected = detectPreset(read());
      modal.querySelector('#preset-label').textContent =
        t('settings.currentPreset', { preset: presetLabel(detected) });
    };

    modal.querySelectorAll('select, input').forEach((input) => {
      input.addEventListener('change', updateLabel);
    });
    // 语言即时生效：保留未提交的画质改动并重建面板，让面板自身也切换文案。
    modal.querySelector('#set-locale').addEventListener('change', (event) => {
      const next = read();
      setLocale(event.target.value);
      this.showSettings({ settings: next, inGame, onApply, onCancel });
    });
    // 画质预设不覆盖用户单独选择的音乐开关。
    const applyPreset = (name) => {
      fill({ ...presetSettings(name), music: modal.querySelector('#set-music').checked });
    };
    modal.querySelector('#preset-low').onclick = () => applyPreset('low');
    modal.querySelector('#preset-high').onclick = () => applyPreset('high');
    modal.querySelector('#settings-apply').onclick = () => {
      const next = read();
      audio.setEnabled(modal.querySelector('#set-sound').checked);
      audio.setMusicEnabled(next.music);
      this.updateSoundIcon();
      this._modalOnClose = null;
      this.closeModal();
      onApply?.(next);
    };
    modal.querySelector('#settings-cancel').onclick = () => this.closeModal();
  },
};
