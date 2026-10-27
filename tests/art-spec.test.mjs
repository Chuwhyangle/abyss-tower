// 美术方向与资源规范：两份文档的结构、manifest schema 与真实资源示例、
// 令牌对比度报告、art-tokens 单一来源，以及 UI 令牌与 styles.css 的一致性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ART_TOKENS, MOTION_TOKENS } from '../public/js/render/art-tokens.js';
import { Palette } from '../public/js/render/palette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ART_DOC = 'docs/ART_DIRECTION.md';
const PIPELINE_DOC = 'docs/ASSET_PIPELINE.md';

// 文档必须交代的方向面；缺一节即视为方向未定稿。
const ART_SECTIONS = [
  '风格支柱',
  '色板令牌',
  '光源与投影',
  '剪影与描边',
  '材质与发光',
  'VFX 颜色语言',
  '字体与字号',
  '动效语言',
  '令牌对比度报告',
];

const PIPELINE_SECTIONS = [
  '资源清单 schema',
  '命名规范',
  '目录结构',
  '图集与 DPR 变体',
  '压缩',
  '占位资源策略',
  '授权与出处',
  '生成方式记录',
  '示例资源条目',
];

// Plan 里点名的清单字段：schema 必须逐项覆盖（atlas 可为可选）。
const REQUIRED_MANIFEST_FIELDS = [
  'id', 'path', 'size', 'anchor', 'pivot', 'frames', 'states',
  'dpr', 'atlas', 'compression', 'provenance', 'license', 'generator',
];

const MOTION_STATES = Object.keys(MOTION_TOKENS).filter((key) => MOTION_TOKENS[key]?.frames);

function readDoc(relative) {
  const full = path.join(ROOT, relative);
  assert.ok(fs.existsSync(full), `缺少文档：${relative}`);
  return fs.readFileSync(full, 'utf8');
}

