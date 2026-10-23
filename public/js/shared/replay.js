// 分享码：把一局的种子、地图选择与关键决策编码成可导入的紧凑字符串。
// 编码格式（版本 1）：RTD1.<base64url(JSON)>.<fnv1a32 十六进制>
// JSON 字段：v 版本 / s 种子 / m 地图候选序号 / d 难度 / o 模式 /
//            r [[遗物 id, 等级]] / e [[波次, 事件 id, 选项 id]]
//
// 兼容策略：前缀 RTD<n> 中的 n 就是格式版本。解码器只接受当前 REPLAY_VERSION，
// 其它版本返回 REPLAY_UNSUPPORTED_VERSION；同一版本内既有字段语义不变，
// 新增或修改字段必须递增版本号。解码器拒绝未知字段，避免跨版本误读。
// 完整性：base64url 段附带 FNV-1a 32 位校验和，任何字符损坏都会在解析 JSON 前被拒绝。
import { DIFFICULTY_ORDER, RELICS, RELIC_BY_ID, RELIC_MAX_LEVEL } from './data.js';
import { EVENTS, EVENT_WAVES, findEventOption } from './events.js';

export const REPLAY_VERSION = 1;
export const MAX_REPLAY_CODE_LENGTH = 2048;

const REPLAY_PREFIX = 'RTD';
const MAX_REPLAY_SEED_LENGTH = 64;
const MAX_REPLAY_MAP_INDEX = 2;
const MAX_REPLAY_RELICS = RELICS.length;
const MAX_REPLAY_EVENTS = EVENT_WAVES.length;
const MODES = new Set(['normal', 'daily', 'endless']);
const PAYLOAD_KEYS = new Set(['v', 's', 'm', 'd', 'o', 'r', 'e']);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CHECKSUM = /^[0-9a-f]{8}$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

