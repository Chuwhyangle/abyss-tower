// 登录/注册门槛与账号状态组件。样式独立在 auth.css，避免大改游戏 UI。
import { api, clearLegacyToken, legacyToken } from './api.js';
import { t } from './i18n.js';

let gateOpen = false;

const STRENGTH_LEVELS = [
  { key: 'auth.strength.tooShort', tone: 'weak' },
  { key: 'auth.strength.weak', tone: 'weak' },
  { key: 'auth.strength.fair', tone: 'fair' },
  { key: 'auth.strength.good', tone: 'good' },
  { key: 'auth.strength.strong', tone: 'strong' },
];

// 仅作前端提示，服务端仍只校验长度；分数越高越接近「长度 + 大小写 + 数字 + 符号」。
export function passwordStrength(password) {
  const value = String(password || '');
  if (!value) return { score: 0, label: '', tone: 'weak', hint: t('auth.hint.minLength') };
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  const level = STRENGTH_LEVELS[Math.min(score, 4)];
  const hint =
    value.length < 8 ? t('auth.hint.minLength') : score < 2 ? t('auth.hint.mixed') : '';
  return { score: Math.min(score, 4), label: t(level.key), tone: level.tone, hint };
}

export async function ensureAuthGate() {
  const config = await api.config().catch(() => ({ authEnabled: true }));
  if (!config.authEnabled) return true;
  try {
    await api.authMe();
    return true;
  } catch (error) {
    if (error.status !== 401) console.error('[auth] 会话检查失败', error);
    openGate();
    return false;
  }
}

