#!/usr/bin/env node
// 真人试玩记录读数器（GOAL-008 / AC-042）。
//
// 只读：解析 docs/PLAYTEST.md 的三档表格，拒绝空表、缺字段、样本量不足与非法失败原因。
// 用法：node scripts/playtest-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIFFICULTIES = Object.freeze(['漫游', '远征', '深渊']);
export const UNLOCK_STATES = Object.freeze(['全解锁', '零解锁']);
export const FAILURE_REASONS = Object.freeze(['漏怪类型', '经济断档', '塔位失误', '遗物太差', '其它', '—']);
const MIN_PER_DIFFICULTY = 6;
const MIN_PER_UNLOCK = 3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parsePlaytest(markdown) {
  const result = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, []]));
  const lines = String(markdown).split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+(漫游|远征|深渊)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      continue;
    }
    if (/^##\s+/.test(line)) {
      current = null;
      continue;
    }
    if (!current || !/^\s*\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 12) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    result[current].push({
      date: cells[0],
      version: cells[1],
      unlock: cells[2],
      map: cells[3],
      affix: cells[4],
      outcome: cells[5],
      baseHp: cells[6],
      gold: cells[7],
      towers: cells[8],
      relics: cells[9],
      failureReason: cells[10],
      notes: cells[11],
    });
  }
  return result;
}

function isPositiveInt(value) {
  return /^\d+$/.test(String(value).trim());
}

export function evaluate(records) {
  const problems = [];
  const summary = {};
  for (const difficulty of DIFFICULTIES) {
    const rows = records[difficulty] || [];
    summary[difficulty] = { total: rows.length };
    if (rows.length < MIN_PER_DIFFICULTY) {
      problems.push(`${difficulty} 只有 ${rows.length} 局，至少需要 ${MIN_PER_DIFFICULTY} 局（两种解锁口径各 ${MIN_PER_UNLOCK} 局）`);
    }
    for (const unlock of UNLOCK_STATES) {
      const count = rows.filter((row) => row.unlock === unlock).length;
      summary[difficulty][unlock] = count;
      if (count < MIN_PER_UNLOCK) {
        problems.push(`${difficulty} 的「${unlock}」只有 ${count} 局，至少需要 ${MIN_PER_UNLOCK} 局`);
      }
    }
    rows.forEach((row, index) => {
      const where = `${difficulty} 第 ${index + 1} 行`;
      if (!row.version) problems.push(`${where} 缺少内容版本`);
      if (!UNLOCK_STATES.includes(row.unlock)) problems.push(`${where} 解锁状态「${row.unlock}」非法`);
      if (!row.map) problems.push(`${where} 缺少地图原型`);
      if (!row.affix) problems.push(`${where} 缺少词缀`);
      if (!/^通关$/.test(row.outcome) && !/^第\s*\d+\s*波失败$/.test(row.outcome)) {
        problems.push(`${where} 结果「${row.outcome}」必须是「通关」或「第 N 波失败」`);
      }
      if (!isPositiveInt(row.baseHp)) problems.push(`${where} 剩余基地生命必须是整数`);
      if (!isPositiveInt(row.gold)) problems.push(`${where} 剩余金币必须是整数`);
      if (!row.towers) problems.push(`${where} 缺少塔数与关键塔`);
      if (!row.relics) problems.push(`${where} 缺少关键遗物`);
      if (!FAILURE_REASONS.includes(row.failureReason)) {
        problems.push(`${where} 失败原因「${row.failureReason}」不在允许分类中`);
      }
      if (/^通关$/.test(row.outcome) && row.failureReason !== '—') {
        problems.push(`${where} 通关局失败原因必须填「—」`);
      }
      if (/失败$/.test(row.outcome) && row.failureReason === '—') {
        problems.push(`${where} 失败局必须填主因`);
      }
    });
  }
  return { ok: problems.length === 0, problems, summary };
}

function main() {
  const file = path.join(ROOT, 'docs/PLAYTEST.md');
  if (!fs.existsSync(file)) {
    console.error('FAIL: 缺少 docs/PLAYTEST.md');
    process.exit(1);
  }
  const records = parsePlaytest(fs.readFileSync(file, 'utf8'));
  const verdict = evaluate(records);
  if (!verdict.ok) {
    for (const problem of verdict.problems) console.error(`FAIL: ${problem}`);
    process.exit(1);
  }
  console.log(`PASS playtest ${JSON.stringify(verdict.summary)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
