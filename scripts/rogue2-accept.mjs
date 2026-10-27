#!/usr/bin/env node
// 肉鸽养成 2.0 验收读数器（GOAL-007）。
//
// 每条子命令只读、可重复执行；未落地时 exit 1。它是 goal AC 的判据仪器：
//   design / factions / starter / cores / contracts / doctrines / awakenings / balance
//
// 判据分两层：
//   1. 交付物的公开契约（模块存在、导出、关键纯函数行为）；
//   2. 该任务自己的测试文件存在且 `node --test` 通过。
// 任一层不成立即失败——只检查文件存在不算通过。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function file(rel) {
  return path.join(ROOT, rel);
}

function exists(rel) {
  return fs.existsSync(file(rel));
}

function read(rel) {
  if (!exists(rel)) fail(`缺少文件 ${rel}`);
  return fs.readFileSync(file(rel), 'utf8');
}

async function load(rel) {
  if (!exists(rel)) fail(`缺少模块 ${rel}`);
  return import(pathToFileURL(file(rel)).href);
}

function need(condition, message) {
  if (!condition) fail(message);
}

function runTaskTest(rel) {
  if (!exists(rel)) fail(`缺少验收测试 ${rel}（交付物不能只靠实现自述）`);
  const result = spawnSync(process.execPath, ['--test', rel], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    fail(`${rel} 未通过（exit ${result.status}）`);
  }
  console.log(`PASS ${rel}`);
}

function pickFactionWithMembers(relics, factionOrder, minimum = 4) {
  const groups = new Map();
  for (const relic of relics) {
    const faction = relic.faction;
    if (!faction || faction === 'neutral') continue;
    if (!groups.has(faction)) groups.set(faction, []);
    groups.get(faction).push(relic);
  }
  for (const faction of factionOrder) {
    const members = groups.get(faction) || [];
    if (members.length >= minimum) return { faction, members };
  }
  return null;
}

function statesForSum(ids, sum) {
  let left = sum;
  const states = [];
  for (const id of ids) {
    const level = Math.max(0, Math.min(3, left));
    if (level > 0) states.push({ id, level });
    left -= level;
    if (left <= 0) break;
  }
  return states;
}

async function design() {
  const doc = read('docs/PHASE_ROGUE2.md');
  const { RELICS } = await load('public/js/shared/data/relics.js');
  const missing = RELICS.filter((relic) => !new RegExp(`\\b${relic.id}\\b`).test(doc));
  need(missing.length === 0, `PHASE_ROGUE2 未覆盖 ${missing.length} 件遗物：${missing.slice(0, 8).map((r) => r.id).join(', ')}`);
  for (const faction of ['火力', '霜缚', '蚀毒', '雷暴', '守护']) {
    need(doc.includes(faction), `PHASE_ROGUE2 缺少派系「${faction}」`);
  }
  for (const heading of ['首领核心', '契约', '教义', '觉醒', '4', '8', '12']) {
    need(doc.includes(heading), `PHASE_ROGUE2 缺少字段/阈值「${heading}」`);
  }
  for (const docPath of ['docs/PRD.md', 'docs/TECH_DESIGN.md']) {
    need(read(docPath).includes('PHASE_ROGUE2'), `${docPath} 未引用 PHASE_ROGUE2`);
  }
  runTaskTest('tests/rogue2-design.test.mjs');
  console.log('PASS design');
}

