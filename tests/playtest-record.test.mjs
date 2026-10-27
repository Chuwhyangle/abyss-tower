import test from 'node:test';
import assert from 'node:assert/strict';

import { DIFFICULTIES, evaluate, parsePlaytest } from '../scripts/playtest-check.mjs';

const HEADER = '| 日期 | 内容版本 | 解锁状态 | 地图原型 | 词缀 | 结果 | 剩余基地生命 | 剩余金币 | 塔数与关键塔 | 关键遗物 | 失败原因 | 主观备注 |';
const SEP = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function row(date, unlock, outcome, reason) {
  return `| ${date} | v2.0.0 | ${unlock} | 裂谷关隘 | 富矿 | ${outcome} | 12 | 300 | 18 塔：弩炮×6 | 锐利箭簇Ⅲ | ${reason} | — |`;
}

function section(difficulty, rows) {
  return `## ${difficulty}\n\n${HEADER}\n${SEP}\n${rows.join('\n')}\n`;
}

function fixture({ rowsPerDifficulty = 6, version = 'v2.0.0' } = {}) {
  return DIFFICULTIES.map((difficulty) => {
    const rows = [];
    for (let i = 0; i < rowsPerDifficulty; i += 1) {
      const unlock = i % 2 === 0 ? '全解锁' : '零解锁';
      const win = i % 3 === 0;
      rows.push(
        row(`2026-10-${String(20 + i).padStart(2, '0')}`, unlock, win ? '通关' : '第 12 波失败', win ? '—' : '漏怪类型')
          .replace('| v2.0.0 |', `| ${version} |`),
      );
    }
    return section(difficulty, rows);
  }).join('\n');
}

test('空表被拒绝', () => {
  const verdict = evaluate(parsePlaytest(''));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.includes('至少需要')));
});

test('完整样本通过', () => {
  const verdict = evaluate(parsePlaytest(fixture()));
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.ok, true);
  for (const difficulty of DIFFICULTIES) {
    assert.equal(verdict.summary[difficulty].total, 6);
    assert.equal(verdict.summary[difficulty]['全解锁'], 3);
    assert.equal(verdict.summary[difficulty]['零解锁'], 3);
  }
});

test('样本量不足被拒绝', () => {
  const verdict = evaluate(parsePlaytest(fixture({ rowsPerDifficulty: 5 })));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.includes('至少需要 6 局')));
});

test('缺字段被拒绝', () => {
  const bad = fixture({ version: '' });
  const verdict = evaluate(parsePlaytest(bad));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.includes('缺少内容版本')));
});

test('通关局失败原因必须是 —', () => {
  const markdown = section('漫游', [
    row('2026-10-20', '全解锁', '通关', '漏怪类型'),
    row('2026-10-21', '全解锁', '通关', '—'),
    row('2026-10-22', '全解锁', '通关', '—'),
    row('2026-10-23', '零解锁', '通关', '—'),
    row('2026-10-24', '零解锁', '通关', '—'),
    row('2026-10-25', '零解锁', '通关', '—'),
  ]);
  const verdict = evaluate(parsePlaytest(markdown));
  assert.ok(verdict.problems.some((problem) => problem.includes('通关局失败原因必须填')));
});
