// 登录/注册门槛与账号状态组件。样式独立在 auth.css，避免大改游戏 UI。
import { api, clearLegacyToken, legacyToken } from './api.js';

let gateOpen = false;

const STRENGTH_LEVELS = [
  { label: '太短', tone: 'weak' },
  { label: '偏弱', tone: 'weak' },
  { label: '一般', tone: 'fair' },
  { label: '较强', tone: 'good' },
  { label: '很强', tone: 'strong' },
];

// 仅作前端提示，服务端仍只校验长度；分数越高越接近「长度 + 大小写 + 数字 + 符号」。
export function passwordStrength(password) {
  const value = String(password || '');
  if (!value) return { score: 0, label: '', tone: 'weak', hint: '至少 8 位' };
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  const level = STRENGTH_LEVELS[Math.min(score, 4)];
  const hint = value.length < 8 ? '至少 8 位' : score < 2 ? '可加入大小写或符号' : '';
  return { score: Math.min(score, 4), label: level.label, tone: level.tone, hint };
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
      <h2 id="auth-title">登录</h2>
      <p class="auth-sub">必须注册账号才能进入游戏。进度、星核与解锁会保存到账号，可在其他设备登录继续。</p>

      <div class="auth-legacy" hidden>
        <p class="auth-legacy-info"></p>
        <button type="button" class="btn auth-claim-btn">绑定老账号并保留进度</button>
      </div>

      <div class="auth-tabs" role="tablist">
        <button type="button" data-mode="login" class="active">登录</button>
        <button type="button" data-mode="register">注册</button>
      </div>

      <form class="auth-form" novalidate>
        <label>
          <span>用户名</span>
          <input name="username" autocomplete="username" maxlength="16" spellcheck="false" required />
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required />
        </label>
        <div class="auth-strength" hidden aria-live="polite">
          <div class="auth-strength-bar"><span></span></div>
          <span class="auth-strength-label"></span>
        </div>
        <label class="auth-confirm" hidden>
          <span>确认密码</span>
          <input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" />
        </label>
        <p class="auth-error" hidden></p>
        <button type="submit" class="btn primary auth-submit">登录</button>
      </form>

      <p class="auth-note">用户名 3–16 位字母、数字或下划线 · 密码至少 8 位</p>
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
      title.textContent = '登录';
      sub.textContent = '必须注册账号才能进入游戏。进度、星核与解锁会保存到账号。';
      submit.textContent = '登录';
      passwordInput.autocomplete = 'current-password';
    } else if (next === 'register') {
      title.textContent = '创建账号';
      sub.textContent = '注册后自动登录。所有进度都会保存到账号，可在其他设备继续。';
      submit.textContent = '注册并进入';
      passwordInput.autocomplete = 'new-password';
    } else {
      title.textContent = '绑定老账号';
      sub.textContent = '设置用户名和密码，把旧浏览器的进度迁移到账号。';
      submit.textContent = '绑定并进入';
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
      showError('两次输入的密码不一致');
      return;
    }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      showError('用户名需为 3–16 位字母、数字或下划线');
      return;
    }
    if (password.length < 8) {
      showError('密码至少 8 位');
      return;
    }

    busy = true;
    submit.disabled = true;
    submit.textContent = '请稍候…';
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
        mode === 'login' ? '登录' : mode === 'register' ? '注册并进入' : '绑定并进入';
      showError(error.message || '操作失败，请稍后再试');
    }
  });

  function showRecovery(code) {
    card.innerHTML = `
      <p class="auth-brand">ABYSS TOWER</p>
      <h2>账号已创建</h2>
      <p class="auth-sub">请保存下面的恢复码。忘记密码时只能凭它找回，之后不再显示。</p>
      <code class="auth-recovery"></code>
      <div class="auth-recovery-actions">
        <button type="button" class="btn auth-copy">复制恢复码</button>
        <button type="button" class="btn primary auth-done">我已保存，进入游戏</button>
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
        copy.textContent = '已复制';
      } catch {
        error.textContent = '复制失败，请手动记录';
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
        legacyInfo.textContent = `检测到旧进度：${status.displayName || '老玩家'} · ${status.summary?.cores || 0} 星核 · ${status.summary?.runs || 0} 局`;
      })
      .catch(() => {
        /* 没有旧账号或服务端不支持绑定 */
      });
  }

  usernameInput.focus();
}

function formatTime(value) {
  if (!value) return '未知';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '未知';
  }
}

function sessionItem(item) {
  const li = document.createElement('li');
  li.className = 'auth-session';

  const head = document.createElement('div');
  head.className = 'auth-session-head';
  const title = document.createElement('span');
  title.textContent = item.current ? '本次登录' : '其他设备';
  head.appendChild(title);
  if (item.current) {
    const badge = document.createElement('span');
    badge.className = 'auth-session-badge';
    badge.textContent = '当前';
    head.appendChild(badge);
  }
  li.appendChild(head);

  const created = document.createElement('span');
  created.className = 'auth-session-meta';
  created.textContent = `登录时间 ${formatTime(item.createdAt)}`;
  li.appendChild(created);

  const active = document.createElement('span');
  active.className = 'auth-session-meta';
  active.textContent = `最近活跃 ${formatTime(item.lastUsedAt)}`;
  li.appendChild(active);

  const ip = document.createElement('span');
  ip.className = 'auth-session-meta';
  const shortIp = item.ipHash ? String(item.ipHash).slice(0, 12) : '未知';
  ip.textContent = `IP 指纹 ${shortIp}`;
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
      <h2 id="auth-sessions-title">登录设备</h2>
      <p class="auth-sub">这些设备当前可以访问你的账号。撤销后其他设备需要重新登录，本次登录会保留。</p>
      <ul class="auth-sessions" aria-live="polite"></ul>
      <p class="auth-error" hidden></p>
      <div class="auth-session-actions">
        <button type="button" class="btn auth-revoke-others">退出其他设备</button>
        <button type="button" class="btn primary auth-sessions-close">关闭</button>
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
      showError(error.message || '会话读取失败，请稍后再试');
    }
  }

  revokeButton.addEventListener('click', async () => {
    revokeButton.disabled = true;
    revokeButton.textContent = '撤销中…';
    showError('');
    try {
      const result = await api.revokeOtherSessions();
      await refresh();
      revokeButton.textContent = result?.revoked ? `已退出 ${result.revoked} 个设备` : '没有其他设备';
    } catch (error) {
      revokeButton.textContent = '退出其他设备';
      showError(error.message || '操作失败，请稍后再试');
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
    <button type="button" class="auth-widget-sessions">设备</button>
    <button type="button" class="auth-widget-logout">退出登录</button>
  `;
  widget.querySelector('.auth-widget-name').textContent = profile.name || profile.username;
  widget.querySelector('.auth-widget-sessions').addEventListener('click', openSessionPanel);
  const button = widget.querySelector('.auth-widget-logout');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = '退出中…';
    try {
      await onLogout();
    } finally {
      window.location.reload();
    }
  });
  // 只挂在大厅：进入战斗后随标题屏一起隐藏，避免遮挡手机端底部塔卡。
  (document.getElementById('title-screen') || document.body).appendChild(widget);
}
