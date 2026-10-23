// 服务端 API 封装：账号会话走 HttpOnly Cookie，旧的匿名令牌只用于绑定老账号。
// 统一把网络失败、超时、非 2xx 与响应解析失败包装成带 code 的 ApiError，面文案面向玩家。
const LEGACY_TOKEN_KEY = 'abyss-tower.token';

// 错误码：调用方按 code 分支，message 直接展示给玩家。
export const API_ERROR = {
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  HTTP: 'http',
  PARSE: 'parse',
};

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRY_DELAY_MS = 200;
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);

export class ApiError extends Error {
  constructor(message, { code = API_ERROR.HTTP, status = 0, data = null, cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.data = data;
    if (cause) this.cause = cause;
  }
}

// 可自动重试的错误：网络断开、超时、服务端 5xx。4xx 与解析失败重试没有意义。
export function isRetryableError(error) {
  if (!error) return false;
  if (error.code === API_ERROR.OFFLINE || error.code === API_ERROR.TIMEOUT) return true;
  return typeof error.status === 'number' && error.status >= 500;
}

// 面向玩家的提示：ApiError 的 message 已是中文文案，不携带堆栈。
export function errorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return '操作失败，请稍后重试';
}

export function legacyToken() {
  try {
    return localStorage.getItem(LEGACY_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function clearLegacyToken() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function requestLegacyToken(legacyMode) {
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

function legacyHeaders() {
  const token = legacyToken();
  return token ? { 'x-player-token': token } : {};
}

// 浏览器内广播在线/离线状态，供顶部错误条展示；Node 测试环境自动跳过。
function emitWindowEvent(name) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    const EventCtor = typeof CustomEvent === 'function' ? CustomEvent : Event;
    window.dispatchEvent(new EventCtor(name));
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultHttpMessage(status) {
  if (status >= 500) return `服务器暂时不可用（${status}），请稍后重试`;
  return `请求失败（${status}）`;
}

export function createApi({
  fetchImpl = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  let legacyMode = false;
  let offline = false;

  function resolveFetch() {
    if (fetchImpl) return fetchImpl;
    if (typeof fetch === 'function') return fetch;
    return null;
  }

  async function requestOnce(path, { method, body, headers }) {
    const doFetch = resolveFetch();
    if (!doFetch) {
      throw new ApiError('无法连接服务器，请检查网络后重试', { code: API_ERROR.OFFLINE });
    }

    const legacy = requestLegacyToken(legacyMode);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer =
      controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response;
    try {
      response = await doFetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(legacy ? { 'x-player-token': legacy } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (cause) {
      const timedOut = !!controller?.signal.aborted;
      throw new ApiError(
        timedOut ? '请求超时，请稍后重试' : '无法连接服务器，请检查网络后重试',
        { code: timedOut ? API_ERROR.TIMEOUT : API_ERROR.OFFLINE, cause }
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    let text = '';
    try {
      text = await response.text();
    } catch (cause) {
      throw new ApiError('响应读取失败，请检查网络后重试', {
        code: API_ERROR.OFFLINE,
        status: response.status,
        cause,
      });
    }

    let data = null;
    let parseFailed = false;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        parseFailed = true;
      }
    }

    if (!response.ok) {
      throw new ApiError(data?.error || defaultHttpMessage(response.status), {
        code: data?.code || API_ERROR.HTTP,
        status: response.status,
        data,
      });
    }

    // 204/空响应是合法结果（如退出登录）；非空但解析失败才是异常。
    if (parseFailed) {
      throw new ApiError('服务器响应格式异常，请稍后重试', {
        code: API_ERROR.PARSE,
        status: response.status,
      });
    }

    return data;
  }

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const upperMethod = String(method).toUpperCase();
    // 幂等请求失败自动重试一次；非幂等请求绝不重放。
    const attempts = IDEMPOTENT_METHODS.has(upperMethod) ? 2 : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const data = await requestOnce(path, {
          method: upperMethod,
          body,
          headers,
        });
        if (offline) {
          offline = false;
          emitWindowEvent('rtd:online');
        }
        return data;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryableError(error)) break;
        if (retryDelayMs > 0) await sleep(retryDelayMs);
      }
    }

    if (
      (lastError.code === API_ERROR.OFFLINE || lastError.code === API_ERROR.TIMEOUT) &&
      !offline
    ) {
      offline = true;
      emitWindowEvent('rtd:offline');
    }
    throw lastError;
  }

  return {
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
    settings() {
      return request('/api/profile/settings');
    },
    saveSettings(settings, updatedAt) {
      return request('/api/profile/settings', {
        method: 'PUT',
        body: { settings, updatedAt },
      });
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
    startRun(mode, difficulty = 'standard', mutations = null) {
      const body = { mode, difficulty };
      if (mutations?.length) body.mutations = mutations;
      return request('/api/runs', { method: 'POST', body });
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
    getEvent(id) {
      return request(`/api/runs/${encodeURIComponent(id)}/events`, { method: 'POST', body: {} });
    },
    pickEvent(id, selection) {
      return request(`/api/runs/${encodeURIComponent(id)}/event`, {
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
}

export const api = createApi();
