// 肉鸽养成 2.0 设计冻结表（PHASE_ROGUE2）的验收见证（gap-ac-054-rogue2-design-rebase / AC-054）。
//
// 断言的是「表与 live 数据是否一致」，不是手写清单是否自洽：
//   1. 70 件遗物的 id 从 `data/relics.js` 现读，逐件反查本表的归属行；
//   2. 5 派系、4/8/12 阈值、setMods 键、核心/契约/教义/觉醒字段表齐全；
//   3. setMods 数值表只在本表出现一次，PRD / TECH_DESIGN 不得复制这些键。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELICS } from '../public/js/shared/data/relics.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PHASE = 'docs/PHASE_ROGUE2.md';
const FACTION_ORDER = ['fire', 'frost', 'venom', 'storm', 'warden'];
const FACTION_BY_NAME = {
  火力: 'fire',
  霜缚: 'frost',
  蚀毒: 'venom',
  雷暴: 'storm',
  守护: 'warden',
  中立: 'neutral',
};
// §3.2 / §3.3 的 setMods 键清单：派系三档效果只允许落在这 15 个键上。
const SET_MODS_KEYS = [
  'allDamage',
  'critDamage',
  'killExplosion',
  'slowDuration',
  'frostFreeze',
  'freezeVulnerable',
  'poisonSlow',
  'poisonVulnerable',
  'poisonSpread',
  'chainExtra',
  'chainRange',
  'chainCrit',
  'leakIgnoreChance',
  'leakDamageReduction',
  'setWaveHeal',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 取标题含 `prefix` 的章节正文，到下一个同级或更高级标题为止（支持 ##/###/####）。
function section(markdown, prefix) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{2,4}\s+/.test(line) && line.includes(prefix));
  assert.notEqual(start, -1, `PHASE_ROGUE2 缺少「${prefix}」章节`);
  const level = /^(#+)/.exec(lines[start])[1].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const heading = /^(#{1,6})\s+/.exec(lines[i]);
    if (heading && heading[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

// 表格的数据行：跳过表头（首列 `id`）与分隔行。
function tableRows(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length > 0 && cells[0] !== 'id');
}

// §2.3 的逐件归属表：h4 小标题声明派系，表格行给 id / 名称 / 稀有度。
function parseRelicMapping(markdown) {
  const mapping = new Map();
  let current = null;
  for (const line of markdown.split('\n')) {
    if (/^#{2,3}\s+/.test(line)) current = null;
    const heading = /^####\s+(火力|霜缚|蚀毒|雷暴|守护|中立)（/.exec(line);
    if (heading) {
      current = { faction: FACTION_BY_NAME[heading[1]], claimed: Number(/—\s*(\d+)\s*件/.exec(line)?.[1]) };
      continue;
    }
    if (!current) continue;
    const row = /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([^|]+?)\s*\|\s*(普通|稀有|史诗)\s*\|/.exec(line.trim());
    if (!row) continue;
    assert.ok(!mapping.has(row[1]), `遗物 ${row[1]} 在归属表里出现了两次`);
    mapping.set(row[1], { faction: current.faction, rarity: row[3] });
  }
  const claimed = [...markdown.matchAll(/^####\s+(火力|霜缚|蚀毒|雷暴|守护|中立)（[^）]*）—\s*(\d+)\s*件/gm)].map(
    (match) => [FACTION_BY_NAME[match[1]], Number(match[2])]
  );
  return { mapping, claimed };
}

test('PHASE_ROGUE2 存在且声明自己是唯一冻结表', () => {
  const markdown = read(PHASE);
  assert.match(markdown, /冻结表的唯一定义处/);
  assert.match(markdown, /AC-054/);
});

test('70 件遗物逐件都有归属：id 集合与 data/relics.js 完全相等', () => {
  const markdown = read(PHASE);
  const { mapping } = parseRelicMapping(markdown);

  const liveIds = RELICS.map((relic) => relic.id);
  assert.equal(liveIds.length, 70, '当前遗物池应为 70 件（普通 29 / 稀有 26 / 史诗 15）');
  assert.equal(mapping.size, liveIds.length, `归属表行数 ${mapping.size} 与遗物数 ${liveIds.length} 不一致`);

  const missing = liveIds.filter((id) => !mapping.has(id));
  const extra = [...mapping.keys()].filter((id) => !liveIds.includes(id));
  assert.deepEqual(missing, [], `归属表缺少遗物：${missing.join(', ')}`);
  assert.deepEqual(extra, [], `归属表含有不存在的遗物：${extra.join(', ')}`);

  for (const relic of RELICS) {
    const entry = mapping.get(relic.id);
    assert.ok(
      entry.faction === 'neutral' || FACTION_ORDER.includes(entry.faction),
      `遗物 ${relic.id} 的归属「${entry.faction}」不是五派系之一，也不是 neutral`
    );
  }
});

test('派系归属与遗物稀有度一致，且每派系件数与标题声明相等', () => {
  const markdown = read(PHASE);
  const { mapping, claimed } = parseRelicMapping(markdown);
  const rarityName = { common: '普通', rare: '稀有', epic: '史诗' };

  for (const relic of RELICS) {
    assert.equal(
      mapping.get(relic.id).rarity,
      rarityName[relic.rarity],
      `遗物 ${relic.id} 的稀有度与表内不一致（live=${relic.rarity}）`
    );
    // 实现落地后（遗物带上 faction 字段）本条立即成为双向漂移检测；当前为前向兼容。
    if (typeof relic.faction === 'string') {
      assert.equal(relic.faction, mapping.get(relic.id).faction, `遗物 ${relic.id} 的 faction 与冻结表不一致`);
    }
  }

  const byFaction = new Map();
  for (const { faction } of mapping.values()) byFaction.set(faction, (byFaction.get(faction) || 0) + 1);

  let total = 0;
  for (const [faction, count] of claimed) {
    assert.equal(byFaction.get(faction), count, `派系 ${faction} 标题声明 ${count} 件，实际 ${byFaction.get(faction)} 件`);
    total += count;
  }
  assert.equal(total, RELICS.length, '标题声明的件数之和必须等于遗物总数');
  for (const faction of FACTION_ORDER) {
    const count = byFaction.get(faction) || 0;
    assert.ok(count >= 4, `派系 ${faction} 只有 ${count} 件，无法凑满 12 点（每件最多 3 点）`);
  }
});

test('点数与 4/8/12 阈值口径齐全且唯一', () => {
  const markdown = read(PHASE);
  const points = section(markdown, '点数与阈值');
  assert.match(points, /\| T1 \| 4 \|/, '缺 T1 = 4 点');
  assert.match(points, /\| T2 \| 8 \|/, '缺 T2 = 8 点');
  assert.match(points, /\| T3 \| 12 \|/, '缺 T3 = 12 点');
  assert.match(points, /bonusPoints/, '点数公式必须声明 bonusPoints 覆盖层');
  assert.match(markdown, /export const FACTION_ORDER = \['fire', 'frost', 'venom', 'storm', 'warden'\];/, '派系顺序未冻结');
});

test('setMods 键清单与五派系三档效果表齐全，且 15 个键逐一出现', () => {
  const markdown = read(PHASE);
  const keyTable = section(markdown, '`setMods` 契约');
  const rows = tableRows(keyTable).filter((cells) => cells.length >= 5);
  const keysInTable = new Set(rows.map((cells) => cells[0].replace(/`/g, '')));
  for (const key of SET_MODS_KEYS) {
    assert.ok(keysInTable.has(key), `setMods 键清单缺少 ${key}`);
  }

  const tiers = section(markdown, '各派系 4/8/12 效果表');
  const tierRows = tableRows(tiers);
  const factionRows = tierRows.filter((cells) => ['火力', '霜缚', '蚀毒', '雷暴', '守护'].includes(cells[0]));
  assert.equal(factionRows.length, 5, '三档效果表必须恰好五行（五派系）');
  for (const cells of factionRows) {
    assert.equal(cells.length, 4, `${cells[0]} 的三档表必须恰好 T1/T2/T3 三列`);
    for (const cell of cells.slice(1)) assert.ok(cell.length > 0, `${cells[0]} 有空档位`);
  }
  for (const key of SET_MODS_KEYS) {
    assert.ok(tiers.includes(key), `三档效果表没有落地键 ${key}`);
  }
  // 三档效果是「唯一数值表」：PRD/TECH 不得复制这些键。
  for (const doc of ['docs/PRD.md', 'docs/TECH_DESIGN.md']) {
    const text = read(doc);
    for (const key of SET_MODS_KEYS) {
      assert.ok(!text.includes(key), `${doc} 不得复制冻结表的 setMods 键「${key}」`);
    }
  }
});

test('首领核心：5 个波次、5 类选项与字段契约齐全', () => {
  const markdown = read(PHASE);
  const cores = section(markdown, '首领核心');
  assert.match(cores, /CORE_WAVES = \[5, 10, 15, 20, 25\]/, '核心波次必须是 5/10/15/20/25');
  const kinds = tableRows(section(cores, '五类选项字段表')).map((cells) => cells[0].replace(/`/g, ''));
  for (const kind of ['upgrade', 'search', 'awakening', 'doctrine', 'supply']) {
    assert.ok(kinds.includes(kind), `核心选项缺少 ${kind}`);
  }
  assert.match(cores, /不可刷新/, '核心必须声明不可刷新');
  assert.match(cores, /清波即发放/, '核心必须声明服务端可验证边界');
});

test('契约卡：5 条、出现波次与不可改敌人属性红线齐全', () => {
  const markdown = read(PHASE);
  const contracts = section(markdown, '契约卡');
  assert.match(contracts, /9 \/ 14 \/ 19 \/ 24/, '契约波次必须是 9/14/19/24');
  assert.match(contracts, /最多接受 \*\*2\*\* 次/, '契约每局上限必须是 2 次');
  assert.match(contracts, /绝不改敌人 HP \/ 速度 \/ 入口/, '契约必须声明敌人属性红线');
  const ids = tableRows(section(contracts, '五条契约表')).map((cells) => cells[0].replace(/`/g, ''));
  assert.deepEqual(ids.sort(), ['blood', 'burn', 'debt', 'poverty', 'sloth'], '契约必须是这 5 条');
});

test('教义：5 条、与派系层同键加算、每局上限 2', () => {
  const markdown = read(PHASE);
  const doctrines = section(markdown, '教义');
  assert.match(doctrines, /每局上限 \*\*2\*\* 次/, '教义每局上限必须是 2 次');
  assert.match(doctrines, /不可逆/, '教义必须声明不可逆');
  const ids = tableRows(section(doctrines, '五条教义表')).map((cells) => cells[0].replace(/`/g, ''));
  assert.deepEqual(ids.sort(), ['arc', 'bolt', 'cannon', 'frost', 'poison'], '教义必须是这 5 条');
});

test('觉醒：P0 恰好 4 条，目标必须是 Ⅲ 级遗物', () => {
  const markdown = read(PHASE);
  const awakenings = section(markdown, '觉醒');
  assert.match(awakenings, /AWAKENING_IDS = \['sharp-pierce', 'powder-ignite', 'frostheart-shatter', 'toxin-spread'\]/);
  assert.match(awakenings, /Ⅲ 级\*\*/, '觉醒必须要求目标遗物满级');
  const ids = tableRows(section(awakenings, 'P0 四条')).map((cells) => cells[0].replace(/`/g, ''));
  assert.deepEqual(ids.sort(), ['frostheart-shatter', 'powder-ignite', 'sharp-pierce', 'toxin-spread']);
});

test('模块导出契约覆盖五个模块，且信物/保底升级卡规则被冻结', () => {
  const markdown = read(PHASE);
  const contract = section(markdown, '模块导出契约');
  for (const symbol of [
    'FACTION_ORDER',
    'factionPoints',
    'factionTiers',
    'factionSetMods',
    'rollStarterOffers',
    'CORE_WAVES',
    'rollCoreOffers',
    'applyCore',
    'CONTRACT_IDS',
    'rollContractOffer',
    'applyContract',
    'DOCTRINE_IDS',
    'applyDoctrine',
    'AWAKENING_IDS',
    'awakeningFor',
  ]) {
    assert.ok(contract.includes(symbol), `导出契约缺少 ${symbol}`);
  }
  assert.match(markdown, /三个不同派系/, '信物三选一必须来自三个不同派系');
  assert.match(markdown, /第 3 波保底升级卡/, '必须冻结第 3 波保底升级卡');
});

test('快照 v5 与四类事件字段被冻结', () => {
  const markdown = read(PHASE);
  const snapshot = section(markdown, '快照 v5');
  for (const field of ['starter', 'points', 'bonusPoints', 'coreTaken', 'contracts', 'doctrines', 'awakenings']) {
    assert.ok(snapshot.includes(field), `快照 v5 缺少字段 ${field}`);
  }
  assert.match(snapshot, /"v": 5/);
  const events = section(markdown, '事件字段');
  for (const type of ['core_taken', 'contract_accepted', 'doctrine_chosen', 'awakening_gained']) {
    assert.ok(events.includes(type), `事件字段缺少 ${type}`);
  }
});