// 编码侧遇到非法输入时抛出，携带与解码一致的机器可读错误码。
export class ReplayError extends Error {
  constructor(code, detail = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ReplayError';
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail = null) => ({ ok: false, code, detail });

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function checksumOf(body) {
  return fnv1a(body).toString(16).padStart(8, '0');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (text.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 接受字符串、{id,level} 或 [id,level]；未知遗物、重复遗物、越界等级一律拒绝。
function readRelics(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('REPLAY_INVALID_RELICS', 'not-array');
  if (raw.length > MAX_REPLAY_RELICS) return fail('REPLAY_INVALID_RELICS', 'too-many');
  const seen = new Set();
  const value = [];
  for (const item of raw) {
    let id;
    let level = 1;
    if (typeof item === 'string') {
      id = item;
    } else if (Array.isArray(item)) {
      if (item.length !== 2) return fail('REPLAY_INVALID_RELICS', 'bad-entry');
      [id, level] = item;
    } else if (item && typeof item === 'object') {
      id = item.id ?? item.relicId;
      if (item.level !== undefined) level = item.level;
      else if (item.toLevel !== undefined) level = item.toLevel;
    } else {
      return fail('REPLAY_INVALID_RELICS', 'bad-entry');
    }
    if (typeof id !== 'string' || !RELIC_BY_ID[id]) {
      return fail('REPLAY_INVALID_RELICS', 'unknown-id');
    }
    if (seen.has(id)) return fail('REPLAY_INVALID_RELICS', 'duplicate-id');
    if (typeof level !== 'number' || !Number.isInteger(level)
      || level < 1 || level > RELIC_MAX_LEVEL) {
      return fail('REPLAY_INVALID_RELICS', 'bad-level');
    }
    seen.add(id);
    value.push({ id, level });
  }
  return { ok: true, value };
}

// 接受 {wave,eventId,optionId} 或 [wave,eventId,optionId]；只允许事件波与已知选项。
function readEvents(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('REPLAY_INVALID_EVENTS', 'not-array');
  if (raw.length > MAX_REPLAY_EVENTS) return fail('REPLAY_INVALID_EVENTS', 'too-many');
  const seenWaves = new Set();
  const value = [];
  for (const item of raw) {
    let wave;
    let eventId;
    let optionId;
    if (Array.isArray(item)) {
      if (item.length !== 3) return fail('REPLAY_INVALID_EVENTS', 'bad-entry');
      [wave, eventId, optionId] = item;
    } else if (item && typeof item === 'object') {
      ({ wave, eventId, optionId } = item);
    } else {
      return fail('REPLAY_INVALID_EVENTS', 'bad-entry');
    }
    if (typeof wave !== 'number' || !Number.isInteger(wave) || !EVENT_WAVES.includes(wave)) {
      return fail('REPLAY_INVALID_EVENTS', 'bad-wave');
    }
    const event = typeof eventId === 'string' ? EVENTS[eventId] : null;
    if (!event) return fail('REPLAY_INVALID_EVENTS', 'unknown-event');
    const option = findEventOption(event, optionId);
    if (!option) return fail('REPLAY_INVALID_EVENTS', 'unknown-option');
    if (seenWaves.has(wave)) return fail('REPLAY_INVALID_EVENTS', 'duplicate-wave');
    seenWaves.add(wave);
    value.push({ wave, eventId: event.id, optionId: option.id });
  }
  value.sort((a, b) => a.wave - b.wave);
  return { ok: true, value };
}

// 唯一的校验入口：编码与解码都走这里，保证两条路径接受完全相同的输入。
export function validateRun(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('REPLAY_INVALID_RUN', 'not-object');
  }
  const { seed, mapChoice, difficulty, mode } = raw;
  if (typeof seed !== 'string' || seed.length === 0 || seed.length > MAX_REPLAY_SEED_LENGTH
    || seed.trim() === '') {
    return fail('REPLAY_INVALID_SEED');
  }
  if (!Number.isInteger(mapChoice) || mapChoice < 0 || mapChoice > MAX_REPLAY_MAP_INDEX) {
    return fail('REPLAY_INVALID_MAP');
  }
  if (typeof difficulty !== 'string' || !DIFFICULTY_ORDER.includes(difficulty)) {
    return fail('REPLAY_INVALID_DIFFICULTY');
  }
  if (typeof mode !== 'string' || !MODES.has(mode)) return fail('REPLAY_INVALID_MODE');

  const relics = readRelics(raw.relics);
  if (!relics.ok) return relics;
  const events = readEvents(raw.events);
  if (!events.ok) return events;

  return {
    ok: true,
    run: { seed, mapChoice, difficulty, mode, relics: relics.value, events: events.value },
  };
}

/**
 * 生成分享码。非法输入抛出 ReplayError（带机器可读 code）。
 * @param {{seed:string,mapChoice:number,difficulty:string,mode:string,relics?:Array,events?:Array}} raw
 * @returns {string}
 */
export function encodeRun(raw) {
  const result = validateRun(raw);
  if (!result.ok) throw new ReplayError(result.code, result.detail);
  const { run } = result;
  const payload = {
    v: REPLAY_VERSION,
    s: run.seed,
    m: run.mapChoice,
    d: run.difficulty,
    o: run.mode,
    r: run.relics.map((relic) => [relic.id, relic.level]),
    e: run.events.map((event) => [event.wave, event.eventId, event.optionId]),
  };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const code = `${REPLAY_PREFIX}${REPLAY_VERSION}.${body}.${checksumOf(body)}`;
  if (code.length > MAX_REPLAY_CODE_LENGTH) throw new ReplayError('REPLAY_TOO_LONG');
  return code;
}

/**
 * 解析分享码。任何输入都不会抛异常，统一返回
 * {ok:true, run} 或 {ok:false, code, detail}。
 * @param {unknown} code
 */
export function decodeRun(code) {
  try {
    return decodeUnsafe(code);
  } catch {
    return fail('REPLAY_MALFORMED');
  }
}

function decodeUnsafe(code) {
  if (typeof code !== 'string' || code.length === 0) return fail('REPLAY_EMPTY');
  if (code.length > MAX_REPLAY_CODE_LENGTH) return fail('REPLAY_TOO_LONG');

  const parts = code.split('.');
  if (parts.length !== 3) return fail('REPLAY_BAD_FORMAT', 'segments');
  const [prefix, body, checksum] = parts;

  const versionMatch = /^RTD(\d+)$/.exec(prefix);
  if (!versionMatch) return fail('REPLAY_BAD_FORMAT', 'prefix');
  if (Number(versionMatch[1]) !== REPLAY_VERSION) {
    return fail('REPLAY_UNSUPPORTED_VERSION', versionMatch[1]);
  }
  if (!body || !CHECKSUM.test(checksum)) return fail('REPLAY_BAD_FORMAT', 'checksum');
  if (checksumOf(body) !== checksum) return fail('REPLAY_BAD_CHECKSUM');

  const bytes = base64UrlToBytes(body);
  if (!bytes) return fail('REPLAY_BAD_FORMAT', 'base64url');

  let payload;
  try {
    payload = JSON.parse(utf8.decode(bytes));
  } catch {
    return fail('REPLAY_BAD_PAYLOAD');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('REPLAY_BAD_PAYLOAD');
  }
  for (const key of Object.keys(payload)) {
    if (!PAYLOAD_KEYS.has(key)) return fail('REPLAY_UNKNOWN_FIELD', key);
  }
  if (payload.v !== REPLAY_VERSION) {
    if (!Number.isInteger(payload.v)) return fail('REPLAY_BAD_PAYLOAD', 'version');
    return fail('REPLAY_UNSUPPORTED_VERSION', String(payload.v));
  }

  return validateRun({
    seed: payload.s,
    mapChoice: payload.m,
    difficulty: payload.d,
    mode: payload.o,
    relics: payload.r,
    events: payload.e,
  });
}
