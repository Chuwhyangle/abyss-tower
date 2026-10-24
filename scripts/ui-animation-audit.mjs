#!/usr/bin/env node
// UI 动效预算审计：静态扫描 CSS，标记触发布局的动画属性与超时动效。零第三方依赖，只读 CSS。
//
// 预算（BUDGET）：
// 1) 任何 @keyframes / transition 都不得驱动 layout 属性（top/left/width/height/margin/padding…）；
// 2) 一次性动效 ≤800ms；确需更久必须在上一行或同行写
//    `/* ui-motion-budget: allow-long — 理由 *\/`，无理由的豁免视为违规；
// 3) 无限循环动效（`infinite`）只允许 transform/opacity 这类合成属性，且总数 ≤4；
//    循环动效的时长不设上限（循环成本取决于每帧属性，而不是单次时长）；
// 4) 必须存在 prefers-reduced-motion 覆盖，把 animation / transition 压到 ≤1ms。
//
// 用法：node scripts/ui-animation-audit.mjs [css 文件...]（默认 public/styles.css）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET = {
  maxFiniteMs: 800,
  maxInfiniteAnimations: 4,
  compositorProperties: new Set(['transform', 'translate', 'scale', 'rotate', 'opacity']),
  maxReducedMotionMs: 1,
};

const LAYOUT_PROPERTIES = new Set([
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-block',
  'inset-inline',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-columns',
  'grid-auto-rows',
  'gap',
  'row-gap',
  'column-gap',
  'justify-content',
  'align-items',
  'align-content',
  'vertical-align',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
]);

export function isLayoutProperty(property) {
  if (LAYOUT_PROPERTIES.has(property)) return true;
  return /^(margin|padding|inset)(-|$)/.test(property)
    || /^(min-|max-)?(width|height)$/.test(property)
    || /^border(-(top|right|bottom|left))?-width$/.test(property)
    || /^(grid-template|grid-auto)-/.test(property)
    || /^(justify|align)-(content|items|self)$/.test(property);
}

