// 分享码：把一局的种子、地图选择与关键决策编码成可导入的紧凑字符串。
// 编码格式（版本 4）：RTD4.<base64url(JSON)>.<fnv1a32 十六进制>
// JSON 字段：v 版本 / s 种子 / m 地图候选序号 / d 难度 / o 模式 /
//            r [[遗物 id, 等级]] / e [[波次, 事件 id, 选项 id]] / h 主海克斯 id（可选）/
//            t 爬塔选路 path（可选，仅 tower 模式；游标由 path 末位推导）/
//            c 章节开关（可选，true 开启；缺省 = 关闭）
//
// 兼容策略：前缀 RTD<n> 中的 n 就是格式版本。编码只产出当前 REPLAY_VERSION；
// 解码接受 v1（无主海克斯，hexId 为 null）与 v2（有主海克斯、无爬塔选路）与
// v3（有爬塔选路、无章节开关）与 v4，其它版本返回 REPLAY_UNSUPPORTED_VERSION。
// 同一版本内既有字段语义不变，新增或修改字段必须递增版本号。
// 解码器按版本拒绝未知字段，避免跨版本误读。
// 完整性：base64url 段附带 FNV-1a 32 位校验和，任何字符损坏都会在解析 JSON 前被拒绝。
import { DIFFICULTY_ORDER, RELICS, RELIC_BY_ID, RELIC_MAX_LEVEL } from './data.js';
import { EVENTS, EVENT_WAVES, isEventWave, findEventOption } from './events.js';
import { HEX_BY_ID } from './hexes.js';
import { normalizeTowerRoute } from './tower.js';

export const REPLAY_VERSION = 4;
// v1/v2/v3 码仍可导入（旧分享链接不失效）；v1 没有 h，v2 没有 t，v3 没有 c。
export const REPLAY_DECODE_VERSIONS = Object.freeze([1, 2, 3, 4]);
export const MAX_REPLAY_CODE_LENGTH = 2048;

const REPLAY_PREFIX = 'RTD';
const MAX_REPLAY_SEED_LENGTH = 64;
const MAX_REPLAY_MAP_INDEX = 2;
const MAX_REPLAY_RELICS = RELICS.length;
const MAX_REPLAY_EVENTS = EVENT_WAVES.length;
// 无尽模式事件无限延续，分享码仍按体积上限截断，避免超出 MAX_REPLAY_CODE_LENGTH。
const MAX_REPLAY_ENDLESS_EVENTS = 12;
const MODES = new Set(['normal', 'daily', 'endless', 'tower']);
const PAYLOAD_KEYS = new Set(['v', 's', 'm', 'd', 'o', 'r', 'e', 'h', 't', 'c']);
// v1 没有主海克斯字段，v2 没有爬塔选路字段，v3 没有章节开关；按版本收紧允许键，跨版本误读仍被拒绝。
const PAYLOAD_KEYS_BY_VERSION = {
  1: new Set(['v', 's', 'm', 'd', 'o', 'r', 'e']),
  2: new Set(['v', 's', 'm', 'd', 'o', 'r', 'e', 'h']),
  3: new Set(['v', 's', 'm', 'd', 'o', 'r', 'e', 'h', 't']),
};
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
function readEvents(raw, mode = 'normal') {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('REPLAY_INVALID_EVENTS', 'not-array');
  const maxEvents = mode === 'endless' ? MAX_REPLAY_ENDLESS_EVENTS : MAX_REPLAY_EVENTS;
  if (raw.length > maxEvents) return fail('REPLAY_INVALID_EVENTS', 'too-many');
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
    if (typeof wave !== 'number' || !Number.isInteger(wave) || !isEventWave(wave, mode)) {
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

// 主海克斯 id：缺省为 null（旧码/无海克斯局）；给出时必须命中注册表。
function readHexId(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !HEX_BY_ID[raw]) {
    return fail('REPLAY_INVALID_HEX', 'unknown-id');
  }
  return { ok: true, value: raw };
}

// 爬塔选路（v3 起）：塔内分享码携带节点图选路；非爬塔模式不允许带（避免误读）。
// 缺省为 null；给出时必须是结构合法的选路（游标由 path 末位推导）。
function readRoute(raw, mode) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (mode !== 'tower') return fail('REPLAY_INVALID_ROUTE', 'not-tower-mode');
  const route = normalizeTowerRoute(raw);
  if (!route) return fail('REPLAY_INVALID_ROUTE', 'bad-route');
  return { ok: true, value: route };
}

// 章节开关（v4 起）：缺省为 false（关闭）；给出时必须是布尔值。
function readChapters(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: false };
  if (typeof raw !== 'boolean') return fail('REPLAY_INVALID_CHAPTERS', 'not-boolean');
  return { ok: true, value: raw };
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
  const events = readEvents(raw.events, mode);
  if (!events.ok) return events;
  const hexId = readHexId(raw.hexId);
  if (!hexId.ok) return hexId;
  const route = readRoute(raw.route, mode);
  if (!route.ok) return route;
  const chapters = readChapters(raw.chapters);
  if (!chapters.ok) return chapters;

  return {
    ok: true,
    run: {
      seed,
      mapChoice,
      difficulty,
      mode,
      relics: relics.value,
      events: events.value,
      hexId: hexId.value,
      route: route.value,
      chapters: chapters.value,
    },
  };
}

/**
 * 生成分享码。非法输入抛出 ReplayError（带机器可读 code）。
 * @param {{
 *   seed:string, mapChoice:number, difficulty:string, mode:string,
 *   relics?:Array, events?:Array, hexId?:string|null,
 *   route?:{path:Array,node:string}|null, chapters?:boolean
 * }} raw
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
  // 无海克斯（普通/旧局）不写 h，保持与 v2 的最短编码一致。
  if (run.hexId) payload.h = run.hexId;
  // 有爬塔选路才写 t（只存 path，游标由末位推导）；非爬塔局不带。
  if (run.route) payload.t = run.route.path;
  // 章节开关开启才写 c（缺省 false = 关闭，保持旧局最短编码）。
  if (run.chapters) payload.c = true;
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
  const version = Number(versionMatch[1]);
  if (!REPLAY_DECODE_VERSIONS.includes(version)) {
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
  const allowedKeys = PAYLOAD_KEYS_BY_VERSION[version] || PAYLOAD_KEYS;
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) return fail('REPLAY_UNKNOWN_FIELD', key);
  }
  if (payload.v !== version) {
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
    // v1 没有 h：missing → null，旧码导入后按无海克斯对局处理。
    hexId: payload.h,
    // v1/v2 没有 t：missing → null，旧码导入后按无爬塔选路处理。
    route: payload.t,
    // v1-v3 没有 c：missing → false，旧码导入后按章节关闭处理。
    chapters: payload.c,
  });
}
