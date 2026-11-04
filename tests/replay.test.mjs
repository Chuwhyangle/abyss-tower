// 分享码：编码/解码往返、损坏与版本拒绝、长度上限，以及 /api/replay 接口。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { RELICS } from '../public/js/shared/data.js';
import {
  MAX_REPLAY_CODE_LENGTH,
  REPLAY_VERSION,
  ReplayError,
  decodeRun,
  encodeRun,
  validateRun,
} from '../public/js/shared/replay.js';
import { registerAndLogin, startTestServer } from './harness.mjs';

const RUN = {
  seed: 'share-seed-7f3a',
  mapChoice: 1,
  difficulty: 'abyss',
  mode: 'normal',
  relics: [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 1 },
  ],
  events: [
    { wave: 10, eventId: 'caravan', optionId: 'supplies' },
    { wave: 5, eventId: 'altar', optionId: 'blood' },
  ],
};

// 事件按波次排序，作为唯一规范形态；v2 起没有主海克斯的局 hexId 规范化为 null。
const CANONICAL = {
  ...RUN,
  events: [RUN.events[1], RUN.events[0]],
  hexId: null,
  route: null,
  chapters: false,
};

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function checksum(text) {
  return fnv1a(text).toString(16).padStart(8, '0');
}

function bytesToB64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function withBody(body) {
  return `RTD${REPLAY_VERSION}.${body}.${checksum(body)}`;
}

function craft(payload) {
  return withBody(bytesToB64Url(new TextEncoder().encode(JSON.stringify(payload))));
}

test('往返：编码后可完整解码，且重复编码结果一致', () => {
  const code = encodeRun(RUN);
  assert.match(code, /^RTD4\./);
  assert.match(code.split('.')[1], /^[A-Za-z0-9_-]+$/);
  assert.ok(code.length < MAX_REPLAY_CODE_LENGTH);

  const decoded = decodeRun(code);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.run, CANONICAL);
  assert.equal(encodeRun(decoded.run), code);
});

test('最小对局：缺省遗物与事件解码为空数组', () => {
  const code = encodeRun({ seed: 'seed-min', mapChoice: 0, difficulty: 'roam', mode: 'endless' });
  const decoded = decodeRun(code);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.run, {
    seed: 'seed-min',
    mapChoice: 0,
    difficulty: 'roam',
    mode: 'endless',
    relics: [],
    events: [],
    hexId: null,
    route: null,
    chapters: false,
  });
  // 字符串形式的遗物与数组形式的事件同样接受。
  const loose = validateRun({
    seed: 'seed-min',
    mapChoice: 0,
    difficulty: 'roam',
    mode: 'endless',
    relics: ['sharp', ['eagle', 3]],
    events: [[5, 'altar', 'leave']],
  });
  assert.equal(loose.ok, true);
  assert.deepEqual(loose.run.relics, [{ id: 'sharp', level: 1 }, { id: 'eagle', level: 3 }]);
  assert.deepEqual(loose.run.events, [{ wave: 5, eventId: 'altar', optionId: 'leave' }]);
});

test('任意损坏输入都不抛异常，而是返回明确错误码', () => {
  const valid = encodeRun(RUN);
  const [, body, sum] = valid.split('.');
  const flippedBody = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
  const flippedSum = sum.slice(0, -1) + (sum.endsWith('0') ? '1' : '0');

  const inputs = [
    null,
    undefined,
    42,
    {},
    [],
    '',
    'RTD1',
    'RTD1.abc',
    'RTD1..00000000',
    `RTD1.${body}.${flippedSum}`,
    `RTD1.${flippedBody}.${sum}`,
    withBody(bytesToB64Url([0xff, 0xfe])),
    craft([1, 2]),
    'RTD1.' + 'A'.repeat(MAX_REPLAY_CODE_LENGTH) + '.00000000',
  ];

  for (const input of inputs) {
    let result;
    assert.doesNotThrow(() => {
      result = decodeRun(input);
    }, `decodeRun 不应抛异常：${String(input)}`);
    assert.equal(result.ok, false, `应拒绝：${String(input)}`);
    assert.match(result.code, /^REPLAY_/);
  }

  assert.equal(decodeRun(null).code, 'REPLAY_EMPTY');
  assert.equal(decodeRun('RTD1').code, 'REPLAY_BAD_FORMAT');
  assert.equal(decodeRun(`RTD1.${flippedSum}.${''}`).code, 'REPLAY_BAD_FORMAT');
  assert.equal(decodeRun(`RTD1.${flippedBody}.${sum}`).code, 'REPLAY_BAD_CHECKSUM');
  assert.equal(decodeRun(`RTD1.${body}.${flippedSum}`).code, 'REPLAY_BAD_CHECKSUM');
  assert.equal(decodeRun('RTD1.' + 'A'.repeat(MAX_REPLAY_CODE_LENGTH) + '.00000000').code,
    'REPLAY_TOO_LONG');
});