// 把注释替换成等长空白，保留换行，行号不漂移。
export function stripComments(source) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      out += char;
      if (char === '\\') {
        out += source[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      out += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        out += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        out += '  ';
        index += 2;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function splitTopLevel(value, separator = ',') {
  const parts = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function tokenize(value) {
  const tokens = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function lineAt(text, baseLine, offset) {
  let line = baseLine;
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function splitDeclaration(raw) {
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const property = raw.slice(0, colon).trim().toLowerCase();
  const value = raw.slice(colon + 1).trim();
  if (!property || property.startsWith('@') || property.startsWith('/*')) return null;
  return { property, value };
}

// 解析成块树，每个块保留自己的声明（含行号）；keyframes 的步骤是普通子块。
export function parseCss(source) {
  const clean = stripComments(source);
  const blocks = [];
  const stack = [];
  let buffer = '';
  let bufferLine = 1;
  let line = 1;

  const append = (char) => {
    if (buffer === '') bufferLine = line;
    buffer += char;
  };

  const flush = (owner) => {
    const text = buffer;
    if (owner && text.trim()) {
      let cursor = 0;
      for (const part of text.split(';')) {
        const start = cursor;
        cursor += part.length + 1;
        const raw = part.trim();
        if (!raw) continue;
        const declaration = splitDeclaration(raw);
        if (!declaration) continue;
        const leading = part.length - part.trimStart().length;
        owner.declarations.push({
          ...declaration,
          line: lineAt(text, bufferLine, start + leading),
        });
      }
    }
    buffer = '';
  };

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '\n') {
      if (buffer === '') bufferLine = line;
      buffer += char;
      line += 1;
      continue;
    }
    if (char === '{') {
      const leading = buffer.length - buffer.trimStart().length;
      const block = {
        prelude: buffer.trim(),
        line: lineAt(buffer, bufferLine, leading),
        declarations: [],
        parent: stack.length ? stack[stack.length - 1] : null,
      };
      blocks.push(block);
      stack.push(block);
      buffer = '';
      continue;
    }
    if (char === '}') {
      flush(stack.pop());
      buffer = '';
      continue;
    }
    append(char);
  }
  return blocks;
}

function ancestors(block) {
  const chain = [];
  let current = block.parent;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  return chain;
}

function keyframesName(block) {
  for (const candidate of [block, ...ancestors(block)]) {
    const match = /^@keyframes\s+([\w-]+)/.exec(candidate.prelude);
    if (match) return match[1];
  }
  return null;
}

function isKeyframeStep(block) {
  return keyframesName(block) !== null
    && !/^@keyframes\b/.test(block.prelude)
    && !/^@media\b/.test(block.prelude);
}

function collectDeclarations(blocks, root) {
  const collected = [...root.declarations];
  for (const block of blocks) {
    if (block === root) continue;
    let parent = block.parent;
    while (parent) {
      if (parent === root) {
        collected.push(...block.declarations);
        break;
      }
      parent = parent.parent;
    }
  }
  return collected;
}

function timeToMs(token, durationTokens) {
  if (!token) return null;
  let value = token.trim();
  const variable = /^var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)$/.exec(value);
  if (variable) {
    const mapped = durationTokens.get(variable[1]);
    if (mapped != null) value = mapped.trim();
    else if (variable[2]) value = variable[2].trim();
    else return null;
  }
  const match = /^(-?(?:\d+|\d*\.\d+))(ms|s)$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2].toLowerCase() === 's' ? amount * 1000 : amount;
}

function ownDurationTokens(blocks) {
  const tokens = new Map();
  for (const block of blocks) {
    for (const declaration of block.declarations) {
      if (declaration.property.startsWith('--duration-')) {
        tokens.set(declaration.property, declaration.value);
      }
    }
  }
  return tokens;
}

function markerAllows(sourceLines, line) {
  const candidates = [sourceLines[line - 1] ?? ''];
  for (let index = line - 2; index >= 0; index -= 1) {
    const text = sourceLines[index].trim();
    if (!text) continue;
    candidates.push(sourceLines[index]);
    break;
  }
  const marker = /ui-motion-budget:\s*allow-long\b([^\n]*)/;
  for (const candidate of candidates) {
    const match = marker.exec(candidate);
    if (!match) continue;
    const rest = match[1].replace(/\*\/.*$/, '').trim();
    const reason = /^[—–-]\s*(\S.*)$/.exec(rest);
    return { allowed: true, reason: reason ? reason[1].trim() : '' };
  }
  return { allowed: false, reason: '' };
}

function report(violations, rule, line, property, message) {
  violations.push({ rule, line, property, message });
}

export function auditCss(source, options = {}) {
  const budget = { ...BUDGET, ...options };
  const blocks = parseCss(source);
  const sourceLines = source.split('\n');
  const durationTokens = ownDurationTokens(blocks);
  const violations = [];

  const keyframeNames = new Set();
  for (const block of blocks) {
    const match = /^@keyframes\s+([\w-]+)/.exec(block.prelude);
    if (match) keyframeNames.add(match[1]);
  }

  // 1) keyframes 里的 layout 属性：无论是否被引用都不允许。
  for (const block of blocks) {
    if (!isKeyframeStep(block)) continue;
    const name = keyframesName(block);
    for (const declaration of block.declarations) {
      if (!isLayoutProperty(declaration.property)) continue;
      report(
        violations,
        'layout-animation',
        declaration.line,
        declaration.property,
        `@keyframes ${name} 动画驱动了 layout 属性，改用 transform/opacity`
      );
    }
  }

  // 2) 解析引用：animation 简写 / transition 简写与长写。
  const animationRefs = [];
  for (const block of blocks) {
    if (keyframesName(block) !== null) continue;
    let animationName = null;
    let animationDuration = null;
    let animationIteration = null;
    for (const declaration of block.declarations) {
      if (declaration.property === 'animation-name') animationName = declaration.value;
      else if (declaration.property === 'animation-duration') animationDuration = declaration.value;
      else if (declaration.property === 'animation-iteration-count') animationIteration = declaration.value;
    }
    for (const declaration of block.declarations) {
      if (declaration.property === 'animation') {
        for (const item of splitTopLevel(declaration.value)) {
          const tokens = tokenize(item);
          const name = tokens.find((token) => keyframeNames.has(token)) ?? null;
          if (!name) continue;
          const times = tokens.map((token) => timeToMs(token, durationTokens)).filter((value) => value !== null);
          animationRefs.push({
            name,
            line: declaration.line,
            durationMs: times.length ? times[0] : null,
            infinite: tokens.includes('infinite'),
            source: declaration,
          });
        }
      } else if (declaration.property === 'animation-name') {
        for (const name of splitTopLevel(declaration.value).map((part) => part.trim())) {
          if (!keyframeNames.has(name)) continue;
          animationRefs.push({
            name,
            line: declaration.line,
            durationMs: timeToMs(animationDuration, durationTokens),
            infinite: /infinite/.test(animationIteration ?? ''),
            source: declaration,
          });
        }
      }
    }
  }

  // 3) 一次性动效超时（>maxFiniteMs）；infinite 不受时长约束。
  for (const reference of animationRefs) {
    if (reference.infinite) continue;
    if (reference.durationMs === null || reference.durationMs <= budget.maxFiniteMs) continue;
    const marker = markerAllows(sourceLines, reference.line);
    if (marker.allowed && marker.reason) continue;
    const reason = marker.allowed ? '（预算豁免缺少理由）' : '';
    report(
      violations,
      'long-animation',
      reference.line,
      'animation',
      `@keyframes ${reference.name} 时长 ${reference.durationMs}ms 超过 ${budget.maxFiniteMs}ms 预算${reason}`
    );
  }

  // 4) 无限循环动效只允许合成属性，并受总数约束。
  const infiniteRefs = animationRefs.filter((reference) => reference.infinite);
  for (const reference of infiniteRefs) {
    for (const block of blocks) {
      if (!isKeyframeStep(block) || keyframesName(block) !== reference.name) continue;
      for (const declaration of block.declarations) {
        if (budget.compositorProperties.has(declaration.property)) continue;
        report(
          violations,
          'paint-infinite',
          declaration.line,
          declaration.property,
          `@keyframes ${reference.name} 无限循环却驱动 ${declaration.property}（每帧重绘），只允许 transform/opacity`
        );
      }
    }
  }
  for (const reference of infiniteRefs.slice(budget.maxInfiniteAnimations)) {
    report(
      violations,
      'infinite-budget',
      reference.line,
      'animation',
      `无限循环动效共 ${infiniteRefs.length} 个，超过每帧 ${budget.maxInfiniteAnimations} 个预算`
    );
  }

  // 5) transition：layout 属性与超时。
  for (const block of blocks) {
    if (keyframesName(block) !== null) continue;
    for (const declaration of block.declarations) {
      if (declaration.property === 'transition' || declaration.property === 'transition-property') {
        for (const item of splitTopLevel(declaration.value)) {
          const property = tokenize(item)[0]?.toLowerCase();
          if (property && isLayoutProperty(property)) {
            report(
              violations,
              'layout-transition',
              declaration.line,
              property,
              'transition 驱动了 layout 属性，改用 transform/opacity'
            );
          }
          if (declaration.property !== 'transition') continue;
          const times = tokenize(item)
            .map((token) => timeToMs(token, durationTokens))
            .filter((value) => value !== null);
          if (!times.length || times[0] <= budget.maxFiniteMs) continue;
          const marker = markerAllows(sourceLines, declaration.line);
          if (marker.allowed && marker.reason) continue;
          report(
            violations,
            'long-transition',
            declaration.line,
            'transition',
            `transition 时长 ${times[0]}ms 超过 ${budget.maxFiniteMs}ms 预算${marker.allowed ? '（预算豁免缺少理由）' : ''}`
          );
        }
      } else if (declaration.property === 'transition-duration') {
        for (const token of splitTopLevel(declaration.value)) {
          const ms = timeToMs(token.trim(), durationTokens);
          if (ms === null || ms <= budget.maxFiniteMs) continue;
          const marker = markerAllows(sourceLines, declaration.line);
          if (marker.allowed && marker.reason) continue;
          report(
            violations,
            'long-transition',
            declaration.line,
            'transition',
            `transition 时长 ${ms}ms 超过 ${budget.maxFiniteMs}ms 预算${marker.allowed ? '（预算豁免缺少理由）' : ''}`
          );
        }
      }
    }
  }

  // 6) prefers-reduced-motion 覆盖：animation 与 transition 都要归零。
  const media = blocks.find((block) => /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(block.prelude));
  if (!media) {
    report(violations, 'reduced-motion', 1, 'prefers-reduced-motion', '缺少 @media (prefers-reduced-motion: reduce) 覆盖');
  } else {
    const declarations = collectDeclarations(blocks, media);
    const killed = (propertyPrefix) => declarations.some((declaration) => {
      if (declaration.property === `${propertyPrefix}-duration`) {
        const parts = splitTopLevel(declaration.value).map((part) => part.trim());
        return parts.every((part) => {
          const ms = timeToMs(part.replace(/\s*!important$/i, ''), durationTokens);
          return ms !== null && ms <= budget.maxReducedMotionMs;
        });
      }
      if (declaration.property === propertyPrefix) {
        return splitTopLevel(declaration.value).every((part) => part.trim() === 'none' || /\bnone\b/.test(part));
      }
      return false;
    });
    if (!killed('animation')) {
      report(violations, 'reduced-motion', media.line, 'animation', 'reduced-motion 下未关闭 animation');
    }
    if (!killed('transition')) {
      report(violations, 'reduced-motion', media.line, 'transition', 'reduced-motion 下未关闭 / 归零 transition');
    }
  }

  const animationCount = animationRefs.length;
  return {
    violations,
    stats: {
      keyframes: keyframeNames.size,
      animations: animationCount,
      infiniteAnimations: infiniteRefs.length,
      transitions: blocks.reduce(
        (total, block) => total + block.declarations.filter((declaration) => declaration.property.startsWith('transition')).length,
        0
      ),
    },
  };
}

export function formatViolation(file, violation) {
  return `${file}:${violation.line}: [${violation.rule}] ${violation.property} — ${violation.message}`;
}

function main(argv) {
  const files = argv.filter((argument) => !argument.startsWith('-'));
  const targets = files.length ? files : ['public/styles.css'];
  const violations = [];
  for (const file of targets) {
    const source = fs.readFileSync(path.resolve(file), 'utf8');
    for (const violation of auditCss(source).violations) {
      violations.push(formatViolation(file, violation));
    }
  }
  if (violations.length) {
    for (const line of violations) console.error(line);
    console.error(`动效预算审计未通过：${violations.length} 个问题`);
    return 1;
  }
  console.log(`动效预算审计通过：${targets.join(', ')}`);
  return 0;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