function openGate() {
  if (gateOpen) return;
  gateOpen = true;

  const root = document.getElementById('auth-root') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <p class="auth-brand">ABYSS TOWER</p>
      <h2 id="auth-title">${t('auth.loginTitle')}</h2>
      <p class="auth-sub">${t('auth.gateSubtitle')}</p>

      <div class="auth-legacy" hidden>
        <p class="auth-legacy-info"></p>
        <button type="button" class="btn auth-claim-btn">${t('auth.claimButton')}</button>
      </div>

      <div class="auth-tabs" role="tablist">
        <button type="button" data-mode="login" class="active">${t('auth.loginTitle')}</button>
        <button type="button" data-mode="register">${t('auth.registerTab')}</button>
      </div>

      <form class="auth-form" novalidate>
        <label>
          <span>${t('auth.username')}</span>
          <input name="username" autocomplete="username" maxlength="16" spellcheck="false" required />
        </label>
        <label>
          <span>${t('auth.password')}</span>
          <input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required />
        </label>
        <div class="auth-strength" hidden aria-live="polite">
          <div class="auth-strength-bar"><span></span></div>
          <span class="auth-strength-label"></span>
        </div>
        <label class="auth-confirm" hidden>
          <span>${t('auth.confirmPassword')}</span>
          <input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" />
        </label>
        <p class="auth-error" hidden></p>
        <button type="submit" class="btn primary auth-submit">${t('auth.loginTitle')}</button>
      </form>

      <p class="auth-note">${t('auth.note')}</p>
    </div>
  `;
  root.appendChild(overlay);

  const card = overlay.querySelector('.auth-card');
  const title = overlay.querySelector('#auth-title');
  const sub = overlay.querySelector('.auth-sub');
  const tabs = overlay.querySelector('.auth-tabs');
  const form = overlay.querySelector('.auth-form');
  const usernameInput = form.elements.username;
  const passwordInput = form.elements.password;
  const confirmLabel = overlay.querySelector('.auth-confirm');
  const confirmInput = form.elements.confirm;
  const strengthBox = overlay.querySelector('.auth-strength');
  const strengthBar = overlay.querySelector('.auth-strength-bar span');
  const strengthLabel = overlay.querySelector('.auth-strength-label');
  const errorBox = overlay.querySelector('.auth-error');
  const submit = overlay.querySelector('.auth-submit');
  const legacyBox = overlay.querySelector('.auth-legacy');
  const legacyInfo = overlay.querySelector('.auth-legacy-info');
  const claimButton = overlay.querySelector('.auth-claim-btn');

  let mode = 'login';
  let busy = false;

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function updateStrength() {
    if (mode === 'login' || !passwordInput.value) {
      strengthBox.hidden = true;
      return;
    }
    const info = passwordStrength(passwordInput.value);
    strengthBox.hidden = false;
    strengthBox.dataset.tone = info.tone;
    strengthBar.style.width = `${(info.score / 4) * 100}%`;
    strengthLabel.textContent = info.hint ? `${info.label} · ${info.hint}` : info.label;
  }

  function setMode(next) {
    mode = next;
    showError('');
    updateStrength();
    for (const button of tabs.querySelectorAll('button')) {
      button.classList.toggle('active', button.dataset.mode === next);
    }
    const needsConfirm = next !== 'login';
    confirmLabel.hidden = !needsConfirm;
    confirmInput.required = needsConfirm;
    tabs.hidden = next === 'claim';
    legacyBox.hidden = true;
    if (next === 'login') {
      title.textContent = t('auth.loginTitle');
      sub.textContent = t('auth.loginSubtitle');
      submit.textContent = t('auth.loginTitle');
      passwordInput.autocomplete = 'current-password';
    } else if (next === 'register') {
      title.textContent = t('auth.registerTitle');
      sub.textContent = t('auth.registerSubtitle');
      submit.textContent = t('auth.registerSubmit');
      passwordInput.autocomplete = 'new-password';
    } else {
      title.textContent = t('auth.claimTitle');
      sub.textContent = t('auth.claimSubtitle');
      submit.textContent = t('auth.claimSubmit');
      passwordInput.autocomplete = 'new-password';
    }
    if (next !== 'claim' && legacyBox.dataset.available === '1') legacyBox.hidden = false;
  }

  passwordInput.addEventListener('input', updateStrength);

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button || busy) return;
    setMode(button.dataset.mode);
  });

  claimButton.addEventListener('click', () => {
    if (busy) return;
    setMode('claim');
    usernameInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    showError('');
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (mode !== 'login' && password !== confirmInput.value) {
      showError(t('auth.error.passwordMismatch'));
      return;
    }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      showError(t('auth.error.usernameFormat'));
      return;
    }
    if (password.length < 8) {
      showError(t('auth.error.passwordLength'));
      return;
    }

    busy = true;
    submit.disabled = true;
    submit.textContent = t('auth.submitting');
    try {
      const result =
        mode === 'login'
          ? await api.login(username, password)
          : mode === 'register'
            ? await api.register(username, password)
            : await api.claim(username, password);
      clearLegacyToken();
      if (result?.recoveryCode) {
        showRecovery(result.recoveryCode);
      } else {
        window.location.reload();
      }
    } catch (error) {
      busy = false;
      submit.disabled = false;
      submit.textContent =
        mode === 'login'
          ? t('auth.loginTitle')
          : mode === 'register'
            ? t('auth.registerSubmit')
            : t('auth.claimSubmit');
      showError(error.message || t('auth.error.generic'));
    }
  });

  function showRecovery(code) {
    card.innerHTML = `
      <p class="auth-brand">ABYSS TOWER</p>
      <h2>${t('auth.recoveryTitle')}</h2>
      <p class="auth-sub">${t('auth.recoveryHint')}</p>
      <code class="auth-recovery"></code>
      <div class="auth-recovery-actions">
        <button type="button" class="btn auth-copy">${t('auth.copyRecovery')}</button>
        <button type="button" class="btn primary auth-done">${t('auth.recoveryDone')}</button>
      </div>
      <p class="auth-error" hidden></p>
    `;
    const recovery = card.querySelector('.auth-recovery');
    const copy = card.querySelector('.auth-copy');
    const done = card.querySelector('.auth-done');
    const error = card.querySelector('.auth-error');
    recovery.textContent = code;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = t('auth.copied');
      } catch {
        error.textContent = t('auth.copyFailed');
        error.hidden = false;
      }
    });
    done.addEventListener('click', () => window.location.reload());
    done.focus();
  }

  // 旧匿名令牌：显示可绑定的老进度；绑定后由服务端原地升级账号。
  if (legacyToken()) {
    api
      .legacyStatus()
      .then((status) => {
        if (!status?.claimable) return;
        legacyBox.dataset.available = '1';
        legacyBox.hidden = false;
        legacyInfo.textContent = t('auth.legacyInfo', {
          name: status.displayName || t('auth.legacyPlayer'),
          cores: status.summary?.cores || 0,
          runs: status.summary?.runs || 0,
        });
      })
      .catch(() => {
        /* 没有旧账号或服务端不支持绑定 */
      });
  }

  usernameInput.focus();
}

function formatTime(value) {
  if (!value) return t('auth.unknown');
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return t('auth.unknown');
  }
}

function sessionItem(item) {
  const li = document.createElement('li');
  li.className = 'auth-session';

  const head = document.createElement('div');
  head.className = 'auth-session-head';
  const title = document.createElement('span');
  title.textContent = item.current ? t('auth.sessionCurrent') : t('auth.sessionOther');
  head.appendChild(title);
  if (item.current) {
    const badge = document.createElement('span');
    badge.className = 'auth-session-badge';
    badge.textContent = t('draft.current');
    head.appendChild(badge);
  }
  li.appendChild(head);

  const created = document.createElement('span');
  created.className = 'auth-session-meta';
  created.textContent = t('auth.loginTime', { time: formatTime(item.createdAt) });
  li.appendChild(created);

  const active = document.createElement('span');
  active.className = 'auth-session-meta';
  active.textContent = t('auth.lastActive', { time: formatTime(item.lastUsedAt) });
  li.appendChild(active);

  const ip = document.createElement('span');
  ip.className = 'auth-session-meta';
  const shortIp = item.ipHash ? String(item.ipHash).slice(0, 12) : t('auth.unknown');
  ip.textContent = t('auth.ipFingerprint', { ip: shortIp });
  li.appendChild(ip);

  return li;
}

function openSessionPanel() {
  document.querySelector('.auth-session-overlay')?.remove();
  const root = document.getElementById('auth-root') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay auth-session-overlay';
  overlay.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-sessions-title">
      <p class="auth-brand">ABYSS TOWER</p>
      <h2 id="auth-sessions-title">${t('auth.sessionsTitle')}</h2>
      <p class="auth-sub">${t('auth.sessionsSubtitle')}</p>
      <ul class="auth-sessions" aria-live="polite"></ul>
      <p class="auth-error" hidden></p>
      <div class="auth-session-actions">
        <button type="button" class="btn auth-revoke-others">${t('auth.revokeOthers')}</button>
        <button type="button" class="btn primary auth-sessions-close">${t('common.close')}</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  const list = overlay.querySelector('.auth-sessions');
  const errorBox = overlay.querySelector('.auth-error');
  const revokeButton = overlay.querySelector('.auth-revoke-others');
  const closeButton = overlay.querySelector('.auth-sessions-close');

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  async function refresh() {
    try {
      const data = await api.sessions();
      list.replaceChildren(...(data?.sessions || []).map(sessionItem));
    } catch (error) {
      showError(error.message || t('auth.error.sessionsLoad'));
    }
  }

  revokeButton.addEventListener('click', async () => {
    revokeButton.disabled = true;
    revokeButton.textContent = t('auth.revoking');
    showError('');
    try {
      const result = await api.revokeOtherSessions();
      await refresh();
      revokeButton.textContent = result?.revoked
        ? t('auth.revokedDevices', { count: result.revoked })
        : t('auth.noOtherDevices');
    } catch (error) {
      revokeButton.textContent = t('auth.revokeOthers');
      showError(error.message || t('auth.error.generic'));
    } finally {
      revokeButton.disabled = false;
    }
  });

  closeButton.addEventListener('click', () => overlay.remove());
  refresh();
  closeButton.focus();
}

export function mountAuthWidget(profile, onLogout) {
  document.querySelector('.auth-widget')?.remove();
  if (!profile?.username) return;
  const widget = document.createElement('div');
  widget.className = 'auth-widget';
  widget.innerHTML = `
    <span class="auth-widget-name"></span>
    <button type="button" class="auth-widget-sessions">${t('auth.widgetSessions')}</button>
    <button type="button" class="auth-widget-logout">${t('auth.logout')}</button>
  `;
  widget.querySelector('.auth-widget-name').textContent = profile.name || profile.username;
  widget.querySelector('.auth-widget-sessions').addEventListener('click', openSessionPanel);
  const button = widget.querySelector('.auth-widget-logout');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = t('auth.loggingOut');
    try {
      await onLogout();
    } finally {
      window.location.reload();
    }
  });
  // 只挂在大厅：进入战斗后随标题屏一起隐藏，避免遮挡手机端底部塔卡。
  (document.getElementById('title-screen') || document.body).appendChild(widget);
}