async function factions() {
  const mod = await load('public/js/shared/factions.js');
  const { RELICS } = await load('public/js/shared/data/relics.js');
  need(Array.isArray(mod.FACTION_ORDER) && mod.FACTION_ORDER.length === 5, 'FACTION_ORDER 必须是 5 个派系');
  for (const relic of RELICS) {
    need(typeof relic.faction === 'string' && relic.faction.length > 0, `遗物 ${relic.id} 缺少 faction`);
    need(
      relic.faction === 'neutral' || mod.FACTION_ORDER.includes(relic.faction),
      `遗物 ${relic.id} 的 faction「${relic.faction}」不在 FACTION_ORDER 中`,
    );
  }
  const picked = pickFactionWithMembers(RELICS, mod.FACTION_ORDER);
  need(picked !== null, '没有任何派系拥有至少 4 件遗物，无法达到 12 点阈值');
  const ids = picked.members.slice(0, 4).map((relic) => relic.id);
  const pointsAt = (sum) => mod.factionPoints(statesForSum(ids, sum))[picked.faction] || 0;
  const tierAt = (sum) => mod.factionTiers(statesForSum(ids, sum))[picked.faction] || 0;
  need(pointsAt(3) === 3, '点数必须等于遗物等级之和');
  need(tierAt(3) === 0 && tierAt(4) === 1 && tierAt(7) === 1 && tierAt(8) === 2 && tierAt(11) === 2 && tierAt(12) === 3,
    '4/8/12 阈值映射必须是 0/1/2/3 档');
  need(Object.keys(mod.factionSetMods({})).length === 0, '0 点时 setMods 必须为空');
  need(Object.keys(mod.factionSetMods({ [picked.faction]: 3 })).length > 0, '三档 setMods 不能为空');
  runTaskTest('tests/factions.test.mjs');
  console.log('PASS factions');
}

async function starter() {
  const mod = await load('public/js/shared/data/relics.js');
  need(typeof mod.rollStarterOffers === 'function', 'data/relics.js 必须导出 rollStarterOffers');
  const a = mod.rollStarterOffers('accept-seed', 'normal');
  const b = mod.rollStarterOffers('accept-seed', 'normal');
  need(JSON.stringify(a) === JSON.stringify(b), '同一 seed 的开局信物必须可复现');
  need(Array.isArray(a) && a.length === 3, '开局信物必须是三选一');
  const byId = new Map(mod.RELICS.map((relic) => [relic.id, relic]));
  const factions = new Set(a.map((offer) => byId.get(offer.id)?.faction));
  need(factions.size === 3 && !factions.has('neutral'), '三张信物必须来自三个不同派系且不可是中立');
  need(a.every((offer) => (offer.fromLevel || 0) === 0 && offer.toLevel === 1), '信物必须是 Ⅰ 级新遗物');
  const owned = mod.RELICS[0];
  for (let seed = 0; seed < 20; seed += 1) {
    const offers = mod.rollRelicOffers(`accept-${seed}`, [{ id: owned.id, level: 1 }], 3, 3, 'normal');
    need(
      offers.some((offer) => offer.kind === 'relic' && offer.id === owned.id && offer.fromLevel >= 1),
      `seed ${seed} 的第 3 波三选一没有保底升级卡`,
    );
  }
  runTaskTest('tests/starter-relic.test.mjs');
  console.log('PASS starter');
}

async function cores() {
  const mod = await load('public/js/shared/cores.js');
  const { RELICS } = await load('public/js/shared/data/relics.js');
  need(JSON.stringify(mod.CORE_WAVES) === '[5,10,15,20,25]', 'CORE_WAVES 必须是 5/10/15/20/25');
  need(typeof mod.rollCoreOffers === 'function', 'cores.js 必须导出 rollCoreOffers');
  need(typeof mod.applyCore === 'function', 'cores.js 必须导出 applyCore');
  const states = [{ id: RELICS[0].id, level: 1 }];
  for (const wave of mod.CORE_WAVES) {
    const offers = mod.rollCoreOffers('accept-seed', wave, states, { awakening: true, doctrine: true });
    need(Array.isArray(offers) && offers.length === 3, `第 ${wave} 波核心必须是三选一`);
    need(offers.some((offer) => offer.kind === 'upgrade'), `第 ${wave} 波核心必须始终提供定向升阶`);
  }
  const early = mod.rollCoreOffers('accept-seed', 5, states, { awakening: true, doctrine: true });
  need(!early.some((offer) => offer.kind === 'awakening' || offer.kind === 'doctrine'), '第 10 波前不得出现觉醒/教义');
  let sawAwakening = false;
  let sawDoctrine = false;
  for (let seed = 0; seed < 12; seed += 1) {
    const offers = mod.rollCoreOffers(`accept-${seed}`, 10, states, { awakening: true, doctrine: true });
    sawAwakening ||= offers.some((offer) => offer.kind === 'awakening');
    sawDoctrine ||= offers.some((offer) => offer.kind === 'doctrine');
  }
  need(sawAwakening && sawDoctrine, '第 10 波起的能力检查必须能让觉醒与教义进入候选');
  runTaskTest('tests/boss-cores.test.mjs');
  console.log('PASS cores');
}

