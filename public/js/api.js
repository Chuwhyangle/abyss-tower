// 服务端 API 封装：账号会话走 HttpOnly Cookie，旧的匿名令牌只用于绑定老账号。
// 统一把网络失败、超时、非 2xx 与响应解析失败包装成带 code 的 ApiError，面文案面向玩家。
import { t } from './i18n.js';

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

// 面向玩家的提示：ApiError 的 message 已是本地化文案，不携带堆栈。
export function errorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return t('diagnostics.fallback');
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
  if (status >= 500) return t('api.serverUnavailable', { status });
  return t('api.requestFailed', { status });
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
      throw new ApiError(t('api.offline'), { code: API_ERROR.OFFLINE });
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
      throw new ApiError(t(timedOut ? 'api.timeout' : 'api.offline'), {
        code: timedOut ? API_ERROR.TIMEOUT : API_ERROR.OFFLINE,
        cause,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    let text = '';
    try {
      text = await response.text();
    } catch (cause) {
      throw new ApiError(t('api.readFailed'), {
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
      throw new ApiError(t('api.badResponse'), {
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
    // 通用请求薄封装：UI 面板统一走这里，复用 same-origin 凭据、JSON 解析、重试与
    // HTTP 错误映射（ApiError.status/code），不再各自拼 fetch。
    request(path, options = {}) {
      return request(path, options);
    },
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
    sessions() {
      return request('/api/auth/sessions');
    },
    revokeOtherSessions() {
      return request('/api/auth/sessions/revoke-others', { method: 'POST', body: {} });
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
    // 开局主海克斯：服务端校验 id 属于本次三选一，重复提交同一 id 幂等。
    chooseHex(id, hexId) {
      return request(`/api/runs/${encodeURIComponent(id)}/hex`, {
        method: 'POST',
        body: { hexId },
      });
    },
    // 开局信物：服务端校验 id 属于本次三选一，重复提交同一 id 幂等。
    chooseStarter(id, relicId) {
      return request(`/api/runs/${encodeURIComponent(id)}/starter`, {
        method: 'POST',
        body: { relicId },
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
    // 爬塔节点图 / 选路 / 商人（docs/PHASE_TOWER.md §6.1）：nodes 读图、choose 推进游标、merchant 购买。
    getNodes(id) {
      return request(`/api/runs/${encodeURIComponent(id)}/nodes`);
    },
    chooseNode(id, node) {
      return request(`/api/runs/${encodeURIComponent(id)}/choose`, {
        method: 'POST',
        body: { node },
      });
    },
    getMerchant(id) {
      return request(`/api/runs/${encodeURIComponent(id)}/merchant`, { method: 'POST', body: {} });
    },
    pickMerchant(id, index) {
      return request(`/api/runs/${encodeURIComponent(id)}/merchant`, {
        method: 'POST',
        body: { index },
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
    getBossCore(id) {
      return request(`/api/runs/${encodeURIComponent(id)}/bosscore`, { method: 'POST', body: {} });
    },
    pickBossCore(id, selection) {
      return request(`/api/runs/${encodeURIComponent(id)}/bosscore`, {
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
