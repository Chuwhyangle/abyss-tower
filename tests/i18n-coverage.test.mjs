// 双语覆盖率护栏（AC-026）：A 字典完整性 · B 引用完整性 · C UI 层零硬编码 ·
// D 数据层零缺译 · E 扫描器自测。
//
// 口径（见 docs/TECH_DESIGN.md §5.9「i18n 与本地化」）：
//   - 玩家可见文案一律来自 public/js/shared/i18n/ 的两份词典；
//   - 数据表自带中文只是 tData() 的不可达回退，英文界面不得落到中文；
//   - 静态外壳用 data-i18n* 标注；
//   - 扫描器自带自测 fixture，禁止用「空扫描 / 放宽白名单」过关。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';
import { DIFFICULTY_ORDER, ENEMIES, TOWERS, TOWER_ORDER } from '../public/js/shared/data.js';
import { FIXED_MAPS } from '../public/js/shared/maps/index.js';
import { MAP_MODIFIERS } from '../public/js/shared/mapgen.js';
import { DESTRUCTIBLE_TYPES } from '../public/js/shared/destructibles.js';
import { EVENTS, EVENT_ORDER } from '../public/js/shared/events.js';
import { MUTATIONS, MUTATION_ORDER } from '../public/js/shared/mutations.js';
import { SKIN_SET_ORDER, SKINS, SKIN_SETS } from '../public/js/shared/skins.js';
import { BOUNTY_PERIODS, BOUNTY_TEMPLATES, BOUNTY_TIERS } from '../public/js/shared/bounties.js';
import { SEASON_PASS_MILESTONES } from '../public/js/shared/season-pass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

// 允许清单：{ file, text, reason }。每项必须写明理由（≥8 字），总数 ≤5，
// 且必须真的命中一条现存违规——留一条过期白名单同样算失败。
export const HARDCODE_ALLOWLIST = [];

const ALLOWLIST_MAX = 5;
const ALLOWLIST_REASON_MIN = 8;

// en-US 里允许出现的 CJK：语言选择器里的母语名（切到英文后仍需显示中文语言名）。
const EN_CJK_ALLOW = new Set(['settings.languageZh']);

// ---------------------------------------------------------------------------
// 扫描器：JS 词法切分（跳过注释、识别字符串/模板/正则）+ 调用参数位置分析
// ---------------------------------------------------------------------------

// '${' 与它配对的 '}' 也要计入深度，否则模板插值会让括号栈失衡。
const OPENERS = new Set(['(', '[', '{', '${']);
const CLOSERS = new Set([')', ']', '}']);
// 这些 token 之后出现的 `/` 是正则字面量，而不是除号。
const NOT_EXPR_END_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'yield', 'await',
]);

function canEndExpression(token) {
  if (!token) return false;
  if (token.type === 'string' || token.type === 'template' || token.type === 'regex' || token.type === 'number') {
    return true;
  }
  if (token.type === 'ident') return !NOT_EXPR_END_KEYWORDS.has(token.value);
  if (token.type === 'punct') return [')', ']', '}'].includes(token.value);
  return false;
}

