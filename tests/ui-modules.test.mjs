// UI 模块纯逻辑单测：商店排序/价格、遗物分组、技能状态机、结算格式化、通知未读与设置校验。
// 这些模块在 Node 下可直接导入（不依赖 DOM），测试只覆盖导出的纯函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWER_ORDER, RELIC_LEVEL_LABELS } from '../public/js/shared/data.js';
import { orderedShopTowers, shopCardAffordable, clampRelicLevel, relicChipView } from '../public/js/ui/shop.js';
import { relicDraftLevels, supplyAmount } from '../public/js/ui/modals.js';
import { skillButtonState } from '../public/js/ui/hud.js';
import { formatResultScore, resultBestWave } from '../public/js/ui/result.js';
import {
  formatTime,
  describeNotification,
  normalizeUnread,
  unreadBadgeText,
  unreadSummaryText,
} from '../public/js/ui/notifications.js';
import { DEFAULT_SETTINGS, detectPreset, normalizeSettings, presetSettings } from '../public/js/settings.js';

// ---------- 商店 ----------

test('商店按 TOWER_ORDER 排序', () => {
  const entries = orderedShopTowers();
  assert.deepEqual(entries.map((entry) => entry.id), TOWER_ORDER, '所有塔都应有定义且保持顺序');
});

test('价格可负担判定与金币比较保持一致', () => {
  assert.equal(shopCardAffordable(100, 100), true, '刚好够钱可购买');
  assert.equal(shopCardAffordable(120, 100), true);
  assert.equal(shopCardAffordable(99, 100), false);
  assert.equal(shopCardAffordable('50', 100), false, '字符串金币按数值比较');
  assert.equal(shopCardAffordable(undefined, 0), true, '缺失金币不误标为买不起');
});

// ---------- 遗物列表 ----------

test('遗物等级夹取到 1–3 级', () => {
  assert.equal(clampRelicLevel(0), 1);
  assert.equal(clampRelicLevel(undefined), 1);
  assert.equal(clampRelicLevel(2), 2);
  assert.equal(clampRelicLevel(99), 3);
});

test('遗物条目模型带出等级与稀有度', () => {
  const view = relicChipView({ id: 'sharp', level: 0 });
  assert.equal(view.level, 1);
  assert.equal(view.levelLabel, RELIC_LEVEL_LABELS[0]);
  assert.equal(view.rarityKey, 'common');
  assert.equal(view.rarityName, '普通');

  const epic = relicChipView({ id: 'warlord', level: 2 });
  assert.equal(epic.level, 2);
  assert.equal(epic.levelLabel, RELIC_LEVEL_LABELS[1]);
  assert.equal(epic.rarityKey, 'epic');
  assert.equal(epic.rarityName, '史诗');

  assert.equal(relicChipView({ id: 'missing' }), null, '未知遗物跳过渲染');
});

test('遗物草稿按等级分组：新遗物与升级组', () => {
  assert.deepEqual(relicDraftLevels({ fromLevel: 0 }), { fromLevel: 0, toLevel: 1, isUpgrade: false });
  assert.deepEqual(relicDraftLevels({ fromLevel: 2 }), { fromLevel: 2, toLevel: 3, isUpgrade: true });
  assert.deepEqual(relicDraftLevels({ fromLevel: 0, toLevel: 2 }), {
    fromLevel: 0,
    toLevel: 2,
    isUpgrade: false,
  });
  assert.deepEqual(relicDraftLevels({ fromLevel: 5, toLevel: 9 }), {
    fromLevel: 3,
    toLevel: 3,
    isUpgrade: true,
  });
});

test('补给数量向下取整且不为负', () => {
  assert.equal(supplyAmount({ amount: 12.9 }), 12);
  assert.equal(supplyAmount({ amount: -3 }), 0);
  assert.equal(supplyAmount({ amount: 'abc' }), 0);
  assert.equal(supplyAmount({}), 0);
});

// ---------- HUD 技能状态机 ----------