test('版本不兼容：前缀版本或 payload 版本不符都被拒绝', () => {
  const valid = encodeRun(RUN);
  const nextPrefix = valid.replace(/^RTD4\./, 'RTD5.');
  assert.equal(decodeRun(nextPrefix).code, 'REPLAY_UNSUPPORTED_VERSION');

  const payload = {
    v: 5,
    s: RUN.seed,
    m: RUN.mapChoice,
    d: RUN.difficulty,
    o: RUN.mode,
    r: [],
    e: [],
  };
  assert.equal(decodeRun(craft(payload)).code, 'REPLAY_UNSUPPORTED_VERSION');

  const badVersion = decodeRun(craft({ ...payload, v: 'two' }));
  assert.equal(badVersion.code, 'REPLAY_BAD_PAYLOAD');
});

test('旧版码（v1）仍可导入：hexId 规范化为 null，且不接受 v2 的 h 字段', () => {
  const v1Payload = {
    v: 1,
    s: RUN.seed,
    m: RUN.mapChoice,
    d: RUN.difficulty,
    o: RUN.mode,
    r: [],
    e: [],
  };
  const body = bytesToB64Url(new TextEncoder().encode(JSON.stringify(v1Payload)));
  const legacy = decodeRun(`RTD1.${body}.${checksum(body)}`);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.run.hexId, null);

  // v1 没有主海克斯字段：带上 h 属于跨版本误读，按未知字段拒绝。
  const withHexBody = bytesToB64Url(
    new TextEncoder().encode(JSON.stringify({ ...v1Payload, h: 'glass_cannon' }))
  );
  const rejected = decodeRun(`RTD1.${withHexBody}.${checksum(withHexBody)}`);
  assert.equal(rejected.code, 'REPLAY_UNKNOWN_FIELD');
  assert.equal(rejected.detail, 'h');
});

test('爬塔选路往返：route 只在 tower 模式编码，游标由 path 末位推导', () => {
  const route = { path: ['1:0', '2:0', '3:1'] };
  const towerRun = {
    seed: 'tower-seed',
    mapChoice: 0,
    difficulty: 'standard',
    mode: 'tower',
    relics: [],
    events: [{ wave: 3, eventId: 'altar', optionId: 'leave' }],
    route,
  };
  const code = encodeRun(towerRun);
  assert.match(code, /^RTD4\./);
  const decoded = decodeRun(code);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.run, {
    ...towerRun,
    hexId: null,
    route: { path: ['1:0', '2:0', '3:1'], node: '3:1' },
    chapters: false,
  });
  assert.equal(encodeRun(decoded.run), code);

  // 非 tower 模式携带 route 视为跨模式误读。
  assert.throws(
    () => encodeRun({ ...RUN, route }),
    (error) => error instanceof ReplayError && error.code === 'REPLAY_INVALID_ROUTE'
  );
});

test('v2 无 t 字段：旧码导入 route 为 null，且 v2 带 t 被拒绝', () => {
  const v2Payload = {
    v: 2,
    s: RUN.seed,
    m: RUN.mapChoice,
    d: RUN.difficulty,
    o: RUN.mode,
    r: [],
    e: [],
  };
  const v2Body = bytesToB64Url(new TextEncoder().encode(JSON.stringify(v2Payload)));
  const legacy = decodeRun(`RTD2.${v2Body}.${checksum(v2Body)}`);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.run.route, null);
  assert.equal(legacy.run.hexId, null);

  const withRouteBody = bytesToB64Url(
    new TextEncoder().encode(JSON.stringify({ ...v2Payload, t: ['1:0'] }))
  );
  const withRoute = decodeRun(`RTD2.${withRouteBody}.${checksum(withRouteBody)}`);
  assert.equal(withRoute.code, 'REPLAY_UNKNOWN_FIELD');
  assert.equal(withRoute.detail, 't');
});