// 返回 token 列表：{ type, value, line }，type ∈ ident|number|string|template|regex|punct。
// 模板字面量拆成多段：静态片段是 template token，`${...}` 内部按代码继续扫描。
export function tokenizeJs(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const modes = [{ kind: 'code', interpolated: false, braceDepth: 0 }];
  let templateStart = -1;
  let templateBuf = '';
  let templateLine = 1;

  const push = (type, value, ln) => tokens.push({ type, value, line: ln });

  function flushTemplate() {
    if (templateStart >= 0) {
      push('template', templateBuf, templateLine);
      templateStart = -1;
      templateBuf = '';
    }
  }

  while (i < src.length) {
    const mode = modes[modes.length - 1];
    const c = src[i];
    const n = src[i + 1];

    if (mode.kind === 'template') {
      if (c === '\\') {
        templateBuf += c + (n ?? '');
        if (n === '\n') line++;
        i += 2;
        continue;
      }
      if (c === '`') {
        flushTemplate();
        push('punct', '`', line);
        modes.pop();
        i++;
        continue;
      }
      if (c === '$' && n === '{') {
        flushTemplate();
        push('punct', '${', line);
        modes.push({ kind: 'code', interpolated: true, braceDepth: 0 });
        i += 2;
        continue;
      }
      if (c === '\n') line++;
      templateBuf += c;
      i++;
      continue;
    }

    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    if (c === '`') {
      modes.push({ kind: 'template' });
      templateStart = i;
      templateLine = line;
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const ln = line;
      let buf = '';
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          buf += src[i] + (src[i + 1] ?? '');
          if (src[i + 1] === '\n') line++;
          i += 2;
          continue;
        }
        if (src[i] === '\n') line++;
        buf += src[i];
        i++;
      }
      i++;
      push('string', buf, ln);
      continue;
    }

    if (c === '/') {
      const prev = tokens[tokens.length - 1];
      if (!canEndExpression(prev)) {
        const ln = line;
        let buf = '';
        let inClass = false;
        i++;
        while (i < src.length) {
          const ch = src[i];
          if (ch === '\\') { buf += ch + (src[i + 1] ?? ''); i += 2; continue; }
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) { i++; break; }
          else if (ch === '\n') line++;
          buf += ch;
          i++;
        }
        while (i < src.length && /[a-z]/i.test(src[i])) { buf += src[i]; i++; }
        push('regex', buf, ln);
        continue;
      }
      push('punct', '/', line);
      i++;
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let v = '';
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) { v += src[i]; i++; }
      push('ident', v, line);
      continue;
    }

    if (/[0-9]/.test(c)) {
      let v = '';
      while (i < src.length && /[0-9a-fA-FxXoObB._n]/.test(src[i])) { v += src[i]; i++; }
      push('number', v, line);
      continue;
    }

    if (c === '{') {
      mode.braceDepth++;
      push('punct', '{', line);
      i++;
      continue;
    }
    if (c === '}') {
      if (mode.interpolated && mode.braceDepth === 0) {
        push('punct', '}', line);
        modes.pop();
        // 回到模板：后续静态片段重新开始累积，直到 ` 或下一个 ${。
        templateStart = i + 1;
        templateLine = line;
        templateBuf = '';
        i++;
        continue;
      }
      mode.braceDepth--;
      push('punct', '}', line);
      i++;
      continue;
    }
    push('punct', c, line);
    i++;
  }
  flushTemplate();
  return tokens;
}

// 给每个 token 标注它所在的调用帧与实参序号；返回 { entries, frames }。
// frames[].args[argIndex] 记录该位置上的字符串字面量（非字面量为 undefined）。
export function analyzeCalls(tokens) {
  const frames = []; // 打开中的调用栈
  const completed = []; // 已闭合的调用帧（键引用收集用，闭合后仍可读）
  const entries = [];
  let depth = 0;

  const calleeFor = (idx) => {
    const prev = tokens[idx - 1];
    if (!prev || prev.type !== 'ident') return null;
    const before = tokens[idx - 2];
    if (before && before.type === 'punct' && before.value === '.' && tokens[idx - 3]?.type === 'ident') {
      return `${tokens[idx - 3].value}.${prev.value}`;
    }
    return prev.value;
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.type === 'punct' && OPENERS.has(tok.value)) {
      depth++;
      if (tok.value === '(') {
        const frame = { callee: calleeFor(idx), argIndex: 0, depth, args: [] };
        frames.push(frame);
        completed.push(frame);
      }
      continue;
    }
    if (tok.type === 'punct' && CLOSERS.has(tok.value)) {
      if (tok.value === ')' && frames.length && frames[frames.length - 1].depth === depth) frames.pop();
      depth--;
      continue;
    }
    if (tok.type === 'punct' && tok.value === ',') {
      const frame = frames[frames.length - 1];
      if (frame && frame.depth === depth) frame.argIndex++;
      continue;
    }
    const frame = frames.length ? frames[frames.length - 1] : null;
    // 只记单引号/双引号字面量：模板字面量被拆成多段，拼不回原键（动态键由 D 组枚举兜底）。
    if (frame && tok.type === 'string') {
      frame.args[frame.argIndex] = tok.value;
    }
    entries.push({ token: tok, frame });
  }
  return { entries, frames: completed };
}

