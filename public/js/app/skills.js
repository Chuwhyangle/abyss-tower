// 技能账户接口与本地选择记忆。
//
// 说明：`public/js/api.js` 由账号线维护，本期不在此处扩展；
// 技能接口按 docs/PROGRESSION_DESIGN.md 13.2 的契约直接复用同源 Cookie / 旧令牌语义。
// 服务端尚未上线对应路由时，调用方负责捕获错误并降级（无技能局仍可正常游玩）。
import { legacyToken } from '../api.js';

const SELECTED_KEY = 'abyss-tower.skill.selected.v1';

async function request(path, { method = 'GET', body } = {}) {
  const token = legacyToken();
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-player-token': token } : {}),
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

export const skillApi = {
  list() {
    return request('/api/skills');
  },
  upgrade(skillId, expectedLevel) {
    const body = { skillId };
    if (expectedLevel != null) body.expectedLevel = expectedLevel;
    return request('/api/skills/upgrade', { method: 'POST', body });
  },
  select(skillId) {
    return request('/api/skills/select', { method: 'POST', body: { skillId } });
  },
  // 建局时携带 skillId；服务端忽略客户端等级，只按账号数据冻结规则集。
  startRun(mode, difficulty, skillId) {
    const body = { mode, difficulty };
    if (skillId) body.skillId = skillId;
    return request('/api/runs', { method: 'POST', body });
  },
};

export function loadSelectedSkill() {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : parsed?.id || null;
  } catch {
    return null;
  }
}

export function saveSelectedSkill(skillId) {
  try {
    if (skillId) localStorage.setItem(SELECTED_KEY, JSON.stringify({ id: skillId }));
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* 存储不可用时只保留内存选择 */
  }
}
