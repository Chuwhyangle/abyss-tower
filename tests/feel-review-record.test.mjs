// 打击感评审记录自证：docs/FEEL_REVIEW.md 必须解析出覆盖 combat 的通过条目，
// 且条目引用的前后对照图真实存在；删掉条目 / 指向缺图时必须失败（防空壳记录空转通过）。
// 机械层（scripts/visual-check.mjs --suite feel）不在这里重复，测试只守「记录本身是不是真的」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFeelReview } from '../scripts/feel-review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_FILE = 'docs/FEEL_REVIEW.md';
const MIN_ARTIFACT_BYTES = 1024;

const BEFORE_AFTER_IMAGE = 'docs/reviews/feel-review-before-after.png';
const AFTER_CONTACT_SHEET = 'docs/reviews/feel-after/contact-sheet.png';
const AFTER_MANIFEST = 'docs/reviews/feel-after/manifest.json';

function readReview() {
  return fs.readFileSync(path.join(ROOT, REVIEW_FILE), 'utf8');
}

// 记录里以 markdown 图片语法内嵌的相对路径（相对 docs/）。
// 绝对路径（/tmp）只作为过程记录写在代码块里，不参与存在性判定。
export function embeddedImageRefs(markdown) {
  const refs = new Set();
  const pattern = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = pattern.exec(markdown))) {
    const ref = match[1];
    if (!/^[a-z]+:/i.test(ref) && !path.isAbsolute(ref)) refs.add(ref);
  }
  return [...refs];
}

export function artifactProblems(markdown, root = ROOT) {
  const problems = [];
  const refs = embeddedImageRefs(markdown);
  if (!refs.length) problems.push('记录没有内嵌任何 before/after 对照图');
  for (const ref of refs) {
    const abs = path.join(root, 'docs', ref);
    let stat = null;
    try {
      stat = fs.statSync(abs);
    } catch {
      problems.push(`记录引用的图片不存在：${ref}`);
      continue;
    }
    if (stat.size < MIN_ARTIFACT_BYTES) {
      problems.push(`记录引用的图片过小（${stat.size}B < ${MIN_ARTIFACT_BYTES}B）：${ref}`);
    }
  }
  return problems;
}

function assertArtifact(file) {
  const abs = path.join(ROOT, file);
  assert.ok(fs.existsSync(abs), `缺少产物：${file}`);
  const size = fs.statSync(abs).size;
  assert.ok(size >= MIN_ARTIFACT_BYTES, `${file} 只有 ${size}B，达不到真实截图的下限`);
}

test('docs/FEEL_REVIEW.md 至少有一条覆盖 combat 的通过评审', () => {
  const report = checkFeelReview();
  assert.equal(report.ok, true, `评审记录未通过：${report.errors.join('；')}`);
  assert.ok(report.entries.length >= 1, '必须存在至少一条 ### 评审条目');

  const combatEntry = report.entries.find((entry) => (entry.scene || '').includes('combat'));
  assert.ok(combatEntry, '至少一条条目的「场景」必须包含 combat');
  assert.equal(combatEntry.verdict, 'pass', '覆盖 combat 的条目结论必须是「通过」');
  assert.ok(combatEntry.reviewer, '条目必须写明评审者');
  assert.match(combatEntry.date, /^\d{4}-\d{2}-\d{2}$/, '条目的日期必须是 YYYY-MM-DD');
  assert.match(combatEntry.score, /^\d+(?:\.\d+)?\/10$/, '条目的分数必须是 n/10');
});

test('评审过程写明采集命令、两侧 commit、日期与隔离方式', () => {
  const text = readReview();
  assert.match(text, /^## 评审过程/m, '必须存在「## 评审过程」一节');
  const process = text.slice(text.indexOf('## 评审过程'));
  assert.match(process, /visual-scenes\.mjs/, '评审过程必须写明采集入口');
  assert.match(process, /quality high/, '评审过程必须写明采集画质');
  assert.match(process, /3b8e1fd/, '评审过程必须写明 before 侧 commit');
  assert.match(process, /fa22c6a/, '评审过程必须写明 after 侧 commit');
  assert.match(process, /YYYY-MM-DD|\d{4}-\d{2}-\d{2}/, '评审过程必须写明日期');
  assert.match(process, /隔离/, '评审过程必须写明评审者的上下文隔离方式');
});

test('前后对照图与 after 采集产物真实存在且非占位', () => {
  assertArtifact(BEFORE_AFTER_IMAGE);
  assertArtifact(AFTER_CONTACT_SHEET);
  assertArtifact(AFTER_MANIFEST);
  assert.deepEqual(artifactProblems(readReview()), [], '记录内嵌的对照图必须都存在');
});

test('after 采集清单覆盖 combat 的桌面与移动视口', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, AFTER_MANIFEST), 'utf8'));
  const scenes = (manifest.scenes || []).map((scene) => `${scene.scene}@${scene.viewport}`);
  assert.ok(scenes.includes('combat@desktop'), 'after 清单缺少 combat@desktop');
  assert.ok(scenes.includes('combat@mobile-landscape'), 'after 清单缺少 combat@mobile-landscape');
  assert.ok(manifest.commit, 'after 清单必须记录采集时的 commit');
});

test('反向断言：删掉条目后检查必须失败（不是空壳通过）', () => {
  const text = readReview();
  const headerIndex = text.indexOf('## 评审记录');
  assert.ok(headerIndex >= 0, '必须存在「## 评审记录」一节');
  const withoutEntries = `${text.slice(0, headerIndex)}## 评审记录\n\n（已删除）\n`;
  const report = checkFeelReview({ text: withoutEntries });
  assert.equal(report.ok, false, '没有评审条目时不能通过');
  assert.ok(report.errors.some((error) => error.includes('缺少评审条目')));
});

test('反向断言：指向不存在的对照图时必须报缺图', () => {
  const broken = '### FEEL-404 · 缺图\n\n![before/after](reviews/definitely-missing.png)\n';
  const problems = artifactProblems(broken);
  assert.ok(problems.some((problem) => problem.includes('不存在')), '缺图必须被拒绝');
});

test('反向断言：对照图过小时必须报占位图', () => {
  const tmpRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'feel-review-'));
  fs.mkdirSync(path.join(tmpRoot, 'docs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'reviews', 'tiny.png'), Buffer.alloc(16));
  const text = '### FEEL-001 · 占位\n\n![before/after](reviews/tiny.png)\n';
  const problems = artifactProblems(text, tmpRoot);
  assert.ok(problems.some((problem) => problem.includes('过小')), '占位图必须被拒绝');
});