// 显式 fallback 实参：这些位置上的中文是「不可达回退」，不算硬编码。
const FALLBACK_ARG = {
  tOr: 1,
  tOrFor: 2,
  tData: 3,
};

function exemptionFor(callee, argIndex) {
  if (!callee) return null;
  if (callee.startsWith('console.')) return 'console';
  const fallbackArg = FALLBACK_ARG[callee];
  if (fallbackArg != null && argIndex === fallbackArg) return `fallback:${callee}`;
  return null;
}

// 扫描一段 JS 源码里所有含 CJK 的字符串/模板片段，标注豁免原因。
export function scanJsSource(src) {
  const { entries } = analyzeCalls(tokenizeJs(src));
  const violations = [];
  for (const { token, frame } of entries) {
    if (token.type !== 'string' && token.type !== 'template') continue;
    if (!CJK_RE.test(token.value)) continue;
    const callee = frame?.callee ?? null;
    const argIndex = frame?.argIndex ?? -1;
    violations.push({
      line: token.line,
      kind: token.type,
      callee,
      argIndex,
      exempt: exemptionFor(callee, argIndex),
      text: token.value,
    });
  }
  return violations;
}

// 收集 t/tOr/tFor/tOrFor/hasKey/tData 的键引用（字面量实参才可静态校验）。
export function collectKeyReferences(src) {
  const { frames } = analyzeCalls(tokenizeJs(src));
  const refs = [];
  const add = (key, line) => {
    if (typeof key === 'string' && key && !key.includes('${')) refs.push({ key, line });
  };
  for (const frame of frames) {
    const { callee, args } = frame;
    if (!callee) continue;
    if (callee === 't' || callee === 'tOr' || callee === 'hasKey') add(args[0], null);
    if (callee === 'tFor' || callee === 'tOrFor') add(args[1], null);
    if (callee === 'tData' && args[0] && args[1] && args[2]) {
      add(`data.${args[0]}.${args[1]}.${args[2]}`, null);
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// 扫描器：静态外壳 index.html（文本节点 / aria-label / title / placeholder）
// ---------------------------------------------------------------------------

const I18N_ATTR_FOR = {
  'aria-label': 'data-i18n-aria',
  title: 'data-i18n-title',
  placeholder: 'data-i18n-placeholder',
};

export function parseHtmlShell(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const nodes = [];
  const tagRe = /<(\/?[a-zA-Z][^>]*)>/g;
  let match;
  let textStart = 0;
  let lastTag = null;
  while ((match = tagRe.exec(cleaned))) {
    const between = cleaned.slice(textStart, match.index);
    if (between.trim()) nodes.push({ kind: 'text', text: between.trim(), tag: lastTag });
    // 闭合标签不携带属性；只有开标签进入属性解析。
    const raw = match[1].trim();
    const isClosing = raw.startsWith('/');
    if (!isClosing) {
      const attrs = {};
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
      let attr;
      while ((attr = attrRe.exec(raw))) attrs[attr[1]] = attr[2];
      lastTag = { name: raw.split(/[\s/>]/)[0], attrs };
      nodes.push({ kind: 'tag', tag: lastTag });
    }
    textStart = tagRe.lastIndex;
  }
  const tail = cleaned.slice(textStart);
  if (tail.trim()) nodes.push({ kind: 'text', text: tail.trim(), tag: lastTag });
  return nodes;
}

// 返回 index.html 的硬编码/缺标注问题；dictionary 用于校验文本与 zh 词典逐字一致。
export function scanHtmlShell(html, dictionary) {
  const problems = [];
  for (const node of parseHtmlShell(html)) {
    if (node.kind === 'text') {
      if (!CJK_RE.test(node.text)) continue;
      // <title> 由 applyTranslations 直接写 document.title = t('app.title')，不需要 data-i18n。
      if (node.tag?.name === 'title') continue;
      const key = node.tag?.attrs?.['data-i18n'];
      if (!key) {
        problems.push({ reason: 'missing-data-i18n', text: node.text, tag: node.tag?.name });
        continue;
      }
      if (dictionary[key] !== node.text) {
        problems.push({ reason: 'text-drift', key, text: node.text, zh: dictionary[key] });
      }
      continue;
    }
    for (const [attr, i18nAttr] of Object.entries(I18N_ATTR_FOR)) {
      const value = node.tag.attrs?.[attr];
      if (!value || !CJK_RE.test(value)) continue;
      const key = node.tag.attrs?.[i18nAttr];
      if (!key) {
        problems.push({ reason: `missing-${i18nAttr}`, attr, text: value, tag: node.tag.name });
        continue;
      }
      if (dictionary[key] !== value) {
        problems.push({ reason: `text-drift:${attr}`, key, text: value, zh: dictionary[key] });
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 文件枚举
// ---------------------------------------------------------------------------

function listJsFiles(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [relDir];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// UI 层扫描面：所有会渲染 DOM 的模块（Canvas 渲染层与 shared/ 纯数据不在其内）。
export const UI_SCAN_FILES = (() => {
  const files = new Set([
    ...listJsFiles('public/js/ui'),
    ...listJsFiles('public/js/app'),
    ...fs
      .readdirSync(path.join(ROOT, 'public/js'))
      .filter((name) => name.endsWith('-ui.js'))
      .map((name) => `public/js/${name}`),
  ]);
  for (const extra of [
    'public/js/api.js',
    'public/js/settings.js',
    'public/js/audio.js',
    'public/js/share-card.js',
    'public/js/ui.js',
    'public/js/game-app.js',
  ]) {
    files.add(extra);
  }
  // public/js/ui.js 已经在 ui/ 的兄弟目录里，单独补入（上面已加）。
  return [...files].sort();
})();

const ALL_JS_FILES = listJsFiles('public/js').sort();

// ---------------------------------------------------------------------------
// A 字典完整性
// ---------------------------------------------------------------------------

test('A1 两种语言的键集合完全一致', () => {
  const zhKeys = Object.keys(zhCN).sort();
  const enKeys = Object.keys(enUS).sort();
  const missingInEn = zhKeys.filter((key) => !(key in enUS));
  const missingInZh = enKeys.filter((key) => !(key in zhCN));
  assert.deepEqual(missingInEn, [], `en-US 缺少键：${missingInEn.join(', ')}`);
  assert.deepEqual(missingInZh, [], `zh-CN 缺少键：${missingInZh.join(', ')}`);
});

test('A2 所有译文都是非空字符串', () => {
  const empty = [];
  for (const [locale, dict] of [['zh-CN', zhCN], ['en-US', enUS]]) {
    for (const [key, value] of Object.entries(dict)) {
      if (typeof value !== 'string' || value.trim() === '') empty.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(empty, [], `空译文：${empty.join(', ')}`);
});

test('A3 en-US 不含中文（语言名白名单除外）', () => {
  const leaked = Object.entries(enUS)
    .filter(([key, value]) => CJK_RE.test(value) && !EN_CJK_ALLOW.has(key))
    .map(([key]) => key);
  assert.deepEqual(leaked, [], `en-US 仍含中文：${leaked.join(', ')}`);
});

test('A4 中文键的英文值不得是原文复制', () => {
  const copied = Object.entries(zhCN)
    .filter(([key, value]) => CJK_RE.test(value) && !EN_CJK_ALLOW.has(key) && enUS[key] === value)
    .map(([key]) => key);
  assert.deepEqual(copied, [], `英文值与中文逐字相同（疑似未翻译）：${copied.join(', ')}`);
});

// ---------------------------------------------------------------------------
// B 引用完整性：代码里引用的键、index.html 标注的键都必须存在
// ---------------------------------------------------------------------------

test('B1 JS 里 t/tOr/tFor/hasKey/tData 引用的键在两份词典都存在', () => {
  const missing = [];
  let refCount = 0;
  for (const file of ALL_JS_FILES) {
    for (const ref of collectKeyReferences(readSource(file))) {
      refCount += 1;
      for (const [locale, dict] of [['zh-CN', zhCN], ['en-US', enUS]]) {
        if (!Object.prototype.hasOwnProperty.call(dict, ref.key)) {
          missing.push(`${locale} ${file}: ${ref.key}`);
        }
      }
    }
  }
  assert.deepEqual(missing, [], `缺失键：\n${missing.join('\n')}`);
  assert.ok(refCount > 400, `键引用扫描只找到 ${refCount} 处，扫描器可能已失效`);
});

test('B2 index.html 的 data-i18n* 键在两份词典都存在', () => {
  const html = readSource('public/index.html');
  const keys = new Set();
  for (const tag of parseHtmlShell(html)) {
    if (tag.kind !== 'tag') continue;
    for (const attr of ['data-i18n', 'data-i18n-title', 'data-i18n-aria', 'data-i18n-placeholder']) {
      const value = tag.tag.attrs?.[attr];
      if (value) keys.add(value);
    }
  }
  assert.ok(keys.size >= 60, `index.html 只有 ${keys.size} 个 data-i18n* 标注，静态外壳标注不足`);
  const missing = [];
  for (const key of keys) {
    for (const [locale, dict] of [['zh-CN', zhCN], ['en-US', enUS]]) {
      if (!Object.prototype.hasOwnProperty.call(dict, key)) missing.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(missing, [], `index.html 标注缺键：${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// C UI 层零硬编码
// ---------------------------------------------------------------------------

function matchesAllowlist(file, text) {
  return HARDCODE_ALLOWLIST.some((item) => item.file === file && text.includes(item.text));
}

test('C1 UI 层源码不含玩家可见中文（fallback 实参与 console 除外）', () => {
  const violations = [];
  for (const file of UI_SCAN_FILES) {
    for (const hit of scanJsSource(readSource(file))) {
      if (hit.exempt) continue;
      if (matchesAllowlist(file, hit.text)) continue;
      violations.push(
        `${file}:${hit.line} ${hit.kind}${hit.callee ? `→${hit.callee}#${hit.argIndex}` : ''} ${JSON.stringify(hit.text.slice(0, 60))}`
      );
    }
  }
  assert.deepEqual(violations, [], `UI 层仍有硬编码中文（${violations.length} 处）：\n${violations.join('\n')}`);
  assert.ok(UI_SCAN_FILES.length >= 35, `扫描面只有 ${UI_SCAN_FILES.length} 个文件，疑似扫描面被缩小`);
});

test('C2 允许清单受控：≤5 项、每项理由 ≥8 字、不得留过期项', () => {
  assert.ok(
    HARDCODE_ALLOWLIST.length <= ALLOWLIST_MAX,
    `允许清单 ${HARDCODE_ALLOWLIST.length} 项，超过上限 ${ALLOWLIST_MAX}`
  );
  for (const item of HARDCODE_ALLOWLIST) {
    assert.ok(item.file && item.text, '允许清单每项必须有 file 与 text');
    assert.ok(
      typeof item.reason === 'string' && [...item.reason.trim()].length >= ALLOWLIST_REASON_MIN,
      `允许清单理由过短：${item.file} ${item.text}`
    );
    const hits = scanJsSource(readSource(item.file));
    assert.ok(
      hits.some((hit) => hit.text.includes(item.text)),
      `过期白名单：${item.file} 已不再包含「${item.text}」，请删除该条`
    );
  }
});

test('C3 index.html 文本节点与 aria-label/title/placeholder 均已标注且与词典一致', () => {
  const problems = scanHtmlShell(readSource('public/index.html'), zhCN);
  assert.deepEqual(
    problems,
    [],
    `index.html 存在未标注或与词典不一致的文案：\n${JSON.stringify(problems, null, 2)}`
  );
});

// ---------------------------------------------------------------------------
// D 数据层零缺译（枚举式）
// ---------------------------------------------------------------------------

function assertDataKeys(entries) {
  const missing = [];
  const untranslated = [];
  for (const [key, label] of entries) {
    for (const [locale, dict] of [['zh-CN', zhCN], ['en-US', enUS]]) {
      const value = dict[key];
      if (typeof value !== 'string' || value.trim() === '') {
        missing.push(`${locale} ${key} (${label})`);
        continue;
      }
      if (locale === 'en-US') {
        if (CJK_RE.test(value)) untranslated.push(`${key} (${label}) 仍含中文`);
        if (value === zhCN[key]) untranslated.push(`${key} (${label}) 英文与中文相同`);
      }
    }
  }
  assert.deepEqual(missing, [], `数据层缺键（${missing.length} 条）：\n${missing.join('\n')}`);
  assert.deepEqual(untranslated, [], `数据层译文未翻译：\n${untranslated.join('\n')}`);
}

test('D1 既有数据组（塔/敌人/难度/地图/词缀/可破坏物）译名齐全', () => {
  const entries = [];
  for (const id of TOWER_ORDER) entries.push([`data.tower.${id}.name`, `tower ${TOWERS[id].name}`]);
  for (const enemy of Object.values(ENEMIES)) entries.push([`data.enemy.${enemy.id}.name`, `enemy ${enemy.name}`]);
  for (const id of DIFFICULTY_ORDER) {
    entries.push([`data.difficulty.${id}.name`, `difficulty ${id}`]);
    entries.push([`data.difficulty.${id}.desc`, `difficulty ${id}`]);
  }
  for (const map of Object.values(FIXED_MAPS)) {
    entries.push([`data.map.${map.id}.name`, `map ${map.name}`]);
    entries.push([`data.map.${map.id}.desc`, `map ${map.name}`]);
  }
  for (const modifier of MAP_MODIFIERS) {
    entries.push([`data.modifier.${modifier.id}.name`, `modifier ${modifier.name}`]);
    entries.push([`data.modifier.${modifier.id}.desc`, `modifier ${modifier.name}`]);
  }
  for (const type of DESTRUCTIBLE_TYPES) {
    entries.push([`data.destructible.${type.id}.name`, `destructible ${type.name}`]);
    entries.push([`data.destructible.${type.id}.desc`, `destructible ${type.name}`]);
  }
  assertDataKeys(entries);
});

test('D2 事件与事件选项译名齐全（12 事件 / 36 选项）', () => {
  const entries = [];
  let optionCount = 0;
  assert.equal(EVENT_ORDER.length, 12, '事件数量与验收口径不一致');
  for (const eventId of EVENT_ORDER) {
    const event = EVENTS[eventId];
    entries.push([`data.event.${eventId}.name`, `event ${event.name}`]);
    entries.push([`data.event.${eventId}.desc`, `event ${event.name}`]);
    for (const option of event.options) {
      optionCount += 1;
      entries.push([`data.event.${eventId}.option.${option.id}.name`, `option ${option.name}`]);
      entries.push([`data.event.${eventId}.option.${option.id}.desc`, `option ${option.name}`]);
    }
  }
  assert.equal(optionCount, 36, '事件选项数量与验收口径不一致');
  assertDataKeys(entries);
});

test('D3 变异译名齐全（5 个）', () => {
  const entries = [];
  assert.equal(MUTATION_ORDER.length, 5, '变异数量与验收口径不一致');
  for (const id of MUTATION_ORDER) {
    entries.push([`data.mutation.${id}.name`, `mutation ${MUTATIONS[id].name}`]);
    entries.push([`data.mutation.${id}.desc`, `mutation ${MUTATIONS[id].name}`]);
  }
  assertDataKeys(entries);
});

test('D4 皮肤与套装译名齐全（8 皮肤 / 2 套装）', () => {
  const entries = [];
  const skinIds = Object.keys(SKINS);
  assert.equal(skinIds.length, 8, '皮肤数量与验收口径不一致');
  for (const id of skinIds) entries.push([`data.skin.${id}.name`, `skin ${SKINS[id].name}`]);
  assert.equal(SKIN_SET_ORDER.length, 2, '皮肤套装数量与验收口径不一致');
  for (const id of SKIN_SET_ORDER) entries.push([`data.skinSet.${id}.name`, `skin set ${SKIN_SETS[id].name}`]);
  assertDataKeys(entries);
});

test('D5 悬赏模板/档位/周期译名齐全（14 模板 + 3 档 + 3 周期）', () => {
  const entries = [];
  assert.equal(BOUNTY_TEMPLATES.length, 14, '悬赏模板数量与验收口径不一致');
  for (const template of BOUNTY_TEMPLATES) {
    entries.push([`data.bounty.${template.key}.title`, `bounty ${template.title}`]);
    entries.push([`data.bounty.${template.key}.desc`, `bounty ${template.title}`]);
  }
  assert.equal(BOUNTY_TIERS.length, 3, '悬赏档位数量与验收口径不一致');
  for (const tier of BOUNTY_TIERS) entries.push([`data.bountyTier.${tier}.name`, `bounty tier ${tier}`]);
  assert.equal(BOUNTY_PERIODS.length, 3, '悬赏周期数量与验收口径不一致');
  for (const period of BOUNTY_PERIODS) entries.push([`data.bountyPeriod.${period}.name`, `bounty period ${period}`]);
  assertDataKeys(entries);
});

test('D6 赛季通行证里程碑与积分来源译名齐全（5 里程碑 + 4 来源）', () => {
  const entries = [];
  assert.equal(SEASON_PASS_MILESTONES.length, 5, '赛季通行证里程碑数量与验收口径不一致');
  for (const milestone of SEASON_PASS_MILESTONES) {
    entries.push([`data.seasonPass.${milestone.id}.name`, `milestone ${milestone.name}`]);
    entries.push([`data.seasonPass.${milestone.id}.desc`, `milestone ${milestone.name}`]);
  }
  const sources = ['match', 'bounty', 'achievement', 'achievementBonus'];
  for (const source of sources) entries.push([`data.seasonPassSource.${source}.name`, `season pass source ${source}`]);
  assertDataKeys(entries);
});

// ---------------------------------------------------------------------------
// E 扫描器自测：fixture 必须在预期位置命中、在预期位置放过
// ---------------------------------------------------------------------------

const JS_FIXTURE = [
  '// 注释里的中文不算硬编码', // 1
  "const a = '硬编码中文';", // 2 → 命中
  "const b = t('ui.fixture.allowed');", // 3 → 键引用
  "const c = tOr('ui.fixture.key', '回退文案');", // 4 → fallback 豁免
  '/* 块注释的中文', // 5
  '   续行中文 */', // 6
  'const d = `模板 ${value} 静态中文`;', // 7 → 命中（模板静态片段）
  "console.warn('日志里的中文');", // 8 → console 豁免
  'const re = /中文正则/g;', // 9 → 正则不是字符串，不命中
  "const e = 'it\\'s ascii';", // 10 → 无 CJK
  'const f = tData(\'tower\', \'arrow\', \'name\', \'回退名\');', // 11 → fallback 豁免 + 数据键引用
  "const g = 'a/b' + '硬编码第二处';", // 12 → 命中
].join('\n');

test('E1 词法扫描器：注释/console/fallback/正则正确放过，字符串与模板静态片段正确命中', () => {
  const hits = scanJsSource(JS_FIXTURE);
  const flagged = hits.filter((hit) => !hit.exempt).map((hit) => hit.line);
  const exempted = hits.filter((hit) => hit.exempt).map((hit) => hit.line);
  // 第 7 行是模板：`${}` 前后的静态片段各是一段命中。
  assert.deepEqual(flagged, [2, 7, 7, 12], `非豁免命中行不符：${JSON.stringify(hits, null, 2)}`);
  assert.deepEqual(exempted, [4, 8, 11], `豁免命中行不符：${JSON.stringify(hits.filter((h) => h.exempt), null, 2)}`);
  // 模板插值表达式内部仍是代码：值为中文的字符串照样命中。
  const interpolated = scanJsSource('const x = `前缀 ${"插值中文"} 后缀`;');
  assert.deepEqual(
    interpolated.filter((hit) => !hit.exempt).map((hit) => hit.kind),
    ['template', 'string', 'template'],
    '模板插值未被识别为代码'
  );
});

test('E2 键引用收集器：识别字面量键，跳过模板键与非法位置', () => {
  const refs = collectKeyReferences(JS_FIXTURE).map((ref) => ref.key);
  assert.ok(refs.includes('ui.fixture.allowed'), 't() 的键未收集');
  assert.ok(refs.includes('ui.fixture.key'), 'tOr() 的键未收集');
  assert.ok(refs.includes('data.tower.arrow.name'), 'tData() 的合成键未收集');
  const dynamic = collectKeyReferences('const k = tOr(`data.event.${id}.name`, fallback);');
  assert.deepEqual(dynamic, [], '模板键不应被当成可静态校验的字面量');
});

test('E3 静态外壳扫描器：未标注/文本漂移/属性缺标注都能命中', () => {
  const dictionary = { 'fixture.title': '标题', 'fixture.label': '标签' };
  const html = [
    '<h2 data-i18n="fixture.title">标题</h2>',
    '<h2>未标注中文</h2>',
    '<h2 data-i18n="fixture.title">措辞漂移</h2>',
    '<button aria-label="标签" data-i18n-aria="fixture.label"></button>',
    '<button aria-label="缺标注"></button>',
    '<input placeholder="缺标注占位" />',
    '<!-- 注释里的中文 -->',
  ].join('\n');
  const problems = scanHtmlShell(html, dictionary);
  const reasons = problems.map((problem) => problem.reason).sort();
  assert.deepEqual(reasons, ['missing-data-i18n', 'missing-data-i18n-aria', 'missing-data-i18n-placeholder', 'text-drift']);
  assert.equal(problems.length, 4, `静态外壳问题条数不符：${JSON.stringify(problems, null, 2)}`);
});

test('E4 扫描面非空：UI 文件、JS 文件与 index.html 都真实存在', () => {
  assert.ok(UI_SCAN_FILES.includes('public/js/auth-ui.js'), '扫描面缺少 auth-ui.js');
  assert.ok(UI_SCAN_FILES.includes('public/js/ui/modals.js'), '扫描面缺少 ui/modals.js');
  assert.ok(UI_SCAN_FILES.includes('public/js/app/combat.js'), '扫描面缺少 app/combat.js');
  assert.ok(ALL_JS_FILES.length > 100, `全量 JS 文件只有 ${ALL_JS_FILES.length} 个`);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/index.html')), '缺少 public/index.html');
});