function sectionByHeading(markdown, heading) {
  const lines = markdown.split('\n');
  const isH2 = (line) => /^##\s+/.test(line);
  const start = lines.findIndex(
    (line) => isH2(line) && line.replace(/^##\s+/, '').trim() === heading
  );
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isH2(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

function tableRows(section) {
  const rows = section.split('\n').filter((line) => line.trim().startsWith('|'));
  if (rows.length < 3) return [];
  const cells = (line) =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const header = cells(rows[0]);
  return rows.slice(2).map((line) => {
    const values = cells(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
  });
}

// 单元格取值列：`a / b / c` 视为枚举；`^...$` 视为正则；`—` 表示无约束。
function parseAllowed(cell) {
  const raw = String(cell ?? '').replace(/`/g, '').trim();
  if (!raw || raw === '—') return { values: null, pattern: null };
  if (/^\^.*\$$/.test(raw)) return { values: null, pattern: new RegExp(raw) };
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { values: null, pattern: null };
  if (!parts.every((part) => /^[A-Za-z0-9.-]+$/.test(part))) return { values: null, pattern: null };
  return { values: parts, pattern: null };
}

function parseSchema(section, typeHeader) {
  return tableRows(section).map((row) => {
    const allowed = parseAllowed(row[typeHeader]);
    return {
      name: row['字段'].replace(/`/g, '').trim(),
      type: row['类型'].trim(),
      required: row['必填'].includes('必填'),
      values: allowed.values,
      pattern: allowed.pattern,
    };
  });
}

function typeMatches(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

function assertSchema(schema, entry, label) {
  const known = new Set(schema.map((field) => field.name));
  for (const field of schema) {
    const value = entry[field.name];
    const missing = value === undefined || value === null || value === '';
    if (missing) {
      assert.ok(!field.required, `${label}：缺少必填字段 ${field.name}`);
      continue;
    }
    assert.ok(typeMatches(value, field.type), `${label}：${field.name} 类型应为 ${field.type}`);
    if (field.pattern) {
      for (const item of Array.isArray(value) ? value : [value]) {
        assert.match(String(item), field.pattern, `${label}：${field.name} 不匹配 ${field.pattern}`);
      }
    }
    if (field.values) {
      for (const item of Array.isArray(value) ? value : [value]) {
        assert.ok(
          field.values.includes(String(item)),
          `${label}：${field.name} 取值 ${item} 不在 ${field.values.join(' / ')} 内`
        );
      }
    }
  }
  const extra = Object.keys(entry).filter((key) => !known.has(key));
  assert.deepEqual(extra, [], `${label}：出现 schema 未定义的字段`);
}

function resolveTokenPath(dotted) {
  return String(dotted)
    .replace(/`/g, '')
    .trim()
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), ART_TOKENS);
}

function jsonBlocks(section) {
  return [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
}

test('两份美术文档存在且章节齐全', () => {
  const art = readDoc(ART_DOC);
  for (const heading of ART_SECTIONS) {
    assert.ok(sectionByHeading(art, heading), `${ART_DOC} 缺少「## ${heading}」`);
  }
  const pipeline = readDoc(PIPELINE_DOC);
  for (const heading of PIPELINE_SECTIONS) {
    assert.ok(sectionByHeading(pipeline, heading), `${PIPELINE_DOC} 缺少「## ${heading}」`);
  }
  // 方向文档必须指向运行时令牌，管线文档必须指向方向文档（避免各自发明）。
  assert.match(art, /public\/js\/render\/art-tokens\.js/);
  assert.match(pipeline, /ART_DIRECTION\.md/);
});

test('资源清单 schema 覆盖 Plan 要求的全部字段', () => {
  const pipeline = readDoc(PIPELINE_DOC);
  const schema = parseSchema(sectionByHeading(pipeline, '资源清单 schema'), '取值');
  const names = schema.map((field) => field.name);
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    assert.ok(names.includes(field), `manifest schema 缺少字段 ${field}`);
  }
  // 交付状态是占位策略的前提：没有 status 就无法区分「占位」与「可加载」。
  assert.ok(names.includes('status'), 'manifest schema 缺少 status 字段');
  assert.ok(schema.filter((field) => field.required).length >= 10, '必填字段过少，schema 过于宽松');
});

test('文档里的真实资源示例通过 schema 校验，并与动效令牌自洽', () => {
  const pipeline = readDoc(PIPELINE_DOC);
  const schema = parseSchema(sectionByHeading(pipeline, '资源清单 schema'), '取值');
  const provenanceSchema = parseSchema(sectionByHeading(pipeline, '授权与出处'), '取值');
  assert.ok(provenanceSchema.length >= 4, 'provenance 子 schema 字段过少');

  const entries = jsonBlocks(sectionByHeading(pipeline, '示例资源条目'));
  assert.ok(entries.length >= 1, '示例资源条目必须至少含一个 JSON 清单');
  for (const entry of entries) {
    const label = `示例 ${entry.id ?? '(无 id)'}`;
    assertSchema(schema, entry, label);
    assertSchema(provenanceSchema, entry.provenance ?? {}, `${label}.provenance`);
    // 授权必须两处一致，否则追溯链断在清单内部。
    assert.equal(entry.provenance.license, entry.license, `${label}：顶层与 provenance 的 license 不一致`);
    // 状态必须来自动效令牌，帧数必须覆盖最大状态帧数。
    for (const state of entry.states) {
      assert.ok(MOTION_STATES.includes(state), `${label}：状态 ${state} 不在动效令牌内`);
    }
    assert.ok(entry.states.includes('idle'), `${label}：必须包含 idle 状态`);
    const maxFrames = Math.max(...entry.states.map((state) => MOTION_TOKENS[state].frames));
    assert.equal(entry.frames, maxFrames, `${label}：frames 应等于各状态最大帧数 ${maxFrames}`);
    // 示例必须是能真正落地的图片格式。
    assert.match(entry.path, /\.(?:png|webp)$/, `${label}：path 必须是 png/webp`);
  }
});