test('技能按钮状态机覆盖整备、就绪、冷却与暂停', () => {
  const skill = { id: 'meteor', level: 1, stats: { cd: 10 }, cooldown: 0 };

  assert.equal(skillButtonState({ skill, phase: 'prep' }).state, 'prep');
  assert.equal(skillButtonState({ skill, phase: 'wave' }).state, 'ready');
  assert.equal(skillButtonState({ skill, phase: 'wave' }).ready, true);
  assert.equal(skillButtonState({ skill, phase: 'wave', paused: true }).state, 'paused');

  const cooling = skillButtonState({ skill: { ...skill, cooldown: 4 }, phase: 'wave' });
  assert.equal(cooling.state, 'cooling');
  assert.equal(cooling.ratio, 0.4);
  assert.equal(cooling.countdown, 4);

  const overflow = skillButtonState({ skill: { ...skill, cooldown: 25 }, phase: 'wave' });
  assert.equal(overflow.ratio, 1, '冷却进度不超过 1');
  assert.equal(overflow.countdown, 25);

  assert.equal(skillButtonState({ skill: {}, phase: 'wave' }), null, '无技能返回 null');
});

// ---------- 结算 ----------

test('结算分数按千分位格式化，非法值按 0', () => {
  assert.equal(formatResultScore(0), '0');
  assert.equal(formatResultScore(1234567), '1,234,567');
  assert.equal(formatResultScore('2500'), '2,500');
  assert.equal(formatResultScore(null), '0');
  assert.equal(formatResultScore(undefined), '0');
  assert.equal(formatResultScore('bad'), '0');
});

test('最佳波次取历史与自己本局的较大值', () => {
  assert.equal(resultBestWave(0, { wave: 5 }), 5);
  assert.equal(resultBestWave(12, { wave: 5 }), 12);
  assert.equal(resultBestWave(undefined, { clearedWave: 7, wave: 3 }), 7);
  assert.equal(resultBestWave(NaN, {}), 0);
});

// ---------- 通知未读 ----------

test('未读数归一化与徽标封顶', () => {
  assert.equal(normalizeUnread(-5), 0);
  assert.equal(normalizeUnread('abc'), 0);
  assert.equal(normalizeUnread('7'), 7);
  assert.equal(unreadBadgeText(0), '0');
  assert.equal(unreadBadgeText(99), '99');
  assert.equal(unreadBadgeText(100), '99+');
  assert.equal(unreadBadgeText(-1), '0');
  assert.equal(unreadBadgeText(undefined), '0');
  assert.equal(unreadSummaryText(0), '全部已读');
  assert.equal(unreadSummaryText(5), '5 条未读');
  assert.equal(unreadSummaryText(-2), '全部已读');
});

test('通知正文按类型生成，未知类型回落到通用文案', () => {
  assert.equal(
    describeNotification({ kind: 'achievement', payload: { title: '首胜' } }),
    '解锁成就「首胜」'
  );
  assert.equal(
    describeNotification({ kind: 'bounty', payload: { title: '悬赏名', reward: 30 } }),
    '悬赏「悬赏名」完成，获得 30 星核'
  );
  assert.equal(
    describeNotification({ kind: 'season', payload: { season: 1, rank: 2, cores: 50 } }),
    '赛季 1 结算：第 2 名，获得 50 星核'
  );
  assert.equal(describeNotification({ kind: 'other' }), '收到一条新通知');
  assert.equal(describeNotification(null), '收到一条新通知');
});

test('通知时间对非法时间戳返回空串', () => {
  assert.equal(formatTime(0), '');
  assert.equal(formatTime(-1), '');
  assert.equal(formatTime('abc'), '');
  const text = formatTime(1700000000000);
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0, '有效时间戳应渲染出时间');
});

// ---------- 设置面板校验 ----------

test('设置归一化拒绝非法值并夹取音量', () => {
  const normalized = normalizeSettings({
    fps: 999,
    dpr: 3,
    decorations: 'bogus',
    floaters: 'bogus',
    glow: 'yes',
    music: false,
    sfxVolume: 150,
    musicVolume: -10,
  });
  assert.equal(normalized.fps, DEFAULT_SETTINGS.fps);
  assert.equal(normalized.dpr, DEFAULT_SETTINGS.dpr);
  assert.equal(normalized.decorations, DEFAULT_SETTINGS.decorations);
  assert.equal(normalized.floaters, DEFAULT_SETTINGS.floaters);
  assert.equal(normalized.glow, DEFAULT_SETTINGS.glow);
  assert.equal(normalized.music, false, '合法布尔值保留');
  assert.equal(normalized.sfxVolume, 100);
  assert.equal(normalized.musicVolume, 0);

  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('设置预设识别与回退', () => {
  assert.equal(detectPreset(presetSettings('low')), 'low');
  assert.equal(detectPreset(presetSettings('high')), 'high');
  assert.equal(detectPreset({ ...presetSettings('low'), glow: true }), 'custom');
  assert.equal(presetSettings('unknown').fps, presetSettings('low').fps, '未知预设回退低配');
});
