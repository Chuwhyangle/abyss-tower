// 分享码玩家入口（源码级 + 纯函数）：码长度展示、错误码映射、复制回退、对局提取。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildRunPayload,
  copyToClipboard,
  errorText,
  formatCodeLength,
  formatReplaySummary,
} from '../public/js/share-ui.js';
import { decodeRun, encodeRun } from '../public/js/shared/replay.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = read('public/js/share-ui.js');
const INDEX_HTML = read('public/index.html');

const STATE = {
  run: { seed: 'share-seed-7f3a', mapChoice: 1, difficulty: 'abyss', mode: 'normal' },
  sim: {
    relics: [{ id: 'sharp', level: 2 }],
    events: [{ wave: 5, eventId: 'altar', optionId: 'blood' }],
  },
};

test('大厅入口与结算面板接线：脚本、容器、接口、零第三方依赖', () => {
  assert.match(INDEX_HTML, /id="btn-share"/, '大厅缺少分享码入口');
  assert.match(INDEX_HTML, /id="share-panel"/, '大厅缺少导入容器');
  assert.match(INDEX_HTML, /src="\/js\/share-ui\.js"/, '页面未引入 share-ui.js');
  assert.match(SOURCE, /'\/api\/replay'/, '分享码入口应调用既有 /api/replay');
  assert.match(SOURCE, /navigator\?\.clipboard|clipboard\.writeText/, '缺少剪贴板写入');
  assert.match(SOURCE, /i18n:change/, '切换语言时应刷新文案');
  assert.doesNotMatch(SOURCE, /from\s+['"](?!\.)/, '不得引入第三方/裸模块');
});

test('码长度展示包含当前长度与上限', () => {
  assert.equal(formatCodeLength('x'.repeat(12), 'zh-CN'), '分享码长度 12 / 2048');
  assert.equal(formatCodeLength('', 'en-US'), 'Share code length 0 / 2048');
  assert.match(formatCodeLength('RTD1.abc.12345678', 'zh-CN'), /17 \/ 2048/);
  assert.match(formatCodeLength(null, 'zh-CN'), /0 \/ 2048/);
});

test('损坏码与各类错误码都有可读的中英文提示', () => {
  assert.match(errorText('REPLAY_BAD_CHECKSUM', 'zh-CN'), /损坏/);
  assert.match(errorText('REPLAY_BAD_CHECKSUM', 'en-US'), /corrupted/i);
  assert.match(errorText('REPLAY_UNSUPPORTED_VERSION', 'zh-CN'), /版本不受支持/);
  assert.match(errorText('REPLAY_UNSUPPORTED_VERSION', 'en-US'), /version/i);
  assert.match(errorText('REPLAY_TOO_LONG', 'en-US'), /2048/);
  assert.match(errorText('REPLAY_BAD_FORMAT', 'zh-CN'), /格式不正确/);
  assert.match(errorText('AUTH_REQUIRED', 'en-US'), /sign in/i);

  for (const code of [
    'REPLAY_EMPTY',
    'REPLAY_BAD_PAYLOAD',
    'REPLAY_MALFORMED',
    'REPLAY_INVALID_SEED',
    'REPLAY_INVALID_MODE',
    'REPLAY_UNKNOWN_FIELD',
  ]) {
    for (const locale of ['zh-CN', 'en-US']) {
      const message = errorText(code, locale);
      assert.ok(message.length > 0, `${code} 缺少 ${locale} 文案`);
      assert.ok(!message.includes(code), `${code} 的 ${locale} 文案泄漏了错误码`);
      assert.ok(!message.includes('{'), `${code} 的 ${locale} 文案残留占位符`);
    }
  }

  assert.equal(errorText('NOT_A_REAL_CODE', 'zh-CN'), '分享码无效');
  assert.equal(errorText('NOT_A_REAL_CODE', 'en-US'), 'Invalid share code');
});

test('从结算状态提取对局并可被既有编码器往返', () => {
  const built = buildRunPayload(STATE);
  assert.equal(built.ok, true);
  assert.deepEqual(built.run.relics, [{ id: 'sharp', level: 2 }]);
  assert.deepEqual(built.run.events, [{ wave: 5, eventId: 'altar', optionId: 'blood' }]);

  const code = encodeRun(built.run);
  assert.match(code, /^RTD\d+\./);
  assert.deepEqual(decodeRun(code), { ok: true, run: built.run });
});

test('不支持分享的模式返回可读错误码而不是抛异常', () => {
  const built = buildRunPayload({ ...STATE, run: { ...STATE.run, mode: 'mutated' } });
  assert.equal(built.ok, false);
  assert.equal(built.code, 'REPLAY_INVALID_MODE');
  assert.equal(errorText(built.code, 'zh-CN'), '当前模式不支持分享码');
});

test('导入摘要包含种子、难度、模式与数量，不泄漏 undefined', () => {
  const summary = formatReplaySummary(
    {
      seed: 'share-seed-7f3a',
      difficulty: 'abyss',
      mode: 'normal',
      relics: [{ id: 'sharp' }, { id: 'eagle' }],
      events: [{ wave: 5 }],
    },
    'en-US'
  );
  assert.match(summary, /share-seed-7f3a/);
  assert.match(summary, /Abyss/);
  assert.match(summary, /Standard/);
  assert.match(summary, /Relics 2/);
  assert.match(summary, /Events 1/);
  assert.doesNotMatch(summary, /undefined|NaN/);

  const zh = formatReplaySummary({ seed: 's', difficulty: 'standard', mode: 'endless' }, 'zh-CN');
  assert.match(zh, /远征|标准/);
  assert.match(zh, /无尽/);
});

test('剪贴板可用时写入，被拒绝时回退手动选择', async () => {
  let written = null;
  const ok = await copyToClipboard('RTD1.x', {
    clipboard: {
      async writeText(value) {
        written = value;
      },
    },
  });
  assert.deepEqual(ok, { ok: true, method: 'clipboard' });
  assert.equal(written, 'RTD1.x');

  let selected = null;
  const denied = await copyToClipboard('RTD1.broken', {
    clipboard: {
      async writeText() {
        throw new Error('denied');
      },
    },
    select(value) {
      selected = value;
    },
  });
  assert.deepEqual(denied, { ok: false, method: 'manual', selected: true });
  assert.equal(selected, 'RTD1.broken');

  const unavailable = await copyToClipboard('RTD1.x', { clipboard: null, select: null });
  assert.deepEqual(unavailable, { ok: false, method: 'manual', selected: false });

  const selectFailed = await copyToClipboard('RTD1.x', {
    clipboard: null,
    select() {
      throw new Error('no-selection');
    },
  });
  assert.deepEqual(selectFailed, { ok: false, method: 'manual', selected: false });

  const empty = await copyToClipboard('', { clipboard: { async writeText() {} } });
  assert.deepEqual(empty, { ok: false, method: 'manual', selected: false });
});
