// 回放详情联动分享码：时间线纯文本、分享码调用、错误提示、无数据占位与双语接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildShareRun,
  buildTimeline,
  formatReplayEntry,
  formatTimelineText,
  requestShareCode,
  shareFailureText,
} from '../public/js/replay-ui.js';
import { decodeRun, encodeRun } from '../public/js/shared/replay.js';
import { errorText } from '../public/js/share-ui.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = read('public/js/replay-ui.js');

const REPLAY = {
  id: 'replay-123',
  runId: 'run-456',
  accountId: 'account-789',
  mode: 'normal',
  difficulty: 'abyss',
  seed: 'replay-seed-9c1f',
  mapChoice: 1,
  map: { archetype: 'canyon', archetypeName: '峡谷', modifier: { name: '涌流' } },
  skill: { id: 'frost' },
  mutations: null,
  relics: [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 1 },
  ],
  events: [{ wave: 5, eventId: 'altar', optionId: 'blood' }],
  waves: { reached: 14, cleared: 14 },
  result: { victory: false, waveReached: 14, score: 4321, kills: 210 },
  createdAt: 1700000000000,
  finishedAt: 1700000100000,
};

test('详情页接线：分享码走 /api/replay，提供生成与复制时间线入口，零第三方依赖', () => {
  assert.match(SOURCE, /'\/api\/replay'/, '分享码应调用既有 /api/replay');
  assert.match(SOURCE, /data-replay-share/, '缺少「生成分享码」入口');
  assert.match(SOURCE, /data-replay-copy/, '缺少「复制时间线」入口');
  assert.match(SOURCE, /credentials: 'same-origin'/, '分享请求未携带同源凭据');
  assert.match(SOURCE, /i18n:change/, '切换语言时应刷新文案');
  assert.match(SOURCE, /import \{ escapeHtml \} from '\.\/ui\/kit\/dom\.js'/, '应复用统一 HTML 转义');
  assert.doesNotMatch(SOURCE, /from\s+['"](?!\.)/, '不得引入第三方/裸模块');
});

test('时间线文本格式固定，中文与英文都完整可读', () => {
  const zh = formatTimelineText(REPLAY, 'zh-CN');
  assert.equal(
    zh,
    [
      '渊塔守卫 · 回放摘要',
      // 地图原型名走词典（真实数据里 ARCHETYPES.canyon.name 即「单径峡谷」）。
      '开局 · 单径峡谷 · 词缀 涌流 · 种子 replay-seed-9c1f',
      '第 5 波 · 事件 · altar · 选择 blood',
      '止步第 14 波 · 已清 14 波 · 得分 4,321 · 击杀 210',
      '遗物：锐利箭簇 Lv.2 · 鹰眼徽记 Lv.1',
    ].join('\n')
  );

  const en = formatTimelineText(REPLAY, 'en-US');
  assert.equal(
    en,
    [
      'Abyss Tower · Replay summary',
      'Start · Single Canyon · Modifier 涌流 · Seed replay-seed-9c1f',
      'Wave 5 · Event · altar · Chose blood',
      'Fell at wave 14 · 14 waves cleared · Score 4,321 · Kills 210',
      'Relics: 锐利箭簇 Lv.2 · 鹰眼徽记 Lv.1',
    ].join('\n')
  );
});

test('时间线文本不含账号与回放定位信息', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const text = formatTimelineText(REPLAY, locale);
    for (const secret of [
      REPLAY.id,
      REPLAY.runId,
      REPLAY.accountId,
      String(REPLAY.createdAt),
      String(REPLAY.finishedAt),
      'createdAt',
      'finishedAt',
    ]) {
      assert.equal(text.includes(secret), false, `${locale} 时间线泄漏了 ${secret}`);
    }
  }
});

