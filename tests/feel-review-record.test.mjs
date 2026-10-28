// 打击感复评记录单测（gap-feel-review-rereview）：
// 记录必须真的能过 `scripts/feel-review.mjs --check`、覆盖 combat、不复用 FEEL-001 的旧评审上下文，
// 并且随仓库落地的证据图/清单可被独立核对（不是只写一条「通过」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { checkFeelReview } from '../scripts/feel-review.mjs';
import { decodePng } from '../scripts/lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = path.join(ROOT, 'docs/FEEL_REVIEW.md');
const REVIEWS = path.join(ROOT, 'docs/reviews');
const COMPOSITE = path.join(REVIEWS, 'feel-review-before-after.png');
const CONTACT_SHEET = path.join(REVIEWS, 'feel-after/contact-sheet.png');
const MANIFEST = path.join(REVIEWS, 'feel-after/manifest.json');

// FEEL-001 的评审者不得被复用：复评必须来自全新上下文。
const FORBIDDEN_REVIEWER = 'ac6c9e7b5c403f466';

function bandHashes(image, bands = 12) {
  const hashes = [];
  const bandH = Math.max(1, Math.floor(image.height / bands));
  for (let b = 0; b < bands; b++) {
    const y0 = b * bandH;
    const y1 = b === bands - 1 ? image.height : y0 + bandH;
    const slice = image.data.subarray(y0 * image.width * 4, y1 * image.width * 4);
    hashes.push(crypto.createHash('sha256').update(slice).digest('hex'));
  }
  return hashes;
}

test('FEEL_REVIEW.md 的评审记录能通过 feel gate', () => {
  const report = checkFeelReview({ file: 'docs/FEEL_REVIEW.md' });
  assert.equal(report.ok, true, report.errors.join('；'));
  assert.ok(report.entries.length >= 1, '至少要有一条评审条目');
  assert.ok(report.coverage.ok, report.coverage.errors.join('；'));
});

test('评审记录覆盖 combat，且不复用 FEEL-001 的旧评审上下文', () => {
  const text = fs.readFileSync(REVIEW, 'utf8');
  assert.match(text, /场景[：:]\s*combat/, '记录必须声明 combat 场景');
  assert.match(text, /评审过程/, '记录必须包含「评审过程」');
  const report = checkFeelReview({ file: 'docs/FEEL_REVIEW.md' });
  for (const entry of report.entries) {
    assert.notEqual(entry.reviewer, FORBIDDEN_REVIEWER, `条目「${entry.title}」复用了旧评审者`);
    assert.ok(entry.reviewer, `条目「${entry.title}」缺少评审者标识`);
  }
});

test('前后对照图落地且是多面板真实图（不是空白/重复帧）', () => {
  const image = decodePng(fs.readFileSync(COMPOSITE));
  assert.equal(image.width, 1518, '对照图宽度应为 1518');
  assert.ok(image.height > 1000, `对照图高度异常：${image.height}`);
  const hashes = bandHashes(image);
  assert.ok(new Set(hashes).size >= 9, `对照图分带重复过多（${new Set(hashes).size}/12）`);
  const sheet = decodePng(fs.readFileSync(CONTACT_SHEET));
  assert.ok(sheet.width > 0 && sheet.height > 0);
  assert.ok(new Set(bandHashes(sheet)).size >= 9, 'after 总览分带重复过多');
});

test('after 清单覆盖 16 场景 × 两视口，时间断言成立', () => {
  const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const scenes = new Set(man.scenarios.map((item) => item.scenario));
  assert.ok(scenes.size >= 16, `场景数不足：${scenes.size}`);
  const viewports = new Set(man.scenarios.map((item) => item.viewport));
  assert.deepEqual([...viewports].sort(), ['desktop', 'mobile-landscape']);
  for (const scenario of man.scenarios) {
    for (const frame of scenario.frames) {
      if (frame.requestedTime == null) continue;
      const drift = Math.abs(frame.requestedTime - frame.snapshot.time);
      assert.ok(
        drift <= 0.005,
        `${scenario.scenario}@${scenario.viewport} ${frame.id} 时间漂移 ${drift.toFixed(4)}s`
      );
    }
  }
});

test('feel gate 拒绝未通过的结论（不是空转）', () => {
  const rejected = [
    '### FEEL-X · combat 复评',
    '- 场景：combat',
    '- 日期：2026-10-28',
    '- 评审者：someone',
    '- 结论：不通过',
    '- 分数：4/10',
    '',
  ].join('\n');
  const report = checkFeelReview({ text: rejected });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((item) => item.includes('不是「通过」')));
});
