// UI 模块纯逻辑单测：商店排序/价格、遗物分组、技能状态机、结算格式化、通知未读与设置校验。
// 这些模块在 Node 下可直接导入（不依赖 DOM），测试只覆盖导出的纯函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWER_ORDER, RELIC_LEVEL_LABELS } from '../public/js/shared/data.js';
import { orderedShopTowers, shopCardAffordable, clampRelicLevel, relicChipView, bonusSummaryRows, bonusSourceRows } from '../public/js/ui/shop.js';
import { relicDraftLevels, supplyAmount } from '../public/js/ui/draft.js';
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
import { towerNodeView, towerNodeState, merchantOfferView, merchantSellView } from '../public/js/ui/tower.js';
import { TOWER_NODE_TYPES } from '../public/js/shared/tower.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

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

// ---------- 加成一览 ----------

test('加成一览按效果注册表顺序汇总非零加成，含塔类型维度', () => {
  const rows = bonusSummaryRows({ fireRate: 0.2, dmg: { arrow: 0.5, cannon: 0 }, crit: 0.1 });
  assert.deepEqual(rows.map((row) => row.key), ['dmg:arrow', 'fireRate', 'crit'], '顺序应沿效果注册表');
  assert.match(rows[0].text, /伤害 \+50%/, 'dmg 行应带塔类型伤害文案');
  assert.match(rows[1].text, /攻击速度 \+20%/, 'fireRate 行应带攻速文案');
  assert.match(rows[2].text, /暴击率 \+10%/, 'crit 行应带暴击文案');
});

test('加成一览零值与空聚合不产生展示行', () => {
  assert.deepEqual(bonusSummaryRows({}), []);
  assert.deepEqual(bonusSummaryRows({ dmg: {}, fireRate: 0 }), []);
});

test('加成一览来源分组：遗物/套装/海克斯/契约/教义/天赋', () => {
  const sim = {
    relics: [{ id: 'sharp', level: 1 }, { id: 'eagle', level: 1 }],
    hex: { id: 'glass_cannon', name: '玻璃大炮', pitch: '全塔伤害 +70%' },
    clearedWave: 3,
    rogue2: {
      contracts: [{ id: 'sloth', scope: 'wave', untilWave: 4 }],
      doctrines: ['bolt'],
    },
    opts: { talent: { nodes: { tower_atk: 1 } } },
  };
  const groups = bonusSourceRows(sim);
  assert.deepEqual(
    groups.map((group) => group.id),
    ['relic', 'set', 'hex', 'contract', 'doctrine', 'talent']
  );
  assert.match(groups[0].items[0].name, /锐利箭簇/);
  assert.match(groups[0].items[0].effect, /25%/);
  assert.match(groups[1].items[0].name, /猎手同盟/);
  assert.match(groups[1].items[0].effect, /攻击速度/);
  assert.equal(groups[2].items[0].name, '玻璃大炮');
  assert.match(groups[3].items[0].name, /惰契/);
  assert.match(groups[4].items[0].name, /穿透/);
  assert.match(groups[5].items[0].name, /百炼锋刃/);
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

// ---------- 爬塔节点地图 / 商人 ----------

test('节点展示模型只露类型与词缀，未知类型回退战斗', () => {
  const view = towerNodeView({ key: '5:0', layer: 5, column: 0, type: 'elite' });
  assert.equal(view.type, 'elite');
  assert.equal(view.label, '精英');
  assert.match(view.hint, /词缀/);
  assert.ok(view.color, '精英节点应有配色');
  assert.equal(view.color, '#ff8a5c', '精英沿用既有橙系配色');

  const fallback = towerNodeView({ key: '1:0', layer: 1, column: 0, type: 'bogus' });
  assert.equal(fallback.type, 'fight', '未知类型回退战斗');
});

test('节点状态分类：当前 / 已通过 / 未开放', () => {
  const node = { key: '3:0' };
  assert.equal(towerNodeState(node, { currentKey: '3:0' }), 'current');
  assert.equal(towerNodeState(node, { currentKey: '4:0', path: ['3:0'] }), 'reached');
  assert.equal(towerNodeState(node, { currentKey: '4:0', path: [] }), 'locked');
});

test('商人商品模型带出价格与可负担，未知遗物标记缺失', () => {
  const view = merchantOfferView({ id: 'sharp', rarity: 'common', price: 80 }, { gold: 120 });
  assert.equal(view.id, 'sharp');
  assert.equal(view.name, '锐利箭簇');
  assert.equal(view.price, 80);
  assert.equal(view.affordable, true);
  assert.equal(view.rarityKey, 'common');
  assert.equal(view.rarityName, '普通');

  assert.equal(merchantOfferView({ id: 'sharp', rarity: 'common', price: 80 }, { gold: 60 }).affordable, false);
  assert.equal(merchantOfferView({ id: 'sharp', rarity: 'common', price: 80 }).affordable, true, '缺金币不误标买不起');
  assert.equal(merchantOfferView({ id: 'missing', rarity: 'common', price: 80 }).missing, true, '未知遗物标记缺失');
});

test('商人出售条目夹取等级并带出售价', () => {
  const view = merchantSellView({ id: 'sharp', level: 5, price: 40 });
  assert.equal(view.levelLabel, RELIC_LEVEL_LABELS[2]);
  assert.equal(view.price, 40);
  assert.equal(merchantSellView({ id: 'sharp', level: 0, price: 40 }).levelLabel, RELIC_LEVEL_LABELS[0]);
  assert.equal(merchantSellView({ id: 'missing', level: 1, price: 10 }).missing, true);
});

test('爬塔节点与商人 i18n 键 zh/en 对称且非空', () => {
  const keys = [
    ...TOWER_NODE_TYPES.flatMap((type) => [`tower.node.${type}.name`, `tower.node.${type}.hint`]),
    'tower.map.eyebrow',
    'tower.map.title',
    'tower.map.note',
    'tower.map.layer',
    'tower.merchant.eyebrow',
    'tower.merchant.title',
    'tower.merchant.goods',
    'tower.merchant.emptyGoods',
    'tower.merchant.buy',
    'tower.merchant.insufficient',
    'tower.merchant.refresh',
    'tower.merchant.sellTitle',
    'tower.merchant.sell',
    'tower.merchant.gold',
  ];
  for (const key of keys) {
    assert.ok(typeof zhCN[key] === 'string' && zhCN[key].trim(), `zh 缺 ${key}`);
    assert.ok(typeof enUS[key] === 'string' && enUS[key].trim(), `en 缺 ${key}`);
    assert.notEqual(enUS[key], zhCN[key], `${key} 英文与中文逐字相同`);
  }
});
