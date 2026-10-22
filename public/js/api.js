// 服务端 API 封装：玩家身份保存在 localStorage。
const TOKEN_KEY = 'abyss-tower.token';

function playerToken() {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        'x-player-token': playerToken(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
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
    throw error;
  }
  return data;
}

export const api = {
  session(name) {
    return request('/api/session', {
      method: 'POST',
      body: name === undefined ? {} : { name },
    });
  },
  profile() {
    return request('/api/profile');
  },
  leaderboard(mode = 'normal') {
    return request(`/api/leaderboard?mode=${encodeURIComponent(mode)}`);
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