test('回放摘要可还原成既有分享码的 run 并往返一致', () => {
  const built = buildShareRun(REPLAY);
  assert.equal(built.ok, true);
  assert.equal(built.run.seed, 'replay-seed-9c1f');
  assert.equal(built.run.mapChoice, 1);
  assert.equal(built.run.difficulty, 'abyss');
  assert.equal(built.run.mode, 'normal');
  assert.deepEqual(built.run.relics, [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 1 },
  ]);
  assert.deepEqual(built.run.events, [{ wave: 5, eventId: 'altar', optionId: 'blood' }]);

  const code = encodeRun(built.run);
  assert.match(code, /^RTD\d+\./);
  assert.deepEqual(decodeRun(code), { ok: true, run: built.run });
});

test('分享码请求成功时返回码，失败与断网都有明确提示', async () => {
  const built = buildShareRun(REPLAY);
  let observed = null;
  const ok = await requestShareCode(built.run, {
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, code: 'RTD1.abc.12345678' }),
      };
    },
  });
  assert.deepEqual(ok, { ok: true, code: 'RTD1.abc.12345678' });
  assert.equal(observed.url, '/api/replay');
  assert.equal(observed.init.method, 'POST');
  assert.equal(observed.init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(observed.init.body), { run: built.run });

  const rejected = await requestShareCode(built.run, {
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'REPLAY_INVALID_MODE' }),
    }),
  });
  assert.deepEqual(rejected, { ok: false, code: 'REPLAY_INVALID_MODE', status: 400 });
  assert.equal(shareFailureText(rejected, 'zh-CN'), errorText('REPLAY_INVALID_MODE', 'zh-CN'));
  assert.match(shareFailureText(rejected, 'zh-CN'), /不支持/);
  assert.match(shareFailureText(rejected, 'en-US'), /support/i);

  const offline = await requestShareCode(built.run, {
    fetchImpl: async () => {
      throw new Error('socket closed');
    },
  });
  assert.deepEqual(offline, { ok: false, code: null, offline: true });
  assert.match(shareFailureText(offline, 'zh-CN'), /网络异常/);
  assert.match(shareFailureText(offline, 'en-US'), /Network error/i);

  const missingCode = await requestShareCode(built.run, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  });
  assert.equal(missingCode.ok, false);
  assert.match(shareFailureText(missingCode, 'zh-CN'), /分享码生成失败/);
});

test('不支持分享的模式返回可读错误码而不是抛异常', () => {
  const built = buildShareRun({ ...REPLAY, mode: 'mutated' });
  assert.equal(built.ok, false);
  assert.equal(built.code, 'REPLAY_INVALID_MODE');
  assert.match(errorText(built.code, 'zh-CN'), /不支持/);
  assert.match(errorText(built.code, 'en-US'), /support/i);
});

test('无数据时返回空占位，列表项也安全', () => {
  assert.equal(formatTimelineText(null), '');
  assert.deepEqual(buildTimeline(null), []);
  assert.deepEqual(buildShareRun(null), { ok: false, code: 'REPLAY_INVALID_RUN' });
  assert.equal(formatReplayEntry(null), '');
  // 文案已收进词典：断言键存在且文案一致，不再断言源码字面量。
  assert.equal(zhCN['replay.empty'], '还没有可回看的对局。', '缺少无回放占位');
  assert.equal(zhCN['replay.noData'], '暂无可分享的回放数据', '缺少无分享数据占位');
  assert.match(SOURCE, /t\('replay\.empty'\)/, '无回放占位未走词典');
});

test('新增文案中英双语齐备', () => {
  for (const key of ['share.generate', 'replay.timelineAction']) {
    assert.ok(zhCN[key], `缺少中文文案：${key}`);
    assert.ok(enUS[key], `缺少英文文案：${key}`);
    assert.notEqual(zhCN[key], enUS[key], `${key} 中英未区分`);
  }
  assert.equal(zhCN['share.generate'], '生成分享码');
  assert.equal(enUS['share.generate'], 'Generate share code');
  assert.equal(zhCN['replay.timelineAction'], '复制时间线');
  assert.equal(enUS['replay.timelineAction'], 'Copy timeline');
  assert.match(SOURCE, /from '\.\/i18n\.js'/, '分享码文案未走统一词典');
});
