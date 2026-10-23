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

// 事件按波次排序，作为唯一规范形态。
const CANONICAL = {
  ...RUN,
  events: [RUN.events[1], RUN.events[0]],
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
  assert.match(code, /^RTD1\./);
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
  const nextPrefix = valid.replace(/^RTD1\./, 'RTD2.');
  assert.equal(decodeRun(nextPrefix).code, 'REPLAY_UNSUPPORTED_VERSION');

  const payload = {
    v: 2,
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