test('章节开关（v4）：c 字段往返，旧 v3 码缺省关闭且不接受 c', () => {
  const chaptersOn = encodeRun({ ...RUN, chapters: true });
  assert.match(chaptersOn, /^RTD4\./);
  const decodedOn = decodeRun(chaptersOn);
  assert.equal(decodedOn.ok, true);
  assert.equal(decodedOn.run.chapters, true);
  assert.equal(encodeRun(decodedOn.run), chaptersOn);

  // 缺省（不传 chapters）→ false，且最短编码不带 c。
  const off = encodeRun(RUN);
  assert.equal(decodeRun(off).run.chapters, false);

  // v3 旧码：无 c 字段 → chapters 缺省 false。
  const v3Payload = {
    v: 3,
    s: RUN.seed,
    m: RUN.mapChoice,
    d: RUN.difficulty,
    o: RUN.mode,
    r: [],
    e: [],
  };
  const v3Body = bytesToB64Url(new TextEncoder().encode(JSON.stringify(v3Payload)));
  const v3 = decodeRun(`RTD3.${v3Body}.${checksum(v3Body)}`);
  assert.equal(v3.ok, true);
  assert.equal(v3.run.chapters, false);

  // v3 带 c 属于跨版本误读，按未知字段拒绝。
  const withChaptersBody = bytesToB64Url(
    new TextEncoder().encode(JSON.stringify({ ...v3Payload, c: true }))
  );
  const withChapters = decodeRun(`RTD3.${withChaptersBody}.${checksum(withChaptersBody)}`);
  assert.equal(withChapters.code, 'REPLAY_UNKNOWN_FIELD');
  assert.equal(withChapters.detail, 'c');
});

test('未知字段被拒绝，避免跨版本误读', () => {
  const payload = {
    v: REPLAY_VERSION,
    s: RUN.seed,
    m: RUN.mapChoice,
    d: RUN.difficulty,
    o: RUN.mode,
    r: [],
    e: [],
    x: 1,
  };
  const result = decodeRun(craft(payload));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REPLAY_UNKNOWN_FIELD');
  assert.equal(result.detail, 'x');
});

test('长度上限：超长码与超限字段都拒绝', () => {
  assert.equal(decodeRun('x'.repeat(MAX_REPLAY_CODE_LENGTH + 1)).code, 'REPLAY_TOO_LONG');
  assert.throws(
    () => encodeRun({ ...RUN, seed: 'a'.repeat(65) }),
    (error) => error instanceof ReplayError && error.code === 'REPLAY_INVALID_SEED'
  );
  assert.throws(
    () => encodeRun({ ...RUN, relics: [...RELICS.map((relic) => relic.id), RELICS[0].id] }),
    (error) => error instanceof ReplayError && error.code === 'REPLAY_INVALID_RELICS'
  );

  // 最大合法对局仍应落在上限之内。
  const biggest = encodeRun({
    seed: 'a'.repeat(64),
    mapChoice: 2,
    difficulty: 'standard',
    mode: 'daily',
    relics: RELICS.map((relic) => [relic.id, 3]),
    events: [[5, 'altar', 'leave'], [10, 'caravan', 'leave'], [15, 'gamble', 'leave']],
  });
  assert.ok(biggest.length < MAX_REPLAY_CODE_LENGTH, `最长码 ${biggest.length}`);
  assert.equal(decodeRun(biggest).ok, true);
});