test('令牌对比度报告与令牌实际取值一致，且不低于阈值', () => {
  const art = readDoc(ART_DOC);
  const rows = tableRows(sectionByHeading(art, '令牌对比度报告'));
  assert.ok(rows.length >= 7, '对比度报告至少覆盖 UI 文本/面板、语义色/底色、敌人与塔/地形');

  const covered = rows.map((row) => row['配对']).join(' ');
  for (const keyword of ['UI', '危险', '敌人', '塔']) {
    assert.ok(covered.includes(keyword), `对比度报告缺少「${keyword}」这一类配对`);
  }

  for (const row of rows) {
    const fg = resolveTokenPath(row['前景令牌']);
    const bg = resolveTokenPath(row['背景令牌']);
    assert.equal(typeof fg, 'string', `${row['配对']}：前景令牌 ${row['前景令牌']} 无法解析`);
    assert.equal(typeof bg, 'string', `${row['配对']}：背景令牌 ${row['背景令牌']} 无法解析`);
    const computed = Palette.contrastRatio(fg, bg);
    const declared = Number(row['对比度']);
    const floor = Number(row['阈值']);
    assert.ok(Number.isFinite(declared) && Number.isFinite(floor), `${row['配对']}：数值列不可解析`);
    assert.ok(
      Math.abs(computed - declared) < 0.05,
      `${row['配对']}：文档写 ${declared}，令牌实测 ${computed.toFixed(2)}（改色后必须同步本表）`
    );
    assert.ok(computed >= floor, `${row['配对']}：对比度 ${computed.toFixed(2)} 低于阈值 ${floor}`);
  }
});

test('全群系穷举：单位与地形的最小对比度达标，且报告里的最差配对确为最差', () => {
  const art = readDoc(ART_DOC);
  const rows = tableRows(sectionByHeading(art, '令牌对比度报告')).filter((row) =>
    row['配对'].includes('全群系最差')
  );
  assert.equal(rows.length, 2, '报告必须给出敌人与塔两条全群系最差配对');

  const biomes = Object.keys(ART_TOKENS.palette);
  let worstEnemy = { ratio: Infinity };
  let worstTower = { ratio: Infinity };
  for (const biome of biomes) {
    const palette = ART_TOKENS.palette[biome];
    for (const [id, color] of Object.entries(ART_TOKENS.character.enemies)) {
      for (const surface of ['grass1', 'grass2', 'path']) {
        const ratio = Palette.contrastRatio(color, palette[surface]);
        if (ratio < worstEnemy.ratio) worstEnemy = { ratio, id, biome, surface };
      }
    }
    for (const [id, color] of Object.entries(ART_TOKENS.character.towers)) {
      const ratio = Palette.contrastRatio(color, palette.grass1);
      if (ratio < worstTower.ratio) worstTower = { ratio, id, biome, surface: 'grass1' };
    }
  }

  assert.ok(worstEnemy.ratio >= 3.0, `敌人/地形最差 ${worstEnemy.ratio.toFixed(2)} < 3.0`);
  assert.ok(worstTower.ratio >= 3.0, `塔/地形最差 ${worstTower.ratio.toFixed(2)} < 3.0`);

  const declaredEnemy = rows.find((row) => row['配对'].includes('敌人'));
  const declaredTower = rows.find((row) => row['配对'].includes('塔'));
  assert.equal(
    resolveTokenPath(declaredEnemy['前景令牌']),
    ART_TOKENS.character.enemies[worstEnemy.id],
    '敌人最差配对写错了：请更新对比度报告'
  );
  assert.equal(
    resolveTokenPath(declaredEnemy['背景令牌']),
    ART_TOKENS.palette[worstEnemy.biome][worstEnemy.surface],
    '敌人最差背景写错了：请更新对比度报告'
  );
  assert.equal(
    resolveTokenPath(declaredTower['前景令牌']),
    ART_TOKENS.character.towers[worstTower.id],
    '塔最差配对写错了：请更新对比度报告'
  );
  assert.equal(
    resolveTokenPath(declaredTower['背景令牌']),
    ART_TOKENS.palette[worstTower.biome][worstTower.surface],
    '塔最差背景写错了：请更新对比度报告'
  );
});