async function contracts() {
  const mod = await load('public/js/shared/contracts.js');
  need(Array.isArray(mod.CONTRACT_IDS) && mod.CONTRACT_IDS.length === 5, '契约必须是 5 条');
  need(typeof mod.rollContractOffer === 'function', 'contracts.js 必须导出 rollContractOffer');
  need(typeof mod.applyContract === 'function', 'contracts.js 必须导出 applyContract');
  const state = { accepted: [], maxHp: 20, hp: 20, gold: 200, rerolls: 2, relics: [], nextOfferCount: 3 };
  for (const wave of [9, 14, 19, 24]) {
    need(mod.rollContractOffer('accept-seed', wave, state), `第 ${wave} 波必须出现契约卡`);
  }
  for (const wave of [8, 10, 13]) {
    need(mod.rollContractOffer('accept-seed', wave, state) == null, `第 ${wave} 波不应出现契约卡`);
  }
  runTaskTest('tests/contracts.test.mjs');
  console.log('PASS contracts');
}

async function doctrines() {
  const mod = await load('public/js/shared/doctrines.js');
  need(Array.isArray(mod.DOCTRINE_IDS) && mod.DOCTRINE_IDS.length === 5, '教义必须是 5 条');
  need(typeof mod.applyDoctrine === 'function', 'doctrines.js 必须导出 applyDoctrine');
  runTaskTest('tests/doctrines.test.mjs');
  console.log('PASS doctrines');
}

async function awakenings() {
  const mod = await load('public/js/shared/awakenings.js');
  need(Array.isArray(mod.AWAKENING_IDS) && mod.AWAKENING_IDS.length === 4, 'P0 觉醒必须是 4 条');
  need(typeof mod.awakeningFor === 'function', 'awakenings.js 必须导出 awakeningFor');
  runTaskTest('tests/awakenings.test.mjs');
  console.log('PASS awakenings');
}

async function balance() {
  const raw = read('docs/BALANCE_ROGUE2.json');
  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    fail(`BALANCE_ROGUE2.json 不是合法 JSON：${error.message}`);
  }
  const { BALANCE_TARGETS } = await load('public/js/shared/config.js');
  need(report.meta && Number(report.meta.seeds) >= 40, '平衡报告必须至少 40 个种子');
  need(Array.isArray(report.targets) && report.targets.length === 3, '平衡报告必须包含三档 targets');
  for (const row of report.targets) {
    const [low, high] = BALANCE_TARGETS[row.difficulty] || [];
    need(low != null, `未知难度 ${row.difficulty}`);
    need(row.status === '达标', `${row.difficulty} 未达标（${row.status}，${row.winRate}）`);
    need(row.winRate >= low && row.winRate <= high, `${row.difficulty} 通关率 ${row.winRate} 不在 ${low}–${high}`);
  }
  runTaskTest('tests/rogue2-balance-targets.test.mjs');
  console.log('PASS balance');
}

const checks = { design, factions, starter, cores, contracts, doctrines, awakenings, balance };
const name = process.argv[2];
if (!checks[name]) {
  console.error(`usage: node scripts/rogue2-accept.mjs <${Object.keys(checks).join('|')}>`);
  process.exit(2);
}
await checks[name]();