test('编码侧非法输入抛出带错误码的 ReplayError', () => {
  const cases = [
    [null, 'REPLAY_INVALID_RUN'],
    [{ ...RUN, seed: '' }, 'REPLAY_INVALID_SEED'],
    [{ ...RUN, seed: '   ' }, 'REPLAY_INVALID_SEED'],
    [{ ...RUN, seed: 7 }, 'REPLAY_INVALID_SEED'],
    [{ ...RUN, mapChoice: 3 }, 'REPLAY_INVALID_MAP'],
    [{ ...RUN, mapChoice: '1' }, 'REPLAY_INVALID_MAP'],
    [{ ...RUN, difficulty: 'easy' }, 'REPLAY_INVALID_DIFFICULTY'],
    [{ ...RUN, mode: 'ranked' }, 'REPLAY_INVALID_MODE'],
    [{ ...RUN, chapters: 'yes' }, 'REPLAY_INVALID_CHAPTERS'],
    [{ ...RUN, relics: 'sharp' }, 'REPLAY_INVALID_RELICS'],
    [{ ...RUN, relics: [{ id: 'nope', level: 1 }] }, 'REPLAY_INVALID_RELICS'],
    [{ ...RUN, relics: [{ id: 'sharp', level: 1 }, { id: 'sharp', level: 1 }] },
      'REPLAY_INVALID_RELICS'],
    [{ ...RUN, relics: [{ id: 'sharp', level: 4 }] }, 'REPLAY_INVALID_RELICS'],
    [{ ...RUN, relics: [{ id: 'sharp', level: 1.5 }] }, 'REPLAY_INVALID_RELICS'],
    [{ ...RUN, events: { wave: 5 } }, 'REPLAY_INVALID_EVENTS'],
    [{ ...RUN, events: [{ wave: 6, eventId: 'altar', optionId: 'blood' }] },
      'REPLAY_INVALID_EVENTS'],
    [{ ...RUN, events: [{ wave: 5, eventId: 'nope', optionId: 'blood' }] },
      'REPLAY_INVALID_EVENTS'],
    [{ ...RUN, events: [{ wave: 5, eventId: 'altar', optionId: 'nope' }] },
      'REPLAY_INVALID_EVENTS'],
    [{
      ...RUN,
      events: [
        { wave: 5, eventId: 'altar', optionId: 'blood' },
        { wave: 5, eventId: 'caravan', optionId: 'leave' },
      ],
    }, 'REPLAY_INVALID_EVENTS'],
  ];

  for (const [input, expected] of cases) {
    assert.throws(
      () => encodeRun(input),
      (error) => error instanceof ReplayError && error.code === expected,
      `期望 ${expected}`
    );
  }
});

test('接口：需登录，生成与校验往返，错误返回明确 code', async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const auth = await registerAndLogin(server.base);

  const post = (body, cookie = auth.rawCookie) =>
    fetch(`${server.base}/api/replay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  const anonymous = await post({ run: RUN }, null);
  assert.equal(anonymous.status, 401);

  const encoded = await post({ run: RUN });
  assert.equal(encoded.status, 200);
  const encodedData = await encoded.json();
  assert.equal(encodedData.ok, true);
  assert.equal(encodedData.length, encodedData.code.length);
  assert.deepEqual(encodedData.run, CANONICAL);

  const decoded = await post({ code: encodedData.code });
  assert.equal(decoded.status, 200);
  assert.deepEqual((await decoded.json()).run, CANONICAL);

  const [, body, sum] = encodedData.code.split('.');
  const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
  const corrupt = await post({ code: `RTD1.${flipped}.${sum}` });
  assert.equal(corrupt.status, 400);
  assert.equal((await corrupt.json()).code, 'REPLAY_BAD_CHECKSUM');

  const tooLong = await post({ code: 'RTD1.' + 'A'.repeat(MAX_REPLAY_CODE_LENGTH) + '.00000000' });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).code, 'REPLAY_TOO_LONG');

  const badRun = await post({ run: { ...RUN, seed: '' } });
  assert.equal(badRun.status, 400);
  assert.equal((await badRun.json()).code, 'REPLAY_INVALID_SEED');

  const ambiguous = await post({ run: RUN, code: encodedData.code });
  assert.equal(ambiguous.status, 400);
  assert.equal((await ambiguous.json()).code, 'REPLAY_INVALID_REQUEST');

  const empty = await post({});
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, 'REPLAY_INVALID_REQUEST');
});