test('palette.js 消费 art-tokens.js，且不再散落字面色值', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public/js/render/palette.js'), 'utf8');
  assert.match(source, /from '\.\/art-tokens\.js'/, 'palette.js 未引用 art-tokens.js');

  const hexLiterals = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hexLiterals, [], `palette.js 仍有字面十六进制色值：${hexLiterals.join(', ')}`);
  const rgbLiterals = source.match(/\brgba?\(\s*\d/g) ?? [];
  assert.deepEqual(rgbLiterals, [], `palette.js 仍有字面 rgb/rgba 色值：${rgbLiterals.length} 处`);

  // 公共 API 不变：渲染层与测试仍按旧名字取得同一批取值。
  assert.equal(Palette.semantic('meteor').id, 'danger');
  assert.equal(Palette.semanticColor('aurora'), ART_TOKENS.semantic.control.color);
  assert.equal(Palette.withAlpha(null, 0.5), 'rgba(255, 255, 255, 0.5)');
});

test('UI 令牌是 styles.css :root 与字号阶梯的镜像', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(rootBlock, 'styles.css 缺少 :root 块');
  const declarations = new Map();
  for (const match of rootBlock[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }

  const colorMap = {
    bg: 'bg',
    'surface-deep': 'surfaceDeep',
    'surface-1': 'surface1',
    'surface-2': 'surface2',
    line: 'line',
    text: 'text',
    'text-strong': 'textStrong',
    'text-body': 'textBody',
    'text-soft': 'textSoft',
    muted: 'muted',
    gold: 'gold',
    'gold-bright': 'goldBright',
    'gold-deep': 'goldDeep',
    'danger-text': 'dangerText',
    green: 'green',
    red: 'red',
    cyan: 'cyan',
    purple: 'purple',
  };
  for (const [cssName, tokenName] of Object.entries(colorMap)) {
    const declared = declarations.get(cssName);
    assert.ok(declared, `styles.css 缺少 --${cssName}`);
    assert.equal(
      String(ART_TOKENS.ui[tokenName]).toLowerCase(),
      declared.toLowerCase(),
      `art-tokens.ui.${tokenName} 与 styles.css --${cssName} 漂移`
    );
  }

  const typeMap = {
    'text-2xs': 'xxs',
    'text-xs': 'xs',
    'text-sm': 'sm',
    'text-md': 'md',
    'text-lg': 'lg',
    'text-xl': 'xl',
    'text-2xl': 'xxl',
    'text-3xl': 'xxxl',
  };
  for (const [cssName, tokenName] of Object.entries(typeMap)) {
    const declared = declarations.get(cssName);
    assert.ok(declared, `styles.css 缺少 --${cssName}`);
    assert.equal(
      `${ART_TOKENS.type[tokenName]}px`,
      declared,
      `art-tokens.type.${tokenName} 与 styles.css --${cssName} 漂移`
    );
  }
});

test('动效令牌覆盖待机/攻击/受击/死亡四种状态', () => {
  assert.deepEqual(MOTION_STATES.slice().sort(), ['attack', 'death', 'hit', 'idle']);
  for (const state of MOTION_STATES) {
    const def = MOTION_TOKENS[state];
    assert.ok(Number.isInteger(def.frames) && def.frames >= 1, `${state}.frames 必须是正整数`);
    assert.ok(def.fps > 0, `${state}.fps 必须为正`);
    assert.equal(typeof def.loop, 'boolean', `${state}.loop 必须是布尔`);
  }
  assert.equal(MOTION_TOKENS.idle.loop, true, '待机必须循环');
  for (const state of ['attack', 'hit', 'death']) {
    assert.equal(MOTION_TOKENS[state].loop, false, `${state} 不应循环`);
  }
});
