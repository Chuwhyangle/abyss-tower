// 美术语义评审记录护栏：真实记录必须覆盖四场景 × 两视口，且引用的对照图真实存在。
// 记录本身可能是「未通过」（如实转写全新上下文评审的结论），所以这里不硬编码 ok:true：
// 断言结构完整、检查器判定与条目结论一致，并用正反两向样例证明 `checkArtReview` 不是空转。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_SCENES, REQUIRED_VIEWPORTS, checkArtReview } from '../scripts/art-review.mjs';
import { splitList } from '../scripts/lib/review-record.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_PATH = path.join(ROOT, 'docs', 'ART_REVIEW.md');
const SCORE_RE = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/;

function readReview() {
  return fs.readFileSync(REVIEW_PATH, 'utf8');
}

function recordPaths(markdown) {
  const found = new Set();
  for (const match of markdown.matchAll(/`?(docs\/reviews\/[^\s`()]+\.(?:png|json))`?/g)) {
    found.add(match[1]);
  }
  return [...found];
}

test('真实评审记录结构完整：四场景 × 两视口，条目字段齐全', () => {
  const report = checkArtReview();
  assert.deepEqual(report.coverage.missingScenes, [], '记录必须覆盖全部场景');
  assert.deepEqual(report.coverage.missingViewports, [], '记录必须覆盖全部视口');
  assert.ok(report.entries.length >= 4, `至少四条评审条目，实际 ${report.entries.length}`);

  for (const scene of REQUIRED_SCENES) {
    assert.ok(
      report.entries.some((entry) => splitList(entry.scene).includes(scene)),
      `缺少场景条目：${scene}`
    );
  }

  for (const entry of report.entries) {
    assert.ok(entry.reviewer && entry.reviewer.trim(), `条目「${entry.title}」缺评审者`);
    assert.match(entry.score || '', SCORE_RE, `条目「${entry.title}」分数应为 n/10`);
    // 每个场景条目都要分别看过桌面与移动两种视口，而不是只写一条通用结论。
    const viewports = splitList(entry.viewport);
    for (const viewport of REQUIRED_VIEWPORTS) {
      assert.ok(viewports.includes(viewport), `条目「${entry.title}」缺少视口观察：${viewport}`);
    }
  }
});

test('检查器判定与记录里的逐条结论一致，不能少判也不能多判', () => {
  const report = checkArtReview();
  const failing = report.entries.filter((entry) => entry.verdict !== 'pass');
  assert.equal(report.ok, failing.length === 0, 'ok 必须等价于「所有条目通过」');
  if (failing.length) {
    // 未通过条目必须被 errors 点名（validator 以「第 n 条」定位条目），避免检查器静默放过。
    assert.ok(
      report.errors.some((error) => error.includes('结论不是「通过」')),
      '未通过条目没有出现在 errors 里'
    );
  }
});

test('记录引用的对照图真实存在且不是占位图', () => {
  const paths = recordPaths(readReview()).filter((item) => item.endsWith('.png'));
  assert.ok(paths.includes('docs/reviews/baseline-contact-sheet.png'), '缺少基线对照图引用');
  assert.ok(paths.includes('docs/reviews/art-after/contact-sheet.png'), '缺少重制后对照图引用');

  for (const relative of paths) {
    const absolute = path.join(ROOT, relative);
    assert.ok(fs.existsSync(absolute), `记录引用的图片不存在：${relative}`);
    const { size } = fs.statSync(absolute);
    assert.ok(size > 1024, `记录引用的图片疑似占位：${relative}（${size}B）`);
  }

  const manifest = path.join(ROOT, 'docs', 'reviews', 'art-after', 'manifest.json');
  assert.ok(fs.existsSync(manifest), '缺少重制后采集 manifest');
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  assert.ok(Array.isArray(parsed.scenes) && parsed.scenes.length > 0, 'manifest 应包含采集帧');
});

test('评审过程一节记录采集命令、commit 与隔离方式', () => {
  const text = readReview();
  assert.match(text, /^## 评审过程/m, '缺少「## 评审过程」一节');
  const section = text.slice(text.search(/^## 评审过程/m));
  const body = section.split(/^## /m).slice(0, 2).join('## ');
  assert.match(body, /tests\/visual-scenes\.mjs/, '评审过程应写明采集命令');
  assert.match(body, /\b[0-9a-f]{7,40}\b/, '评审过程应写明 commit');
  assert.match(body, /隔离|全新上下文/, '评审过程应写明评审者上下文隔离方式');
});

test('反向：删掉全部条目后检查失败', () => {
  const text = readReview();
  const stripped = text
    .split('\n')
    .filter((line) => !/^###\s+/.test(line))
    .join('\n')
    .replace(/- (场景|视口|日期|评审者|结论|分数|说明)：.*$/gm, '');
  const report = checkArtReview({ text: stripped });
  assert.equal(report.ok, false, '删掉条目后不应通过');
  assert.ok(report.errors.some((error) => error.includes('缺少评审条目')));
});

test('反向：把一条「通过」改成「未通过」后检查失败', () => {
  const text = readReview();
  const flipped = text.replace(/^(- 结论[：:])\s*通过\s*$/m, '$1未通过');
  assert.notEqual(flipped, text, '记录里应至少有一条「- 结论：通过」可以翻转');
  const report = checkArtReview({ text: flipped });
  assert.equal(report.ok, false, '结论未通过时不应通过');
  assert.ok(report.errors.some((error) => error.includes('结论不是「通过」')));
});

test('正向：把所有条目改成「通过」后检查器可以放行（证明检查不是恒假）', () => {
  const text = readReview().replace(/^(- 结论[：:])\s*未通过\s*$/gm, '$1通过');
  const report = checkArtReview({ text });
  assert.equal(report.ok, true, `全部通过时应放行：${report.errors.join('；')}`);
});
