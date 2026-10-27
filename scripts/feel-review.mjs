#!/usr/bin/env node
// 打击感语义评审门：校验 docs/FEEL_REVIEW.md 是否有通过结论的评审条目。
// 机械层由 scripts/visual-check.mjs 独立负责；这里只回答「评审记录是否存在且通过」。
// 用法：node scripts/feel-review.mjs --check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCoverage, checkReviewDocument } from './lib/review-record.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REVIEW_FILE = 'docs/FEEL_REVIEW.md';
export const REQUIRED_SCENES = Object.freeze(['combat']);

export function checkFeelReview({ text = null, file = REVIEW_FILE, scenes = REQUIRED_SCENES } = {}) {
  let source = text;
  let resolved = file;
  if (source === null) {
    try {
      source = fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8');
    } catch {
      return {
        kind: 'feel',
        file: resolved,
        ok: false,
        missingFile: true,
        entries: [],
        errors: [`缺少评审记录文件：${REVIEW_FILE}（需要至少一条通过结论的打击感评审）`],
      };
    }
  }
  const document = checkReviewDocument(source, { kind: 'feel' });
  const coverage = checkCoverage(document.entries, { scenes });
  const errors = [...document.errors, ...coverage.errors];
  return {
    kind: 'feel',
    file: resolved,
    ok: errors.length === 0,
    entries: document.entries,
    coverage,
    errors,
  };
}

function parseArgs(argv) {
  const options = { file: REVIEW_FILE, json: false, help: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--file') options.file = argv[++i];
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function printReport(report) {
  console.log(`打击感评审 · ${report.file}`);
  if (report.entries.length) {
    for (const entry of report.entries) {
      const mark = entry.ok ? '✔' : '✘';
      console.log(`  ${mark} ${entry.title} · 场景 ${entry.scene || '—'} · ${entry.date || '—'} · ${entry.verdict} · ${entry.score || '—'}`);
    }
  }
  if (report.errors.length) {
    console.log('\n问题：');
    for (const error of report.errors) console.log(`  - ${error}`);
  }
  console.log(`\n结论：${report.ok ? '通过' : '未通过'}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/feel-review.mjs --check [--file docs/FEEL_REVIEW.md] [--json]');
    return 0;
  }
  const report = checkFeelReview({ file: options.file });
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.ok ? 0 : 1;
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`[feel-review] ${error.stack || error.message}`);
    process.exit(2);
  }
}
