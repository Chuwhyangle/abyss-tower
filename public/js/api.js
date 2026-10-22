// 服务端 API 封装：账号会话走 HttpOnly Cookie，旧的匿名令牌只用于绑定老账号。
const LEGACY_TOKEN_KEY = 'abyss-tower.token';
let legacyMode = false;

export function legacyToken() {
  try {
    return localStorage.getItem(LEGACY_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function requestLegacyToken() {
  if (!legacyMode) return '';
  let token = legacyToken();
  if (!token) {
    token =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    try {
      localStorage.setItem(LEGACY_TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  }
  return token;
}

export function clearLegacyToken() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  let response;
  const legacy = requestLegacyToken();
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(legacy ? { 'x-player-token': legacy } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('无法连接服务器，请检查服务是否在运行');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* 非 JSON 响应 */
  }

  if (!response.ok) {
    const error = new Error(data?.error || `请求失败 (${response.status})`);
    error.status = response.status;
    error.code = data?.code;
    error.data = data;
    throw error;
  }
  return data;
}

function legacyHeaders() {
  const token = legacyToken();
  return token ? { 'x-player-token': token } : {};
}

export const api = {
  async config() {
    const config = await request('/api/config');
    legacyMode = !config.authEnabled;
    return config;
  },
  authMe() {
    return request('/api/auth/me');
  },
  register(username, password) {
    return request('/api/auth/register', {
      method: 'POST',
      body: { username, password },
    });
  },
  login(username, password) {
    return request('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  },
  logout() {
    return request('/api/auth/logout', { method: 'POST', body: {} });
  },
  legacyStatus() {
    return request('/api/auth/legacy', { headers: legacyHeaders() });
  },
  claim(username, password) {
    return request('/api/auth/claim', {
      method: 'POST',
      body: { username, password },
      headers: legacyHeaders(),
    });
  },
  session(name) {
    return request('/api/session', {
      method: 'POST',
      body: name === undefined ? {} : { name },
    });
  },
  profile() {
    return request('/api/profile');
  },
  progress(type) {
    const query = type ? `?type=${encodeURIComponent(type)}` : '';
    return request(`/api/profile/progress${query}`);
  },
  leaderboard(mode = 'normal') {
    return request(`/api/leaderboard?mode=${encodeURIComponent(mode)}`);
  },
  activeRun() {
    return request('/api/runs/active');
  },
  startRun(mode, difficulty = 'standard') {
    return request('/api/runs', { method: 'POST', body: { mode, difficulty } });
  },
  getRun(id) {
    return request(`/api/runs/${encodeURIComponent(id)}`);
  },
  selectMap(id, index) {
    return request(`/api/runs/${encodeURIComponent(id)}/map`, {
      method: 'POST',
      body: { index },
    });
  },
  startWave(id) {
    return request(`/api/runs/${encodeURIComponent(id)}/wave`, { method: 'POST', body: {} });
  },
  clearWave(id, wave) {
    return request(`/api/runs/${encodeURIComponent(id)}/clear`, {
      method: 'POST',
      body: { wave },
    });
  },
  getRelics(id, reroll = false) {
    return request(`/api/runs/${encodeURIComponent(id)}/relics`, {
      method: 'POST',
      body: { reroll },
    });
  },
  pickRelic(id, selection) {
    return request(`/api/runs/${encodeURIComponent(id)}/relic`, {
      method: 'POST',
      body: typeof selection === 'number' ? { index: selection } : selection,
    });
  },
  finishRun(id, payload) {
    return request(`/api/runs/${encodeURIComponent(id)}/finish`, {
      method: 'POST',
      body: payload,
    });
  },
  abandonRun(id) {
    return request(`/api/runs/${encodeURIComponent(id)}/abandon`, {
      method: 'POST',
      body: {},
    });
  },
  unlock(unlockId) {
    return request('/api/unlock', { method: 'POST', body: { unlockId } });
  },
};
