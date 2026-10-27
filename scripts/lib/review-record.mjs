// 语义评审记录校验：把 docs/FEEL_REVIEW.md / docs/ART_REVIEW.md 的条目解析成结构化数据。
// 机械层（visual-check）与语义层（评审记录）互相独立：这里只回答「记录是否存在且通过」。

export const REQUIRED_FIELDS = Object.freeze(['场景', '日期', '评审者', '结论', '分数']);
export const PASS_VERDICTS = Object.freeze(['通过', 'pass', 'passed', 'accepted']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCORE_RE = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/;

// 支持「- 键：值」与「- 键: 值」两种写法（中英文冒号都常见）。
export function parseFieldLine(line) {
  const match = /^\s*[-*]\s*([^：:]+?)\s*[：:]\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

export function normalizeVerdict(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (PASS_VERDICTS.some((word) => text === word || text.startsWith(`${word}（`) || text.startsWith(`${word}(`))) {
    return 'pass';
  }
  return 'fail';
}

export function parseScore(value) {
  const match = SCORE_RE.exec(String(value || '').trim());
  if (!match) return null;
  const score = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  if (score < 0 || score > max) return null;
  return { score, max, ratio: score / max };
}

// 以 `### ` 标题切块；标题前的内容属于文档前言，不计为评审条目。
export function parseEntries(markdown) {
  const lines = String(markdown || '').split('\n');
  const entries = [];
  let current = null;
  let inFence = false;
  for (const line of lines) {
    // 围栏代码块里的内容（条目格式模板、示例）不参与解析。
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^###\s+/.test(line)) {
      if (current) entries.push(current);
      current = { title: line.replace(/^###\s+/, '').trim(), fields: {}, line: entries.length };
      continue;
    }
    if (!current) continue;
    const field = parseFieldLine(line);
    if (field) current.fields[field.key] = field.value;
  }
  if (current) entries.push(current);
  return entries;
}

export function validateEntry(entry, index) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!entry.fields[field]) errors.push(`第 ${index + 1} 条「${entry.title}」缺少字段：${field}`);
  }
  const date = entry.fields['日期'];
  if (date && !DATE_RE.test(date)) errors.push(`第 ${index + 1} 条日期格式应为 YYYY-MM-DD：${date}`);
  const verdict = normalizeVerdict(entry.fields['结论']);
  if (entry.fields['结论'] && verdict !== 'pass') {
    errors.push(`第 ${index + 1} 条结论不是「通过」：${entry.fields['结论']}`);
  }
  const score = parseScore(entry.fields['分数']);
  if (entry.fields['分数'] && !score) {
    errors.push(`第 ${index + 1} 条分数格式应为 n/10：${entry.fields['分数']}`);
  }
  return {
    ok: errors.length === 0,
    title: entry.title,
    scene: entry.fields['场景'] || null,
    viewport: entry.fields['视口'] || null,
    date: date || null,
    reviewer: entry.fields['评审者'] || null,
    verdict: verdict || 'missing',
    score: score ? `${score.score}/${score.max}` : null,
    errors,
  };
}

export function checkReviewDocument(markdown, { kind = 'feel' } = {}) {
  const entries = parseEntries(markdown);
  const results = entries.map((entry, index) => validateEntry(entry, index));
  const errors = results.flatMap((item) => item.errors);
  if (!entries.length) {
    errors.push(
      `缺少评审条目（需要至少一条 \`### 标题\` + ${REQUIRED_FIELDS.join(' / ')} 的记录）`
    );
  }
  return {
    kind,
    entries: results,
    errors,
    ok: errors.length === 0,
  };
}

// 覆盖检查：评审必须真的看过要求里的场景 / 视口，而不是只写一条「通过」。
// 条目里的「场景」与「视口」用顿号或逗号分隔都行（例如「combat、boss」）。
export function splitList(value) {
  return String(value || '')
    .split(/[、,，/]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function checkCoverage(entries, { scenes = [], viewports = [] } = {}) {
  const coveredScenes = new Set(entries.flatMap((entry) => splitList(entry.scene)));
  const coveredViewports = new Set(entries.flatMap((entry) => splitList(entry.viewport)));
  const missingScenes = scenes.filter((item) => !coveredScenes.has(item.toLowerCase()));
  const missingViewports = viewports.filter((item) => !coveredViewports.has(item.toLowerCase()));
  const errors = [];
  if (missingScenes.length) errors.push(`评审记录未覆盖场景：${missingScenes.join(' / ')}`);
  if (missingViewports.length) errors.push(`评审记录未覆盖视口：${missingViewports.join(' / ')}`);
  return {
    scenes: [...coveredScenes].sort(),
    viewports: [...coveredViewports].sort(),
    missingScenes,
    missingViewports,
    errors,
  };
}
